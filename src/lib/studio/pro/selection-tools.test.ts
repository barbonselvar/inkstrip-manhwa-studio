import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LASSO_POINT_LIMIT,
  alphaRegion,
  appendLassoPoint,
  colorDistanceTo,
  colorRangeCoverage,
  colorRangeRegion,
  combineSelection,
  marqueeCorners,
  modifySelection,
  oklab,
} from "./selection-tools.ts";
import { selectColor } from "./selection.ts";
import { validateSelection, type Region, type Selection } from "./model.ts";

const rect = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  operation: Region["operation"] = "add",
): Region => ({
  kind: "rectangle",
  operation,
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ],
});
const image = (
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number],
) => {
  const p = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.set(fill(x, y), (y * w + x) * 4);
  return p;
};
const mask = (w: number, h: number, on: (x: number, y: number) => boolean) => {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) m[y * w + x] = 255;
  return m;
};
const at = (m: Uint8Array, w: number, x: number, y: number) => m[y * w + x]!;
const decode = (r: Region) => {
  const { width, height, runs } = r.pixels!,
    out = new Uint8Array(width * height);
  for (let i = 0; i < runs.length; i += 3)
    out.fill(runs[i + 2]!, runs[i]!, runs[i]! + runs[i + 1]!);
  return out;
};

test("replace mode starts a new selection; add/subtract/intersect respect a global invert", () => {
  const base: Selection = { regions: [rect(0, 0, 10, 10)], inverted: true, feather: 4 };
  const replaced = combineSelection(base, rect(5, 5, 20, 20, "subtract"), "replace");
  assert.deepEqual(replaced, { regions: [rect(5, 5, 20, 20)], inverted: false, feather: 4 });
  // After an invert, "add" must enlarge what is selected: it becomes a subtract of the hole.
  const added = combineSelection(base, rect(20, 20, 30, 30), "add");
  assert.equal(added.inverted, true);
  assert.equal(added.regions.at(-1)!.operation, "subtract");
  assert.doesNotThrow(() => validateSelection(replaced));
  assert.doesNotThrow(() => validateSelection(added));
});

test("marquee constraints: fixed ratio, Shift square/circle and Alt from centre in every direction", () => {
  assert.deepEqual(marqueeCorners({ x: 10, y: 10 }, { x: 40, y: 20 }), [
    { x: 10, y: 10 },
    { x: 40, y: 20 },
  ]);
  const [a, b] = marqueeCorners({ x: 10, y: 10 }, { x: 40, y: 20 }, { square: true });
  assert.deepEqual([b.x - a.x, b.y - a.y], [30, 30]);
  const [c, d] = marqueeCorners({ x: 50, y: 50 }, { x: 40, y: 10 }, { ratio: 16 / 9 });
  assert.ok(d.x < c.x && d.y < c.y, "follows the drag direction");
  assert.ok(Math.abs((c.x - d.x) / (c.y - d.y) - 16 / 9) < 1e-9);
  assert.ok(Math.abs(c.y - d.y - 40) < 1e-9, "grows to the larger extent");
  const [e, f] = marqueeCorners(
    { x: 100, y: 100 },
    { x: 110, y: 130 },
    { center: true, square: true },
  );
  assert.deepEqual(
    [e, f],
    [
      { x: 70, y: 70 },
      { x: 130, y: 130 },
    ],
  );
  // A zero-size drag stays a degenerate (empty) marquee rather than NaN.
  assert.ok(
    marqueeCorners({ x: 1, y: 1 }, { x: 1, y: 1 }, { ratio: 2 }).every((p) => Number.isFinite(p.x)),
  );
});

test("freehand lasso recording is spaced and capped so it always validates", () => {
  let points = [{ x: 0, y: 0 }],
    full = false;
  for (let i = 1; i < 20_000 && !full; i++)
    ({ points, full } = appendLassoPoint(points, { x: i * 0.3, y: Math.sin(i / 50) * 40 }, 1));
  assert.equal(full, true);
  assert.equal(points.length, LASSO_POINT_LIMIT);
  for (let i = 1; i < points.length; i++)
    assert.ok(Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y) >= 1);
  const lasso: Region = { kind: "lasso", operation: "add", points };
  assert.doesNotThrow(() => validateSelection({ regions: [lasso], inverted: false, feather: 0 }));
  assert.deepEqual(appendLassoPoint(points, { x: 1e6, y: 0 }, 1), { points, full: true });
  assert.equal(appendLassoPoint([{ x: 0, y: 0 }], { x: 0.4, y: 0 }, 1).points.length, 1);
});

