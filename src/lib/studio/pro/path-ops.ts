/** R9 path operations on native Bézier paths: split at an anchor, join two open paths,
 * simplify (remove anchors within a tolerance) and auto-smooth. All results stay
 * editable cubic contours in each layer's local space; nothing is rasterized. */
import {
  contourAt,
  contours,
  layer as newLayer,
  validateDocument,
  withContour,
  type Anchor,
  type Contour,
  type Layer,
  type Point,
  type ProDocument,
} from "./model.ts";
import { isLocked } from "./operations.ts";
import { affine, applyMatrix, compose, inverse, type Matrix } from "./transform.ts";
import { anchorCurve, cubicPoint, type Cubic } from "./bezier.ts";

const ANCHOR_LIMIT = 1000;
function nativePathLayer(doc: ProDocument, id: string): Layer {
  validateDocument(doc);
  const l = doc.layers.find((n) => n.id === id);
  if (!l || l.kind !== "shape" || l.shape !== "path" || l.pathData)
    throw Error("Choose a native Bézier path (Pen path or converted shape).");
  if (l.textPath || l.dialogueRole) throw Error("Text and Dialogue paths are edited elsewhere.");
  if (isLocked(doc, id)) throw Error("Unlock the path and its ancestors first.");
  return l;
}
const commit = (doc: ProDocument, layers: Layer[]) => {
  const result = { ...doc, layers };
  validateDocument(result);
  return result;
};
const replaceLayer = (doc: ProDocument, l: Layer) => doc.layers.map((n) => (n.id === l.id ? l : n));
const copy = (a: Anchor): Anchor => structuredClone(a);
const withoutIncoming = ({ incoming: _i, ...a }: Anchor): Anchor =>
  a.mode === "symmetric" || a.mode === "smooth" ? { ...a, mode: "corner" } : a;
const withoutOutgoing = ({ outgoing: _o, ...a }: Anchor): Anchor =>
  a.mode === "symmetric" || a.mode === "smooth" ? { ...a, mode: "corner" } : a;

// ---- Split ----------------------------------------------------------------------

/** Scissors at an anchor. A closed contour opens there (one layer); an open single-
 * contour path becomes two paths (the second is a new layer above the first). */
export function splitPathAt(doc: ProDocument, id: string, index: number, contour = 0) {
  const l = nativePathLayer(doc, id),
    c = contourAt(l, contour),
    n = c.anchors.length;
  if (!Number.isInteger(index) || index < 0 || index >= n)
    throw Error("Choose an existing anchor.");
  if (c.closed) {
    if (n < 2) throw Error("The contour is too short to open.");
    const rotated = [...c.anchors.slice(index), ...c.anchors.slice(0, index)].map(copy),
      first = withoutIncoming(rotated[0]!),
      last = withoutOutgoing(copy(c.anchors[index]!));
    const opened: Contour = { closed: false, anchors: [first, ...rotated.slice(1), last] };
    if (contours(l).reduce((s, k) => s + k.anchors.length, 0) + 1 > ANCHOR_LIMIT)
      throw Error("The path has reached the 1000-anchor limit.");
    return { document: commit(doc, replaceLayer(doc, withContour(l, contour, opened))), ids: [id] };
  }
  if (index === 0 || index === n - 1)
    throw Error("Choose an interior anchor to split an open path.");
  if (l.subpaths?.length) throw Error("Release the compound path before splitting a subpath.");
  const head: Contour = {
      closed: false,
      anchors: [...c.anchors.slice(0, index).map(copy), withoutOutgoing(copy(c.anchors[index]!))],
    },
    tail: Contour = {
      closed: false,
      anchors: [withoutIncoming(copy(c.anchors[index]!)), ...c.anchors.slice(index + 1).map(copy)],
    };
  const second: Layer = {
    ...structuredClone(l),
    ...tail,
    id: newLayer("shape", 1, 1).id,
    name: `${l.name} (split)`,
  };
  const layers = replaceLayer(doc, withContour(l, 0, head)),
    at = layers.findIndex((n) => n.id === l.id);
  layers.splice(at + 1, 0, second);
  return { document: commit(doc, layers), ids: [id, second.id] };
}

// ---- Join -----------------------------------------------------------------------

const mapAnchor = (m: Matrix, a: Anchor): Anchor => ({
  ...applyMatrix(m, a),
  ...(a.incoming ? { incoming: applyMatrix(m, a.incoming) } : {}),
  ...(a.outgoing ? { outgoing: applyMatrix(m, a.outgoing) } : {}),
  ...(a.mode ? { mode: a.mode } : {}),
});
const reversed = (anchors: Anchor[]) =>
  [...anchors].reverse().map(({ incoming, outgoing, ...a }) => ({
    ...a,
    ...(outgoing ? { incoming: outgoing } : {}),
    ...(incoming ? { outgoing: incoming } : {}),
  }));

