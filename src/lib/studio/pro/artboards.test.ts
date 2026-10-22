import { dragTransform } from "./transform.ts";
import { worldPoint } from "./model.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, validateDocument, type ProDocument, type ProSession } from "./model.ts";
import {
  addArtboard,
  artboards,
  artboardFilename,
  artboardRange,
  changeArtboard,
  DEFAULT_LAYOUT,
  layout,
  presetSize,
  removeArtboard,
  reorderArtboard,
  workspaceFrame,
} from "./artboards.ts";
import {
  alignObjects,
  buildSnapIndex,
  layerBounds,
  objectBounds,
  snapGeometry,
  snapHandle,
} from "./precision.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
const fixture = () => {
  const d = fromPanel({ id: "chapter", name: "Geometry", width: 128, height: 96 });
  d.layers[0]!.visible = false;
  const rect = (id: string, x: number, y: number, width = 20, height = 10) => ({
    ...layer("shape", width, height, id),
    transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
    strokeWidth: 0,
  });
  d.layers.push(rect("a", 10, 10), rect("b", 60, 30), rect("c", 100, 50));
  return d;
};
const settings = (d: ProDocument) => ({
  ...d,
  layout: {
    ...structuredClone(DEFAULT_LAYOUT),
    modes: { grid: false, objects: false, anchors: false, guides: false, artboards: false },
  },
});
const session = (d: ProDocument): ProSession => ({
  document: d,
  assets: { source: new Blob(["retained original"], { type: "image/png" }) },
  revision: 0,
  acceptedBlobId: "original",
  updatedAt: 0,
});
const near = (a: number, b: number, epsilon = 1e-8) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test("artboard CRUD and ordering preserve every source object and legacy output dimensions", () => {
  const original = fixture(),
    snapshot = structuredClone(original),
    a = addArtboard(original),
    b = addArtboard(a.document, a.id);
  assert.equal(artboards(a.document)[0]!.width, 128);
  assert.equal(artboards(b.document)[1]!.x, 160);
  const renamed = changeArtboard(b.document, b.id, {
    name: "Second",
    width: 80,
    height: 60,
    x: -100,
    y: -40,
  });
  assert.equal(artboards(renamed)[1]!.name, "Second");
  assert.equal(artboards(reorderArtboard(renamed, b.id, -1))[0]!.id, b.id);
  const deleted = removeArtboard(removeArtboard(renamed, a.id), b.id);
  assert.deepEqual(deleted.layers, original.layers);
  assert.equal(deleted.width, original.width);
  assert.deepEqual(original, snapshot);
});
test("artboard boundary movement is independent by default; contained root groups move exactly once", () => {
  let d: ProDocument = addArtboard(fixture()).document;
  const id = d.artboards![0]!.id;
  const group = layer("group", 128, 96, "g");
  d = {
    ...d,
    layers: [d.layers[0]!, group, ...d.layers.slice(1).map((l) => ({ ...l, parentId: "g" }))],
  };
  const stationary = changeArtboard(d, id, { x: 23, y: -9 });
  assert.deepEqual(stationary.layers, d.layers);
  const moved = changeArtboard(d, id, { x: 23, y: -9 }, true);
  near(moved.layers[2]!.transform.x, 33);
  near(moved.layers[2]!.transform.y, 1);
  assert.deepEqual(moved.layers[1]!.transform, group.transform);
  assert.deepEqual(moved.source, d.source);
});
test("locked artwork blocks the entire optional board/artwork move atomically", () => {
  const d = addArtboard(fixture()).document;
  d.layers[1]!.locked = true;
  const before = JSON.stringify(d);
  assert.throws(() => changeArtboard(d, d.artboards![0]!.id, { x: 30 }, true), /Unlock/);
  assert.equal(JSON.stringify(d), before);
});
test("physical presets convert inches/mm at document DPI; pixel presets are DPI independent", () => {
  assert.deepEqual(presetSize("A4", 300), { width: 2480, height: 3508 });
  assert.deepEqual(presetSize("A3", 96), { width: 1123, height: 1587 });
  assert.deepEqual(presetSize("Letter", 300), { width: 2550, height: 3300 });
  assert.deepEqual(presetSize("1920 × 1080", 600), { width: 1920, height: 1080 });
  assert.deepEqual(presetSize("Webtoon 800 × 4000", 96), { width: 800, height: 4000 });
  assert.throws(() => presetSize("A4", NaN));
  assert.throws(() => presetSize("invented", 96));
});
test("workspace union includes negative and off-canvas boards without moving artwork", () => {
  const d = addArtboard(fixture()).document;
  const n = changeArtboard(d, d.artboards![0]!.id, { x: -64, y: -32, width: 256, height: 96 });
  assert.deepEqual(workspaceFrame(n), { x: -64, y: -32, width: 256, height: 128 });
  assert.deepEqual(n.layers, d.layers);
});
test("artboard ranges are bounded, deduplicated and ordered; safe deterministic names retain Unicode", () => {
  let d = fixture();
  for (let i = 0; i < 4; i++) d = addArtboard(d).document;
  assert.deepEqual(
    artboardRange(d, "3-4,1,3").map((b) => b.id),
    [d.artboards![0]!.id, d.artboards![2]!.id, d.artboards![3]!.id],
  );
  for (const r of ["0", "4-2", "1-999999999", "../", "", "5"])
    assert.throws(() => artboardRange(d, r));
  assert.equal(artboardRange(d, "all").length, 4);
  const b = { ...d.artboards![0]!, name: "../第 1:頁<script>" };
  assert.equal(artboardFilename(b, 0, "png"), "01-第-1-頁-script.png");
});
test("new layout/artboards use native v3; legacy documents still emit v1 and receive non-mutating defaults", async () => {
  const d = addArtboard(fixture()).document;
  d.layout = {
    ...structuredClone(DEFAULT_LAYOUT),
    guides: [{ id: "guide", axis: "x", position: -12, locked: true }],
  };
  const blob = await nativeFile(session(d)),
    value = JSON.parse(await blob.text());
  assert.equal(value.version, 3);
  const reopened = await readNative(blob, "chapter", "original");
  assert.deepEqual(reopened.document, d);
  assert.equal(await reopened.assets.source!.text(), "retained original");
  const old = fixture(),
    legacy = await nativeFile(session(old));
  assert.equal(JSON.parse(await legacy.text()).version, 1);
  assert.equal(layout(old).spacing, 10);
  assert.equal(old.layout, undefined);
  assert.equal(old.artboards, undefined);
});
test("artboard edits and precision metadata are real immutable history transactions", () => {
  const d = fixture(),
    a = addArtboard(d);
  const b = changeArtboard(a.document, a.id, { width: 56, x: -21, name: "Panel" });
  let h = createHistory(d);
  h = record(h, a.document);
  h = record(h, b);
  h = undo(h);
  assert.deepEqual(h.present, a.document);
  h = undo(h);
  assert.deepEqual(h.present, d);
  h = redo(redo(h));
  assert.deepEqual(h.present, b);
});
test("artboard SVG uses exact world-space viewBox, safe background, curves and parent transforms", () => {
  let d: ProDocument = addArtboard(fixture()).document;
  d = changeArtboard(d, d.artboards![0]!.id, {
    x: -40,
    y: 20,
    width: 50,
    height: 30,
    background: "#123456",
  });
  const svg = vectorSvg(d, d.artboards![0]);
  assert.match(svg, /viewBox="-40 20 50 30"/);
  assert.match(svg, /overflow="hidden"/);
  assert.match(svg, /fill="#123456"/);
  assert.match(svg, /matrix\(1 0 0 1 10 10\)/);
  assert.match(vectorSvg(d), /viewBox="0 0 128 96"/);
});
test("invalid artboard/guide values and limits are rejected without touching sources", () => {
  const d = addArtboard(fixture()).document,
    id = d.artboards![0]!.id;
  for (const patch of [
    { width: 0 },
    { height: 2.5 },
    { x: NaN },
    { y: Infinity },
    { name: " " },
    { background: "url(https://evil)" },
    { width: 16384, height: 16384 },
  ])
    assert.throws(() => changeArtboard(d, id, patch));
  assert.throws(() => validateDocument({ ...d, artboards: [...d.artboards!, ...d.artboards!] }));
  const s = structuredClone(DEFAULT_LAYOUT);
  s.guides = [{ id: "g", axis: "x", position: Infinity, locked: false }];
  assert.throws(() => validateDocument({ ...d, layout: s }));
  for (const tolerance of [NaN, 0, 33])
    assert.throws(() => validateDocument({ ...d, layout: { ...s, guides: [], tolerance } }));
});

