/** Phase D foundation: native cubic geometry, without flattening editable paths. */
import { validateDocument, type Anchor, type Point, type ProDocument } from "./model.ts";
import { isLocked } from "./operations.ts";
export type Cubic = [Point, Point, Point, Point];
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function checked(c: Cubic, t: number) {
  if (
    !Array.isArray(c) ||
    c.length !== 4 ||
    c.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
    !Number.isFinite(t) ||
    t < 0 ||
    t > 1
  )
    throw new Error("Invalid cubic geometry or parameter.");
}
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  checked(c, t);
  const a = lerp(c[0], c[1], t),
    b = lerp(c[1], c[2], t),
    d = lerp(c[2], c[3], t),
    e = lerp(a, b, t),
    f = lerp(b, d, t),
    p = lerp(e, f, t);
  return [
    [{ ...c[0] }, a, e, p],
    [{ ...p }, f, d, { ...c[3] }],
  ];
}
export function cubicPoint(c: Cubic, t: number): Point {
  return splitCubic(c, t)[0][3];
}
export function cubicDerivative(c: Cubic, t: number): Point {
  checked(c, t);
  const u = 1 - t;
  return {
    x:
      3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x),
    y:
      3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y),
  };
}
/** The curve length lies between chord and control polygon. Subdivide until their
 * summed gap gives a global absolute error bound; fail rather than hide exhausted work. */
export function cubicLength(c: Cubic, tolerance = 0.01): { length: number; errorBound: number } {
  checked(c, 0);
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Length tolerance must be positive.");
  const coordinateScale = Math.max(1, ...c.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
  if (tolerance < Number.EPSILON * coordinateScale * 32)
    throw new Error(
      "Cubic length floating-point precision budget exceeded. Use a larger tolerance.",
    );
  const stack = [{ curve: c, error: tolerance, depth: 0 }];
  let length = 0,
    errorBound = 0,
    work = 0;
  while (stack.length) {
    if (++work > 32768)
      throw new Error("Cubic length work budget exceeded. Use a larger tolerance.");
    const { curve, error, depth } = stack.pop()!,
      chord = distance(curve[0], curve[3]),
      polygon =
        distance(curve[0], curve[1]) + distance(curve[1], curve[2]) + distance(curve[2], curve[3]),
      gap = Math.max(0, polygon - chord);
    if (gap / 2 <= error) {
      length += (polygon + chord) / 2;
      errorBound += gap / 2;
      continue;
    }
    if (depth >= 24)
      throw new Error("Cubic length precision budget exceeded. Use a larger tolerance.");
    const [left, right] = splitCubic(curve, 0.5);
    stack.push(
      { curve: right, error: error / 2, depth: depth + 1 },
      { curve: left, error: error / 2, depth: depth + 1 },
    );
  }
  return { length, errorBound };
}
/** Invert arc distance with bounded bisection, including collinear nonuniform cubics. */
export function parameterAtLength(c: Cubic, value: number, tolerance = 0.01) {
  if (!Number.isFinite(value)) throw new Error("Arc distance must be finite.");
  const total = cubicLength(c, tolerance / 8).length;
  if (value <= 0 || !total) return 0;
  if (value >= total) return 1;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 48; i++) {
    const t = (lo + hi) / 2,
      length = cubicLength(splitCubic(c, t)[0], tolerance / 8).length;
    if (Math.abs(length - value) <= tolerance / 2) return t;
    if (length < value) lo = t;
    else hi = t;
  }
  throw new Error("Arc-distance inversion precision budget exceeded.");
}
export function anchorCurve(a: Anchor, b: Anchor): Cubic {
  return [
    { x: a.x, y: a.y },
    { ...(a.outgoing ?? a) },
    { ...(b.incoming ?? b) },
    { x: b.x, y: b.y },
  ];
}
/** One immutable document transaction. Closed closing segments wrap to anchor zero. */
export function splitAnchorSegment(
  doc: ProDocument,
  id: string,
  index: number,
  t: number,
): ProDocument {
  validateDocument(doc);
  const l = doc.layers.find((l) => l.id === id),
    count = l ? l.anchors.length - (l.closed ? 0 : 1) : 0;
  if (
    !l ||
    l.kind !== "shape" ||
    l.shape !== "path" ||
    l.pathData ||
    l.anchors.length < 2 ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= count ||
    !Number.isFinite(t) ||
    t <= 0 ||
    t >= 1
  )
    throw new Error(
      "Choose an interior parameter on a native anchor-path segment. Imported SVG path data needs conversion first.",
    );
  if (isLocked(doc, id))
    throw new Error("Unlock the path and its ancestors before editing anchors.");
  if (l.anchors.length >= 1000) throw new Error("The path has reached the 1000-anchor limit.");
  const anchors = structuredClone(l.anchors),
    a = anchors[index]!,
    b = anchors[(index + 1) % anchors.length]!,
    [left, right] = splitCubic(anchorCurve(a, b), t);
  a.outgoing = left[1];
  b.incoming = right[2];
  // Subdivision shortens just one side of adjacent symmetric anchors.
  if (a.mode === "symmetric") a.mode = "smooth";
  if (b.mode === "symmetric") b.mode = "smooth";
  anchors.splice(index + 1, 0, {
    ...left[3],
    incoming: left[2],
    outgoing: right[1],
    mode: "smooth",
  });
  const result = { ...doc, layers: doc.layers.map((n) => (n.id === id ? { ...n, anchors } : n)) };
  validateDocument(result);
  return result;
}
