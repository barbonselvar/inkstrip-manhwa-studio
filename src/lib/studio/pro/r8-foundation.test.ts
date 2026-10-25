import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, validateDocument, type ProSession } from "./model.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import {
  advancedGradient,
  advancedGradientSampler,
  gradientField,
  defaultGradient,
  validateGradient,
} from "./gradient.ts";
import { advancedEffect, effectPixels } from "./effects.ts";
import {
  defaultSmartOperation,
  processSmart,
  validateSmartFilters,
  validateSmartWork,
  mixFilterMask,
  type SmartFilter,
} from "./smart-filters.ts";
import { processColor } from "./color-engine.ts";
import {
  addGradientFill,
  upgradeR8Document,
  r8Document,
  commitR8Document,
  r8Settings,
} from "./r8-document.ts";
import {
  upgradeAdjustmentDocument,
  adjustmentDocument,
  createAdjustmentDraft,
} from "./adjustment-layer.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
const doc = () => fromPanel({ id: "p", name: "R8", width: 32, height: 32 });
const stack = (kind: Parameters<typeof defaultSmartOperation>[0]): SmartFilter[] => [
  { id: "filter", enabled: true, operation: defaultSmartOperation(kind) },
];
const pixels = (w: number, h: number, rgba: number[]) =>
  Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => rgba[i % 4]!);
test("legacy1/2 opt-in migration preserves exact source/layer identity and R6 never downgrades schema3", () => {
  for (const version of [1, 2] as const) {
    const d = { ...doc(), version },
      next = upgradeR8Document(d);
    assert.equal(next.version, 3);
    assert.equal(next.layers, d.layers);
    assert.equal(next.source, d.source);
    assert.equal(d.version, version);
    assert.equal(upgradeAdjustmentDocument(next), next);
  }
});
test("gradient geometry implements linear/radial/angular/reflected/diamond fields and reverse", () => {
  const g = advancedGradient();
  for (const kind of ["linear", "radial", "angular", "reflected", "diamond"] as const) {
    g.kind = kind;
    validateGradient(g);
    const f = gradientField(g, 100, 100);
    assert.ok(f(75, 50).every(Number.isFinite));
    assert.equal(f(100, 50)[3], 1);
  }
  g.kind = "linear";
  assert.equal(gradientField(g, 100, 100)(0, 50)[0], 0);
  g.reverse = true;
  assert.equal(gradientField(g, 100, 100)(0, 50)[0], 1);
});
test("midpoint/smoothness and premultiplied alpha are actual parameter math; OKLab differs from RGB", () => {
  const g = advancedGradient();
  g.stops[0]!.midpoint = 0.25;
  assert.ok(Math.abs(advancedGradientSampler(g)(0.25)[0] - 0.5) < 1e-12);
  g.stops = [
    { position: 0, color: "#ff0000", opacity: 0 },
    { position: 1, color: "#0000ff", opacity: 1 },
  ];
  assert.deepEqual(advancedGradientSampler(g)(0.5), [0, 0, 1, 0.5]);
  g.stops[0]!.opacity = 1;
  const rgb = advancedGradientSampler(g)(0.5);
  g.interpolation = "oklab";
  const lab = advancedGradientSampler(g)(0.5);
  assert.ok(lab[1]! > rgb[1]! + 0.1);
  assert.equal(lab[3], 1);
});
test("bounded128 stops, strict midpoint/order/version validation and legacy gradient remain supported", () => {
  const g = advancedGradient();
  g.stops = Array.from({ length: 128 }, (_, i) => ({
    position: i / 127,
    color: "#123456",
    opacity: 1,
  }));
  validateGradient(g);
  assert.equal(g.stops.length, 128);
  assert.throws(() => validateGradient({ ...g, stops: [...g.stops, g.stops[127]!] }));
  assert.throws(() =>
    validateGradient({
      ...g,
      stops: [{ position: 0, color: "#000000", opacity: 1, midpoint: 0 }, g.stops[127]!],
    }),
  );
  validateGradient(defaultGradient());
  assert.throws(() => validateGradient({ ...defaultGradient(), kind: "diamond" }));
});
for (const kind of ["gaussian", "motion", "unsharp", "highPass", "median"] as const)
  test(`Smart ${kind} reuses R6 exact pixels and leaves input immutable`, () => {
    const src = pixels(7, 7, [90, 140, 210, 123]);
    src.set([255, 0, 0, 0], 0);
    const before = src.slice(),
      op = defaultSmartOperation(kind);
    assert.deepEqual(
      processSmart(src, 7, 7, op),
      processColor(
        src,
        7,
        7,
        op as Parameters<typeof processColor>[3],
        undefined,
        kind === "gaussian" || kind === "motion" ? "blur" : "preserve",
      ),
    );
    assert.deepEqual(src, before);
  });
