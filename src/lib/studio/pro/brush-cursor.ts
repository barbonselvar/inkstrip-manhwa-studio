import { localPoint, type Layer, type Point, type Stroke } from "./model.ts";
import { maskPaintPoint, maskWorld } from "./masks.ts";
import { affine, type Matrix } from "./transform.ts";

export type BrushCursor = {
  /** Target frame → document: strokes are recorded in layer- or mask-local units. */
  matrix: Matrix;
  center: Point;
  rx: number;
  ry: number;
  angle: number;
  square: boolean;
  /** Fully opaque core radius fraction for soft round tips. */
  hardness?: number;
};
/** Outline of the dab footprint the next stroke will paint, in the target's own frame,
 * so layer/mask scale and rotation, tip shape, roundness and angle are all shown. */
export function brushCursor(
  layer: Layer | undefined,
  maskMode: boolean,
  point: Point,
  brush: Pick<Stroke, "size" | "hardness" | "tip" | "dynamics">,
  tool: string,
): BrushCursor | null {
  if (!layer || layer.transform.deform) return null;
  const mask = maskMode && !!layer.mask;
  let matrix: Matrix, center: Point;
  try {
    const local = localPoint(point, layer);
    matrix = mask ? maskWorld(layer) : affine(layer.transform);
    center = mask ? maskPaintPoint(layer, local) : local;
  } catch {
    return null;
  }
  // The pencil always paints square, fully hard dabs (see the brush gesture).
  const square = tool === "pencil" || brush.tip === "square",
    half = Math.max(0.5, brush.size / 2),
    d = brush.dynamics;
  return {
    matrix,
    center,
    rx: half,
    ry: half * (d?.roundness ?? 1),
    angle: d?.angle ?? 0,
    square,
    ...(!square && brush.hardness > 0 && brush.hardness < 1 ? { hardness: brush.hardness } : {}),
  };
}
