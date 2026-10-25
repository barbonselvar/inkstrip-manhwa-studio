import test from "node:test";
import assert from "node:assert/strict";
import { defaultGradient, gradientField, gradientPixels, type Gradient } from "./gradient.ts";
import {
  addGradientLayer,
  gradientFromDrag,
  gradientLayerHandles,
  gradientToolPresets,
  moveGradientLayerHandle,
  reverseStops,
} from "./raster-gradient.ts";
import { fromPanel, validateDocument } from "./model.ts";

const W = 200,
  H = 100;
const blackWhite = (kind: Gradient["kind"]): Gradient => ({
  ...defaultGradient(),
  kind,
  ...(kind === "radial" ? { radialShape: "circle" as const } : {}),
});
const close = (a: { x: number; y: number }, b: { x: number; y: number }, e = 1e-6) =>
  Math.hypot(a.x - b.x, a.y - b.y) < e;

test("linear drag: first stop at the start point, last stop at the end point", () => {
  const g = gradientFromDrag(blackWhite("linear"), { x: 40, y: 30 }, { x: 160, y: 70 }, W, H)!;
  const h = gradientLayerHandles(g, W, H);
  assert.ok(close(h.start, { x: 40, y: 30 }, 1e-3));
  assert.ok(close(h.end, { x: 160, y: 70 }, 1e-3));
  const field = gradientField(g, W, H);
  assert.ok(field(40, 30)[0]! < 0.01); // black
  assert.ok(field(160, 70)[0]! > 0.99); // white
  assert.ok(Math.abs(field(100, 50)[0]! - 0.5) < 0.01);
  // Beyond the end the last stop extends (pad), as in Photoshop.
  assert.ok(field(199, 99)[0]! > 0.99);
  assert.equal(gradientFromDrag(g, { x: 5, y: 5 }, { x: 6, y: 5 }, W, H), null);
});

test("radial circle drag: last stop at the drag radius in every direction", () => {
  const g = gradientFromDrag(blackWhite("radial"), { x: 100, y: 50 }, { x: 140, y: 50 }, W, H)!;
  const field = gradientField(g, W, H);
  assert.ok(field(100, 50)[0]! < 0.01);
  for (const [x, y] of [
    [140, 50],
    [100, 90],
    [60, 50],
  ] as const)
    assert.ok(Math.abs(field(x, y)[0]! - 1) < 0.01, `${x},${y}`);
  // Older elliptical radial layers render exactly as before.
  const ellipse = { ...g, radialShape: undefined };
  assert.ok(gradientField(ellipse, W, H)(100, 70)[0]! > 0.99);
});

test("handles move independently; center drag translates without changing length", () => {
  const g = gradientFromDrag(blackWhite("linear"), { x: 20, y: 50 }, { x: 120, y: 50 }, W, H)!;
  const moved = moveGradientLayerHandle(g, W, H, "end", { x: 180, y: 50 })!;
  const h = gradientLayerHandles(moved, W, H);
  assert.ok(close(h.start, { x: 20, y: 50 }, 1e-3));
  assert.ok(close(h.end, { x: 180, y: 50 }, 1e-3));
  const shifted = gradientLayerHandles(
    moveGradientLayerHandle(g, W, H, "center", { x: 90, y: 60 })!,
    W,
    H,
  );
  assert.ok(close(shifted.start, { x: 40, y: 60 }, 1e-3));
  assert.ok(close(shifted.end, { x: 140, y: 60 }, 1e-3));
  const r = gradientFromDrag(blackWhite("radial"), { x: 50, y: 50 }, { x: 80, y: 50 }, W, H)!,
    rc = gradientLayerHandles(moveGradientLayerHandle(r, W, H, "center", { x: 70, y: 40 })!, W, H);
  assert.ok(close(rc.center, { x: 70, y: 40 }, 1e-3));
  assert.ok(close(rc.end, { x: 100, y: 40 }, 1e-3));
});

test("reverse, presets with opacity stops and a selection-masked gradient layer", () => {
  const stops = gradientToolPresets("#ff0000")["Foreground to transparent"]!;
  assert.deepEqual(
    stops.map((s) => [s.color, s.opacity]),
    [
      ["#ff0000", 1],
      ["#ff0000", 0],
    ],
  );
  assert.deepEqual(
    reverseStops(stops).map((s) => [s.position, s.opacity]),
    [
      [0, 0],
      [1, 1],
    ],
  );
  const spectrum = gradientToolPresets("#000000").Spectrum!;
  assert.equal(spectrum.length, 7);
  // Opacity stops are real transparency in the rendered pixels.
  const px = gradientPixels(10, 1, { ...defaultGradient(), stops });
  assert.ok(px[3]! > 240 && px[39]! < 20);

  const d = fromPanel({ id: "p", name: "p", width: 40, height: 30 });
  const g = gradientFromDrag(blackWhite("linear"), { x: 0, y: 0 }, { x: 40, y: 0 }, 40, 30)!;
  const plain = addGradientLayer(d, g);
  validateDocument(plain.document);
  const added = plain.document.layers.at(-1)!;
  assert.equal(added.kind, "gradient");
  assert.equal(added.mask, undefined);
  const masked = addGradientLayer(d, g, {
    regions: [
      {
        kind: "rectangle",
        operation: "add",
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 30 },
        ],
      },
    ],
    inverted: false,
    feather: 0,
  });
  validateDocument(masked.document);
  assert.equal(masked.document.layers.at(-1)!.mask?.enabled, true);
});