/** Joins two open single-contour paths into the first, at their nearest endpoints.
 * Coincident endpoints (within `merge` px) become one anchor; otherwise a straight
 * segment connects them. The second path is removed; the first keeps its appearance. */
export function joinPaths(doc: ProDocument, firstId: string, secondId: string, merge = 0.5) {
  if (firstId === secondId) throw Error("Choose two different paths to join.");
  const a = nativePathLayer(doc, firstId),
    b = nativePathLayer(doc, secondId);
  if (a.subpaths?.length || b.subpaths?.length || a.closed || b.closed)
    throw Error("Join needs two open paths with a single contour each.");
  if (a.transform.deform || b.transform.deform)
    throw Error("Apply or reset Perspective/Warp before joining paths.");
  if (a.parentId !== b.parentId) throw Error("Join paths that are in the same group.");
  if (a.anchors.length + b.anchors.length > ANCHOR_LIMIT)
    throw Error("The joined path would exceed the 1000-anchor limit.");
  const m = compose(inverse(affine(a.transform)), affine(b.transform)),
    bLocal = b.anchors.map((p) => mapAnchor(m, p)),
    ends = [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ] as const;
  let best: { flipA: boolean; flipB: boolean; distance: number } | undefined;
  for (const [flipA, flipB] of ends) {
    const tail = (flipA ? a.anchors[0] : a.anchors.at(-1))!,
      head = (flipB ? bLocal.at(-1) : bLocal[0])!,
      distance = Math.hypot(tail.x - head.x, tail.y - head.y);
    if (!best || distance < best.distance - 1e-9) best = { flipA, flipB, distance };
  }
  const left = best!.flipA ? reversed(a.anchors) : a.anchors.map(copy),
    right = best!.flipB ? reversed(bLocal) : bLocal;
  let anchors: Anchor[];
  if (best!.distance <= merge) {
    const end = left.at(-1)!,
      start = right[0]!;
    const joined: Anchor = {
      x: end.x,
      y: end.y,
      ...(end.incoming ? { incoming: end.incoming } : {}),
      ...(start.outgoing
        ? {
            outgoing: {
              x: start.outgoing.x + end.x - start.x,
              y: start.outgoing.y + end.y - start.y,
            },
          }
        : {}),
      mode: "corner",
    };
    anchors = [...left.slice(0, -1), joined, ...right.slice(1)];
  } else anchors = [...left, ...right];
  const joined = { ...a, anchors, closed: false };
  return {
    document: commit(
      doc,
      doc.layers.filter((l) => l.id !== b.id).map((l) => (l.id === a.id ? joined : l)),
    ),
    ids: [a.id],
  };
}

// ---- Smooth ---------------------------------------------------------------------

/** Auto-smooth: handles parallel to the neighbour chord, one third of each adjacent
 * segment long (Catmull-Rom style). `indices` limits the change; open-path endpoints get a
 * single handle toward their neighbour. */
export function smoothPath(doc: ProDocument, id: string, contour = 0, indices?: number[]) {
  const l = nativePathLayer(doc, id),
    c = contourAt(l, contour),
    n = c.anchors.length,
    chosen = new Set(indices ?? c.anchors.map((_, i) => i));
  if (n < 2) throw Error("The contour needs at least two anchors.");
  const anchors = c.anchors.map((a, i) => {
    if (!chosen.has(i)) return copy(a);
    const prev = c.anchors[i > 0 ? i - 1 : c.closed ? n - 1 : -1],
      next = c.anchors[i + 1 < n ? i + 1 : c.closed ? 0 : -1];
    const { incoming: _i, outgoing: _o, ...base } = a;
    if (!prev || !next) {
      const other = (prev ?? next)!;
      const handle = { x: a.x + (other.x - a.x) / 3, y: a.y + (other.y - a.y) / 3 };
      return {
        ...base,
        mode: "corner" as const,
        ...(prev ? { incoming: handle } : { outgoing: handle }),
      };
    }
    const dx = next.x - prev.x,
      dy = next.y - prev.y,
      length = Math.hypot(dx, dy);
    if (length < 1e-9) return copy(a);
    const ux = dx / length,
      uy = dy / length,
      before = Math.hypot(a.x - prev.x, a.y - prev.y) / 3,
      after = Math.hypot(next.x - a.x, next.y - a.y) / 3;
    return {
      ...base,
      mode: "smooth" as const,
      incoming: { x: a.x - ux * before, y: a.y - uy * before },
      outgoing: { x: a.x + ux * after, y: a.y + uy * after },
    };
  });
  return commit(doc, replaceLayer(doc, withContour(l, contour, { ...c, anchors })));
}

// ---- Simplify -------------------------------------------------------------------

