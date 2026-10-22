import {
  contourAt,
  layer,
  validateDocument,
  type Anchor,
  type Contour,
  type Layer,
  type Point,
  type ProDocument,
} from "./model.ts";
import { nativePath } from "./compound.ts";
import { anchorCurve, cubicLength, parameterAtLength, splitCubic, type Cubic } from "./bezier.ts";
import { isLocked } from "./operations.ts";
export type TextPath = {
  offset?: number;
  start: number;
  end: number;
  baseline: number;
  reverse: boolean;
};
export const defaultTextPath = (): TextPath => ({ start: 0, end: 0, baseline: 0, reverse: false });
export function validateTextPath(l: Layer) {
  const p = l.textPath;
  if (p === undefined) return;
  if (
    l.kind !== "text" ||
    l.pathData ||
    l.subpaths?.length ||
    l.anchors.length < 2 ||
    ![p.start, p.end].every((n) => Number.isFinite(n) && n >= 0 && n <= 100000) ||
    (p.offset !== undefined && (!Number.isFinite(p.offset) || Math.abs(p.offset) > 100000)) ||
    !Number.isFinite(p.baseline) ||
    Math.abs(p.baseline) > 10000 ||
    typeof p.reverse !== "boolean" ||
    /[\n\r\t]/.test(l.text)
  )
    throw Error("Text-on-path requires one native contour, finite offsets and a single text line.");
  measureTextPath(l); // Reject excessive baselines transactionally, before UI/rendering.
}
export function reversedContour(c: Contour): Contour {
  const anchors = c.closed
    ? [c.anchors[0]!, ...c.anchors.slice(1).reverse()]
    : [...c.anchors].reverse();
  return {
    closed: c.closed,
    anchors: anchors.map((a) => ({ ...a, incoming: a.outgoing, outgoing: a.incoming })),
  };
}
export function attachText(d: ProDocument, id: string, contour = 0) {
  const source = d.layers.find((l) => l.id === id);
  if (!source || source.kind !== "shape" || isLocked(d, id))
    throw Error("Select an unlocked vector path to create text on a contour.");
  const path = nativePath(source),
    c = contourAt(path, contour);
  if (c.anchors.length < 2) throw Error("Choose a contour with at least two anchors.");
  const l = layer("text", source.width, source.height);
  Object.assign(l, structuredClone(c));
  l.name = "Text on path";
  l.shape = "path";
  l.text = "Your story follows the curve";
  l.fontSize = Math.min(32, Math.max(4, source.width / 12));
  l.strokeWidth = 0;
  l.textPath = defaultTextPath();
  l.transform = structuredClone(source.transform);
  l.parentId = source.parentId;
  l.fill = source.fill === "transparent" ? "#f3efe6" : source.fill;
  const document = { ...d, layers: [...d.layers, l] };
  validateDocument(document);
  return { document, id: l.id };
}
type Measure = { points: Point[]; distances: number[]; length: number };
const cache = new WeakMap<object, Map<string, Measure>>();
/** Cached adaptive arc polyline (0.01 local px geometric/length budget). Native cubics stay exact. */
export function measureTextPath(l: Layer): Measure {
  const settings = l.textPath!,
    key = `${l.closed}:${settings.reverse}`;
  let entries = cache.get(l.anchors);
  if (!entries) {
    entries = new Map();
    cache.set(l.anchors, entries);
  }
  const existing = entries.get(key);
  if (existing) return existing;
  const c = settings.reverse ? reversedContour(contourAt(l)) : contourAt(l),
    points: Point[] = [c.anchors[0]!];
  const count = c.anchors.length - (c.closed ? 0 : 1);
  let visits = 0;
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const walk = (curve: Cubic, budget: number, depth: number) => {
    if (++visits > 65536 || depth > 24)
      throw Error("Text baseline exceeds the adaptive geometry budget.");
    const length =
        distance(curve[0], curve[1]) + distance(curve[1], curve[2]) + distance(curve[2], curve[3]),
      chord = distance(curve[0], curve[3]);
    const cross = (p: Point) =>
      chord
        ? Math.abs(
            (p.x - curve[0].x) * (curve[3].y - curve[0].y) -
              (p.y - curve[0].y) * (curve[3].x - curve[0].x),
          ) / chord
        : distance(curve[0], p);
    if (length - chord <= budget && Math.max(cross(curve[1]), cross(curve[2])) < 0.01)
      points.push(curve[3]);
    else {
      const [a, b] = splitCubic(curve, 0.5);
      walk(a, budget / 2, depth + 1);
      walk(b, budget / 2, depth + 1);
    }
  };
  for (let i = 0; i < count; i++)
    walk(anchorCurve(c.anchors[i]!, c.anchors[(i + 1) % c.anchors.length]!), 0.01 / count, 0);
  const distances = [0];
  for (let i = 1; i < points.length; i++)
    distances.push(distances[i - 1]! + distance(points[i - 1]!, points[i]!));
  const result = { points, distances, length: distances.at(-1)! };
  entries.set(key, result);
  return result;
}
export function pathPosition(m: Measure, distance: number) {
  if (!Number.isFinite(distance)) throw Error("Invalid text arc distance.");
  const d = Math.max(0, Math.min(m.length, distance));
  let low = 1,
    high = m.points.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (m.distances[mid]! < d) low = mid + 1;
    else high = mid;
  }
  const a = m.points[low - 1]!,
    b = m.points[low]!,
    span = m.distances[low]! - m.distances[low - 1]!,
    t = span ? (d - m.distances[low - 1]!) / span : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}
