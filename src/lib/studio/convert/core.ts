/** Decoders for formats browsers do not reliably decode (TIFF, HEIC/HEIF, JPEG XL).
 * Pixels are re-encoded as PNG by fast-png, so the stored result keeps every decoded
 * sample exactly (8- or 16-bit, with alpha). Shared by the conversion worker and tests. */
import { encode } from "fast-png";

export type ConvertibleType = "tiff" | "heic" | "heif" | "jxl";
export const CONVERTIBLE = new Set<string>(["tiff", "heic", "heif", "jxl"]);

export type Raster = {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray | Uint16Array;
  channels: 3 | 4;
  depth: 8 | 16;
  /** What the decoder had to give up, for the import report. */
  notes: string[];
};

export async function decodeRaster(type: ConvertibleType, bytes: Uint8Array): Promise<Raster> {
  if (type === "tiff") return decodeTiff(bytes);
  if (type === "jxl") return decodeJxl(bytes);
  return decodeHeif(bytes);
}

async function decodeTiff(bytes: Uint8Array): Promise<Raster> {
  const { default: UTIF } = await import("utif2");
  const buffer = bytes.slice().buffer as ArrayBuffer;
  const ifds = UTIF.decode(buffer);
  const tag = (ifd: (typeof ifds)[number], name: string) =>
    Number((ifd as unknown as Record<string, ArrayLike<number> | undefined>)[name]?.[0] ?? NaN);
  // The first full-resolution page; reduced-resolution pages (NewSubfileType bit 0) are skipped.
  const page = ifds.find((ifd) => !((tag(ifd, "t254") || 0) & 1)) ?? ifds[0];
  if (!page) throw Error("The TIFF file contains no image.");
  UTIF.decodeImage(buffer, page);
  const width = Number(page.width),
    height = Number(page.height);
  if (!width || !height || !page.data) throw Error("The TIFF image data could not be decoded.");
  const notes: string[] = [];
  const bits = tag(page, "t258") || 8;
  if (bits > 8) notes.push(`${bits}-bit TIFF samples were reduced to 8 bits per channel`);
  if (ifds.length > 1) notes.push("only the first TIFF page was imported");
  const rgba = UTIF.toRGBA8(page);
  if (rgba.length !== width * height * 4) throw Error("The TIFF image data is incomplete.");
  return orient(
    { width, height, data: rgba, channels: 4, depth: 8, notes },
    tag(page, "t274") || 1,
  );
}

async function decodeHeif(bytes: Uint8Array): Promise<Raster> {
  const { default: factory } = await import("libheif-js/libheif-wasm/libheif-bundle.mjs");
  const lib = factory(),
    decoder = new lib.HeifDecoder(),
    images = decoder.decode(bytes);
  if (!images.length) throw Error("The HEIC/HEIF file contains no decodable image.");
  const image = images.find((i: { is_primary?: () => boolean }) => i.is_primary?.()) ?? images[0]!,
    width = image.get_width(),
    height = image.get_height(),
    data = new Uint8ClampedArray(width * height * 4);
  try {
    // libheif applies the file's rotation/mirroring (irot/imir) and returns 8-bit RGBA.
    const shown = await new Promise<unknown>((resolve) =>
      image.display({ data, width, height }, resolve),
    );
    if (!shown) throw Error("The HEIC/HEIF image could not be decoded.");
  } finally {
    for (const i of images) i.free?.();
  }
  const notes = ["HEIC/HEIF high-bit-depth samples, if any, are stored at 8 bits per channel"];
  if (images.length > 1) notes.push("only the primary image was imported");
  return { width, height, data, channels: 4, depth: 8, notes };
}

async function decodeJxl(bytes: Uint8Array): Promise<Raster> {
  const { default: decode } = await import("@jsquash/jxl/decode.js");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const image = await decode(buffer as ArrayBuffer);
  return {
    width: image.width,
    height: image.height,
    data: image.data,
    channels: 4,
    depth: 8,
    notes: ["JPEG XL is stored as 8-bit PNG; animation, if any, keeps the first frame"],
  };
}

/** Apply TIFF Orientation (tag 274) so stored pixels match what viewers display. */
export function orient(raster: Raster, orientation: number): Raster {
  if (!(orientation >= 2 && orientation <= 8) || raster.channels !== 4 || raster.depth !== 8)
    return raster;
  const { width: w, height: h, data } = raster,
    swap = orientation >= 5,
    W = swap ? h : w,
    H = swap ? w : h,
    out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let X = x,
        Y = y;
      switch (orientation) {
        case 2: X = w - 1 - x; break; // prettier-ignore
        case 3: X = w - 1 - x; Y = h - 1 - y; break; // prettier-ignore
        case 4: Y = h - 1 - y; break; // prettier-ignore
        case 5: X = y; Y = x; break; // prettier-ignore
        case 6: X = h - 1 - y; Y = x; break; // prettier-ignore
        case 7: X = h - 1 - y; Y = w - 1 - x; break; // prettier-ignore
        case 8: X = y; Y = w - 1 - x; break; // prettier-ignore
      }
      const s = (y * w + x) * 4,
        d = (Y * W + X) * 4;
      out[d] = data[s]!;
      out[d + 1] = data[s + 1]!;
      out[d + 2] = data[s + 2]!;
      out[d + 3] = data[s + 3]!;
    }
  return { ...raster, width: W, height: H, data: out };
}

/** True when every alpha sample is 255, so the PNG can drop the alpha channel. */
export function opaque(raster: Raster) {
  if (raster.channels !== 4) return true;
  const max = raster.depth === 16 ? 65535 : 255;
  for (let i = 3; i < raster.data.length; i += 4) if (raster.data[i] !== max) return false;
  return true;
}

/** Lossless PNG of the decoded samples. */
export function encodePng(raster: Raster): Uint8Array {
  let { data, channels } = raster;
  if (channels === 4 && opaque(raster)) {
    const n = raster.width * raster.height,
      rgb = raster.depth === 16 ? new Uint16Array(n * 3) : new Uint8Array(n * 3);
    for (let i = 0, j = 0; i < n * 4; i += 4, j += 3) {
      rgb[j] = data[i]!;
      rgb[j + 1] = data[i + 1]!;
      rgb[j + 2] = data[i + 2]!;
    }
    data = rgb;
    channels = 3;
  }
  const png = encode({
    width: raster.width,
    height: raster.height,
    data:
      data instanceof Uint8ClampedArray
        ? new Uint8Array(data.buffer, data.byteOffset, data.length)
        : data,
    channels,
    depth: raster.depth,
  });
  return png.byteOffset === 0 && png.byteLength === png.buffer.byteLength ? png : png.slice();
}
