import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAB_DEFAULTS,
  MAX_DAB_PATH,
  MAX_STROKE_POINTS,
  appendBrushSample,
  brushDabs,
  brushPoint,
  finishBrushStroke,
  pressureResponse,
} from "./brush-dynamics.ts";
import { brushCursor } from "./brush-cursor.ts";
import {
  PROFESSIONAL_BRUSH_PRESETS,
  DEFAULT_BRUSH_PRESETS,
  availableBrushPresets,
  canDeleteBrushPreset,
  duplicateBrushPreset,
  loadPressureGamma,
  renameBrushPreset,
  resetBrushPresets,
  savePressureGamma,
  upsertBrushPreset,
  validateBrushPreset,
} from "./brush-presets.ts";
import { fromPanel, layer, validateDocument, type Stroke } from "./model.ts";
import { applyMatrix } from "./transform.ts";

const near = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  points: [{ x: 0, y: 0, time: 0 }],
  size: 12,
  hardness: 1,
  opacity: 1,
  flow: 1,
  color: "#000000",
  erase: false,
  ...over,
});
/** Feed samples exactly as the canvas does, optionally finishing on release. */
function record(
  s: Stroke,
  samples: { x: number; y: number; time?: number; pressure?: number }[],
  pointerType = "mouse",
  gamma = 1,
) {
  let filtered: Stroke["points"][number] | undefined,
    length: number | undefined,
    full = false;
  for (const p of samples) {
    if (full) break;
    const r = appendBrushSample(
      s,
      filtered,
      { x: p.x, y: p.y, time: p.time },
      { pointerType, pressure: p.pressure ?? 0.5, pressureGamma: gamma },
      length,
    );
    filtered = r.filtered;
    length = r.length;
    full = r.full;
  }
  return { filtered, full, length };
}
const fast = Array.from({ length: 20 }, (_, i) => ({ x: (i + 1) * 15, y: 0, time: (i + 1) * 16 }));

test("smoothed and stabilized strokes finish exactly at the release point", () => {
  for (const smoothing of [0.3, 0.5, 0.95])
    for (const stabilization of [0, 20]) {
      const s = stroke({ smoothing, dynamics: { ...DAB_DEFAULTS, stabilization } }),
        { filtered } = record(s, fast);
      // The audited behaviour: the filtered pen position trails the real pointer.
      assert.ok(filtered!.x < 295, `lag expected before release (${filtered!.x})`);
      finishBrushStroke(s, filtered, { x: 300, y: 0, time: 330 });
      assert.deepEqual([s.points.at(-1)!.x, s.points.at(-1)!.y], [300, 0]);
      assert.ok(s.points.at(-1)!.time! >= s.points.at(-2)!.time!);
    }
  // Unsmoothed strokes already end at the pointer; finishing adds nothing.
  const plain = stroke();
  const { filtered } = record(plain, fast);
  const before = plain.points.length;
  finishBrushStroke(plain, filtered, { x: 300, y: 0 });
  assert.equal(plain.points.length, before);
  // A tap (no movement) stays a single dot.
  const dot = stroke({ smoothing: 0.9 });
  finishBrushStroke(dot, undefined, { x: 0, y: 0 });
  assert.equal(dot.points.length, 1);
});

