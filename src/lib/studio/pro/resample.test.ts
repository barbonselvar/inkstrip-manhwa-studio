import { test } from "node:test";
import assert from "node:assert/strict";
import { resample } from "./resample.ts";
import type { Resampling } from "./geometry.ts";
const methods: Resampling[] = ["nearest", "bilinear", "bicubic", "lanczos"];
for (const method of methods) {
  test(`${method}: identity preserves exact source RGBA and returns independent storage`, () => {
    const pixels = new Uint8ClampedArray([10, 20, 30, 127, 40, 50, 60, 255]);
    const out = resample(pixels, 2, 1, 2, 1, method);
    assert.deepEqual(out, pixels);
    assert.notEqual(out.buffer, pixels.buffer);
  });
  test(`${method}: flat RGBA stays constant during upscaling and downscaling`, () => {
    const pixels = new Uint8ClampedArray(7 * 5 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([101, 77, 33, 128], i);
    for (const [w, h] of [
      [3, 2],
      [11, 9],
    ]) {
      const out = resample(pixels, 7, 5, w!, h!, method);
      for (let i = 0; i < out.length; i += 4)
        assert.deepEqual([...out.slice(i, i + 4)], [101, 77, 33, 128]);
    }
  });
}
test("nearest neighbor uses pixel centers without inventing colors", () => {
  const p = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]),
    out = resample(p, 2, 1, 4, 1, "nearest");
  assert.deepEqual([...out], [255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 128, 0, 255, 0, 128]);
});
for (const method of methods.filter((m) => m !== "nearest")) {
  test(`${method}: transparent hidden RGB cannot bleed into a visible edge`, () => {
    const out = resample(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0]), 2, 1, 7, 1, method);
    for (let i = 0; i < out.length; i += 4)
      if (out[i + 3]) {
        assert.equal(out[i], 255);
        assert.equal(out[i + 1], 0);
        assert.equal(out[i + 2], 0);
      }
    assert.ok([...out].filter((_, i) => i % 4 === 3).some((a) => a > 0 && a < 255));
  });
  test(`${method}: scale-widened kernel removes severe downsampling aliasing`, () => {
    const p = new Uint8ClampedArray(64 * 64 * 4);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++)
        p.set(
          [((x + y) % 2) * 255, ((x + y) % 2) * 255, ((x + y) % 2) * 255, 255],
          (y * 64 + x) * 4,
        );
    const out = resample(p, 64, 64, 4, 4, method);
    for (let i = 0; i < out.length; i += 4) {
      assert.ok(Math.abs(out[i]! - 127.5) < 2);
      assert.equal(out[i + 3], 255);
    }
  });
}
test("invalid dimensions, area, buffers, and filters fail before allocating output", () => {
  assert.throws(() => resample(new Uint8ClampedArray(4), 1, 1, 5000, 5000, "lanczos"));
  assert.throws(() => resample(new Uint8ClampedArray(4), 1, 1, 0, 1, "bilinear"));
  assert.throws(() => resample(new Uint8ClampedArray(3), 1, 1, 1, 1, "nearest"));
});
