import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, validateDocument, type ProDocument } from "./model.ts";
import {
  stacks,
  clipBase,
  visibleLayerIds,
  duplicateLayers,
  linkLayers,
  unlinkLayers,
  translateLayers,
  setClipping,
  groupLayers,
  reparentLayers,
  reorderLayers,
  moveLayers,
  deleteLayers,
  planMerge,
  finishMerge,
} from "./layers.ts";
import { blendClippedPixels } from "./clipping.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
const doc = () => {
  const d = fromPanel({ id: "panel", name: "Layer test", width: 32, height: 24 });
  d.layers = [layer("shape", 10, 10, "a"), layer("shape", 10, 10, "b"), layer("text", 10, 10, "c")];
  return d;
};
test("clipping chains use the nearest base and reset at each sibling group", () => {
  let d = doc();
  d = setClipping(d, ["b", "c"], true);
  assert.equal(stacks(d.layers).length, 1);
  assert.equal(clipBase(d, "c")?.id, "a");
  const g = layer("group", 32, 24, "g"),
    child = layer("shape", 10, 10, "child");
  child.parentId = "g";
  child.clipped = true;
  d.layers.push(g, child);
  assert.equal(clipBase(d, "child"), undefined);
  assert.ok(!visibleLayerIds(d).has("child"));
});
test("hidden base and ancestors hide every clip without leaking to a previous base", () => {
  let d = doc();
  d = setClipping(d, ["b", "c"], true);
  d.layers[0]!.visible = false;
  assert.equal(visibleLayerIds(d).size, 0);
  assert.throws(() => setClipping(doc(), ["a"], true), /base below/);
});
test("clipping preserves fractional base alpha across several translucent clips", () => {
  const b = new Uint8ClampedArray([100, 100, 100, 128, 10, 20, 30, 0]);
  blendClippedPixels(
    b,
    new Uint8ClampedArray([200, 0, 100, 128, 255, 255, 255, 255]),
    1,
    "source-over",
  );
  assert.equal(b[3], 128);
  assert.equal(b[7], 0);
  blendClippedPixels(
    b,
    new Uint8ClampedArray([0, 200, 0, 255, 0, 255, 0, 255]),
    0.5,
    "source-over",
  );
  assert.equal(b[3], 128);
  assert.equal(b[7], 0);
  assert.deepEqual([...b.slice(0, 3)], [75, 125, 50]);
});
test("every supported clipping blend mode uses source-atop color with invariant alpha", () => {
  for (const [mode, value] of [
    ["source-over", 128],
    ["multiply", 64],
    ["screen", 192],
    ["overlay", 128],
    ["darken", 128],
    ["lighten", 128],
  ] as const) {
    const b = new Uint8ClampedArray([128, 128, 128, 64]);
    blendClippedPixels(b, new Uint8ClampedArray([128, 128, 128, 255]), 1, mode);
    assert.deepEqual([...b], [value, value, value, 64]);
  }
  assert.throws(() =>
    blendClippedPixels(new Uint8ClampedArray(4), new Uint8ClampedArray(8), 1, "screen"),
  );
});
test("optional clipping/link fields validate while legacy documents remain valid", () => {
  const d = doc();
  validateDocument(d);
  d.layers[1]!.clipped = true;
  d.layers[1]!.linkId = "characters";
  validateDocument(d);
  assert.throws(() =>
    validateDocument({
      ...d,
      layers: [{ ...d.layers[0]!, clipped: "yes" }],
    } as unknown as ProDocument),
  );
  assert.throws(() => validateDocument({ ...d, layers: [{ ...d.layers[0]!, linkId: "" }] }));
});
test("native files preserve clipping, links, groups and document selections", async () => {
  let d = doc();
  d = setClipping(d, ["b", "c"], true);
  d = linkLayers(d, ["a", "c"]);
  d.selection = { regions: [], inverted: true, feather: 3 };
  const s = {
    document: d,
    assets: { source: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) },
    revision: 0,
    acceptedBlobId: "accepted",
    updatedAt: 0,
  };
  const reopened = await readNative(await nativeFile(s), "panel", "accepted");
  assert.deepEqual(reopened.document, d);
  assert.throws(() => vectorSvg(d), /clipping stacks/);
});
test("duplicate copies an entire group subtree without changing original IDs or assets", () => {
  const d = doc(),
    g = layer("group", 32, 24, "g");
  d.layers[0]!.parentId = d.layers[1]!.parentId = "g";
  d.layers[1]!.clipped = true;
  d.layers.push(g);
  const r = duplicateLayers(d, ["g"]);
  assert.equal(r.ids.length, 1);
  assert.equal(r.document.layers.length, 7);
  const copy = r.document.layers.find((l) => l.id === r.ids[0])!;
  const children = r.document.layers.filter((l) => l.parentId === copy.id);
  assert.equal(children.length, 2);
  assert.ok(children[1]!.clipped);
  assert.notEqual(children[0]!.id, "a");
  assert.equal(d.layers.length, 4);
});
test("duplicating a clipping base includes its clips; duplicate links never bind to originals", () => {
  let d = setClipping(doc(), ["b"], true);
  d = linkLayers(d, ["a", "b"]);
  const r = duplicateLayers(d, ["a"]),
    copies = r.document.layers.filter((l) => r.ids.includes(l.id));
  assert.equal(copies.length, 2);
  assert.ok(copies[1]!.clipped);
  assert.notEqual(copies[0]!.linkId, d.layers[0]!.linkId);
  assert.equal(copies[0]!.linkId, copies[1]!.linkId);
  assert.equal(clipBase(r.document, copies[1]!.id)?.id, copies[0]!.id);
});
test("linked translation moves selected groups and linked members once; locks block the whole move", () => {
  let d = linkLayers(doc(), ["a", "c"]);
  const before = structuredClone(d);
  d = translateLayers(d, ["a", "c"], { x: 7, y: -4 });
  assert.equal(d.layers[0]!.transform.x, 7);
  assert.equal(d.layers[2]!.transform.x, 7);
  assert.equal(d.layers[1]!.transform.x, 0);
  d.layers[2]!.locked = true;
  assert.throws(() => translateLayers(d, ["a"], { x: 1, y: 0 }), /Unlock/);
  assert.equal(before.layers[0]!.transform.x, 0);
  d.layers[2]!.locked = false;
  d = unlinkLayers(d, ["a"]);
  assert.ok(!d.layers[0]!.linkId && !d.layers[2]!.linkId);
});
test("grouped linked members move without double-applying translation", () => {
  const d = doc(),
    g = layer("group", 32, 24, "g");
  d.layers[0]!.parentId = d.layers[1]!.parentId = "g";
  d.layers.push(g);
  const linked = linkLayers(d, ["g", "c"]),
    moved = translateLayers(linked, ["g", "a"], { x: 9, y: 2 });
  assert.deepEqual(
    moved.layers.filter((l) => l.kind !== "group").map((l) => l.transform.x),
    [9, 9, 9],
  );
  validateDocument(moved);
});
test("multiple layer insertion preserves sibling order and complete clipping stacks", () => {
  const d = doc();
  d.layers.push(layer("shape", 10, 10, "d"));
  const r = reorderLayers(d, ["a", "b"], "d", "after");
  assert.deepEqual(
    r.layers.map((l) => l.id),
    ["c", "d", "a", "b"],
  );
  const clipped = setClipping(d, ["b"], true),
    moved = moveLayers(clipped, ["a"], 1);
  assert.deepEqual(
    moved.layers.map((l) => l.id),
    ["c", "a", "b", "d"],
  );
});
test("group membership changes reject cycles, partial clips, locks and excess nesting", () => {
  let d = doc();
  const g = layer("group", 32, 24, "g");
  d.layers.push(g);
  d = reparentLayers(d, ["a", "b"], "g");
  assert.equal(d.layers.find((l) => l.id === "a")?.parentId, "g");
  assert.throws(() => reparentLayers(d, ["g"], "g"), /itself/);
  d.layers.find((l) => l.id === "g")!.locked = true;
  assert.throws(() => reparentLayers(d, ["c"], "g"), /Unlock/);
});
test("group/merge reject nonconsecutive selection and split clipping stacks", () => {
  const d = doc();
  assert.throws(() => groupLayers(d, ["a", "c"]), /consecutive/);
  const c = setClipping(d, ["b", "c"], true);
  assert.throws(() => groupLayers(c, ["a", "b"]), /entire clipping stack/);
  assert.throws(() => planMerge(c, "selected", ["b", "c"], "merged"), /entire clipping stack/);
});
test("merge plans preserve position, opacity, blend, immutable source and selection", () => {
  let d = doc();
  d.selection = { regions: [], inverted: true, feather: 0 };
  d.layers[1]!.blend = "multiply";
  d.layers[1]!.opacity = 0.6;
  d = setClipping(d, ["c"], true);
  const p = planMerge(d, "selected", ["b", "c"], "merged"),
    result = finishMerge(d, p);
  assert.deepEqual(
    result.layers.map((l) => l.id),
    ["a", p.replacement.id],
  );
  assert.equal(result.layers[1]!.blend, "multiply");
  assert.equal(result.layers[1]!.opacity, 0.6);
  assert.equal(p.render.layers[0]!.opacity, 1);
  assert.deepEqual(result.source, d.source);
  assert.deepEqual(result.selection, d.selection);
});
test("partial mixed blends are rejected; a full-stack or visible merge supports them", () => {
  const d = doc();
  d.layers[1]!.blend = "multiply";
  assert.throws(() => planMerge(d, "selected", ["b", "c"], "merged"), /backdrop/);
  assert.equal(
    finishMerge(d, planMerge(d, "selected", ["a", "b", "c"], "merged")).layers.length,
    1,
  );
  assert.equal(finishMerge(d, planMerge(d, "visible", [], "merged")).layers.length, 1);
});
test("merge visible retains hidden descendants and ancestors without showing them", () => {
  const d = doc(),
    g = layer("group", 32, 24, "g");
  d.layers[0]!.parentId = d.layers[1]!.parentId = "g";
  d.layers[1]!.visible = false;
  d.layers.push(g);
  const p = planMerge(d, "visible", [], "merged"),
    r = finishMerge(d, p);
  validateDocument(r);
  assert.ok(r.layers.some((l) => l.id === "b"));
  assert.equal(r.layers.find((l) => l.id === "g")?.visible, false);
  assert.deepEqual([...visibleLayerIds(r)], [p.replacement.id]);
});
test("flatten removes hidden layers but keeps the source and is completely undoable", () => {
  const d = doc();
  d.layers[1]!.visible = false;
  d.layers[0]!.locked = true;
  const r = finishMerge(d, planMerge(d, "flatten", [], "merged"));
  assert.equal(r.layers.length, 1);
  assert.deepEqual(r.source, d.source);
  let h = createHistory(d);
  h = record(h, r);
  assert.deepEqual(undo(h).present, d);
  assert.deepEqual(redo(undo(h)).present, r);
});
test("deleting a base removes its clip stack atomically and cleans orphan links", () => {
  let d = setClipping(doc(), ["b"], true);
  d = linkLayers(d, ["a", "c"]);
  const r = deleteLayers(d, ["a"]);
  assert.deepEqual(
    r.layers.map((l) => l.id),
    ["c"],
  );
  assert.equal(r.layers[0]!.linkId, undefined);
});

