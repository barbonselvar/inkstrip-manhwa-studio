import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cubicPoint,
  cubicDerivative,
  splitCubic,
  cubicLength,
  parameterAtLength,
  anchorCurve,
  splitAnchorSegment,
  type Cubic,
} from "./bezier.ts";
import { fromPanel, layer, pathData, type ProSession } from "./model.ts";
import { nativeFile, readNative } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
const near = (a: number, b: number, e = 1e-8) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const point = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  near(a.x, b.x);
  near(a.y, b.y);
};
const curve: Cubic = [
  { x: 0, y: 0 },
  { x: 0, y: 80 },
  { x: 100, y: -40 },
  { x: 100, y: 20 },
];
test("cubic evaluation has exact endpoints and analytic endpoint derivatives", () => {
  point(cubicPoint(curve, 0), curve[0]);
  point(cubicPoint(curve, 1), curve[3]);
  point(cubicDerivative(curve, 0), { x: 0, y: 240 });
  point(cubicDerivative(curve, 1), { x: 0, y: 180 });
});
for (const t of [0.1, 0.5, 0.87])
  test(`De Casteljau subdivision preserves the whole original curve at split ${t}`, () => {
    const [a, b] = splitCubic(curve, t);
    point(a[3], b[0]);
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      point(cubicPoint(curve, u), u <= t ? cubicPoint(a, u / t) : cubicPoint(b, (u - t) / (1 - t)));
    }
  });
test("straight cubic length is exact even with nonuniform parameter speed", () => {
  const c: Cubic = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 0 },
  ];
  assert.deepEqual(cubicLength(c), { length: 100, errorBound: 0 });
  const t = parameterAtLength(c, 25, 1e-6);
  near(cubicPoint(c, t).x, 25, 1e-6);
  assert.ok(Math.abs(t - 0.25) > 0.05);
});
test("quarter-circle cubic length matches an independent high-precision reference within its declared error", () => {
  const k = (4 * (Math.sqrt(2) - 1)) / 3,
    c: Cubic = [
      { x: 1, y: 0 },
      { x: 1, y: k },
      { x: k, y: 1 },
      { x: 0, y: 1 },
    ],
    result = cubicLength(c, 1e-5);
  near(result.length, 1.5710166980738558, result.errorBound + 1e-12);
  assert.ok(result.errorBound <= 1e-5);
});
test("collinear backtracking cusp retains traveled distance instead of returning endpoint distance", () => {
  const c: Cubic = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: -100, y: 0 },
      { x: 0, y: 0 },
    ],
    result = cubicLength(c, 1e-5);
  near(result.length, 115.4700538379251, 1e-5);
});
test("arc distance inversion is monotone, clamps endpoints and handles degenerate paths", () => {
  const length = cubicLength(curve, 1e-4).length;
  let previous = -1;
  for (const ratio of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const t = parameterAtLength(curve, length * ratio, 1e-4);
    assert.ok(t >= previous);
    previous = t;
    near(cubicLength(splitCubic(curve, t)[0], 1e-5).length, length * ratio, 1e-4);
  }
  assert.equal(parameterAtLength(curve, -1), 0);
  assert.equal(parameterAtLength(curve, length + 1), 1);
  assert.equal(
    parameterAtLength(
      [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
      3,
    ),
    0,
  );
});
function fixture(closed = false) {
  const d = fromPanel({ id: "p", name: "path", width: 128, height: 96 }),
    p = layer("shape", 128, 96, "path");
  p.shape = "path";
  p.closed = closed;
  p.anchors = [
    { x: 0, y: 0, outgoing: { x: 0, y: 80 } },
    { x: 100, y: 20, incoming: { x: 100, y: -40 } },
  ];
  d.layers.push(p);
  return { d, p };
}
for (const closed of [false, true])
  test(`native ${closed ? "closed closing" : "open"} segment split preserves geometry, endpoints and relationships`, () => {
    const { d, p } = fixture(closed),
      index = closed ? 1 : 0,
      c = anchorCurve(p.anchors[index]!, p.anchors[(index + 1) % 2]!),
      copy = structuredClone(d),
      next = splitAnchorSegment(d, p.id, index, 0.3),
      anchors = next.layers[1]!.anchors;
    const a = anchorCurve(anchors[index]!, anchors[index + 1]!),
      b = anchorCurve(anchors[index + 1]!, anchors[(index + 2) % anchors.length]!);
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      point(cubicPoint(c, t), t <= 0.3 ? cubicPoint(a, t / 0.3) : cubicPoint(b, (t - 0.3) / 0.7));
    }
    assert.equal(anchors.length, 3);
    assert.deepEqual(d, copy);
    assert.deepEqual(next.source, d.source);
    assert.equal(next.layers[1]!.closed, closed);
    assert.equal((pathData(next.layers[1]!).match(/ C/g) || []).length, closed ? 3 : 2);
  });
test("native subdivision is one undoable transaction and persists editable handles/source bytes", async () => {
  const { d, p } = fixture(),
    next = splitAnchorSegment(d, p.id, 0, 0.4),
    h = record(createHistory(d), next);
  assert.equal(h.past.length, 1);
  assert.deepEqual(undo(h).present, d);
  assert.deepEqual(redo(undo(h)).present, next);
  const s: ProSession = {
      document: next,
      assets: { source: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) },
      revision: 0,
      acceptedBlobId: "m",
      updatedAt: 0,
    },
    reopened = await readNative(await nativeFile(s), "p", "m");
  assert.deepEqual(reopened.document, next);
  assert.deepEqual([...new Uint8Array(await reopened.assets.source!.arrayBuffer())], [1, 2, 3]);
});
test("invalid parameters, malformed coordinates and unrealistic precision requests fail explicitly", () => {
  for (const t of [-0.1, 1.1, NaN]) assert.throws(() => splitCubic(curve, t));
  assert.throws(() => cubicPoint([{ x: NaN, y: 0 }, ...curve.slice(1)] as Cubic, 0.5));
  for (const tolerance of [0, -1, NaN]) assert.throws(() => cubicLength(curve, tolerance));
  assert.throws(() => parameterAtLength(curve, Infinity));
  assert.throws(() => cubicLength(curve, Number.MIN_VALUE), /budget/);
});
test("locked/native-limit/imported-path guards leave the document unchanged", () => {
  const { d, p } = fixture(),
    before = structuredClone(d);
  for (const index of [-1, 1, 0.5]) assert.throws(() => splitAnchorSegment(d, p.id, index, 0.5));
  for (const t of [0, 1, NaN]) assert.throws(() => splitAnchorSegment(d, p.id, 0, t));
  p.locked = true;
  assert.throws(() => splitAnchorSegment(d, p.id, 0, 0.5), /Unlock/);
  p.locked = false;
  p.pathData = "M0 0L10 10";
  assert.throws(() => splitAnchorSegment(d, p.id, 0, 0.5), /conversion/);
  p.pathData = undefined;
  const limited = structuredClone(d);
  limited.layers[1]!.anchors = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: 0 }));
  assert.throws(() => splitAnchorSegment(limited, p.id, 0, 0.5), /1000-anchor/);
  const g = layer("group", 128, 96, "g");
  g.locked = true;
  p.parentId = g.id;
  d.layers.push(g);
  assert.throws(() => splitAnchorSegment(d, p.id, 0, 0.5), /Unlock/);
  d.layers.pop();
  p.parentId = undefined;
  assert.deepEqual(JSON.parse(JSON.stringify(d)), JSON.parse(JSON.stringify(before)));
});
