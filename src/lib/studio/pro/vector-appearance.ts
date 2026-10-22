import { contours, type Layer, type Point } from "./model.ts";
import { type GradientStop } from "./color.ts";
import { compose, inverse, applyMatrix, type Matrix } from "./transform.ts";
import { layerBounds } from "./precision.ts";
export const VECTOR_BLENDS = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
] as const;
export type VectorGradient = {
  kind: "linear" | "radial";
  units: "objectBoundingBox" | "userSpaceOnUse";
  from: Point;
  to: Point;
  radius: number;
  matrix: Matrix;
  stops: GradientStop[];
};
export type VectorPaint = { color: string; gradient?: VectorGradient };
export type AppearanceItem = {
  id: string;
  kind: "fill" | "stroke";
  visible: boolean;
  opacity: number;
  blend: Layer["blend"];
  paint: VectorPaint;
  fillRule: "nonzero" | "evenodd";
  width: number;
  alignment: "inside" | "center" | "outside";
  dash: number[];
  dashOffset: number;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  miterLimit: number;
};
const finite = (n: unknown, min: number, max: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const point = (p: Point) => p && finite(p.x, -100000, 100000) && finite(p.y, -100000, 100000);
const color = (v: unknown) => typeof v === "string" && /^(transparent|#[a-f\d]{6})$/i.test(v);
export function defaultVectorGradient(): VectorGradient {
  return {
    kind: "linear",
    units: "objectBoundingBox",
    from: { x: 0, y: 0.5 },
    to: { x: 1, y: 0.5 },
    radius: 0.5,
    matrix: [1, 0, 0, 1, 0, 0],
    stops: [
      { position: 0, color: "#000000", opacity: 1 },
      { position: 1, color: "#ffffff", opacity: 1 },
    ],
  };
}
export function appearanceItem(
  kind: AppearanceItem["kind"],
  l: Layer,
  id: string = crypto.randomUUID(),
): AppearanceItem {
  return {
    id,
    kind,
    visible: true,
    opacity: kind === "fill" ? (l.fillOpacity ?? 1) : (l.strokeOpacity ?? 1),
    blend: "source-over",
    paint: { color: kind === "fill" ? l.fill : l.stroke },
    fillRule: l.fillRule ?? "nonzero",
    width: l.strokeWidth,
    alignment: "center",
    dash: [...(l.dash ?? [])],
    dashOffset: l.dashOffset ?? 0,
    cap: l.lineCap ?? "butt",
    join: l.lineJoin ?? "round",
    miterLimit: l.miterLimit ?? 10,
  };
}
export function appearance(l: Layer): AppearanceItem[] {
  return (
    l.appearance ?? [
      appearanceItem("fill", l, `${l.id}:legacy:0`),
      appearanceItem("stroke", l, `${l.id}:legacy:1`),
    ]
  );
}
export function validateVectorGradient(g: VectorGradient) {
  if (
    !g ||
    !["linear", "radial"].includes(g.kind) ||
    !["objectBoundingBox", "userSpaceOnUse"].includes(g.units) ||
    !point(g.from) ||
    !point(g.to) ||
    !finite(g.radius, 0.00001, 100000) ||
    !Array.isArray(g.matrix) ||
    g.matrix.length !== 6 ||
    !g.matrix.every((n) => finite(n, -100000, 100000))
  )
    throw Error("Invalid vector gradient geometry.");
  inverse(g.matrix);
  if (g.kind === "linear" && Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y) < 1e-8)
    throw Error("Linear gradient endpoints must be distinct.");
  if (g.kind === "radial" && Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y) > g.radius + 1e-8)
    throw Error("The radial focal point must lie inside its radius.");
  if (
    !Array.isArray(g.stops) ||
    g.stops.length < 2 ||
    g.stops.length > 16 ||
    g.stops[0]?.position !== 0 ||
    g.stops.at(-1)?.position !== 1 ||
    g.stops.some(
      (s, i) =>
        !s ||
        !finite(s.position, 0, 1) ||
        !color(s.color) ||
        s.color === "transparent" ||
        !finite(s.opacity, 0, 1) ||
        (i > 0 && s.position < g.stops[i - 1]!.position),
    )
  )
    throw Error("Vector gradients need 2–16 ordered color/opacity stops including 0 and 1.");
}
export function validateAppearance(l: Layer) {
  if (l.appearance === undefined) return;
  if (
    !["shape", "text"].includes(l.kind) ||
    !Array.isArray(l.appearance) ||
    l.appearance.length > 16
  )
    throw Error("Vector objects support at most 16 appearance items.");
  const ids = new Set<string>();
  for (const a of l.appearance) {
    if (
      !a ||
      !a.id ||
      typeof a.id !== "string" ||
      ids.has(a.id) ||
      !["fill", "stroke"].includes(a.kind) ||
      typeof a.visible !== "boolean" ||
      !finite(a.opacity, 0, 1) ||
      !VECTOR_BLENDS.includes(a.blend) ||
      !a.paint ||
      !color(a.paint.color) ||
      !["nonzero", "evenodd"].includes(a.fillRule) ||
      !finite(a.width, 0, 100) ||
      !["inside", "center", "outside"].includes(a.alignment) ||
      !Array.isArray(a.dash) ||
      a.dash.length > 32 ||
      !a.dash.every((n) => finite(n, 0, 10000)) ||
      (a.dash.length > 0 && !a.dash.some((n) => n > 0)) ||
      !finite(a.dashOffset, -100000, 100000) ||
      !["butt", "round", "square"].includes(a.cap) ||
      !["miter", "round", "bevel"].includes(a.join) ||
      !finite(a.miterLimit, 1, 1000)
    )
      throw Error("Invalid vector appearance item.");
    if (
      a.kind === "stroke" &&
      a.alignment !== "center" &&
      (l.kind !== "shape" ||
        l.shape === "line" ||
        (l.shape === "path" && (l.pathData || contours(l).some((c) => !c.closed))))
    )
      throw Error(
        "Inside/outside strokes require closed native contours; open paths and text use centered strokes.",
      );
    if (a.paint.gradient) {
      validateVectorGradient(a.paint.gradient);
      gradientMatrix(a.paint.gradient, l);
    }
    ids.add(a.id);
  }
}
const boundsCache = new WeakMap<Layer, { x: number; y: number; width: number; height: number }>();
/** Layers are immutable transactions; a weak cache reuses exact cubic bounds across paints. */
export function paintBounds(l: Layer) {
  const cached = boundsCache.get(l);
  if (cached) return cached;
  const result =
    l.kind === "shape"
      ? layerBounds({ ...l, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } })
      : { x: 0, y: 0, width: l.width, height: l.height };
  boundsCache.set(l, result);
  return result;
}
/** Create valid paint geometry even for horizontal/vertical paths with zero-area bounds. */
export function initialVectorGradient(
  l: Layer,
  kind: VectorGradient["kind"],
  previous?: VectorGradient,
): VectorGradient {
  const b = paintBounds(l),
    base = previous ?? defaultVectorGradient(),
    units =
      base.units === "objectBoundingBox" && (!b.width || !b.height) ? "userSpaceOnUse" : base.units,
    user = units === "userSpaceOnUse",
    center = { x: user ? b.x + b.width / 2 : 0.5, y: user ? b.y + b.height / 2 : 0.5 };
  return {
    ...base,
    kind,
    units,
    from: kind === "radial" ? center : user ? { x: b.x, y: b.y } : { x: 0, y: 0.5 },
    to:
      kind === "radial"
        ? center
        : user
          ? { x: b.x + (b.width || (!b.height ? 1 : 0)), y: b.y + b.height }
          : { x: 1, y: 0.5 },
    radius: kind === "radial" ? (user ? Math.max(1, b.width, b.height) / 2 : 0.5) : base.radius,
  };
}
export function gradientMatrix(g: VectorGradient, l: Layer): Matrix {
  const b = paintBounds(l);
  if (g.units === "objectBoundingBox" && (!b.width || !b.height))
    throw Error("Object-bounds gradients require non-zero width and height.");
  return g.units === "objectBoundingBox"
    ? compose([b.width, 0, 0, b.height, b.x, b.y], g.matrix)
    : g.matrix;
}
export function gradientHandles(g: VectorGradient, l: Layer) {
  const m = gradientMatrix(g, l);
  return {
    from: applyMatrix(m, g.from),
    to: applyMatrix(m, g.kind === "linear" ? g.to : { x: g.to.x + g.radius, y: g.to.y }),
    center: applyMatrix(m, g.to),
    stops: g.stops.map((s) =>
      applyMatrix(
        m,
        g.kind === "linear"
          ? {
              x: g.from.x + (g.to.x - g.from.x) * s.position,
              y: g.from.y + (g.to.y - g.from.y) * s.position,
            }
          : { x: g.to.x + g.radius * s.position, y: g.to.y },
      ),
    ),
  };
}
export function moveGradientHandle(
  g: VectorGradient,
  l: Layer,
  handle: string,
  local: Point,
): VectorGradient {
  const p = applyMatrix(inverse(gradientMatrix(g, l)), local);
  if (handle.startsWith("stop:")) {
    const index = Number(handle.slice(5));
    if (!Number.isInteger(index) || index <= 0 || index >= g.stops.length - 1) return g;
    const dx = g.to.x - g.from.x,
      dy = g.to.y - g.from.y,
      position =
        g.kind === "linear"
          ? ((p.x - g.from.x) * dx + (p.y - g.from.y) * dy) / (dx * dx + dy * dy)
          : (p.x - g.to.x) / g.radius;
    return {
      ...g,
      stops: g.stops.map((s, i) =>
        i === index
          ? {
              ...s,
              position: Math.max(
                g.stops[i - 1]!.position,
                Math.min(g.stops[i + 1]!.position, position),
              ),
            }
          : s,
      ),
    };
  }
  if (g.kind === "linear") return { ...g, [handle === "from" ? "from" : "to"]: p };
  if (handle === "radius")
    return { ...g, radius: Math.max(0.00001, Math.hypot(p.x - g.to.x, p.y - g.to.y)) };
  if (handle === "center")
    return { ...g, to: p, from: { x: g.from.x + p.x - g.to.x, y: g.from.y + p.y - g.to.y } };
  return { ...g, from: p };
}
export function vectorPaint(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  p: VectorPaint,
  l: Layer,
) {
  if (!p.gradient) return p.color;
  const g = p.gradient,
    m = gradientMatrix(g, l);
  const addStops = (gradient: CanvasGradient) => {
    for (const stop of g.stops) {
      const rgb = [1, 3, 5].map((n) => parseInt(stop.color.slice(n, n + 2), 16));
      gradient.addColorStop(stop.position, `rgba(${rgb.join(",")},${stop.opacity})`);
    }
    return gradient;
  };
  if (g.kind === "linear") {
    // A gradient parameter is a covector. Simply transforming its two endpoints
    // gives the wrong slope under nonuniform scale/shear.
    const inv = inverse(m),
      dx = g.to.x - g.from.x,
      dy = g.to.y - g.from.y,
      length2 = dx * dx + dy * dy,
      nx = (inv[0] * dx + inv[1] * dy) / length2,
      ny = (inv[2] * dx + inv[3] * dy) / length2,
      normal2 = nx * nx + ny * ny,
      from = applyMatrix(m, g.from);
    return addStops(
      ctx.createLinearGradient(from.x, from.y, from.x + nx / normal2, from.y + ny / normal2),
    );
  }
  // Canvas has no radial-gradient transform. Render its analytic circle under
  // the full affine matrix, then sample that plane without transforming strokes.
  const plane = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height),
    pc = plane.getContext("2d")!,
    current = ctx.getTransform();
  pc.setTransform(current);
  pc.transform(...m);
  pc.fillStyle = addStops(pc.createRadialGradient(g.from.x, g.from.y, 0, g.to.x, g.to.y, g.radius));
  const inv = pc.getTransform().inverse(),
    corners = [
      new DOMPoint(0, 0),
      new DOMPoint(plane.width, 0),
      new DOMPoint(0, plane.height),
      new DOMPoint(plane.width, plane.height),
    ].map((p) => p.matrixTransform(inv)),
    left = Math.min(...corners.map((p) => p.x)),
    top = Math.min(...corners.map((p) => p.y));
  pc.fillRect(
    left - 1,
    top - 1,
    Math.max(...corners.map((p) => p.x)) - left + 2,
    Math.max(...corners.map((p) => p.y)) - top + 2,
  );
  const pattern = ctx.createPattern(plane, "no-repeat")!;
  pattern.setTransform(current.inverse());
  plane.width = plane.height = 1; // createPattern captures the bitmap; release the scratch plane.
  return pattern;
}
