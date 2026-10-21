import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGradient, gradientField, gradientPixels, validateGradient } from "./gradient.ts";
import {
  defaultEffect,
  effectPixels,
  blurAlpha,
  morphology,
  effectPadding,
  validateEffects,
  overPixels,
  EFFECT_NAMES,
} from "./effects.ts";
import { layer, fromPanel, validateDocument, type ProSession } from "./model.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { documentSources } from "./raster-budget.ts";
import { groupLayers, planMerge } from "./layers.ts";
const pixel = (data: Uint8ClampedArray, w: number, x: number, y: number) => [
  ...data.slice((y * w + x) * 4, (y * w + x) * 4 + 4),
];
const center = () => {
  const data = new Uint8ClampedArray(5 * 5 * 4);
  data.set([255, 0, 0, 255], (2 * 5 + 2) * 4);
  return data;
};
test("linear gradient has exact edge geometry, angle and translated center", () => {
  const g = defaultGradient(),
    sample = gradientField(g, 100, 50);
  assert.deepEqual(sample(0, 25), [0, 0, 0, 1]);
  assert.deepEqual(sample(100, 25), [1, 1, 1, 1]);
  assert.deepEqual(sample(50, 25), [0.5, 0.5, 0.5, 1]);
  const vertical = gradientField({ ...g, angle: 90 }, 100, 50);
  assert.ok(vertical(50, 0)[0] < 1e-10);
  assert.ok(Math.abs(vertical(50, 50)[0] - 1) < 1e-10);
  assert.equal(gradientField({ ...g, center: { x: 0.25, y: 0.5 } }, 100, 50)(25, 25)[0], 0.5);
  assert.equal(gradientField({ ...g, scale: 2 }, 100, 50)(100, 25)[0], 0.75);
});
test("radial gradient uses an ellipse with normalized center, scale and rotation", () => {
  const g = { ...defaultGradient(), kind: "radial" as const },
    sample = gradientField(g, 100, 50);
  assert.deepEqual(sample(50, 25), [0, 0, 0, 1]);
  assert.equal(sample(100, 25)[0], 1);
  assert.equal(sample(50, 50)[0], 1);
  assert.equal(gradientField({ ...g, scale: 2 }, 100, 50)(100, 25)[0], 0.5);
  assert.equal(gradientField({ ...g, angle: 90 }, 100, 50)(75, 25)[0], 1);
});
test("gradient pixels use pixel centers and premultiplied transparent stops at native resolution", () => {
  const g = defaultGradient();
  g.stops = [
    { position: 0, color: "#ff0000", opacity: 1 },
    { position: 1, color: "#0000ff", opacity: 0 },
  ];
  assert.deepEqual([...gradientPixels(2, 1, g)], [255, 0, 0, 191, 255, 0, 0, 64]);
});
for (const patch of [
  { scale: 0 },
  { angle: Infinity },
  { center: { x: 4, y: 0 } },
  { kind: "fake" },
  { stops: [] },
])
  test("gradient validation rejects " + JSON.stringify(patch), () =>
    assert.throws(() =>
      validateGradient({ ...defaultGradient(), ...patch } as ReturnType<typeof defaultGradient>),
    ),
  );
