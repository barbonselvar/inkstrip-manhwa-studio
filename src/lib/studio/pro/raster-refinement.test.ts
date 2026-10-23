import { test } from "node:test";
import assert from "node:assert/strict";
import {
  morphology,
  boxFilter,
  refineSelection,
  refineTiled,
  coverageRegion,
  REFINE_DEFAULTS,
} from "./refine-selection.ts";
import { DAB_DEFAULTS, brushDabs, brushPoint } from "./brush-dynamics.ts";
import { fromPanel, layer, validateDocument, type Stroke, type ProSession } from "./model.ts";
import { nativeFile, readNative } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
const noEdge = { ...REFINE_DEFAULTS, radius: 0, edgeAware: false };
const rgba = (n: number) => new Uint8ClampedArray(n * 4).fill(255);
const brush = (points: Stroke["points"], p: Partial<Stroke> = {}): Stroke => ({
  points,
  color: "#111111",
  size: 10,
  hardness: 1,
  opacity: 1,
  flow: 1,
  erase: false,
  dynamics: { ...DAB_DEFAULTS },
  seed: 42,
  ...p,
});
const doc = () => fromPanel({ id: "p", name: "Fixture", width: 32, height: 24 });
test("square dilation and erosion match brute force for fractional radii and image edges", async () => {
  const input = Uint8Array.from({ length: 35 }, (_, i) => (i * 37) % 256);
  for (const radius of [0, 1, 2.2, 7])
    for (const expand of [true, false]) {
      const r = Math.ceil(radius),
        expected = new Uint8Array(35);
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 7; x++) {
          const values: number[] = [];
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++)
              values.push(
                input[Math.max(0, Math.min(4, y + dy)) * 7 + Math.max(0, Math.min(6, x + dx))]!,
              );
          expected[y * 7 + x] = expand ? Math.max(...values) : Math.min(...values);
        }
      assert.deepEqual(await morphology(input, 7, 5, radius, expand), expected);
    }
});
test("box filtering uses real replicated-edge pixel kernels", async () => {
  const result = await boxFilter(Float32Array.of(0, 0, 255, 0, 0), 5, 1, 1);
  assert.deepEqual([...result], [0, 85, 85, 85, 0]);
});
test("default-neutral refinement is identity for fractional alpha", async () => {
  const a = Uint8Array.of(0, 25, 128, 199, 255);
  assert.deepEqual(await refineSelection(rgba(5), a, 5, 1, noEdge), a);
});
test("refinement expands and contracts actual selection coverage", async () => {
  const a = Uint8Array.of(0, 0, 255, 0, 0);
  assert.deepEqual(
    [...(await refineSelection(rgba(5), a, 5, 1, { ...noEdge, shift: 1 }))],
    [0, 255, 255, 255, 0],
  );
  assert.deepEqual(
    [...(await refineSelection(rgba(5), a, 5, 1, { ...noEdge, shift: -1 }))],
    [0, 0, 0, 0, 0],
  );
});
test("feather preserves full selection at boundaries and spreads a fine strand", async () => {
  assert.deepEqual(
    await refineSelection(rgba(9), new Uint8Array(9).fill(255), 9, 1, { ...noEdge, feather: 2 }),
    new Uint8Array(9).fill(255),
  );
  const a = await refineSelection(rgba(9), Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 0, 0), 9, 1, {
    ...noEdge,
    feather: 2,
  });
  assert.ok(a[3]! > 0 && a[4]! > a[3]! && a[4]! < 255);
});
test("color-line matting recovers semi-transparent fine-detail edges from reference colors", async () => {
  const pixels = new Uint8ClampedArray([
    255, 255, 255, 255, 191, 191, 191, 255, 128, 128, 128, 255, 64, 64, 64, 255, 0, 0, 0, 255,
  ]);
  const out = await refineSelection(pixels, Uint8Array.of(0, 0, 255, 255, 255), 5, 1, {
    ...REFINE_DEFAULTS,
    radius: 2,
    foreground: [0, 0, 0],
    background: [255, 255, 255],
  });
  assert.deepEqual([...out], [0, 64, 127, 191, 255]);
});
test("ambiguous low-contrast edges retain their original coverage", async () => {
  const a = Uint8Array.of(0, 32, 128, 255, 255);
  assert.deepEqual(
    await refineSelection(rgba(5), a, 5, 1, {
      ...REFINE_DEFAULTS,
      foreground: [255, 255, 255],
      background: [255, 255, 255],
    }),
    a,
  );
});
test("tiled refinement matches full-frame kernels across tile boundaries", async () => {
  const w = 520,
    h = 7,
    a = Uint8Array.from({ length: w * h }, (_, i) => (i % 19 < 7 ? 255 : 0)),
    pixels = rgba(w * h),
    o = { ...noEdge, shift: 2, smooth: 1, feather: 2, contrast: 0.1 };
  assert.deepEqual(
    await refineTiled(pixels, a, w, h, o),
    await refineSelection(pixels, a, w, h, o),
  );
});
test("tiled color matting matches full-frame local statistics", async () => {
  const w = 270,
    h = 4,
    a = Uint8Array.from({ length: w * h }, (_, i) => (i % w < 256 ? 255 : 0)),
    pixels = rgba(w * h);
  for (let i = 0; i < w * h; i++)
    for (let c = 0; c < 3; c++) pixels[i * 4 + c] = i % w < 256 ? 0 : 255;
  const o = { ...REFINE_DEFAULTS, radius: 3 };
  assert.deepEqual(
    await refineTiled(pixels, a, w, h, o),
    await refineSelection(pixels, a, w, h, o),
  );
});
test("refinement rejects invalid inputs and cancels before changing source buffers", async () => {
  const a = Uint8Array.of(0, 255),
    copy = a.slice();
  await assert.rejects(() => refineTiled(rgba(2), a, 2, 1, { ...noEdge, radius: NaN }), /radius/);
  await assert.rejects(
    () =>
      refineTiled(rgba(2), a, 2, 1, noEdge, async () => {
        throw new DOMException("Cancelled", "AbortError");
      }),
    { name: "AbortError" },
  );
  assert.deepEqual(a, copy);
});
test("coverage encoding preserves row boundaries and semi-transparent alpha", () => {
  const input = Uint8Array.of(0, 128, 128, 255, 255, 0),
    r = coverageRegion(input, 3, 2),
    p = r.pixels!,
    out = new Uint8Array(6);
  for (let i = 0; i < p.runs.length; i += 3) {
    assert.ok((p.runs[i]! % 3) + p.runs[i + 1]! <= 3);
    out.fill(p.runs[i + 2]!, p.runs[i]!, p.runs[i]! + p.runs[i + 1]!);
  }
  assert.deepEqual(out, input);
});
test("dab spacing carries across input samples and has no event-frequency accumulation", () => {
  const a = brush([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]),
    b = brush([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 9, y: 0 },
      { x: 20, y: 0 },
    ]);
  assert.deepEqual([...brushDabs(a)], [...brushDabs(b)]);
  assert.equal([...brushDabs(a)].length, 21);
});
test("pressure controls configured size/opacity independently with truthful mouse fallback", () => {
  assert.equal(brushPoint(undefined, { x: 0, y: 0 }, "touch", 0.5, true, 0).pressure, undefined);
  const p = brushPoint(undefined, { x: 0, y: 0 }, "pen", 0.25, true, 0);
  const out = [
    ...brushDabs(
      brush([p], { sizePressure: false, dynamics: { ...DAB_DEFAULTS, opacityPressure: true } }),
    ),
  ][0]!;
  assert.equal(out.radius, 5);
  assert.equal(out.alpha, 0.25);
  assert.equal([...brushDabs(brush([p], { sizePressure: true }))][0]!.radius, 1.25);
});
test("scatter and jitter reproduce exactly from the recorded seed", () => {
  const s = brush(
    [
      { x: 0, y: 0 },
      { x: 30, y: 10 },
    ],
    {
      dynamics: {
        ...DAB_DEFAULTS,
        scatter: 1,
        sizeJitter: 0.7,
        opacityJitter: 0.5,
        roundness: 0.2,
        angle: 45,
      },
    },
  );
  const a = [...brushDabs(s)];
  assert.deepEqual(a, [...brushDabs(structuredClone(s))]);
  assert.notDeepEqual(a, [...brushDabs({ ...s, seed: 43 })]);
  assert.ok(a.every((d) => d.alpha >= 0.5 && d.alpha <= 1 && d.radius <= 5 && d.roundness === 0.2));
});
test("velocity thinning uses recorded times and never invents pressure", () => {
  const s = brush(
    [
      { x: 0, y: 0, time: 0 },
      { x: 20, y: 0, time: 10 },
    ],
    { dynamics: { ...DAB_DEFAULTS, velocity: 1 } },
  );
  assert.ok([...brushDabs(s)].every((d) => Math.abs(d.radius - 1) < 1e-8));
});
test("native v5 round trip retains saved selections, mask properties and brush dynamics", async () => {
  const d = doc();
  const l = layer("paint", 32, 24, "paint");
  l.strokes = [
    brush([
      { x: 1, y: 1, time: 10, pressure: 0.5 },
      { x: 5, y: 5, time: 20, pressure: 1 },
    ]),
  ];
  l.mask = {
    enabled: true,
    density: 0.6,
    feather: 2,
    inverted: true,
    selection: {
      regions: [coverageRegion(new Uint8Array(32 * 24).fill(128), 32, 24)],
      inverted: false,
      feather: 0,
    },
    strokes: [],
  };
  d.layers.push(l);
  d.savedSelections = [{ name: "Hair", selection: structuredClone(l.mask.selection) }];
  const s: ProSession = {
    document: d,
    assets: { source: new Blob([Uint8Array.of(1)], { type: "image/png" }) },
    revision: 0,
    acceptedBlobId: "source",
    updatedAt: 0,
  };
  const file = await nativeFile(s);
  assert.equal(JSON.parse(await file.text()).version, 5);
  const restored = await readNative(file, "p", "source");
  assert.deepEqual(restored.document, d);
  let history = createHistory(d);
  history = record(history, { ...d, selection: d.savedSelections[0]!.selection });
  assert.deepEqual(undo(history).present, d);
  assert.deepEqual(redo(undo(history)).present, history.present);
});
test("legacy v4 files remain readable with neutral omitted mask and dynamics defaults", async () => {
  const d = doc();
  const shape = layer("shape", 32, 24);
  shape.appearance = [];
  d.layers.push(shape);
  const s: ProSession = {
    document: d,
    assets: { source: new Blob([Uint8Array.of(1)], { type: "image/png" }) },
    revision: 0,
    acceptedBlobId: "source",
    updatedAt: 0,
  };
  const file = await nativeFile(s);
  assert.equal(JSON.parse(await file.text()).version, 4);
  const restored = await readNative(file, "p", "source");
  assert.deepEqual(restored.document, d);
});
test("invalid mask settings, dynamics and duplicate saved names cannot enter history", () => {
  const d = doc();
  d.layers[0]!.mask = {
    enabled: true,
    density: 2,
    selection: { regions: [], inverted: true, feather: 0 },
    strokes: [],
  };
  assert.throws(() => validateDocument(d), /mask/);
  delete d.layers[0]!.mask;
  d.layers[0]!.strokes = [brush([{ x: 0, y: 0 }], { dynamics: { ...DAB_DEFAULTS, spacing: 0 } })];
  assert.throws(() => validateDocument(d), /spacing/);
  d.layers[0]!.strokes = [];
  d.savedSelections = [
    { name: "x", selection: { regions: [], inverted: false, feather: 0 } },
    { name: "x", selection: { regions: [], inverted: false, feather: 0 } },
  ];
  assert.throws(() => validateDocument(d), /saved selections/);
});