test("radial spin/zoom conserve constant premultiplied color and alpha; zero strength is exact", () => {
  const src = pixels(7, 7, [40, 80, 160, 128]);
  for (const mode of ["spin", "zoom"] as const)
    assert.deepEqual(
      processSmart(src, 7, 7, { kind: "radial", mode, strength: 0.25, center: { x: 0.2, y: 0.8 } }),
      src,
    );
  assert.deepEqual(
    processSmart(src, 7, 7, { kind: "radial", mode: "spin", strength: 0, center: { x: 0, y: 0 } }),
    src,
  );
});
test("Gaussian/uniform noise have deterministic distinct seeds/distributions, preserve alpha and source", () => {
  const src = pixels(16, 16, [128, 128, 128, 100]),
    a = {
      kind: "grain" as const,
      distribution: "gaussian" as const,
      amount: 30,
      monochrome: true,
      seed: 42,
    },
    first = processSmart(src, 16, 16, a);
  assert.deepEqual(first, processSmart(src, 16, 16, a));
  assert.notDeepEqual(first, processSmart(src, 16, 16, { ...a, seed: 43 }));
  assert.notDeepEqual(first, processSmart(src, 16, 16, { ...a, distribution: "uniform" }));
  for (let i = 0; i < first.length; i += 4) {
    assert.equal(first[i + 3], 100);
    assert.equal(first[i], first[i + 1]);
  }
});
test("Surface Blur smooths same-tone noise while preserving high contrast edges", () => {
  const src = pixels(9, 3, [10, 10, 10, 255]);
  for (let y = 0; y < 3; y++)
    for (let x = 5; x < 9; x++) src.set([240, 240, 240, 255], (y * 9 + x) * 4);
  src.set([20, 20, 20, 255], (9 + 1) * 4);
  const out = processSmart(src, 9, 3, { kind: "surface", radius: 2, threshold: 20 });
  assert.ok(out[(9 + 1) * 4]! < 20);
  assert.equal(out[(9 + 4) * 4], 10);
  assert.equal(out[(9 + 5) * 4], 240);
});
test("Emboss neutral flat field is128 and edge detectors return zero on constant pixels", () => {
  const src = pixels(5, 5, [80, 120, 200, 127]);
  for (const method of ["sobel", "laplacian"] as const) {
    const out = processSmart(src, 5, 5, { kind: "edgeDetect", method, strength: 1 });
    assert.deepEqual([...out.slice(48, 52)], [0, 0, 0, 127]);
  }
  assert.deepEqual(
    [
      ...processSmart(src, 5, 5, { kind: "emboss", height: 1, angle: 0, strength: 1 }).slice(
        48,
        52,
      ),
    ],
    [128, 128, 128, 127],
  );
});
test("filter mask crossfade preserves exact zero coverage and interpolates alpha without halos", () => {
  const src = new Uint8ClampedArray([250, 0, 0, 0, 0, 0, 255, 255]),
    filtered = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 255]),
    m = {
      selection: { regions: [], inverted: false, feather: 0 },
      enabled: true,
      density: 1,
      inverted: false,
    };
  assert.deepEqual(
    [...mixFilterMask(src, filtered, new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 128]), m)],
    [250, 0, 0, 0, 128, 0, 127, 255],
  );
});
test("strict stack identity/parameter/memory/aggregate limits reject unsafe native work", () => {
  assert.throws(() => validateSmartWork(3000, 2000, stack("gaussian")), /4MP/);
  const s = stack("gaussian");
  s[0]!.operation = { kind: "gaussian", radius: 32 };
  assert.throws(() => validateSmartWork(1000, 1000, s), /128M/);
  assert.throws(() => validateSmartFilters([...stack("grain"), ...stack("grain")]));
  assert.throws(() =>
    validateSmartFilters([
      {
        ...stack("radial")[0]!,
        operation: { kind: "radial", mode: "spin", strength: Infinity, center: { x: 0.5, y: 0.5 } },
      },
    ]),
  );
});
for (const kind of [
  "dropShadow",
  "innerShadow",
  "outerGlow",
  "innerGlow",
  "stroke",
  "colorOverlay",
  "gradientOverlay",
  "patternOverlay",
  "bevel",
] as const)
  test(`style ${kind} derives actual alpha and never overwrites source`, () => {
    const src = pixels(17, 17, [0, 0, 0, 0]);
    for (let y = 5; y < 12; y++)
      for (let x = 5; x < 12; x++) src.set([120, 120, 120, 255], (y * 17 + x) * 4);
    const before = src.slice(),
      e = advancedEffect(kind);
    e.distance = 2;
    e.radius = 2;
    e.size = 2;
    e.color = "#ff0000";
    const out = effectPixels(src, 17, 17, [e]);
    assert.deepEqual(src, before);
    assert.notDeepEqual(out, src);
    assert.deepEqual([...out.slice(0, 4)], [0, 0, 0, out[3]!]);
  });
