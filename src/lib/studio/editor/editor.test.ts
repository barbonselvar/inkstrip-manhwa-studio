import test from "node:test";
import assert from "node:assert/strict";
import {
  aspectCrop,
  assertSize,
  clampCrop,
  cropFromPoints,
  defaultRecipe,
  normalizeAngle,
  previewSize,
  rotatedBounds,
  validateRecipe,
  withGeometry,
} from "./geometry.ts";
import { createHistory, record, redo, undo } from "./history.ts";
import { qualifiesLongPress, withinPress } from "./gestures.ts";
import { mediaIds, obsoleteMedia } from "./references.ts";
import type { Panel } from "../types.ts";

test("90°/180° geometry is exact and arbitrary rotations contain the full crop", () => {
  assert.deepEqual(rotatedBounds(120, 80, 90), { width: 80, height: 120 });
  assert.deepEqual(rotatedBounds(120, 80, 180), { width: 120, height: 80 });
  assert.deepEqual(rotatedBounds(100, 100, 45), { width: 142, height: 142 });
  assert.equal(normalizeAngle(450), 90);
  assert.equal(normalizeAngle(-450), -90);
});
test("crop and rotation preserve output scale, including nonuniform resize", () => {
  const initial = { ...defaultRecipe(120, 80), width: 240, height: 240 };
  const cropped = withGeometry(initial, { crop: { x: 20, y: 10, width: 60, height: 40 } });
  assert.equal(cropped.width, 120);
  assert.equal(cropped.height, 120);
  const rotated = withGeometry(cropped, { rotation: 90 });
  assert.equal(rotated.width, 80);
  assert.equal(rotated.height, 180);
  assert.equal(rotated.crop.x, 20);
});
test("crop clamps inside original and aspect presets preserve center", () => {
  assert.deepEqual(clampCrop({ x: -5, y: 70, width: 500, height: 30 }, 120, 80), {
    x: 0,
    y: 70,
    width: 120,
    height: 10,
  });
  assert.deepEqual(aspectCrop({ x: 0, y: 0, width: 120, height: 80 }, 1), {
    x: 20,
    y: 0,
    width: 80,
    height: 80,
  });
  const drawn = cropFromPoints({ x: 100, y: 70 }, { x: 20, y: 10 }, 120, 80);
  assert.deepEqual(drawn, { x: 20, y: 10, width: 80, height: 60 });
  const square = cropFromPoints({ x: 10, y: 10 }, { x: 100, y: 70 }, 120, 80, 1);
  assert.equal(square.width, square.height);
});
test("invalid and over-budget output is rejected without silent quality reduction", () => {
  const recipe = defaultRecipe(120, 80);
  assert.throws(
    () => validateRecipe({ ...recipe, crop: { x: 100, y: 0, width: 60, height: 80 } }, 120, 80),
    /Invalid crop/,
  );
  assert.throws(() => validateRecipe({ ...recipe, rotation: NaN }, 120, 80), /Invalid crop/);
  assert.throws(() => assertSize(10000, 10000, { maxSide: 16384, maxArea: 32_000_000 }), /limit/);
  assert.throws(() => assertSize(1.5, 4, { maxSide: 10, maxArea: 100 }), /whole pixels/);
  assert.deepEqual(previewSize(10000, 20000), { width: 700, height: 1400 });
  assert.deepEqual(previewSize(120, 80), { width: 120, height: 80 });
});
test("history coalesces sliders, supports source changes, and clears redo on edits", () => {
  let history = createHistory({ source: "first", value: 0 });
  history = record(history, { source: "first", value: 1 }, "width");
  history = record(history, { source: "first", value: 2 }, "width");
  assert.equal(history.past.length, 1);
  history = record(history, { source: "original", value: 0 });
  assert.equal(undo(history).present.source, "first");
  assert.deepEqual(redo(undo(history)).present, history.present);
  assert.equal(record(undo(history), { source: "other", value: 7 }).future.length, 0);
  assert.equal(undo(undo(history)).present.value, 0);
});
test("history is bounded and does not mutate old recipes", () => {
  const first = createHistory({ value: 0 });
  let history = first;
  for (let i = 1; i < 100; i++) history = record(history, { value: i });
  assert.equal(history.past.length, 50);
  assert.equal(first.present.value, 0);
});
test("long press rejects quick taps and scrolling motion", () => {
  assert.equal(qualifiesLongPress({ x: 10, y: 10, time: 0 }, { x: 11, y: 12, time: 550 }), true);
  assert.equal(qualifiesLongPress({ x: 10, y: 10, time: 0 }, { x: 10, y: 10, time: 100 }), false);
  assert.equal(withinPress({ x: 0, y: 0 }, { x: 12, y: 0 }), false);
});
test("replacement retains imported originals and active recipe sources, purging only unreferenced output", () => {
  const base: Panel = {
    id: "p",
    chapterId: "c",
    name: "p.png",
    mime: "image/png",
    width: 120,
    height: 80,
    blobId: "accepted",
    thumbId: "thumb-accepted",
    order: 0,
    createdAt: 1,
    original: {
      blobId: "original",
      thumbId: "thumb-original",
      mime: "image/png",
      width: 120,
      height: 80,
    },
  };
  const next: Panel = {
    ...base,
    blobId: "new",
    thumbId: "thumb-new",
    edit: {
      version: 1,
      source: {
        blobId: "accepted",
        thumbId: "thumb-accepted",
        mime: "image/png",
        width: 120,
        height: 80,
      },
      recipe: defaultRecipe(120, 80),
    },
  };
  assert.deepEqual(obsoleteMedia(base, next), []);
  assert.deepEqual(
    mediaIds(next).sort(),
    ["new", "thumb-new", "original", "thumb-original", "accepted", "thumb-accepted"].sort(),
  );
  assert.deepEqual(
    obsoleteMedia(next, { ...base, blobId: "AI", thumbId: "AI-thumb" }).sort(),
    ["new", "thumb-new", "accepted", "thumb-accepted"].sort(),
  );
  assert.deepEqual(
    obsoleteMedia(next, {
      ...base,
      blobId: "original",
      thumbId: "thumb-original",
      original: undefined,
    }).sort(),
    ["new", "thumb-new", "accepted", "thumb-accepted"].sort(),
  );
});