test("perceptual distance is OKLab-based on a 0..255 scale and alpha-aware", () => {
  const [l0] = oklab(0, 0, 0),
    [l1] = oklab(255, 255, 255);
  assert.ok(Math.abs(l0) < 1e-6 && Math.abs(l1 - 1) < 1e-4);
  const px = Uint8ClampedArray.from([255, 255, 255, 255, 10, 20, 30, 0]);
  assert.ok(Math.abs(colorDistanceTo(px, 0, [0, 0, 0, 255], "perceptual") - 255) < 0.1);
  // Transparent pixels never match an opaque sample, whatever their hidden RGB.
  assert.equal(colorDistanceTo(px, 4, [10, 20, 30, 255], "perceptual"), 255);
  assert.equal(colorDistanceTo(px, 4, [10, 20, 30, 255], "rgb"), 255);
  // A dark step that RGB scores as "small" is perceptually distinct, and vice versa for
  // a bright step: the metrics genuinely differ.
  const dark = Uint8ClampedArray.from([0, 0, 0, 255]),
    bright = Uint8ClampedArray.from([235, 235, 235, 255]);
  const darkRgb = colorDistanceTo(dark, 0, [20, 20, 20, 255], "rgb"),
    darkLab = colorDistanceTo(dark, 0, [20, 20, 20, 255], "perceptual"),
    brightRgb = colorDistanceTo(bright, 0, [255, 255, 255, 255], "rgb"),
    brightLab = colorDistanceTo(bright, 0, [255, 255, 255, 255], "perceptual");
  assert.equal(darkRgb, brightRgb);
  assert.ok(darkLab > brightLab * 2, `${darkLab} vs ${brightLab}`);
});

test("wand perceptual mode selects by visual difference; default RGB behaviour is unchanged", () => {
  // x 0..3: 0/8/16/24 grey · x 4: red wall · x 5..8: 255/247/239/231 grey.
  const px = image(9, 1, (x) =>
    x < 4
      ? [x * 8, x * 8, x * 8, 255]
      : x === 4
        ? [128, 0, 0, 255]
        : [295 - x * 8, 295 - x * 8, 295 - x * 8, 255],
  );
  const count = (x: number, metric?: "rgb" | "perceptual") =>
    decode(
      selectColor(
        px,
        9,
        1,
        { x, y: 0 },
        { tolerance: 20, contiguous: true, antiAlias: false, ...(metric ? { metric } : {}) },
      ),
    ).filter(Boolean).length;
  assert.equal(count(0), count(0, "rgb"), "omitting metric keeps RGB");
  assert.equal(count(0, "rgb"), 3);
  assert.equal(count(5, "rgb"), 3);
  // Perceptually, dark steps are large and bright steps small.
  assert.equal(count(0, "perceptual"), 1);
  assert.equal(count(5, "perceptual"), 4);
  assert.throws(
    () =>
      selectColor(
        px,
        9,
        1,
        { x: 0, y: 0 },
        { tolerance: 20, contiguous: true, antiAlias: false, metric: "lab" as never },
      ),
    /metric/,
  );
});

