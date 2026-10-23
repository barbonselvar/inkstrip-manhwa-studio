import type { Region, Selection, Stroke } from "./model.ts";
import { MAX_SELECTION_RUNS } from "./selection.ts";

/**
 * Paint Bucket.
 *
 * A fill is stored as an ordinary editable paint stroke: square, fully hard dabs that cover the
 * whole paint layer, clipped by the colour-range region. This reuses features every native
 * envelope already supports, so fills stay undoable, re-render at any resolution and open
 * unchanged in earlier releases. The region comes from the same tolerance/contiguous/anti-alias
 * flood fill as the Magic Wand, sampled from the visible composite.
 */

/** Largest square dab the stroke schema allows. */
const MAX_TIP = 1000;

/** Serpentine centres of square dabs that together cover a `width` × `height` layer. */
export function coveragePoints(width: number, height: number) {
  if (!(width > 0) || !(height > 0)) throw new Error("Invalid fill area.");
  const tip = Math.min(MAX_TIP, Math.ceil(Math.max(width, height))),
    columns = Math.ceil(width / tip),
    rows = Math.ceil(height / tip),
    points: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const column = r % 2 ? columns - 1 - c : c;
      points.push({ x: tip / 2 + column * tip, y: tip / 2 + r * tip });
    }
  return { tip, points };
}

/** The editable stroke that fills `clip` (layer-local) on a paint layer of this size. */
export function bucketStroke(
  layer: { width: number; height: number },
  clip: Selection,
  color: string,
  opacity = 1,
): Stroke {
  const { tip, points } = coveragePoints(layer.width, layer.height);
  return {
    points,
    size: tip,
    hardness: 1,
    opacity,
    flow: 1,
    color,
    erase: false,
    tip: "square",
    clip,
  };
}

/**
 * Limit a document-space pixel region to an existing selection's coverage.
 * `alpha` is the active selection rasterised at the region's resolution (0..255 per pixel).
 * Coverage multiplies, so feathered selections fill partially, as in other image editors.
 */
export function intersectRegion(region: Region, alpha: ArrayLike<number>): Region {
  const p = region.pixels;
  if (region.kind !== "pixels" || !p) throw new Error("Paint Bucket needs a pixel region.");
  if (alpha.length !== p.width * p.height)
    throw new Error("Selection coverage does not match the fill region.");
  const runs: number[] = [];
  for (let i = 0; i < p.runs.length; i += 3) {
    const start = p.runs[i]!,
      length = p.runs[i + 1]!,
      value = p.runs[i + 2]!;
    let from = start,
      current = -1;
    const flush = (end: number) => {
      if (current > 0) {
        const last = runs.length - 3;
        // Merge with the previous run when it continues on the same row with the same value.
        if (
          last >= 0 &&
          runs[last]! + runs[last + 1]! === from &&
          runs[last + 2] === current &&
          Math.floor(runs[last]! / p.width) === Math.floor(from / p.width)
        )
          runs[last + 1]! += end - from;
        else runs.push(from, end - from, current);
      }
      if (runs.length > MAX_SELECTION_RUNS * 3)
        throw new Error("The selection is too fragmented to fill. Simplify or reduce feather.");
    };
    for (let px = start; px < start + length; px++) {
      const next = Math.round((value * alpha[px]!) / 255);
      if (next !== current) {
        flush(px);
        from = px;
        current = next;
      }
    }
    flush(start + length);
  }
  return { ...region, pixels: { ...p, runs } };
}

/** True when a selection limits where painting may happen. */
export function hasActiveSelection(selection: Selection | undefined) {
  return !!selection && (selection.regions.length > 0 || selection.inverted);
}
