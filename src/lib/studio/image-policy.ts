import { imageSize } from "image-size";

const MiB = 1024 * 1024;
export type ImagePolicy = ReturnType<typeof imagePolicy>;
export function imagePolicy(constrained = false) {
  return {
    maxSide: 65535,
    maxPixels: constrained ? 16_000_000 : 32_000_000,
    maxBytes: (constrained ? 40 : 80) * MiB,
    maxMemory: (constrained ? 256 : 512) * MiB,
    maxBatchBytes: (constrained ? 128 : 256) * MiB,
    maxBatchPixels: constrained ? 64_000_000 : 128_000_000,
    maxFiles: 250,
    maxFrames: 64,
    maxHeaderBytes: 2 * MiB,
    maxBatchHeaders: 32 * MiB,
  };
}
export function browserImagePolicy() {
  return imagePolicy(
    (typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches) ||
      (typeof navigator !== "undefined" &&
        ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4),
  );
}
export type ImageInfo = {
  width: number;
  height: number;
  mime: string;
  type: string;
  frames: number;
  pixels: number;
  memory: number;
  headerBytes: number;
};
const mimes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tiff: "image/tiff",
  avif: "image/avif",
  heif: "image/heif",
  heic: "image/heic",
  svg: "image/svg+xml",
};
const fail = (message: string): never => {
  throw Error(`${message} Image was not decoded or imported.`);
};
export function imageDimensions(width: number, height: number, policy: ImagePolicy) {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= policy.maxSide))
    fail(`Invalid or excessive image dimensions (maximum ${policy.maxSide}px per side).`);
  // Side checks precede multiplication: no unsafe integer product can pass.
  const pixels = width * height;
  if (pixels > policy.maxPixels)
    fail(`Image exceeds the ${policy.maxPixels / 1e6} megapixel device budget.`);
  return pixels;
}
class Header {
  bytesRead = 0;
  steps = 0;
  private cache: { start: number; bytes: Uint8Array } | undefined;
  readonly blob: Blob;
  readonly policy: ImagePolicy;
  readonly signal?: AbortSignal;
  constructor(blob: Blob, policy: ImagePolicy, signal?: AbortSignal) {
    this.blob = blob;
    this.policy = policy;
    this.signal = signal;
  }
  async read(start: number, length: number, readAhead = true) {
    this.signal?.throwIfAborted();
    if (
      ++this.steps > 32768 ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length < 0 ||
      length > this.policy.maxHeaderBytes ||
      start > this.blob.size - length
    )
      fail("Malformed, truncated or excessively complex image header.");
    if (
      this.cache &&
      start >= this.cache.start &&
      start + length <= this.cache.start + this.cache.bytes.length
    )
      return this.cache.bytes.subarray(start - this.cache.start, start - this.cache.start + length);
    const size = Math.min(Math.max(length, readAhead ? 4096 : length), this.blob.size - start);
    if (this.bytesRead + size > this.policy.maxHeaderBytes)
      fail("Image metadata exceeds the bounded header-reading budget.");
    const bytes = new Uint8Array(await this.blob.slice(start, start + size).arrayBuffer());
    this.signal?.throwIfAborted();
    if (bytes.length !== size) fail("Truncated image bytes.");
    this.bytesRead += size;
    this.cache = { start, bytes };
    return bytes.subarray(0, length);
  }
}
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const ascii = (b: Uint8Array, a = 0, n = b.length - a) =>
  String.fromCharCode(...b.subarray(a, a + n));