test("link propagation traverses long group/member chains to completion", () => {
  const d = doc();
  d.layers = [];
  for (let i = 0; i < 8; i++) {
    const g = layer("group", 32, 24, `g${i}`),
      child = layer("shape", 4, 4, `s${i}`);
    child.parentId = g.id;
    child.linkId = `chain${i}`;
    if (i > 0) g.linkId = `chain${i - 1}`;
    d.layers.push(g, child);
  }
  const moved = translateLayers(d, ["g0"], { x: 3, y: 4 });
  assert.ok(
    moved.layers
      .filter((l) => l.kind !== "group")
      .every((l) => l.transform.x === 3 && l.transform.y === 4),
  );
});
test("moving a base past a clipped target never splits the target stack", () => {
  const d = setClipping(doc(), ["b"], true);
  assert.deepEqual(
    reorderLayers(d, ["c"], "b", "before").layers.map((l) => l.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    reorderLayers(d, ["c"], "a", "after").layers.map((l) => l.id),
    ["a", "b", "c"],
  );
});

test("a merge must pass decoded-source budgets before replacing any layers", async () => {
  const { documentSources } = await import("./raster-budget.ts");
  const d = doc();
  d.width = d.height = 4000;
  const small = layer("shape", 10, 10, "small"),
    a = layer("raster", 4000, 4000, "a"),
    b = layer("raster", 4000, 4000, "b");
  a.assetId = "large-a";
  b.assetId = "large-b";
  d.layers = [small, a, b];
  assert.equal(documentSources(d, 16_000_000).size, 3);
  const candidate = finishMerge(d, planMerge(d, "selected", ["small"], "new-raster"));
  assert.throws(() => documentSources(candidate, 16_000_000), /combined memory budget/);
  assert.equal(d.layers[0]!.kind, "shape");
});
