import { contourData, type Contour, type Layer } from "./model.ts";
import { inverse, type Matrix } from "./transform.ts";
export type VectorClip = {
  contours: Contour[];
  matrix: Matrix;
  rule: "nonzero" | "evenodd";
  enabled: boolean;
};
export function validateVectorClips(l: Layer) {
  if (l.vectorClips === undefined) return;
  if (
    !["shape", "text"].includes(l.kind) ||
    !Array.isArray(l.vectorClips) ||
    l.vectorClips.length > 8
  )
    throw Error("At most eight vector clip intersections are supported on vector/text objects.");
  let count = 0;
  for (const c of l.vectorClips) {
    if (
      !c ||
      !Array.isArray(c.matrix) ||
      c.matrix.length !== 6 ||
      !c.matrix.every((n) => Number.isFinite(n) && Math.abs(n) <= 1000000) ||
      !["nonzero", "evenodd"].includes(c.rule) ||
      typeof c.enabled !== "boolean" ||
      !Array.isArray(c.contours) ||
      c.contours.length > 128
    )
      throw Error("Invalid vector clipping path.");
    inverse(c.matrix);
    for (const contour of c.contours) {
      if (!contour || !Array.isArray(contour.anchors) || typeof contour.closed !== "boolean")
        throw Error("Invalid clipping contour.");
      for (const a of contour.anchors) {
        if (
          ++count > 8000 ||
          [a, a.incoming, a.outgoing].some(
            (p) =>
              p &&
              (![p.x, p.y].every(Number.isFinite) ||
                Math.abs(p.x) > 1000000 ||
                Math.abs(p.y) > 1000000),
          )
        )
          throw Error("Invalid or oversized vector clip geometry.");
      }
    }
  }
}
export function clipPath(c: VectorClip) {
  const p = new Path2D(c.contours.map(contourData).join(" ")),
    out = new Path2D(),
    [a, b, cc, d, e, f] = c.matrix;
  out.addPath(p, { a, b, c: cc, d, e, f });
  return out;
}
/** Clip the isolated object once, after its complete paint stack is composited. */
export function maskVectorClips(ctx: OffscreenCanvasRenderingContext2D, l: Layer) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "#ffffff";
  for (const c of l.vectorClips ?? []) if (c.enabled) ctx.fill(clipPath(c), c.rule);
  ctx.restore();
}
