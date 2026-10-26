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
const SAMPLES_PER_SEGMENT = 12;
/** Original-geometry samples of one segment, excluding its start point. */
function segmentSamples(c: Cubic) {
  const out: Point[] = [];
  for (let i = 1; i <= SAMPLES_PER_SEGMENT; i++) out.push(cubicPoint(c, i / SAMPLES_PER_SEGMENT));
  return out;
}
/** One cubic from p0 to p3 with fixed tangent directions and least-squares handle
 * lengths (Schneider), at chord-length parameters. Returns the fit and its maximum
 * residual |B(uᵢ) − pᵢ|, which bounds the distance to the original samples. */
function fitCubic(points: Point[], t1: Point, t2: Point) {
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
  const basis = d.map((di) => {
    const u = di / total;
    return [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3] as const;
  });
  for (let i = 0; i < points.length; i++) {
    const [b0, b1, b2, b3] = basis[i]!,
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
  let alpha1 = total / 3,
    alpha2 = total / 3;
  if (Math.abs(det) > 1e-12) {
    const s1 = (x0 * c11 - x1 * c01) / det,
      s2 = (c00 * x1 - c01 * x0) / det;
    if (s1 > 1e-6 && s2 > 1e-6) {
      alpha1 = s1;
      alpha2 = s2;
    }
  }
  const curve: Cubic = [
    p0,
    { x: p0.x + t1.x * alpha1, y: p0.y + t1.y * alpha1 },
    { x: p3.x + t2.x * alpha2, y: p3.y + t2.y * alpha2 },
    p3,
  ];
  let error = 0;
  for (let i = 0; i < points.length; i++) {
    const [b0, b1, b2, b3] = basis[i]!,
      x = curve[0].x * b0 + curve[1].x * b1 + curve[2].x * b2 + curve[3].x * b3,
      y = curve[0].y * b0 + curve[1].y * b1 + curve[2].y * b2 + curve[3].y * b3;
    error = Math.max(error, Math.hypot(points[i]!.x - x, points[i]!.y - y));
  }
  return { curve, error };
}
/** Remove anchors whose two adjacent segments can be replaced by one cubic within
 * `tolerance` source px of the ORIGINAL geometry (errors never accumulate). Greedy,
 * least-error first, with cached candidates so only the two neighbours of a removed
 * anchor are re-fitted. Endpoints of open paths are kept; straight fits stay lines. */
export function simplifyPath(doc: ProDocument, id: string, tolerance: number, contour = 0) {
  if (!(tolerance > 0 && tolerance <= 100)) throw Error("Use a tolerance between 0 and 100 px.");
  const l = nativePathLayer(doc, id),
    c = contourAt(l, contour),
    count = c.anchors.length,
    minimum = c.closed ? 3 : 2;
  // Linked list over anchors; samples[i] = original samples of the segment leaving i.
  const anchors = c.anchors.map(copy),
    prev = anchors.map((_, i) => (i > 0 ? i - 1 : c.closed ? count - 1 : -1)),
    next = anchors.map((_, i) => (i + 1 < count ? i + 1 : c.closed ? 0 : -1)),
    alive = anchors.map(() => true),
    samples: Point[][] = anchors.map((a, i) =>
      next[i]! >= 0 ? segmentSamples(anchorCurve(a, anchors[next[i]!]!)) : [],
    ),
    cache = new Map<number, { error: number; curve: Cubic } | null>();
  let remaining = count;
  const candidate = (i: number) => {
    if (cache.has(i)) return cache.get(i)!;
    let result: { error: number; curve: Cubic } | null = null;
    const p = prev[i]!,
      n = next[i]!;
    if (p >= 0 && n >= 0 && p !== n) {
      const a = anchors[p]!,
        b = anchors[n]!,
        left = anchorCurve(a, anchors[i]!),
        right = anchorCurve(anchors[i]!, b),
        t1 =
          unit(sub(left[1], left[0])) ?? unit(sub(left[2], left[0])) ?? unit(sub(left[3], left[0])),
        t2 =
          unit(sub(right[2], right[3])) ??
          unit(sub(right[1], right[3])) ??
          unit(sub(right[0], right[3])),
        points = [{ x: a.x, y: a.y }, ...samples[p]!, ...samples[i]!];
      if (t1 && t2) {
        const fit = fitCubic(points, t1, t2);
        if (fit && fit.error <= tolerance) result = fit;
      }
    }
    cache.set(i, result);
    return result;
  };
  let removed = 0;
  while (remaining > minimum) {
    let best = -1,
      bestError = Infinity;
    for (let i = 0; i < count; i++) {
      if (!alive[i]) continue;
      const fit = candidate(i);
      if (fit && fit.error < bestError) {
        bestError = fit.error;
        best = i;
      }
    }
    if (best < 0) break;
    const fit = cache.get(best)!,
      p = prev[best]!,
      n = next[best]!,
      a = anchors[p]!,
      b = anchors[n]!;
    // A straight fit (handles on the chord) stays a line segment, so polygons stay polygons.
    const chord = sub(b, a),
      length = Math.hypot(chord.x, chord.y),
      offChord = (q: Point) =>
        length ? Math.abs((q.x - a.x) * chord.y - (q.y - a.y) * chord.x) / length : 0;
    if (offChord(fit.curve[1]) < 1e-6 && offChord(fit.curve[2]) < 1e-6) {
      delete a.outgoing;
      delete b.incoming;
    } else {
      a.outgoing = fit.curve[1];
      b.incoming = fit.curve[2];
    }
    samples[p] = [...samples[p]!, ...samples[best]!];
    next[p] = n;
    prev[n] = p;
    alive[best] = false;
    remaining--;
    removed++;
    for (const k of [p, n, prev[p]!, next[n]!]) if (k >= 0) cache.delete(k);
  }
  const result: Anchor[] = [];
  for (let i = 0; i < count; i++) if (alive[i]) result.push(anchors[i]!);
  return {
    document: commit(doc, replaceLayer(doc, withContour(l, contour, { ...c, anchors: result }))),
    removed,
  };
}
