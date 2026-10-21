import { test } from "node:test";
import assert from "node:assert/strict";
import { editAnchor, editedAnchor, reverseAnchors } from "./anchor-edit.ts";
import { anchorCurve, cubicPoint, splitAnchorSegment } from "./bezier.ts";
import {
  fromPanel,
  layer,
  validateDocument,
  worldPoint,
  localPoint,
  type Anchor,
  type ProSession,
} from "./model.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
const a: Anchor = { x: 40, y: 40, incoming: { x: 30, y: 40 }, outgoing: { x: 60, y: 40 } };
const near = (x: number, y: number) => assert.ok(Math.abs(x - y) < 1e-8, `${x} != ${y}`);
function fixture(closed = false) {
  const d = fromPanel({ id: "p", name: "anchors", width: 128, height: 96 }),
    p = layer("shape", 128, 96, "curve");
  p.shape = "path";
  p.closed = closed;
  p.anchors = [
    { x: 10, y: 20, outgoing: { x: 30, y: 0 } },
    structuredClone(a),
    { x: 100, y: 80, incoming: { x: 70, y: 90 } },
  ];
  d.layers.push(p);
  return { d, p };
}
test("moving an anchor translates both absolute handles without mutating input", () => {
  const before = structuredClone(a),
    result = editedAnchor(a, { kind: "move", point: { x: 55, y: 20 } });
  assert.deepEqual(result, {
    x: 55,
    y: 20,
    incoming: { x: 45, y: 20 },
    outgoing: { x: 75, y: 20 },
  });
  assert.deepEqual(a, before);
});
test("legacy and corner handles remain independent", () => {
  for (const mode of [undefined, "corner"] as const) {
    const result = editedAnchor(
      { ...a, mode },
      { kind: "handle", part: "outgoing", point: { x: 40, y: 90 } },
    );
    assert.deepEqual(result.incoming, a.incoming);
    assert.deepEqual(result.outgoing, { x: 40, y: 90 });
  }
});
test("smooth handle dragging preserves opposite length and collinearity", () => {
  const result = editedAnchor(
    { ...a, mode: "smooth" },
    { kind: "handle", part: "outgoing", point: { x: 70, y: 80 } },
  );
  assert.deepEqual(result.incoming, { x: 34, y: 32 });
  assert.deepEqual(result.outgoing, { x: 70, y: 80 });
});
test("symmetric dragging mirrors either handle exactly", () => {
  for (const part of ["incoming", "outgoing"] as const) {
    const result = editedAnchor(
      { ...a, mode: "symmetric" },
      { kind: "handle", part, point: { x: 70, y: 80 } },
    );
    assert.deepEqual(result[part === "incoming" ? "outgoing" : "incoming"], { x: 10, y: 0 });
  }
});
test("Alt breaks coupled handles and persists corner semantics", () => {
  const result = editedAnchor(
    { ...a, mode: "symmetric" },
    { kind: "handle", part: "outgoing", point: { x: 70, y: 80 }, independent: true },
  );
  assert.equal(result.mode, "corner");
  assert.deepEqual(result.incoming, a.incoming);
});
test("collapsed handles remain finite and smooth preserves its opposite tangent", () => {
  assert.deepEqual(
    editedAnchor(
      { ...a, mode: "smooth" },
      { kind: "handle", part: "outgoing", point: { x: 40, y: 40 } },
    ).incoming,
    a.incoming,
  );
  assert.deepEqual(
    editedAnchor(
      { ...a, mode: "symmetric" },
      { kind: "handle", part: "outgoing", point: { x: 40, y: 40 } },
    ).incoming,
    { x: 40, y: 40 },
  );
});
test("smooth conversion aligns tangents while preserving distinct nonzero lengths", () => {
  const result = editedAnchor(
    { ...a, incoming: { x: 40, y: 30 } },
    { kind: "mode", mode: "smooth" },
  );
  assert.deepEqual(result.incoming, { x: 30, y: 40 });
  assert.deepEqual(result.outgoing, a.outgoing);
  assert.equal(result.mode, "smooth");
});
test("symmetric conversion averages lengths and creates useful handles on unhandled anchors", () => {
  const result = editedAnchor(a, { kind: "mode", mode: "symmetric" });
  assert.deepEqual(result.incoming, { x: 25, y: 40 });
  assert.deepEqual(result.outgoing, { x: 55, y: 40 });
  const fresh = editedAnchor(
    { x: 30, y: 0 },
    { kind: "mode", mode: "symmetric" },
    { x: 0, y: 0 },
    { x: 60, y: 0 },
  );
  assert.deepEqual(fresh.incoming, { x: 20, y: 0 });
  assert.deepEqual(fresh.outgoing, { x: 40, y: 0 });
});
test("coincident neighbors and zero-length endpoints never generate NaN", () => {
  const result = editedAnchor(
    { x: 30, y: 0 },
    { kind: "mode", mode: "smooth" },
    { x: 30, y: 0 },
    { x: 30, y: 0 },
  );
  assert.deepEqual(result.incoming, { x: 30, y: 0 });
  assert.deepEqual(result.outgoing, { x: 30, y: 0 });
});
test("corner conversion preserves handles; explicit removal changes geometry", () => {
  assert.deepEqual(editedAnchor(a, { kind: "mode", mode: "corner" }), { ...a, mode: "corner" });
  assert.deepEqual(editedAnchor(a, { kind: "clear" }), { x: 40, y: 40, mode: "corner" });
});
for (const closed of [false, true])
  test(`reversing ${closed ? "closed" : "open"} traversal preserves every cubic`, () => {
    const { d, p } = fixture(closed),
      result = reverseAnchors(d, p.id),
      q = result.layers[1]!;
    assert.deepEqual(reverseAnchors(result, p.id), d);
    if (closed) assert.deepEqual(q.anchors[0], { x: 10, y: 20, incoming: p.anchors[0]!.outgoing });
    const n = p.anchors.length;
    for (let i = 0; i < n - (closed ? 0 : 1); i++) {
      const c = anchorCurve(p.anchors[i]!, p.anchors[(i + 1) % n]!),
        j = closed ? (n - i - 1) % n : n - i - 2,
        r = anchorCurve(q.anchors[j]!, q.anchors[(j + 1) % n]!);
      for (let k = 0; k <= 50; k++) {
        const x = cubicPoint(c, k / 50),
          y = cubicPoint(r, 1 - k / 50);
        near(x.x, y.x);
        near(x.y, y.y);
      }
    }
  });