async function png(h: Header) {
  const b = await h.read(0, 33),
    v = view(b);
  if (
    b[0] !== 137 ||
    ascii(b, 1, 7) !== "PNG\r\n\x1a\n" ||
    v.getUint32(8) !== 13 ||
    ascii(b, 12, 4) !== "IHDR"
  )
    fail("Invalid PNG signature/IHDR.");
  const width = v.getUint32(16),
    height = v.getUint32(20);
  imageDimensions(width, height, h.policy);
  let crc = 0xffffffff;
  for (const byte of b.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  if ((crc ^ 0xffffffff) >>> 0 !== v.getUint32(29)) fail("Corrupt PNG dimension checksum.");
  if (
    !(
      { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] } as Record<
        number,
        number[]
      >
    )[b[25]!]?.includes(b[24]!) ||
    b[26] ||
    b[27] ||
    b[28]! > 1
  )
    fail("Invalid PNG pixel format.");
  let at = 33,
    frames = 1,
    imageData = false,
    animationFrames = 0,
    inflated = 0;
  for (let n = 0; n < 4096; n++) {
    // Chunk payloads are skipped by length. Speculative reads here charged
    // 4096 compressed pixel bytes for every 8-byte header, rejecting ordinary
    // high-entropy PNGs while inspecting far less than the metadata budget.
    const c = await h.read(at, 8, false),
      size = view(c).getUint32(0),
      kind = ascii(c, 4, 4);
    if (size > h.blob.size - at - 12) fail("Truncated PNG chunk.");
    if (kind === "IHDR") fail("Duplicate PNG dimensions.");
    if (kind === "iCCP" || kind === "zTXt")
      inflated += await pngMetadata(h, at + 8, size, inflated);
    if (kind === "iTXt") {
      const text = await h.read(at + 8, Math.min(size, 82)),
        separator = text.indexOf(0);
      if (separator < 1 || separator > 79 || text[separator + 1] !== 0)
        fail("Compressed or malformed PNG text metadata is not accepted.");
    }
    if (kind === "acTL") {
      if (size !== 8 || imageData || frames !== 1) fail("Invalid PNG animation header.");
      frames = view(await h.read(at + 8, 8)).getUint32(0);
      frameBudget(width, height, frames, h.policy);
    }
    if (kind === "fcTL") {
      if (size !== 26 || ++animationFrames > frames) fail("Invalid PNG frame.");
      const f = view(await h.read(at + 8, 26));
      if (
        !f.getUint32(4) ||
        !f.getUint32(8) ||
        f.getUint32(4) + f.getUint32(12) > width ||
        f.getUint32(8) + f.getUint32(16) > height
      )
        fail("PNG frame exceeds its canvas.");
    }
    if (kind === "IDAT") imageData = true;
    at += size + 12;
    if (kind === "IEND") {
      if (
        size ||
        !imageData ||
        at !== h.blob.size ||
        (animationFrames && animationFrames !== frames)
      )
        fail("Invalid PNG termination.");
      return { width, height, frames };
    }
  }
  return fail("Too many PNG chunks.");
}
/** Colour profiles (iCCP) are common in screenshots and editor exports, and
 * already-stored Chapter art may contain them. Inflate them here under the
 * header budget so a decompression bomb is refused before any decoder sees it. */