test("zoom-aware grid acquisition does not quantize positions outside screen tolerance", () => {
  const d = settings(fixture());
  d.layout!.modes.grid = true;
  const index = buildSnapIndex(d, ["a", "b", "c"]),
    f = { x: 12, y: 17, width: 0, height: 0 };
  assert.deepEqual(snapGeometry(d, index, f, 1, true).delta, { x: -2, y: 3 });
  assert.deepEqual(snapGeometry(d, index, f, 10, true).delta, { x: 0, y: 0 });
  assert.deepEqual(snapGeometry(d, index, { ...f, x: 10.5, y: 20.5 }, 10, true).delta, {
    x: -0.5,
    y: -0.5,
  });
});
test("object edge/center snapping excludes the entire selected forest and linked members", () => {
  const d = settings(fixture());
  d.layout!.modes.objects = true;
  const idx = buildSnapIndex(d, ["a"]);
  const n = snapGeometry(d, idx, { x: 39, y: 30, width: 20, height: 10 }, 4);
  assert.equal(n.delta.x, 1);
  assert.ok(n.guides.some((g) => g.kind === "object"));
  assert.ok(idx.x.every((c) => c.id !== "a"));
  d.layers[1]!.linkId = d.layers[2]!.linkId = "linked";
  assert.ok(buildSnapIndex(d, ["a"]).x.every((c) => c.id !== "a" && c.id !== "b"));
});
test("artboard and explicit guide snapping compete deterministically by distance then priority", () => {
  let d: ProDocument = addArtboard(settings(fixture())).document;
  d = changeArtboard(d, d.artboards![0]!.id, { x: 44, y: 11, width: 40, height: 40 });
  d.layout!.modes.artboards = d.layout!.modes.guides = true;
  d.layout!.guides = [{ id: "g", axis: "x", position: 46, locked: true }];
  const result = snapGeometry(d, buildSnapIndex(d), { x: 45, y: 11, width: 0, height: 0 }, 1, true);
  assert.equal(result.delta.x, 1);
  assert.equal(result.guides.find((g) => g.axis === "x")!.kind, "guide");
  assert.equal(result.delta.y, 0);
});
test("anchor/end-point snapping uses transformed native contours and a circular screen radius", () => {
  const d = settings(fixture()),
    p = d.layers[2]!;
  p.shape = "path";
  p.anchors = [
    { x: 0, y: 0 },
    { x: 20, y: 10 },
  ];
  p.closed = false;
  p.transform.rotation = 90;
  d.layout!.modes.anchors = true;
  const idx = buildSnapIndex(d, ["a"]);
  assert.deepEqual(snapGeometry(d, idx, { x: 61, y: 31, width: 0, height: 0 }, 2, true).delta, {
    x: -1,
    y: -1,
  });
  assert.deepEqual(snapGeometry(d, idx, { x: 63, y: 33, width: 0, height: 0 }, 2, true).delta, {
    x: 0,
    y: 0,
  });
});
test("snapping toggles and Smart Guides are independent; invalid coordinates cannot produce NaN", () => {
  const d = settings(fixture());
  d.layout!.modes.grid = true;
  d.layout!.smart = false;
  const idx = buildSnapIndex(d),
    f = { x: 11, y: 12, width: 0, height: 0 };
  assert.deepEqual(snapGeometry(d, idx, f, 1, true).guides, []);
  assert.equal(snapGeometry(d, idx, f, 1, true).delta.x, -1);
  d.layout!.snapping = false;
  assert.deepEqual(snapGeometry(d, idx, f, 1, true).delta, { x: 0, y: 0 });
  d.layout!.snapping = true;
  assert.throws(() => snapGeometry(d, idx, f, 0));
  assert.throws(() => snapGeometry(d, idx, { ...f, x: NaN }, 1));
});
test("equal-gap smart target acquires only the moving frame center between adjacent peers", () => {
  const d = settings(fixture());
  d.layers = [
    d.layers[1]!,
    { ...d.layers[2]!, transform: { ...d.layers[2]!.transform, x: 90, y: 10 } },
  ];
  d.layout!.modes.objects = true;
  const n = snapGeometry(d, buildSnapIndex(d), { x: 49, y: 10, width: 20, height: 10 }, 4);
  assert.equal(n.delta.x, 1);
  assert.ok(n.guides.some((g) => g.kind === "equal spacing"));
});
test("exact affine cubic extrema and rotated frame bounds drive alignment", () => {
  const l = layer("shape", 100, 100);
  l.shape = "path";
  l.vectorOverflow = true;
  l.anchors = [
    { x: 0, y: 0, outgoing: { x: 0, y: 100 } },
    { x: 100, y: 0, incoming: { x: 100, y: 100 } },
  ];
  const box = layerBounds(l);
  near(box.height, 75);
  near(box.width, 100);
  l.transform.rotation = 90;
  const rotated = layerBounds(l);
  near(rotated.x, -75);
  near(rotated.height, 100);
  const d = fixture();
  d.layers[1]!.transform.rotation = 45;
  const n = alignObjects(d, ["a", "b"], "left", "selection");
  near(objectBounds(n, "a")!.x, objectBounds(n, "b")!.x);
});
for (const [operation, axis, ratio] of [
  ["left", "x", 0],
  ["center-x", "x", 0.5],
  ["right", "x", 1],
  ["top", "y", 0],
  ["center-y", "y", 0.5],
  ["bottom", "y", 1],
] as const)
  test(`${operation} changes real geometry relative to selected union and preserves sources`, () => {
    const d = fixture(),
      snapshot = JSON.stringify(d),
      n = alignObjects(d, ["a", "b", "c"], operation, "selection"),
      boxes = ["a", "b", "c"].map((id) => objectBounds(n, id)!);
    const size = axis === "x" ? "width" : "height";
    for (const b of boxes)
      near(b[axis] + ratio * b[size], boxes[0]![axis] + ratio * boxes[0]![size]);
    assert.equal(JSON.stringify(d), snapshot);
    assert.deepEqual(n.source, d.source);
  });