test("unlink/relink retains affine mask geometry during layer motion", async () => {
  const { setMaskLinked, maskWorld, maskPaintPoint } = await import("./masks.ts");
  const { applyMatrix } = await import("./transform.ts");
  const l = layer("paint", 32, 24);
  l.transform = { x: 5, y: 7, scaleX: 2, scaleY: 3, rotation: 25 };
  l.mask = { enabled: true, selection: { regions: [], inverted: true, feather: 0 }, strokes: [] };
  const before = applyMatrix(maskWorld(l), { x: 4, y: 5 });
  l.mask = setMaskLinked(l, false);
  l.transform = { ...l.transform, x: 50, y: 80 };
  const frozen = applyMatrix(maskWorld(l), { x: 4, y: 5 });
  assert.ok(Math.hypot(frozen.x - before.x, frozen.y - before.y) < 1e-10);
  const world = maskWorld(l);
  l.mask = setMaskLinked(l, true);
  const after = applyMatrix(maskWorld(l), { x: 4, y: 5 });
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1e-10);
  assert.ok(Math.abs(maskWorld(l)[4] - world[4]) < 1e-10);
  assert.ok(Number.isFinite(maskPaintPoint(l, { x: 3, y: 3 }).x));
});
test("group affine transforms move linked group masks once and preserve unlinked masks", async () => {
  const { transformForest } = await import("./transform-transaction.ts");
  const { maskWorld } = await import("./masks.ts");
  const { translateLayers } = await import("./layers.ts");
  const d = doc(),
    g = layer("group", 32, 24, "g");
  d.layers[0]!.parentId = "g";
  d.layers.unshift(g);
  g.mask = { enabled: true, selection: { regions: [], inverted: true, feather: 0 }, strokes: [] };
  const identity = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  const moved = transformForest(d, ["g"], identity, { ...identity, x: 5, y: 6 });
  assert.equal(maskWorld(moved.layers[0]!)[4], 5);
  assert.equal(moved.layers[1]!.transform.x, 5);
  const translated = translateLayers(d, ["g"], { x: 4, y: 8 });
  assert.equal(maskWorld(translated.layers[0]!)[5], 8);
  g.mask.linked = false;
  const unlinked = transformForest(d, ["g"], identity, { ...identity, x: 5, y: 6 });
  assert.equal(maskWorld(unlinked.layers[0]!)[4], 0);
});
test("mask clipboard is an independent native-space copy with source dimensions", async () => {
  const { copyLayerMask, maskWorld } = await import("./masks.ts");
  const a = layer("paint", 32, 24);
  a.transform.x = 10;
  a.mask = { enabled: true, selection: { regions: [], inverted: true, feather: 0 }, strokes: [] };
  const copied = copyLayerMask(a),
    b = layer("paint", 48, 48);
  b.mask = copied;
  b.transform.x = 30;
  assert.equal(copied.width, 32);
  assert.equal(copied.height, 24);
  assert.equal(maskWorld(b)[4], 10);
  copied.enabled = false;
  assert.equal(a.mask.enabled, true);
});
test("4096-square sources are accepted while oversized sources remain rejected", () => {
  const d = fromPanel({ id: "large", name: "4K", width: 4096, height: 4096 });
  validateDocument(d);
  d.width = 4097;
  assert.throws(() => validateDocument(d), /oversized/);
});
test("professional presets validate and custom rename preserves all dynamics", async () => {
  const {
    PROFESSIONAL_BRUSH_PRESETS,
    validateBrushPreset,
    renameBrushPreset,
    upsertBrushPreset,
    DEFAULT_BRUSH_PRESETS,
  } = await import("./brush-presets.ts");
  assert.ok(PROFESSIONAL_BRUSH_PRESETS.every(validateBrushPreset));
  const custom = { ...PROFESSIONAL_BRUSH_PRESETS[0]!, name: "Custom Ink" };
  const presets = upsertBrushPreset(DEFAULT_BRUSH_PRESETS, custom),
    renamed = renameBrushPreset(presets, "Custom Ink", "Ink 2");
  assert.deepEqual(renamed.at(-1)!.settings, custom.settings);
  assert.ok(!renamed.some((p) => p.name === "Custom Ink"));
  assert.throws(
    () => renameBrushPreset(presets, "Custom Ink", DEFAULT_BRUSH_PRESETS[0]!.name),
    /exists/,
  );
});

