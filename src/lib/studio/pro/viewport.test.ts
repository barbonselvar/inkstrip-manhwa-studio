import test from "node:test";
import assert from "node:assert/strict";
import {
  viewAngle,
  rotatePoint,
  viewFit,
  documentToViewport,
  viewportToDocument,
  rotateCanvasView,
  frameHandleAt,
  canvasPoint,
  type CanvasView,
} from "./viewport.ts";
import { CROP_HANDLES, cropHandlePoint } from "./geometry.ts";
const frame = { x: -48, y: 27, width: 1200, height: 800 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("measured CSS dimensions retain exact low-zoom source coordinates on independently rounded axes", () => {
  const f = { x: 0, y: 0, width: 128, height: 96 },
    rect = { left: 137.671875, top: 429.375, width: 44.65625, height: 33.5 };
  const p = canvasPoint(
    { x: rect.left + (rect.width * 74) / 128, y: rect.top + (rect.height * 58) / 96 },
    rect,
    f,
    0,
  );
  near(p.x, 74);
  near(p.y, 58);
});
test("measured quarter-turn mapping reverses rotation, nonzero frames, zoom and pan with CSS rounding", () => {
  const f = { x: -48, y: 27, width: 128, height: 96 };
  for (const rotation of [0, 90, -90, -180])
    for (const zoom of [1, 1.25, 7]) {
      const w = 44.65625 * zoom,
        h = 33.5 * zoom,
        quarter = Math.abs(rotation) === 90;
      const rect = { left: 80, top: 203, width: quarter ? h : w, height: quarter ? w : h };
      for (const p of [
        { x: -48, y: 27 },
        { x: 26, y: 85 },
        { x: 80, y: 123 },
      ]) {
        const q = rotatePoint(
          {
            x: ((p.x - f.x - f.width / 2) * w) / f.width,
            y: ((p.y - f.y - f.height / 2) * h) / f.height,
          },
          rotation,
        );
        const actual = canvasPoint(
          { x: rect.left + rect.width / 2 + q.x, y: rect.top + rect.height / 2 + q.y },
          rect,
          f,
          rotation,
        );
        near(actual.x, p.x);
        near(actual.y, p.y);
      }
    }
});
test("overlapping44px artboard targets acquire the nearest geometric handle at every zoom", () => {
  const b = { x: -16, y: 12, width: 128, height: 96 };
  for (const scale of [0.01, 0.348958333, 1, 5])
    for (const handle of CROP_HANDLES) {
      const p = cropHandlePoint({ ...b, rotation: 0 }, handle);
      assert.equal(frameHandleAt(b, p, scale), handle);
      assert.equal(frameHandleAt(b, { x: p.x + 1e-9, y: p.y - 1e-9 }, scale), handle);
    }
});
test("tiny artboard center stays movable even when every touch handle overlaps it", () => {
  const b = { x: 0, y: 0, width: 128, height: 96 };
  for (const scale of [0.01, 0.348958333, 1, 5]) {
    assert.equal(frameHandleAt(b, { x: 64, y: 48 }, scale), "move");
    assert.equal(frameHandleAt(b, { x: 76, y: 48 }, scale), "move");
  }
});
test("artboard handle acquisition keeps a22px screen tolerance and safe invalid-scale fallback", () => {
  const b = { x: 0, y: 0, width: 1000, height: 1000 };
  for (const scale of [0.5, 2, 8]) {
    assert.equal(frameHandleAt(b, { x: 1000 + 20 / scale, y: 1000 }, scale), "se");
    assert.equal(frameHandleAt(b, { x: 1000 + 23 / scale, y: 1000 }, scale), "move");
  }
  assert.equal(frameHandleAt(b, { x: 0, y: 0 }, NaN), "move");
});
test("canvas angles wrap left/right quarter turns and reset without document mutation", () => {
  assert.equal(viewAngle(90), 90);
  assert.equal(viewAngle(-90), -90);
  assert.equal(viewAngle(270), -90);
  assert.equal(viewAngle(360), 0);
  assert.equal(viewAngle(-450), -90);
  assert.throws(() => viewAngle(NaN));
  const p = rotatePoint({ x: 10, y: 20 }, 90);
  near(p.x, -20);
  near(p.y, 10);
});
test("rotated fitting contains all four corners on phone, tablet and desktop", () => {
  for (const width of [320, 360, 390, 768, 1440])
    for (const rotation of [0, 90, -90, -180, 37]) {
      const size = { width, height: 600 },
        fit = viewFit(size, frame, rotation);
      for (const x of [frame.x, frame.x + frame.width])
        for (const y of [frame.y, frame.y + frame.height]) {
          const p = documentToViewport({ x, y }, frame, fit, { zoom: 1, x: 0, y: 0, rotation });
          assert.ok(Math.abs(p.x) <= (width - 64) / 2 + 1e-8);
          assert.ok(Math.abs(p.y) <= (size.height - 64) / 2 + 1e-8);
        }
    }
});
test("inverse mapping retains source coordinates through rotation, frame origin, zoom and pan", () => {
  for (const rotation of [0, 90, -90, -180, 33])
    for (const zoom of [0.1, 1, 3, 12]) {
      const view = { rotation, zoom, x: 89, y: -57 };
      for (const point of [
        { x: -12, y: 68 },
        { x: 0, y: 0 },
        { x: 320, y: 190 },
      ]) {
        const q = viewportToDocument(
          documentToViewport(point, frame, 0.37, view),
          frame,
          0.37,
          view,
        );
        near(q.x, point.x);
        near(q.y, point.y);
      }
    }
});
test("rotation and reset preserve the source point under viewport center at every zoom", () => {
  const size = { width: 390, height: 500 };
  for (const zoom of [0.1, 1, 7]) {
    let view: CanvasView = { zoom, x: 63, y: -29, rotation: 0 };
    const original = { ...view },
      center = viewportToDocument({ x: 0, y: 0 }, frame, viewFit(size, frame), view);
    for (const angle of [90, -180, -90, 0]) {
      view = rotateCanvasView(view, angle, size, frame);
      const p = viewportToDocument({ x: 0, y: 0 }, frame, viewFit(size, frame, angle), view);
      near(p.x, center.x);
      near(p.y, center.y);
      near(view.zoom, zoom);
    }
    near(view.x, original.x);
    near(view.y, original.y);
    assert.deepEqual(original, { zoom, x: 63, y: -29, rotation: 0 });
  }
});
