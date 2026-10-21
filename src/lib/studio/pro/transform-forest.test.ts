import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, TRANSFORM, worldPoint, localPoint, type Transform } from "./model.ts";
import { transformForest, forestFrame } from "./transform-transaction.ts";
import { affine, applyMatrix, compose, fromAffine, inverse, QUAD } from "./transform.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { nativeFile, readNative } from "./files.ts";
const point = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  assert.ok(Math.abs(a.x - b.x) < 1e-8);
  assert.ok(Math.abs(a.y - b.y) < 1e-8);
};
function fixture() {
  const doc = fromPanel({ id: "p", name: "forest", width: 128, height: 96 }),
    g = layer("group", 128, 96, "g"),
    nested = layer("group", 128, 96, "nested"),
    base = doc.layers[0]!,
    clip = layer("text", 60, 40, "text");
  base.locked = false;
  base.parentId = nested.id;
  clip.parentId = nested.id;
  clip.clipped = true;
  nested.parentId = g.id;
  nested.opacity = 0.6;
  g.blend = "multiply";
  base.transform = { ...TRANSFORM, x: 10, y: 12, rotation: 13, shearX: 8, pivot: { x: 20, y: 10 } };
  clip.transform = {
    ...TRANSFORM,
    x: 20,
    y: 18,
    deform: {
      kind: "perspective",
      width: 60,
      height: 40,
      points: QUAD.map((p, i) => ({ ...p, x: p.x + (i === 3 ? 0.1 : 0) })),
    },
  };
  clip.mask = {
    selection: {
      regions: [
        {
          kind: "rectangle",
          points: [
            { x: 2, y: 3 },
            { x: 30, y: 20 },
          ],
          operation: "add",
        },
      ],
      inverted: false,
      feather: 1,
    },
    strokes: [],
    enabled: true,
  };
  doc.layers = [g, nested, base, clip];
  return { doc, g, nested, base, clip };
}
test("affine field factorization retains mapping, pivot, flip and existing projective source geometry", () => {
  const { base, clip } = fixture();
  for (const flip of [false, true]) {
    const delta: Transform = {
      ...TRANSFORM,
      x: 17,
      y: -9,
      rotation: 42,
      scaleX: 0.7,
      scaleY: 1.3,
      flipX: flip,
      shearY: 12,
    };
    for (const l of [base, clip]) {
      const m = compose(affine(delta), affine(l.transform)),
        t = fromAffine(m, l.transform);
      for (const p of [
        { x: 0, y: 0 },
        { x: 23, y: 19 },
      ])
        point(applyMatrix(affine(t), p), applyMatrix(m, p));
      assert.deepEqual(t.deform, l.transform.deform);
      assert.deepEqual(t.pivot, l.transform.pivot);
    }
  }
});
test("nested group plus selected descendant is transformed exactly once with all relationships retained", () => {
  const { doc, g, base, clip } = fixture(),
    before = structuredClone(doc),
    frame = forestFrame(doc, [g.id, clip.id]),
    value = { ...frame.transform, scaleX: 0.7, scaleY: 1.1, rotation: 20 },
    next = transformForest(doc, [g.id, clip.id], frame.transform, value),
    delta = compose(affine(value), inverse(affine(frame.transform)));
  for (const l of [base, clip]) {
    const result = next.layers.find((n) => n.id === l.id)!;
    const p = { x: 12, y: 9 };
    point(worldPoint(p, result), applyMatrix(delta, worldPoint(p, l)));
    point(localPoint(worldPoint(p, result), result), p);
    assert.deepEqual(result.mask, l.mask);
    assert.equal(result.parentId, l.parentId);
    assert.equal(result.clipped, l.clipped);
    assert.deepEqual(result.strokes, l.strokes);
  }
  assert.deepEqual(next.layers.slice(0, 2), doc.layers.slice(0, 2));
  assert.deepEqual(doc, before);
  assert.deepEqual(next.source, doc.source);
});
test("linked peers outside selected groups participate once; hidden children are retained", () => {
  const { doc, g, base } = fixture(),
    peer = layer("shape", 10, 10, "peer");
  base.linkId = peer.linkId = "link";
  base.visible = false;
  doc.layers.push(peer);
  const next = transformForest(doc, [g.id, base.id, peer.id], TRANSFORM, {
    ...TRANSFORM,
    x: 7,
    y: 3,
  });
  for (const l of [base, peer]) {
    const t = next.layers.find((n) => n.id === l.id)!.transform;
    point({ x: t.x, y: t.y }, { x: l.transform.x + 7, y: l.transform.y + 3 });
  }
  assert.equal(next.layers.find((n) => n.id === base.id)!.visible, false);
});
test("locked descendants, missing IDs, empty groups, non-affine forest changes and oversized frames fail atomically", () => {
  const { doc, g, base } = fixture(),
    before = structuredClone(doc);
  base.locked = true;
  assert.throws(() => transformForest(doc, [g.id], TRANSFORM, { ...TRANSFORM, x: 5 }), /Unlock/);
  base.locked = false;
  assert.throws(() => transformForest(doc, ["missing"], TRANSFORM, TRANSFORM), /Select/);
  assert.throws(() => forestFrame({ ...doc, layers: [g] }, [g.id]), /no artwork/);
  assert.throws(
    () =>
      transformForest(doc, [g.id], TRANSFORM, {
        ...TRANSFORM,
        deform: { kind: "perspective", width: 128, height: 96, points: QUAD },
      }),
    /affine/,
  );
  const far = layer("shape", 10, 10, "far");
  far.transform.x = 20000;
  assert.throws(
    () => forestFrame({ ...doc, layers: [...doc.layers, far] }, [g.id, far.id]),
    /frame limit/,
  );
  assert.deepEqual(doc, before);
});
test("forest transform is one native-reopenable undo step without rasterizing shape or text", async () => {
  const { doc, g } = fixture(),
    next = transformForest(doc, [g.id], TRANSFORM, { ...TRANSFORM, x: 9, y: 4, rotation: 5 }),
    h = record(createHistory(doc), next);
  assert.equal(h.past.length, 1);
  assert.deepEqual(undo(h).present, doc);
  assert.deepEqual(redo(undo(h)).present, next);
  const s = {
    document: next,
    assets: { source: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) },
    revision: 0,
    acceptedBlobId: "b",
    updatedAt: 0,
  };
  const reopened = await readNative(await nativeFile(s), "p", "b");
  assert.deepEqual(reopened.document, next);
  assert.equal(reopened.document.layers[3]!.kind, "text");
});