test("long and slow strokes stay inside the point budget, validate and keep their shape", () => {
  // 1 kHz mouse, slow hand: 0.05 px per sample over 60,000 samples (3,000 px).
  const slow = Array.from({ length: 60_000 }, (_, i) => ({
    x: i * 0.05,
    y: Math.sin(i / 4000) * 200,
  }));
  const s = stroke({ size: 24, dynamics: { ...DAB_DEFAULTS } });
  const { full, filtered } = record(s, slow);
  assert.equal(full, false);
  // Bounded by path length / recording step, not by the 60,000 input samples.
  let length = 0;
  for (let i = 1; i < slow.length; i++)
    length += Math.hypot(slow[i]!.x - slow[i - 1]!.x, slow[i]!.y - slow[i - 1]!.y);
  assert.ok(
    s.points.length <= (length / Math.max(0.25, s.size * 0.02)) * 1.2 + 2,
    `${s.points.length} points for ${Math.round(length)} px`,
  );
  assert.ok(s.points.length < MAX_STROKE_POINTS);
  finishBrushStroke(s, filtered, slow.at(-1)!);
  // Every input sample lies within one recording step of the stored polyline.
  const step = Math.max(0.25, s.size * 0.02);
  for (let i = 0; i < slow.length; i += 997) {
    const p = slow[i]!;
    let best = Infinity;
    for (let k = 1; k < s.points.length; k++) {
      const a = s.points[k - 1]!,
        b = s.points[k]!,
        dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
        );
      best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
    }
    assert.ok(best <= step + 1e-9, `deviation ${best}`);
  }
  const d = fromPanel({ id: "r3", name: "R3", width: 3200, height: 600 }),
    paint = layer("paint", 3200, 600, "paint");
  paint.strokes = [s];
  d.layers = [paint];
  assert.doesNotThrow(() => validateDocument(d));
});

test("a stroke that reaches the point limit ends there instead of failing to commit", () => {
  const s = stroke({ size: 1 });
  const zigzag = Array.from({ length: 30_000 }, (_, i) => ({ x: i % 2 ? 40 : 0, y: i * 0.01 }));
  const { full, filtered } = record(s, zigzag);
  assert.equal(full, true);
  assert.equal(s.points.length, MAX_STROKE_POINTS);
  finishBrushStroke(s, filtered, { x: 500, y: 500 });
  assert.equal(s.points.length, MAX_STROKE_POINTS);
  const again = appendBrushSample(
    s,
    filtered,
    { x: 9, y: 9 },
    { pointerType: "mouse", pressure: 1 },
  );
  assert.equal(again.full, true);
  assert.equal(s.points.length, MAX_STROKE_POINTS);
  const d = fromPanel({ id: "r3", name: "R3", width: 600, height: 600 }),
    paint = layer("paint", 600, 600, "paint");
  paint.strokes = [s];
  d.layers = [paint];
  assert.doesNotThrow(() => validateDocument(d));
});

test("pressure response curve shapes measured pen pressure only", () => {
  near(pressureResponse(0.5, 1), 0.5);
  near(pressureResponse(0.5, 2), 0.25);
  near(pressureResponse(0.25, 0.5), 0.5);
  assert.equal(pressureResponse(0, 2), 0.05);
  assert.equal(pressureResponse(2, 0.5), 1);
  near(pressureResponse(0.5, 99), pressureResponse(0.5, 4));
  near(pressureResponse(0.5, Number.NaN), 0.5);
  // Mouse/touch never get a pressure value, whatever the curve.
  assert.equal(
    brushPoint(undefined, { x: 0, y: 0 }, "mouse", 0.5, true, 0, 0, 0.25).pressure,
    undefined,
  );
  assert.equal(
    brushPoint(undefined, { x: 0, y: 0 }, "touch", 0.5, true, 0, 0, 0.25).pressure,
    undefined,
  );
  near(brushPoint(undefined, { x: 0, y: 0 }, "pen", 0.5, true, 0, 0, 2).pressure!, 0.25);
  // Recorded pen pressure drives rendered dab size; release keeps the last real value.
  const s = stroke({ size: 20, sizePressure: true, dynamics: { ...DAB_DEFAULTS } });
  s.points = [brushPoint(undefined, { x: 0, y: 0 }, "pen", 0.81, true, 0, 0, 0.5)];
  const { filtered } = record(
    s,
    [
      { x: 10, y: 0, pressure: 0.81 },
      { x: 20, y: 0, pressure: 0.81 },
    ],
    "pen",
    0.5,
  );
  finishBrushStroke(s, filtered, { x: 30, y: 0 });
  for (const p of s.points) near(p.pressure!, 0.9);
  for (const dab of brushDabs(s)) near(dab.radius, 9);
  // A pressure change alone (pen held still) is recorded.
  const still = stroke({ sizePressure: true });
  still.points = [brushPoint(undefined, { x: 0, y: 0 }, "pen", 0.2, true, 0)];
  record(still, [{ x: 0.01, y: 0, pressure: 0.9 }], "pen");
  assert.equal(still.points.length, 2);
});

