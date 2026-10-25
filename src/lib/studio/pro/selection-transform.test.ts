import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, MAX_LAYERS, type ProDocument } from "./model.ts";
import {
  splitSelectedPixels,
  stageSelectionDocument,
  selectionTransformTarget,
} from "./selection-transform.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { nativeFile, readNative } from "./files.ts";
const doc = () => {
  const d = fromPanel({ id: "p", name: "Pixel staging", width: 128, height: 96 });
  d.selection = {
    regions: [
      {
        kind: "rectangle" as const,
        points: [
          { x: 32, y: 16 },
          { x: 64, y: 48 },
        ],
        operation: "add" as const,
      },
    ],
    feather: 0,
    inverted: false,
  };
  return d;
};
const stage = (d: ProDocument) =>
  stageSelectionDocument(d, d.layers[0]!.id, "rest", "lift", {
    group: "group",
    remaining: "remaining",
    floating: "floating",
  });
test("all 65,536 alpha/selection combinations reassemble with at most one alpha level error", () => {
  const rgba = new Uint8ClampedArray(65536 * 4),
    coverage = new Uint8ClampedArray(65536);
  for (let a = 0; a < 256; a++)
    for (let s = 0; s < 256; s++) {
      const i = a * 256 + s;
      rgba.set([41, 109, 203, a], i * 4);
      coverage[i] = s;
    }
  const { remaining, lifted } = splitSelectedPixels(rgba, coverage);
  for (let i = 0; i < coverage.length; i++) {
    const a = rgba[i * 4 + 3]!,
      r = remaining[i * 4 + 3]!,
      l = lifted[i * 4 + 3]!;
    assert.ok(Math.abs(l + r * (1 - l / 255) - a) <= 1);
    assert.equal(l, Math.round((a * coverage[i]!) / 255));
    if (!coverage[i])
      assert.deepEqual(remaining.slice(i * 4, i * 4 + 4), rgba.slice(i * 4, i * 4 + 4));
    if (coverage[i] === 255 && a) assert.equal(r, 0);
  }
});
test("empty selected content and invalid coverage reject", () => {
  assert.throws(() => splitSelectedPixels(new Uint8ClampedArray(8), new Uint8ClampedArray(1)));
  assert.throws(() => splitSelectedPixels(new Uint8ClampedArray(4), new Uint8ClampedArray([255])));
});
test("selected-pixel stage retains editable original and exact stack/opacity/blend scope", () => {
  const d = doc(),
    original = d.layers[0]!;
  original.name = "a".repeat(100);
  original.opacity = 0.6;
  original.blend = "multiply";
  const n = stage(d);
  assert.equal(d.layers.length, 1);
  assert.equal(n.document.layers.length, 4);
  assert.ok(n.document.layers[0]!.name.length <= 100);
  assert.equal(n.document.layers[0]!.blend, "multiply");
  assert.equal(n.document.layers[0]!.opacity, 0.6);
  assert.deepEqual(n.document.layers[1], { ...original, visible: false, parentId: "group" });
  assert.equal(n.document.layers[2]!.assetId, "rest");
  assert.equal(n.document.layers[3]!.assetId, "lift");
  assert.equal(n.layerId, "floating");
});
test("staging refuses locks, hidden targets, selection absence, effects, links and clipping", () => {
  for (const modify of [
    (d: ProDocument) => {
      d.layers[0]!.locked = true;
    },
    (d: ProDocument) => {
      d.layers[0]!.visible = false;
    },
    (d: ProDocument) => {
      d.selection = undefined;
    },
    (d: ProDocument) => {
      d.layers[0]!.linkId = "linked";
    },
    (d: ProDocument) => {
      d.layers.push({ ...layer("paint", 128, 96), clipped: true });
    },
  ]) {
    const d = doc();
    modify(d);
    assert.throws(() => stage(d));
  }
});
test("staging respects canvas/device, native layer and group nesting limits", () => {
  const d = doc();
  assert.throws(() => selectionTransformTarget(d, d.layers[0]!.id, 100));
  d.width = 3000;
  d.height = 2000;
  assert.throws(() => stage(d));
  const many = doc();
  while (many.layers.length < MAX_LAYERS) many.layers.push(layer("paint", 128, 96));
  assert.throws(() => stage(many));
  const deep = doc();
  deep.layers = [
    layer("group", 128, 96, "g1"),
    { ...layer("group", 128, 96, "g2"), parentId: "g1" },
    { ...layer("group", 128, 96, "g3"), parentId: "g2" },
    { ...deep.layers[0]!, parentId: "g3" },
  ];
  assert.throws(() =>
    stageSelectionDocument(deep, deep.layers[3]!.id, "r", "l", {
      group: "g4",
      remaining: "r",
      floating: "f",
    }),
  );
});
test("Apply is a single native-compatible undo transaction retaining all source assets", async () => {
  const d = doc(),
    n = stage(d),
    h = record(createHistory(d), n.document);
  assert.equal(h.past.length, 1);
  assert.equal(undo(h).present, d);
  assert.equal(redo(undo(h)).present, n.document);
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    s = {
      document: n.document,
      assets: { source: blob, rest: blob, lift: blob },
      revision: 0,
      acceptedBlobId: "b",
      updatedAt: 0,
    };
  const restored = await readNative(await nativeFile(s), "p", "b");
  assert.deepEqual(restored.document.layers, JSON.parse(JSON.stringify(n.document.layers)));
  assert.deepEqual(Object.keys(restored.assets).sort(), ["lift", "rest", "source"]);
});

test("quantized premultiplied residual color recombines translucent feather edges", () => {
  const rgba = new Uint8ClampedArray(256 * 256 * 4),
    coverage = new Uint8ClampedArray(256 * 256);
  for (let a = 0; a < 256; a++)
    for (let s = 0; s < 256; s++) {
      const i = a * 256 + s;
      rgba.set([41, 109, 203, a], i * 4);
      coverage[i] = s;
    }
  const { remaining, lifted } = splitSelectedPixels(rgba, coverage);
  for (let i = 0; i < coverage.length; i++)
    for (let channel = 0; channel < 3; channel++) {
      const a = rgba[i * 4 + 3]!,
        r = remaining[i * 4 + 3]!,
        l = lifted[i * 4 + 3]!,
        expected = Math.round((rgba[i * 4 + channel]! * a) / 255),
        actual =
          Math.round((lifted[i * 4 + channel]! * l) / 255) +
          Math.round((remaining[i * 4 + channel]! * r) / 255) * (1 - l / 255);
      assert.ok(Math.abs(expected - actual) <= 1.01);
    }
});

test("tight lifted frames place handles and default pivot around selected pixels", () => {
  const d = doc(),
    frame = { x: 40, y: 20, width: 16, height: 12 },
    staged = stageSelectionDocument(
      d,
      d.layers[0]!.id,
      "rest",
      "lift",
      { group: "group", remaining: "rest", floating: "floating" },
      16_777_216,
      frame,
    ),
    floating = staged.document.layers.at(-1)!;
  assert.equal(floating.width, 16);
  assert.equal(floating.height, 12);
  assert.equal(floating.transform.x, 40);
  assert.equal(floating.transform.y, 20);
  assert.throws(() =>
    stageSelectionDocument(
      d,
      d.layers[0]!.id,
      "r",
      "l",
      { group: "g", remaining: "r", floating: "l" },
      16_777_216,
      { ...frame, x: -1 },
    ),
  );
});
