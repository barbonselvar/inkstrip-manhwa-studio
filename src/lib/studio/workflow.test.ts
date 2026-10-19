import { test } from "node:test";
import assert from "node:assert/strict";
import { batchRecipe, validatePresets } from "./workflow.ts";
import { NEUTRAL } from "./editor/adjustments.ts";
import { mediaIds } from "./editor/references.ts";
import type { Panel } from "./types.ts";
test("batch preserves native geometry by default and refuses oversized/invalid work", () => {
  const limits = { maxSide: 8192, maxArea: 16000000 };
  const recipe = batchRecipe(100, 300, { ...NEUTRAL, brightness: 10 }, 100, limits);
  assert.deepEqual([recipe.width, recipe.height], [100, 300]);
  assert.equal(recipe.adjustments.brightness, 10);
  assert.throws(() => batchRecipe(8000, 8000, NEUTRAL, 200, limits));
  assert.throws(() => batchRecipe(100, 100, NEUTRAL, NaN, limits));
});
test("presets validate filter ranges, names and independent IDs", () => {
  const p = { id: "1", name: "Ink", adjustments: { ...NEUTRAL } };
  validatePresets([p]);
  assert.throws(() => validatePresets([p, p]));
  assert.throws(() => validatePresets([{ ...p, name: " " }]));
  assert.throws(() => validatePresets([{ ...p, adjustments: { ...NEUTRAL, exposure: 99 } }]));
});
test("blob retention includes interrupted draft source, original and edit recipe", () => {
  const p = {
    blobId: "current",
    thumbId: "thumb",
    original: { blobId: "original", thumbId: "original-thumb" },
    edit: { source: { blobId: "edit", thumbId: "edit-thumb" } },
    draft: { source: { blobId: "draft", thumbId: "draft-thumb" } },
  } as Panel;
  assert.deepEqual(mediaIds(p), [
    "current",
    "thumb",
    "original",
    "original-thumb",
    "edit",
    "edit-thumb",
    "draft",
    "draft-thumb",
  ]);
});
