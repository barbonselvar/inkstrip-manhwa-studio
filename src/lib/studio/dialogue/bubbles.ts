import { parseSvgPath } from "../pro/svg-path.ts";
import { anchorCurve, cubicPoint, splitCubic, type Cubic } from "../pro/bezier.ts";
import type { Anchor, Contour, Point } from "../pro/model.ts";
import { validateBubble, type BubbleSpec } from "./types.ts";
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
function oval(w: number, h: number) {
  const k = 0.5522847498307936;
  return `M${w / 2} 0 C${w / 2 + (w * k) / 2} 0 ${w} ${h / 2 - (h * k) / 2} ${w} ${h / 2} C${w} ${h / 2 + (h * k) / 2} ${w / 2 + (w * k) / 2} ${h} ${w / 2} ${h} C${w / 2 - (w * k) / 2} ${h} 0 ${h / 2 + (h * k) / 2} 0 ${h / 2} C0 ${h / 2 - (h * k) / 2} ${w / 2 - (w * k) / 2} 0 ${w / 2} 0 Z`;
}
function basePath(spec: BubbleSpec, w: number, h: number) {
  const preset = spec.preset;
  if (["rectangle", "square", "narration", "caption"].includes(preset))
    return `M0 0 H${w} V${h} H0 Z`;
  if (preset === "rounded") {
    const r = Math.min(w, h) * 0.15;
    return `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`;
  }
  if (["shout", "scream", "jagged", "burst"].includes(preset)) {
    const n = preset === "scream" ? 40 : preset === "burst" ? 32 : 24;
    return (
      "M" +
      Array.from({ length: n }, (_, i) => {
        const angle = (i * Math.PI * 2) / n - Math.PI / 2;
        const radius = i % 2 ? (preset === "scream" ? 0.68 : 0.82) : 1;
        return `${w / 2 + Math.cos(angle) * w * 0.5 * radius} ${h / 2 + Math.sin(angle) * h * 0.5 * radius}`;
      }).join(" L") +
      " Z"
    );
  }
  if (preset === "cloud" || preset === "thought") {
    const points = Array.from({ length: 48 }, (_, i) => {
      const a = (i * Math.PI * 2) / 48,
        r = 1 + 0.065 * Math.cos(a * 12);
      return { x: w / 2 + Math.cos(a) * w * 0.465 * r, y: h / 2 + Math.sin(a) * h * 0.465 * r };
    });
    return (
      `M${points[0]!.x} ${points[0]!.y}` +
      points
        .map((b, i) => {
          const a = points[(i + 47) % 48]!,
            c = points[(i + 1) % 48]!,
            d = points[(i + 2) % 48]!;
          return ` C${b.x + (c.x - a.x) / 6} ${b.y + (c.y - a.y) / 6} ${c.x - (d.x - b.x) / 6} ${c.y - (d.y - b.y) / 6} ${c.x} ${c.y}`;
        })
        .join("") +
      " Z"
    );
  }
  return oval(w, h);
}
function contour(segments: Cubic[]): Contour {
  return {
    closed: true,
    anchors: segments.map((curve, index): Anchor => ({
      ...curve[0],
      outgoing: { ...curve[1] },
      incoming: { ...segments[(index + segments.length - 1) % segments.length]![2] },
    })),
  };
}
/** Tail replacements preserve untouched cubic boundaries exactly. No raster masks or polyline union. */
export function bubbleContours(spec: BubbleSpec, width: number, height: number): Contour[] {
  validateBubble(spec);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384
  )
    throw Error("Invalid bubble dimensions.");
  const anchors = parseSvgPath(basePath(spec, width, height)).contours[0]!.anchors;
  const curves = anchors.map((a, i) => anchorCurve(a, anchors[(i + 1) % anchors.length]!));
  const n = curves.length,
    perimeter = curves.reduce((v, c) => v + Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y), 0);
  const at = (t: number) => {
    const scaled = Math.min(1 - 1e-12, Math.max(0, t)) * n;
    return cubicPoint(curves[Math.floor(scaled)]!, scaled % 1);
  };
  const segments: Cubic[] = [],
    extra: Contour[] = [];
  const range = (a: number, b: number) => {
    for (let i = Math.floor(a * n); i < n && i < b * n - 1e-10; i++) {
      const start = Math.max(0, a * n - i),
        end = Math.min(1, b * n - i);
      let c = curves[i]!;
      if (end < 1) c = splitCubic(c, end)[0];
      if (start > 0) c = splitCubic(c, start / end)[1];
      segments.push(c);
    }
  };
  const tails = spec.tails
    .map((tail) => {
      const span = Math.max(0.004, Math.min(0.16, tail.width / perimeter)),
        start = Math.max(0.001, Math.min(1 - span - 0.001, tail.attachment - span / 2));
      return { ...tail, start, end: start + span };
    })
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const tail of tails) {
    const a = at(tail.start),
      b = at(tail.end),
      tip = tail.tip;
    if (tail.kind === "dots") {
      const source = at((tail.start + tail.end) / 2);
      for (const [t, scale] of [
        [0.35, 0.45],
        [0.7, 0.3],
        [1, 0.2],
      ] as const) {
        const center = lerp(source, tip, t),
          r = Math.max(1, (tail.width * scale) / 2);
        const dot = parseSvgPath(oval(r * 2, r * 2)).contours[0]!;
        extra.push({
          closed: true,
          anchors: dot.anchors.map((p) => ({
            ...p,
            x: p.x + center.x - r,
            y: p.y + center.y - r,
            incoming: p.incoming && {
              x: p.incoming.x + center.x - r,
              y: p.incoming.y + center.y - r,
            },
            outgoing: p.outgoing && {
              x: p.outgoing.x + center.x - r,
              y: p.outgoing.y + center.y - r,
            },
          })),
        });
      }
      continue;
    }
    if (tail.start < cursor + 1e-6)
      throw Error("Bubble tail attachment regions overlap. Move a tail or reduce its width.");
    range(cursor, tail.start);
    const midpoint = lerp(a, b, 0.5),
      dx = tip.x - midpoint.x,
      dy = tip.y - midpoint.y,
      len = Math.hypot(dx, dy);
    if (len < 1) throw Error("A pointed tail needs a distinct tip.");
    const bend = { x: -dy * tail.curvature * 0.3, y: dx * tail.curvature * 0.3 };
    const control = (p: Point, q: Point, t: number) => {
      const v = lerp(p, q, t);
      return { x: v.x + bend.x, y: v.y + bend.y };
    };
    segments.push(
      [a, control(a, tip, 0.35), control(a, tip, 0.75), { ...tip }],
      [{ ...tip }, control(b, tip, 0.75), control(b, tip, 0.35), b],
    );
    cursor = tail.end;
  }
  range(cursor, 1);
  return [contour(segments), ...extra];
}
