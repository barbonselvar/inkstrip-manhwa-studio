import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import {
  imagePolicy,
  imageDimensions,
  preflightImage,
  preflightImages,
  preflightRecoveryImages,
  thumbnailPolicy,
} from "./image-policy.ts";

const fixture = async (name = "original.png", type = "application/octet-stream") =>
  new Blob(
    [Uint8Array.from(await readFile(new URL(`./fixtures/import/${name}`, import.meta.url)))],
    { type },
  );
const mutate = async (name: string, fn: (view: DataView, bytes: Uint8Array) => void) => {
  const bytes = new Uint8Array(await (await fixture(name)).arrayBuffer());
  fn(new DataView(bytes.buffer), bytes);
  return new Blob([bytes]);
};
for (const [format, mime] of Object.entries({
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tiff: "image/tiff",
  avif: "image/avif",
}))
  test(`valid internally created ${format} signature/dimensions ignore the supplied MIME`, async () => {
    const blob = await fixture(`original.${format}`, "text/plain"),
      before = await blob.arrayBuffer();
    const info = await preflightImage(blob);
    assert.equal(info.width, 32);
    assert.equal(info.height, format === "ico" ? 32 : 24);
    assert.equal(info.mime, mime);
    assert.ok(info.headerBytes <= imagePolicy().maxHeaderBytes);
    assert.deepEqual(await blob.arrayBuffer(), before);
  });
