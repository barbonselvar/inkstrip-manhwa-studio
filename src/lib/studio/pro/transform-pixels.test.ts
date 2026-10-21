import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleRgba, projectPixels, sampleDocument } from "./transform-pixels.ts";
import { TRANSFORM } from "./model.ts";
import { MESH, QUAD } from "./transform.ts";
const pixels = (w: number, h: number) => {
  const p = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) p.set([x * 10, y * 10, 80, 255], (y * w + x) * 4);
  return p;
};
test("premultiplied bilinear sampling preserves transparent edges without hidden-color fringes", () => {
  const p = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0]),
    out = new Uint8ClampedArray(4);
  sampleRgba(p, 2, 1, 0.5, 0, out, 0);
  assert.deepEqual([...out], [255, 0, 0, 128]);
  sampleRgba(p, 2, 1, -0.5, 0, out, 0);
  assert.deepEqual([...out], [255, 0, 0, 128]);
});
for (const kind of ["perspective", "warp"] as const)
  test(`${kind}: identity deformation is exact native RGBA, with no seam or doubled alpha`, () => {
    const p = pixels(8, 8),
      t = {
        ...TRANSFORM,
        deform: { kind, width: 8, height: 8, points: kind === "warp" ? MESH : QUAD },
      };
    assert.deepEqual(projectPixels(p, 8, 8, t, 8, 8), p);
    assert.deepEqual(sampleDocument(p, 8, 8, t, 8, 8), p);
  });
test("projective export samples an analytic trapezoid and retains transparent outer pixels", () => {
  const t = {
      ...TRANSFORM,
      deform: {
        kind: "perspective" as const,
        width: 8,
        height: 8,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.75, y: 1 },
          { x: 0.25, y: 1 },
        ],
      },
    },
    p = projectPixels(pixels(8, 8), 8, 8, t, 8, 8);
  assert.equal(p[7 * 8 * 4 + 3], 0);
  // Inverse y = v/(2-v) for this trapezoid; output center is (4.5,4.5).
  const u = 4.5 / 8,
    v = 4.5 / 8,
    sy = v / (2 - v),
    sx = (u - (0.5 * sy) / (1 + sy)) * (1 + sy),
    i = (4 * 8 + 4) * 4;
  assert.ok(Math.abs(p[i]! - (sx * 8 - 0.5) * 10) <= 1);
  assert.ok(Math.abs(p[i + 1]! - (sy * 8 - 0.5) * 10) <= 1);
  assert.equal(p[i + 3], 255);
});
test("Bézier warp moves real source pixels by its smooth inverse rather than drawing a mesh alone", () => {
  const t = {
      ...TRANSFORM,
      deform: {
        kind: "warp" as const,
        width: 16,
        height: 16,
        points: MESH.map((p, i) => ({ ...p, x: p.x + (i === 4 ? 0.1 : 0) })),
      },
    },
    p = pixels(16, 16),
    out = projectPixels(p, 16, 16, t, 16, 16);
  assert.notDeepEqual(out, p);
  assert.ok(out[(8 * 16 + 8) * 4]! < p[(8 * 16 + 8) * 4]!);
  assert.equal(out[(8 * 16 + 8) * 4 + 3], 255);
});
test("document selections and sampled textures pull into the identical deformed local coordinates", () => {
  const t = {
      ...TRANSFORM,
      deform: {
        kind: "warp" as const,
        width: 16,
        height: 16,
        points: MESH.map((p, i) => ({ ...p, x: p.x + (i === 4 ? 0.1 : 0) })),
      },
    },
    p = pixels(16, 16),
    out = sampleDocument(p, 16, 16, t, 16, 16);
  assert.ok(out[(8 * 16 + 8) * 4]! > p[(8 * 16 + 8) * 4]!);
});

test("projective minification removes checkerboard aliasing at 32:1 without alpha contamination", () => {
  const size = 256,
    p = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = (x + y) % 2 ? 255 : 0;
      p.set([v, v, v, 255], (y * size + x) * 4);
    }
  const t = {
      ...TRANSFORM,
      scaleX: 1 / 32,
      scaleY: 1 / 32,
      deform: {
        kind: "perspective" as const,
        width: size,
        height: size,
        points: QUAD.map((q, i) => ({ ...q, x: q.x + (i === 2 ? -0.08 : 0) })),
      },
    },
    out = projectPixels(p, size, size, t, 8, 8);
  for (let y = 1; y < 7; y++)
    for (let x = 1; x < 6; x++) {
      const i = (y * 8 + x) * 4;
      assert.ok(Math.abs(out[i]! - 128) <= 2, `${x},${y}: ${out[i]}`);
      assert.equal(out[i + 3], 255);
    }
});
test("projective downscaling averages alpha in premultiplied space and ignores invisible blue", () => {
  const p = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) p.set(i % 2 ? [255, 0, 0, 255] : [0, 0, 255, 0], i * 4);
  const out = projectPixels(p, 64, 64, { ...TRANSFORM, scaleX: 1 / 8, scaleY: 1 / 8 }, 8, 8);
  assert.deepEqual([...out.slice((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 4)], [255, 0, 0, 128]);
});
test("highly anisotropic minification handles odd source dimensions and output origins", () => {
  const p = new Uint8ClampedArray(255 * 9 * 4);
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 255; x++) p.set([x % 2 ? 255 : 0, y * 20, 0, 255], (y * 255 + x) * 4);
  const t = { ...TRANSFORM, scaleX: 1 / 30, scaleY: 1, x: 10, y: 20 },
    full = projectPixels(p, 255, 9, t, 30, 40),
    cropped = projectPixels(p, 255, 9, t, 9, 9, 1, { x: 10, y: 20 });
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 9; x++)
      for (let c = 0; c < 4; c++)
        assert.equal(cropped[(y * 9 + x) * 4 + c], full[((y + 20) * 30 + x + 10) * 4 + c]);
  assert.ok(Math.abs(cropped[(4 * 9 + 4) * 4]! - 128) < 3);
});
