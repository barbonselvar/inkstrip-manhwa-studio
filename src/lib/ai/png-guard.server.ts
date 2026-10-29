import { crc32, inflateSync } from "node:zlib";
import { decode } from "fast-png";

/**
 * Complete, bounded PNG validation for the cloud edit endpoint (INK-AUD-002/003).
 *
 * Structure first (signature, CRC-checked chunk walk, IHDR/PLTE/IDAT/IEND rules, valid
 * bit-depth/colour combinations, no trailing bytes), then dimension limits, then a bounded
 * inflate that may produce at most the exact scanline bytes the header declares, and finally
 * a full decode with the maintained fast-png decoder. Nothing larger than the declared image
 * is ever allocated, so a decompression bomb fails before it costs memory.
 */
export class PngError extends Error {}
export type PngLimits = { maxSide: number; maxBytes: number };
export type PngInfo = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlaced: boolean;
};

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_CHUNKS = 4096;
/** Valid bit depths and channel counts per colour type (PNG 11.2.2). */
const COLOR: Record<number, { depths: number[]; channels: number }> = {
  0: { depths: [1, 2, 4, 8, 16], channels: 1 },
  2: { depths: [8, 16], channels: 3 },
  3: { depths: [1, 2, 4, 8], channels: 1 },
  4: { depths: [8, 16], channels: 2 },
  6: { depths: [8, 16], channels: 4 },
};
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

function fail(reason: string): never {
  throw new PngError(reason);
}

/** Filtered scanline bytes (filter byte + packed samples per row) for every pass. */
function scanlineBytes(info: PngInfo) {
  const bitsPerPixel = COLOR[info.colorType]!.channels * info.bitDepth,
    rows = (width: number, height: number) =>
      width && height ? height * (1 + Math.ceil((width * bitsPerPixel) / 8)) : 0;
  if (!info.interlaced) return rows(info.width, info.height);
  return ADAM7.reduce(
    (sum, [x0, y0, dx, dy]) =>
      sum + rows(Math.ceil((info.width - x0) / dx), Math.ceil((info.height - y0) / dy)),
    0,
  );
}

export function validatePng(input: Uint8Array, limits: PngLimits): PngInfo {
  if (input.length > limits.maxBytes) fail("PNG is too large.");
  if (input.length < 8 + 25 + 12 + 12 || SIGNATURE.some((b, i) => input[i] !== b))
    fail("Not a PNG file.");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength),
    idat: Uint8Array[] = [];
  let offset = 8,
    chunks = 0,
    info: PngInfo | undefined,
    palette = false,
    idatClosed = false,
    end = false;
  while (offset < input.length) {
    if (end) fail("Data after the PNG end chunk.");
    if (++chunks > MAX_CHUNKS) fail("Too many PNG chunks.");
    if (offset + 12 > input.length) fail("Truncated PNG chunk.");
    const length = view.getUint32(offset);
    if (length > 0x7fffffff || offset + 12 + length > input.length) fail("Truncated PNG chunk.");
    const typeBytes = input.subarray(offset + 4, offset + 8),
      type = String.fromCharCode(...typeBytes),
      data = input.subarray(offset + 8, offset + 8 + length);
    if (!/^[A-Za-z]{4}$/.test(type)) fail("Invalid PNG chunk type.");
    if (crc32(data, crc32(typeBytes)) !== view.getUint32(offset + 8 + length))
      fail(`Corrupt PNG chunk (${type}).`);
    if (chunks === 1 && type !== "IHDR") fail("PNG must start with IHDR.");
    if (type === "IHDR") {
      if (chunks !== 1 || length !== 13) fail("Invalid PNG header.");
      const h = new DataView(data.buffer, data.byteOffset, 13),
        colorType = data[9]!,
        bitDepth = data[8]!;
      info = {
        width: h.getUint32(0),
        height: h.getUint32(4),
        bitDepth,
        colorType,
        interlaced: data[12] === 1,
      };
      if (!COLOR[colorType]?.depths.includes(bitDepth)) fail("Invalid PNG colour format.");
      if (data[10] !== 0 || data[11] !== 0 || data[12]! > 1) fail("Invalid PNG header.");
      if (!info.width || !info.height) fail("PNG has no pixels.");
      if (info.width > limits.maxSide || info.height > limits.maxSide)
        fail(`PNG exceeds ${limits.maxSide}px per side.`);
    } else if (type === "PLTE") {
      if (palette || idat.length || length === 0 || length % 3 || length > 768)
        fail("Invalid PNG palette.");
      palette = true;
    } else if (type === "IDAT") {
      if (idatClosed) fail("PNG image data is not contiguous.");
      idat.push(data);
    } else if (type === "IEND") {
      if (length !== 0) fail("Invalid PNG end chunk.");
      end = true;
    } else if (type.charCodeAt(0) < 97) fail(`Unsupported critical PNG chunk (${type}).`);
    if (idat.length && type !== "IDAT") idatClosed = true;
    offset += 12 + length;
  }
  if (!info || !end) fail("Truncated PNG (missing end chunk).");
  if (!idat.length) fail("PNG has no image data.");
  if (info.colorType === 3 && !palette) fail("Indexed PNG has no palette.");

  // Bounded inflate: at most the declared scanline bytes, plus one to detect excess.
  const expected = scanlineBytes(info);
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
  } catch {
    return fail("PNG image data is corrupt or larger than its header declares.");
  }
  if (raw.length !== expected) fail("PNG image data does not match its dimensions.");
  let decoded: ReturnType<typeof decode>;
  try {
    decoded = decode(input, { checkCrc: true });
  } catch {
    return fail("PNG image data cannot be decoded.");
  }
  if (decoded.width !== info.width || decoded.height !== info.height)
    fail("PNG decoded to unexpected dimensions.");
  return info;
}
