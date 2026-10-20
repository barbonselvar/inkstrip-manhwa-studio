import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRepairColor } from "./repair.ts";

test("healing preserves sampled texture while matching target average color", () => {
  const sampled = new Uint8ClampedArray([
    100, 80, 60, 255,
    120, 100, 80, 255,
  ]);
  const target = new Uint8ClampedArray([
    20, 40, 60, 255,
    40, 60, 80, 255,
  ]);
  assert.deepEqual([...matchRepairColor(sampled, target)], [20, 40, 60, 255, 40, 60, 80, 255]);
  assert.deepEqual([...sampled], [100, 80, 60, 255, 120, 100, 80, 255]);
});

test("transparent donor pixels stay transparent and do not bias the color estimate", () => {
  const sampled = new Uint8ClampedArray([200, 0, 0, 255, 255, 255, 255, 0]);
  const target = new Uint8ClampedArray([100, 20, 40, 255, 0, 0, 0, 0]);
  assert.deepEqual([...matchRepairColor(sampled, target)], [100, 20, 40, 255, 255, 255, 255, 0]);
});

test("healing rejects mismatched pixel buffers", () => {
  assert.throws(() => matchRepairColor(new Uint8ClampedArray(4), new Uint8ClampedArray(8)));
});