export function graphemes(text: string): string[] {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(
    (s) => s.segment,
  );
}
/** Latin/Greek/Cyrillic/CJK/emoji graphemes; contextual and RTL shaping is explicitly guarded. */
export function checkPathText(text: string) {
  if (
    /[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]|\p{Bidi_Control}/u.test(
      text,
    )
  )
    throw Error(
      "This text-on-path version cannot shape contextual/RTL scripts faithfully. Use ordinary text or SVG with an external text shaper.",
    );
}
export function layoutPathText(l: Layer, measure: (text: string) => number) {
  checkPathText(l.text);
  const p = l.textPath!,
    m = measureTextPath(l),
    characters = graphemes(l.text),
    widths = characters.map(measure);
  const length =
      widths.reduce((n, w) => n + w, 0) + Math.max(0, characters.length - 1) * l.letterSpacing,
    available = Math.max(0, m.length - p.start - p.end),
    ratio = l.align === "left" ? 0 : l.align === "center" ? 0.5 : 1;
  let cursor = p.start + (p.offset ?? 0) + (available - length) * ratio;
  return characters.flatMap((text, i) => {
    const width = widths[i]!,
      distance = cursor + width / 2;
    cursor += width + l.letterSpacing;
    return distance >= p.start && distance <= m.length - p.end && m.length > 0
      ? [{ text, width, ...pathPosition(m, distance) }]
      : [];
  });
}
/** Exact cubic clipping for SVG textPath start/end regions; only boundary segments subdivide. */
export function trimmedTextContour(l: Layer): Contour {
  const p = l.textPath!,
    c = p.reverse ? reversedContour(contourAt(l)) : contourAt(l),
    curves = Array.from({ length: c.anchors.length - (c.closed ? 0 : 1) }, (_, i) =>
      anchorCurve(c.anchors[i]!, c.anchors[(i + 1) % c.anchors.length]!),
    ),
    lengths = curves.map((c) => cubicLength(c, 0.001).length),
    total = lengths.reduce((a, b) => a + b, 0),
    end = Math.max(p.start, total - p.end),
    output: Cubic[] = [];
  let offset = 0;
  for (let i = 0; i < curves.length; i++) {
    const length = lengths[i]!,
      a = Math.max(0, p.start - offset),
      b = Math.min(length, end - offset);
    if (b > a) {
      const first = a ? parameterAtLength(curves[i]!, a, 0.001) : 0,
        last = b < length ? parameterAtLength(curves[i]!, b, 0.001) : 1;
      let curve = curves[i]!;
      if (last < 1) curve = splitCubic(curve, last)[0];
      if (first > 0) curve = splitCubic(curve, first / last)[1];
      output.push(curve);
    }
    offset += length;
  }
  if (!output.length) return { anchors: [], closed: false };
  const anchors: Anchor[] = [{ ...output[0]![0], outgoing: output[0]![1] }];
  for (let i = 0; i < output.length; i++)
    anchors.push({
      ...output[i]![3],
      incoming: output[i]![2],
      ...(output[i + 1] ? { outgoing: output[i + 1]![1] } : {}),
    });
  return { anchors, closed: false };
}