const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const unit = (v: Point) => {
  const n = Math.hypot(v.x, v.y);
  return n < 1e-12 ? undefined : { x: v.x / n, y: v.y / n };
};
function samples(curves: Cubic[], perCurve = 24) {
  const pts: Point[] = [];
  for (const c of curves)
    for (let i = pts.length ? 1 : 0; i <= perCurve; i++) pts.push(cubicPoint(c, i / perCurve));
  return pts;
}
/** One cubic from p0 to p3 with fixed tangent directions, least-squares handle lengths
 * (Schneider), fitted to sample points with chord-length parameters. */
function fitCubic(points: Point[], t1: Point, t2: Point): Cubic | undefined {
  const p0 = points[0]!,
    p3 = points.at(-1)!,
    d: number[] = [0];
  for (let i = 1; i < points.length; i++)
    d.push(
      d[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y),
    );
  const total = d.at(-1)!;
  if (total < 1e-9) return undefined;
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0;
  for (let i = 0; i < points.length; i++) {
    const u = d[i]! / total,
      b0 = (1 - u) ** 3,
      b1 = 3 * u * (1 - u) ** 2,
      b2 = 3 * u * u * (1 - u),
      b3 = u ** 3,
      a1 = { x: t1.x * b1, y: t1.y * b1 },
      a2 = { x: t2.x * b2, y: t2.y * b2 },
      tmp = sub(points[i]!, {
        x: p0.x * (b0 + b1) + p3.x * (b2 + b3),
        y: p0.y * (b0 + b1) + p3.y * (b2 + b3),
      });
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1: number, alpha2: number;
  if (Math.abs(det) > 1e-12) {
    alpha1 = (x0 * c11 - x1 * c01) / det;
    alpha2 = (c00 * x1 - c01 * x0) / det;
  } else alpha1 = alpha2 = total / 3;
  if (!(alpha1 > 1e-6) || !(alpha2 > 1e-6)) alpha1 = alpha2 = total / 3;
  return [
    p0,
    { x: p0.x + t1.x * alpha1, y: p0.y + t1.y * alpha1 },
    { x: p3.x + t2.x * alpha2, y: p3.y + t2.y * alpha2 },
    p3,
  ];
}
function maxDeviation(points: Point[], c: Cubic) {
  const curve = samples([c], 64);
  let worst = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1]!,
        b = curve[i]!,
        ab = sub(b, a),
        len = dot(ab, ab),
        t = len ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / len)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - ab.x * t, p.y - a.y - ab.y * t));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}
/** Remove anchors whose two adjacent segments can be replaced by one cubic within
 * `tolerance` source px. Greedy, least-error first; endpoints of open paths are kept. */
export function simplifyPath(doc: ProDocument, id: string, tolerance: number, contour = 0) {
  if (!(tolerance > 0 && tolerance <= 100)) throw Error("Use a tolerance between 0 and 100 px.");
  const l = nativePathLayer(doc, id),
    c = contourAt(l, contour);
  let anchors = c.anchors.map(copy),
    removed = 0;
  const minimum = c.closed ? 3 : 2;
  for (;;) {
    const n = anchors.length;
    if (n <= minimum) break;
    let best: { index: number; error: number; curve: Cubic } | undefined;
    for (let i = c.closed ? 0 : 1; i < (c.closed ? n : n - 1); i++) {
      const prev = anchors[(i - 1 + n) % n]!,
        a = anchors[i]!,
        next = anchors[(i + 1) % n]!,
        left = anchorCurve(prev, a),
        right = anchorCurve(a, next),
        t1 =
          unit(sub(left[1], left[0])) ?? unit(sub(left[2], left[0])) ?? unit(sub(left[3], left[0])),
        t2 =
          unit(sub(right[2], right[3])) ??
          unit(sub(right[1], right[3])) ??
          unit(sub(right[0], right[3]));
      if (!t1 || !t2) continue;
      const points = samples([left, right]),
        curve = fitCubic(points, t1, t2);
      if (!curve) continue;
      const error = maxDeviation(points, curve);
      if (error <= tolerance && (!best || error < best.error)) best = { index: i, error, curve };
    }
    if (!best) break;
    const i = best.index,
      prevIndex = (i - 1 + n) % n,
      nextIndex = (i + 1) % n,
      straight = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;
    const prev = { ...anchors[prevIndex]! },
      next = { ...anchors[nextIndex]! };
    // A straight fit stays a line segment (no handles), so polygons stay polygons.
    const isLine =
      maxDeviation(samples([best.curve], 16), [prev, prev, next, next] as Cubic) < 1e-6;
    if (isLine) {
      delete prev.outgoing;
      delete next.incoming;
    } else {
      prev.outgoing = best.curve[1];
      next.incoming = best.curve[2];
    }
    if (straight(prev, next)) break;
    anchors[prevIndex] = prev;
    anchors[nextIndex] = next;
    anchors = anchors.filter((_, k) => k !== i);
    removed++;
  }
  return {
    document: commit(doc, replaceLayer(doc, withContour(l, contour, { ...c, anchors }))),
    removed,
  };
}
