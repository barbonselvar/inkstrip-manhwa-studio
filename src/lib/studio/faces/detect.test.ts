import { test } from "node:test";
import assert from "node:assert/strict";
import { equalize, integral, groupFaces, overlap, scanCascade } from "./detect.ts";
test("integral/equalization preserve ordering and constant images cannot produce fabricated faces", () => {
  assert.deepEqual(
    Array.from(integral(new Uint8Array([1, 2, 3, 4]), 2, 2)),
    [0, 0, 0, 0, 1, 3, 0, 4, 10],
  );
  assert.deepEqual(Array.from(equalize(new Uint8Array([10, 20, 30]))), [0, 128, 255]);
  const model = {
    features: [[0, 0, 8, 8]],
    stages: [
      {
        threshold: 2,
        trees: [{ nodes: [0, -1, 0, -1, -1, -1, -1, -1, -1, -1, -1], leaves: [1, -1] }],
      },
    ],
  };
  assert.deepEqual(scanCascade(new Uint8Array(24 * 24), 24, 24, model), []);
});
test("grouping needs repeated detections and keeps separate characters separate", () => {
  const a = { x: 20, y: 20, width: 24, height: 24, neighbors: 1 };
  const b = { ...a, x: 100 };
  const groups = groupFaces([
    a,
    { ...a, x: 21 },
    { ...a, y: 21 },
    b,
    { ...b, x: 101 },
    { ...b, y: 21 },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groupFaces([a]).length, 0);
  assert.equal(overlap(a, b), 0);
});