async function pngMetadata(h: Header, start: number, size: number, used: number) {
  const b = await h.read(start, size),
    separator = b.indexOf(0);
  if (separator < 1 || separator > 79 || b[separator + 1] !== 0)
    fail("Compressed PNG metadata is malformed.");
  const budget = h.policy.maxHeaderBytes - used,
    reader = h.blob
      .slice(start + separator + 2, start + size)
      .stream()
      .pipeThrough(new DecompressionStream("deflate"))
      .getReader();
  let total = 0;
  try {
    for (;;) {
      h.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.length;
      if (total > budget) fail("Compressed PNG metadata exceeds the bounded expansion budget.");
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    if ((error as Error).message?.includes("Compressed PNG") || h.signal?.aborted) throw error;
    return fail("Compressed PNG metadata is corrupt or truncated.");
  }
}
function frameBudget(width: number, height: number, frames: number, policy: ImagePolicy) {
  const pixels = imageDimensions(width, height, policy);
  if (
    !Number.isSafeInteger(frames) ||
    frames < 1 ||
    frames > policy.maxFrames ||
    frames > Math.floor(policy.maxPixels / pixels)
  )
    fail("Animated/multi-image decoded frames exceed the device budget.");
}
async function gif(h: Header, width: number, height: number) {
  const b = await h.read(0, 13);
  let at = 13 + (b[10]! & 128 ? 3 * 2 ** ((b[10]! & 7) + 1) : 0),
    frames = 0;
  const blocks = async () => {
    for (;;) {
      const size = (await h.read(at++, 1))[0]!;
      if (!size) return;
      if (size > h.blob.size - at) fail("Truncated GIF data.");
      at += size;
    }
  };
  for (let n = 0; n < 4096; n++) {
    const marker = (await h.read(at++, 1))[0];
    if (marker === 0x3b) {
      if (!frames || at !== h.blob.size) fail("Invalid GIF termination.");
      return frames;
    }
    if (marker === 0x21) {
      await h.read(at++, 1);
      await blocks();
    } else if (marker === 0x2c) {
      const b = await h.read(at, 9),
        v = view(b),
        w = v.getUint16(4, true),
        z = v.getUint16(6, true);
      if (!w || !z || v.getUint16(0, true) + w > width || v.getUint16(2, true) + z > height)
        fail("GIF frame exceeds its canvas.");
      frameBudget(width, height, ++frames, h.policy);
      at += 9 + (b[8]! & 128 ? 3 * 2 ** ((b[8]! & 7) + 1) : 0);
      const codeSize = (await h.read(at++, 1))[0]!;
      if (codeSize < 2 || codeSize > 8) fail("Invalid GIF code size.");
      await blocks();
    } else fail("Invalid GIF block.");
  }
  return fail("Too many GIF blocks.");
}
async function webp(h: Header, width: number, height: number) {
  const b = await h.read(0, 12);
  if (view(b).getUint32(4, true) + 8 !== h.blob.size) fail("Truncated WebP container.");
  let at = 12,
    frames = 0,
    payload = false;
  const codedDimensions = async (kind: string, at: number, size: number, w: number, z: number) => {
    const need = kind === "VP8 " ? 10 : 5;
    if (size < need) fail("Truncated WebP coded frame.");
    const b = await h.read(at, need),
      v = view(b);
    let cw: number, ch: number;
    if (kind === "VP8 ") {
      if (b[0]! & 1 || ascii(b, 3, 3) !== "\x9d\x01\x2a") fail("Invalid WebP key frame.");
      cw = v.getUint16(6, true) & 0x3fff;
      ch = v.getUint16(8, true) & 0x3fff;
    } else {
      if (b[0] !== 0x2f || b[4]! >> 5) fail("Invalid WebP lossless frame.");
      cw = 1 + b[1]! + ((b[2]! & 63) << 8);
      ch = 1 + (b[2]! >> 6) + (b[3]! << 2) + ((b[4]! & 15) << 10);
    }
    imageDimensions(cw, ch, h.policy);
    if (cw !== w || ch !== z) fail("WebP coded dimensions disagree with its canvas/frame.");
  };
  for (let n = 0; at < h.blob.size && n < 4096; n++) {
    const b = await h.read(at, 8),
      kind = ascii(b, 0, 4),
      size = view(b).getUint32(4, true);
    if (size > h.blob.size - at - 8) fail("Truncated WebP chunk.");
    if (kind === "ANMF") {
      if (size < 16) fail("Truncated WebP animation frame.");
      const f = await h.read(at + 8, 16),
        u24 = (n: number) => f[n]! + f[n + 1]! * 256 + f[n + 2]! * 65536;
      if (u24(0) * 2 + u24(6) + 1 > width || u24(3) * 2 + u24(9) + 1 > height)
        fail("WebP frame exceeds canvas.");
      frameBudget(width, height, ++frames, h.policy);
      let inner = at + 24,
        coded = 0;
      for (let n = 0; inner < at + 8 + size && n < 4096; n++) {
        const b = await h.read(inner, 8),
          kind = ascii(b, 0, 4),
          length = view(b).getUint32(4, true);
        if (length > at + size - inner) fail("Truncated WebP frame payload.");
        if (kind === "VP8 " || kind === "VP8L") {
          if (++coded > 1) fail("Duplicate WebP frame payload.");
          await codedDimensions(kind, inner + 8, length, u24(6) + 1, u24(9) + 1);
        } else if (kind !== "ALPH") fail("Unsupported WebP frame chunk.");
        inner += 8 + length + (length % 2);
      }
      if (inner !== at + 8 + size || coded !== 1) fail("Invalid WebP frame payload.");
      payload = true;
    }
    if (kind === "VP8 " || kind === "VP8L") {
      if (payload || frames) fail("Duplicate WebP image payload.");
      await codedDimensions(kind, at + 8, size, width, height);
      payload = true;
    }
    at += 8 + size + (size % 2);
  }
  if (at !== h.blob.size || !payload) fail("Invalid WebP payload.");
  return frames || 1;
}
async function jpeg(h: Header, width: number, height: number) {
  let at = 2,
    frame = false;
  for (let n = 0; n < 4096; n++) {
    let marker = await h.read(at, 2);
    if (marker[0] !== 255) fail("Invalid JPEG marker.");
    if (marker[1] === 255) {
      at++;
      continue;
    }
    const code = marker[1]!;
    if (code === 0xd8 || code === 0xd9 || code === 0 || (code >= 0xd0 && code <= 0xd7))
      fail("Invalid JPEG header marker.");
    marker = await h.read(at + 2, 2);
    const length = view(marker).getUint16(0);
    if (length < 2 || length > h.blob.size - at - 2) fail("Truncated JPEG segment.");
    if (code >= 0xc0 && code <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(code)) {
      if (frame || ![0xc0, 0xc1, 0xc2].includes(code) || length < 8)
        fail("Unsupported/duplicate JPEG frame.");
      const b = await h.read(at + 4, 6),
        v = view(b);
      if (
        ![8, 12].includes(b[0]!) ||
        ![1, 3, 4].includes(b[5]!) ||
        length !== 8 + b[5]! * 3 ||
        v.getUint16(1) !== height ||
        v.getUint16(3) !== width
      )
        fail("Invalid JPEG frame dimensions/components.");
      frame = true;
    }
    if (code === 0xda) {
      if (!frame) fail("JPEG scan precedes its frame.");
      const end = await h.read(h.blob.size - 2, 2);
      if ((end[0] !== 255 || end[1] !== 217) && !(await jpegEnd(h, at + 2 + length)))
        fail("Truncated JPEG termination.");
      return;
    }
    at += 2 + length;
  }
  fail("Excessive JPEG header segments.");
}
/** Phones append motion-photo video or vendor trailers after EOI, and decoders
 * stop there. Entropy data stuffs every 0xFF, so the first FF D9 after the scan
 * header is the real EOI. Scanned in bounded chunks; maxBytes caps the file. */
async function jpegEnd(h: Header, from: number) {
  const chunk = MiB;
  let previous = 0;
  for (let at = from; at < h.blob.size; at += chunk) {
    h.signal?.throwIfAborted();
    const bytes = new Uint8Array(await h.blob.slice(at, at + chunk).arrayBuffer());
    if (previous === 255 && bytes[0] === 217) return true;
    for (let i = bytes.indexOf(255); i >= 0 && i < bytes.length - 1; i = bytes.indexOf(255, i + 1))
      if (bytes[i + 1] === 217) return true;
    previous = bytes[bytes.length - 1] ?? 0;
  }
  return false;
}
async function tiff(h: Header) {
  const b = await h.read(0, 8),
    little = ascii(b, 0, 2) === "II",
    v = view(b);
  if (v.getUint16(2, little) !== 42)
    fail("BigTIFF requires conversion to PNG/TIFF classic before safe import.");
  let at = v.getUint32(4, little),
    first: { width: number; height: number } | undefined,
    pixels = 0,
    pages = 0;
  const seen = new Set<number>();
  while (at) {
    if (++pages > h.policy.maxFrames || seen.has(at)) fail("Cyclic/excessive TIFF directories.");
    seen.add(at);
    const count = view(await h.read(at, 2)).getUint16(0, little);
    if (!count || count > 1024) fail("Excessive TIFF directory.");
    const b = await h.read(at + 2, count * 12 + 4),
      v = view(b);
    let width = 0,
      height = 0;
    const seenTags = new Set<number>();
    for (let i = 0; i < count; i++) {
      const p = i * 12,
        tag = v.getUint16(p, little),
        type = v.getUint16(p + 2, little),
        count = v.getUint32(p + 4, little);
      const size = ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8] as const)[type];
      if (seenTags.has(tag)) fail("Duplicate TIFF tag.");
      seenTags.add(tag);
      if (!size || count > 65536) fail("Invalid TIFF field length/type.");
      if (count * size > 4 && v.getUint32(p + 8, little) > h.blob.size - count * size)
        fail("Truncated TIFF values.");
      if (tag === 330 || tag === 513 || tag === 514 || tag === 34665)
        fail("Nested/embedded TIFF images require conversion before import.");
      if (tag === 259 && ![1, 2, 3, 4, 5, 8, 32773, 32946].includes(v.getUint16(p + 8, little)))
        fail("Unsupported TIFF embedded codec.");
      if (
        tag === 277 &&
        (count !== 1 || v.getUint16(p + 8, little) < 1 || v.getUint16(p + 8, little) > 4)
      )
        fail("Unsupported TIFF channel count.");
      if (tag === 258) {
        if (type !== 3 || count < 1 || count > 4) fail("Unsupported TIFF sample depths.");
        const values =
          count * 2 <= 4
            ? b.subarray(p + 8, p + 12)
            : await h.read(v.getUint32(p + 8, little), count * 2);
        for (let sample = 0; sample < count; sample++)
          if (![1, 2, 4, 8, 16].includes(view(values).getUint16(sample * 2, little)))
            fail("Unsupported TIFF sample depth.");
      }
      if (tag === 256 || tag === 257) {
        if (count !== 1 || (type !== 3 && type !== 4)) fail("Invalid TIFF dimensions.");
        const value = type === 3 ? v.getUint16(p + 8, little) : v.getUint32(p + 8, little);
        if (tag === 256) width = value;
        else height = value;
      }
    }
    pixels += imageDimensions(width, height, h.policy);
    if (pixels > h.policy.maxPixels) fail("TIFF pages exceed decoded pixel budget.");
    first ??= { width, height };
    at = v.getUint32(count * 12, little);
  }
  if (!first) fail("Missing TIFF directory.");
  return { ...first!, frames: pages, pixels };
}
async function locations(h: Header, from: number, end: number) {
  let at = from;
  const read = async (size: number) => {
    if (at > end - size) fail("Truncated image item locations.");
    const bytes = await h.read(at, size);
    at += size;
    return bytes;
  };
  const uint = async (size: number) => {
    let value = 0n;
    for (const n of await read(size)) value = value * 256n + BigInt(n);
    return value;
  };
  const b = await read(6),
    version = b[0]!;
  if (version > 2) fail("Unsupported image item location version.");
  const offset = b[4]! >> 4,
    length = b[4]! & 15,
    base = b[5]! >> 4,
    index = version ? b[5]! & 15 : 0;
  if ([offset, length, base, index].some((n) => n > 8)) fail("Invalid image item integer width.");
  const count = Number(await uint(version < 2 ? 2 : 4));
  if (!count || count > 64) fail("Excessive image item count.");
  for (let item = 0; item < count; item++) {
    await uint(version < 2 ? 2 : 4);
    const construction = version ? Number(await uint(2)) : 0;
    if (construction > 1 || (await uint(2)) !== 0n)
      fail("External/derived image item locations are not accepted.");
    const origin = await uint(base),
      extents = Number(await uint(2));
    if (!extents || extents > 128) fail("Excessive image extents.");
    for (let e = 0; e < extents; e++) {
      if (index) await uint(index);
      const start = origin + (await uint(offset)),
        size = await uint(length);
      if (!size || start + size > BigInt(h.blob.size))
        fail("Image item extent is outside the file.");
    }
  }
  if (at !== end) fail("Invalid image item location length.");
}
async function heif(h: Header) {
  // Check every declared image plane, not only the first thumbnail chosen by a size library.
  const images: { width: number; height: number }[] = [];
  let boxes = 0;
  const walk = async (from: number, end: number, depth: number) => {
    if (depth > 5) fail("Excessively nested image container.");
    for (let at = from; at < end;) {
      if (++boxes > 1024) fail("Excessive image container boxes.");
      const b = await h.read(at, 8),
        v = view(b),
        type = ascii(b, 4, 4);
      let size = v.getUint32(0),
        header = 8;
      if (size === 1) {
        const n = view(await h.read(at + 8, 8)).getBigUint64(0);
        if (n > BigInt(end - at)) fail("Invalid 64-bit image box size.");
        size = Number(n);
        header = 16;
      } else if (!size) size = end - at;
      if (size < header || size > end - at) fail("Truncated image container box.");
      if (["moov", "trak", "dref", "url ", "urn ", "ipro"].includes(type))
        fail("Timed/external image containers require conversion to a still image.");
      if (type === "iloc") await locations(h, at + header, at + size);
      if (type === "pixi") {
        const b = await h.read(at + header, Math.min(size - header, 9)),
          channels = b[4]!;
        if (
          channels < 1 ||
          channels > 4 ||
          size !== header + 5 + channels ||
          [...b.subarray(5, 5 + channels)].some((n) => n < 1 || n > 16)
        )
          fail("Unsupported image plane depths/channels.");
      }
      if (type === "ispe") {
        if (size !== header + 12) fail("Invalid encoded image dimensions.");
        const v = view(await h.read(at + header + 4, 8));
        const image = { width: v.getUint32(0), height: v.getUint32(4) };
        imageDimensions(image.width, image.height, h.policy);
        images.push(image);
      }
      if (["meta", "iprp", "ipco", "dinf"].includes(type))
        await walk(at + header + (type === "meta" ? 4 : 0), at + size, depth + 1);
      at += size;
    }
  };
  await walk(0, h.blob.size, 0);
  if (!images.length || images.length > h.policy.maxFrames)
    fail("Missing/excessive encoded image planes.");
  const pixels = images.reduce((n, i) => n + i.width * i.height, 0);
  if (pixels > h.policy.maxPixels) fail("Encoded image planes exceed the decoded pixel budget.");
  return { images, pixels };
}
async function svg(h: Header) {
  if (h.blob.size > MiB) fail("SVG exceeds the1MiB markup budget.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await h.read(0, h.blob.size));
  if (
    /<!DOCTYPE|<!ENTITY|<\?|<\s*(?:script|foreignObject|image|use|style|filter|animate|set)\b|\son[a-z]+\s*=|(?:href|src)\s*=/i.test(
      text.replace(/^\s*<\?xml[^?]*\?>/i, ""),
    )
  )
    fail("SVG contains active, external or unsupported resource markup.");
  if (/url\(\s*(?!#[\w.-]+\s*\))/i.test(text) || /\\|&#/i.test(text))
    fail("Unsafe SVG URL/escaped markup.");
  // Reuse the existing whitelist parser rather than introducing another SVG engine.
  if (typeof DOMParser === "undefined")
    fail("SVG requires main-window validation; export PNG for this worker workflow.");
  const { importSvg } = await import("./pro/svg-import.ts");
  importSvg(text);
}
export async function preflightImage(
  blob: Blob,
  policy = browserImagePolicy(),
  signal?: AbortSignal,
): Promise<ImageInfo> {
  signal?.throwIfAborted();
  for (const [key, limit] of Object.entries(imagePolicy())) {
    const value = policy[key as keyof ImagePolicy];
    if (!Number.isSafeInteger(value) || value < 1 || value > limit)
      fail("Invalid image resource policy.");
  }
  if (!blob.size || !Number.isSafeInteger(blob.size) || blob.size > policy.maxBytes)
    fail(`Image file exceeds the ${policy.maxBytes / MiB}MiB encoded-file budget or is empty.`);
  const h = new Header(blob, policy, signal);
  try {
    let prefix = await h.read(0, Math.min(blob.size, 65536));
    const signature = ascii(prefix, 0, Math.min(4, prefix.length));
    let dimensions: {
      width: number;
      height: number;
      type?: string;
      images?: { width: number; height: number }[];
    };
    let frames = 1,
      pixels: number | undefined;
    if (signature.startsWith("II") || signature.startsWith("MM")) {
      const t = await tiff(h);
      dimensions = { ...t, type: "tiff" };
      pixels = t.pixels;
      frames = t.frames;
    } else {
      // Prevent a hostile ICO count from allocating an unbounded image array in the library.
      if (
        prefix[0] === 0 &&
        prefix[1] === 0 &&
        prefix[2] === 1 &&
        prefix[3] === 0 &&
        view(prefix).getUint16(4, true) > policy.maxFrames
      )
        fail("Too many icon images.");
      try {
        dimensions = imageSize(prefix);
      } catch {
        if (blob.size > prefix.length) {
          prefix = await h.read(0, Math.min(blob.size, MiB));
          try {
            dimensions = imageSize(prefix);
          } catch {
            return fail(
              "Unsupported, malformed or unverifiable image header. Export a PNG/JPEG/WebP copy.",
            );
          }
        } else return fail("Unsupported, malformed or truncated image header.");
      }
    }
    const { width, height } = dimensions,
      type = dimensions.type === "mif1" ? "heif" : (dimensions.type ?? "");
    if (!mimes[type])
      fail("This encoded image format is not supported. Export PNG/JPEG/WebP first.");
    imageDimensions(width, height, policy);
    for (const i of dimensions.images ?? []) imageDimensions(i.width, i.height, policy);
    if (type === "png") frames = (await png(h)).frames;
    else if (type === "gif") frames = await gif(h, width, height);
    else if (type === "webp") frames = await webp(h, width, height);
    else if (type === "jpg") {
      await jpeg(h, width, height);
    } else if (["avif", "heif", "heic"].includes(type)) {
      const info = await heif(h);
      pixels = info.pixels;
    } else if (type === "ico") {
      frames = dimensions.images?.length ?? 1;
      for (let i = 0; i < frames; i++) {
        const d = view(await h.read(6 + i * 16, 16)),
          size = d.getUint32(8, true),
          at = d.getUint32(12, true);
        if (!size || at < 6 + frames * 16 || at > blob.size - size)
          fail("Invalid icon payload range.");
        const raw = await h.read(at, Math.min(size, 40));
        if (raw[0] === 137) {
          let inner: ImageInfo;
          try {
            inner = await preflightImage(blob.slice(at, at + size, "image/png"), policy, signal);
            h.bytesRead += inner.headerBytes;
          } catch (error) {
            h.bytesRead += (error as { headerBytes?: number }).headerBytes ?? 0;
            throw error;
          }
          if (h.bytesRead > policy.maxHeaderBytes)
            fail("Nested icon metadata exceeds the header budget.");
          if (inner.width > 256 || inner.height > 256 || inner.frames !== 1)
            fail("Invalid embedded icon PNG.");
        } else {
          if (raw.length < 40) fail("Truncated icon bitmap.");
          const v = view(raw);
          if (
            v.getUint32(0, true) !== 40 ||
            v.getInt32(4, true) < 1 ||
            v.getInt32(4, true) > 256 ||
            v.getInt32(8, true) < 2 ||
            v.getInt32(8, true) > 512 ||
            v.getUint32(16, true) > 3 ||
            v.getUint16(12, true) !== 1 ||
            ![1, 4, 8, 16, 24, 32].includes(v.getUint16(14, true)) ||
            v.getUint32(32, true) > 256
          )
            fail("Unsupported icon bitmap.");
        }
      }
    } else if (type === "bmp") {
      const b = view(await h.read(0, 54));
      if (
        b.getUint32(14, true) < 40 ||
        b.getUint32(10, true) >= blob.size ||
        ![0, 1, 2, 3, 6].includes(b.getUint32(30, true)) ||
        b.getUint16(26, true) !== 1 ||
        ![1, 4, 8, 16, 24, 32].includes(b.getUint16(28, true)) ||
        b.getUint32(46, true) > 65536
      )
        fail("Unsupported/truncated BMP layout or embedded codec.");
    } else if (type === "svg") await svg(h);
    frameBudget(width, height, frames, policy);
    pixels ??= width * height * frames;
    const memory = pixels * 12 + blob.size * 2 + 4 * MiB;
    if (!Number.isSafeInteger(memory) || memory > policy.maxMemory)
      fail("Image exceeds the estimated decoded-memory budget.");
    signal?.throwIfAborted();
    return {
      width,
      height,
      mime: mimes[type]!,
      type,
      frames,
      pixels,
      memory,
      headerBytes: h.bytesRead,
    };
  } catch (error) {
    if (error instanceof Error)
      Object.defineProperty(error, "headerBytes", { value: h.bytesRead, configurable: true });
    throw error;
  }
}
export async function preflightImages(
  blobs: Blob[],
  policy = browserImagePolicy(),
  signal?: AbortSignal,
) {
  if (blobs.length > policy.maxFiles) fail(`Import at most ${policy.maxFiles} images per batch.`);
  const accepted: { index: number; info: ImageInfo }[] = [],
    rejected: { index: number; reason: string }[] = [];
  let bytes = 0,
    pixels = 0,
    headers = 0,
    peak = 0;
  for (let index = 0; index < blobs.length; index++) {
    signal?.throwIfAborted();
    try {
      const info = await preflightImage(blobs[index]!, policy, signal);
      accepted.push({ index, info });
      bytes += blobs[index]!.size;
      pixels += info.pixels;
      headers += info.headerBytes;
      peak = Math.max(peak, info.memory);
    } catch (error) {
      signal?.throwIfAborted();
      headers += (error as { headerBytes?: number }).headerBytes ?? 0;
      rejected.push({ index, reason: (error as Error).message });
    }
    if (
      bytes > policy.maxBatchBytes ||
      pixels > policy.maxBatchPixels ||
      headers > policy.maxBatchHeaders ||
      bytes + peak > policy.maxMemory
    )
      fail(
        "Batch exceeds aggregate file, pixel, metadata or estimated memory budgets. Choose fewer images.",
      );
  }
  return { accepted, rejected, bytes, pixels };
}

/** Recovery stores lazy Blob slices, not one decoded image per page. */
export async function preflightRecoveryImages(
  entries: { blob: Blob; thumbnail?: boolean; decode?: boolean }[],
  policy = browserImagePolicy(),
  signal?: AbortSignal,
) {
  if (entries.length > 4000) fail("Backup exceeds4000 image references; split the project backup.");
  const result: ImageInfo[] = [];
  let bytes = 0,
    headers = 0,
    decodePixels = 0;
  for (const entry of entries) {
    signal?.throwIfAborted();
    const info = await preflightImage(
      entry.blob,
      entry.thumbnail ? thumbnailPolicy(policy) : policy,
      signal,
    );
    bytes += entry.blob.size;
    headers += info.headerBytes;
    if (entry.decode) decodePixels += info.pixels;
    if (
      bytes > policy.maxMemory ||
      headers > policy.maxBatchHeaders ||
      decodePixels > policy.maxBatchPixels
    )
      fail(
        "Backup exceeds aggregate storage, metadata or native-decode work budgets. Restore smaller project backups.",
      );
    result.push(info);
  }
  return result;
}
export function thumbnailPolicy(policy = browserImagePolicy()): ImagePolicy {
  return { ...policy, maxSide: 512, maxPixels: 512 * 512, maxBytes: 2 * MiB };
}