test("alignment supports key object and negative artboard coordinates", () => {
  const d = fixture(),
    n = alignObjects(d, ["a", "b"], "center-y", "key", undefined, "b");
  assert.deepEqual(n.layers[2], d.layers[2]);
  near(objectBounds(n, "a")!.y, 30);
  const a = addArtboard(d),
    b = changeArtboard(a.document, a.id, { x: -20, y: -40, width: 80, height: 60 });
  const aligned = alignObjects(b, ["a"], "right", "artboard", a.id);
  near(objectBounds(aligned, "a")!.x, 40);
});
test("distribution equalizes centers; equal spacing equalizes actual gaps for unequal sizes", () => {
  const d = fixture();
  d.layers[2]!.width = 30;
  const n = alignObjects(d, ["a", "b", "c"], "distribute-x", "selection"),
    boxes = ["a", "b", "c"].map((id) => objectBounds(n, id)!);
  near(boxes[1]!.x + 15, (boxes[0]!.x + 10 + (boxes[2]!.x + 10)) / 2);
  const spaced = alignObjects(d, ["a", "b", "c"], "space-x", "selection"),
    [a, b, c] = ["a", "b", "c"].map((id) => objectBounds(spaced, id)!);
  near(b!.x - a!.x - a!.width, c!.x - b!.x - b!.width);
  assert.deepEqual(spaced.layers[1], d.layers[1]);
  assert.deepEqual(spaced.layers[3], d.layers[3]);
});
test("alignment guards coupled links, missing boards, locked members and insufficient distribution atomically", () => {
  const d = fixture();
  d.layers[1]!.linkId = d.layers[2]!.linkId = "coupled";
  const before = JSON.stringify(d);
  assert.throws(() => alignObjects(d, ["a", "b"], "left", "selection"), /Unlink/);
  assert.throws(() => alignObjects(d, ["a"], "left", "artboard", "missing"));
  assert.throws(() => alignObjects(d, ["a", "b"], "distribute-x", "selection"));
  assert.equal(JSON.stringify(d), before);
});

