import test from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer } from "./model.ts";
import { alignObjects, objectBounds } from "./precision.ts";

test("align to canvas moves one or more objects relative to the document frame", () => {
  const d = fromPanel({ id: "p", name: "p", width: 200, height: 120 });
  const a = layer("shape", 40, 20, "a"),
    b = layer("shape", 30, 30, "b");
  a.transform = { ...a.transform, x: 50, y: 10 };
  b.transform = { ...b.transform, x: 120, y: 70 };
  d.layers.push(a, b);
  const left = alignObjects(d, ["a", "b"], "left", "canvas");
  assert.equal(objectBounds(left, "a")!.x, 0);
  assert.equal(objectBounds(left, "b")!.x, 0);
  const centered = alignObjects(d, ["b"], "center-x", "canvas"),
    box = objectBounds(centered, "b")!;
  assert.equal(box.x + box.width / 2, 100);
  const bottom = alignObjects(d, ["a"], "bottom", "canvas"),
    abox = objectBounds(bottom, "a")!;
  assert.equal(abox.y + abox.height, 120);
  // Other objects are untouched.
  assert.equal(objectBounds(centered, "a")!.x, 50);
  assert.throws(() => alignObjects(d, ["a", "b", "x"], "distribute-x", "canvas"));
});
