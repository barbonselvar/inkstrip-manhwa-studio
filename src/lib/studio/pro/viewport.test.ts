import test from "node:test";
import assert from "node:assert/strict";
import {
  viewAngle,
  rotatePoint,
  viewFit,
  documentToViewport,
  viewportToDocument,
  rotateCanvasView,
  type CanvasView,
} from "./viewport.ts";
const frame = { x: -48, y: 27, width: 1200, height: 800 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
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
