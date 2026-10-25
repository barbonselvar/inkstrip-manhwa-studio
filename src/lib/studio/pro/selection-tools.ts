import type { Point, Region, Selection } from "./model.ts";
import { appendSelection } from "./selection.ts";
import { boxFilter, coverageRegion, morphology } from "./refine-selection.ts";
import { colorDistanceTo, oklab, type ColorMetric } from "./color-distance.ts";
export { colorDistanceTo, oklab, type ColorMetric };

/** Tool-level mode. "replace" starts a new selection; stored regions keep the
 * existing add/subtract/intersect operations, so documents stay format-compatible. */
export type SelectionMode = Region["operation"] | "replace";
export const SELECTION_REGION_LIMIT = 100;
export const LASSO_POINT_LIMIT = 5000;

export function combineSelection(selection: Selection, region: Region, mode: SelectionMode) {
  if (mode === "replace")
    return {
      regions: [{ ...region, operation: "add" as const }],
      inverted: false,
      feather: selection.feather,
    } satisfies Selection;
  return appendSelection(selection, { ...region, operation: mode });
}

/** Marquee corners with Photoshop-style constraints: a fixed width:height ratio (or a
 * square/circle while Shift is held) and drawing from the centre (Alt). */
export function marqueeCorners(
  start: Point,
  end: Point,
  options: { ratio?: number; square?: boolean; center?: boolean } = {},
): [Point, Point] {
  let dx = end.x - start.x,
    dy = end.y - start.y;
  const ratio = options.square
    ? 1
    : options.ratio && Number.isFinite(options.ratio) && options.ratio > 0
      ? options.ratio
      : 0;
  if (ratio) {
    // Grow to the larger requested extent so the box follows the pointer.
    const w = Math.max(Math.abs(dx), Math.abs(dy) * ratio);
    dx = Math.sign(dx || 1) * w;
    dy = Math.sign(dy || 1) * (w / ratio);
  }
  return options.center
    ? [
        { x: start.x - dx, y: start.y - dy },
        { x: start.x + dx, y: start.y + dy },
      ]
    : [start, { x: start.x + dx, y: start.y + dy }];
}

/** Freehand lasso samples are stored only after `minStep` document units and never
 * beyond the region point limit, so a long lasso always commits. */
export function appendLassoPoint(points: Point[], p: Point, minStep: number) {
  const last = points.at(-1);
  if (points.length >= LASSO_POINT_LIMIT) return { points, full: true };
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < minStep) return { points, full: false };
  const next = [...points, p];
  return { points: next, full: next.length >= LASSO_POINT_LIMIT };
}

const imageInput = (pixels: Uint8ClampedArray, width: number, height: number) => {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 16_777_216 ||
    pixels.length !== width * height * 4
  )
    throw Error("Invalid selection image.");
};

export type ColorRangeOptions = {
  include: [number, number, number][];
  exclude?: [number, number, number][];
  /** Distance that is fully selected (0..255). */
  tolerance: number;
  /** Additional distance over which coverage falls linearly to 0 (0 = hard edge). */
  fuzziness: number;
  metric?: ColorMetric;
};
export function validateColorRange(o: ColorRangeOptions) {
  const color = (c: unknown) =>
    Array.isArray(c) && c.length === 3 && c.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  if (
    !Array.isArray(o.include) ||
    o.include.length < 1 ||
    o.include.length > 16 ||
    !o.include.every(color) ||
    (o.exclude !== undefined &&
      (!Array.isArray(o.exclude) || o.exclude.length > 16 || !o.exclude.every(color))) ||
    !Number.isFinite(o.tolerance) ||
    o.tolerance < 0 ||
    o.tolerance > 255 ||
    !Number.isFinite(o.fuzziness) ||
    o.fuzziness < 0 ||
    o.fuzziness > 255 ||
    (o.metric !== undefined && o.metric !== "rgb" && o.metric !== "perceptual")
  )
    throw Error("Invalid Color Range settings.");
}
/** Whole-image colour range: coverage = falloff(min distance to an included sample),
 * reduced by falloff(min distance to an excluded sample). Not a connected flood fill. */
