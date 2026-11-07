/**
 * Pure geometry for direct fade manipulation.
 *
 * Coordinates are image-local chapter pixels: x from the image's left edge,
 * y from the image's top edge (negative above the image, > height below it).
 * A shaped fade is a band: for "Top" placement it is fully covered above
 * `start + offset(u)` and ramps to zero over `length + feather` pixels.
 * Every helper returns a new fade; none of them mutate their input.
 */
import {
  boundary as newBoundary,
  boundaryOffset,
  profileRange,
  type Boundary,
} from "./boundaries.ts";
import { fadeSpan } from "./masks.ts";
import type { Fade } from "./model.ts";

export type Pt = { x: number; y: number };
export type Part = "top" | "bottom";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round = (v: number) => Math.round(v * 100) / 100;

export const ramp = (f: Fade) => f.length + f.feather;
export const span = (f: Fade, w: number) => fadeSpan(f, w) ?? { x: 0, width: w };
/** Parts of the image a shaped fade affects (Both = two mirrored bands). */
export const parts = (f: Fade): Part[] =>
  f.boundary?.placement === "Both"
    ? ["top", "bottom"]
    : f.boundary?.placement === "Top"
      ? ["top"]
      : ["bottom"];

/** y of the line at ramp fraction k (0 = fully covered edge, 0.5 = mint line, 1 = end). */
export function lineY(f: Fade, part: Part, u: number, k: number, h: number) {
  const d = f.start + (f.boundary ? boundaryOffset(f.boundary, u) : 0) + k * ramp(f);
  return part === "top" ? d : h - d;
}
export function fadeLine(f: Fade, part: Part, k: number, w: number, h: number, samples = 96): Pt[] {
  const s = span(f, w);
  return Array.from({ length: samples + 1 }, (_, i) => ({
    x: s.x + (i / samples) * s.width,
    y: lineY(f, part, i / samples, k, h),
  }));
}
/** Vertical extent [top, bottom] (image coordinates) of every band of the fade. */
export function fadeBand(f: Fade, h: number) {
  const r = f.boundary ? profileRange(f.boundary) : { min: 0, max: 0 },
    near = f.start + r.min,
    far = f.start + r.max + ramp(f);
  let top = Infinity,
    bottom = -Infinity;
  for (const p of parts(f)) {
    const a = p === "top" ? near : h - far,
      b = p === "top" ? far : h - near;
    top = Math.min(top, a);
    bottom = Math.max(bottom, b);
  }
  return { top, bottom };
}
/** How far an extending fade paints above/below the image (0 when clipped to it). */
export function fadeExtension(f: Fade, h: number) {
  if (!f.extend || !f.boundary || !f.visible) return { above: 0, below: 0 };
  const band = fadeBand(f, h);
  return { above: Math.max(0, -band.top), below: Math.max(0, band.bottom - h) };
}
const outside = (f: Fade, h: number) => {
  const band = fadeBand(f, h);
  return band.top < 0 || band.bottom > h;
};
/** Keep a fade visible when an edit moves its band past the image edge. */
const settle = (f: Fade, h: number): Fade =>
  outside(f, h) && !f.extend ? { ...f, extend: true } : f;

