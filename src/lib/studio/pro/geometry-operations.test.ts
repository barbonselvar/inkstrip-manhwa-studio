import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, TRANSFORM, type Selection } from "./model.ts";
import {
  CANVAS_ANCHORS,
  resizeCanvas,
  maskFrame,
  transformMask,
  nudgeDocument,
  shiftSelection,
  contentAngle,
} from "./geometry-operations.ts";
import { affine, applyMatrix, compose, inverse, MESH } from "./transform.ts";
import { maskWorld, maskFromSelection } from "./masks.ts";
import { DEFAULT_LAYOUT } from "./artboards.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { nativeFile, readNative } from "./files.ts";
const doc = () => fromPanel({ id: "p", name: "R5", width: 128, height: 96 });
const selected: Selection = {
  regions: [
    {
      kind: "rectangle",
      points: [
        { x: 10, y: 12 },
        { x: 40, y: 50 },
      ],
      operation: "add",
    },
  ],
  inverted: false,
  feather: 2,
};
const near = (a: number[], b: number[]) =>
  a.forEach((n, i) => assert.ok(Math.abs(n - b[i]!) < 1e-8, `${a} != ${b}`));
test("all nine anchors rebase locked source metadata without touching source references", () => {
  const d = doc();
  d.layers[0]!.locked = true;
  const offsets = [
    [0, 0],
    [10, 0],
    [20, 0],
    [0, 10],
    [10, 10],
    [20, 10],
    [0, 20],
    [10, 20],
    [20, 20],
  ];
  CANVAS_ANCHORS.forEach((a, i) => {
    const next = resizeCanvas(d, 148, 116, a);
    assert.deepEqual([next.layers[0]!.transform.x, next.layers[0]!.transform.y], offsets[i]);
    assert.equal(next.layers[0]!.assetId, d.layers[0]!.assetId);
    assert.equal(next.layers[0]!.strokes, d.layers[0]!.strokes);
    assert.equal(next.source, d.source);
  });
  assert.equal(d.layers[0]!.transform.x, 0);
});
test("canvas shrink and re-expand keeps off-canvas artwork recoverable", () => {
  const d = doc(),
    shrunk = resizeCanvas(d, 64, 32, "se"),
    restored = resizeCanvas(shrunk, 128, 96, "se");
  assert.deepEqual(restored, d);
});
test("canvas rebase translates ordinary, unlinked and group masks exactly once", () => {
  const d = doc(),
    base = d.layers[0]!,
    group = layer("group", 128, 96, "g");
  base.mask = maskFromSelection(selected, base, d);
  const unlinked = { ...base, id: "u", mask: { ...base.mask, linked: false } };
  group.mask = maskFromSelection(selected, group, d);
  d.layers = [group, { ...base, parentId: "g" }, unlinked];
  const next = resizeCanvas(d, 148, 116, "center");
  d.layers.forEach((l, i) =>
    near(maskWorld(next.layers[i]!), compose([1, 0, 0, 1, 10, 10], maskWorld(l))),
  );
});
test("crop, review regions, artboards, selections and guides follow the canvas origin", () => {
  const d = doc();
  d.crop = { x: 10, y: 20, width: 50, height: 40, rotation: 30 };
  d.selection = selected;
  d.savedSelections = [{ name: "saved", selection: selected }];
  d.artboards = [
    { id: "a", name: "a", x: 5, y: 7, width: 50, height: 40, background: "transparent" },
  ];
  d.layout = {
    ...DEFAULT_LAYOUT,
    guides: [
      { id: "x", axis: "x", position: 3, locked: true },
      { id: "y", axis: "y", position: 9, locked: false },
    ],
  };
  d.dialogue = {
    version: 1,
    presets: [],
    regions: [
      {
        id: "r",
        x: 2,
        y: 4,
        width: 20,
        height: 10,
        sourceLanguage: "en",
        targetLanguage: "en",
        original: "a",
        corrected: "a",
        replacement: "b",
        status: "detected",
      },
    ],
  };
  const n = resizeCanvas(d, 148, 116, "se");
  assert.equal(n.crop!.x, 30);
  assert.equal(n.artboards![0]!.y, 27);
  assert.equal(n.dialogue!.regions[0]!.x, 22);
  assert.deepEqual(
    n.layout!.guides.map((g) => g.position),
    [23, 29],
  );
  assert.deepEqual(n.selection!.regions[0]!.points, [
    { x: 30, y: 32 },
    { x: 60, y: 70 },
  ]);
  assert.deepEqual(n.savedSelections![0]!.selection, n.selection);
});
test("captured selection rebase composes its inverse mapping without changing coverage", () => {
  const s = {
      ...selected,
      frame: {
        width: 128,
        height: 96,
        transform: { ...TRANSFORM, x: 10, rotation: 25 },
        matrix: [1, 0, 0, 1, 3, 4] as [number, number, number, number, number, number],
      },
    },
    next = shiftSelection(s, { x: 7, y: 11 }),
    p = { x: 30, y: 40 },
    before = applyMatrix(inverse(compose(affine(s.frame.transform), s.frame.matrix)), p),
    after = applyMatrix(inverse(compose(affine(next.frame!.transform), next.frame!.matrix!)), p);
  near([after.x, after.y], [before.x + 7, before.y + 11]);
  assert.equal(next.regions, s.regions);
});
test("invalid canvas sizes and device budgets fail without mutation", () => {
  const d = doc(),
    before = JSON.stringify(d);
  for (const [w, h] of [
    [0, 10],
    [1.5, 10],
    [16385, 1],
    [5000, 5000],
    [NaN, 1],
  ])
    assert.throws(() => resizeCanvas(d, w!, h!));
  assert.throws(() => resizeCanvas(d, 1000, 1000, "center", 100));
  assert.equal(JSON.stringify(d), before);
});
test("mask-only affine transforms preserve layer/source bytes and mask linkage", () => {
  for (const linked of [true, false]) {
    const d = doc(),
      l = d.layers[0]!;
    l.transform = { ...TRANSFORM, x: 12, y: 7, rotation: 20 };
    l.mask = { ...maskFromSelection(selected, l, d), linked };
    const pose = { ...maskFrame(d, l.id).transform, x: 31, y: 22, rotation: 70, flipX: true },
      n = transformMask(d, l.id, pose);
    near(maskWorld(n.layers[0]!), affine(pose));
    assert.equal(n.layers[0]!.transform, l.transform);
    assert.equal(n.layers[0]!.mask!.selection, l.mask.selection);
    assert.equal(n.layers[0]!.mask!.linked, linked);
  }
});
test("locked, missing and nonlinear mask targets reject safely", () => {
  const d = doc(),
    l = d.layers[0]!;
  assert.throws(() => maskFrame(d, l.id));
  l.mask = maskFromSelection(selected, l, d);
  l.locked = true;
  assert.throws(() => maskFrame(d, l.id));
  l.locked = false;
  assert.throws(() =>
    transformMask(d, l.id, {
      ...TRANSFORM,
      deform: { kind: "warp", width: 128, height: 96, points: MESH },
    }),
  );
  l.transform.deform = { kind: "warp", width: 128, height: 96, points: MESH };
  assert.throws(() => maskFrame(d, l.id));
});
test("layer nudges respect links and locks, mask nudges target only its placement", () => {
  const d = doc(),
    l = d.layers[0]!,
    other = layer("paint", 128, 96, "other");
  l.linkId = other.linkId = "link";
  l.mask = maskFromSelection(selected, l, d);
  d.layers.push(other);
  const n = nudgeDocument(d, [l.id], { x: 2, y: -3 });
  assert.deepEqual(
    n.layers.map((l) => [l.transform.x, l.transform.y]),
    [
      [2, -3],
      [2, -3],
    ],
  );
  const m = nudgeDocument(d, [l.id], { x: 2, y: -3 }, true);
  assert.equal(m.layers[1], other);
  assert.equal(m.layers[0]!.transform, l.transform);
  near(maskWorld(m.layers[0]!), [1, 0, 0, 1, 2, -3]);
  other.locked = true;
  assert.throws(() => nudgeDocument(d, [l.id], { x: 1, y: 0 }));
});
test("canvas and mask transactions undo/redo and native roundtrip retain immutable sources", async () => {
  const d = doc();
  d.layers[0]!.mask = maskFromSelection(selected, d.layers[0]!, d);
  const n = resizeCanvas(d, 148, 116, "center"),
    history = record(createHistory(d), n);
  assert.equal(undo(history).present, d);
  assert.equal(redo(undo(history)).present, n);
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    s = { document: n, assets: { source: blob }, revision: 0, acceptedBlobId: "b", updatedAt: 0 };
  const restored = await readNative(await nativeFile(s), "p", "b");
  assert.deepEqual(restored.document.layers, JSON.parse(JSON.stringify(n.layers)));
  assert.deepEqual(
    new Uint8Array(await restored.assets.source!.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
});
test("content quarter turns normalize independently of view geometry", () => {
  assert.equal(contentAngle(350 + 90), 80);
  assert.equal(contentAngle(-350 - 90), -80);
});

test("odd center resizing preserves exact half-pixel geometry and reverses without drift", () => {
  const d = doc(),
    n = resizeCanvas(d, 127, 95, "center");
  assert.equal(n.layers[0]!.transform.x, -0.5);
  assert.equal(n.layers[0]!.transform.y, -0.5);
  assert.deepEqual(resizeCanvas(n, 128, 96, "center"), d);
});
