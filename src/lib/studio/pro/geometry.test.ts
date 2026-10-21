import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cropPoint,
  cropLocal,
  cropHandlePoint,
  dragCrop,
  outputMatrix,
  outputSize,
  fullCrop,
  CROP_HANDLES,
} from "./geometry.ts";
import { fromPanel, layer, validateDocument, type ProSession } from "./model.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
const document = () => fromPanel({ id: "p", name: "Geometry", width: 128, height: 96 });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);
test("rotated crop frame and inverse roundtrip source coordinates", () => {
  for (const rotation of [-180, -37.2, 0, 90, 180]) {
    const c = { x: 7, y: -5, width: 88, height: 41, rotation };
    for (const p of [
      { x: 0, y: 0 },
      { x: 88, y: 41 },
      { x: 31, y: -2 },
    ]) {
      const back = cropLocal(c, cropPoint(c, p));
      near(back.x, p.x);
      near(back.y, p.y);
    }
  }
});
test("all eight rotated crop handles leave their opposite edge or corner fixed", () => {
  const c = { x: 20, y: 10, width: 80, height: 40, rotation: 31 };
  for (const h of CROP_HANDLES) {
    const opposite = h.replace(/[nsew]/g, (x) => ({ n: "s", s: "n", e: "w", w: "e" })[x]!);
    const fixed = cropHandlePoint(c, opposite),
      start = cropHandlePoint(c, h),
      next = dragCrop(c, h, start, { x: start.x + 5, y: start.y + 4 }),
      end = cropHandlePoint(next, opposite);
    near(fixed.x, end.x);
    near(fixed.y, end.y);
    assert.ok(Number.isInteger(next.width) && Number.isInteger(next.height));
  }
});
test("aspect-locked crop handles resize both dimensions and keep anchor fixed", () => {
  const c = { x: 10, y: 10, width: 80, height: 40, rotation: 0 },
    start = cropHandlePoint(c, "se"),
    next = dragCrop(c, "se", start, { x: start.x + 40, y: start.y + 9 }, 2);
  assert.deepEqual(next, { ...c, width: 120, height: 60 });
  const edge = dragCrop(c, "s", cropHandlePoint(c, "s"), { x: 50, y: 70 }, 2);
  assert.equal(edge.width, 120);
  assert.equal(edge.height, 60);
  assert.equal(edge.x, -10);
  assert.equal(edge.y, 10);
});
test("aspect corner follows vertical-only input as well as horizontal input", () => {
  const c = { x: 10, y: 10, width: 80, height: 40, rotation: 0 },
    start = cropHandlePoint(c, "se"),
    next = dragCrop(c, "se", start, { x: start.x, y: start.y + 20 }, 2);
  assert.deepEqual(next, { ...c, width: 120, height: 60 });
});
test("reverse crop drawing, move, and minimum one-pixel extent", () => {
  const c = fullCrop(document());
  assert.deepEqual(dragCrop(c, "draw", { x: 30, y: 40 }, { x: 10, y: 15 }), {
    x: 10,
    y: 15,
    width: 20,
    height: 25,
    rotation: 0,
  });
  assert.deepEqual(dragCrop(c, "move", { x: 10, y: 10 }, { x: 20, y: -2 }), {
    ...c,
    x: 10,
    y: -12,
  });
  assert.equal(dragCrop(c, "w", { x: 0, y: 0 }, { x: 1000, y: 0 }).width, 1);
});
test("output affine matrix maps rotated crop corners into exact resampled output dimensions", () => {
  const d = document();
  d.crop = { x: 12, y: 9, width: 80, height: 40, rotation: 23 };
  d.imageSize = { width: 240, height: 60, resampling: "bicubic" };
  const [a, b, c, e, x, y] = outputMatrix(d);
  for (const p of [
    { x: 0, y: 0 },
    { x: 80, y: 40 },
    { x: 22, y: 17 },
  ]) {
    const q = cropPoint(d.crop, p);
    near(a * q.x + c * q.y + x, p.x * 3);
    near(b * q.x + e * q.y + y, p.y * 1.5);
  }
  assert.equal(outputSize(d).width, 240);
});
test("crop, canvas size, and image size history preserve every original layer and mask", () => {
  const d = document();
  d.layers[0]!.mask = {
    selection: { inverted: true, feather: 0, regions: [] },
    strokes: [],
    enabled: true,
  };
  let h = createHistory(d);
  h = record(h, { ...d, crop: { x: 10, y: 5, width: 60, height: 40, rotation: 5 } });
  h = record(h, { ...h.present, imageSize: { width: 30, height: 20, resampling: "lanczos" } });
  h = record(h, { ...h.present, width: 200, height: 100 });
  assert.strictEqual(h.present.layers, d.layers);
  assert.strictEqual(h.present.source, d.source);
  assert.deepEqual(undo(undo(undo(h))).present, d);
  const restored = redo(redo(redo(undo(undo(undo(h))))));
  assert.deepEqual(restored.present, h.present);
});
test("native save/reopen retains exact crop, resampling, editable text, masks and original bytes", async () => {
  const d = document();
  d.crop = { x: 12.25, y: -3, width: 83, height: 52, rotation: -6.7 };
  d.imageSize = { width: 166, height: 104, resampling: "lanczos" };
  d.layers.push(layer("text", 20, 30));
  const session: ProSession = {
      document: d,
      assets: { source: new Blob(["original bytes"], { type: "image/png" }) },
      revision: 0,
      acceptedBlobId: "original",
      updatedAt: 0,
    },
    restored = await readNative(await nativeFile(session), d.panelId, "original");
  assert.deepEqual(restored.document, d);
  assert.equal(await restored.assets.source!.text(), "original bytes");
});
test("malformed crop and output metadata is rejected on native validation", () => {
  for (const crop of [
    null,
    { x: 0, y: 0, width: 2.5, height: 4, rotation: 0 },
    { x: Infinity, y: 0, width: 2, height: 4, rotation: 0 },
    { x: 0, y: 0, width: 5000, height: 5000, rotation: 0 },
    { x: 0, y: 0, width: 2, height: 4, rotation: 181 },
  ])
    assert.throws(
      () => validateDocument({ ...document(), crop } as unknown as ReturnType<typeof document>),
      /crop/,
    );
  for (const imageSize of [
    null,
    { width: 0, height: 4, resampling: "nearest" },
    { width: 20, height: 40, resampling: "fake" },
  ])
    assert.throws(
      () =>
        validateDocument({ ...document(), imageSize } as unknown as ReturnType<typeof document>),
      /image size/,
    );
});
test("SVG export retains editable vector geometry and applies crop, rotation and output scaling", () => {
  const d = document(),
    s = layer("shape", 25, 30);
  d.layers = [s];
  d.crop = { x: 10, y: 8, width: 60, height: 40, rotation: 10 };
  d.imageSize = { width: 120, height: 80, resampling: "nearest" };
  const svg = vectorSvg(d);
  assert.ok(svg.includes('viewBox="0 0 120 80"'));
  assert.ok(svg.includes(`matrix(${outputMatrix(d).join(" ")})`));
  assert.ok(svg.includes('clip-path="url(#canvas)"'));
  assert.ok(svg.includes("<path "));
});
