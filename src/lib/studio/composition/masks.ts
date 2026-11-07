import { shapedCoverage } from "./boundaries.ts";
import type { Fade } from "./model.ts";
export const clamp = (v: number) => Math.max(0, Math.min(1, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function noise(x: number, y: number, seed = 1) {
  let n = Math.imul(Math.floor(x) ^ seed, 374761393) ^ Math.imul(Math.floor(y), 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
export function stopValue(stops: Fade["stops"], t: number) {
  let a = stops[0];
  for (const b of stops.slice(1)) {
    if (t <= b.position)
      return mix(
        a.opacity,
        b.opacity,
        clamp((t - a.position) / Math.max(0.000001, b.position - a.position)),
      );
    a = b;
  }
  return a.opacity;
}
/** Horizontal extent of a narrowed fade, or null for the full image width. */
export function fadeSpan(f: Fade, w: number) {
  return f.x === undefined && f.width === undefined ? null : { x: f.x ?? 0, width: f.width ?? w };
}
/** `offset` may be precomputed per column by callers rendering many rows. */
export function fadeCoverage(f: Fade, x: number, y: number, w: number, h: number, offset?: number) {
  const length = f.length + f.feather,
    radians = (f.angle * Math.PI) / 180;
  const span = fadeSpan(f, w);
  if (span) {
    if (x < span.x || x > span.x + span.width) return 0;
    x -= span.x;
    w = span.width;
  }
  let t = 0;
  if (f.boundary) {
    t = shapedCoverage(f, x, y, w, h, offset);
  } else if (f.type === "Radial Fade" || f.type === "Elliptical Fade") {
    const rx = f.type === "Radial Fade" ? Math.min(w, h) / 2 : w / 2,
      ry = f.type === "Radial Fade" ? rx : h / 2;
    const distance = Math.hypot((x - w / 2) / Math.max(1, rx), (y - h / 2) / Math.max(1, ry));
    t = clamp(
      ((distance - 1 + (length + f.start) / Math.max(1, Math.min(rx, ry))) * Math.min(rx, ry)) /
        length,
    );
  } else if (f.type === "Directional Fade" || f.type === "Linear Fade") {
    const c = Math.cos(radians),
      s = Math.sin(radians),
      p = x * c + y * s + Math.max(0, -w * c) + Math.max(0, -h * s),
      max = Math.abs(w * c) + Math.abs(h * s);
    t = clamp(1 - (max - p - f.start) / length);
  } else {
    t = Math.max(
      ...f.edges.map((edge) => {
        const distance =
          edge === "top" ? y : edge === "bottom" ? h - y : edge === "left" ? x : w - x;
        return clamp(1 - (distance - f.start) / length);
      }),
    );
  }
  if (f.feather > 0) t = t * t * (3 - 2 * t);
  if (f.type === "Custom Gradient Fade") t = stopValue(f.stops, t);
  if (f.type === "Fog Fade")
    t = clamp(t + (Math.sin(x / 47 + y / 69) + Math.sin(x / 113 - y / 37)) * 0.08 * t * (1 - t));
  return Math.pow(t, f.curve) * f.opacity;
}
