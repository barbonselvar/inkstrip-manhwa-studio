import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, TRANSFORM } from "./model.ts";
import { cloneTransformDraft, previewTransform, type TransformDraft } from "./transform-session.ts";
import { stageSelectionDocument } from "./selection-transform.ts";
const doc = () => fromPanel({ id: "p", name: "revision safety", width: 128, height: 96 });
function draft(origin: ReturnType<typeof doc>): TransformDraft {
  return {
    origin,
    layerId: origin.layers[0]!.id,
    base: { ...TRANSFORM },
    value: { ...TRANSFORM, x: 8 },
    mode: "affine",
    lock: true,
    translation: { x: 8, y: 0 },
  };
}
test("gesture cloning preserves origin identity and deep-clones mutable transform fields", () => {
  const d = doc(),
    a = draft(d);
  a.value.pivot = { x: 64, y: 48 };
  const b = cloneTransformDraft(a);
  assert.equal(b.origin, d);
  assert.notEqual(b.value, a.value);
  b.value.pivot!.x = 10;
  assert.equal(a.value.pivot.x, 64);
  assert.equal(previewTransform(d, b).layers[0]!.transform.x, 8);
});
test("draft preview/Apply refuse newer, imported and cloned revisions", () => {
  const d = doc(),
    a = draft(d);
  for (const newer of [{ ...d, name: "new" }, structuredClone(d), { ...d, layers: [] }])
    assert.throws(() => previewTransform(newer, a), /document changed/);
  assert.equal(d.layers[0]!.transform.x, 0);
});
test("selected-pixel preview uses its captured stage but remains bound to committed origin", () => {
  const d = doc();
  d.selection = { regions: [], inverted: true, feather: 0 };
  const staged = stageSelectionDocument(d, d.layers[0]!.id, "r", "l", {
      group: "g",
      remaining: "r",
      floating: "f",
    }),
    a = { ...draft(d), target: "pixels" as const, layerId: "f" };
  assert.throws(() => previewTransform(d, a), /no longer available/);
  assert.equal(
    previewTransform(d, a, staged.document).layers.find((l) => l.id === "f")!.transform.x,
    8,
  );
  assert.equal(d.layers.length, 1);
  assert.throws(() => previewTransform({ ...d }, a, staged.document), /document changed/);
});