/** Drag the whole fade. Full-width fades move vertically only. */
export function moveFade(f: Fade, part: Part, dx: number, dy: number, w: number, h: number) {
  const next: Fade = {
    ...f,
    start: round(clamp(f.start + (part === "top" ? dy : -dy), -100000, 100000)),
  };
  if (fadeSpan(f, w) && dx) next.x = round(clamp((f.x ?? 0) + dx, -100000, 100000));
  return settle(next, h);
}
/** Set depth so the ramp's far edge passes through `y` at column `u`. */
export function setDepth(f: Fade, part: Part, u: number, y: number, h: number) {
  const near = lineY(f, part, u, 0, h),
    distance = part === "top" ? y - near : near - y;
  return settle({ ...f, length: Math.round(clamp(distance - f.feather, 1, 100000)) }, h);
}
/** Narrow or widen the fade from its left or right edge. */
export function resizeSide(f: Fade, side: "left" | "right", x: number, w: number) {
  const s = span(f, w);
  if (side === "left") {
    const right = s.x + s.width,
      left = Math.min(x, right - 8);
    return { ...f, x: round(left), width: round(right - left) };
  }
  return { ...f, x: round(s.x), width: round(Math.max(8, x - s.x)) };
}
/** Point offsets (distance from the start edge) in pixels, direction applied. */
export function pointOffsets(b: Boundary) {
  return b.points.map((p) => b.amplitude * (b.direction < 0 ? 1 - p.y : p.y));
}
/** Rebuild a boundary from absolute offsets: points stay in 0..1, start absorbs the minimum. */
function normalize(f: Fade, points: Pt[], offsets: number[]): Fade {
  const min = Math.min(...offsets),
    max = Math.max(...offsets),
    amplitude = max - min;
  const b = f.boundary!;
  return {
    ...f,
    start: round(clamp(f.start + min, -100000, 100000)),
    boundary: {
      ...b,
      direction: 1,
      amplitude: round(Math.min(100000, amplitude)),
      points: points.map((p, i) => ({
        x: clamp(p.x, 0, 1),
        y: amplitude ? clamp((offsets[i]! - min) / amplitude, 0, 1) : 0,
      })),
    },
  };
}
/** Pointer position → (u along the fade, offset from its start edge measured on the mint line). */
export function toProfile(f: Fade, part: Part, p: Pt, w: number, h: number) {
  const s = span(f, w),
    distance = part === "top" ? p.y : h - p.y;
  return {
    u: clamp((p.x - s.x) / Math.max(1, s.width), 0, 1),
    offset: distance - f.start - ramp(f) / 2,
  };
}
/** Any shape becomes an editable point profile that looks the same (sampled). */
export function toEditable(f: Fade, count = 9): Fade {
  const b = f.boundary ?? newBoundary("Straight");
  if (b.shape === "Freehand") return f;
  const pts = Array.from({ length: count }, (_, i) => {
    const u = i / (count - 1);
    return { x: u, y: 0, o: boundaryOffset(b, u) };
  });
  return normalize(
    { ...f, boundary: { ...b, shape: "Freehand" } },
    pts,
    pts.map((p) => p.o),
  );
}
/** Move a control point freely; amplitude and start adapt so it is never clamped. */
export function movePoint(f: Fade, part: Part, index: number, p: Pt, w: number, h: number) {
  const b = f.boundary!,
    { u, offset } = toProfile(f, part, p, w, h);
  const offsets = pointOffsets(b);
  offsets[index] = offset;
  const points = b.points.map((q, i) =>
    i === index
      ? { x: b.shape === "Bezier" || (i > 0 && i < b.points.length - 1) ? u : q.x, y: 0 }
      : q,
  );
  return settle(normalize(f, points, offsets), h);
}
/** Insert a point on the profile at pointer x (converting parametric shapes first). */
export function insertPoint(f: Fade, part: Part, p: Pt, w: number, h: number) {
  const e = toEditable(f),
    b = e.boundary!;
  if (b.points.length >= 128) return e;
  const { u, offset } = toProfile(e, part, p, w, h);
  const offsets = pointOffsets(b);
  let i = b.points.findIndex((q) => q.x > u);
  if (i <= 0) i = i === 0 ? 1 : b.points.length - 1;
  const points = [...b.points.slice(0, i), { x: u, y: 0 }, ...b.points.slice(i)];
  offsets.splice(i, 0, offset);
  return settle(normalize(e, points, offsets), h);
}
export function removePoint(f: Fade, index: number) {
  const b = f.boundary!;
  if (b.shape !== "Freehand" || b.points.length <= 2) return f;
  const offsets = pointOffsets(b).filter((_, i) => i !== index);
  return normalize(
    f,
    b.points.filter((_, i) => i !== index),
    offsets,
  );
}
/** Light 3-tap smoothing of an editable profile; the end points stay put. */
export function smoothPoints(f: Fade, passes = 1) {
  const b = f.boundary!;
  let offsets = pointOffsets(b);
  for (let k = 0; k < passes; k++)
    offsets = offsets.map((o, i, a) =>
      i === 0 || i === a.length - 1 ? o : (a[i - 1]! + 2 * o + a[i + 1]!) / 4,
    );
  return normalize(f, b.points, offsets);
}
/** Ramer–Douglas–Peucker simplification of a drawn polyline. */
export function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points;
  const [a, z] = [points[0]!, points.at(-1)!];
  let index = 0,
    max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!,
      dx = z.x - a.x,
      dy = z.y - a.y,
      d = Math.abs(dy * p.x - dx * p.y + z.x * a.y - z.y * a.x) / (Math.hypot(dx, dy) || 1);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [a, z];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}
