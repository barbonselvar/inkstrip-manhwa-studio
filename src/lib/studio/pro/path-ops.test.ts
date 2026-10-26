import test from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, contours, type Anchor, type Layer, type Point } from "./model.ts";
import { anchorCurve, cubicPoint } from "./bezier.ts";
import { affine, applyMatrix } from "./transform.ts";
import { joinPaths, simplifyPath, smoothPath, splitPathAt } from "./path-ops.ts";
import { defaultSmartOperation } from "./smart-filters.ts";

const doc = () => fromPanel({ id: "p", name: "p", width: 200, height: 200 });
function path(anchors: Anchor[], closed: boolean, x = 0, y = 0): Layer {
  const l = layer("shape", 100, 100);
  Object.assign(l, { shape: "path", anchors, closed, fill: "transparent", stroke: "#000000" });
  l.transform = { ...l.transform, x, y };
  return l;
}
const pts = (...xy: [number, number][]): Anchor[] => xy.map(([x, y]) => ({ x, y }));
/** World-space samples along every segment of every contour. */
function trace(l: Layer, per = 16): Point[] {
  const m = affine(l.transform),
    out: Point[] = [];
  for (const c of contours(l)) {
    const n = c.anchors.length;
    for (let i = 0; i < (c.closed ? n : n - 1); i++) {
      const curve = anchorCurve(c.anchors[i]!, c.anchors[(i + 1) % n]!);
      for (let k = 0; k <= per; k++) out.push(applyMatrix(m, cubicPoint(curve, k / per)));
    }
  }
  return out;
}
const distanceTo = (p: Point, set: Point[]) =>
  Math.min(...set.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));

test("split a closed path opens it at the anchor without moving geometry", () => {
  const d = doc(),
    square = path(pts([0, 0], [50, 0], [50, 50], [0, 50]), true, 10, 10);
  d.layers.push(square);
  const { document, ids } = splitPathAt(d, square.id, 2);
  assert.deepEqual(ids, [square.id]);
  const out = document.layers.find((l) => l.id === square.id)!;
  assert.equal(out.closed, false);
  assert.equal(out.anchors.length, 5);
  assert.deepEqual([out.anchors[0]!.x, out.anchors[0]!.y], [50, 50]);
  assert.deepEqual([out.anchors.at(-1)!.x, out.anchors.at(-1)!.y], [50, 50]);
  const before = trace(square);
  for (const p of trace(out)) assert.ok(distanceTo(p, before) < 1e-6);
});

test("split an open path into two layers that cover the same curve", () => {
  const d = doc(),
    wave = path(
      [
        { x: 0, y: 0, outgoing: { x: 10, y: -20 } },
        { x: 40, y: 0, incoming: { x: 30, y: 20 }, outgoing: { x: 50, y: -20 }, mode: "smooth" },
        { x: 80, y: 0, incoming: { x: 70, y: 20 } },
      ],
      false,
    );
  d.layers.push(wave);
  const { document, ids } = splitPathAt(d, wave.id, 1);
  assert.equal(ids.length, 2);
  const [a, b] = ids.map((id) => document.layers.find((l) => l.id === id)!);
  assert.equal(a!.anchors.length, 2);
  assert.equal(b!.anchors.length, 2);
  assert.equal(a!.anchors[1]!.outgoing, undefined);
  assert.equal(b!.anchors[0]!.incoming, undefined);
  const original = trace(wave);
  for (const p of [...trace(a!), ...trace(b!)]) assert.ok(distanceTo(p, original) < 1e-6);
  assert.ok(document.layers.indexOf(b!) === document.layers.indexOf(a!) + 1);
  assert.throws(() => splitPathAt(d, wave.id, 0), /interior anchor/);
});

test("join merges coincident endpoints across transforms and bridges gaps", () => {
  const d = doc(),
    left = path(pts([0, 0], [20, 0]), false, 10, 10),
    // World (30,10)→(50,10); listed backwards to force the reversal.
    right = path(pts([40, 0], [20, 0]), false, 10, 10),
    far = path(pts([0, 0], [10, 0]), false, 100, 100);
  d.layers.push(left, right, far);
  const merged = joinPaths(d, left.id, right.id).document,
    joined = merged.layers.find((l) => l.id === left.id)!;
  assert.equal(
    merged.layers.some((l) => l.id === right.id),
    false,
  );
  assert.deepEqual(
    joined.anchors.map((a) => [a.x, a.y]),
    [
      [0, 0],
      [20, 0],
      [40, 0],
    ],
  );
  const bridged = joinPaths(merged, left.id, far.id).document.layers.find((l) => l.id === left.id)!;
  assert.equal(bridged.anchors.length, 5);
  // The far path keeps its world position inside the first layer's local space.
  const world = trace(bridged);
  assert.ok(distanceTo({ x: 110, y: 100 }, world) < 1e-6);
  assert.throws(() => joinPaths(d, left.id, left.id), /two different/);
  const closed = path(pts([0, 0], [10, 0], [10, 10]), true);
  d.layers.push(closed);
  assert.throws(() => joinPaths(d, left.id, closed.id), /open paths/);
});