test("moving a partially contained clipping stack fails without detaching its base", () => {
  const d = addArtboard(fixture()).document;
  d.artboards![0]!.width = 40;
  d.layers[2]!.clipped = true;
  const before = JSON.stringify(d);
  assert.throws(() => changeArtboard(d, d.artboards![0]!.id, { x: 15 }, true), /clipping stack/);
  assert.equal(JSON.stringify(d), before);
});
test("board count and guide count budgets reject oversized native layouts", () => {
  let d: ProDocument = fixture();
  for (let i = 0; i < 32; i++) d = addArtboard(d).document;
  assert.equal(d.artboards!.length, 32);
  assert.throws(() => addArtboard(d), /32 artboards/);
  const s = structuredClone(DEFAULT_LAYOUT);
  s.guides = Array.from({ length: 129 }, (_, i) => ({
    id: String(i),
    axis: "x",
    position: i,
    locked: false,
  }));
  assert.throws(() => validateDocument({ ...d, layout: s }));
});
test("selected nested group bounds and links are cached as one moving forest", () => {
  const d = fixture(),
    g = layer("group", 128, 96, "g");
  d.layers[1]!.parentId = "g";
  d.layers[2]!.parentId = "g";
  d.layers.push(g);
  d.layers[1]!.linkId = d.layers[3]!.linkId = "linked";
  assert.ok(buildSnapIndex(d, ["g"]).x.every((c) => !["a", "b", "c"].includes(c.id)));
  assert.throws(
    () => changeArtboard(addArtboard(d).document, "missing", { x: 2 }),
    /existing artboard/,
  );
});
test("vertical center distribution and gap distribution retain endpoint geometry", () => {
  const d = fixture();
  d.layers[2]!.height = 20;
  const n = alignObjects(d, ["a", "b", "c"], "space-y", "selection");
  const [a, b, c] = ["a", "b", "c"].map((id) => objectBounds(n, id)!);
  near(b!.y - a!.y - a!.height, c!.y - b!.y - b!.height);
  const m = alignObjects(d, ["a", "b", "c"], "distribute-y", "selection");
  near(objectBounds(m, "b")!.y + 10, (15 + 55) / 2);
});
test("masked and clipped layer geometry is preserved by alignment and native reopen", async () => {
  const d = fixture();
  d.layers[1]!.mask = {
    enabled: true,
    strokes: [],
    selection: {
      inverted: false,
      feather: 1,
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
    },
  };
  d.layers[2]!.clipped = true;
  const n = alignObjects(d, ["a", "b"], "top", "selection");
  assert.deepEqual(n.layers[1]!.mask, d.layers[1]!.mask);
  assert.equal(n.layers[2]!.clipped, true);
  const reopened = await readNative(await nativeFile(session(n)), "chapter", "original");
  assert.deepEqual(reopened.document.layers, n.layers);
});

