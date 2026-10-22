import test from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, validateDocument, type Layer, type ProSession } from "./model.ts";
import {
  appearance,
  appearanceItem,
  defaultVectorGradient,
  initialVectorGradient,
  gradientHandles,
  gradientMatrix,
  moveGradientHandle,
  validateVectorGradient,
} from "./vector-appearance.ts";
import {
  attachText,
  defaultTextPath,
  graphemes,
  checkPathText,
  measureTextPath,
  pathPosition,
  layoutPathText,
  reversedContour,
  trimmedTextContour,
} from "./text-path.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import { editAnchor } from "./anchor-edit.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { applyMatrix } from "./transform.ts";
import { pathfinderSelection } from "./pathfinder-selection.ts";
import { fitVectorFrame } from "./compound.ts";
import { svgNumber } from "./svg-paint.ts";
const near = (a: number, b: number, epsilon = 0.015) =>
  assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const document = () => {
  const d = fromPanel({ id: "panel", name: "Final vector", width: 300, height: 100 });
  d.layers[0]!.visible = false;
  const l = layer("shape", 100, 80, "shape");
  l.strokeWidth = 2;
  d.layers.push(l);
  return d;
};
function pathText(): Layer {
  const l = layer("text", 300, 100, "text");
  l.anchors = [
    { x: 0, y: 20 },
    { x: 300, y: 20 },
  ];
  l.closed = false;
  l.shape = "path";
  l.textPath = defaultTextPath();
  l.text = "ABC";
  l.fontSize = 10;
  l.strokeWidth = 0;
  return l;
}
const session = (d: ReturnType<typeof document>): ProSession => ({
  document: d,
  assets: { source: new Blob(["original source"], { type: "image/png" }) },
  acceptedBlobId: "original",
  revision: 0,
  updatedAt: 0,
});

test("appearance captures both legacy paints without mutating geometry or style", () => {
  const d = document(),
    l = d.layers[1]!,
    before = structuredClone(l),
    a = appearance(l);
  assert.equal(a.length, 2);
  assert.equal(a[0]!.paint.color, l.fill);
  assert.equal(a[1]!.width, 2);
  assert.deepEqual(l, before);
  assert.equal(appearance(l)[0]!.id, a[0]!.id);
});
test("multiple fills/strokes, visibility, opacity, dash/caps/joins and winding are validated native data", () => {
  const d = document(),
    l = d.layers[1]!;
  l.appearance = [
    ...appearance(l),
    {
      ...appearanceItem("stroke", l),
      width: 10,
      alignment: "outside",
      dash: [0, 5],
      cap: "round",
      join: "miter",
      miterLimit: 4,
      opacity: 0.4,
    },
    { ...appearanceItem("fill", l), fillRule: "evenodd", visible: false, blend: "multiply" },
  ];
  validateDocument(d);
  assert.equal(l.appearance.length, 4);
});
for (const alignment of ["inside", "outside"] as const)
  test(`${alignment} is guarded on open contours and text`, () => {
    const d = document(),
      l = d.layers[1]!;
    l.shape = "path";
    l.anchors = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ];
    l.appearance = [{ ...appearanceItem("stroke", l), alignment }];
    assert.throws(() => validateDocument(d), /closed native/);
    l.kind = "text";
    assert.throws(() => validateDocument(d));
  });