test("brush cursor shows the real dab footprint in layer and mask frames", () => {
  const l = layer("paint", 400, 300, "paint");
  l.transform = { x: 50, y: 20, scaleX: 2, scaleY: 0.5, rotation: 30 };
  const brush = {
      size: 20,
      hardness: 0.5,
      tip: "round" as const,
      dynamics: { ...DAB_DEFAULTS, roundness: 0.5, angle: 40 },
    },
    point = { x: 180, y: 140 },
    c = brushCursor(l, false, point, brush, "brush")!;
  const back = applyMatrix(c.matrix, c.center);
  near(back.x, point.x, 1e-9);
  near(back.y, point.y, 1e-9);
  assert.deepEqual([c.rx, c.ry, c.angle, c.square, c.hardness], [10, 5, 40, false, 0.5]);
  // Document-space extent follows the layer scale (the old cursor ignored it).
  const edge = applyMatrix(c.matrix, { x: c.center.x + 10, y: c.center.y });
  near(Math.hypot(edge.x - back.x, edge.y - back.y), 20, 1e-9);
  const pencil = brushCursor(l, false, point, brush, "pencil")!;
  assert.equal(pencil.square, true);
  assert.equal(pencil.hardness, undefined);
  l.mask = {
    enabled: true,
    inverted: false,
    selection: { regions: [], inverted: true, feather: 0 },
    strokes: [],
    placement: { x: 7, y: -3, scaleX: 1.5, scaleY: 1.5, rotation: 0 },
  } as unknown as typeof l.mask;
  const m = brushCursor(l, true, point, brush, "brush")!,
    mb = applyMatrix(m.matrix, m.center);
  near(mb.x, point.x, 1e-9);
  near(mb.y, point.y, 1e-9);
  assert.notDeepEqual(m.matrix, c.matrix);
  l.transform = {
    ...l.transform,
    deform: { kind: "perspective" },
  } as unknown as typeof l.transform;
  assert.equal(brushCursor(l, false, point, brush, "brush"), null);
  assert.equal(brushCursor(undefined, false, point, brush, "brush"), null);
});

test("R3 inking presets are valid, distinct and use only existing stroke fields", () => {
  const names = ["G-Pen", "Mapping Pen", "Soft Eraser"];
  const found = names.map((n) => PROFESSIONAL_BRUSH_PRESETS.find((p) => p.name === n)!);
  assert.ok(found.every((p) => p && validateBrushPreset(p)));
  const all = [...DEFAULT_BRUSH_PRESETS, ...PROFESSIONAL_BRUSH_PRESETS];
  assert.equal(new Set(all.map((p) => p.name)).size, all.length);
  assert.equal(new Set(all.map((p) => JSON.stringify([p.tool, p.settings]))).size, all.length);
  assert.equal(found[0]!.settings.sizePressure, true);
  assert.equal(found[1]!.settings.sizePressure, false);
  assert.equal(found[2]!.tool, "eraser");
  assert.ok(found[2]!.settings.hardness < 0.5);
  const allowed = new Set([
    "size",
    "hardness",
    "opacity",
    "flow",
    "color",
    "tip",
    "sizePressure",
    "smoothing",
    "dynamics",
  ]);
  for (const p of found)
    for (const key of Object.keys(p.settings)) assert.ok(allowed.has(key), key);
});

