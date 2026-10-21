import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRepairColor } from "./repair.ts";

test("healing preserves sampled texture while matching target average color", () => {
  const sampled = new Uint8ClampedArray([100, 80, 60, 255, 120, 100, 80, 255]);
  const target = new Uint8ClampedArray([20, 40, 60, 255, 40, 60, 80, 255]);
  assert.deepEqual([...matchRepairColor(sampled, target)], [20, 40, 60, 255, 40, 60, 80, 255]);
  assert.deepEqual([...sampled], [100, 80, 60, 255, 120, 100, 80, 255]);
});

test("transparent donor pixels stay transparent and do not bias the color estimate", () => {
  const sampled = new Uint8ClampedArray([200, 0, 0, 255, 255, 255, 255, 0]);
  const target = new Uint8ClampedArray([100, 20, 40, 255, 0, 0, 0, 0]);
  assert.deepEqual([...matchRepairColor(sampled, target)], [100, 20, 40, 255, 255, 255, 255, 0]);
});

test("healing rejects mismatched pixel buffers", () => {
  assert.throws(() => matchRepairColor(new Uint8ClampedArray(4), new Uint8ClampedArray(8)));
});

import { spatialHeal, findRepairDonor, patchSelection } from "./repair.ts";
import { brushPoint } from "./brush-dynamics.ts";
import { fromPanel, layer, validateDocument, type Stroke } from "./model.ts";
import { nativeFile, readNative, mergeNativeSession } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { validateBrushPreset } from "./brush-presets.ts";
function rgba(width: number, height: number, value: (x: number, y: number) => number) {
  return new Uint8ClampedArray(
    Array.from({ length: width * height }, (_, i) => {
      const v = value(i % width, Math.floor(i / width));
      return [v, v, v, 255];
    }).flat(),
  );
}
test("spatial healing excludes damaged target pixels and varies correction across a gradient", () => {
  const w = 25,
    h = 15,
    donor = rgba(w, h, (x, y) => 80 + ((x + y) % 2) * 8),
    target = rgba(w, h, (x, y) => 20 + x * 3 + ((x + y) % 2) * 8),
    mask = new Uint8ClampedArray(w * h * 4);
  for (let y = 5; y < 10; y++)
    for (let x = 4; x < 21; x++) {
      const i = (y * w + x) * 4;
      mask[i + 3] = 255;
      target[i] = target[i + 1] = target[i + 2] = 0;
    }
  const original = new Uint8ClampedArray(target),
    result = spatialHeal(donor, target, mask, w, h, 4);
  for (const x of [6, 12, 18]) {
    const i = (7 * w + x) * 4,
      expected = 20 + x * 3 + ((x + 7) % 2) * 8;
    assert.ok(
      Math.abs(result[i]! - expected) <= 3,
      `${result[i]} should restore intact local tone ${expected}`,
    );
  }
  assert.ok(
    result[(7 * w + 18) * 4]! - result[(7 * w + 6) * 4]! > 25,
    "correction must vary spatially",
  );
  assert.deepEqual(target, original);
  assert.deepEqual(
    [...result.slice(0, 4)],
    [...donor.slice(0, 4)],
    "processing leaves outside-mask texture untouched",
  );
});
test("spatial repair preserves donor alpha, handles absent support and validates resource bounds", () => {
  const donor = rgba(3, 3, () => 100),
    target = rgba(3, 3, () => 20),
    mask = new Uint8ClampedArray(36);
  donor[19] = 0;
  mask[19] = 255;
  assert.equal(spatialHeal(donor, target, mask, 3, 3, 2)[19], 0);
  mask.fill(255);
  assert.deepEqual(spatialHeal(donor, target, mask, 3, 3, 2), donor);
  assert.throws(() => spatialHeal(donor, target, mask, 3, 3, 129));
  assert.throws(() => spatialHeal(donor, target, mask, NaN, 3, 2));
  assert.throws(() => spatialHeal(donor, target, mask, 1001, 1000, 2));
});
test("automatic sampling chooses intact non-overlapping opaque local texture deterministically", () => {
  const pixels = rgba(80, 64, (x) => 90 + (x % 4) * 8),
    rect = { x: 36, y: 28, width: 8, height: 8 };
  for (let y = 28; y < 36; y++)
    for (let x = 36; x < 44; x++) {
      const i = (y * 80 + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
    }
  const offset = findRepairDonor(pixels, 80, 64, rect),
    sx = rect.x + offset.x,
    sy = rect.y + offset.y;
  assert.ok(sx + 8 < 36 || sx > 44 || sy + 8 < 28 || sy > 36);
  assert.ok(pixels[(sy * 80 + sx) * 4]! >= 90);
  assert.deepEqual(findRepairDonor(pixels, 80, 64, rect), offset);
  const transparent = new Uint8ClampedArray(80 * 64 * 4);
  assert.throws(() => findRepairDonor(transparent, 80, 64, rect), /No opaque local donor/);
});
test("automatic texture analysis retains source-resolution coordinates beyond preview bounds", () => {
  const p = rgba(2000, 24, (x) => 80 + (x % 4) * 4),
    rect = { x: 1600, y: 8, width: 4, height: 4 };
  const offset = findRepairDonor(p, 2000, 24, rect);
  assert.ok(rect.x + offset.x > 1400);
  assert.throws(() => findRepairDonor(p, 2000, 24, { ...rect, x: 2000 }));
  assert.throws(
    () =>
      findRepairDonor(
        rgba(4, 4, () => 80),
        4,
        4,
        { x: 0, y: 0, width: 4, height: 4 },
      ),
    /No opaque local donor/,
  );
});
test("pen pressure and smoothing use real input; mouse/touch retain ordinary size", () => {
  const start = brushPoint(undefined, { x: 0, y: 0 }, "pen", 0.2, true, 0);
  assert.equal(start.pressure, 0.2);
  const smoothed = brushPoint(start, { x: 10, y: 8 }, "pen", 0.8, true, 0.5);
  assert.ok(smoothed.x > 0 && smoothed.x < 10);
  assert.equal(smoothed.pressure, 0.8);
  assert.equal(brushPoint(undefined, { x: 1, y: 1 }, "mouse", 0.5, true, 0).pressure, undefined);
  assert.equal(brushPoint(undefined, { x: 1, y: 1 }, "touch", 0.1, true, 0).pressure, undefined);
  assert.equal(brushPoint(undefined, { x: 1, y: 1 }, "pen", NaN, true, 0).pressure, 1);
  assert.equal(brushPoint(undefined, { x: 1, y: 1 }, "pen", 0, true, 0).pressure, 0.05);
});
test("repair textures, patches, pressure, selection clips and mask strokes persist through native import and history", async () => {
  for (const kind of ["spot", "patch", "heal"] as const) {
    const d = fromPanel({ id: "panel", name: "repair", width: 32, height: 24 }),
      paint = layer("paint", 32, 24),
      selection = patchSelection({ x: 2, y: 3 }, { x: 10, y: 12 }, 2),
      stroke: Stroke = {
        points: [
          { x: 4, y: 5, pressure: 0.2 },
          { x: 8, y: 9, pressure: 0.8 },
        ],
        size: 12,
        hardness: 0.8,
        opacity: 0.7,
        flow: 0.8,
        color: "#102030",
        erase: false,
        sizePressure: true,
        smoothing: 0.5,
        clip: selection,
        clone: {
          assetId: "repair",
          targetTransform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          width: 16,
          height: 16,
          source: { x: 0, y: 0 },
          destination: { x: 0, y: 0 },
          mode: "clone",
        },
        repair: {
          kind,
          source: { x: 20, y: 20 },
          destination: { x: 4, y: 5 },
          algorithm: "spatial-v1",
        },
        ...(kind === "patch" ? { patch: selection } : {}),
      };
    paint.strokes = [stroke];
    paint.mask = {
      enabled: true,
      selection: { regions: [], inverted: true, feather: 0 },
      strokes: [{ ...stroke, patch: undefined }],
    };
    const before = createHistory(d),
      next = { ...d, layers: [...d.layers, paint] },
      history = record(before, next);
    assert.equal(undo(history).present.layers.length, 1);
    assert.deepEqual(redo(undo(history)).present, next);
    const session = {
      document: next,
      assets: {
        source: new Blob(["original"], { type: "image/png" }),
        repair: new Blob(["processed native texture"], { type: "image/png" }),
      },
      revision: 0,
      acceptedBlobId: "accepted",
      updatedAt: 0,
    };
    const reopened = await readNative(await nativeFile(session), "same-chapter", "accepted");
    assert.deepEqual(reopened.document.layers.at(-1)!.strokes[0], stroke);
    assert.deepEqual(reopened.document.layers.at(-1)!.mask?.strokes[0].clip, selection);
    const imported = mergeNativeSession(session, reopened),
      remapped = imported.document.layers.at(-1)!.strokes[0]!.clone!.assetId;
    assert.notEqual(remapped, "repair");
    assert.equal(await imported.assets[remapped]!.text(), "processed native texture");
    assert.equal(await imported.assets.source!.text(), "original");
  }
});
test("invalid pressure, smoothing, repair metadata and patch dependencies are rejected", () => {
  const d = fromPanel({ id: "panel", name: "repair", width: 32, height: 24 }),
    paint = layer("paint", 32, 24),
    s: Stroke = {
      points: [{ x: 4, y: 4 }],
      size: 12,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#102030",
      erase: false,
    };
  d.layers.push(paint);
  for (const invalid of [
    { points: [{ x: 4, y: 4, pressure: 2 }] },
    { smoothing: NaN },
    { sizePressure: "yes" },
    { repair: { kind: "fake" } },
    { patch: patchSelection({ x: 0, y: 0 }, { x: 8, y: 8 }, 0) },
  ]) {
    paint.strokes = [{ ...s, ...invalid } as Stroke];
    assert.throws(() => validateDocument(d));
  }
  assert.equal(
    validateBrushPreset({ name: "pen", settings: { ...s, sizePressure: true, smoothing: 0.5 } }),
    true,
  );
  assert.equal(validateBrushPreset({ name: "pen", settings: { ...s, smoothing: 2 } }), false);
});

test("tone estimation also excludes original damage shifted into the donor context", () => {
  const donor = rgba(9, 9, () => 100),
    target = rgba(9, 9, () => 100),
    mask = new Uint8ClampedArray(9 * 9 * 4),
    donorMask = new Uint8ClampedArray(9 * 9 * 4);
  mask[(4 * 9 + 4) * 4 + 3] = 255;
  target[(4 * 9 + 4) * 4] = target[(4 * 9 + 4) * 4 + 1] = target[(4 * 9 + 4) * 4 + 2] = 0;
  for (let y = 3; y < 6; y++) {
    const i = (y * 9 + 2) * 4;
    donor[i] = donor[i + 1] = donor[i + 2] = 0;
    donorMask[i + 3] = 255;
  }
  const result = spatialHeal(donor, target, mask, 9, 9, 4, donorMask);
  assert.deepEqual([...result.slice((4 * 9 + 4) * 4, (4 * 9 + 4) * 4 + 4)], [100, 100, 100, 255]);
});
