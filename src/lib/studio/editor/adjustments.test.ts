import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAdjustments,
  blurPixels,
  NEUTRAL,
  adjustmentHalo,
  type Adjustments,
} from "./adjustments.ts";
import { blendSelection, rasterizeMask, validateStrokes, type MaskStroke } from "./mask.ts";
import { defaultRecipe, layoutPlacement, sourceToOutput, validateRecipe } from "./geometry.ts";
const stroke = (patch: Partial<MaskStroke> = {}): MaskStroke => ({
  mode: "add",
  size: 20,
  hardness: 1,
  opacity: 1,
  points: [{ x: 0.25, y: 0.25 }],
  ...patch,
});
const apply = (pixel: number[], values: Partial<Adjustments>) => [
  ...applyAdjustments(new Uint8ClampedArray(pixel), 1, 1, { ...NEUTRAL, ...values }),
];
test("neutral adjustments are byte-exact, including partial alpha and invisible RGB", () => {
  const data = new Uint8ClampedArray([40, 80, 120, 255, 80, 90, 100, 80, 123, 45, 67, 0]);
  assert.deepEqual(applyAdjustments(data, 3, 1, { ...NEUTRAL }), data);
});
test("brightness, exposure, saturation and temperature change actual RGB without changing alpha", () => {
  assert.deepEqual(apply([40, 80, 120, 128], { brightness: 10 }), [66, 106, 146, 128]);
  assert.deepEqual(apply([40, 80, 120, 128], { exposure: 1 }), [80, 160, 240, 128]);
  assert.deepEqual(apply([40, 80, 120, 255], { saturation: -100 }), [74, 74, 74, 255]);
  assert.deepEqual(apply([40, 80, 120, 255], { temperature: 100 }), [70, 80, 90, 255]);
  assert.ok(apply([220, 220, 220, 255], { contrast: 30 })[0]! > 220);
});
test("alpha-weighted blur avoids dark fringes and retains the alpha channel", () => {
  const data = new Uint8ClampedArray([200, 80, 40, 255, 0, 0, 0, 0, 200, 80, 40, 128]);
  const output = blurPixels(data, 3, 1, 1);
  assert.deepEqual([...output], [200, 80, 40, 255, 0, 0, 0, 0, 200, 80, 40, 128]);
});
test("noise cleanup reduces flat-region variance while preserving hard ink edges", () => {
  const data = new Uint8ClampedArray(9 * 4);
  for (let x = 0; x < 9; x++) {
    data.set(
      [
        x < 2 ? 0 : x % 2 ? 108 : 100,
        x < 2 ? 0 : x % 2 ? 108 : 100,
        x < 2 ? 0 : x % 2 ? 108 : 100,
        255,
      ],
      x * 4,
    );
  }
  const out = applyAdjustments(data, 9, 1, { ...NEUTRAL, noise: 100 });
  assert.equal(out[4], 0);
  assert.ok(Math.abs(out[4 * 4]! - out[5 * 4]!) < 8);
});
test("sharpening affects edges but preserves transparent pixels and alpha", () => {
  const pixels = new Uint8ClampedArray([
    100, 100, 100, 255, 120, 120, 120, 128, 100, 100, 100, 255,
  ]);
  const out = applyAdjustments(pixels, 3, 1, { ...NEUTRAL, sharpen: 100 });
  assert.ok(out[4]! > 120);
  assert.equal(out[7], 128);
});
test("soft capsule brush is continuous and opacity does not depend on point density", () => {
  const line = stroke({
    size: 12,
    hardness: 0.5,
    opacity: 0.6,
    points: [
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ],
  });
  const mask = rasterizeMask([line], 100, 100, 100, 100);
  assert.ok(Math.abs(mask[50 * 100 + 50]! - 0.6) < 1e-6);
  assert.equal(mask[10 * 100 + 50], 0);
  const repeated = rasterizeMask(
    [{ ...line, points: [line.points[0]!, line.points[0]!, line.points[1]!] }],
    100,
    100,
    100,
    100,
  );
  assert.deepEqual(repeated, mask);
  assert.ok(mask[54 * 100 + 50]! > 0 && mask[54 * 100 + 50]! < 0.6);
});
test("erase removes selection only; zero-mask pixels and all alpha remain byte-exact", () => {
  const mask = rasterizeMask([stroke(), stroke({ mode: "subtract", size: 6 })], 100, 100, 100, 100);
  assert.equal(mask[25 * 100 + 25], 0);
  assert.equal(mask[25 * 100 + 32], 1);
  const base = new Uint8ClampedArray(40000).fill(90),
    changed = base.map((v, i) => (i % 4 === 3 ? v : 220));
  const out = blendSelection(base, changed, mask);
  assert.equal(out[(25 * 100 + 25) * 4], 90);
  assert.equal(out[(25 * 100 + 32) * 4], 220);
  for (let p = 0; p < 10000; p++) {
    assert.equal(out[p * 4 + 3], 90);
    if (!mask[p]) assert.deepEqual(out.slice(p * 4, p * 4 + 4), base.slice(p * 4, p * 4 + 4));
  }
});
test("mask affine mapping follows rotation, crop, flips and nonuniform output scaling", () => {
  const recipe = { ...defaultRecipe(100, 100), rotation: 90, width: 200, height: 100, flipY: true };
  const m = sourceToOutput(recipe);
  const p = { x: m.a * 25 + m.c * 25 + m.e, y: m.b * 25 + m.d * 25 + m.f };
  const mask = rasterizeMask([stroke()], 200, 100, 100, 100, 0, 0, 1, 1, m);
  assert.equal(mask[Math.floor(p.y) * 200 + Math.floor(p.x)], 1);
  assert.equal(mask[80 * 200 + 160], 0);
});
test("layout alignment keeps rotated artwork inside the output frame", () => {
  const recipe = { ...defaultRecipe(120, 80), rotation: 33, layout: { scale: 60, x: 1, y: -1 } };
  const m = sourceToOutput(recipe);
  for (const x of [0, 120])
    for (const y of [0, 80]) {
      const px = m.a * x + m.c * y + m.e,
        py = m.b * x + m.d * y + m.f;
      assert.ok(px >= -1e-7 && px <= 120 + 1e-7);
      assert.ok(py >= -1e-7 && py <= 80 + 1e-7);
    }
  assert.deepEqual(layoutPlacement(100, 80, { scale: 50, x: 1, y: -1 }), {
    scale: 0.5,
    x: 25,
    y: -20,
  });
});
test("legacy recipes remain valid and new fields reject invalid values and unbounded masks", () => {
  const r = defaultRecipe(100, 100);
  assert.doesNotThrow(() => validateRecipe(r, 100, 100));
  assert.throws(
    () => validateRecipe({ ...r, adjustments: { ...NEUTRAL, exposure: NaN } }, 100, 100),
    /exposure/,
  );
  assert.throws(
    () => validateRecipe({ ...r, layout: { scale: 101, x: 0, y: 0 } }, 100, 100),
    /layout/,
  );
  assert.throws(() => validateStrokes([stroke({ points: [{ x: 2, y: 0 }] })]), /inside/);
  assert.throws(() => validateStrokes(Array.from({ length: 129 }, () => stroke())), /complex/);
});
test("halo tiles match whole-frame filters and ordered masks at processing boundaries", () => {
  const width = 41,
    height = 29,
    data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++)
    data.set([(p * 13) % 220, (p * 7) % 220, (p * 3) % 220, p % 7 ? 255 : 100], p * 4);
  const global = { ...NEUTRAL, noise: 20, blur: 2, sharpen: 40, temperature: 5 },
    local = { ...NEUTRAL, blur: 1, exposure: 0.2 };
  const strokes = [
    stroke({
      size: 25,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
    }),
    stroke({ mode: "subtract", size: 10, hardness: 0.5, points: [{ x: 0.5, y: 0.5 }] }),
  ];
  const base = applyAdjustments(data, width, height, global),
    whole = blendSelection(
      base,
      applyAdjustments(base, width, height, local),
      rasterizeMask(strokes, width, height, width, height),
    );
  const halo = adjustmentHalo(global) + adjustmentHalo(local),
    tile = 8;
  for (let y = 0; y < height; y += tile)
    for (let x = 0; x < width; x += tile) {
      const left = Math.max(0, x - halo),
        top = Math.max(0, y - halo),
        right = Math.min(width, x + tile + halo),
        bottom = Math.min(height, y + tile + halo),
        w = right - left,
        h = bottom - top;
      const input = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j++)
        input.set(
          data.slice(((top + j) * width + left) * 4, ((top + j) * width + right) * 4),
          j * w * 4,
        );
      const first = applyAdjustments(input, w, h, global),
        out = blendSelection(
          first,
          applyAdjustments(first, w, h, local),
          rasterizeMask(strokes, w, h, width, height, left, top, 1, 1),
        );
      for (let j = y; j < Math.min(y + tile, height); j++)
        for (let i = x; i < Math.min(x + tile, width); i++)
          for (let c = 0; c < 4; c++)
            assert.ok(
              Math.abs(
                out[((j - top) * w + i - left) * 4 + c]! - whole[(j * width + i) * 4 + c]!,
              ) <= 1,
              `seam at ${i},${j},${c}`,
            );
    }
});
