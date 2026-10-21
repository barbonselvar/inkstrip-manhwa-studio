import { test } from "node:test";
import assert from "node:assert/strict";
import {
  colorPixels,
  gradientSampler,
  GRADIENT_PRESETS,
  validateColor,
  type ColorAdjustments,
} from "./color.ts";
import { fromPanel, layer, validateDocument, type ProSession } from "./model.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
const run = (rgba: number[], a: ColorAdjustments) => [
  ...colorPixels(new Uint8ClampedArray(rgba), a),
];
const sample = [80, 120, 180, 128, 90, 50, 12, 0];
test("neutral color pipeline is byte exact, including alpha and transparent source RGB", () => {
  assert.deepEqual(run(sample, {}), sample);
  assert.deepEqual(
    run(sample, {
      balance: {
        shadows: [0, 0, 0],
        midtones: [0, 0, 0],
        highlights: [0, 0, 0],
        preserveLuminance: true,
      },
      vibrance: 0,
      mixer: { red: [100, 0, 0, 0], green: [0, 100, 0, 0], blue: [0, 0, 100, 0] },
      shadowsHighlights: { shadows: 0, highlights: 0, width: 0.5 },
      posterize: 256,
    }),
    sample,
  );
});
test("Color Balance favors shadow range and can retain weighted luminance within rounding", () => {
  const b: NonNullable<ColorAdjustments["balance"]> = {
    shadows: [40, 0, 0],
    midtones: [0, 0, 0],
    highlights: [0, 0, 0],
    preserveLuminance: false,
  };
  const dark = run([32, 32, 32, 255], { balance: b }),
    light = run([224, 224, 224, 255], { balance: b });
  assert.ok(dark[0]! - 32 > light[0]! - 224 + 50);
  const result = run([80, 120, 180, 128], { balance: { ...b, preserveLuminance: true } });
  assert.ok(result[0]! > 80);
  assert.ok(
    Math.abs(
      0.2126 * result[0]! +
        0.7152 * result[1]! +
        0.0722 * result[2]! -
        (0.2126 * 80 + 0.7152 * 120 + 0.0722 * 180),
    ) < 0.6,
  );
  assert.equal(result[3], 128);
});
test("Vibrance increases muted chroma, leaves pure primaries unchanged, and can fully desaturate", () => {
  assert.deepEqual(run([255, 0, 0, 255], { vibrance: 100 }), [255, 0, 0, 255]);
  const a = run([80, 100, 120, 128], { vibrance: 100 });
  assert.ok(a[2]! - a[0]! > 40);
  assert.equal(a[3], 128);
  const b = run([80, 100, 120, 128], { vibrance: -100 });
  assert.equal(b[0], b[1]);
  assert.equal(b[1], b[2]);
});
test("Channel Mixer independently swaps channels and applies percentage constants without alpha changes", () => {
  assert.deepEqual(
    run([10, 40, 100, 87], {
      mixer: { red: [0, 0, 100, 0], green: [0, 100, 0, 10], blue: [100, 0, 0, 0] },
    }),
    [100, 66, 10, 87],
  );
});
test("Shadows/Highlights targets opposite luminance ranges with smooth tonal width", () => {
  const sh = { shadows: 60, highlights: 60, width: 0.5 },
    result = run([30, 30, 30, 100, 128, 128, 128, 128, 230, 230, 230, 230], {
      shadowsHighlights: sh,
    });
  assert.ok(result[0]! > 70);
  assert.equal(result[4], 128);
  assert.ok(result[8]! < 180);
  assert.deepEqual([result[3], result[7], result[11]], [100, 128, 230]);
});
test("Threshold includes the exact cutoff; Posterize has the requested number of quantization levels", () => {
  assert.deepEqual(
    run([127, 127, 127, 10, 128, 128, 128, 20], { threshold: 128 }),
    [0, 0, 0, 10, 255, 255, 255, 20],
  );
  assert.deepEqual(run([64, 128, 200, 128], { posterize: 3 }), [128, 128, 255, 128]);
});
test("Gradient stops interpolate premultiplied color and opacity with exact endpoints", () => {
  const at = gradientSampler([
    { position: 0, color: "#ff0000", opacity: 1 },
    { position: 1, color: "#0000ff", opacity: 0 },
  ]);
  assert.deepEqual(at(0), [1, 0, 0, 1]);
  assert.deepEqual(at(0.5), [1, 0, 0, 0.5]);
  assert.deepEqual(at(1), [0, 0, 0, 0]);
  assert.deepEqual(
    run([128, 128, 128, 128], {
      gradientMap: {
        stops: [
          { position: 0, color: "#ff0000", opacity: 1 },
          { position: 1, color: "#0000ff", opacity: 0 },
        ],
        amount: 1,
      },
    }),
    [255, 0, 0, 64],
  );
});
test("Gradient mapping respects inserted stops and amount zero is byte exact", () => {
  const stops = [
    { position: 0, color: "#000000", opacity: 1 },
    { position: 0.25, color: "#00ff00", opacity: 1 },
    { position: 1, color: "#ffffff", opacity: 1 },
  ];
  assert.deepEqual(gradientSampler(stops)(0.25), [0, 1, 0, 1]);
  assert.deepEqual(run(sample, { gradientMap: { stops, amount: 0 } }), sample);
});
test("Adjustment order is deterministic: Mixer precedes luminance threshold", () => {
  assert.deepEqual(
    run([255, 0, 0, 255], {
      mixer: { red: [0, 0, 0, 0], green: [100, 0, 0, 0], blue: [0, 0, 0, 0] },
      threshold: 128,
    }),
    [255, 255, 255, 255],
  );
});
for (const value of [
  null,
  [],
  { vibrance: NaN },
  { posterize: 2.1 },
  { threshold: 256 },
  { balance: {} },
  { mixer: { red: [1], green: [], blue: [] } },
  { shadowsHighlights: { shadows: 1, highlights: 1, width: 0 } },
  { gradientMap: { stops: [], amount: 1 } },
  {
    gradientMap: {
      stops: [
        { position: 0, color: "red", opacity: 1 },
        { position: 1, color: "#ffffff", opacity: 1 },
      ],
      amount: 1,
    },
  },
  {
    gradientMap: {
      stops: [
        { position: 0, color: "#000000", opacity: 1 },
        { position: 0, color: "#ffffff", opacity: 1 },
      ],
      amount: 1,
    },
  },
  { unknown: 1 },
])
  test(`native validation refuses malformed color ${JSON.stringify(value)}`, () =>
    assert.throws(() => validateColor(value as ColorAdjustments)));
