import test from "node:test";
import assert from "node:assert/strict";
import {
  enhancementSize,
  enhancementSettingsKey,
  validateEnhanceOptions,
  DEFAULT_ENHANCE,
  ENHANCE_PRESETS,
} from "./types.ts";
import { cleanPixels, finishPixels, repairInkGaps } from "./filters.ts";

test("2× output preserves the full aspect ratio and 1× still bounds intermediate memory", () => {
  assert.deepEqual(enhancementSize(320, 800, 2), { width: 640, height: 1600 });
  assert.deepEqual(enhancementSize(320, 800, 1), { width: 320, height: 800 });
  assert.throws(() => enhancementSize(3000, 3000, 1), /limit/);
  assert.throws(() => enhancementSize(8, 5000, 2), /limit/);
  assert.throws(() => enhancementSize(0, 1, 2), /Invalid/);
  assert.deepEqual(enhancementSize(32, 48, 4), { width: 128, height: 192 });
  assert.throws(() => enhancementSize(32, 48, 3), /Invalid/);
});

test("noise cleanup preserves black lettering against a white background and alpha", () => {
  const pixels = new Uint8ClampedArray(3 * 3 * 4).fill(255);
  for (let c = 0; c < 3; c++) pixels[16 + c] = 0;
  pixels[19] = 72;
  const original = pixels.slice();
  cleanPixels(pixels, 3, 3, 40);
  assert.deepEqual(pixels, original);
});

test("cleanup reduces low-contrast noise without changing image dimensions", () => {
  const pixels = new Uint8ClampedArray(3 * 3 * 4).fill(120);
  pixels[16] = pixels[17] = pixels[18] = 130;
  cleanPixels(pixels, 3, 3, 40);
  assert.ok(pixels[16]! < 130 && pixels[16]! > 120);
  assert.equal(pixels.length, 36);
});

test("disabled finish controls are byte-exact and sharpening never changes transparency", () => {
  const pixels = Uint8ClampedArray.from({ length: 36 }, (_, i) => i * 7);
  const source = pixels.slice();
  finishPixels(pixels, 3, 3, 0, false);
  assert.deepEqual(pixels, source);
  finishPixels(pixels, 3, 3, 40, true);
  for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], source[i]);
});