/** A drawn mint line (image coordinates) becomes an editable freehand fade. */
export function fromDrawing(f: Fade, part: Part, drawn: Pt[], w: number, h: number) {
  const sorted = [...drawn]
    .sort((a, b) => a.x - b.x)
    .filter((p, i, a) => !i || p.x - a[i - 1]!.x > 0.5);
  if (sorted.length < 2) return f;
  // A narrowed fade takes the drawn horizontal range; a full-width fade stays full width.
  const narrowed = !!fadeSpan(f, w),
    s = narrowed
      ? { x: sorted[0]!.x, width: Math.max(8, sorted.at(-1)!.x - sorted[0]!.x) }
      : span(f, w);
  const simple = simplify(sorted, 1.5).slice(0, 126);
  const pts = narrowed
    ? simple
    : [{ x: s.x, y: simple[0]!.y }, ...simple, { x: s.x + s.width, y: simple.at(-1)!.y }];
  const base: Fade = {
    ...f,
    ...(narrowed ? { x: Math.round(s.x * 100) / 100, width: Math.round(s.width * 100) / 100 } : {}),
    boundary: { ...(f.boundary ?? newBoundary("Freehand")), shape: "Freehand" },
  };
  const profile = pts.map((p) => toProfile(base, part, p, w, h));
  return settle(
    normalize(
      base,
      profile.map((q) => ({ x: q.u, y: 0 })),
      profile.map((q) => q.offset),
    ),
    h,
  );
}
/** Parametric shapes: dragging the amplitude handle past the start flips the curve. */
export function setAmplitude(f: Fade, part: Part, p: Pt, h: number) {
  const b = f.boundary!,
    unit = boundaryOffset({ ...b, amplitude: 1, direction: 1 }, 0.25),
    distance = (part === "top" ? p.y : h - p.y) - f.start - ramp(f) / 2,
    a = distance / Math.max(0.1, b.direction < 0 ? 1 - unit : unit);
  return settle(
    {
      ...f,
      boundary: {
        ...b,
        amplitude: Math.round(Math.min(100000, Math.abs(a))),
        direction: a < 0 ? -b.direction : b.direction,
      },
    },
    h,
  );
}
/** Pointer hit inside the band (between the covered edge and the ramp end, ± tolerance). */
export function hitFade(f: Fade, p: Pt, w: number, h: number, tolerance = 8) {
  if (!f.boundary || !f.visible) return null;
  const s = span(f, w);
  if (p.x < s.x - tolerance || p.x > s.x + s.width + tolerance) return null;
  const u = clamp((p.x - s.x) / Math.max(1, s.width), 0, 1);
  for (const part of parts(f)) {
    const a = lineY(f, part, u, 0, h),
      b = lineY(f, part, u, 1, h);
    if (p.y >= Math.min(a, b) - tolerance && p.y <= Math.max(a, b) + tolerance) return part;
  }
  return null;
}
export function resetPosition(f: Fade): Fade {
  const next = { ...f, start: 0 };
  delete next.x;
  delete next.width;
  return next;
}
export function resetShape(f: Fade): Fade {
  if (!f.boundary) return f;
  const b = newBoundary(f.boundary.shape);
  return { ...f, boundary: { ...b, placement: f.boundary.placement } };
}
export function resetAppearance(f: Fade): Fade {
  return { ...f, opacity: 1, length: 350, feather: 0, blur: 0, softness: 0, curve: 1 };
}
/** Top ↔ Bottom (Both stays Both); classic edge fades swap their edge. */
export function reverseFade(f: Fade): Fade {
  if (f.boundary) {
    const placement =
      f.boundary.placement === "Top"
        ? "Bottom"
        : f.boundary.placement === "Bottom"
          ? "Top"
          : "Both";
    return { ...f, boundary: { ...f.boundary, placement } };
  }
  const swap = { top: "bottom", bottom: "top", left: "right", right: "left" } as const;
  return { ...f, edges: f.edges.map((e) => swap[e]) };
}
/** Classic top/bottom edge fades convert exactly to an editable Straight boundary. */
export function editableEdgeFade(f: Fade): Fade | null {
  if (f.boundary) return f;
  if (
    ![
      "Top Fade",
      "Bottom Fade",
      "Soft Feather",
      "Blur Fade",
      "Fog Fade",
      "Custom Gradient Fade",
    ].includes(f.type)
  )
    return null;
  if (f.edges.length !== 1 || !["top", "bottom"].includes(f.edges[0]!)) return null;
  return {
    ...f,
    boundary: { ...newBoundary("Straight"), placement: f.edges[0] === "top" ? "Top" : "Bottom" },
  };
}
export function uniqueFadeName(fades: Fade[], base: string) {
  const names = new Set(fades.map((f) => f.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}
export function describeFade(f: Fade) {
  const shape = f.boundary
    ? `${f.boundary.shape} · ${f.boundary.placement.toLowerCase()}`
    : f.type.replace(/ Fade$/, "");
  return `${shape} · ${Math.round(ramp(f))} px · ${Math.round(f.opacity * 100)}%`;
}