export function colorRangeCoverage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  o: ColorRangeOptions,
) {
  imageInput(pixels, width, height);
  validateColorRange(o);
  const metric = o.metric ?? "rgb",
    refs = (list: [number, number, number][] = []) =>
      list.map((c) => ({
        rgba: [...c, 255] as [number, number, number, number],
        lab: oklab(...c),
      })),
    include = refs(o.include),
    exclude = refs(o.exclude),
    falloff = (d: number) =>
      d <= o.tolerance
        ? 255
        : o.fuzziness && d < o.tolerance + o.fuzziness
          ? Math.round(255 * (1 - (d - o.tolerance) / o.fuzziness))
          : 0,
    nearest = (i: number, list: typeof include) => {
      let best = Infinity;
      for (const r of list)
        best = Math.min(best, colorDistanceTo(pixels, i, r.rgba, metric, r.lab));
      return best;
    },
    out = new Uint8Array(width * height);
  for (let p = 0; p < out.length; p++) {
    const inc = falloff(nearest(p * 4, include));
    if (!inc) continue;
    const exc = exclude.length ? falloff(nearest(p * 4, exclude)) : 0;
    out[p] = Math.round((inc * (255 - exc)) / 255);
  }
  return out;
}
export const colorRangeRegion = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  o: ColorRangeOptions,
): Region => coverageRegion(colorRangeCoverage(pixels, width, height, o), width, height);

/** Composite alpha → selection coverage (masks, Quick Mask). */
export function alphaRegion(pixels: Uint8ClampedArray, width: number, height: number): Region {
  imageInput(pixels, width, height);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = pixels[i * 4 + 3]!;
  return coverageRegion(out, width, height);
}

// ---- Modify ---------------------------------------------------------------
export type ModifyOperation = "expand" | "contract" | "border" | "smooth";
export const MODIFY_LIMITS: Record<ModifyOperation, [number, number]> = {
  expand: [1, 100],
  contract: [1, 100],
  border: [1, 200],
  smooth: [1, 100],
};
type Checkpoint = () => Promise<void>;
/** Expand/contract use O(n) square morphology (Chebyshev radius) with replicated document
 * edges, so a selection touching the canvas edge stays attached to it. Border is the band
 * between expanding and contracting by half the width. Smooth box-filters, then re-sharpens
 * around 50% coverage, rounding corners and removing specks narrower than the radius
 * while keeping an anti-aliased edge. */
export async function modifySelection(
  input: Uint8Array,
  width: number,
  height: number,
  operation: ModifyOperation,
  amount: number,
  checkpoint: Checkpoint = async () => {},
) {
  const limits = MODIFY_LIMITS[operation];
  if (!limits || !Number.isFinite(amount) || amount < limits[0] || amount > limits[1])
    throw Error("Invalid selection modification.");
  if (input.length !== width * height || width < 1 || height < 1 || width * height > 16_777_216)
    throw Error("Invalid selection mask.");
  if (operation === "expand" || operation === "contract")
    return morphology(input, width, height, amount, operation === "expand", checkpoint);
  if (operation === "border") {
    const half = Math.max(1, amount / 2),
      outer = await morphology(input, width, height, half, true, checkpoint),
      inner = await morphology(input, width, height, half, false, checkpoint),
      out = new Uint8Array(input.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, outer[i]! - inner[i]!);
    return out;
  }
  const blurred = await boxFilter(Float32Array.from(input), width, height, amount, checkpoint),
    out = new Uint8Array(input.length);
  for (let i = 0; i < out.length; i++)
    out[i] = Math.round(Math.max(0, Math.min(255, (blurred[i]! - 127.5) * 4 + 127.5)));
  return out;
}