test("resize snapping preserves an off-center finger grab and lands the actual corner", () => {
  const d = settings(fixture());
  d.layout!.modes.grid = true;
  const base = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    start = { x: 25, y: 15 };
  const positionAt = (p: { x: number; y: number }) =>
    worldPoint({ x: 20, y: 10 }, { transform: dragTransform(base, 20, 10, "se", start, p) });
  const n = snapHandle(d, buildSnapIndex(d), { x: 34, y: 24 }, 1, positionAt);
  near(positionAt(n.pointer).x, 30);
  near(positionAt(n.pointer).y, 20);
});
test("rotated edge snapping solves its constrained world response", () => {
  const d = settings(fixture());
  d.layout!.modes.guides = true;
  const base = { x: 20, y: 20, scaleX: 1, scaleY: 1, rotation: 45 },
    start = { x: 33, y: 40 },
    p = { x: 40, y: 44 };
  const positionAt = (p: { x: number; y: number }) =>
    worldPoint({ x: 20, y: 5 }, { transform: dragTransform(base, 20, 10, "e", start, p) });
  const target = positionAt(p).x + 0.8;
  d.layout!.guides = [{ id: "target", axis: "x", position: target, locked: false }];
  const result = snapHandle(d, buildSnapIndex(d), p, 4, positionAt);
  near(positionAt(result.pointer).x, target);
  assert.equal(result.guides.length, 1);
});
test("aspect-locked corner snapping retains aspect and only reports feasible guide axes", () => {
  const d = settings(fixture());
  d.layout!.modes.guides = true;
  d.layout!.guides = [{ id: "target", axis: "x", position: 40, locked: false }];
  const base = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    start = { x: 20, y: 10 };
  const positionAt = (p: { x: number; y: number }) =>
    worldPoint({ x: 20, y: 10 }, { transform: dragTransform(base, 20, 10, "se", start, p, true) });
  const result = snapHandle(d, buildSnapIndex(d), { x: 39, y: 19.5 }, 2, positionAt),
    point = positionAt(result.pointer);
  near(point.x, 40);
  near(point.y, 20);
  assert.ok(result.guides.every((g) => Math.abs(point[g.axis] - g.position) < 1e-5));
});
test("unsnapped handles retain subpixel coordinates", () => {
  const d = settings(fixture()),
    pointer = { x: 31.25, y: 42.125 };
  const result = snapHandle(d, buildSnapIndex(d), pointer, 12, (p) => p);
  assert.deepEqual(result.pointer, pointer);
  assert.deepEqual(result.guides, []);
});

test("degenerate horizontal/vertical lines retain zero geometric extents for exact alignment", () => {
  const l = layer("shape", 100, 100);
  l.shape = "path";
  l.anchors = [
    { x: 0, y: 20 },
    { x: 100, y: 20 },
  ];
  assert.equal(layerBounds(l).height, 0);
  l.anchors = [
    { x: 40, y: 0 },
    { x: 40, y: 100 },
  ];
  assert.equal(layerBounds(l).width, 0);
});
test("adding artboards opts legacy documents into precision without mutating the source", () => {
  const d = fixture();
  assert.equal(d.layout, undefined);
  const a = addArtboard(d);
  assert.deepEqual(a.document.layout, DEFAULT_LAYOUT);
  assert.equal(d.layout, undefined);
  assert.notEqual(a.document.layout!.guides, DEFAULT_LAYOUT.guides);
});