test("zero-radius blur is exact; Gaussian approximation is symmetric, bounded, normalized and source-safe", () => {
  const a = new Float32Array(15 * 15);
  a[7 * 15 + 7] = 1;
  assert.deepEqual(blurAlpha(a, 15, 15, 0), a);
  const b = blurAlpha(a, 15, 15, 2);
  assert.ok(Math.abs(b.reduce((s, v) => s + v, 0) - 1) < 1e-6);
  assert.ok(Math.abs(b[7 * 15 + 7]! - 49 / 729) < 1e-6);
  assert.equal(b[7 * 15 + 6], b[7 * 15 + 8]);
  assert.equal(a[7 * 15 + 7], 1);
});
test("morphology includes transparent virtual edges and has correct inside/outside extents", () => {
  const a = new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual([...morphology(a, 3, 3, 1, true)], Array(9).fill(1));
  assert.deepEqual(
    [...morphology(new Float32Array(9).fill(1), 3, 3, 1, false)],
    [0, 0, 0, 0, 1, 0, 0, 0, 0],
  );
});
test("drop shadow is a real shifted silhouette behind unchanged source pixels", () => {
  const a = center(),
    e = { ...defaultEffect("dropShadow"), radius: 0, distance: 1, angle: 0 },
    out = effectPixels(a, 5, 5, [e]);
  assert.deepEqual(pixel(out, 5, 2, 2), [255, 0, 0, 255]);
  assert.deepEqual(pixel(out, 5, 3, 2), [0, 0, 0, 255]);
  assert.equal(pixel(out, 5, 1, 2)[3], 0);
  assert.deepEqual(a, center());
});
test("inner shadow and glow preserve original alpha and never color exterior pixels", () => {
  for (const kind of ["innerShadow", "innerGlow"] as const) {
    const a = center();
    a[(2 * 5 + 2) * 4 + 3] = 128;
    const out = effectPixels(a, 5, 5, [
      { ...defaultEffect(kind), radius: 0, distance: 1, angle: 0 },
    ]);
    assert.equal(pixel(out, 5, 2, 2)[3], 128);
    assert.equal(pixel(out, 5, 1, 2)[3], 0);
  }
});
test("outer glow extends beyond artwork without modifying its opaque center", () => {
  const out = effectPixels(center(), 5, 5, [{ ...defaultEffect("outerGlow"), radius: 2 }]);
  assert.deepEqual(pixel(out, 5, 2, 2), [255, 0, 0, 255]);
  assert.ok(pixel(out, 5, 1, 2)[3]! > 0);
});
test("outside stroke is a morphological ring; inside stroke preserves alpha and interior fill", () => {
  const e = { ...defaultEffect("stroke"), size: 1, color: "#0000ff" },
    out = effectPixels(center(), 5, 5, [e]);
  assert.deepEqual(pixel(out, 5, 1, 1), [0, 0, 255, 255]);
  assert.deepEqual(pixel(out, 5, 2, 2), [255, 0, 0, 255]);
  assert.equal(pixel(out, 5, 0, 0)[3], 0);
  const a = new Uint8ClampedArray(5 * 5 * 4);
  for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) a.set([255, 0, 0, 255], (y * 5 + x) * 4);
  const inside = effectPixels(a, 5, 5, [{ ...e, position: "inside" }]);
  assert.deepEqual(pixel(inside, 5, 1, 1), [0, 0, 255, 255]);
  assert.deepEqual(pixel(inside, 5, 2, 2), [255, 0, 0, 255]);
  assert.equal(pixel(inside, 5, 0, 0)[3], 0);
});
test("Color Overlay and ordered top styles retain fill alpha and actually reorder color", () => {
  const a = center(),
    red = { ...defaultEffect("colorOverlay"), color: "#00ff00" },
    gradient = {
      ...defaultEffect("gradientOverlay"),
      gradient: {
        ...defaultGradient(),
        stops: [
          { position: 0, color: "#0000ff", opacity: 1 },
          { position: 1, color: "#0000ff", opacity: 1 },
        ],
      },
    };
  const one = effectPixels(a, 5, 5, [red, gradient]),
    two = effectPixels(a, 5, 5, [gradient, red]);
  assert.deepEqual(pixel(one, 5, 2, 2), [0, 0, 255, 255]);
  assert.deepEqual(pixel(two, 5, 2, 2), [0, 255, 0, 255]);
  assert.equal(pixel(one, 5, 0, 0)[3], 0);
});
test("Gradient Overlay uses artwork bounds and preserves fractional alpha", () => {
  const source = new Uint8ClampedArray([255, 0, 0, 40, 255, 0, 0, 80]),
    out = effectPixels(source, 2, 1, [defaultEffect("gradientOverlay")]);
  assert.deepEqual([...out], [64, 64, 64, 40, 191, 191, 191, 80]);
});
test("style opacity and normal/multiply compositing honor source-over alpha", () => {
  assert.deepEqual(
    [
      ...overPixels(
        new Uint8ClampedArray([0, 255, 0, 128]),
        new Uint8ClampedArray([0, 0, 255, 128]),
      ),
    ],
    [0, 85, 170, 192],
  );
  assert.deepEqual(
    [
      ...overPixels(
        new Uint8ClampedArray([128, 128, 128, 255]),
        new Uint8ClampedArray([128, 128, 128, 255]),
        1,
        "multiply",
      ),
    ],
    [64, 64, 64, 255],
  );
});
test("disabled effects are byte exact and do not expand rendering bounds", () => {
  const e = { ...defaultEffect("dropShadow"), enabled: false };
  assert.deepEqual(effectPixels(center(), 5, 5, [e]), center());
  const d = fromPanel({ id: "p", name: "p", width: 10, height: 10 });
  d.layers[0]!.effects = [e];
  assert.equal(effectPadding(d), 0);
});
test("nested group effect extents add up; preview rounding, hidden ancestors and cycles are safe", () => {
  const d = fromPanel({ id: "p", name: "p", width: 10, height: 10 }),
    g = layer("group", 10, 10, "g");
  g.effects = [{ ...defaultEffect("outerGlow"), radius: 1 }];
  d.layers[0]!.parentId = g.id;
  d.layers[0]!.effects = [{ ...defaultEffect("dropShadow"), distance: 10, radius: 2 }];
  d.layers.push(g);
  assert.equal(effectPadding(d), 16);
  assert.equal(effectPadding(d, 0.1), 7);
  g.visible = false;
  assert.equal(effectPadding(d), 0);
  g.visible = true;
  g.parentId = g.id;
  assert.throws(() => effectPadding(d), /hierarchy/);
});
for (const kind of Object.keys(EFFECT_NAMES) as (keyof typeof EFFECT_NAMES)[])
  test(`${kind} defaults validate and support native editable metadata`, () =>
    validateEffects([defaultEffect(kind)]));
