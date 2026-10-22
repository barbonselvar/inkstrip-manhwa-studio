import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fromPanel,
  layer,
  contourAt,
  pathData,
  validateDocument,
  worldPoint,
  type ProSession,
} from "./model.ts";
import { createCompound, releaseCompound, convertPath, fitVectorFrame } from "./compound.ts";
import { transformDocument } from "./transform-transaction.ts";
import { QUAD, pivotWorld } from "./transform.ts";
import { editAnchor, reverseAnchors } from "./anchor-edit.ts";
import { anchorCurve, cubicPoint, splitAnchorSegment } from "./bezier.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("fitting an extended vector frame retains world geometry/pivot and prevents silent perspective cropping", () => {
  const d = fromPanel({ id: "p", name: "frame", width: 128, height: 96 }),
    l = layer("shape", 20, 20);
  l.shape = "path";
  l.closed = false;
  l.vectorOverflow = true;
  l.anchors = [
    { x: -5, y: 5, outgoing: { x: 20, y: -10 } },
    { x: 70, y: 60, incoming: { x: 40, y: 80 } },
  ];
  l.transform = {
    x: 20,
    y: 10,
    scaleX: 1.1,
    scaleY: 0.8,
    rotation: 21,
    shearX: 9,
    pivot: { x: 3, y: 4 },
  };
  d.layers.push(l);
  assert.throws(
    () =>
      transformDocument(d, l.id, {
        ...l.transform,
        deform: { kind: "perspective", width: 20, height: 20, points: QUAD },
      }),
    /Fit vector frame/,
  );
  const next = fitVectorFrame(d, l.id),
    n = next.layers[1]!,
    oldPivot = pivotWorld(l.transform),
    newPivot = pivotWorld(n.transform);
  near(oldPivot.x, newPivot.x);
  near(oldPivot.y, newPivot.y);
  for (let i = 0; i <= 100; i++) {
    const p = worldPoint(cubicPoint(anchorCurve(l.anchors[0]!, l.anchors[1]!), i / 100), l),
      q = worldPoint(cubicPoint(anchorCurve(n.anchors[0]!, n.anchors[1]!), i / 100), n);
    near(p.x, q.x);
    near(p.y, q.y);
  }
  assert.ok(n.width > 20 && n.height > 20);
  assert.deepEqual(next.source, d.source);
  assert.doesNotThrow(() =>
    transformDocument(next, n.id, {
      ...n.transform,
      deform: { kind: "perspective", width: n.width, height: n.height, points: QUAD },
    }),
  );
  n.mask = { enabled: true, selection: { regions: [], inverted: false, feather: 0 }, strokes: [] };
  assert.throws(() => fitVectorFrame(next, n.id), /Remove masks/);
});
function fixture() {
  const d = fromPanel({ id: "p", name: "compounds", width: 128, height: 96 }),
    a = layer("shape", 100, 80, "a"),
    b = layer("shape", 30, 20, "b");
  a.name = "outer";
  b.name = "inner";
  a.fill = "#ff0000";
  b.fill = "#0000ff";
  a.strokeWidth = b.strokeWidth = 0;
  b.transform.x = 30;
  b.transform.y = 30;
  d.layers.push(a, b);
  return { d, a, b };
}
test("compound creation retains exact transformed cubics and adopts the bottom appearance", () => {
  const { d, a, b } = fixture();
  a.shape = "path";
  a.anchors = [
    { x: 0, y: 30, outgoing: { x: 10, y: 0 } },
    { x: 80, y: 40, incoming: { x: 40, y: 80 } },
  ];
  b.shape = "path";
  b.anchors = [
    { x: 0, y: 10, outgoing: { x: 15, y: 0 } },
    { x: 30, y: 20, incoming: { x: 10, y: 10 } },
  ];
  a.transform = { x: 5, y: 4, scaleX: 1.1, scaleY: 0.8, rotation: 12, shearX: 8 };
  b.transform = { x: 30, y: 35, scaleX: 0.6, scaleY: 0.9, rotation: -7, flipX: true };
  const before = structuredClone(d),
    result = createCompound(d, [b.id, a.id]),
    l = result.document.layers.at(-1)!;
  assert.deepEqual(d, before);
  assert.equal(l.fill, a.fill);
  assert.equal(l.fillRule, "evenodd");
  assert.equal(l.subpaths!.length, 1);
  for (const [i, old] of [a, b].entries())
    for (let k = 0; k <= 100; k++) {
      const p = worldPoint(cubicPoint(anchorCurve(old.anchors[0]!, old.anchors[1]!), k / 100), old),
        c = contourAt(l, i),
        q = worldPoint(cubicPoint(anchorCurve(c.anchors[0]!, c.anchors[1]!), k / 100), l);
      near(p.x, q.x);
      near(p.y, q.y);
    }
  assert.equal((pathData(l).match(/M/g) ?? []).length, 2);
  assert.equal(result.document.layers.length, 2);
});
test("release retains every closed/open contour and its world geometry without flattening", () => {
  const { d, a, b } = fixture(),
    combined = createCompound(d, [a.id, b.id]).document,
    l = combined.layers.at(-1)!;
  l.subpaths![0]!.closed = false;
  const released = releaseCompound(combined, l.id),
    parts = released.document.layers.slice(1);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]!.closed, true);
  assert.equal(parts[1]!.closed, false);
  assert.equal(new Set(released.ids).size, 2);
  for (const [i, p] of parts.entries()) {
    assert.equal(p.subpaths, undefined);
    assert.deepEqual(p.anchors, contourAt(l, i).anchors);
    assert.deepEqual(p.transform, l.transform);
  }
});
test("additional contour anchor editing, reverse and closing insertion never overwrite other contours", () => {
  const { d, a, b } = fixture(),
    combined = createCompound(d, [a.id, b.id]).document,
    l = combined.layers.at(-1)!,
    first = structuredClone(l.anchors),
    original = structuredClone(l.subpaths![0]);
  const next = editAnchor(combined, l.id, 0, { kind: "move", point: { x: 35, y: 35 } }, 1);
  assert.deepEqual(next.layers.at(-1)!.anchors, first);
  assert.deepEqual(l.subpaths![0], original);
  const reversed = reverseAnchors(combined, l.id, 1);
  assert.deepEqual(reversed.layers.at(-1)!.anchors, first);
  const c = contourAt(l, 1),
    index = c.anchors.length - 1,
    oldCurve = anchorCurve(c.anchors[index]!, c.anchors[0]!),
    split = splitAnchorSegment(combined, l.id, index, 0.4, 1).layers.at(-1)!,
    s = contourAt(split, 1),
    left = anchorCurve(s.anchors[index]!, s.anchors[index + 1]!),
    right = anchorCurve(s.anchors[index + 1]!, s.anchors[0]!);
  assert.deepEqual(split.anchors, first);
  for (let k = 0; k <= 100; k++) {
    const t = k / 100,
      p = cubicPoint(oldCurve, t),
      q = t <= 0.4 ? cubicPoint(left, t / 0.4) : cubicPoint(right, (t - 0.4) / 0.6);
    near(p.x, q.x);
    near(p.y, q.y);
  }
});
test("legacy SVG path conversion creates editable native contours while retaining mask/style/transform/source", () => {
  const { d, a } = fixture();
  a.shape = "path";
  a.pathData = "M0 0h80v60h-80zM20 20q20 -10 40 0v20h-40z";
  a.fillRule = "evenodd";
  a.lineCap = "round";
  a.dash = [2, 3];
  a.mask = { enabled: true, selection: { regions: [], inverted: false, feather: 0 }, strokes: [] };
  const next = convertPath(d, a.id),
    p = next.layers[1]!;
  assert.equal(p.pathData, undefined);
  assert.equal(p.subpaths!.length, 1);
  assert.deepEqual(p.mask, a.mask);
  assert.deepEqual(p.transform, a.transform);
  assert.equal(p.lineCap, "round");
  assert.deepEqual(p.dash, [2, 3]);
  assert.deepEqual(next.source, d.source);
  assert.match(a.pathData, /q/);
  assert.match(pathData(p), / Q/);
});
test("native history roundtrip retains compound modes, fill rules, stroke metadata and immutable source bytes", async () => {
  const { d, a, b } = fixture(),
    next = createCompound(d, [a.id, b.id]).document,
    l = next.layers.at(-1)!;
  l.fillRule = "nonzero";
  l.lineCap = "square";
  l.lineJoin = "bevel";
  l.miterLimit = 5;
  l.dash = [4, 2, 1];
  l.dashOffset = -3;
  l.fillOpacity = 0.7;
  l.strokeOpacity = 0.4;
  l.anchors[0]!.mode = "corner";
  const h = record(createHistory(d), next);
  assert.deepEqual(undo(h).present, d);
  assert.deepEqual(redo(undo(h)).present, next);
  const session: ProSession = {
      document: next,
      assets: { source: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) },
      revision: 0,
      acceptedBlobId: "a",
      updatedAt: 0,
    },
    read = await readNative(await nativeFile(session), "p", "a");
  assert.deepEqual(JSON.parse(JSON.stringify(read.document)), JSON.parse(JSON.stringify(next)));
  assert.deepEqual([...new Uint8Array(await read.assets.source!.arrayBuffer())], [1, 2, 3]);
  const svg = vectorSvg(next);
  assert.match(svg, /fill-rule="nonzero"/);
  assert.match(svg, /stroke-dasharray="4 2 1"/);
  assert.match(svg, /fill-opacity="0.7"/);
  assert.equal((svg.match(/ M/g) ?? []).length, 1);
});
test("compound operations respect group hierarchy, locks, neutral compositing and clipping relationships", () => {
  const { d, a, b } = fixture(),
    g = layer("group", 128, 96, "g");
  a.parentId = b.parentId = g.id;
  d.layers.push(g);
  assert.equal(
    createCompound(d, [a.id, b.id]).document.layers.find((l) => l.id === a.id)!.parentId,
    g.id,
  );
  g.locked = true;
  assert.throws(() => createCompound(d, [a.id, b.id]), /unlocked/);
  g.locked = false;
  for (const change of [
    { clipped: true },
    { opacity: 0.5 },
    { linkId: "link" },
    { blend: "multiply" as const },
    {
      mask: { enabled: true, selection: { regions: [], inverted: false, feather: 0 }, strokes: [] },
    },
  ]) {
    const next = structuredClone(d);
    Object.assign(next.layers[1]!, change);
    assert.throws(() => createCompound(next, [a.id, b.id]));
  }
  const clip = layer("shape", 128, 96, "clip");
  clip.parentId = g.id;
  clip.clipped = true;
  d.layers.splice(3, 0, clip);
  assert.throws(() => createCompound(d, [a.id, b.id]), /clipping/);
});
test("nonconsecutive siblings and cross-group selections are rejected rather than changing unrelated order", () => {
  const { d, a, b } = fixture(),
    other = layer("shape", 10, 10, "other");
  d.layers.splice(2, 0, other);
  assert.throws(() => createCompound(d, [a.id, b.id]), /consecutive/);
  assert.throws(() => createCompound(d, [a.id, "missing"]), /sibling/);
  const g = layer("group", 128, 96, "group");
  b.parentId = g.id;
  d.layers.push(g);
  assert.throws(() => createCompound(d, [a.id, b.id]), /sibling/);
});
test("contour/anchor/style validation budgets reject malformed native input atomically", () => {
  const { d, a } = fixture();
  a.shape = "path";
  for (const invalid of [
    { subpaths: [null] },
    { subpaths: Array(128).fill({ anchors: [], closed: false }) },
    { fillRule: "random" },
    { dash: [-1] },
    { lineJoin: "roundish" },
    { fillOpacity: 2 },
    { subpaths: [{ anchors: [{ x: Infinity, y: 0 }], closed: false }] },
  ]) {
    const candidate = structuredClone(d);
    Object.assign(candidate.layers[1]!, invalid);
    assert.throws(() => validateDocument(candidate));
  }
  a.anchors = Array.from({ length: 500 }, (_, i) => ({ x: i, y: 0 }));
  a.subpaths = [
    { anchors: Array.from({ length: 501 }, (_, i) => ({ x: i, y: 1 })), closed: false },
  ];
  assert.throws(() => validateDocument(d), /1000/);
  assert.throws(() => contourAt(a, -1));
  assert.throws(() => contourAt(a, 0.5));
});