test("history memory budget retains current work and nearest undos, without mutating old history", async () => {
  const { budgetHistory } = await import("./history-budget.ts");
  let h = createHistory("aaaa");
  h = record(h, "bbbb");
  h = record(h, "cccc");
  const bounded = budgetHistory(h, 24);
  assert.deepEqual(bounded.past, ["bbbb"]);
  assert.equal(bounded.present, "cccc");
  assert.deepEqual(h.past, ["aaaa", "bbbb"]);
  assert.equal(budgetHistory(h, 1).present, "cccc");
});

test("cleanup removes small islands and fills enclosed holes without filling image borders", async () => {
  const { cleanupCoverage } = await import("./refine-selection.ts");
  const input = new Uint8Array(7 * 7);
  for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) input[y * 7 + x] = 255;
  input[3 * 7 + 3] = 0;
  input[0] = 255;
  const result = await cleanupCoverage(input, 7, 7, 2, true);
  assert.equal(result[0], 0);
  assert.equal(result[3 * 7 + 3], 255);
  assert.equal(result[6], 0);
  assert.equal(input[0], 255);
  assert.equal(input[3 * 7 + 3], 0);
});
test("stabilization restrains short jitter and follows long movement without modifying pen pressure", () => {
  const a = { x: 0, y: 0, time: 0, pressure: 0.4 };
  const short = brushPoint(a, { x: 2, y: 0, time: 10 }, "pen", 0.7, true, 0, 5);
  assert.equal(short.x, 0);
  assert.equal(short.pressure, 0.7);
  assert.equal(brushPoint(a, { x: 10, y: 0, time: 10 }, "pen", 0.7, true, 0, 5).x, 5);
});

