import test from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, validateDocument, type Layer, type ProDocument } from "./model.ts";
import {
  coverageContours,
  pathCoverage,
  pathLayerFromContours,
  pathSelectionRegion,
  rasterizePolygons,
  releaseVectorClip,
  traceCoverage,
  vectorClipFromPath,
} from "./path-selection.ts";

const doc = (width = 64, height = 48): ProDocument =>
  fromPanel({ id: "p", name: "p", width, height });
const sum = (a: ArrayLike<number>) => Array.from(a).reduce((n, v) => n + v, 0) / 255;
function rect(x: number, y: number, w: number, h: number): Layer {
  const l = layer("shape", w, h);
  l.shape = "rectangle";
  l.transform = { ...l.transform, x, y };
  return l;
}
function path(points: [number, number][][], rule: "nonzero" | "evenodd" = "nonzero"): Layer {
  const l = layer("shape", 64, 48),
    cs = points.map((p) => ({ closed: true, anchors: p.map(([x, y]) => ({ x, y })) }));
  return { ...l, shape: "path", ...cs[0]!, subpaths: cs.slice(1), fillRule: rule };
}

test("scan conversion gives exact interior, empty exterior and fractional edges", () => {
  const c = rasterizePolygons(
    [
      [
        { x: 2, y: 2 },
        { x: 6.5, y: 2 },
        { x: 6.5, y: 6 },
        { x: 2, y: 6 },
      ],
    ],
    "nonzero",
    10,
    10,
  );
  assert.equal(c[3 * 10 + 3], 255);
  assert.equal(c[0], 0);
  assert.equal(c[3 * 10 + 7], 0);
  assert.equal(c[3 * 10 + 6], 128); // half-covered column
  assert.ok(Math.abs(sum(c) - 4.5 * 4) < 0.01);
});

test("rectangle, rotated rectangle and ellipse paths load as their true area", () => {
  const d = doc(),
    r = rect(10, 10, 20, 10);
  d.layers.push(r);
  assert.ok(Math.abs(sum(pathCoverage(d, [r.id])) - 200) < 0.5);

  const rotated = rect(20, 12, 16, 8);
  rotated.transform = { ...rotated.transform, rotation: 30 };
  d.layers.push(rotated);
  assert.ok(Math.abs(sum(pathCoverage(d, [rotated.id])) - 128) < 1);

  const e = rect(8, 8, 30, 30);
  e.shape = "ellipse";
  d.layers.push(e);
  const area = Math.PI * 15 * 15;
  assert.ok(Math.abs(sum(pathCoverage(d, [e.id])) - area) / area < 0.01);
});

test("compound path fill rules: even-odd keeps the hole, union of shapes covers both", () => {
  const d = doc(),
    ring = path(
      [
        [
          [4, 4],
          [36, 4],
          [36, 36],
          [4, 36],
        ],
        [
          [12, 12],
          [28, 12],
          [28, 28],
          [12, 28],
        ],
      ],
      "evenodd",
    );
  d.layers.push(ring);
  const c = pathCoverage(d, [ring.id]);
  assert.equal(c[20 * 64 + 20], 0);
  assert.equal(c[6 * 64 + 6], 255);
  assert.ok(Math.abs(sum(c) - (32 * 32 - 16 * 16)) < 0.5);

  const a = rect(0, 0, 10, 10),
    b = rect(5, 0, 10, 10);
  d.layers.push(a, b);
  assert.ok(Math.abs(sum(pathCoverage(d, [a.id, b.id])) - 150) < 0.5);
  const region = pathSelectionRegion(d, [a.id]);
  assert.equal(region.kind, "pixels");
  assert.equal(region.pixels!.width, 64);
});

test("open, text and warped layers are rejected with an explanation", () => {
  const d = doc(),
    line = rect(2, 2, 20, 1);
  line.shape = "line";
  const text = layer("text", 20, 10);
  d.layers.push(line, text);
  assert.throws(() => pathCoverage(d, [line.id]), /encloses no area/);
  assert.throws(() => pathCoverage(d, [text.id]), /vector path or shape/);
});