test("color metadata, captured selection, source bytes and editable text survive history and native reopen", async () => {
  const doc = fromPanel({ id: "p", name: "colors", width: 32, height: 24 }),
    t = layer("text", 32, 24);
  t.color = {
    vibrance: 45,
    posterize: 5,
    gradientMap: { stops: GRADIENT_PRESETS.Sepia!, amount: 0.4 },
  };
  t.colorSelection = {
    regions: [
      {
        kind: "rectangle",
        points: [
          { x: 2, y: 3 },
          { x: 20, y: 18 },
        ],
        operation: "add",
      },
    ],
    inverted: false,
    feather: 2,
  };
  const next = { ...doc, layers: [...doc.layers, t] },
    h = record(createHistory(doc), next);
  assert.deepEqual(undo(h).present, doc);
  assert.deepEqual(redo(undo(h)).present, next);
  const session: ProSession = {
    document: next,
    assets: { source: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) },
    revision: 0,
    acceptedBlobId: "b",
    updatedAt: 0,
  };
  const reopened = await readNative(await nativeFile(session), "p2", "b2");
  validateDocument(reopened.document);
  assert.deepEqual(reopened.document.layers[1], t);
  assert.deepEqual([...new Uint8Array(await reopened.assets.source!.arrayBuffer())], [1, 2, 3]);
  assert.throws(() => vectorSvg(next), /adjustments/);
});