test("new masks retain the document coverage frame beyond vector editing bounds", async () => {
  const { maskFromSelection, maskWorld } = await import("./masks.ts");
  const { applyMatrix } = await import("./transform.ts");
  const l = layer("shape", 20, 20);
  l.transform.x = 32;
  l.transform.y = 24;
  l.mask = maskFromSelection({ regions: [], inverted: true, feather: 0 }, l, {
    width: 128,
    height: 96,
  });
  assert.equal(l.mask.width, 128);
  assert.equal(l.mask.height, 96);
  const p = applyMatrix(maskWorld(l), { x: 15, y: 10 });
  assert.equal(p.x, 15);
  assert.equal(p.y, 10);
  l.transform.x += 10;
  assert.ok(Math.abs(applyMatrix(maskWorld(l), { x: 15, y: 10 }).x - 25) < 1e-10);
});

test("coverage previews area-average alpha without allocating a native RGBA image", async () => {
  const { previewCoverage } = await import("./coverage-preview.ts");
  const runs = coverageRegion(Uint8Array.of(0, 255, 0, 255, 128, 128, 128, 128), 4, 2).pixels!.runs;
  assert.deepEqual([...previewCoverage(4, 2, runs, 2, 1)], [128, 128]);
  const large = previewCoverage(4096, 4096, [0, 4096, 255], 96, 96);
  assert.equal(large.length, 96 * 96);
  assert.ok(large[0]! > 0 && large[0]! < 255);
});