test("4x uses bounded genuine passes, counts halo cores and refuses oversized output", async () => {
  const { enhancementPlan } = await import("./plan.ts");
  assert.deepEqual(enhancementPlan(128, 96, 4), { width: 512, height: 384, passes: 2, tiles: 16 });
  assert.equal(enhancementPlan(128, 96, 4, "realesrgan-anime").passes, 1);
  assert.equal(enhancementPlan(1000, 1000, 4).width, 4000);
  assert.throws(() => enhancementPlan(1080, 1920, 4), /output limit/);
  assert.throws(() => enhancementPlan(1, 2049, 4), /output limit/);
  assert.throws(() => enhancementPlan(NaN, 2, 4), /Invalid/);
  assert.equal(enhancementPlan(2000, 2000, 2).width, 4000);
});
test("untrusted enhancement settings reject before workers or image decode", () => {
  for (const change of [
    { denoise: NaN },
    { inkGaps: 1 },
    { sharpen: 41 },
    { model: "unknown" },
    { color: 1 },
    { artifacts: null },
    { scale: 3 },
  ])
    assert.throws(
      () => validateEnhanceOptions({ ...DEFAULT_ENHANCE, ...change } as never),
      /Invalid/,
    );
  for (const preset of Object.values(ENHANCE_PRESETS))
    validateEnhanceOptions({ ...DEFAULT_ENHANCE, ...preset });
  assert.equal(DEFAULT_ENHANCE.denoise, 0);
  assert.equal(DEFAULT_ENHANCE.sharpen, 0);
});
test("weights require exact bytes and SHA256; oversized streams are cancelled", async () => {
  const { verifiedModelBytes, downloadModelBytes } = await import("./model-bytes.ts");
  const { createHash } = await import("node:crypto");
  const data = new TextEncoder().encode("genuine model fixture, not AI output"),
    expected = { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  assert.deepEqual(
    new Uint8Array(await downloadModelBytes(new Response(data), expected, () => {})),
    data,
  );
  await assert.rejects(verifiedModelBytes(data.slice(1).buffer, expected), /incomplete/);
  const corrupt = data.slice();
  corrupt[0] ^= 1;
  await assert.rejects(verifiedModelBytes(corrupt.buffer, expected), /integrity/);
  let cancelled = false;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(data.length + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    downloadModelBytes(new Response(body), expected, () => {}),
    /verified size/,
  );
  assert.equal(cancelled, true);
});
test("cancelled worker replies cannot settle or clear a newer enhancement", async () => {
  const { EnhancementEngine } = await import("./client.ts");
  const original = globalThis.Worker;
  const workers: {
    onmessage: ((e: { data: object }) => void) | null;
    onerror: (() => void) | null;
    terminate(): void;
    postMessage(): void;
  }[] = [];
  class FakeWorker {
    onmessage = null;
    onerror = null;
    constructor() {
      workers.push(this);
    }
    terminate() {}
    postMessage() {}
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const engine = new EnhancementEngine(),
    blob = new Blob();
  try {
    const first = engine.run(blob, DEFAULT_ENHANCE, () => assert.fail("stale progress"));
    const old = workers[0]!;
    const rejected = assert.rejects(first, { name: "AbortError" });
    engine.dispose();
    await rejected;
    const second = engine.run(blob, DEFAULT_ENHANCE, () => {});
    old.onmessage!({ data: { type: "result", result: { blob, width: 2, height: 2 } } });
    old.onmessage!({ data: { type: "progress", progress: {} } });
    await assert.rejects(
      engine.run(blob, DEFAULT_ENHANCE, () => {}),
      /already running/,
    );
    workers[1]!.onmessage!({ data: { type: "result", result: { blob, width: 4, height: 4 } } });
    assert.equal((await second).width, 4);
  } finally {
    engine.dispose();
    globalThis.Worker = original;
  }
});

test("tiny-gap restoration repairs a known one-pixel break without inventing other ink", () => {
  const w = 13,
    h = 13,
    pixels = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let x = 2; x < 11; x++) for (let c = 0; c < 3; c++) pixels[(6 * w + x) * 4 + c] = 0;
  for (let c = 0; c < 3; c++) pixels[(6 * w + 6) * 4 + c] = 255;
  const expected = pixels.slice();
  for (let c = 0; c < 3; c++) expected[(6 * w + 6) * 4 + c] = 0;
  repairInkGaps(pixels, w, h);
  assert.deepEqual(pixels, expected);
});
test("ink restoration preserves color, transparent edges, larger holes and bad-buffer safety", () => {
  for (const variant of ["color", "alpha", "wide"]) {
    const w = 13,
      h = 13,
      pixels = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let x = 2; x < 11; x++) {
      pixels.set(variant === "color" ? [0, 20, 0, 255] : [0, 0, 0, 255], (6 * w + x) * 4);
    }
    pixels.set([255, 255, 255, variant === "alpha" ? 100 : 255], (6 * w + 6) * 4);
    if (variant === "wide") pixels.set([255, 255, 255, 255], (6 * w + 7) * 4);
    const before = pixels.slice();
    repairInkGaps(pixels, w, h);
    assert.deepEqual(pixels, before);
  }
  assert.throws(() => repairInkGaps(new Uint8ClampedArray(12), 13, 13), /buffer/);
});

test("preview guards compare effective recipes so reverting default options restores Apply", () => {
  const key = enhancementSettingsKey(DEFAULT_ENHANCE);
  assert.equal(
    enhancementSettingsKey({ ...DEFAULT_ENHANCE, model: "swin2sr", inkGaps: false }),
    key,
  );
  assert.notEqual(enhancementSettingsKey({ ...DEFAULT_ENHANCE, model: "realesrgan-anime" }), key);
  assert.notEqual(enhancementSettingsKey({ ...DEFAULT_ENHANCE, denoise: 10 }), key);
  assert.notEqual(enhancementSettingsKey({ ...DEFAULT_ENHANCE, inkGaps: true }), key);
});
