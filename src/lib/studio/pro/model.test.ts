import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fromPanel,
  layer,
  validateDocument,
  localPoint,
  worldPoint,
  pathData,
  moveLayer,
  removeLayer,
  validateAssets,
} from "./model.ts";
const doc = () => fromPanel({ id: "legacy", name: "Original", width: 128, height: 96 });
test("legacy accepted image becomes an independent versioned document without mutating a panel", () => {
  const panel = { id: "legacy", name: "Original", width: 128, height: 96 };
  const d = fromPanel(panel);
  validateDocument(d);
  assert.deepEqual(panel, { id: "legacy", name: "Original", width: 128, height: 96 });
  assert.equal(d.layers[0]!.assetId, "source");
  assert.equal(d.version, 1);
});
test("inverse pointer mapping preserves coordinates under rotation and nonuniform scale", () => {
  const l = layer("shape", 40, 20);
  l.transform = { x: 50, y: -20, rotation: 43, scaleX: 1.5, scaleY: 0.6 };
  const p = { x: 25, y: 7 },
    q = localPoint(worldPoint(p, l), l);
  assert.ok(Math.abs(p.x - q.x) < 1e-10 && Math.abs(p.y - q.y) < 1e-10);
});
test("layer ordering respects sibling groups and deletion removes descendants", () => {
  let d = doc();
  const a = layer("group", 128, 96, "g"),
    b = layer("text", 30, 20, "b");
  b.parentId = "g";
  d.layers.push(a, b);
  validateDocument(d);
  d = moveLayer(d, "g", -1);
  assert.equal(d.layers[0]!.id, "g");
  assert.equal(removeLayer(d, "g").layers.length, 1);
});
test("cubic path data retains handles and closure", () => {
  const l = layer("shape", 80, 80);
  l.anchors = [
    { x: 0, y: 0, outgoing: { x: 20, y: 0 } },
    { x: 60, y: 40, incoming: { x: 40, y: 50 } },
  ];
  assert.match(pathData(l), /C20 0 40 50 60 40/);
  l.closed = true;
  assert.match(pathData(l), / Z$/);
});
test("invalid geometry, group cycles, executable vector content and missing assets are rejected", () => {
  let d = doc();
  d.layers[0]!.transform.scaleX = Infinity;
  assert.throws(() => validateDocument(d));
  d = doc();
  const g = layer("group", 128, 96, "g");
  g.parentId = "g";
  d.layers.push(g);
  assert.throws(() => validateDocument(d));
  d = doc();
  d.layers[0]!.pathData = "<script>alert(1)</script>";
  assert.throws(() => validateDocument(d));
  assert.throws(() =>
    validateAssets({
      document: doc(),
      assets: {},
      revision: 0,
      acceptedBlobId: "old",
      updatedAt: 0,
    }),
  );
});
