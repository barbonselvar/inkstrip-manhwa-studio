import { advancedGradient, type Gradient } from "./gradient.ts";
import type { Point } from "./model.ts";
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
/** Source-local endpoints. Nonlinear gradients use the center plus direction/scale handle. */
export function gradientFillHandles(g: Gradient, width: number, height: number) {
  const theta = (g.angle * Math.PI) / 180,
    c = Math.cos(theta),
    s = Math.sin(theta),
    span = Math.abs(width * c) + Math.abs(height * s),
    center = { x: g.center.x * width, y: g.center.y * height },
    radius =
      ((g.kind === "linear" || g.kind === "reflected"
        ? span
        : g.kind === "angular"
          ? Math.min(width, height)
          : width) *
        g.scale) /
      2;
  return {
    from: g.kind === "linear" ? { x: center.x - c * radius, y: center.y - s * radius } : center,
    to: { x: center.x + c * radius, y: center.y + s * radius },
  };
}
/** Dragging defines metadata only; no raster source or selection is rewritten. */
export function gradientFromEndpoints(
  g: Gradient,
  from: Point,
  to: Point,
  width: number,
  height: number,
): Gradient {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 0.01) return g;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI,
    theta = (angle * Math.PI) / 180,
    span = Math.abs(width * Math.cos(theta)) + Math.abs(height * Math.sin(theta)),
    center = g.kind === "linear" ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } : from,
    denominator =
      g.kind === "linear"
        ? span
        : g.kind === "reflected"
          ? span / 2
          : g.kind === "angular"
            ? Math.min(width, height) / 2
            : width / 2;
  return {
    ...advancedGradient(),
    ...g,
    version: 2,
    angle,
    scale: clamp(length / denominator, 0.01, 10),
    center: { x: clamp(center.x / width, -2, 3), y: clamp(center.y / height, -2, 3) },
  };
}
