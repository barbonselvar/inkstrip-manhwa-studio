import test from "node:test";
import assert from "node:assert/strict";
import { enhancementSize } from "./types.ts";
import { cleanPixels, finishPixels } from "./filters.ts";

test("2× output preserves the full aspect ratio and 1× still bounds intermediate memory", () => {
  assert.deepEqual(enhancementSize(320, 800, 2), { width: 640, height: 1600 });
  assert.deepEqual(enhancementSize(320, 800, 1), { width: 320, height: 800 });
  assert.throws(() => enhancementSize(3000, 3000, 1), /limit/);
  assert.throws(() => enhancementSize(8, 5000, 2), /limit/);
  assert.throws(() => enhancementSize(0, 1, 2), /Invalid/);
  assert.throws(() => enhancementSize(32, 48, 4), /Invalid/);
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
