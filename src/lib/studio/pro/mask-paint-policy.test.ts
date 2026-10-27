import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maskPaintSize,
  validateMaskPaintWork,
  validateMaskPaintSelection,
} from "./mask-paint-policy.ts";
import type { Stroke } from "./model.ts";
const stroke: Stroke = {
  flow: 1,
  erase: false,
  size: 32,
  hardness: 0.8,
  opacity: 0.5,
  color: "#ffffff",
  points: [
    { x: 1, y: 2 },
    { x: 100, y: 2 },
  ],
};
test("mask painting retains native dimensions and refuses over-budget planes", () => {
  assert.deepEqual(maskPaintSize(128, 96), { width: 128, height: 96 });
  assert.deepEqual(maskPaintSize(2000, 2000), { width: 2000, height: 2000 });
  for (const [w, h] of [
    [2001, 2000],
    [20000, 1],
    [NaN, 1],
    [Infinity, 1],
    [0, 20],
  ])
    assert.throws(() => maskPaintSize(w!, h!));
});
test("mask brush rejects invalid parameters and bounded repeated work", () => {
  validateMaskPaintWork([stroke], 128 * 96);
  for (const p of [
    { size: 513 },
    { size: NaN },
    { opacity: -1 },
    { hardness: 1.1 },
    { points: [] },
    { points: [{ x: Infinity, y: 0 }] },
  ])
    assert.throws(() => validateMaskPaintWork([{ ...stroke, ...p }]));
  assert.throws(() => validateMaskPaintWork(Array(51).fill(stroke)));
  assert.throws(() =>
    validateMaskPaintWork([
      {
        ...stroke,
        size: 512,
        points: [
          { x: 0, y: 0 },
          { x: 100000, y: 0 },
        ],
      },
    ]),
  );
});
test("captured selections cannot allocate an unbounded mask plane", () => {
  validateMaskPaintSelection({ regions: [], inverted: true, feather: 0 }, 4_000_000);
  assert.throws(() =>
    validateMaskPaintSelection(
      {
        regions: [],
        inverted: true,
        feather: 0,
        frame: {
          width: 4000,
          height: 4000,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        },
      } as never,
      4_000_000,
    ),
  );
});