test("shared light updates shadow direction and spread grows real alpha geometry", () => {
  const src = pixels(15, 15, [0, 0, 0, 0]);
  src.set([255, 255, 255, 255], (7 * 15 + 7) * 4);
  const e = advancedEffect("dropShadow");
  e.globalLight = true;
  e.radius = 0;
  e.distance = 3;
  const east = effectPixels(src, 15, 15, [e], 1, 0),
    west = effectPixels(src, 15, 15, [e], 1, 180);
  assert.equal(east[(7 * 15 + 10) * 4 + 3], 255);
  assert.equal(west[(7 * 15 + 4) * 4 + 3], 255);
  e.distance = 0;
  e.spread = 2;
  assert.ok(effectPixels(src, 15, 15, [e])[(7 * 15 + 9) * 4 + 3]! > 0);
});
test("native schema3/envelope9 round trips source bytes, Smart Filters, masks, advanced gradients/styles deterministically", async () => {
  let d = addGradientFill(
    doc(),
    advancedGradient(),
    { regions: [], inverted: false, feather: 0 },
    undefined,
    "fill",
  ).document;
  d = r8Document(
    { origin: d, layerId: "fill" },
    {
      gradient: d.layers.at(-1)!.gradient,
      effects: [advancedEffect("bevel"), advancedEffect("patternOverlay")],
      smartFilters: stack("grain"),
      light: 90,
    },
    16_777_216,
  );
  const s: ProSession = {
    document: d,
    assets: { source: new Blob(["original bytes"], { type: "image/png" }) },
    revision: 0,
    acceptedBlobId: "accepted",
    updatedAt: 1,
  };
  const file = await nativeFile(s),
    value = JSON.parse(await file.text());
  assert.equal(value.version, 9);
  assert.equal(value.document.version, 3);
  const reopened = await readNative(file, "p", "accepted");
  assert.deepEqual(reopened.document, d);
  assert.equal(await reopened.assets.source!.text(), "original bytes");
  assert.equal(await (await nativeFile(reopened)).text(), await file.text());
  assert.throws(() => vectorSvg(d));
  const h = record(createHistory(doc()), d);
  assert.equal(undo(h).present.version, 1);
  assert.deepEqual(redo(undo(h)).present, d);
  const adjusted = adjustmentDocument(
    createAdjustmentDraft(d, "fill", "adjust"),
    { version: 1, operation: { kind: "invert" } },
    16_777_216,
  );
  assert.equal(adjusted.version, 3);
  validateDocument(adjusted);
});
test("schema1/2 cannot carry advanced records; unknown versions, locked targets and stale drafts fail safely", async () => {
  const d = doc(),
    l = d.layers[0]!,
    settings = r8Settings(l);
  settings.smartFilters = stack("grain");
  const next = r8Document({ origin: d, layerId: l.id }, settings, 16_777_216);
  assert.throws(() => validateDocument({ ...next, version: 2 }));
  assert.throws(
    () => commitR8Document({ ...d }, { origin: d, layerId: l.id }, settings, 16_777_216),
    /changed/,
  );
  l.locked = true;
  assert.throws(() => r8Document({ origin: d, layerId: l.id }, settings, 16_777_216), /unlocked/);
  await assert.rejects(
    () =>
      readNative(
        new Blob([
          JSON.stringify({ format: "inkstrip-pro", version: 10, document: next, assets: {} }),
        ]),
        "p",
        "accepted",
      ),
    /Unsupported/,
  );
});

test("Smart Gaussian/Motion blur coverage in premultiplied alpha while legacy R6 defaults preserve coverage exactly", () => {
  const src = pixels(9, 9, [255, 0, 0, 0]);
  src.set([0, 0, 255, 255], (4 * 9 + 4) * 4);
  for (const op of [
    { kind: "gaussian" as const, radius: 1 },
    { kind: "motion" as const, length: 3, angle: 0 },
  ]) {
    const legacy = processColor(src, 9, 9, op),
      smart = processSmart(src, 9, 9, op),
      neighbor = (4 * 9 + 3) * 4;
    assert.equal(legacy[neighbor + 3], 0);
    assert.ok(smart[neighbor + 3]! > 0);
    assert.deepEqual([...smart.slice(neighbor, neighbor + 3)], [0, 0, 255]);
    assert.ok(smart[(4 * 9 + 4) * 4 + 3]! < 255);
  }
});
