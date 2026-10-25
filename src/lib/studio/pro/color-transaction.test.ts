import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, validateDocument, type ProSession } from "./model.ts";
import { colorTarget, colorDocument, prepareColorCommit } from "./color-transaction.ts";
import { nativeFile, readNative } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { nudgeDocument } from "./geometry-operations.ts";
const make = () => fromPanel({ id: "r6", name: "source", width: 128, height: 96 });
const blob = new Blob(
  [
    Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    ),
  ],
  { type: "image/png" },
);
const session = (document = make()): ProSession => ({
  document,
  assets: { source: blob },
  revision: 0,
  acceptedBlobId: "p",
  updatedAt: 0,
});
test("color target rejects hidden, locked, ancestor-locked and nonpixel layers", () => {
  for (const field of ["hidden", "locked", "ancestor", "kind"]) {
    const d = make(),
      l = d.layers[0]!;
    if (field === "hidden") l.visible = false;
    if (field === "locked") l.locked = true;
    if (field === "kind") l.kind = "adjustment";
    if (field === "ancestor") {
      const g = layer("group", 128, 96, "group");
      g.locked = true;
      l.parentId = g.id;
      d.layers.unshift(g);
    }
    assert.throws(() => colorTarget(d, l.id, 16_777_216), /visible, unlocked/);
  }
});
test("staging preserves source and masks, effects, clipping, opacity, geometry and links on target", () => {
  const d = make(),
    l = d.layers[0]!,
    before = structuredClone(d);
  l.mask = {
    enabled: true,
    inverted: false,
    strokes: [],
    selection: { regions: [], inverted: true, feather: 0 },
    linked: false,
    density: 0.5,
    placement: { x: 4, y: 5, rotation: 12, scaleX: 1.1, scaleY: 1 },
  };
  l.transform = { x: 15, y: 4, rotation: 22, scaleX: 1, scaleY: 2, flipX: true };
  l.opacity = 0.6;
  l.blend = "multiply";
  l.adjustments.brightness = 12;
  l.hue = 10;
  l.color = { vibrance: 20 };
  l.linkId = "linked";
  const copy = structuredClone(d),
    out = colorDocument(d, l.id, "processed", "original", 16_777_216),
    result = out.layers[1]!;
  assert.deepEqual(d, copy);
  assert.equal(out.layers[0]!.visible, false);
  assert.deepEqual(
    { ...out.layers[0]!, id: l.id, name: l.name, visible: true, linkId: l.linkId },
    l,
  );
  for (const key of ["mask", "transform", "opacity", "blend", "linkId"] as const)
    assert.deepEqual(result[key], l[key]);
  assert.equal(result.id, l.id);
  assert.equal(result.assetId, "processed");
  assert.equal(result.adjustments.brightness, 0);
  assert.equal(result.color, undefined);
  assert.equal(out.version, before.version);
});
test("clipped target retains clipping membership in the hidden original and processed layer", () => {
  const d = make(),
    l = layer("paint", 128, 96, "paint");
  l.clipped = true;
  d.layers.push(l);
  const out = colorDocument(d, l.id, "new", "old", 16_777_216);
  validateDocument(out);
  assert.equal(out.layers[1]!.clipped, true);
  assert.equal(out.layers[2]!.clipped, true);
});
test("one accepted Apply uses existing history, Undo and Redo restore exact document identity", () => {
  const s = session(),
    d = s.document,
    id = d.layers[0]!.id,
    next = prepareColorCommit(s, d, d, id, blob, "new", "old", 16_777_216),
    initial = createHistory({ doc: d, label: "start" }),
    h = record(initial, { doc: next.document, label: "color" });
  assert.equal(h.past.length, 1);
  assert.equal(undo(h).present.doc, d);
  assert.equal(redo(undo(h)).present.doc, next.document);
  assert.deepEqual(Object.keys(s.assets), ["source"]);
  assert.equal(next.assets.new, blob);
});
test("changed document revision, deleted target and newly locked target reject stale commits", () => {
  const s = session(),
    d = s.document,
    id = d.layers[0]!.id;
  assert.throws(
    () => prepareColorCommit(s, { ...d }, d, id, blob, "new", "old", 16_777_216),
    /document changed/,
  );
  assert.throws(() => prepareColorCommit(s, d, d, "gone", blob, "new", "old", 16_777_216));
  d.layers[0]!.locked = true;
  assert.throws(() => prepareColorCommit(s, d, d, id, blob, "new", "old", 16_777_216));
  assert.deepEqual(Object.keys(s.assets), ["source"]);
});
test("native v1 save and reopen retain original plus processed assets without new settings", async () => {
  const s = session(),
    d = s.document,
    next = prepareColorCommit(s, d, d, d.layers[0]!.id, blob, "new", "old", 16_777_216),
    file = await nativeFile(next),
    raw = JSON.parse(await file.text());
  assert.equal(raw.version, 1);
  assert.deepEqual(Object.keys(raw.assets).sort(), ["new", "source"]);
  const reopened = await readNative(file, "r6", "p");
  assert.deepEqual(reopened.document, JSON.parse(JSON.stringify(next.document)));
  assert.equal(reopened.document.layers[0]!.visible, false);
  assert.equal(await reopened.assets.new!.text(), await blob.text());
});
test("R5 can move the processed layer while its retained original stays fixed", () => {
  const d = make(),
    id = d.layers[0]!.id,
    next = colorDocument(d, id, "new", "old", 16_777_216),
    out = nudgeDocument(next, [id], { x: 3, y: -2 }, false);
  assert.equal(out.layers[1]!.transform.x, next.layers[1]!.transform.x + 3);
  assert.deepEqual(out.layers[0]!.transform, next.layers[0]!.transform);
});
test("layer, source, asset and device budgets fail before mutating session", () => {
  const d = make(),
    id = d.layers[0]!.id;
  for (let i = 1; i < 48; i++) d.layers.push(layer("paint", 128, 96, `p${i}`));
  assert.throws(() => colorDocument(d, id, "new", "old", 16_777_216), /layer budget/);
  const big = make();
  big.layers[0]!.width = 2001;
  big.layers[0]!.height = 2000;
  assert.throws(() => colorTarget(big, big.layers[0]!.id, 16_777_216), /4MP/);
  const s = session();
  for (let i = 0; i < 63; i++) s.assets[`extra${i}`] = blob;
  assert.throws(
    () =>
      prepareColorCommit(
        s,
        s.document,
        s.document,
        s.document.layers[0]!.id,
        blob,
        "new",
        "old",
        16_777_216,
      ),
    /64/,
  );
  assert.equal(Object.keys(s.assets).length, 64);
  const small = make();
  assert.throws(() => colorTarget(small, small.layers[0]!.id, 100));
});