test("Color Range: multiple samples, linear fuzziness, exclusions; transparent pixels excluded", () => {
  const px = image(
    6,
    1,
    (x) =>
      [
        [255, 0, 0, 255],
        [235, 0, 0, 255],
        [215, 0, 0, 255],
        [0, 0, 255, 255],
        [0, 0, 250, 255],
        [255, 0, 0, 0],
      ][x] as [number, number, number, number],
  );
  const hard = colorRangeCoverage(px, 6, 1, {
    include: [[255, 0, 0]],
    tolerance: 20,
    fuzziness: 0,
  });
  assert.deepEqual([...hard], [255, 255, 0, 0, 0, 0]);
  const soft = colorRangeCoverage(px, 6, 1, {
    include: [[255, 0, 0]],
    tolerance: 20,
    fuzziness: 40,
  });
  assert.equal(soft[2], 128, "40 away at tolerance 20 + fuzz 40 → halfway");
  const both = colorRangeCoverage(px, 6, 1, {
    include: [
      [255, 0, 0],
      [0, 0, 255],
    ],
    tolerance: 10,
    fuzziness: 0,
  });
  assert.deepEqual([...both], [255, 0, 0, 255, 255, 0]);
  const minus = colorRangeCoverage(px, 6, 1, {
    include: [
      [255, 0, 0],
      [0, 0, 255],
    ],
    exclude: [[0, 0, 250]],
    tolerance: 10,
    fuzziness: 0,
  });
  assert.deepEqual([...minus], [255, 0, 0, 0, 0, 0], "exclusion removes the nearby blues");
  assert.equal(
    colorRangeCoverage(px, 6, 1, { include: [[255, 0, 0]], tolerance: 255, fuzziness: 0 })[5],
    255,
    "maximum tolerance also admits transparent pixels (distance 255)",
  );
  const region = colorRangeRegion(px, 6, 1, {
    include: [[255, 0, 0]],
    tolerance: 20,
    fuzziness: 40,
  });
  assert.deepEqual([...decode(region)], [...soft]);
  assert.doesNotThrow(() => validateSelection({ regions: [region], inverted: false, feather: 0 }));
  for (const bad of [
    { include: [], tolerance: 1, fuzziness: 0 },
    { include: [[1, 2, 3]], tolerance: 300, fuzziness: 0 },
    { include: [[1, 2, 3]], tolerance: 1, fuzziness: -1 },
    { include: [[1, 2, 3.5]], tolerance: 1, fuzziness: 0 },
    { include: Array(17).fill([1, 2, 3]), tolerance: 1, fuzziness: 0 },
  ])
    assert.throws(() => colorRangeCoverage(px, 6, 1, bad as never), /Color Range/);
});

test("alpha coverage converts exactly, including partial alpha", () => {
  const px = image(4, 2, (x, y) => [0, 0, 0, [0, 64, 128, 255][x]! * (y ? 0 : 1)]);
  assert.deepEqual([...decode(alphaRegion(px, 4, 2))], [0, 64, 128, 255, 0, 0, 0, 0]);
  assert.throws(() => alphaRegion(px, 5, 2), /Invalid/);
});

test("expand, contract, border and smooth are real mask operations with edge handling", async () => {
  const w = 20,
    h = 12,
    box = mask(w, h, (x, y) => x >= 6 && x < 12 && y >= 4 && y < 8);
  const grown = await modifySelection(box, w, h, "expand", 2);
  assert.equal(at(grown, w, 4, 2), 255);
  assert.equal(at(grown, w, 3, 2), 0);
  assert.equal(at(grown, w, 13, 9), 255);
  const shrunk = await modifySelection(box, w, h, "contract", 1);
  assert.equal(at(shrunk, w, 7, 5), 255);
  assert.equal(at(shrunk, w, 6, 4), 0);
  const gone = await modifySelection(box, w, h, "contract", 3);
  assert.equal(
    gone.reduce((a, b) => a + b, 0),
    0,
    "contracting past half-height empties a narrow selection",
  );
  const border = await modifySelection(box, w, h, "border", 2);
  assert.equal(at(border, w, 6, 4), 255, "band on the old edge");
  assert.equal(at(border, w, 5, 4), 255);
  assert.equal(at(border, w, 8, 5), 0, "interior is not part of the border");
  assert.equal(at(border, w, 2, 2), 0);
  // Edge-touching selections stay attached to the canvas edge when contracted.
  const edge = mask(w, h, (x) => x < 5);
  assert.equal(at(await modifySelection(edge, w, h, "contract", 2), w, 0, 6), 255);
  // Smooth removes a 1-pixel speck and keeps the large shape.
  const speck = mask(
    w,
    h,
    (x, y) => (x >= 2 && x < 14 && y >= 1 && y < 11) || (x === 18 && y === 6),
  );
  const smooth = await modifySelection(speck, w, h, "smooth", 2);
  assert.equal(at(smooth, w, 18, 6), 0);
  assert.equal(at(smooth, w, 8, 6), 255);
  const empty = new Uint8Array(w * h);
  for (const op of ["expand", "contract", "border", "smooth"] as const)
    assert.equal(
      (await modifySelection(empty, w, h, op, 3)).reduce((a, b) => a + b, 0),
      0,
    );
  await assert.rejects(modifySelection(box, w, h, "expand", 0), /Invalid/);
  await assert.rejects(modifySelection(box, w, h, "border", 500), /Invalid/);
  await assert.rejects(modifySelection(box, w, h, "grow" as never, 2), /Invalid/);
  await assert.rejects(modifySelection(box, w + 1, h, "expand", 2), /Invalid/);
});