test("deletion retains surviving handles and enforces open/closed minimum topology", () => {
  const { d, p } = fixture(),
    result = editAnchor(d, p.id, 1, { kind: "delete" });
  assert.deepEqual(result.layers[1]!.anchors, [p.anchors[0], p.anchors[2]]);
  assert.throws(() => editAnchor(result, p.id, 0, { kind: "delete" }), /at least/);
  const closed = fixture(true);
  assert.throws(() => editAnchor(closed.d, closed.p.id, 0, { kind: "delete" }), /at least/);
});
test("subdivision changes adjacent symmetric anchors to smooth and retains exact geometry", () => {
  const { d, p } = fixture();
  p.anchors[0]!.mode = "symmetric";
  p.anchors[1]!.mode = "symmetric";
  const result = splitAnchorSegment(d, p.id, 0, 0.5).layers[1]!;
  assert.deepEqual(
    result.anchors.slice(0, 3).map((a) => a.mode),
    ["smooth", "smooth", "smooth"],
  );
  assert.equal(p.anchors[0]!.mode, "symmetric");
});
test("anchor operations preserve masks, clipping, source, selection and affine/projective mapping", () => {
  const { d, p } = fixture();
  p.transform = {
    x: 4,
    y: 8,
    scaleX: 1.1,
    scaleY: 0.7,
    rotation: 17,
    shearX: 8,
    deform: {
      kind: "perspective",
      width: 128,
      height: 96,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0.1 },
        { x: 0.9, y: 1 },
        { x: 0.1, y: 0.9 },
      ],
    },
  };
  p.clipped = true;
  p.mask = { enabled: true, strokes: [], selection: { regions: [], inverted: false, feather: 0 } };
  const target = { x: 62, y: 58 },
    world = worldPoint(target, p),
    local = localPoint(world, p),
    before = structuredClone(d);
  near(target.x, local.x);
  near(target.y, local.y);
  const result = editAnchor(d, p.id, 1, { kind: "move", point: local });
  const { anchors: _, ...metadata } = p,
    { anchors: _next, ...retained } = result.layers[1]!;
  assert.deepEqual(metadata, retained);
  assert.deepEqual(d, before);
  assert.deepEqual(result.selection, d.selection);
  assert.deepEqual(result.source, d.source);
});
test("native handle modes, history and source bytes survive roundtrip; SVG stays cubic", async () => {
  const { d, p } = fixture(),
    next = editAnchor(d, p.id, 1, { kind: "mode", mode: "symmetric" }),
    h = record(createHistory(d), next);
  assert.deepEqual(undo(h).present, d);
  assert.deepEqual(redo(undo(h)).present, next);
  const s: ProSession = {
      document: next,
      assets: { source: new Blob([new Uint8Array([1, 7, 3])], { type: "image/png" }) },
      revision: 0,
      acceptedBlobId: "a",
      updatedAt: 0,
    },
    reopened = await readNative(await nativeFile(s), "p", "a");
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.document)), JSON.parse(JSON.stringify(next)));
  assert.deepEqual([...new Uint8Array(await reopened.assets.source!.arrayBuffer())], [1, 7, 3]);
  const svgDoc = { ...next, layers: [next.layers[1]!] };
  assert.match(vectorSvg(svgDoc), / C/);
});
test("locks, imported paths, invalid indices, invalid modes and out-of-bounds positions fail atomically", () => {
  const { d, p } = fixture();
  for (const index of [-1, 0.2, 3, NaN])
    assert.throws(() => editAnchor(d, p.id, index, { kind: "clear" }));
  for (const x of [NaN, Infinity, 100001])
    assert.throws(() => editAnchor(d, p.id, 1, { kind: "move", point: { x, y: 0 } }));
  const g = layer("group", 128, 96, "g");
  g.locked = true;
  p.parentId = g.id;
  d.layers.push(g);
  assert.throws(() => editAnchor(d, p.id, 1, { kind: "clear" }), /Unlock/);
  assert.throws(() => reverseAnchors(d, p.id), /Unlock/);
  p.parentId = undefined;
  p.pathData = "M0 0L1 1";
  assert.throws(() => editAnchor(d, p.id, 1, { kind: "clear" }), /conversion/);
  p.pathData = undefined;
  // Untrusted native metadata is validated rather than silently accepting unknown modes.
  (p.anchors[0] as unknown as { mode: string }).mode = "automatic";
  assert.throws(() => validateDocument(d), /anchor/);
});
