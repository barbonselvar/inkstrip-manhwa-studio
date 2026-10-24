import test from "node:test";
import assert from "node:assert/strict";
import { rasterSize, validateNativeImages, validateRasterInput } from "./native-images.ts";
import { fromPanel, type ProSession } from "./model.ts";
const png = (width = 32, height = 24) => {
  const bytes = new Uint8Array(24),
    view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: "image/png" });
};
const session = (blob: Blob): ProSession => ({
  document: fromPanel({ id: "panel", name: "Original", width: 32, height: 24 }),
  assets: { source: blob },
  revision: 1,
  acceptedBlobId: "accepted",
  updatedAt: 0,
});
test("standalone Raster preflight accepts supported header dimensions and the exact device boundary", async () => {
  assert.deepEqual(await validateRasterInput(png(2048, 2048), 2048 * 2048), {
    width: 2048,
    height: 2048,
  });
  const jpeg = Uint8Array.from([255, 216, 255, 192, 0, 7, 8, 0, 24, 0, 32]);
  assert.deepEqual(await validateRasterInput(new Blob([jpeg], { type: "image/jpeg" }), 32 * 24), {
    width: 32,
    height: 24,
  });
});
test("standalone Raster preflight rejects oversized pixels, long sides and invalid budgets without decoding", async () => {
  for (const blob of [png(65535, 65535), png(16385, 1), png(2049, 2048), png(0, 1)])
    await assert.rejects(validateRasterInput(blob, 2048 * 2048), /pixel budget/);
  for (const limit of [NaN, Infinity, 0, 16_777_217])
    await assert.rejects(validateRasterInput(png(), limit), /pixel budget/);
});
test("standalone Raster preflight rejects corrupt, unsupported and excessive compressed files before reading headers", async () => {
  for (const type of ["image/png", "image/jpeg", "image/webp", "image/svg+xml"])
    await assert.rejects(validateRasterInput(new Blob(["bad"], { type }), 4e6), /header/);
  // Avoid allocating48MB: the guard must reject size before reading any payload.
  const oversized = new Blob([], { type: "image/png" });
  Object.defineProperty(oversized, "size", { value: 48_000_001 });
  oversized.slice = () => {
    throw Error("must not read oversized bytes");
  };
  await assert.rejects(validateRasterInput(oversized, 4e6), /asset budget/);
});
test("native preflight rejects corrupt PNG, JPEG, WebP headers before image decoding", async () => {
  let decodes = 0;
  const decoder = (async () => {
    decodes++;
    throw Error("must not decode");
  }) as typeof createImageBitmap;
  for (const type of ["image/png", "image/jpeg", "image/webp"])
    await assert.rejects(
      validateNativeImages(session(new Blob(["bad"], { type })), 4e6, decoder),
      /header/,
    );
  assert.equal(decodes, 0);
});
test("native preflight bounds actual PNG dimensions before allocation regardless of document metadata", async () => {
  let decodes = 0;
  const decoder = (async () => {
    decodes++;
    throw Error("must not decode");
  }) as typeof createImageBitmap;
  for (const blob of [png(65535, 65535), png(0, 2), png(3000, 3000)])
    await assert.rejects(validateNativeImages(session(blob), 4e6, decoder), /pixel budget/);
  assert.equal(decodes, 0);
});
test("native decode failure leaves input untouched and closes successful images sequentially", async () => {
  const s = session(png()),
    before = structuredClone(s.document);
  let closed = 0;
  await validateNativeImages(s, 4e6, (async () => ({
    width: 32,
    height: 24,
    close() {
      closed++;
    },
  })) as typeof createImageBitmap);
  assert.equal(closed, 1);
  await assert.rejects(
    validateNativeImages(s, 4e6, (async () => ({
      width: 2,
      height: 2,
      close() {
        closed++;
      },
    })) as typeof createImageBitmap),
    /decoded/,
  );
  assert.equal(closed, 2);
  await assert.rejects(
    validateNativeImages(s, 4e6, (async () => {
      throw Error("truncated");
    }) as typeof createImageBitmap),
    /decoded/,
  );
  assert.deepEqual(s.document, before);
  assert.deepEqual(Object.keys(s.assets), ["source"]);
});
test("native header parser recognizes JPEG SOF and lossless, lossy, extended WebP dimensions", async () => {
  const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 4, 1, 2, 255, 192, 0, 7, 8, 0, 24, 0, 32]);
  assert.deepEqual(await rasterSize(new Blob([jpeg], { type: "image/jpeg" })), {
    width: 32,
    height: 24,
  });
  for (const kind of ["VP8 ", "VP8L", "VP8X"]) {
    const b = new Uint8Array(30),
      str = (at: number, s: string) =>
        b.set(
          [...s].map((c) => c.charCodeAt(0)),
          at,
        );
    str(0, "RIFF");
    str(8, "WEBP");
    str(12, kind);
    if (kind === "VP8 ") {
      b.set([157, 1, 42], 23);
      b[26] = 32;
      b[28] = 24;
    }
    if (kind === "VP8L") {
      b[20] = 47;
      b[21] = 31;
      b[22] = 192;
      b[23] = 5;
    }
    if (kind === "VP8X") {
      b[24] = 31;
      b[27] = 23;
    }
    assert.deepEqual(await rasterSize(new Blob([b], { type: "image/webp" })), {
      width: 32,
      height: 24,
    });
  }
});

test("native preflight accepts EXIF-oriented JPEG axis swaps without relaxing the pixel budget", async () => {
  const jpeg = Uint8Array.from([255, 216, 255, 192, 0, 7, 8, 0, 24, 0, 32]);
  let closed = 0;
  await validateNativeImages(session(new Blob([jpeg], { type: "image/jpeg" })), 4e6, (async () => ({
    width: 24,
    height: 32,
    close() {
      closed++;
    },
  })) as typeof createImageBitmap);
  assert.equal(closed, 1);
  await assert.rejects(
    validateNativeImages(session(new Blob([jpeg], { type: "image/jpeg" })), 4e6, (async () => ({
      width: 240,
      height: 320,
      close() {
        closed++;
      },
    })) as typeof createImageBitmap),
    /decoded/,
  );
});
