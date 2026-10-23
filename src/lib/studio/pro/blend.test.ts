import { test } from "node:test";
import assert from "node:assert/strict";
import { BLEND_GROUPS, BLEND_LABELS, BLEND_MODES, blendColor, isBlendMode } from "./blend.ts";
import { blendClippedPixels } from "./clipping.ts";
import { overPixels } from "./effects.ts";
import { layer, validateDocument, type ProDocument } from "./model.ts";

/** The pre-R2 formulas, kept verbatim to prove the original six modes are unchanged. */
function legacy(mode: string, b: number, s: number) {
  return mode === "multiply"
    ? b * s
    : mode === "screen"
      ? b + s - b * s
      : mode === "overlay"
        ? b <= 0.5
          ? 2 * b * s
          : 1 - 2 * (1 - b) * (1 - s)
        : mode === "darken"
          ? Math.min(b, s)
          : mode === "lighten"
            ? Math.max(b, s)
            : s;
}
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const close = (a: number[], b: number[], tolerance = 1e-9) =>
  a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

test("every mode has a label and appears in exactly one menu group", () => {
  assert.equal(BLEND_MODES.length, 16);
  const grouped = BLEND_GROUPS.flat();
  assert.deepEqual([...grouped].sort(), [...BLEND_MODES].sort());
  for (const mode of BLEND_MODES) assert.ok(BLEND_LABELS[mode]);
  assert.ok(isBlendMode("soft-light"));
  assert.ok(!isBlendMode("dissolve"));
  assert.ok(!isBlendMode(undefined));
});

test("original six modes produce byte-identical clipped and effect output", () => {
  const next = random(7);
  for (const mode of [
    "source-over",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
  ] as const) {
    const base = new Uint8ClampedArray(4 * 500).map(() => Math.floor(next() * 256)),
      source = new Uint8ClampedArray(4 * 500).map(() => Math.floor(next() * 256)),
      expected = new Uint8ClampedArray(base);
    for (let i = 0; i < base.length; i += 4) {
      if (!base[i + 3]) continue;
      const alpha = (source[i + 3]! / 255) * 0.8;
      if (!alpha) continue;
      for (let c = 0; c < 3; c++) {
        const b = base[i + c]! / 255,
          s = source[i + c]! / 255;
        expected[i + c] = Math.round((b * (1 - alpha) + legacy(mode, b, s) * alpha) * 255);
      }
    }
    assert.deepEqual(blendClippedPixels(new Uint8ClampedArray(base), source, 0.8, mode), expected);

    const back = new Uint8ClampedArray(base),
      legacyBack = new Uint8ClampedArray(base);
    for (let i = 0; i < legacyBack.length; i += 4) {
      const ab = legacyBack[i + 3]! / 255,
        as = (source[i + 3]! / 255) * 0.6,
        a = as + ab * (1 - as);
      if (!as) continue;
      for (let c = 0; c < 3; c++) {
        const b = legacyBack[i + c]! / 255,
          s = source[i + c]! / 255,
          m = legacy(mode, b, s);
        legacyBack[i + c] = a ? ((as * ((1 - ab) * s + ab * m) + ab * (1 - as) * b) / a) * 255 : 0;
      }
      legacyBack[i + 3] = a * 255;
    }
    assert.deepEqual(overPixels(back, source, 0.6, mode), legacyBack);
  }
});

test("separable modes match W3C Compositing Level 1 reference values", () => {
  const g = (mode: Parameters<typeof blendColor>[0], b: number, s: number) =>
    blendColor(mode, [b, b, b], [s, s, s])[0];
  assert.equal(g("color-dodge", 0, 0.7), 0);
  assert.equal(g("color-dodge", 0.4, 1), 1);
  assert.equal(g("color-dodge", 0.25, 0.5), 0.5);
  assert.equal(g("color-dodge", 0.8, 0.5), 1);
  assert.equal(g("color-burn", 1, 0), 1);
  assert.equal(g("color-burn", 0.6, 0), 0);
  assert.equal(g("color-burn", 0.75, 0.5), 0.5);
  assert.equal(g("hard-light", 0.4, 0.25), 0.2);
  assert.ok(Math.abs(g("hard-light", 0.4, 0.75) - 0.7) < 1e-12);
  assert.ok(Math.abs(g("soft-light", 0.5, 0.25) - 0.375) < 1e-12);
  assert.ok(
    Math.abs(
      g("soft-light", 0.16, 0.75) - (0.16 + 0.5 * (((16 * 0.16 - 12) * 0.16 + 4) * 0.16 - 0.16)),
    ) < 1e-12,
  );
  assert.ok(Math.abs(g("soft-light", 0.64, 0.75) - (0.64 + 0.5 * (0.8 - 0.64))) < 1e-12);
  assert.ok(Math.abs(g("difference", 0.2, 0.9) - 0.7) < 1e-12);
  assert.ok(Math.abs(g("exclusion", 0.5, 0.5) - 0.5) < 1e-12);
  for (const mode of BLEND_MODES)
    for (const b of [0, 0.3, 1])
      for (const s of [0, 0.6, 1]) {
        const v = g(mode, b, s);
        assert.ok(v >= -1e-12 && v <= 1 + 1e-12, `${mode} stays in range`);
      }
});

test("component modes keep the expected hue, saturation and luminosity", () => {
  const lum = (c: number[]) => 0.3 * c[0]! + 0.59 * c[1]! + 0.11 * c[2]!;
  const red: [number, number, number] = [1, 0, 0],
    gray: [number, number, number] = [0.5, 0.5, 0.5],
    teal: [number, number, number] = [0.1, 0.6, 0.5];
  // Luminosity: backdrop colour, source luminance.
  assert.ok(Math.abs(lum(blendColor("luminosity", teal, gray)) - 0.5) < 1e-9);
  // Color: source hue+saturation, backdrop luminance; on gray backdrop luminance = 0.5.
  assert.ok(Math.abs(lum(blendColor("color", gray, red)) - 0.5) < 1e-9);
  // Saturation from a gray (zero-saturation) source removes colour.
  const desaturated = blendColor("saturation", teal, gray);
  assert.ok(close(desaturated, [lum(teal), lum(teal), lum(teal)], 1e-9));
  // Hue onto gray backdrop has no saturation to carry, so stays gray.
  assert.ok(close(blendColor("hue", gray, red), gray, 1e-9));
  for (const mode of ["hue", "saturation", "color", "luminosity"] as const)
    for (const c of blendColor(mode, teal, red)) assert.ok(c >= -1e-9 && c <= 1 + 1e-9);
});

test("documents accept the new modes and still reject unknown ones", () => {
  const doc: ProDocument = {
    version: 1,
    id: "d",
    name: "Blend",
    panelId: "p",
    width: 64,
    height: 64,
    background: "transparent",
    layers: [layer("paint", 64, 64, "a")],
  };
  for (const blend of BLEND_MODES)
    validateDocument({ ...doc, layers: [{ ...doc.layers[0]!, blend }] });
  assert.throws(() =>
    validateDocument({
      ...doc,
      layers: [{ ...doc.layers[0]!, blend: "dissolve" as never }],
    }),
  );
});
