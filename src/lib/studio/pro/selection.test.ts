import { test } from "node:test";
import assert from "node:assert/strict";
import { selectColor, appendSelection, colorDistance } from "./selection.ts";
import {
  EMPTY_SELECTION,
  fromPanel,
  layer,
  toLocalSelection,
  validateDocument,
  validateSelection,
  worldPoint,
} from "./model.ts";
import { nativeFile, readNative, mergeNativeSession } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
function fixture(values: number[]) {
  return new Uint8ClampedArray(values.flatMap((n) => [n, n, n, 255]));
}
function mask(region: ReturnType<typeof selectColor>) {
  const p = region.pixels!,
    result = new Uint8Array(p.width * p.height);
  for (let i = 0; i < p.runs.length; i += 3)
    result.fill(p.runs[i + 2]!, p.runs[i]!, p.runs[i]! + p.runs[i + 1]!);
  return [...result];
}
const opts = { tolerance: 0, contiguous: true, antiAlias: false };
test("wand uses four-connected seed-relative colors; color range reaches separated islands", () => {
  const pixels = fixture([10, 11, 12, 90, 10, 90, 10, 90, 90]);
  const r = selectColor(pixels, 3, 3, { x: 0.9, y: 0 }, { ...opts, tolerance: 1 });
  assert.deepEqual(mask(r), [255, 255, 0, 0, 255, 0, 0, 0, 0]);
  const range = selectColor(
    pixels,
    3,
    3,
    { x: 0, y: 0 },
    { ...opts, tolerance: 1, contiguous: false },
  );
  assert.deepEqual(mask(range), [255, 255, 0, 0, 255, 0, 255, 0, 0]);
  validateSelection(appendSelection(EMPTY_SELECTION, r));
});
test("tolerance endpoints, transparency and image boundaries are explicit", () => {
  const p = new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255]);
  assert.equal(colorDistance(p, 0, 4), 0);
  assert.deepEqual(mask(selectColor(p, 3, 1, { x: 0, y: 0 }, opts)), [255, 255, 0]);
  assert.deepEqual(
    mask(selectColor(p, 3, 1, { x: 0, y: 0 }, { ...opts, tolerance: 255 })),
    [255, 255, 255],
  );
  assert.throws(() => selectColor(p, 3, 1, { x: 3, y: 0 }, opts));
  assert.throws(() => selectColor(p, 3, 1, { x: 0, y: 0 }, { ...opts, tolerance: NaN }));
});
test("anti-alias coverage is symmetric and full selections keep document-edge coverage", () => {
  assert.deepEqual(
    mask(selectColor(fixture([90, 10, 90]), 3, 1, { x: 1, y: 0 }, { ...opts, antiAlias: true })),
    [64, 128, 64],
  );
  assert.deepEqual(
    mask(selectColor(fixture([10, 10, 10]), 3, 1, { x: 1, y: 0 }, { ...opts, antiAlias: true })),
    [255, 255, 255],
  );
});
test("source resolution preserves an isolated pixel beyond preview downsampling", () => {
  const pixels = fixture(Array.from({ length: 2000 }, (_, i) => (i === 1501 ? 10 : 90)));
  assert.deepEqual(
    selectColor(pixels, 2000, 1, { x: 1501, y: 0 }, opts).pixels?.runs,
    [1501, 1, 255],
  );
});
test("pixel frames follow rotated/scaled layers without approximating their outline", () => {
  const r = selectColor(fixture([10, 90, 10, 90]), 2, 2, { x: 0, y: 0 }, opts),
    l = layer("paint", 20, 20);
  l.transform = { x: 7, y: -5, scaleX: 2, scaleY: 0.5, rotation: 38 };
  const local = toLocalSelection(appendSelection(EMPTY_SELECTION, r), l);
  assert.equal(local.regions[0]!.kind, "pixels");
  assert.deepEqual(local.regions[0]!.pixels, r.pixels);
  local.regions[0]!.points.forEach((p, i) => {
    const world = worldPoint(p, l);
    assert.ok(Math.abs(world.x - r.points[i]!.x) < 1e-10);
    assert.ok(Math.abs(world.y - r.points[i]!.y) < 1e-10);
  });
});
test("operations following inversion obey De Morgan's laws", () => {
  const r = selectColor(fixture([10, 90]), 2, 1, { x: 0, y: 0 }, opts);
  const inverted = { ...appendSelection(EMPTY_SELECTION, r), inverted: true };
  assert.equal(appendSelection(inverted, r).regions.at(-1)!.operation, "subtract");
  assert.equal(
    appendSelection(inverted, { ...r, operation: "subtract" }).regions.at(-1)!.operation,
    "add",
  );
  const intersection = appendSelection(inverted, { ...r, operation: "intersect" });
  assert.equal(intersection.regions.at(-1)!.operation, "add");
  assert.equal(intersection.regions.at(-1)!.inverted, true);
});
test("malformed coverage runs and singular frames are rejected before rendering", () => {
  const r = selectColor(fixture([10, 10, 90, 90]), 2, 2, { x: 0, y: 0 }, opts);
  for (const runs of [
    [0, 3, 255],
    [0, 1, 256],
    [0, -1, 255],
    [0, 1, 255, 0, 1, 255],
    [0, 1],
    [NaN, 1, 255],
  ])
    assert.throws(() =>
      validateSelection(appendSelection(EMPTY_SELECTION, { ...r, pixels: { ...r.pixels!, runs } })),
    );
  assert.throws(() =>
    validateSelection(
      appendSelection(EMPTY_SELECTION, {
        ...r,
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      }),
    ),
  );
});
test("selection, stroke clipping and masks survive native import and history with chapter identity intact", async () => {
  const document = fromPanel({ id: "chapter-panel", name: "art", width: 2, height: 2 });
  const selection = {
    ...appendSelection(
      EMPTY_SELECTION,
      selectColor(fixture([10, 90, 10, 90]), 2, 2, { x: 0, y: 0 }, opts),
    ),
    feather: 2,
    inverted: true,
  };
  const before = createHistory(document),
    edited = { ...document, selection };
  const h = record(before, edited);
  assert.equal(undo(h).present.selection, undefined);
  assert.deepEqual(redo(undo(h)).present.selection, selection);
  const paint = layer("paint", 2, 2);
  paint.strokes.push({
    points: [{ x: 1, y: 1 }],
    size: 1,
    opacity: 1,
    hardness: 1,
    flow: 1,
    color: "#ff0000",
    erase: false,
    clip: toLocalSelection(selection, paint, { width: 2, height: 2 }),
  });
  paint.mask = { enabled: true, selection, strokes: [] };
  edited.layers = [...edited.layers, paint];
  const session = {
    document: edited,
    assets: { source: new Blob(["pixels"], { type: "image/png" }) },
    revision: 0,
    acceptedBlobId: "accepted",
    updatedAt: 0,
  };
  const reopened = await readNative(await nativeFile(session), "new-panel", "new-accepted");
  validateDocument(reopened.document);
  assert.deepEqual(reopened.document.selection, selection);
  assert.deepEqual(reopened.document.layers.at(-1)!.strokes[0]!.clip, paint.strokes[0]!.clip);
  assert.deepEqual(reopened.document.layers.at(-1)!.mask?.selection, selection);
  assert.deepEqual(mergeNativeSession(session, reopened).document.selection, selection);
  assert.equal(document.panelId, "chapter-panel");
  assert.equal(reopened.acceptedBlobId, "new-accepted");
});

test("captured selection frames preserve document-space feather and snapshot transforms", () => {
  const selected = {
    ...appendSelection(EMPTY_SELECTION, selectColor(fixture([10, 90]), 2, 1, { x: 0, y: 0 }, opts)),
    feather: 5,
  };
  const l = layer("paint", 10, 10);
  l.transform = { x: 3, y: 4, scaleX: 2, scaleY: 0.5, rotation: 30 };
  const clip = toLocalSelection(selected, l, { width: 2, height: 1 });
  assert.deepEqual(clip.regions, selected.regions);
  assert.equal(clip.feather, 5);
  assert.deepEqual(clip.frame, { width: 2, height: 1, transform: l.transform });
  l.transform.x = 90;
  assert.equal(clip.frame!.transform.x, 3);
  validateSelection(clip);
  assert.throws(() => validateSelection({ ...clip, frame: { ...clip.frame!, width: NaN } }));
});
