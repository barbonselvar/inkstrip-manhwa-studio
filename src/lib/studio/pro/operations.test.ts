import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, toLocalSelection, worldPoint } from "./model.ts";
import { isLocked, reorderLayer, ungroupLayers } from "./operations.ts";
const doc = () => fromPanel({ id: "p", name: "art", width: 128, height: 96 });
test("drag reorder inserts instead of swapping unrelated objects", () => {
  const d = doc(),
    a = d.layers[0]!,
    b = layer("text", 8, 8, "b"),
    c = layer("text", 8, 8, "c");
  d.layers.push(b, c);
  assert.deepEqual(
    reorderLayer(d, a.id, "c").layers.map((l) => l.id),
    ["b", "c", a.id],
  );
});
test("group locks cover descendants and neutral ungroup retains contiguous stacking", () => {
  let d = doc();
  const g = layer("group", 128, 96, "g"),
    a = layer("shape", 10, 10, "a"),
    b = layer("shape", 10, 10, "b");
  a.parentId = b.parentId = "g";
  d.layers.push(a, b, g);
  g.locked = true;
  assert.equal(isLocked(d, "a"), true);
  assert.throws(() => ungroupLayers(d, "g"));
  g.locked = false;
  g.opacity = 0.5;
  assert.throws(() => ungroupLayers(d, "g"));
  g.opacity = 1;
  d = ungroupLayers(d, "g");
  assert.deepEqual(
    d.layers.slice(-2).map((l) => l.id),
    ["a", "b"],
  );
});
test("rotated layer rectangle mask maps all four world corners accurately", () => {
  const l = layer("shape", 100, 100);
  l.transform = { x: 10, y: 20, scaleX: 2, scaleY: 0.5, rotation: 30 };
  const selection = toLocalSelection(
    {
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 30, y: 40 },
            { x: 80, y: 90 },
          ],
        },
      ],
      inverted: false,
      feather: 0,
    },
    l,
  );
  assert.equal(selection.regions[0].kind, "lasso");
  const corners = selection.regions[0].points.map((p) => worldPoint(p, l));
  assert.deepEqual(
    corners.map((p) => [Math.round(p.x), Math.round(p.y)]),
    [
      [30, 40],
      [80, 40],
      [80, 90],
      [30, 90],
    ],
  );
});
