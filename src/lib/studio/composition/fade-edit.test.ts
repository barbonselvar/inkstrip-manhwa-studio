import { test } from "node:test";
import assert from "node:assert/strict";
import { fade, validateFade, type Fade } from "./model.ts";
import { boundary, boundaryOffset } from "./boundaries.ts";
import { fadeCoverage } from "./masks.ts";
import {
  describeFade,
  editableEdgeFade,
  fadeBand,
  fadeExtension,
  fromDrawing,
  hitFade,
  insertPoint,
  lineY,
  moveFade,
  movePoint,
  removePoint,
  resetAppearance,
  resetPosition,
  resizeSide,
  reverseFade,
  setAmplitude,
  setDepth,
  smoothPoints,
  toEditable,
  uniqueFadeName,
} from "./fade-edit.ts";

const W = 800,
  H = 1200;
const shaped = (
  shape: Parameters<typeof boundary>[0] = "Wave",
  placement: "Top" | "Bottom" | "Both" = "Top",
): Fade => ({
  ...fade(),
  name: `${shape} fade`,
  boundary: { ...boundary(shape), placement },
});
const grid = (f: Fade, w = W, h = H) => {
  const out: number[] = [];
  for (let y = -200; y <= h + 200; y += 37)
    for (let x = 0; x <= w; x += 53) out.push(fadeCoverage(f, x, y, w, h));
  return out;
};

test("legacy fades keep identical coverage; new fields are optional and validated", () => {
  const f = shaped("Organic");
  // Reference: the pre-upgrade formula (no extent fields, offset per pixel).
  for (let y = 0; y < H; y += 41)
    for (let x = 0; x < W; x += 29) {
      const offset = boundaryOffset(f.boundary!, x / W),
        expected = Math.max(0, Math.min(1, 1 - (y - offset - f.start) / (f.length + f.feather)));
      assert.ok(Math.abs(fadeCoverage(f, x, y, W, H) - expected) < 1e-12);
    }
  validateFade(f);
  validateFade({ ...f, start: -900, x: -20, width: 300, softness: 40, extend: true });
  assert.throws(() => validateFade({ ...f, softness: -1 }));
  assert.throws(() => validateFade({ ...f, width: 0 }));
  assert.throws(() => validateFade({ ...f, extend: "yes" as never }));
  // Legacy fades never paint outside their image, even when their ramp passes the edge.
  assert.deepEqual(fadeExtension({ ...f, start: -500 }, H), { above: 0, below: 0 });
});

test("moving is unrestricted up and down; leaving the image enables extension", () => {
  const f = shaped("Straight");
  const down = moveFade(f, "top", 0, 2600, W, H);
  assert.equal(down.start, 2600);
  assert.equal(down.extend, true, "band below the image extends into spacing");
  assert.ok(fadeExtension(down, H).below > 0);
  const up = moveFade(f, "top", 0, -800, W, H);
  assert.equal(up.start, -800);
  assert.ok(fadeExtension(up, H).above >= 800 - 350);
  // Full-width fades ignore horizontal drift; narrowed fades move horizontally too.
  assert.equal(moveFade(f, "top", 120, 10, W, H).x, undefined);
  const narrow = resizeSide(f, "right", 400, W);
  assert.equal(moveFade(narrow, "top", 120, 0, W, H).x, 120);
  // Bottom placement: dragging down moves the band down (start shrinks).
  const bottom = shaped("Straight", "Bottom");
  assert.equal(moveFade(bottom, "bottom", 0, 100, W, H).start, -100);
  // The mint line follows the pointer exactly.
  const moved = moveFade(f, "top", 0, 333, W, H);
  assert.equal(lineY(moved, "top", 0.5, 0.5, H) - lineY(f, "top", 0.5, 0.5, H), 333);
});

test("depth, density and softness are independent controls", () => {
  const f = shaped("Straight");
  const deeper = setDepth(f, "top", 0.5, 900, H);
  assert.equal(deeper.length, 900);
  assert.equal(deeper.start, f.start);
  assert.equal(deeper.opacity, f.opacity);
  assert.equal(deeper.softness, f.softness);
  // Depth changes the transition distance: coverage at y=500 rises.
  assert.ok(fadeCoverage(deeper, 100, 500, W, H) > fadeCoverage(f, 100, 500, W, H));
  // Density scales intensity only; 0 hides it entirely, 1 restores full strength.
  assert.ok(grid({ ...f, opacity: 0 }).every((v) => v === 0));
  assert.equal(fadeCoverage({ ...f, opacity: 1 }, 100, 0, W, H), 1);
  assert.equal(fadeCoverage({ ...f, opacity: 0.4 }, 100, 0, W, H), 0.4);
  // Softness is a renderer blur: it never alters the analytic ramp.
  assert.deepEqual(grid({ ...f, softness: 80 }), grid(f));
});

test("points move freely: amplitude and start adapt instead of clamping", () => {
  const f = toEditable(shaped("Wave"));
  assert.equal(f.boundary!.shape, "Freehand");
  // Sampled conversion keeps the original look at the sample points.
  for (let i = 0; i <= 8; i++)
    assert.ok(
      Math.abs(lineY(f, "top", i / 8, 0.5, H) - lineY(shaped("Wave"), "top", i / 8, 0.5, H)) < 1e-6,
    );
  const target = { x: W * 0.5, y: 1500 };
  const index = 4;
  const moved = movePoint(f, "top", index, target, W, H);
  assert.ok(moved.boundary!.points.every((p) => p.y >= 0 && p.y <= 1));
  assert.ok(Math.abs(lineY(moved, "top", moved.boundary!.points[index]!.x, 0.5, H) - 1500) < 0.5);
  assert.ok(moved.boundary!.amplitude > f.boundary!.amplitude);
  assert.equal(moved.extend, true);
  // Above the image as well.
  const above = movePoint(f, "top", 0, { x: 0, y: -400 }, W, H);
  assert.ok(Math.abs(lineY(above, "top", 0, 0.5, H) + 400) < 0.5);
});