test("join cannot discard an R8 Smart Filter stack from either path", () => {
  for (const filtered of [0, 1]) {
    const d = { ...doc(), version: 3 as const, source: undefined },
      paths = [path(pts([0, 0], [20, 0]), false), path(pts([20, 0], [40, 0]), false)];
    paths[filtered]!.smartFilters = [
      { id: "grain", enabled: true, operation: defaultSmartOperation("grain") },
    ];
    d.layers.push(...paths);
    const before = structuredClone(d);
    assert.throws(() => joinPaths(d, paths[0]!.id, paths[1]!.id), /Remove Smart Filters/);
    assert.deepEqual(d, before);
  }
});

test("smooth adds collinear handles; endpoints of open paths get one handle", () => {
  const d = doc(),
    zig = path(pts([0, 0], [30, 30], [60, 0]), false);
  d.layers.push(zig);
  const out = smoothPath(d, zig.id).layers.find((l) => l.id === zig.id)!,
    middle = out.anchors[1]!;
  assert.equal(middle.mode, "smooth");
  const a = { x: middle.incoming!.x - middle.x, y: middle.incoming!.y - middle.y },
    b = { x: middle.outgoing!.x - middle.x, y: middle.outgoing!.y - middle.y };
  assert.ok(Math.abs(a.x * b.y - a.y * b.x) < 1e-9); // collinear
  assert.ok(a.x * b.x + a.y * b.y < 0); // opposite sides
  assert.ok(out.anchors[0]!.outgoing && !out.anchors[0]!.incoming);
  assert.ok(out.anchors[2]!.incoming && !out.anchors[2]!.outgoing);
  const only = smoothPath(d, zig.id, 0, [0]).layers.find((l) => l.id === zig.id)!;
  assert.equal(only.anchors[1]!.incoming, undefined);
});

test("simplify removes redundant anchors within tolerance and keeps polygons straight", () => {
  const d = doc(),
    line = path(pts([0, 0], [10, 0], [20, 0], [30, 0], [40, 0]), false);
  d.layers.push(line);
  const flat = simplifyPath(d, line.id, 0.1);
  assert.equal(flat.removed, 3);
  const straight = flat.document.layers.find((l) => l.id === line.id)!;
  assert.deepEqual(
    straight.anchors.map((a) => [a.x, a.y, !!a.incoming, !!a.outgoing]),
    [
      [0, 0, false, false],
      [40, 0, false, false],
    ],
  );
  // A quarter circle drawn with 13 corner anchors becomes a few curves within 0.5 px.
  const arc = path(
    Array.from({ length: 13 }, (_, i) => {
      const t = (i / 12) * (Math.PI / 2);
      return { x: 100 * Math.cos(t), y: 100 * Math.sin(t) };
    }),
    false,
  );
  d.layers.push(arc);
  const simplified = simplifyPath(d, arc.id, 0.5),
    out = simplified.document.layers.find((l) => l.id === arc.id)!;
  assert.ok(out.anchors.length < 13 && out.anchors.length >= 2, `${out.anchors.length}`);
  const original = trace(arc, 32);
  for (const p of trace(out, 32)) assert.ok(distanceTo(p, original) <= 0.75);
  // A square stays a square.
  const square = path(pts([0, 0], [50, 0], [50, 50], [0, 50]), true);
  d.layers.push(square);
  assert.equal(simplifyPath(d, square.id, 1).removed, 0);
  assert.throws(() => simplifyPath(d, square.id, 0), /tolerance/);
});

test("locked and non-native paths are refused", () => {
  const d = doc(),
    locked = { ...path(pts([0, 0], [10, 0], [20, 0]), false), locked: true },
    rect = layer("shape", 10, 10);
  d.layers.push(locked, rect);
  assert.throws(() => smoothPath(d, locked.id), /Unlock/);
  assert.throws(() => smoothPath(d, rect.id), /native Bézier path/);
});