test("device budgets cover mask and captured selection frames before committing or decoding", async () => {
  const { documentSources } = await import("./raster-budget.ts");
  const d = doc();
  d.layers[0]!.mask = {
    enabled: true,
    width: 4096,
    height: 4096,
    selection: { regions: [], inverted: true, feather: 0 },
    strokes: [],
  };
  assert.throws(() => documentSources(d, 4_000_000), /mask frame/);
  delete d.layers[0]!.mask;
  d.selection = {
    regions: [],
    inverted: true,
    feather: 0,
    frame: {
      width: 4096,
      height: 4096,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    },
  };
  assert.throws(() => documentSources(d, 4_000_000), /selection frame/);
});

test("dirty presentation bounds include brush scatter, transforms and cancelled/erased strokes", async () => {
  const { previewDirtyRect } = await import("./preview-dirty.ts");
  const d = doc();
  const l = layer("paint", 32, 24, "dirty");
  d.layers = [l];
  const s = brush(
    [
      { x: 10, y: 10 },
      { x: 12, y: 10 },
    ],
    { size: 4, dynamics: { ...DAB_DEFAULTS, scatter: 1 }, erase: true },
  );
  const next = { ...d, layers: [{ ...l, strokes: [s] }] },
    r = previewDirtyRect(d, next, 32, 24)!;
  assert.ok(r.x <= 6 && r.y <= 6 && r.x + r.width >= 16);
  assert.deepEqual(previewDirtyRect(next, d, 32, 24), r);
  assert.equal(previewDirtyRect(d, { ...next, background: "#ffffff" }, 32, 24), null);
  assert.equal(
    previewDirtyRect(
      d,
      { ...next, layers: [{ ...next.layers[0]!, adjustments: { ...l.adjustments, blur: 2 } }] },
      32,
      24,
    ),
    null,
  );
});

