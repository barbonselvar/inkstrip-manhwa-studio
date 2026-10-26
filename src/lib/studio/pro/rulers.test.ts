import test from "node:test";
import assert from "node:assert/strict";
import { documentToViewport } from "./viewport.ts";
import { documentToRuler, niceStep, rulerMap, rulerTicks, rulerToDocument } from "./rulers.ts";

const frame = { x: 0, y: 0, width: 800, height: 6000 },
  viewport = { width: 1000, height: 700 };

test("ruler map matches the canvas transform at any zoom and pan", () => {
  for (const view of [
    { zoom: 1, x: 0, y: 0, rotation: 0 },
    { zoom: 3.5, x: -420, y: 130, rotation: 0 },
    { zoom: 0.25, x: 77, y: -9, rotation: 0 },
  ]) {
    const fit = 0.1,
      top = rulerMap("top", viewport, frame, fit, view)!,
      left = rulerMap("left", viewport, frame, fit, view)!;
    assert.equal(top.axis, "x");
    assert.equal(left.axis, "y");
    for (const p of [
      { x: 0, y: 0 },
      { x: 123.4, y: 5000 },
      { x: 800, y: 6000 },
    ]) {
      const v = documentToViewport(p, frame, fit, view);
      assert.ok(Math.abs(documentToRuler(top, p.x) - (viewport.width / 2 + v.x)) < 1e-9);
      assert.ok(Math.abs(documentToRuler(left, p.y) - (viewport.height / 2 + v.y)) < 1e-9);
      assert.ok(Math.abs(rulerToDocument(top, documentToRuler(top, p.x)) - p.x) < 1e-9);
    }
  }
});

test("quarter-turn views swap axes; other rotations hide the rulers", () => {
  const view = { zoom: 1, x: 0, y: 0, rotation: 90 },
    top = rulerMap("top", viewport, frame, 0.1, view)!,
    left = rulerMap("left", viewport, frame, 0.1, view)!;
  assert.equal(top.axis, "y");
  assert.ok(top.scale < 0); // document y runs right-to-left after a 90° turn
  assert.equal(left.axis, "x");
  assert.equal(rulerMap("top", viewport, frame, 0.1, { ...view, rotation: 30 }), null);
  assert.equal(rulerMap("top", viewport, frame, 0.1, { ...view, rotation: 180 })!.axis, "x");
});

test("1-2-5 tick steps keep labels readable and land on exact values", () => {
  assert.equal(niceStep(1), 100);
  assert.equal(niceStep(0.1), 1000);
  assert.equal(niceStep(10), 10);
  assert.equal(niceStep(3), 50);
  const m = { axis: "x" as const, offset: 50, scale: 2 },
    ticks = rulerTicks(m, 500, 800, "px"),
    majors = ticks.filter((t) => t.major);
  assert.deepEqual(
    majors.map((t) => t.label),
    ["0", "50", "100", "150", "200"],
  );
  assert.equal(majors[1]!.at, 150); // 50 px · 2 + 50
  assert.ok(ticks.length > majors.length);
  const percent = rulerTicks(m, 500, 200, "%").filter((t) => t.major);
  // 200 px document: 100% sits at 50 + 2·200 = 450.
  assert.equal(percent.find((t) => t.value === 100)!.at, 450);
});
