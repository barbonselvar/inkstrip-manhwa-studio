import { test } from "node:test";
import assert from "node:assert/strict";
import { selectionBox, validateSelection, type Selection } from "./selection.ts";
import { textureRepair } from "./texture.ts";
const stroke: Selection = {
  tool: "ellipse",
  mode: "add",
  size: 4,
  feather: 0,
  points: [
    { x: 0.4, y: 0.4 },
    { x: 0.6, y: 0.6 },
  ],
};
test("selection bounds retain curved tools, reject malformed coordinates", () => {
  assert.ok(selectionBox([stroke]).left < 0.4);
  assert.throws(() => validateSelection([{ ...stroke, points: [{ x: NaN, y: 0 }] }]));
  assert.throws(() => selectionBox([{ ...stroke, mode: "subtract" }]));
});
test("texture repair reconstructs selected pixels from known context and keeps outside exact", () => {
  const size = 32,
    base = new Uint8ClampedArray(size * size * 4),
    mask = base.slice();
  for (let p = 0; p < size * size; p++) {
    base.set([70, 120, 180, 255], p * 4);
    if (p % size > 10 && p % size < 20 && Math.floor(p / size) > 10 && Math.floor(p / size) < 20) {
      base.set([255, 0, 0, 255], p * 4);
      mask[p * 4 + 3] = 255;
    }
  }
  const output = textureRepair(base, mask, size, size);
  for (let p = 0; p < size * size; p++)
    assert.deepEqual(Array.from(output.slice(p * 4, p * 4 + 4)), [70, 120, 180, 255]);
  assert.throws(() =>
    textureRepair(base, new Uint8ClampedArray(base.length).fill(255), size, size),
  );
});
