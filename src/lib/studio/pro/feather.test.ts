import { test } from "node:test";
import assert from "node:assert/strict";
import { featherAlpha, gaussianBoxes, supportsCanvasFilter } from "./feather.ts";

/** Exact Gaussian of a 1-D step edge with edge extension, for reference. */
function gaussianStep(width: number, edge: number, sigma: number) {
  const radius = Math.ceil(sigma * 4),
    kernel = Array.from({ length: radius * 2 + 1 }, (_, i) =>
      Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)),
    ),
    total = kernel.reduce((a, b) => a + b, 0);
  return Array.from({ length: width }, (_, x) => {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const px = Math.min(width - 1, Math.max(0, x + k));
      sum += (px < edge ? 255 : 0) * kernel[k + radius]!;
    }
    return sum / total;
  });
}

test("filter support is detected from the context, not the user agent", () => {
  assert.equal(supportsCanvasFilter({ filter: "none" }), true);
  assert.equal(supportsCanvasFilter({}), false);
});

test("box widths reproduce the requested Gaussian variance", () => {
  for (const sigma of [0.8, 2, 5, 12.5, 40]) {
    const boxes = gaussianBoxes(sigma);
    assert.equal(boxes.length, 3);
    for (const size of boxes) assert.equal(size % 2, 1);
    const variance = boxes.reduce((sum, w) => sum + (w * w - 1) / 12, 0);
    assert.ok(Math.abs(Math.sqrt(variance) - sigma) / sigma < 0.12, `sigma ${sigma}`);
  }
});

test("zero feather returns the coverage unchanged", () => {
  const alpha = Uint8ClampedArray.from([0, 10, 200, 255]);
  assert.deepEqual(featherAlpha(alpha, 2, 2, 0), alpha);
});

test("selections touching the document edge stay fully selected there", () => {
  const w = 40,
    h = 30,
    all = new Uint8ClampedArray(w * h).fill(255);
  assert.ok(featherAlpha(all, w, h, 6).every((v) => v === 255));
});

test("a feathered edge tracks a true Gaussian closely", () => {
  const w = 420,
    h = 3,
    edge = 210,
    alpha = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < edge; x++) alpha[y * w + x] = 255;
  for (const sigma of [0.5, 1, 2, 4, 6, 15, 40]) {
    const result = featherAlpha(alpha, w, h, sigma),
      reference = gaussianStep(w, edge, sigma);
    let worst = 0;
    for (let x = 0; x < w; x++) worst = Math.max(worst, Math.abs(result[x]! - reference[x]!));
    // Exact kernel up to sigma 4, three box passes above; both stay within a few 8-bit levels.
    assert.ok(worst <= 4, `sigma ${sigma}: max deviation ${worst}`);
    assert.ok(Math.abs(result[edge]! + result[edge - 1]! - 255) <= 3, "edge is centred");
    assert.equal(result[0], 255);
    assert.equal(result[w - 1], 0);
    for (let y = 1; y < h; y++)
      assert.deepEqual(result.slice(y * w, y * w + w), result.slice(0, w), "rows are identical");
  }
});

test("interior coverage keeps its total within rounding", () => {
  const w = 64,
    h = 64,
    alpha = new Uint8ClampedArray(w * h);
  for (let y = 24; y < 40; y++) for (let x = 20; x < 44; x++) alpha[y * w + x] = 255;
  const before = alpha.reduce((a, b) => a + b, 0),
    after = featherAlpha(alpha, w, h, 3).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(after - before) / before < 0.01);
});