test("malformed, duplicate and over-budget effects are rejected before pixel allocation", () => {
  assert.throws(() =>
    validateEffects([{ ...defaultEffect("stroke"), kind: "__proto__" }] as never),
  );
  assert.throws(() => validateEffects([defaultEffect("stroke"), defaultEffect("stroke")]));
  assert.throws(() => validateEffects([{ ...defaultEffect("outerGlow"), radius: 65 }]));
  const d = fromPanel({ id: "p", name: "p", width: 16384, height: 1 });
  d.layers[0]!.effects = [{ ...defaultEffect("dropShadow"), distance: 256, radius: 64 }];
  assert.throws(() => documentSources(d, 4_000_000), /padded/);
});
test("gradient, adjustment, styles and masks survive native/history roundtrip with source bytes unchanged", async () => {
  const d = fromPanel({ id: "p", name: "p", width: 32, height: 24 }),
    g = layer("gradient", 32, 24),
    a = layer("adjustment", 32, 24);
  g.gradient!.kind = "radial";
  g.effects = [defaultEffect("innerGlow")];
  a.color = { threshold: 128 };
  a.opacity = 0.5;
  a.mask = { selection: { regions: [], inverted: true, feather: 1 }, enabled: true, strokes: [] };
  const next = { ...d, layers: [...d.layers, g, a] },
    h = record(createHistory(d), next);
  assert.deepEqual(undo(h).present, d);
  assert.deepEqual(redo(undo(h)).present, next);
  const session: ProSession = {
    document: next,
    assets: { source: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) },
    revision: 0,
    acceptedBlobId: "m",
    updatedAt: 0,
  };
  const reopen = await readNative(await nativeFile(session), "p", "m");
  assert.deepEqual(reopen.document, next);
  assert.deepEqual([...new Uint8Array(await reopen.assets.source!.arrayBuffer())], [1, 2, 3]);
  assert.throws(() => vectorSvg(next), /does not support/);
});
test("adjustments may be clipped to artwork but cannot silently serve as clipping bases", () => {
  const d = fromPanel({ id: "p", name: "p", width: 32, height: 24 }),
    a = layer("adjustment", 32, 24),
    clip = layer("shape", 32, 24);
  a.clipped = true;
  d.layers.push(a);
  validateDocument(d);
  a.clipped = false;
  clip.clipped = true;
  d.layers.push(clip);
  assert.throws(() => validateDocument(d), /clipping base/);
});
test("backdrop-dependent grouping and partial merges of adjustments reject safely", () => {
  const d = fromPanel({ id: "p", name: "p", width: 32, height: 24 }),
    a = layer("adjustment", 32, 24),
    shape = layer("shape", 32, 24);
  d.layers.push(a, shape);
  assert.throws(() => groupLayers(d, [a.id, shape.id]), /complete backdrop/);
  assert.throws(() => planMerge(d, "selected", [a.id, shape.id], "new"), /Merge visible/);
  assert.doesNotThrow(() => planMerge(d, "visible", [], "new"));
});

test("zero-width stroke and zero-radius glows do not thicken fractional-alpha edges", () => {
  const source = new Uint8ClampedArray([200, 10, 30, 128, 10, 200, 30, 20]);
  for (const e of [
    { ...defaultEffect("stroke"), size: 0 },
    { ...defaultEffect("innerGlow"), radius: 0 },
    { ...defaultEffect("outerGlow"), radius: 0 },
    { ...defaultEffect("innerShadow"), radius: 0, distance: 0 },
  ])
    assert.deepEqual(effectPixels(source, 2, 1, [e]), source);
});
