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
