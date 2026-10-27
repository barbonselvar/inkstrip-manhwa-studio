import { RASTER_MAX_AREA, RASTER_MAX_SIDE } from "../raster-limits.ts";
import { documentSources } from "./raster-budget.ts";
import { MAX_ASSET_BYTES, type ProSession } from "./model.ts";
import { safeBitmap } from "../image-decode.ts";
import { imagePolicy } from "../image-policy.ts";

/** Read bounded container headers before allocating decoded pixels from untrusted files. */
export async function rasterSize(blob: Blob) {
  const b = new Uint8Array(await blob.slice(0, 1_048_576).arrayBuffer()),
    v = new DataView(b.buffer),
    text = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  if (
    blob.type === "image/png" &&
    b.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n) &&
    text(12, 4) === "IHDR"
  )
    return { width: v.getUint32(16), height: v.getUint32(20) };
  if (
    blob.type === "image/webp" &&
    b.length >= 30 &&
    text(0, 4) === "RIFF" &&
    text(8, 4) === "WEBP"
  ) {
    const kind = text(12, 4);
    if (kind === "VP8X")
      return {
        width: 1 + b[24]! + (b[25]! << 8) + (b[26]! << 16),
        height: 1 + b[27]! + (b[28]! << 8) + (b[29]! << 16),
      };
    if (kind === "VP8 " && text(23, 3) === "\x9d\x01\x2a")
      return { width: v.getUint16(26, true) & 16383, height: v.getUint16(28, true) & 16383 };
    if (kind === "VP8L" && b[20] === 47)
      return {
        width: 1 + b[21]! + ((b[22]! & 63) << 8),
        height: 1 + (b[22]! >> 6) + (b[23]! << 2) + ((b[24]! & 15) << 10),
      };
  }
  if (blob.type === "image/jpeg" && b[0] === 255 && b[1] === 216) {
    let at = 2;
    while (at + 3 < b.length) {
      if (b[at++] !== 255) break;
      while (b[at] === 255) at++;
      const marker = b[at++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker! >= 208 && marker! <= 215)) continue;
      if (at + 2 > b.length) break;
      const size = v.getUint16(at);
      if (size < 2 || at + size > b.length) break;
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker!) &&
        size >= 7
      )
        return { width: v.getUint16(at + 5), height: v.getUint16(at + 3) };
      at += size;
    }
  }
  throw Error(
    "Invalid embedded image header (or JPEG metadata exceeds the 1 MiB safety limit). Current document unchanged.",
  );
}

/** Bound standalone Raster assets before either bitmap or HTML image decoding.
 * This shares native-import policy; metadata checks after decode cannot prevent
 * allocation of a decompression bomb. JPEG orientation can swap axes, not area. */
export async function validateRasterInput(blob: Blob, maxArea: number) {
  if (!Number.isFinite(maxArea) || maxArea < 1 || maxArea > RASTER_MAX_AREA)
    throw Error("Invalid Raster image pixel budget.");
  if (blob.size > MAX_ASSET_BYTES)
    throw Error("Raster image exceeds the48MB asset budget. Current document unchanged.");
  const size = await rasterSize(blob);
  if (
    !size.width ||
    !size.height ||
    Math.max(size.width, size.height) > RASTER_MAX_SIDE ||
    size.width * size.height > maxArea
  )
    throw Error("Image exceeds this device's decoded pixel budget. Current document unchanged.");
  return size;
}

/** Import preflight must finish before replacing the open draft or its immutable pool. */
export async function validateNativeImages(
  session: ProSession,
  maxArea: number,
  decode?: typeof createImageBitmap,
) {
  documentSources(session.document, maxArea);
  for (const [id, blob] of Object.entries(session.assets)) {
    const size = await validateRasterInput(blob, maxArea);
    for (const l of session.document.layers)
      for (const e of l.effects ?? [])
        if (
          e.pattern?.kind === "bitmap" &&
          e.pattern.assetId === id &&
          (size.width !== e.pattern.width || size.height !== e.pattern.height)
        )
          throw Error("Bitmap pattern dimensions disagree with its validated header.");
    let image: ImageBitmap | undefined;
    try {
      image = decode
        ? await decode(blob, { imageOrientation: "none" })
        : await safeBitmap(blob, {
            policy: {
              ...imagePolicy(maxArea <= 4_000_000),
              maxPixels: maxArea,
              maxSide: RASTER_MAX_SIDE,
            },
          });
      // Chromium honors EXIF even with imageOrientation:none. A quarter-turn
      // swaps JPEG axes but preserves the preflight pixel/side budgets.
      const orientedJpeg =
        blob.type === "image/jpeg" && image.width === size.height && image.height === size.width;
      for (const l of session.document.layers)
        for (const e of l.effects ?? [])
          if (
            e.pattern?.kind === "bitmap" &&
            e.pattern.assetId === id &&
            (image.width !== e.pattern.width || image.height !== e.pattern.height)
          )
            throw Error("Bitmap pattern dimensions disagree with its decoded source.");
      if (!orientedJpeg && (image.width !== size.width || image.height !== size.height))
        throw Error("Embedded image dimensions disagree with its header.");
    } catch {
      throw Error("An embedded image could not be decoded. Current document unchanged.");
    } finally {
      image?.close();
    }
  }
}