test("duplicate appearance IDs, excessive items, NaN and invalid dash patterns fail before history", () => {
  const d = document(),
    l = d.layers[1]!,
    a = appearanceItem("fill", l);
  for (const p of [{ opacity: NaN }, { width: Infinity }, { dash: [0, 0] }, { miterLimit: 0 }]) {
    l.appearance = [{ ...a, ...p }];
    assert.throws(() => validateDocument(d));
  }
  l.appearance = [a, a];
  assert.throws(() => validateDocument(d));
  l.appearance = Array.from({ length: 17 }, () => appearanceItem("fill", l));
  assert.throws(() => validateDocument(d));
});
test("object-bounds gradient coordinates follow actual curves, not the editing frame", () => {
  const l = layer("shape", 300, 100);
  l.shape = "path";
  l.anchors = [
    { x: 20, y: 10 },
    { x: 120, y: 10 },
    { x: 120, y: 70 },
    { x: 20, y: 70 },
  ];
  l.closed = true;
  const g = defaultVectorGradient(),
    h = gradientHandles(g, l);
  assert.deepEqual(h.from, { x: 20, y: 40 });
  assert.deepEqual(h.to, { x: 120, y: 40 });
});
test("user-space gradient matrices compose/invert canvas handles accurately", () => {
  const l = layer("shape", 100, 80),
    g = defaultVectorGradient();
  g.units = "userSpaceOnUse";
  g.matrix = [2, 0.5, 0.25, 3, 10, 20];
  const h = gradientHandles(g, l);
  const moved = moveGradientHandle(g, l, "to", { x: 70, y: 45 });
  const restored = gradientHandles(moved, l).to;
  near(restored.x, 70, 1e-9);
  near(restored.y, 45, 1e-9);
  assert.deepEqual(h.from, applyMatrix(g.matrix, g.from));
});
test("radial center movement carries its focal point; radius dragging uses gradient space", () => {
  const l = layer("shape", 100, 80),
    g = defaultVectorGradient();
  g.kind = "radial";
  g.from = g.to = { x: 0.5, y: 0.5 };
  const n = moveGradientHandle(g, l, "center", { x: 60, y: 48 });
  near(n.from.x, 0.6, 1e-12);
  near(n.from.y, 0.6, 1e-12);
  const r = moveGradientHandle(n, l, "radius", { x: 100, y: 48 });
  near(r.radius, 0.4, 1e-9);
});
test("gradient matrices, stop order, duplicate hard stops and degenerate geometry are safe", () => {
  const g = defaultVectorGradient();
  g.stops = [
    { position: 0, color: "#000000", opacity: 0 },
    { position: 0.5, color: "#000000", opacity: 1 },
    { position: 0.5, color: "#ffffff", opacity: 0.2 },
    { position: 1, color: "#ffffff", opacity: 1 },
  ];
  validateVectorGradient(g);
  g.matrix = [0, 0, 0, 0, 0, 0];
  assert.throws(() => validateVectorGradient(g));
  g.matrix = [1, 0, 0, 1, 0, 0];
  g.to = g.from;
  assert.throws(() => validateVectorGradient(g));
});
test("gradient bounds reject zero-area geometry explicitly", () => {
  const l = layer("shape", 100, 80);
  l.shape = "path";
  l.anchors = [
    { x: 0, y: 10 },
    { x: 100, y: 10 },
  ];
  assert.throws(() => gradientMatrix(defaultVectorGradient(), l), /non-zero/);
});
test("SVG dimensions convert standards-based physical units at 96 DPI", () => {
  near(svgNumber("1in", 0), 96, 1e-9);
  near(svgNumber("25.4mm", 0), 96, 1e-9);
  near(svgNumber("72pt", 0), 96, 1e-9);
  near(svgNumber("6pc", 0), 96, 1e-9);
  near(svgNumber("101.6q", 0), 96, 1e-9);
  assert.throws(() => svgNumber("1em", 0));
  assert.throws(() => svgNumber("Infinity", 0));
});
test("text attachment owns a copied compound contour and retains the original/source bytes", () => {
  const d = document(),
    l = d.layers[1]!;
  l.shape = "path";
  l.anchors = [
    { x: 1, y: 1 },
    { x: 90, y: 20 },
  ];
  l.subpaths = [
    {
      closed: false,
      anchors: [
        { x: 5, y: 10, outgoing: { x: 30, y: 80 } },
        { x: 80, y: 30 },
      ],
    },
  ];
  const snapshot = structuredClone(d),
    n = attachText(d, l.id, 1),
    t = n.document.layers.at(-1)!;
  assert.equal(t.kind, "text");
  assert.deepEqual(t.anchors, l.subpaths[0]!.anchors);
  assert.notEqual(t.anchors, l.subpaths[0]!.anchors);
  assert.deepEqual(d, snapshot);
  assert.deepEqual(n.document.source, d.source);
});
test("arc lookup handles nonuniform collinear cubic parameter speed", () => {
  const l = pathText();
  l.anchors[0]!.outgoing = { x: 0, y: 20 };
  l.anchors[1]!.incoming = { x: 0, y: 20 };
  const m = measureTextPath(l);
  near(m.length, 300, 0.001);
  near(pathPosition(m, 75).x, 75, 0.001);
});
test("curved text metric agrees with independent quarter-circle arc length", () => {
  const l = pathText(),
    k = 0.5522847498307936 * 100;
  l.anchors = [
    { x: 100, y: 0, outgoing: { x: 100, y: k } },
    { x: 0, y: 100, incoming: { x: k, y: 100 } },
  ];
  const m = measureTextPath(l);
  near(m.length, Math.PI * 50, 0.04);
  const p = pathPosition(m, m.length / 2);
  near(p.x, Math.SQRT1_2 * 100, 0.03);
  near(p.y, Math.SQRT1_2 * 100, 0.03);
});
test("arc cache survives typography/appearance changes and invalidates on anchor replacement", () => {
  const l = pathText(),
    m = measureTextPath(l);
  assert.equal(measureTextPath({ ...l, fontSize: 45 }), m);
  assert.notEqual(measureTextPath({ ...l, anchors: structuredClone(l.anchors) }), m);
});
for (const [align, first] of [
  ["left", 15],
  ["center", 135],
  ["right", 255],
] as const)
  test(`text-on-path ${align} uses measured glyph advances and start/end bounds`, () => {
    const l = pathText();
    l.align = align;
    l.textPath!.start = 10;
    l.textPath!.end = 20;
    const glyphs = layoutPathText(l, () => 10);
    near(glyphs[0]!.x, first);
    near(glyphs[1]!.x - glyphs[0]!.x, 10);
  });