test("add, remove and smooth custom points; freehand edits keep their shape", () => {
  const f = toEditable(shaped("Zigzag"));
  const added = insertPoint(f, "top", { x: 333, y: 600 }, W, H);
  assert.equal(added.boundary!.points.length, f.boundary!.points.length + 1);
  const i = added.boundary!.points.findIndex((p) => Math.abs(p.x - 333 / W) < 1e-9);
  assert.ok(i > 0);
  // Freehand profiles render from 1/1024 samples (unchanged for saved fades), so a sharp
  // new peak can sit a pixel or two inside its control point.
  assert.ok(Math.abs(lineY(added, "top", 333 / W, 0.5, H) - 600) < 3);
  const removed = removePoint(added, i);
  assert.equal(removed.boundary!.points.length, f.boundary!.points.length);
  assert.equal(
    removePoint({ ...f, boundary: { ...f.boundary!, points: f.boundary!.points.slice(0, 2) } }, 0)
      .boundary!.points.length,
    2,
  );
  const smooth = smoothPoints(f, 3),
    spread = (x: Fade) => {
      const ys = x.boundary!.points.map((_, k, a) => lineY(x, "top", k / (a.length - 1), 0.5, H));
      return Math.max(...ys) - Math.min(...ys);
    };
  assert.ok(spread(smooth) < spread(f));
  // End points stay where they were.
  assert.ok(Math.abs(lineY(smooth, "top", 0, 0.5, H) - lineY(f, "top", 0, 0.5, H)) < 1e-6);
});

test("a drawn mint line becomes an editable freehand fade through the drawn points", () => {
  const drawn = Array.from({ length: 200 }, (_, i) => ({
    x: (i / 199) * W,
    y: 300 + 120 * Math.sin(i / 20),
  }));
  const f = fromDrawing(shaped("Straight"), "top", drawn, W, H);
  assert.equal(f.boundary!.shape, "Freehand");
  assert.ok(f.boundary!.points.length <= 128);
  for (const p of drawn.filter((_, i) => i % 13 === 0)) {
    const y = lineY(f, "top", p.x / W, 0.5, H);
    assert.ok(Math.abs(y - p.y) < 3, `drawn ${p.y} vs ${y}`);
  }
});

test("resizing narrows the fade; coverage outside its width is zero", () => {
  const f = resizeSide(resizeSide(shaped("Straight"), "left", 200, W), "right", 500, W);
  assert.deepEqual([f.x, f.width], [200, 300]);
  assert.equal(fadeCoverage(f, 100, 0, W, H), 0);
  assert.equal(fadeCoverage(f, 350, 0, W, H), 1);
  assert.equal(fadeCoverage(f, 700, 0, W, H), 0);
  // Shape scales with the width: u is relative to the narrowed span.
  const wave = resizeSide(shaped("Wave"), "right", 400, W);
  assert.ok(
    Math.abs(lineY(wave, "top", 1, 0.5, H) - lineY(shaped("Wave"), "top", 1, 0.5, H)) < 1e-9,
  );
});

test("amplitude handle flips the curve when dragged past the edge", () => {
  const f = shaped("Curved");
  const flipped = setAmplitude(f, "top", { x: 200, y: -300 }, H);
  assert.equal(flipped.boundary!.direction, -f.boundary!.direction);
  assert.ok(flipped.boundary!.amplitude > 0);
});

test("hit testing, band extents, reversal, resets and naming", () => {
  const f = shaped("Straight");
  assert.equal(hitFade(f, { x: 400, y: 100 }, W, H), "top");
  assert.equal(hitFade(f, { x: 400, y: 1000 }, W, H), null);
  assert.equal(hitFade({ ...f, visible: false }, { x: 400, y: 100 }, W, H), null);
  const both = shaped("Straight", "Both");
  assert.equal(hitFade(both, { x: 400, y: 1100 }, W, H), "bottom");
  assert.deepEqual(fadeBand(f, H), { top: 0, bottom: 350 });
  assert.equal(reverseFade(f).boundary!.placement, "Bottom");
  assert.deepEqual(reverseFade(fade("Top Fade")).edges, ["bottom"]);
  const moved = { ...f, start: -300, x: 10, width: 200, opacity: 0.2, softness: 9, length: 99 };
  assert.deepEqual(
    [resetPosition(moved).start, resetPosition(moved).x, resetPosition(moved).width],
    [0, undefined, undefined],
  );
  assert.deepEqual(
    [
      resetAppearance(moved).opacity,
      resetAppearance(moved).softness,
      resetAppearance(moved).length,
    ],
    [1, 0, 350],
  );
  assert.equal(
    uniqueFadeName([f, { ...f, name: "Straight fade 2" }], "Straight fade"),
    "Straight fade 3",
  );
  assert.match(describeFade(f), /Straight · top · 350 px · 100%/);
});

test("classic top/bottom fades convert to an editable boundary with identical pixels", () => {
  for (const type of ["Top Fade", "Bottom Fade"] as const) {
    const classic = { ...fade(type), start: 40, feather: 30, curve: 1.6, opacity: 0.8 };
    const editable = editableEdgeFade(classic)!;
    assert.ok(editable.boundary);
    assert.deepEqual(grid(editable), grid(classic));
  }
  assert.equal(editableEdgeFade(fade("Radial Fade")), null);
});