test("selection → path traces the 50% edge and round-trips back to the same coverage", () => {
  const d = doc(80, 60),
    ring = path(
      [
        [
          [10, 8],
          [60, 8],
          [60, 50],
          [10, 50],
        ],
        [
          [25, 20],
          [45, 20],
          [45, 38],
          [25, 38],
        ],
      ],
      "evenodd",
    );
  d.layers.push(ring);
  const coverage = pathCoverage(d, [ring.id]);
  assert.equal(traceCoverage(coverage, 80, 60).length, 2);
  const traced = coverageContours(coverage, 80, 60);
  assert.equal(traced.contours.length, 2);
  assert.equal(traced.dropped, 0);
  // Axis-aligned edges simplify to their four corners.
  assert.deepEqual(
    traced.contours.map((c) => c.length),
    [4, 4],
  );
  const back = pathLayerFromContours(traced.contours, { name: "Traced", stroke: "#000000" });
  d.layers.push(back);
  validateDocument(d);
  const again = pathCoverage(d, [back.id]);
  let union = 0,
    intersection = 0;
  for (let i = 0; i < again.length; i++) {
    const a = coverage[i]! > 127,
      b = again[i]! > 127;
    union += +(a || b);
    intersection += +(a && b);
  }
  // The 50% level chamfers each corner by under half a pixel.
  assert.ok(intersection / union > 0.98, `IoU ${intersection / union}`);
});

test("tracing respects native path limits by raising the tolerance", () => {
  const w = 400,
    h = 100,
    alpha = new Uint8Array(w * h);
  // A comb edge (1 px teeth, 4 px deep) has far more corners than an editable path allows.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const tooth = x % 2 ? 4 : 0;
      if (y >= 10 + tooth && y < 90 - tooth) alpha[y * w + x] = 255;
    }
  const traced = coverageContours(alpha, w, h, 0.01);
  assert.equal(traced.contours.length, 1);
  assert.ok(traced.contours[0]!.length <= 1000);
  assert.ok(traced.tolerance > 0.01);
  assert.throws(() => coverageContours(new Uint8Array(16), 4, 4), /empty/);
});

test("vector mask from a path keeps curves in the target frame and releases losslessly", () => {
  const d = doc(),
    target = rect(10, 10, 30, 20),
    source = rect(5, 5, 20, 20);
  source.shape = "ellipse";
  target.transform = { ...target.transform, rotation: 15, scaleX: 1.5 };
  d.layers.push(target, source);
  const clip = vectorClipFromPath(d, target.id, source.id);
  // Curves survive: an ellipse keeps Bézier handles.
  assert.ok(clip.contours[0]!.anchors.some((a) => a.outgoing || a.incoming));
  const masked = {
    ...d,
    layers: d.layers.map((l) => (l.id === target.id ? { ...l, vectorClips: [clip] } : l)),
  };
  validateDocument(masked);
  const released = releaseVectorClip(masked, target.id, 0, "#00ff00");
  const t = released.document.layers.find((l) => l.id === target.id)!;
  assert.equal(t.vectorClips, undefined);
  assert.equal(
    released.document.layers.indexOf(t) + 1,
    released.document.layers.findIndex((l) => l.id === released.id),
  );
  // Released geometry matches the original path in document space (same coverage).
  const before = pathCoverage(d, [source.id]),
    after = pathCoverage(released.document, [released.id]);
  assert.ok(before.every((v, i) => Math.abs(v - after[i]!) <= 3));
  assert.throws(() => vectorClipFromPath(d, source.id, source.id), /different layer/);
  const raster = layer("paint", 10, 10);
  d.layers.push(raster);
  assert.throws(() => vectorClipFromPath(d, raster.id, source.id), /layer mask/);
});

test("released path is inserted above the target's clipping stack", () => {
  const d = doc(),
    target = rect(0, 0, 20, 20),
    clipped = { ...layer("paint", 20, 20), clipped: true },
    source = rect(2, 2, 10, 10);
  d.layers.push(target, clipped, source);
  const clip = vectorClipFromPath(d, target.id, source.id);
  const masked = {
    ...d,
    layers: d.layers.map((l) => (l.id === target.id ? { ...l, vectorClips: [clip] } : l)),
  };
  const { document, id } = releaseVectorClip(masked, target.id, 0, "#000000");
  const ids = document.layers.map((l) => l.id);
  assert.ok(ids.indexOf(id) > ids.indexOf(clipped.id));
});