test("path text tracking and independent position offset move actual glyph centers", () => {
  const l = pathText();
  l.letterSpacing = 2;
  l.textPath!.offset = 20;
  const a = layoutPathText(l, () => 10);
  near(a[0]!.x, 25);
  near(a[1]!.x, 37);
});
test("reverse text traversal keeps a closed contour's first anchor and swaps cubic handles", () => {
  const c = {
    closed: true,
    anchors: [
      { x: 0, y: 0, outgoing: { x: 10, y: 0 } },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
  };
  const r = reversedContour(c);
  assert.deepEqual(r.anchors[0]!.incoming, c.anchors[0]!.outgoing);
  assert.equal(r.anchors[0]!.x, 0);
  assert.equal(r.anchors[1]!.x, 0);
  const l = pathText();
  l.textPath!.reverse = true;
  const a = layoutPathText(l, () => 10);
  near(a[0]!.x, 295);
  near(Math.abs(a[0]!.angle), Math.PI, 1e-9);
});
test("Unicode graphemes keep combining marks, emoji and ZWJ sequences together", () => {
  assert.deepEqual(graphemes("e\u0301👩‍🎨界"), ["é", "👩‍🎨", "界"]);
  checkPathText("Inkstrip Ελληνικά 漫画 👩‍🎨");
  for (const s of ["مرحبا", "שלום", "नमस्ते", "ภาษาไทย"])
    assert.throws(() => checkPathText(s), /shape/);
});
test("empty/zero-length text baselines are finite; overflowing glyph centers are hidden", () => {
  const l = pathText();
  l.anchors[1] = { ...l.anchors[0]! };
  assert.deepEqual(
    layoutPathText(l, () => 10),
    [],
  );
  l.anchors = [l.anchors[0]!, { x: 300, y: 20 }];
  l.textPath!.start = 290;
  assert.equal(layoutPathText(l, () => 10).length, 1);
});
test("SVG textPath trims only boundary curves and preserves editable cubic geometry", () => {
  const l = pathText();
  l.textPath!.start = 20;
  l.textPath!.end = 30;
  const c = trimmedTextContour(l);
  near(c.anchors[0]!.x, 20);
  near(c.anchors.at(-1)!.x, 270);
  assert.equal(c.closed, false);
  l.anchors[0]!.outgoing = { x: 30, y: 0 };
  l.anchors[1]!.incoming = { x: 270, y: 80 };
  const curved = trimmedTextContour(l);
  assert.ok(curved.anchors[0]!.outgoing);
  assert.ok(curved.anchors.at(-1)!.incoming);
});
test("text baseline anchors use existing modes, handle editing, undo and redo", () => {
  const d = document(),
    t = pathText();
  d.layers.push(t);
  const n = editAnchor(d, t.id, 0, { kind: "move", point: { x: 10, y: 30 } });
  let h = record(createHistory(d), n);
  h = undo(h);
  assert.deepEqual(h.present, d);
  h = redo(h);
  assert.deepEqual(h.present.layers.at(-1)!.anchors[0], {
    x: 10,
    y: 30,
    incoming: undefined,
    outgoing: undefined,
  });
});
test("native v4 roundtrip retains appearance, gradients, text baseline, clips and immutable assets", async () => {
  const d = document(),
    l = d.layers[1]!;
  l.appearance = appearance(l);
  l.appearance[0]!.paint.gradient = defaultVectorGradient();
  l.vectorClips = [
    {
      contours: [
        {
          closed: true,
          anchors: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
          ],
        },
      ],
      matrix: [1, 0, 0, 1, 0, 0],
      rule: "evenodd",
      enabled: true,
    },
  ];
  const t = pathText();
  d.layers.push(t);
  const blob = await nativeFile(session(d)),
    json = JSON.parse(await blob.text());
  assert.equal(json.version, 4);
  const read = await readNative(blob, "panel", "original");
  assert.deepEqual(read.document, d);
  assert.equal(await read.assets.source!.text(), "original source");
});
test("SVG emits real stacked geometry, local gradients, clip/mask strokes and editable textPath", () => {
  const d = document(),
    l = d.layers[1]!;
  l.appearance = appearance(l);
  l.appearance[0]!.paint.gradient = defaultVectorGradient();
  l.appearance[1]!.alignment = "outside";
  d.layers.push(pathText());
  const svg = vectorSvg(d);
  assert.match(svg, /linearGradient/);
  assert.match(svg, /data-inkstrip-appearance/);
  assert.match(svg, /<mask/);
  assert.match(svg, /<textPath href="#ink-/);
  assert.match(svg, /ABC/);
  assert.doesNotMatch(svg, /<image|data:image/);
});
test("Pathfinder cannot silently discard advanced paint or imported clip relationships", () => {
  const d = document(),
    l = d.layers[1]!,
    b = layer("shape", 30, 30);
  d.layers.push(b);
  l.appearance = appearance(l);
  assert.throws(() => pathfinderSelection(d, [l.id, b.id]));
  l.appearance = undefined;
  l.vectorClips = [{ enabled: true, matrix: [1, 0, 0, 1, 0, 0], rule: "nonzero", contours: [] }];
  assert.throws(() => pathfinderSelection(d, [l.id, b.id]));
});
test("invalid clip transforms, oversized geometry and path-text offsets are rejected", () => {
  const d = document(),
    l = d.layers[1]!;
  l.vectorClips = [{ contours: [], matrix: [0, 0, 0, 0, 0, 0], rule: "nonzero", enabled: true }];
  assert.throws(() => validateDocument(d));
  l.vectorClips = undefined;
  const t = pathText();
  t.textPath!.offset = Infinity;
  d.layers.push(t);
  assert.throws(() => validateDocument(d));
});
test("legacy documents still emit the old envelope without an implicit appearance migration", async () => {
  const d = document();
  assert.equal(JSON.parse(await (await nativeFile(session(d))).text()).version, 1);
  assert.equal(d.layers[1]!.appearance, undefined);
});

test("on-canvas gradient stops project through affine coordinates and cannot cross their neighbors", () => {
  const l = layer("shape", 100, 80),
    g = defaultVectorGradient();
  g.stops.splice(1, 0, { position: 0.5, color: "#ff0000", opacity: 0.5 });
  g.matrix = [1, 0.2, 0.3, 1, 0.1, 0.2];
  const moved = moveGradientHandle(
    g,
    l,
    "stop:1",
    applyMatrix([100, 16, 30, 80, 10, 16], { x: 0.75, y: 0.5 }),
  );
  near(moved.stops[1]!.position, 0.75, 1e-10);
  assert.equal(moveGradientHandle(g, l, "stop:1", { x: 100000, y: 10000 }).stops[1]!.position, 1);
  assert.deepEqual(moveGradientHandle(g, l, "stop:0", { x: 20, y: 20 }), g);
});

test("fitting a native vector frame rebases user-space paints and clips without changing world geometry", () => {
  const d = document(),
    l = d.layers[1]!;
  l.shape = "path";
  l.anchors = [
    { x: 30, y: 20 },
    { x: 90, y: 20 },
    { x: 90, y: 60 },
  ];
  l.closed = true;
  const a = appearanceItem("fill", l);
  a.paint.gradient = {
    ...defaultVectorGradient(),
    units: "userSpaceOnUse",
    from: { x: 30, y: 20 },
    to: { x: 90, y: 60 },
  };
  l.appearance = [a];
  l.vectorClips = [
    {
      enabled: true,
      rule: "nonzero",
      contours: [
        {
          closed: true,
          anchors: [
            { x: 30, y: 20 },
            { x: 90, y: 20 },
            { x: 90, y: 60 },
          ],
        },
      ],
      matrix: [1, 0, 0, 1, 0, 0],
    },
  ];
  const next = fitVectorFrame(d, l.id).layers[1]!;
  const before = gradientHandles(a.paint.gradient!, l),
    after = gradientHandles(next.appearance![0]!.paint.gradient!, next);
  near(after.from.x + next.transform.x, before.from.x + l.transform.x);
  near(after.from.y + next.transform.y, before.from.y + l.transform.y);
  const clipped = applyMatrix(
    next.vectorClips![0]!.matrix,
    next.vectorClips![0]!.contours[0]!.anchors[0]!,
  );
  near(clipped.x + next.transform.x, 30 + l.transform.x);
  near(clipped.y + next.transform.y, 20 + l.transform.y);
});

test("gradient creation uses real user-space geometry for zero-area vertical/horizontal strokes", () => {
  const l = layer("shape", 100, 80);
  l.shape = "path";
  l.closed = false;
  l.anchors = [
    { x: 32, y: 0 },
    { x: 32, y: 80 },
  ];
  const g = initialVectorGradient(l, "linear");
  assert.equal(g.units, "userSpaceOnUse");
  assert.deepEqual(g.from, { x: 32, y: 0 });
  assert.deepEqual(g.to, { x: 32, y: 80 });
  validateVectorGradient(g);
  const r = initialVectorGradient(l, "radial", g);
  assert.deepEqual(r.from, { x: 32, y: 40 });
  assert.equal(r.radius, 40);
  validateVectorGradient(r);
  const horizontal = {
    ...l,
    anchors: [
      { x: 0, y: 12 },
      { x: 100, y: 12 },
    ],
  };
  const h = initialVectorGradient(horizontal, "linear");
  assert.deepEqual(h.from, { x: 0, y: 12 });
  assert.deepEqual(h.to, { x: 100, y: 12 });
});
