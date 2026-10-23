import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketStroke, coveragePoints, hasActiveSelection, intersectRegion } from "./fill.ts";
import { selectColor } from "./selection.ts";
import {
  layer,
  toLocalSelection,
  validateDocument,
  type ProDocument,
  type Region,
} from "./model.ts";

/** Expand row-bounded runs back into a coverage plane. */
function plane(region: Region) {
  const p = region.pixels!,
    out = new Uint8Array(p.width * p.height);
  for (let i = 0; i < p.runs.length; i += 3)
    out.fill(p.runs[i + 2]!, p.runs[i]!, p.runs[i]! + p.runs[i + 1]!);
  return out;
}

test("square dabs cover every pixel of layers up to the 16384px limit", () => {
  for (const [w, h] of [
    [1, 1],
    [7, 3],
    [800, 600],
    [1000, 1000],
    [1001, 40],
    [16384, 300],
    [4096, 4096],
    [16384, 16384],
  ] as const) {
    const { tip, points } = coveragePoints(w, h);
    assert.ok(tip >= 1 && tip <= 1000, "tip within the stroke schema");
    assert.ok(points.length <= 10000, "within the stroke point budget");
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      assert.equal(Math.hypot(b.x - a.x, b.y - a.y), tip, "serpentine neighbours are adjacent");
    }
    // Sample a grid including every edge pixel centre.
    const xs = [0.5, w / 2, w - 0.5],
      ys = [0.5, h / 2, h - 0.5];
    for (let x = tip / 2; x < w; x += tip) xs.push(Math.min(w - 0.5, x + tip / 2 - 0.5));
    for (let y = tip / 2; y < h; y += tip) ys.push(Math.min(h - 0.5, y + tip / 2 - 0.5));
    for (const x of xs)
      for (const y of ys)
        assert.ok(
          points.some((p) => Math.abs(p.x - x) <= tip / 2 && Math.abs(p.y - y) <= tip / 2),
          `${w}×${h}: pixel ${x},${y} covered`,
        );
  }
  assert.throws(() => coveragePoints(0, 10));
});

test("a fill stroke is a valid editable paint stroke in the document model", () => {
  const w = 120,
    h = 80,
    pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4,
        inside = x >= 20 && x < 60 && y >= 10 && y < 50;
      pixels[i] = inside ? 255 : 0;
      pixels[i + 3] = 255;
    }
  const region = selectColor(
    pixels,
    w,
    h,
    { x: 30, y: 30 },
    {
      tolerance: 10,
      contiguous: true,
      antiAlias: false,
    },
  );
  const paint = layer("paint", w, h, "paint");
  const clip = toLocalSelection({ regions: [region], inverted: false, feather: 0 }, paint, {
    width: w,
    height: h,
  });
  const stroke = bucketStroke(paint, clip, "#336699", 0.75);
  assert.equal(stroke.tip, "square");
  assert.equal(stroke.hardness, 1);
  assert.equal(stroke.opacity, 0.75);
  const doc: ProDocument = {
    version: 1,
    id: "d",
    name: "Fill",
    panelId: "p",
    width: w,
    height: h,
    background: "transparent",
    layers: [{ ...paint, strokes: [stroke] }],
  };
  validateDocument(doc);
  // Coverage is exactly the flooded rectangle.
  const covered = plane(region);
  let count = 0;
  for (let i = 0; i < covered.length; i++) if (covered[i]) count++;
  assert.equal(count, 40 * 40);
});

test("an active selection limits the fill and keeps partial coverage", () => {
  const region: Region = {
    kind: "pixels",
    operation: "add",
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 2 },
    ],
    pixels: { width: 4, height: 2, runs: [0, 4, 255, 4, 4, 200] },
  };
  const all = new Uint8Array(8).fill(255);
  assert.deepEqual(intersectRegion(region, all).pixels!.runs, [0, 4, 255, 4, 4, 200]);
  assert.deepEqual(intersectRegion(region, new Uint8Array(8)).pixels!.runs, []);
  // Left half selected, right half half-selected (feathered edge).
  const half = Uint8Array.from([255, 255, 128, 128, 255, 255, 128, 128]);
  assert.deepEqual(
    intersectRegion(region, half).pixels!.runs,
    [0, 2, 255, 2, 2, 128, 4, 2, 200, 6, 2, 100],
  );
  assert.throws(() => intersectRegion(region, new Uint8Array(3)), /does not match/);
  const intersected = intersectRegion(region, half);
  validateDocument({
    version: 1,
    id: "d",
    name: "Fill",
    panelId: "p",
    width: 4,
    height: 2,
    background: "transparent",
    layers: [
      {
        ...layer("paint", 4, 2, "p"),
        strokes: [
          bucketStroke(
            { width: 4, height: 2 },
            { regions: [intersected], inverted: false, feather: 0 },
            "#000000",
          ),
        ],
      },
    ],
  });
});

test("runs never merge across rows", () => {
  const region: Region = {
    kind: "pixels",
    operation: "add",
    points: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ],
    pixels: { width: 2, height: 2, runs: [0, 2, 255, 2, 2, 255] },
  };
  assert.deepEqual(
    intersectRegion(region, new Uint8Array(4).fill(255)).pixels!.runs,
    [0, 2, 255, 2, 2, 255],
  );
});

test("selection activity detection", () => {
  assert.equal(hasActiveSelection(undefined), false);
  assert.equal(hasActiveSelection({ regions: [], inverted: false, feather: 0 }), false);
  assert.equal(hasActiveSelection({ regions: [], inverted: true, feather: 0 }), true);
});