test("preset duplicate/delete/reset keep names unique and the factory recipes intact", () => {
  let stored = resetBrushPresets();
  stored = duplicateBrushPreset(stored, "G-Pen");
  stored = duplicateBrushPreset(stored, "G-Pen");
  assert.deepEqual(
    stored.slice(-2).map((p) => p.name),
    ["G-Pen copy", "G-Pen copy 2"],
  );
  assert.equal(canDeleteBrushPreset(stored, "G-Pen copy"), true);
  assert.equal(canDeleteBrushPreset(stored, "G-Pen"), false);
  assert.equal(canDeleteBrushPreset(stored, "Ink · round"), false);
  // An override of a factory name can be deleted, revealing the factory recipe.
  const override = upsertBrushPreset(stored, {
    ...PROFESSIONAL_BRUSH_PRESETS.find((p) => p.name === "G-Pen")!,
    settings: { ...PROFESSIONAL_BRUSH_PRESETS.find((p) => p.name === "G-Pen")!.settings, size: 40 },
  });
  assert.equal(canDeleteBrushPreset(override, "G-Pen"), true);
  assert.equal(availableBrushPresets(override).find((p) => p.name === "G-Pen")!.settings.size, 40);
  const removed = override.filter((p) => p.name !== "G-Pen");
  assert.equal(availableBrushPresets(removed).find((p) => p.name === "G-Pen")!.settings.size, 14);
  assert.deepEqual(resetBrushPresets(), DEFAULT_BRUSH_PRESETS);
  assert.notEqual(resetBrushPresets()[0], DEFAULT_BRUSH_PRESETS[0]);
});

test("pressure curve preference persists per device and survives corrupt storage", () => {
  const data = new Map<string, string>(),
    storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  assert.equal(loadPressureGamma(storage), 1);
  assert.equal(savePressureGamma(storage, 1.8), true);
  assert.equal(loadPressureGamma(storage), 1.8);
  assert.equal(savePressureGamma(storage, 9), false);
  assert.equal(loadPressureGamma(storage), 1.8);
  data.set("inkstrip-pro-pen-pressure-v1", "{bad");
  assert.equal(loadPressureGamma(storage), 1);
  data.set("inkstrip-pro-pen-pressure-v1", JSON.stringify({ gamma: 0.1 }));
  assert.equal(loadPressureGamma(storage), 1);
  assert.equal(loadPressureGamma(undefined), 1);
});

test("long dynamic strokes stop inside the dab budget instead of failing to commit", () => {
  // Audit repro: a 64 px shading brush scribbling 14 passes over a 4,000 px page is only
  // ~5,600 points but a 56,000 px path, which validation rejects (stroke lost).
  const scribble = Array.from({ length: 14 * 400 }, (_, k) => {
    const pass = Math.floor(k / 400),
      i = (k % 400) + 1;
    return { x: pass % 2 ? 4000 - i * 10 : i * 10, y: 100 + pass * 20 };
  });
  const s = stroke({
    size: 64,
    hardness: 0.2,
    opacity: 0.6,
    flow: 0.3,
    dynamics: { ...DAB_DEFAULTS },
  });
  s.points = [{ x: 0, y: 100 }];
  const { full, filtered, length } = record(s, scribble);
  assert.equal(full, true);
  assert.ok(s.points.length < MAX_STROKE_POINTS);
  assert.ok(length! <= MAX_DAB_PATH && length! > MAX_DAB_PATH - 100);
  finishBrushStroke(s, filtered, { x: 0, y: 380 }, length);
  let measured = 0;
  for (let i = 1; i < s.points.length; i++)
    measured += Math.hypot(
      s.points[i]!.x - s.points[i - 1]!.x,
      s.points[i]!.y - s.points[i - 1]!.y,
    );
  near(measured, length!, 1e-6);
  const d = fromPanel({ id: "r3", name: "R3", width: 4000, height: 600 }),
    paint = layer("paint", 4000, 600, "paint");
  paint.strokes = [s];
  d.layers = [paint];
  assert.doesNotThrow(() => validateDocument(d));
  // Strokes without dynamics have no dab budget in validation; only points bound them.
  const legacy = stroke({ size: 64 });
  legacy.points = [{ x: 0, y: 100 }];
  assert.equal(record(legacy, scribble).full, false);
  d.layers[0]!.strokes = [legacy];
  assert.doesNotThrow(() => validateDocument(d));
});