test("source policy retains 65535-side /32MP desktop and16MP constrained bounds including tall Chapter sources", async () => {
  assert.equal(imageDimensions(65535, 1, imagePolicy()), 65535);
  assert.equal(imageDimensions(8000, 4000, imagePolicy()), 32_000_000);
  assert.throws(() => imageDimensions(8000, 4000, imagePolicy(true)), /megapixel/);
  const info = await preflightImage(await fixture("tall.png"), imagePolicy(true));
  assert.equal(info.height, 50000);
  assert.equal(info.width, 1);
});
test("zero/negative/NaN/infinite/overflow dimensions and invalid policies fail safely", async () => {
  for (const value of [
    0,
    -1,
    NaN,
    Infinity,
    2 ** 32,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => imageDimensions(value, 1, imagePolicy()), /dimensions/);
  for (const value of [NaN, Infinity, -1, 32_000_001])
    await assert.rejects(
      preflightImage(await fixture(), { ...imagePolicy(), maxPixels: value }),
      /policy/,
    );
});
test("encoded bytes and empty files are rejected before any payload read", async () => {
  const fake = new Blob();
  Object.defineProperty(fake, "size", { value: imagePolicy().maxBytes + 1 });
  fake.slice = () => {
    throw Error("must not read");
  };
  await assert.rejects(preflightImage(fake), /encoded-file/);
  await assert.rejects(preflightImage(new Blob()), /empty/);
});
test("PNG huge declared dimensions fail before CRC or decoder processing", async () => {
  for (const n of [0, 65536, 0xffffffff]) {
    const blob = await mutate("original.png", (v) => v.setUint32(16, n));
    await assert.rejects(preflightImage(blob), /dimensions/);
  }
});
test("PNG corrupt checksum, truncated chunk and missing termination are rejected", async () => {
  await assert.rejects(
    preflightImage(
      await mutate("original.png", (_, b) => {
        b[29] = b[29]! ^ 1;
      }),
    ),
    /checksum/,
  );
  const png = await fixture();
  for (const size of [1, 8, 24, 32, png.size - 1, png.size - 12])
    await assert.rejects(preflightImage(png.slice(0, size)));
});
test("PNG compressed ancillary metadata is rejected instead of expanding unbounded profile/text data", async () => {
  const bytes = new Uint8Array(await (await fixture()).arrayBuffer()),
    chunk = new Uint8Array(16);
  new DataView(chunk.buffer).setUint32(0, 4);
  chunk.set(new TextEncoder().encode("iCCP"), 4);
  await assert.rejects(
    preflightImage(new Blob([bytes.subarray(0, 33), chunk, bytes.subarray(33)])),
    /Compressed PNG/,
  );
});
const withChunks = async (...chunks: [string, Uint8Array][]) => {
  const bytes = new Uint8Array(await (await fixture()).arrayBuffer()),
    parts = chunks.map(([kind, data]) => {
      const chunk = new Uint8Array(data.length + 12);
      new DataView(chunk.buffer).setUint32(0, data.length);
      chunk.set(new TextEncoder().encode(kind), 4);
      chunk.set(data, 8);
      return chunk;
    });
  return new Blob([bytes.subarray(0, 33), ...parts, bytes.subarray(33)]);
};
const compressed = (keyword: string, payload: Uint8Array, method = 0) =>
  Uint8Array.from([...new TextEncoder().encode(keyword), 0, method, ...deflateSync(payload)]);
test("PNG colour profiles stay importable, including art stored before R1.1", async () => {
  const info = await preflightImage(await fixture("iccp.png"), imagePolicy(true));
  assert.deepEqual([info.width, info.height, info.mime], [64, 48, "image/png"]);
  const text = compressed("Comment", new TextEncoder().encode("drawn in Inkstrip"));
  assert.equal((await preflightImage(await withChunks(["zTXt", text]))).mime, "image/png");
});
test("PNG profile/text decompression bombs, corrupt streams and unknown methods are refused", async () => {
  const policy = imagePolicy(true),
    bomb = compressed("ICC", new Uint8Array(policy.maxHeaderBytes + 1));
  assert.ok(bomb.length < 8192, "a few KiB must not be allowed to expand past the budget");
  await assert.rejects(preflightImage(await withChunks(["iCCP", bomb]), policy), /expansion/);
  // Two chunks that each fit cannot jointly exceed the per-file budget.
  const half = compressed("ICC", new Uint8Array(policy.maxHeaderBytes / 2 + 1));
  await assert.rejects(
    preflightImage(await withChunks(["iCCP", half], ["zTXt", half]), policy),
    /expansion/,
  );
  const corrupt = compressed("ICC", new Uint8Array(64));
  corrupt.fill(0x5a, 8);
  await assert.rejects(preflightImage(await withChunks(["iCCP", corrupt])), /corrupt/);
  const truncated = compressed("ICC", new Uint8Array(4096).fill(7));
  await assert.rejects(
    preflightImage(await withChunks(["iCCP", truncated.subarray(0, truncated.length - 6)])),
    /corrupt/,
  );
  await assert.rejects(
    preflightImage(await withChunks(["iCCP", compressed("ICC", new Uint8Array(8), 1)])),
    /malformed/,
  );
  const controller = new AbortController();
  controller.abort(new DOMException("stop", "AbortError"));
  await assert.rejects(preflightImage(await fixture("iccp.png"), policy, controller.signal), {
    name: "AbortError",
  });
});
test("JPEG malformed markers/dimensions and missing EOI are refused", async () => {
  const blob = await fixture("original.jpg");
  await assert.rejects(preflightImage(blob.slice(0, blob.size - 2)), /JPEG/);
  await assert.rejects(
    preflightImage(
      await mutate("original.jpg", (v, b) => {
        for (let n = 0; n < b.length - 9; n++)
          if (b[n] === 255 && b[n + 1] === 192) {
            v.setUint16(n + 5, 65535);
            v.setUint16(n + 7, 65535);
            return;
          }
      }),
    ),
    /dimensions|megapixel/,
  );
});
test("JPEG trailers after EOI (motion photos, vendor data) are accepted; missing EOI is not", async () => {
  const jpeg = new Uint8Array(await (await fixture("original.jpg")).arrayBuffer()),
    trailer = new Uint8Array(3 * 1024 * 1024 + 7).fill(0x41);
  trailer.set(new TextEncoder().encode("\0\0\0\x18ftypmp42"), 0);
  trailer.set(new TextEncoder().encode("SEFT"), trailer.length - 4);
  const info = await preflightImage(new Blob([jpeg, trailer]));
  assert.deepEqual([info.width, info.height, info.mime], [32, 24, "image/jpeg"]);
  // EOI split across the 1 MiB scan boundary is still found: FF ends one chunk,
  // D9 starts the next (scanning begins after the SOS header).
  const scan = jpeg.findIndex((b, i) => b === 255 && jpeg[i + 1] === 0xda),
    from = scan + 2 + ((jpeg[scan + 2]! << 8) | jpeg[scan + 3]!),
    body = jpeg.subarray(0, jpeg.length - 2),
    pad = new Uint8Array(from + 1024 * 1024 - 1 - body.length).fill(0x11);
  assert.equal(body.length + pad.length, from + 1024 * 1024 - 1);
  assert.ok(
    await preflightImage(new Blob([body, pad, Uint8Array.of(255, 217), trailer])),
    "boundary-split EOI",
  );
  // Without any EOI, a trailer is still a truncated scan.
  await assert.rejects(preflightImage(new Blob([body, trailer])), /Truncated JPEG/);
  // An FF D9 inside metadata before the scan cannot stand in for the real EOI.
  const app = Uint8Array.of(255, 0xe1, 0, 6, 255, 217, 0, 0);
  await assert.rejects(
    preflightImage(new Blob([jpeg.subarray(0, 2), app, body.subarray(2), trailer])),
    /Truncated JPEG/,
  );
});
test("WebP container truncation, malformed signature and forged sizes are refused", async () => {
  await assert.rejects(
    preflightImage(await mutate("original.webp", (v) => v.setUint32(4, 0xffffffff, true))),
    /WebP/,
  );
  await assert.rejects(preflightImage((await fixture("original.webp")).slice(0, 30)));
});
test("WebP extended canvas cannot hide different coded dimensions", async () => {
  const bytes = new Uint8Array(await (await fixture("original.webp")).arrayBuffer());
  const prefix = new Uint8Array(30),
    v = new DataView(prefix.buffer);
  prefix.set(bytes.subarray(0, 12));
  prefix.set(new TextEncoder().encode("VP8X"), 12);
  v.setUint32(16, 10, true);
  prefix[24] = prefix[27] = 15; // 16×16 canvas disguising the real32×24 payload.
  v.setUint32(4, bytes.length + 18 - 8, true);
  await assert.rejects(preflightImage(new Blob([prefix, bytes.subarray(12)])), /coded dimensions/);
});
test("animated WebP frames and progressive JPEG retain bounded valid format support", async () => {
  assert.equal((await preflightImage(await fixture("animated.webp"))).frames, 2);
  assert.equal((await preflightImage(await fixture("progressive.jpg"))).width, 32);
  await assert.rejects(
    preflightImage(await fixture("animated.webp"), { ...imagePolicy(), maxFrames: 1 }),
    /frames/,
  );
  await assert.rejects(
    preflightImage(
      await mutate("animated.webp", (v, b) => {
        for (let i = 0; i < b.length - 4; i++)
          if (String.fromCharCode(...b.subarray(i, i + 4)) === "VP8 ") {
            v.setUint16(i + 14, 16000, true);
            return;
          }
      }),
    ),
    /coded dimensions/,
  );
});
test("GIF frame accounting, truncation and decompression-bomb-like dimensions are bounded", async () => {
  const blob = await fixture("animated.gif"),
    info = await preflightImage(blob);
  assert.equal(info.frames, 2);
  await assert.rejects(preflightImage(blob, { ...imagePolicy(), maxFrames: 1 }), /frames/);
  await assert.rejects(preflightImage(blob.slice(0, blob.size - 1)));
  await assert.rejects(
    preflightImage(
      await mutate("original.gif", (v) => {
        v.setUint16(6, 65535, true);
        v.setUint16(8, 65535, true);
      }),
    ),
    /megapixel/,
  );
});
test("ICO directories cannot conceal an oversized nested PNG or allocate huge entry lists", async () => {
  await assert.rejects(
    preflightImage(await mutate("original.ico", (v) => v.setUint16(4, 65535, true))),
    /icon/,
  );
  await assert.rejects(
    preflightImage(await mutate("original.ico", (v) => v.setUint32(18, 0xfffffff0, true))),
    /range/,
  );
});
test("TIFF offsets, directory counts/cycles and unsupported embedded image structures fail closed", async () => {
  await assert.rejects(
    preflightImage(await mutate("original.tiff", (v) => v.setUint32(4, 0xfffffff0, true))),
  );
  await assert.rejects(
    preflightImage(await mutate("original.tiff", (v) => v.setUint16(8, 65535, true))),
    /directory/,
  );
  await assert.rejects(
    preflightImage(
      await mutate("original.tiff", (v) => {
        const count = v.getUint16(8, true);
        v.setUint32(10 + count * 12, 8, true);
      }),
    ),
    /Cyclic/,
  );
});
test("AVIF box sizes, nested declared image planes and64-bit overflow are checked", async () => {
  await assert.rejects(
    preflightImage(await mutate("original.avif", (v) => v.setUint32(0, 0xffffffff))),
  );
  await assert.rejects(
    preflightImage(
      await mutate("original.avif", (v, b) => {
        for (let p = 4; p < b.length - 16; p++)
          if (String.fromCharCode(...b.subarray(p, p + 4)) === "ispe") {
            v.setUint32(p + 8, 0xffffffff);
            return;
          }
      }),
    ),
  );
});
test("BMP embedded JPEG/PNG and invalid pixel offsets cannot bypass the container budget", async () => {
  await assert.rejects(
    preflightImage(await mutate("original.bmp", (v) => v.setUint32(30, 4, true))),
    /BMP/,
  );
  await assert.rejects(
    preflightImage(await mutate("original.bmp", (v) => v.setUint32(10, 0xffffffff, true))),
    /BMP/,
  );
});
test("unknown and falsely labelled non-images are not admitted", async () => {
  for (const bytes of ["<html>not an image</html>", "not PNG", "GIF89a", "RIFF", "IIgarbage"])
    await assert.rejects(preflightImage(new Blob([bytes], { type: "image/png" })));
});
test("SVG scripts, external resources, entities and active markup are refused before DOM decoding", async () => {
  for (const markup of [
    "<script/>",
    '<image href="https://evil.invalid/x"/>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///x">]>',
    '<rect onclick="alert(1)"/>',
  ])
    await assert.rejects(
      preflightImage(
        new Blob([`<svg width="32" height="24">${markup}</svg>`], { type: "image/svg+xml" }),
      ),
      /SVG/,
    );
});
test("batch preflight keeps valid image order and reports mixed invalid items without decoding", async () => {
  const result = await preflightImages([
    await fixture(),
    new Blob(["bad"]),
    await fixture("original.jpg"),
  ]);
  assert.deepEqual(
    result.accepted.map((f) => f.index),
    [0, 2],
  );
  assert.deepEqual(
    result.rejected.map((f) => f.index),
    [1],
  );
});
test("batch count, aggregate bytes/pixels/header work and resident estimates are independent gates", async () => {
  const blob = await fixture();
  await assert.rejects(preflightImages(Array(251).fill(blob)), /250/);
  for (const policy of [
    { ...imagePolicy(), maxBatchBytes: 150 },
    { ...imagePolicy(), maxBatchPixels: 1000 },
    { ...imagePolicy(), maxBatchHeaders: 150 },
    { ...imagePolicy(), maxMemory: 4_203_900 },
  ])
    await assert.rejects(preflightImages([blob, blob], policy), /Batch/);
});
test("single-image decoded-memory estimates reject before allocation", async () => {
  await assert.rejects(
    preflightImage(await fixture(), { ...imagePolicy(), maxMemory: 100 }),
    /decoded-memory/,
  );
});
test("lazy recovery preserves large plain Chapters without relaxing native decode work limits", async () => {
  const blob = await fixture("page.png");
  const entries = Array.from({ length: 600 }, () => ({ blob }));
  assert.equal((await preflightRecoveryImages(entries)).length, 600);
  await assert.rejects(
    preflightRecoveryImages(entries.map((e) => ({ ...e, decode: true }))),
    /native-decode/,
  );
});
test("recovery byte/reference budgets and thumbnail planes cannot be bypassed by valid source headers", async () => {
  const blob = await fixture("page.png");
  await assert.rejects(preflightRecoveryImages(Array(4001).fill({ blob })), /4000/);
  await assert.rejects(
    preflightRecoveryImages([{ blob: await fixture("tall.png"), thumbnail: true }]),
    /dimensions/,
  );
  assert.equal((await preflightImage(blob, thumbnailPolicy())).pixels, 512 * 512);
});
test("rejected files also consume the batch metadata-work budget", async () => {
  const png = await fixture(),
    truncated = png.slice(0, png.size - 1);
  await assert.rejects(
    preflightImages([truncated, truncated], { ...imagePolicy(), maxBatchHeaders: 150 }),
    /Batch/,
  );
});
test("cancelled header/batch validation never proceeds to later assets", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(preflightImages([await fixture()], undefined, controller.signal), {
    name: "AbortError",
  });
  let reads = 0;
  const blob = await fixture();
  const slice = blob.slice.bind(blob);
  blob.slice = (...args) => {
    reads++;
    controller.abort();
    return slice(...args);
  };
  const next = new AbortController();
  blob.slice = (...args) => {
    reads++;
    next.abort();
    return slice(...args);
  };
  await assert.rejects(preflightImages([blob, blob], undefined, next.signal), {
    name: "AbortError",
  });
  assert.equal(reads, 1);
});
