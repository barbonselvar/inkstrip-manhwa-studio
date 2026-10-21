import { test } from "node:test";
import assert from "node:assert/strict";
import {
  affine,
  applyMatrix,
  compose,
  inverse,
  withPivot,
  pivotWorld,
  homography,
  inverseHomography,
  project,
  warp,
  unwarp,
  mapping,
  validateTransform,
  bounds,
  frame,
  dragTransform,
  MESH,
  QUAD,
  TRANSFORM_HANDLES,
} from "./transform.ts";
import {
  TRANSFORM,
  fromPanel,
  layer,
  localPoint,
  worldPoint,
  toLocalSelection,
  validateDocument,
  type Transform,
  type ProSession,
} from "./model.ts";
import { transformDocument } from "./transform-transaction.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { cloneSourceMatrix } from "./operations.ts";
const near = (a: number, b: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const point = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  near(a.x, b.x);
  near(a.y, b.y);
};
const full: Transform = {
  x: 21,
  y: -13,
  scaleX: 1.4,
  scaleY: 0.6,
  rotation: 28,
  shearX: 21,
  shearY: -17,
  flipX: true,
  pivot: { x: 32, y: 24 },
};
const perspective: Transform = {
  ...full,
  deform: {
    kind: "perspective",
    width: 128,
    height: 96,
    points: [
      { x: 0.15, y: 0 },
      { x: 0.85, y: 0.1 },
      { x: 1, y: 1 },
      { x: 0, y: 0.9 },
    ],
  },
};
const warped: Transform = {
  ...full,
  deform: {
    kind: "warp",
    width: 128,
    height: 96,
    points: MESH.map((p, i) => ({ x: p.x + (i === 4 ? 0.1 : 0), y: p.y + (i === 1 ? -0.08 : 0) })),
  },
};
test("matrix composition agrees with sequential application and inverse", () => {
  const a = affine(full),
    b = affine({ ...full, rotation: -34, flipX: false }),
    p = { x: 17, y: 40 };
  point(applyMatrix(compose(a, b), p), applyMatrix(a, applyMatrix(b, p)));
  point(applyMatrix(inverse(a), applyMatrix(a, p)), p);
  assert.throws(() => inverse([0, 0, 0, 0, 0, 0]), /Singular/);
});
test("legacy transform order retains original scale, rotate, translate geometry", () => {
  const t = { ...TRANSFORM, x: 3, y: 4, scaleX: 2, scaleY: 3, rotation: 90 };
  point(mapping(t).forward({ x: 5, y: 7 }), { x: -18, y: 14 });
});
test("sequential horizontal/vertical shear has unit determinant independent of angle", () => {
  const t = { ...TRANSFORM, shearX: 30, shearY: 40 },
    m = affine(t);
  near(m[0] * m[3] - m[1] * m[2], 1);
  point(mapping(t).forward({ x: 0, y: 10 }), {
    x: Math.tan(Math.PI / 6) * 10,
    y: 10 + Math.tan(Math.PI / 6) * Math.tan((40 * Math.PI) / 180) * 10,
  });
});
test("both flips preserve positive scale metadata and invert correctly around the pivot", () => {
  const t = { ...TRANSFORM, pivot: { x: 20, y: 10 }, flipX: true, flipY: true };
  point(mapping(t).forward({ x: 5, y: 3 }), { x: 35, y: 17 });
  point(mapping(t).backward({ x: 35, y: 17 }), { x: 5, y: 3 });
});
test("pivot relocation does not move artwork; subsequent rotation keeps pivot fixed", () => {
  const t = withPivot(full, { x: 11, y: 37 });
  for (const p of QUAD) point(mapping(t).forward(p), mapping(full).forward(p));
  const c = pivotWorld(t),
    rotated = { ...t, rotation: 90 };
  point(pivotWorld(rotated), c);
  point(applyMatrix(affine(rotated), t.pivot!), c);
});
for (const [name, t] of [
  ["affine", full],
  ["perspective", perspective],
  ["warp", warped],
] as const) {
  test(`${name}: input, hit-test and mask coordinate mappings roundtrip a dense grid`, () => {
    validateTransform(t);
    const l = layer("paint", 128, 96);
    l.transform = t;
    for (let y = 0; y <= 10; y++)
      for (let x = 0; x <= 10; x++) {
        const p = { x: x * 12.8, y: y * 9.6 };
        point(localPoint(worldPoint(p, l), l), p);
      }
    const selection = toLocalSelection({ regions: [], inverted: true, feather: 3 }, l, {
      width: 128,
      height: 96,
    });
    assert.deepEqual(selection.frame!.transform, t);
  });
}
test("homography maps each exact independent corner and its inverse", () => {
  const q = perspective.deform!.points,
    h = homography(q),
    inv = inverseHomography(h);
  QUAD.forEach((p, i) => {
    point(project(h, p), q[i]!);
    point(project(inv, q[i]!), p);
  });
});
test("perspective retains projective division and straight lines, not an affine triangle approximation", () => {
  const q = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.75, y: 1 },
      { x: 0.25, y: 1 },
    ],
    h = homography(q);
  point(project(h, { x: 0.5, y: 0.5 }), { x: 0.5, y: 2 / 3 });
  for (const v of [0.1, 0.3, 0.7, 0.9]) near(project(h, { x: 0.5, y: v }).x, 0.5);
});
test("identity Bézier mesh and its inverse preserve source coordinates", () => {
  for (const p of [
    { x: 0, y: 0 },
    { x: 0.3, y: 0.7 },
    { x: 1, y: 1 },
  ]) {
    point(warp(MESH, p), p);
    point(unwarp(MESH, p), p);
  }
});
test("Bézier center displacement follows analytic Bernstein weights, with smooth interpolation", () => {
  const p = MESH.map((p) => ({ ...p }));
  p[4]!.x += 0.1;
  point(warp(p, { x: 0.5, y: 0.5 }), { x: 0.525, y: 0.5 });
  const left = warp(p, { x: 0.5 - 1e-5, y: 0.4 }),
    mid = warp(p, { x: 0.5, y: 0.4 }),
    right = warp(p, { x: 0.5 + 1e-5, y: 0.4 });
  near((mid.x - left.x) / 1e-5, (right.x - mid.x) / 1e-5, 1e-4);
});
test("bounded mesh inversion remains stable at all allowed extremes", () => {
  for (const sign of [-1, 1]) {
    const points = MESH.map((p, i) => ({
      x: p.x + sign * (i % 2 ? 0.1 : -0.1),
      y: p.y + sign * (i % 3 ? 0.1 : -0.1),
    }));
    validateTransform({ ...TRANSFORM, deform: { kind: "warp", width: 128, height: 96, points } });
    for (let y = 0; y <= 10; y++)
      for (let x = 0; x <= 10; x++) {
        const p = { x: x / 10, y: y / 10 };
        point(unwarp(points, warp(points, p)), p);
      }
  }
});
test("perspective bounds are the exact transformed corner extrema", () => {
  const b = bounds(perspective, 128, 96),
    p = QUAD.map((p) => mapping(perspective).forward({ x: p.x * 128, y: p.y * 96 }));
  near(b.x, Math.min(...p.map((p) => p.x)));
  near(b.y, Math.min(...p.map((p) => p.y)));
  near(b.width, Math.max(...p.map((p) => p.x)) - b.x);
});
test("warp bounds include analytic curve extrema between control points", () => {
  const t = {
      ...TRANSFORM,
      deform: {
        kind: "warp" as const,
        width: 100,
        height: 100,
        points: MESH.map((p, i) => ({ ...p, y: p.y + (i === 1 ? -0.1 : 0) })),
      },
    },
    b = bounds(t, 100, 100);
  near(b.y, -5);
  near(b.height, 105);
  for (let i = 0; i <= 100; i++) {
    const p = mapping(t).forward({ x: i, y: 0 });
    assert.ok(p.y >= b.y - 1e-8 && p.y <= b.y + b.height + 1e-8);
  }
});
for (const h of TRANSFORM_HANDLES) {
  test(`scale ${h}: inverse-mapped drag preserves opposite affine anchor`, () => {
    const f = frame(full, 128, 96),
      i = TRANSFORM_HANDLES.indexOf(h),
      opposite = (i + 4) % 8,
      start = f.points[i]!,
      fixed = f.points[opposite]!,
      t = dragTransform(full, 128, 96, h, start, { x: start.x + 4, y: start.y + 3 });
    point(frame(t, 128, 96).points[opposite]!, fixed);
  });
}
test("aspect scaling, Alt pivot scaling, rotation snapping and independent nonuniform scale", () => {
  const t = { ...TRANSFORM, pivot: { x: 64, y: 48 } },
    start = { x: 128, y: 96 },
    next = dragTransform(t, 128, 96, "se", start, { x: 192, y: 120 }, true);
  near(next.scaleX, next.scaleY);
  const alt = dragTransform(t, 128, 96, "se", start, { x: 160, y: 120 }, false, true);
  point(pivotWorld(alt), pivotWorld(t));
  const separate = dragTransform(t, 128, 96, "e", { x: 128, y: 48 }, { x: 192, y: 48 });
  near(separate.scaleX, 1.5);
  near(separate.scaleY, 1);
  near(
    dragTransform(t, 128, 96, "rotate", { x: 64, y: 0 }, { x: 100, y: 1 }, false, false, true)
      .rotation % 15,
    0,
  );
});
test("affine source snapshots use the same inverse including pivot, shear and flips", () => {
  const l = { transform: full },
    offset = { x: 13, y: -7 },
    m = cloneSourceMatrix(l, offset, 1),
    p = { x: 39, y: 71 };
  point(applyMatrix([...m], p), localPoint({ x: p.x - offset.x, y: p.y - offset.y }, l));
});
test("invalid/folded/degenerated geometry is refused before any document changes", () => {
  for (const t of [
    { ...full, shearX: 76 },
    { ...full, flipX: "yes" },
    { ...full, scaleX: 0 },
    {
      ...perspective,
      deform: { ...perspective.deform!, points: [QUAD[0], QUAD[2], QUAD[1], QUAD[3]] },
    },
    {
      ...warped,
      deform: { ...warped.deform!, points: MESH.map((p) => ({ x: p.x + 0.2, y: p.y })) },
    },
  ])
    assert.throws(() => validateTransform(t as Transform));
  const d = fromPanel({ id: "p", name: "test", width: 128, height: 96 });
  d.layers[0]!.transform = { ...warped, deform: { ...warped.deform!, width: 64 } };
  assert.throws(() => validateDocument(d), /dimensions/);
});
test("one undoable transaction retains groups, clipping, links, masks and original references", () => {
  const d = fromPanel({ id: "p", name: "test", width: 128, height: 96 }),
    a = d.layers[0]!,
    b = layer("text", 30, 20);
  a.linkId = b.linkId = "link";
  b.clipped = true;
  d.layers.push(b);
  a.mask = { selection: { regions: [], inverted: true, feather: 2 }, strokes: [], enabled: true };
  const result = transformDocument(d, a.id, { ...warped, x: 31, y: -8 }, { x: 10, y: 5 });
  assert.equal(result.layers[1]!.transform.x, 10);
  assert.equal(result.layers[1]!.transform.y, 5);
  assert.equal(result.layers[1]!.clipped, true);
  assert.strictEqual(result.source, d.source);
  assert.strictEqual(result.layers[0]!.mask, a.mask);
  const h = record(createHistory(d), result);
  assert.deepEqual(undo(h).present, d);
  assert.deepEqual(redo(undo(h)).present, result);
  b.locked = true;
  assert.throws(() => transformDocument(d, a.id, full, { x: 2, y: 0 }), /Unlock/);
});
test("affine, perspective, warp, masks, selections and texture snapshots survive native roundtrip", async () => {
  const doc = fromPanel({ id: "p", name: "test", width: 128, height: 96 });
  for (const t of [full, perspective, warped]) {
    const l = layer("paint", 128, 96);
    l.transform = t;
    l.strokes.push({
      points: [{ x: 64, y: 48 }],
      size: 8,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#000000",
      erase: false,
      clone: {
        assetId: "source",
        width: 128,
        height: 96,
        source: { x: 10, y: 10 },
        destination: { x: 30, y: 20 },
        targetTransform: t,
      },
    });
    l.mask = {
      enabled: true,
      strokes: [],
      selection: toLocalSelection({ regions: [], inverted: true, feather: 3 }, l, {
        width: 128,
        height: 96,
      }),
    };
    doc.layers.push(l);
  }
  const session: ProSession = {
      document: doc,
      assets: { source: new Blob(["original"], { type: "image/png" }) },
      revision: 0,
      acceptedBlobId: "original",
      updatedAt: 0,
    },
    reopened = await readNative(await nativeFile(session), "p", "original");
  assert.deepEqual(reopened.document, doc);
  assert.equal(await reopened.assets.source!.text(), "original");
});
test("SVG preserves affine vector/text geometry and explicitly refuses unsupported non-affine export", () => {
  const d = fromPanel({ id: "p", name: "test", width: 128, height: 96 });
  const l = layer("shape", 128, 96);
  l.transform = full;
  d.layers = [l];
  assert.ok(vectorSvg(d).includes(`matrix(${affine(full).join(" ")})`));
  l.transform = perspective;
  assert.throws(() => vectorSvg(d), /cannot represent perspective/);
});
