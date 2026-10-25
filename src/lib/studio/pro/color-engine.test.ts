import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLOR_OPERATIONS,
  defaultOperation,
  validateOperation,
  processColor,
  curveLut,
  levelValue,
  rgbToHsl,
  hslToRgb,
  histogram,
  validateColorWork,
  decodeSrgb,
  encodeSrgb,
  type ColorOperation,
} from "./color-engine.ts";
import {
  COLOR_PRESETS,
  validateColorPresets,
  loadColorPresets,
  storeColorPresets,
} from "./color-presets.ts";
const run = (pixels: number[], a: ColorOperation) => [
  ...processColor(new Uint8ClampedArray(pixels), pixels.length / 4, 1, a),
];
const near = (a: number, b: number, t = 0.000001) =>
  assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);
const sample = [32, 64, 128, 255, 140, 90, 10, 128, 37, 73, 125, 0];
test("every default operation validates and preserves alpha and invisible source RGB", () => {
  for (const kind of Object.keys(COLOR_OPERATIONS) as ColorOperation["kind"][]) {
    const a = defaultOperation(kind);
    validateOperation(a);
    const out = run(sample, a);
    assert.deepEqual([out[3], out[7], ...out.slice(8)], [255, 128, ...sample.slice(8)], kind);
  }
});
test("neutral color settings are byte exact and source remains immutable", () => {
  for (const kind of [
    "brightnessContrast",
    "levels",
    "curves",
    "hsl",
    "balance",
    "exposure",
    "vibrance",
  ] as const) {
    const input = new Uint8ClampedArray(sample),
      copy = input.slice();
    assert.deepEqual(processColor(input, 3, 1, defaultOperation(kind)), copy, kind);
    assert.deepEqual(input, copy);
  }
});
test("brightness and contrast reuse existing bounded midpoint model with exact known pixels", () => {
  assert.deepEqual(
    run([50, 100, 150, 89], { kind: "brightnessContrast", brightness: 20, contrast: 0 }),
    [101, 151, 201, 89],
  );
  assert.deepEqual(
    run([64, 128, 192, 255], { kind: "brightnessContrast", brightness: 0, contrast: 50 }),
    [0, 128, 255, 255],
  );
});
test("levels input/output endpoints and gamma have known analytical values", () => {
  const level = { black: 32, white: 224, gamma: 2, outBlack: 16, outWhite: 240 };
  near(levelValue(32, level), 16);
  near(levelValue(224, level), 240);
  near(levelValue(80, level), 128);
  near(levelValue(0, level), 16);
  near(levelValue(255, level), 240);
});
test("levels independent red and composite channels compose without changing other channels", () => {
  const a = defaultOperation("levels") as Extract<ColorOperation, { kind: "levels" }>;
  a.channels.red = { black: 0, white: 255, gamma: 1, outBlack: 20, outWhite: 220 };
  assert.deepEqual(run([0, 64, 255, 128], a), [20, 64, 255, 128]);
  a.channels.rgb = { black: 0, white: 255, gamma: 1, outBlack: 10, outWhite: 210 };
  const out = run([0, 0, 0, 255], a);
  assert.deepEqual(out, [28, 10, 10, 255]);
});
test("invalid levels and unknown channels are rejected before processing", () => {
  const a = defaultOperation("levels") as Extract<ColorOperation, { kind: "levels" }>;
  for (const patch of [
    { black: 255 },
    { white: 0 },
    { gamma: 0 },
    { outBlack: 255 },
    { outWhite: 0 },
    { black: 128, white: 128 },
    { outBlack: 20, outWhite: 20 },
  ])
    assert.throws(() =>
      validateOperation({
        ...a,
        channels: { ...a.channels, rgb: { ...a.channels.rgb, ...patch } },
      }),
    );
  assert.throws(() =>
    validateOperation({ ...a, channels: { ...a.channels, alpha: a.channels.rgb } }),
  );
});
test("curve identity, all knots and monotone interpolation remain precise without overshoot", () => {
  const points = [
      { x: 0, y: 0 },
      { x: 40, y: 10 },
      { x: 80, y: 200 },
      { x: 200, y: 200 },
      { x: 255, y: 255 },
    ],
    lut = curveLut(points);
  for (const p of points) near(lut[p.x]!, p.y);
  for (let i = 1; i < 256; i++) assert.ok(lut[i]! >= lut[i - 1]! - 1e-9 && lut[i]! <= 255);
  const identity = curveLut([
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ]);
  for (let i = 0; i < 256; i++) near(identity[i]!, i);
});
test("nonmonotone creative curves have no local segment overshoot or discontinuous knots", () => {
  const points = [
      { x: 0, y: 250 },
      { x: 30, y: 20 },
      { x: 80, y: 200 },
      { x: 130, y: 80 },
      { x: 255, y: 80 },
    ],
    lut = curveLut(points);
  for (let j = 0; j < points.length - 1; j++) {
    const a = points[j]!,
      b = points[j + 1]!;
    for (let x = a.x; x <= b.x; x++)
      assert.ok(lut[x]! >= Math.min(a.y, b.y) - 1e-8 && lut[x]! <= Math.max(a.y, b.y) + 1e-8);
  }
});
test("channel curves perform true inversion and preserve exact alpha", () => {
  const a = defaultOperation("curves") as Extract<ColorOperation, { kind: "curves" }>;
  a.channels.red = [
    { x: 0, y: 255 },
    { x: 255, y: 0 },
  ];
  assert.deepEqual(run([10, 90, 200, 77], a), [245, 90, 200, 77]);
});
test("curve validation rejects duplicate/unsorted inputs, missing endpoints and oversized data", () => {
  const a = defaultOperation("curves") as Extract<ColorOperation, { kind: "curves" }>;
  for (const p of [
    [
      { x: 1, y: 0 },
      { x: 255, y: 255 },
    ],
    [
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 255, y: 255 },
    ],
    [
      { x: 0, y: 0 },
      { x: 80, y: 256 },
      { x: 255, y: 255 },
    ],
    Array.from({ length: 17 }, (_, i) => ({ x: i === 16 ? 255 : i * 15, y: i * 15 })),
  ])
    assert.throws(() => validateOperation({ ...a, channels: { ...a.channels, rgb: p } }));
});
test("HSL conversion round-trips primaries, grays and a deterministic RGB lattice", () => {
  for (const r of [0, 0.1, 0.5, 1])
    for (const g of [0, 0.2, 0.6, 1])
      for (const b of [0, 0.3, 0.7, 1]) {
        const out = hslToRgb(...rgbToHsl(r, g, b));
        [r, g, b].forEach((v, i) => near(out[i]!, v));
      }
  assert.deepEqual(rgbToHsl(0.5, 0.5, 0.5), [0, 0, 0.5]);
});
test("HSL hue wraps correctly and selective ranges retain unrelated colors", () => {
  const a: ColorOperation = { kind: "hsl", hue: 120, saturation: 0, lightness: 0, range: "all" };
  assert.deepEqual(run([255, 0, 0, 255], a), [0, 255, 0, 255]);
  assert.deepEqual(run([0, 0, 255, 255], a), [255, 0, 0, 255]);
  assert.deepEqual(run([0, 255, 255, 128], { ...a, range: "reds" }), [0, 255, 255, 128]);
  assert.deepEqual(
    run([80, 120, 180, 128], { ...a, hue: 0, saturation: -100 }),
    [130, 130, 130, 128],
  );
});
test("linear exposure uses sRGB transfer and gamma is stable for black and white", () => {
  for (const n of [0, 0.001, 0.03, 0.18, 0.5, 1]) near(encodeSrgb(decodeSrgb(n)), n);
  const out = run([64, 128, 200, 100], { kind: "exposure", stops: 1, gamma: 1 });
  assert.deepEqual(out, [90, 176, 255, 100]);
  assert.deepEqual(
    run([0, 128, 255, 255], { kind: "exposure", stops: 0, gamma: 2 }),
    [0, 181, 255, 255],
  );
  assert.deepEqual(
    run([0, 0, 0, 255, 255, 255, 255, 128], { kind: "exposure", stops: 5, gamma: 0.1 }),
    [0, 0, 0, 255, 255, 255, 255, 128],
  );
});
test("vibrance preferentially boosts muted pixels while full saturation remains bounded", () => {
  assert.deepEqual(
    run([255, 0, 0, 255], { kind: "vibrance", vibrance: 100, saturation: 0 }),
    [255, 0, 0, 255],
  );
  const out = run([80, 100, 120, 255], { kind: "vibrance", vibrance: 100, saturation: 0 });
  assert.ok(out[2]! - out[0]! > 40);
  const gray = run([80, 100, 120, 255], { kind: "vibrance", vibrance: 0, saturation: -100 });
  assert.equal(gray[0], gray[1]);
  assert.equal(gray[1], gray[2]);
});
test("tonal balance favors shadows and preserved encoded luma remains within byte rounding", () => {
  const a: ColorOperation = {
    kind: "balance",
    shadows: [30, 0, 0],
    midtones: [0, 0, 0],
    highlights: [0, 0, 0],
    preserveLuminance: false,
  };
  const d = run([32, 32, 32, 255], a),
    l = run([224, 224, 224, 255], a);
  assert.ok(d[0]! - 32 > l[0]! - 224 + 40);
  const out = run([80, 120, 180, 255], { ...a, preserveLuminance: true });
  near(
    0.2126 * out[0]! + 0.7152 * out[1]! + 0.0722 * out[2]!,
    0.2126 * 80 + 0.7152 * 120 + 0.0722 * 180,
    0.6,
  );
});
test("B&W channel mixing defaults to documented luma and accepts isolated primary weights", () => {
  assert.deepEqual(run([255, 0, 0, 100], defaultOperation("blackWhite")), [54, 54, 54, 100]);
  assert.deepEqual(
    run([50, 120, 240, 89], { kind: "blackWhite", red: 0, green: 100, blue: 0 }),
    [120, 120, 120, 89],
  );
});
test("invert, binary threshold and discrete posterize have exact reference pixels", () => {
  assert.deepEqual(run([10, 90, 200, 77], { kind: "invert" }), [245, 165, 55, 77]);
  assert.deepEqual(
    run([127, 127, 127, 128, 128, 128, 128, 64], { kind: "threshold", level: 128 }),
    [0, 0, 0, 128, 255, 255, 255, 64],
  );
  assert.deepEqual(
    run([64, 128, 200, 128], { kind: "posterize", levels: 3 }),
    [128, 128, 255, 128],
  );
});
test("histogram uses real visible RGB and alpha-weighted luma, ignoring invisible RGB", () => {
  const bins = histogram(new Uint8ClampedArray([255, 0, 0, 255, 20, 40, 60, 128, 200, 30, 10, 0]));
  near(bins.red[255]!, 1);
  near(bins.red[20]!, 128 / 255);
  near(bins.red[200]!, 0);
  near(
    bins.rgb.reduce((a, b) => a + b, 0),
    1 + 128 / 255,
  );
  assert.equal(bins.rgb[54], 1);
});
test("Gaussian impulse matches the analytical separable normalized kernel", () => {
  const pixels = new Uint8ClampedArray(7 * 7 * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  pixels[(3 * 7 + 3) * 4] = 255;
  const out = processColor(pixels, 7, 7, { kind: "gaussian", radius: 1 }),
    kernel = Array.from({ length: 7 }, (_, i) => Math.exp(-((i - 3) ** 2) / 2)),
    sum = kernel.reduce((a, b) => a + b, 0);
  assert.equal(out[(3 * 7 + 3) * 4], Math.round(255 / (sum * sum)));
  assert.equal(out[(3 * 7 + 4) * 4], out[(4 * 7 + 3) * 4]);
});
test("blur never imports invisible blue into visible red or spreads source alpha", () => {
  for (const a of [
    { kind: "gaussian", radius: 1 },
    { kind: "box", radius: 2 },
    { kind: "motion", length: 5, angle: 0 },
  ] as ColorOperation[]) {
    const out = run([255, 0, 0, 128, 0, 0, 255, 0, 255, 0, 0, 255], a);
    assert.deepEqual(out, [255, 0, 0, 128, 0, 0, 255, 0, 255, 0, 0, 255], a.kind);
  }
});
test("box clamp border and motion direction produce distinct known results", () => {
  const source = [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255];
  assert.deepEqual(
    run(source, { kind: "box", radius: 1 }).filter((_, i) => i % 4 === 0),
    [85, 85, 85],
  );
  assert.deepEqual(run(source, { kind: "motion", length: 3, angle: 90 }), source);
  assert.deepEqual(
    run(source, { kind: "motion", length: 3, angle: 0 }).filter((_, i) => i % 4 === 0),
    [85, 85, 85],
  );
});
test("unsharp threshold prevents low-contrast changes and high pass offsets detail around middle gray", () => {
  const source = [90, 90, 90, 255, 100, 100, 100, 255, 90, 90, 90, 255];
  assert.deepEqual(
    run(source, { kind: "unsharp", radius: 1, amount: 300, threshold: 255 }),
    source,
  );
  const high = run(source, { kind: "highPass", radius: 1 });
  assert.ok(high[0]! < 128 && high[4]! > 128);
  const sharp = run(source, { kind: "sharpen", amount: 100 });
  assert.deepEqual(
    sharp.filter((_, i) => i % 4 === 0),
    [80, 120, 80],
  );
});
test("median removes isolated impulse, respects alpha weights and keeps hard borders", () => {
  const p = Array.from({ length: 9 }, (_, i) => [
    i === 4 ? 255 : 40,
    i === 4 ? 255 : 40,
    i === 4 ? 255 : 40,
    255,
  ]).flat();
  assert.deepEqual(
    [...processColor(new Uint8ClampedArray(p), 3, 3, { kind: "median", radius: 1 })].slice(16, 20),
    [40, 40, 40, 255],
  );
  const out = run([255, 0, 0, 128, 0, 0, 255, 0, 255, 0, 0, 255], { kind: "median", radius: 1 });
  assert.deepEqual(out, [255, 0, 0, 128, 0, 0, 255, 0, 255, 0, 0, 255]);
});
test("Sobel yields no edge on constants and a visible line on a step", () => {
  const flat = Array.from({ length: 9 }, () => [70, 90, 120, 128]).flat(),
    out = processColor(new Uint8ClampedArray(flat), 3, 3, { kind: "edges" });
  for (let p = 0; p < out.length; p += 4)
    assert.deepEqual([...out.slice(p, p + 4)], [0, 0, 0, 128]);
  const step = run([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255], { kind: "edges" });
  assert.ok(step[0]! > 0);
  assert.equal(step[8], 0);
});
test("seeded noise is repeatable, mono remains achromatic and differing seeds differ", () => {
  const input = [128, 128, 128, 128, 128, 128, 128, 255],
    a: ColorOperation = { kind: "noise", amount: 20, monochrome: true, seed: 12345 };
  const first = run(input, a);
  assert.deepEqual(first, run(input, a));
  assert.notDeepEqual(first, run(input, { ...a, seed: 12346 }));
  assert.equal(first[0], first[1]);
  assert.equal(first[1], first[2]);
  assert.notDeepEqual(first, run(input, { ...a, monochrome: false }));
});
test("selection coverage crossfades RGB once, with exact alpha and source preservation", () => {
  const input = new Uint8ClampedArray([20, 40, 80, 128, 20, 40, 80, 128, 20, 40, 80, 128]),
    out = processColor(input, 3, 1, { kind: "invert" }, new Uint8ClampedArray([0, 128, 255]));
  assert.deepEqual([...out], [20, 40, 80, 128, 128, 128, 128, 128, 235, 215, 175, 128]);
  assert.deepEqual([...input.slice(0, 4)], [20, 40, 80, 128]);
});
test("repeat previews always derive from the stable source rather than the previous result", () => {
  const source = new Uint8ClampedArray(sample),
    first = processColor(source, 3, 1, { kind: "exposure", stops: 1, gamma: 1 });
  processColor(source, 3, 1, { kind: "exposure", stops: -1, gamma: 1 });
  assert.deepEqual(first, processColor(source, 3, 1, { kind: "exposure", stops: 1, gamma: 1 }));
  assert.deepEqual([...source], sample);
});
test("resource checks reject area, invalid dimensions, huge kernels and mismatched buffers", () => {
  assert.throws(() => validateColorWork(2001, 2000, defaultOperation("invert")), /4MP/);
  assert.throws(() => validateColorWork(0, 1, defaultOperation("invert")));
  assert.throws(
    () => validateColorWork(2000, 2000, { kind: "gaussian", radius: 32 }),
    /kernel-work/,
  );
  assert.throws(() => validateColorWork(2000, 2000, { kind: "median", radius: 3 }), /kernel-work/);
  assert.throws(() => processColor(new Uint8ClampedArray(4), 2, 1, { kind: "invert" }));
  assert.throws(() =>
    processColor(new Uint8ClampedArray(4), 1, 1, { kind: "invert" }, new Uint8ClampedArray(2)),
  );
});
test("untrusted operation settings reject nonfinite/extra keys and malformed variants", () => {
  for (const a of [
    null,
    [],
    {},
    { kind: "toString" },
    { kind: "invert", secret: true },
    { kind: "exposure", stops: Infinity, gamma: 1 },
    { kind: "posterize", levels: 2.5 },
    { kind: "noise", amount: 10, seed: -1, monochrome: true },
    { kind: "hsl", hue: 0, saturation: 0, lightness: 0, range: "ultraviolet" },
  ])
    assert.throws(() => validateOperation(a));
});
test("factory and custom presets contain real validated values and round-trip without native changes", () => {
  COLOR_PRESETS.forEach((p) => validateOperation(p.operation));
  const presets = [{ name: "My curve", operation: defaultOperation("curves") }];
  validateColorPresets(presets);
  let data = "";
  storeColorPresets(
    {
      setItem: (_, v) => {
        data = v;
      },
    },
    presets,
  );
  assert.deepEqual(loadColorPresets({ getItem: () => data }), presets);
  assert.deepEqual(loadColorPresets({ getItem: () => "{broken" }), []);
  assert.deepEqual(
    loadColorPresets({ getItem: () => JSON.stringify({ version: 2, presets }) }),
    [],
  );
});
test("custom presets reject factory shadowing, duplicates, injection and oversized storage", () => {
  for (const value of [
    [{ name: "grayscale", operation: { kind: "invert" } }],
    [
      { name: "a", operation: { kind: "invert" } },
      { name: " A ", operation: { kind: "invert" } },
    ],
    [{ name: "x", operation: { kind: "unknown" } }],
    Array.from({ length: 33 }, (_, i) => ({ name: `custom ${i}`, operation: { kind: "invert" } })),
    [{ name: "x\n", operation: { kind: "invert" } }],
  ])
    assert.throws(() => validateColorPresets(value));
  assert.deepEqual(loadColorPresets({ getItem: () => "a".repeat(100001) }), []);
  assert.throws(() => storeColorPresets(undefined, []));
});

test("selective HSL excludes achromatic pixels and fades near-neutral coverage smoothly", () => {
  const a: ColorOperation = { kind: "hsl", hue: 120, saturation: 50, lightness: 50, range: "reds" };
  assert.deepEqual(run([128, 128, 128, 128], a), [128, 128, 128, 128]);
  const subtle = run([130, 128, 128, 255], a),
    saturated = run([200, 100, 100, 255], a);
  assert.ok(subtle[1]! - 128 < saturated[1]! - 100);
});
