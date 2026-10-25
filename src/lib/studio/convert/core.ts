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

/** libheif (LGPL-3.0) is never bundled with this code: the caller supplies a loader for the
 * separate, unmodified libheif-js file, so it can be replaced (LGPL-3.0 §4(d)(1)). */
export type HeifFactory = () => {
  HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] };
};
type HeifImage = {
  get_width(): number;
  get_height(): number;
  is_primary?(): boolean;
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    done: (result: unknown) => void,
  ): void;
  free?(): void;
};
export type Loaders = { heif?: () => Promise<HeifFactory> };

export async function decodeRaster(
  type: ConvertibleType,
  bytes: Uint8Array,
  loaders: Loaders = {},
): Promise<Raster> {
  if (type === "tiff") return decodeTiff(bytes);
  if (type === "jxl") return decodeJxl(bytes);
  if (!loaders.heif) throw Error("The HEIC/HEIF decoder is not available.");
  return decodeHeif(bytes, await loaders.heif());
}

async function decodeTiff(bytes: Uint8Array): Promise<Raster> {
  const { default: UTIF } = await import("utif2");
  // Always copy: a Node Buffer's slice() is a view into a shared pool.
  const buffer = Uint8Array.prototype.slice.call(bytes).buffer as ArrayBuffer;
  const ifds = UTIF.decode(buffer);
  const tag = (ifd: (typeof ifds)[number], name: string) =>
    Number((ifd as unknown as Record<string, ArrayLike<number> | undefined>)[name]?.[0] ?? NaN);
  // The first full-resolution page; reduced-resolution pages (NewSubfileType bit 0) are skipped.
  const page = ifds.find((ifd) => !((tag(ifd, "t254") || 0) & 1)) ?? ifds[0];
  if (!page) throw Error("The TIFF file contains no image.");
  validateTiffData(new Uint8Array(buffer), (name) => {
    const v = (page as unknown as Record<string, ArrayLike<number> | undefined>)[name];
    return v ? Array.from(v, Number) : undefined;
  });
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

/** utif2 silently turns corrupt LZW/PackBits/uncompressed strips into wrong pixels. Check
 * that every strip or tile is structurally valid and decodes to at least the image size,
 * so a corrupted TIFF is rejected instead of being imported with garbage. */
export function validateTiffData(bytes: Uint8Array, tag: (name: string) => number[] | undefined) {
  const compression = tag("t259")?.[0] ?? 1,
    width = tag("t256")?.[0] ?? 0,
    height = tag("t257")?.[0] ?? 0,
    bits = tag("t258")?.[0] ?? 1,
    samples = tag("t277")?.[0] ?? 1,
    planar = tag("t284")?.[0] ?? 1,
    tileW = tag("t322")?.[0],
    tileH = tag("t323")?.[0],
    offsets = tag(tileW ? "t324" : "t273") ?? [],
    counts = tag(tileW ? "t325" : "t279") ?? [];
  const bad = (why: string): never => {
    throw Error(`The TIFF image data is corrupted or unsupported (${why}).`);
  };
  if (!width || !height || !offsets.length || offsets.length !== counts.length)
    bad("missing strip layout");
  if ([2, 3, 4].includes(compression)) {
    if (bits !== 1 || samples !== 1) bad("fax compression on a non-bilevel image");
    return; // Bilevel fax scans: decoded by utif2's CCITT decoder.
  }
  const planes = planar === 2 ? samples : 1,
    perPixel = planar === 2 ? bits : bits * samples,
    expected = tileW
      ? Math.ceil(width / tileW) *
        Math.ceil(height / tileH!) *
        tileH! *
        Math.ceil((tileW * perPixel) / 8) *
        planes
      : Math.ceil((width * perPixel) / 8) * height * planes;
  let total = 0;
  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i]!,
      size = counts[i]!;
    if (start + size > bytes.length) bad("strip outside the file");
    const strip = bytes.subarray(start, start + size);
    if (compression === 1) total += size;
    else if (compression === 5) total += lzwLength(strip) ?? bad("invalid LZW stream");
    else if (compression === 32773) total += packBitsLength(strip);
    else return; // Deflate: utif2's inflater throws on corrupt streams.
  }
  if (total < expected) bad("image data is truncated");
}

/** Decoded length of a TIFF LZW stream (MSB-first, early code-width change), or undefined. */
export function lzwLength(data: Uint8Array): number | undefined {
  let bit = 0,
    width = 9,
    next = 258,
    previous = -1,
    total = 0,
    first = true;
  const lengths = new Uint32Array(4096);
  for (let i = 0; i < 256; i++) lengths[i] = 1;
  while (bit + width <= data.length * 8) {
    let code = 0;
    for (let k = 0; k < width; k++, bit++)
      code = (code << 1) | ((data[bit >> 3]! >> (7 - (bit & 7))) & 1);
    if (first && code !== 256) return undefined;
    first = false;
    if (code === 257) return total;
    if (code === 256) {
      width = 9;
      next = 258;
      previous = -1;
      continue;
    }
    let length: number;
    if (code < next && (code < 256 || code > 257)) length = lengths[code]!;
    else if (code === next && previous >= 0) length = lengths[previous]! + 1;
    else return undefined;
    if (previous >= 0 && next < 4096) lengths[next++] = lengths[previous]! + 1;
    total += length;
    previous = code;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return total; // Some writers omit EOI; the length check still applies.
}

function packBitsLength(data: Uint8Array) {
  let total = 0;
  for (let i = 0; i < data.length;) {
    const n = (data[i]! << 24) >> 24;
    if (n >= 0) {
      total += n + 1;
      i += n + 2;
    } else if (n !== -128) {
      total += 1 - n;
      i += 2;
    } else i++;
  }
  return total;
}

async function decodeHeif(bytes: Uint8Array, factory: HeifFactory): Promise<Raster> {
  const lib = factory(),
    decoder = new lib.HeifDecoder(),
    images = decoder.decode(bytes);
  if (!images.length) throw Error("The HEIC/HEIF file contains no decodable image.");
  const image = images.find((i) => i.is_primary?.()) ?? images[0]!,
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
  const buffer = Uint8Array.prototype.slice.call(bytes).buffer as ArrayBuffer;
  const image = await decode(buffer);
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