test("custom factory-name overrides are selectable once and deletion restores the factory", async () => {
  const { availableBrushPresets, PROFESSIONAL_BRUSH_PRESETS, upsertBrushPreset } =
    await import("./brush-presets.ts");
  const original = PROFESSIONAL_BRUSH_PRESETS.find((p) => p.name === "Ink Pen")!,
    custom = { ...original, settings: { ...original.settings, size: 19 } };
  const saved = upsertBrushPreset([], custom),
    all = availableBrushPresets(saved);
  assert.equal(all.filter((p) => p.name === "Ink Pen").length, 1);
  assert.equal(all.find((p) => p.name === "Ink Pen")!.settings.size, 19);
  assert.equal(
    availableBrushPresets([]).find((p) => p.name === "Ink Pen")!.settings.size,
    original.settings.size,
  );
});

test("non-uniform rotated masks preserve exact affine inverses beyond bounded skew controls", async () => {
  const { maskFromSelection, maskWorld, setMaskLinked } = await import("./masks.ts");
  const { validateAffineMatrix } = await import("./transform.ts");
  const d = doc(),
    l = d.layers[0]!;
  l.transform = { x: 5, y: 7, scaleX: 10, scaleY: 1, rotation: 45 };
  l.mask = maskFromSelection({ regions: [], inverted: true, feather: 0 }, l, d);
  validateDocument(d);
  assert.ok(Array.isArray(l.mask.placement));
  assert.ok(maskWorld(l).every((n, i) => Math.abs(n - [1, 0, 0, 1, 0, 0][i]!) < 1e-10));
  l.mask = setMaskLinked(l, false);
  l.transform.x += 20;
  assert.ok(maskWorld(l).every((n, i) => Math.abs(n - [1, 0, 0, 1, 0, 0][i]!) < 1e-10));
  l.mask = setMaskLinked(l, true);
  validateDocument(d);
  assert.throws(() => validateAffineMatrix([0, 0, 0, 0, 0, 0]), /Singular/);
  assert.throws(() => validateAffineMatrix([NaN, 0, 0, 1, 0, 0]), /affine/);
  l.mask.strokes = [
    brush([{ x: 5, y: 5 }], {
      clip: {
        regions: [],
        inverted: true,
        feather: 0,
        frame: {
          width: 32,
          height: 24,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          matrix: maskWorld(l),
        },
      },
    }),
  ];
  const s: ProSession = {
    document: d,
    assets: { source: new Blob([Uint8Array.of(1)], { type: "image/png" }) },
    revision: 0,
    acceptedBlobId: "source",
    updatedAt: 0,
  };
  const file = await nativeFile(s);
  assert.equal(JSON.parse(await file.text()).version, 5);
  assert.deepEqual((await readNative(file, "p", "source")).document, d);
});

test("mask selection sampling composes its native affine frame before perspective mapping", async () => {
  const { sampleDocument, sampleRgba } = await import("./transform-pixels.ts");
  const { mapping, applyMatrix, QUAD } = await import("./transform.ts");
  const width = 32,
    height = 24,
    pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set([x * 7, y * 9, 40, x < 16 ? 255 : 0], (y * width + x) * 4);
  const transform = {
      x: 2,
      y: 1,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      deform: {
        kind: "perspective" as const,
        width: 32,
        height: 24,
        points: QUAD.map((p, i) => ({ ...p, x: i === 2 ? 0.6 : p.x })),
      },
    },
    pre: [number, number, number, number, number, number] = [1.2, 0.1, 0.2, 0.9, 3, 2],
    expected = new Uint8ClampedArray(8 * 8 * 4),
    map = mapping(transform);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const p = map.forward(applyMatrix(pre, { x: x + 0.5, y: y + 0.5 }));
      sampleRgba(pixels, width, height, p.x - 0.5, p.y - 0.5, expected, (y * 8 + x) * 4);
    }
  assert.deepEqual(
    sampleDocument(pixels, width, height, transform, 8, 8, 1, { x: 0, y: 0 }, pre),
    expected,
  );
});
