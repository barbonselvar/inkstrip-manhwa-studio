import test from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer } from "./model.ts";
import { thumbnailDocument, thumbnailKeys, maskThumbnailScale } from "./thumbnails.ts";
const fixture = () => {
  const d = fromPanel({ id: "p", name: "Thumbs", width: 128, height: 96 });
  const a = layer("shape", 24, 24, "a"),
    b = layer("shape", 24, 24, "b"),
    g = layer("group", 128, 96, "g");
  a.parentId = g.id;
  d.layers = [g, a, b];
  return d;
};
const keys = (d: ReturnType<typeof fixture>) => thumbnailKeys(d, {}, () => 1);
test("thumbnail isolation retains children and normalizes only the root compositing context", () => {
  const d = fixture();
  d.layers[0]!.visible = false;
  d.layers[0]!.opacity = 0.2;
  const isolated = thumbnailDocument(d, "g");
  assert.equal(isolated.background, "transparent");
  assert.deepEqual(
    isolated.layers.map((l) => l.id),
    ["g", "a"],
  );
  assert.equal(isolated.layers[0]!.visible, true);
  assert.equal(isolated.layers[0]!.opacity, 1);
  assert.equal(d.layers[0]!.visible, false);
});
test("name, locks, selection and root visibility/opacity/blend do not recompose an unchanged thumbnail", () => {
  const d = fixture(),
    before = keys(d);
  const copy = structuredClone(d);
  for (const l of copy.layers) {
    l.name += " renamed";
    l.locked = true;
  }
  copy.layers[2]!.visible = false;
  copy.layers[2]!.opacity = 0.3;
  copy.layers[2]!.blend = "screen";
  copy.selection = { regions: [], inverted: true, feather: 0 };
  assert.deepEqual(keys(copy), before);
});
test("descendant content, visibility, masks and transforms invalidate its ancestors but not unrelated roots", () => {
  for (const property of ["fill", "visibility", "mask", "transform"]) {
    const d = fixture(),
      before = keys(d),
      a = d.layers[1]!;
    if (property === "fill") a.fill = "#ff0000";
    if (property === "visibility") a.visible = false;
    if (property === "transform") a.transform.rotation = 30;
    if (property === "mask")
      a.mask = {
        enabled: true,
        strokes: [],
        selection: { regions: [], inverted: false, feather: 2 },
      };
    const after = keys(d);
    assert.notEqual(after.get("g"), before.get("g"), property);
    assert.equal(after.get("b"), before.get("b"), property);
    if (property !== "visibility") assert.notEqual(after.get("a"), before.get("a"), property);
  }
});
test("immutable asset identity changes invalidate the dependent raster and parent only", () => {
  const d = fixture(),
    tokens = new WeakMap<Blob, number>();
  let serial = 0;
  d.layers[1]!.kind = "raster";
  d.layers[1]!.assetId = "source";
  const token = (b: Blob) => {
    if (!tokens.has(b)) tokens.set(b, ++serial);
    return tokens.get(b)!;
  };
  const before = thumbnailKeys(d, { source: new Blob(["original"]) }, token);
  const after = thumbnailKeys(d, { source: new Blob(["replacement"]) }, token);
  assert.notEqual(after.get("g"), before.get("g"));
  assert.notEqual(after.get("a"), before.get("a"));
  assert.equal(after.get("b"), before.get("b"));
});
test("root reordering keeps exact thumbnail keys; canvas size and thumbnail scale invalidate them", () => {
  const d = fixture(),
    before = keys(d);
  d.layers = [d.layers[2]!, d.layers[0]!, d.layers[1]!];
  for (const [id, key] of before) assert.equal(keys(d).get(id), key);
  d.width++;
  for (const [id, key] of before) assert.notEqual(keys(d).get(id), key);
});
test("large exact keys miss instead of retaining unbounded strings or using collision-prone hashes", () => {
  const d = fixture();
  d.layers[2]!.text = "x".repeat(40000);
  assert.equal(keys(d).get("b"), undefined);
  assert.ok(keys(d).get("a"));
});
test("mask thumbnail budgets account for independent large mask planes on a tiny layer", () => {
  const l = layer("shape", 1, 1, "tiny");
  l.mask = {
    enabled: true,
    width: 4096,
    height: 4096,
    strokes: [],
    selection: { regions: [], inverted: true, feather: 0 },
  };
  const scale = maskThumbnailScale(l);
  assert.ok(4096 * scale <= 72);
  assert.ok(l.width * scale <= 96);
});