test("preset names: rename cannot shadow Inkstrip presets; duplicates stay valid", () => {
  let stored = upsertBrushPreset(resetBrushPresets(), {
    name: "My pen",
    settings: { size: 5, hardness: 1, opacity: 1, flow: 1, color: "#111111" },
  });
  assert.throws(() => renameBrushPreset(stored, "My pen", "G-Pen"), /already exists/);
  assert.throws(() => renameBrushPreset(stored, "My pen", "Ink · round"), /already exists/);
  stored = renameBrushPreset(stored, "My pen", "My G");
  const long = "N".repeat(40);
  stored = upsertBrushPreset(stored, { name: long, settings: { ...stored.at(-1)!.settings } });
  for (let i = 0; i < 12; i++) stored = duplicateBrushPreset(stored, long);
  assert.ok(stored.every((p) => validateBrushPreset(p) && p.name.length <= 40));
  assert.equal(new Set(stored.map((p) => p.name)).size, stored.length);
});

test("R3 mask painting and cursor follow an R5 mask-only transform", async () => {
  const { nudgeDocument, transformMask, maskFrame } = await import("./geometry-operations.ts");
  const { maskPaintPoint } = await import("./masks.ts");
  const { localPoint } = await import("./model.ts");
  let d = fromPanel({ id: "x", name: "x", width: 400, height: 300 });
  const l = layer("paint", 400, 300, "paint");
  l.transform = { x: 20, y: 10, scaleX: 1.5, scaleY: 1.5, rotation: 15 };
  l.mask = {
    enabled: true,
    inverted: false,
    selection: { regions: [], inverted: true, feather: 0 },
    strokes: [],
  } as unknown as typeof l.mask;
  d.layers = [l];
  // R5: move the mask on its own, then rotate/scale it independently of the artwork.
  d = nudgeDocument(d, [l.id], { x: 37, y: -12 }, true);
  const frame = maskFrame(d, l.id);
  d = transformMask(d, l.id, {
    ...frame.transform,
    rotation: frame.transform.rotation + 30,
    scaleX: 0.8,
    scaleY: 0.8,
  });
  const moved = d.layers[0]!;
  assert.deepEqual(moved.transform, l.transform, "artwork transform untouched");
  const brush = { size: 24, hardness: 1, tip: "round" as const };
  for (const point of [
    { x: 150, y: 120 },
    { x: 300, y: 40 },
  ]) {
    // The stroke point R3 records in mask mode, and the cursor it draws, both map back
    // to the document point under the pointer through the transformed mask frame.
    const recorded = maskPaintPoint(moved, localPoint(point, moved)),
      cursor = brushCursor(moved, true, point, brush, "brush")!;
    near(recorded.x, cursor.center.x, 1e-9);
    near(recorded.y, cursor.center.y, 1e-9);
    const back = applyMatrix(cursor.matrix, cursor.center);
    near(back.x, point.x, 1e-6);
    near(back.y, point.y, 1e-6);
  }
  // A recorded mask stroke survives validation on the R5-transformed mask.
  const s = stroke({ size: 24, dynamics: { ...DAB_DEFAULTS } });
  s.points = [maskPaintPoint(moved, localPoint({ x: 150, y: 120 }, moved))];
  finishBrushStroke(s, undefined, maskPaintPoint(moved, localPoint({ x: 250, y: 160 }, moved)));
  moved.mask!.strokes = [s];
  assert.doesNotThrow(() => validateDocument(d));
});
