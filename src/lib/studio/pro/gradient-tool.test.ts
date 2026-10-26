import { test } from "node:test";
import assert from "node:assert/strict";
import { advancedGradient, gradientField, validateGradient } from "./gradient.ts";
import { gradientFillHandles, gradientFromEndpoints } from "./gradient-tool.ts";
import { previewDirtyRect } from "./preview-dirty.ts";
import { fromPanel, layer, validateDocument } from "./model.ts";
import { advancedEffect } from "./effects.ts";
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
test("linear gradient endpoints retain the drawn source-local endpoints and sampled end colors", () => {
  const g = gradientFromEndpoints(advancedGradient(), { x: 20, y: 15 }, { x: 100, y: 70 }, 128, 96),
    h = gradientFillHandles(g, 128, 96),
    f = gradientField(g, 128, 96);
  near(h.from.x, 20);
  near(h.from.y, 15);
  near(h.to.x, 100);
  near(h.to.y, 70);
  near(f(h.from.x, h.from.y)[0], 0);
  near(f(h.to.x, h.to.y)[0], 1);
  validateGradient(g);
});
for (const kind of ["radial", "reflected", "diamond"] as const)
  test(`${kind} endpoint editing preserves center and represents normalized edge`, () => {
    const original = { ...advancedGradient(), kind },
      g = gradientFromEndpoints(original, { x: 40, y: 30 }, { x: 80, y: 70 }, 128, 96),
      h = gradientFillHandles(g, 128, 96),
      f = gradientField(g, 128, 96);
    near(h.from.x, 40);
    near(h.from.y, 30);
    near(h.to.x, 80);
    near(h.to.y, 70);
    near(f(h.from.x, h.from.y)[0], 0);
    near(f(h.to.x, h.to.y)[0], 1);
  });
test("zero/invalid drags are no-ops and extreme drags clamp geometry to native resource-safe ranges", () => {
  const g = advancedGradient();
  assert.equal(gradientFromEndpoints(g, { x: 0, y: 0 }, { x: 0, y: 0 }, 128, 96), g);
  assert.equal(gradientFromEndpoints(g, { x: NaN, y: 0 }, { x: 1, y: 1 }, 128, 96), g);
  const extreme = gradientFromEndpoints(g, { x: -1e8, y: -1e8 }, { x: 1, y: 1 }, 128, 96);
  assert.equal(extreme.scale, 10);
  validateGradient(extreme);
});
test("Smart Filters disable presentation dirty rectangles, including noise changes after painting", () => {
  const old = fromPanel({ id: "p", name: "Dirty", width: 128, height: 96 }),
    paint = layer("paint", 128, 96, "paint");
  old.layers = [paint];
  const stroke = {
      points: [{ x: 20, y: 20 }],
      size: 8,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#ff0000",
      erase: false,
    },
    next = { ...old, layers: [{ ...paint, strokes: [stroke] }] };
  assert.ok(previewDirtyRect(old, next, 128, 96));
  const f = { id: "blur", enabled: true, operation: { kind: "gaussian" as const, radius: 3 } };
  paint.smartFilters = [f];
  next.layers[0]!.smartFilters = paint.smartFilters;
  assert.equal(previewDirtyRect(old, next, 128, 96), null);
});
test("advanced native style work is checked before commit; disabled/hidden styles retain stored settings safely", () => {
  const d = fromPanel({ id: "big", name: "Big", width: 2000, height: 2000 });
  d.version = 3;
  const e = advancedEffect("dropShadow");
  d.layers[0]!.effects = [e];
  assert.throws(() => validateDocument(d), /4MP/);
  e.enabled = false;
  validateDocument(d);
  e.enabled = true;
  d.layers[0]!.visible = false;
  validateDocument(d);
});
