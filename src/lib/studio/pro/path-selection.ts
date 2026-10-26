/** Raster Studio path ↔ selection bridge. Paths are flattened with adaptive Bézier
 * subdivision and scan-converted at document resolution (exact horizontal coverage,
 * four sub-scanlines), so a loaded path is real anti-aliased selection coverage. The
 * reverse direction traces coverage with marching squares at the 50% level and
 * simplifies it into an editable path. Source layers are never modified here. */
import {
  contours,
  layer,
  validateDocument,
  type Anchor,
  type Contour,
  type Layer,
  type Point,
  type ProDocument,
  type Region,
} from "./model.ts";
import { affine, applyMatrix, compose, inverse, type Matrix } from "./transform.ts";
import { anchorCurve, splitCubic, type Cubic } from "./bezier.ts";
import { nativePath } from "./compound.ts";
import { coverageRegion } from "./refine-selection.ts";
import { siblings } from "./layers.ts";
import type { VectorClip } from "./vector-clip.ts";

export type FillRule = "nonzero" | "evenodd";
const SUBSAMPLES = 4,
  PATH_ANCHOR_LIMIT = 1000,
  PATH_CONTOUR_LIMIT = 128;

function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    square = dx * dx + dy * dy,
    t = square ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / square)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function flatten(c: Cubic, tolerance: number, out: Point[], depth = 0) {
  if (
    depth >= 16 ||
    Math.max(segmentDistance(c[1], c[0], c[3]), segmentDistance(c[2], c[0], c[3])) <= tolerance
  ) {
    out.push(c[3]);
    return;
  }
  const [a, b] = splitCubic(c, 0.5);
  flatten(a, tolerance, out, depth + 1);
  flatten(b, tolerance, out, depth + 1);
}
function editableShape(l: Layer | undefined): Layer {
  if (!l || l.kind !== "shape")
    throw Error("Select a vector path or shape layer (rectangle, ellipse, polygon or Pen path).");
  if (l.transform.deform)
    throw Error("Apply or reset Perspective/Warp on the path before converting it.");
  return l;
}

/** Document-space polygons of a shape layer. Open contours are closed implicitly, as a
 * fill would close them. */
export function pathPolygons(l: Layer, tolerance = 0.2): Point[][] {
  const m = affine(editableShape(l).transform),
    norm = Math.max(1, Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])),
    native = nativePath(l, Math.max(1e-4, tolerance / 4 / norm)),
    out: Point[][] = [];
  for (const c of contours(native)) {
    if (c.anchors.length < 2) continue;
    const points: Point[] = [applyMatrix(m, c.anchors[0]!)],
      count = c.closed ? c.anchors.length : c.anchors.length - 1;
    for (let i = 0; i < count; i++) {
      const a = c.anchors[i]!,
        b = c.anchors[(i + 1) % c.anchors.length]!;
      if (!a.outgoing && !b.incoming) points.push(applyMatrix(m, b));
      else flatten(anchorCurve(a, b).map((p) => applyMatrix(m, p)) as Cubic, tolerance, points);
    }
    if (points.length >= 3) out.push(points);
  }
  return out;
}

/** Anti-aliased coverage (0–255) of polygons filled with `rule`. */
export function rasterizePolygons(
  polygons: Point[][],
  rule: FillRule,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  type Edge = { y0: number; y1: number; x: number; slope: number; dir: number };
  const edges: Edge[] = [];
  for (const poly of polygons)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!,
        b = poly[(i + 1) % poly.length]!;
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) throw Error("Invalid path geometry.");
      if (a.y === b.y) continue;
      const [top, bottom, dir] = a.y < b.y ? [a, b, 1] : [b, a, -1];
      edges.push({
        y0: top.y,
        y1: bottom.y,
        x: top.x,
        slope: (bottom.x - top.x) / (bottom.y - top.y),
        dir,
      });
    }
  if (!edges.length) return out;
  edges.sort((a, b) => a.y0 - b.y0);
  const first = Math.max(0, Math.floor(edges[0]!.y0)),
    last = Math.min(height - 1, Math.ceil(Math.max(...edges.map((e) => e.y1))));
  const acc = new Float64Array(width + 1),
    diff = new Float64Array(width + 2),
    crossings: Array<[number, number]> = [];
  let active: Edge[] = [],
    next = 0;
  for (let y = first; y <= last; y++) {
    acc.fill(0);
    diff.fill(0);
    for (let k = 0; k < SUBSAMPLES; k++) {
      const sy = y + (k + 0.5) / SUBSAMPLES;
      while (next < edges.length && edges[next]!.y0 <= sy) active.push(edges[next++]!);
      active = active.filter((e) => e.y1 > sy);
      crossings.length = 0;
      for (const e of active) if (e.y0 <= sy) crossings.push([e.x + (sy - e.y0) * e.slope, e.dir]);
      crossings.sort((a, b) => a[0] - b[0]);
      let winding = 0;
      for (let i = 0; i < crossings.length - 1; i++) {
        winding += crossings[i]![1];
        const inside = rule === "evenodd" ? (i + 1) % 2 === 1 : winding !== 0;
        if (!inside) continue;
        const xa = Math.max(0, Math.min(width, crossings[i]![0])),
          xb = Math.max(0, Math.min(width, crossings[i + 1]![0]));
        if (xb <= xa) continue;
        const ia = Math.floor(xa),
          ib = Math.floor(xb);
        if (ia === ib) acc[ia] += xb - xa;
        else {
          acc[ia] += ia + 1 - xa;
          diff[ia + 1] += 1;
          diff[ib] -= 1;
          if (ib < width) acc[ib] += xb - ib;
        }
      }
    }
    let run = 0;
    for (let x = 0; x < width; x++) {
      run += diff[x]!;
      const value = Math.round(Math.min(1, (acc[x]! + run) / SUBSAMPLES) * 255);
      if (value) out[y * width + x] = value;
    }
  }
  return out;
}

/** Union of the selected shapes' fill areas as document coverage. */
export function pathCoverage(d: ProDocument, ids: string[]): Uint8Array {
  validateDocument(d);
  if (!ids.length) throw Error("Select one or more vector paths or shapes.");
  const out = new Uint8Array(d.width * d.height);
  for (const id of ids) {
    const l = editableShape(d.layers.find((n) => n.id === id)),
      coverage = rasterizePolygons(pathPolygons(l), l.fillRule ?? "nonzero", d.width, d.height);
    for (let i = 0; i < out.length; i++) if (coverage[i]! > out[i]!) out[i] = coverage[i]!;
  }
  if (!out.some(Boolean)) throw Error("The selected path encloses no area inside the canvas.");
  return out;
}

/** Selection region (document frame) covering the selected paths. */
export function pathSelectionRegion(d: ProDocument, ids: string[]): Region {
  return coverageRegion(pathCoverage(d, ids), d.width, d.height);
}

// ---- Selection → path -------------------------------------------------------

/** Closed contours along the 50% coverage level (marching squares on pixel centres). */
export function traceCoverage(alpha: ArrayLike<number>, width: number, height: number) {
  const threshold = 127.5,
    value = (i: number, j: number) =>
      i < 0 || j < 0 || i >= width || j >= height ? 0 : alpha[j * width + i]!,
    // Edge keys: horizontal edge (i,j)→(i+1,j) and vertical edge (i,j)→(i,j+1) between
    // pixel centres; padded by one so every loop closes.
    hKey = (i: number, j: number) => ((j + 1) * (width + 2) + (i + 1)) * 2,
    vKey = (i: number, j: number) => ((j + 1) * (width + 2) + (i + 1)) * 2 + 1,
    point = (key: number): Point => {
      const vertical = key % 2,
        cell = key >> 1,
        i = (cell % (width + 2)) - 1,
        j = Math.floor(cell / (width + 2)) - 1,
        a = value(i, j),
        b = vertical ? value(i, j + 1) : value(i + 1, j),
        t = (threshold - a) / (b - a);
      return vertical ? { x: i + 0.5, y: j + 0.5 + t } : { x: i + 0.5 + t, y: j + 0.5 };
    };
  const next = new Map<number, number>();
  const link = (from: number, to: number, corner: Point, inside: boolean, i: number, j: number) => {
    // Orient so the inside is always on the same side, which makes loops chain uniquely.
    const p = point(from),
      q = point(to),
      cross = (q.x - p.x) * (corner.y + j + 0.5 - p.y) - (q.y - p.y) * (corner.x + i + 0.5 - p.x);
    if (cross > 0 === inside) next.set(from, to);
    else next.set(to, from);
  };
  for (let j = -1; j < height; j++)
    for (let i = -1; i < width; i++) {
      const tl = value(i, j) > threshold,
        tr = value(i + 1, j) > threshold,
        br = value(i + 1, j + 1) > threshold,
        bl = value(i, j + 1) > threshold,
        code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = hKey(i, j),
        B = hKey(i, j + 1),
        L = vKey(i, j),
        R = vKey(i + 1, j),
        TL = { x: 0, y: 0 },
        TR = { x: 1, y: 0 },
        BR = { x: 1, y: 1 },
        BL = { x: 0, y: 1 };
      if (code === 5 || code === 10) {
        const center =
          (value(i, j) + value(i + 1, j) + value(i + 1, j + 1) + value(i, j + 1)) / 4 > threshold;
        // Isolate the two corners whose state differs from the centre.
        if ((code === 5) === center) {
          link(T, L, TL, tl, i, j);
          link(R, B, BR, br, i, j);
        } else {
          link(T, R, TR, tr, i, j);
          link(L, B, BL, bl, i, j);
        }
        continue;
      }
      // Single segment: separate the minority corner(s).
      const segments: Array<[number, number, Point, boolean]> = [];
      switch (code) {
        case 1:
        case 14:
          segments.push([L, B, BL, bl]);
          break;
        case 2:
        case 13:
          segments.push([B, R, BR, br]);
          break;
        case 4:
        case 11:
          segments.push([T, R, TR, tr]);
          break;
        case 8:
        case 7:
          segments.push([T, L, TL, tl]);
          break;
        case 3:
        case 12:
          segments.push([L, R, BL, bl]);
          break;
        case 6:
        case 9:
          segments.push([T, B, TR, tr]);
          break;
      }
      for (const [a, b, corner, inside] of segments) link(a, b, corner, inside, i, j);
    }
  const loops: Point[][] = [];
  for (const startKey of [...next.keys()]) {
    if (!next.has(startKey)) continue;
    const loop: Point[] = [];
    let key = startKey;
    while (next.has(key)) {
      const to = next.get(key)!;
      next.delete(key);
      loop.push(point(key));
      key = to;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
const area = (p: Point[]) =>
  p.reduce((n, a, i) => {
    const b = p[(i + 1) % p.length]!;
    return n + a.x * b.y - b.x * a.y;
  }, 0) / 2;
function simplifyOpen(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  let index = 0,
    max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i]!, points[0]!, points.at(-1)!);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [points[0]!, points.at(-1)!];
  const left = simplifyOpen(points.slice(0, index + 1), tolerance),
    right = simplifyOpen(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}
/** Ramer–Douglas–Peucker for a closed loop, split at its two most distant points. */
export function simplifyLoop(loop: Point[], tolerance: number): Point[] {
  if (loop.length <= 4) return loop;
  let far = 0,
    best = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i]!.x - loop[0]!.x, loop[i]!.y - loop[0]!.y);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplifyOpen(loop.slice(0, far + 1), tolerance),
    b = simplifyOpen([...loop.slice(far), loop[0]!], tolerance);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : loop;
}

/** Selection coverage → closed corner contours (document space) that fit the native path
 * limits. Tolerance grows automatically when needed; the smallest islands beyond the
 * contour limit are dropped and counted. */
export function coverageContours(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  tolerance = 0.75,
) {
  const loops = traceCoverage(alpha, width, height)
    .map((loop) => ({ loop, area: Math.abs(area(loop)) }))
    .filter((l) => l.area >= 1)
    .sort((a, b) => b.area - a.area);
  if (!loops.length) throw Error("The selection is empty; nothing to convert to a path.");
  const kept = loops.slice(0, PATH_CONTOUR_LIMIT),
    dropped = loops.length - kept.length;
  for (let t = tolerance; t <= 64; t *= 1.5) {
    const simplified = kept.map((l) => simplifyLoop(l.loop, t)).filter((p) => p.length >= 3);
    if (simplified.reduce((n, p) => n + p.length, 0) <= PATH_ANCHOR_LIMIT)
      return { contours: simplified, tolerance: t, dropped };
  }
  throw Error("The selection is too detailed for an editable path. Simplify the selection.");
}

/** Editable path layer (Pen-style: no fill, stroked) from document-space contours. */
export function pathLayerFromContours(
  polygons: Point[][],
  options: { name: string; stroke: string; strokeWidth?: number; parentId?: string },
): Layer {
  const points = polygons.flat(),
    x = Math.floor(Math.min(...points.map((p) => p.x))),
    y = Math.floor(Math.min(...points.map((p) => p.y))),
    width = Math.max(1, Math.ceil(Math.max(...points.map((p) => p.x))) - x),
    height = Math.max(1, Math.ceil(Math.max(...points.map((p) => p.y))) - y),
    round = (n: number) => Math.round(n * 1000) / 1000,
    cs: Contour[] = polygons.map((p) => ({
      closed: true,
      anchors: p.map((a) => ({ x: round(a.x - x), y: round(a.y - y), mode: "corner" as const })),
    }));
  return {
    ...layer("shape", width, height),
    name: options.name,
    ...(options.parentId ? { parentId: options.parentId } : {}),
    shape: "path",
    ...cs[0]!,
    subpaths: cs.slice(1),
    fillRule: "evenodd",
    vectorOverflow: true,
    transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
    fill: "transparent",
    stroke: options.stroke,
    strokeWidth: options.strokeWidth ?? 2,
  };
}

// ---- Vector masks (vector clips) -------------------------------------------------

const mapAnchor = (m: Matrix, a: Anchor): Anchor => ({
  ...applyMatrix(m, a),
  ...(a.incoming ? { incoming: applyMatrix(m, a.incoming) } : {}),
  ...(a.outgoing ? { outgoing: applyMatrix(m, a.outgoing) } : {}),
  ...(a.mode ? { mode: a.mode } : {}),
});
const mapContours = (m: Matrix, cs: Contour[]) =>
  cs.map((c) => ({ closed: c.closed, anchors: c.anchors.map((a) => mapAnchor(m, a)) }));

/** Vector mask for a shape/text target from one path, in the target's local space. The
 * path keeps its curves; nothing is rasterized. */
export function vectorClipFromPath(d: ProDocument, targetId: string, pathId: string): VectorClip {
  const target = d.layers.find((l) => l.id === targetId),
    source = editableShape(d.layers.find((l) => l.id === pathId));
  if (!target || !["shape", "text"].includes(target.kind))
    throw Error("Vector masks apply to shape and text layers. Use a layer mask for pixels.");
  if (target.id === source.id) throw Error("Choose a different layer to mask.");
  if (target.transform.deform)
    throw Error("Apply or reset Perspective/Warp on the target before adding a vector mask.");
  if ((target.vectorClips?.length ?? 0) >= 8)
    throw Error("A layer supports at most eight vector masks.");
  const native = nativePath(source),
    m = compose(inverse(affine(target.transform)), affine(source.transform)),
    cs = mapContours(m, contours(native)).map((c) => ({ ...c, closed: true }));
  if (!cs.some((c) => c.anchors.length >= 2)) throw Error("The path has no area to mask with.");
  return {
    contours: cs,
    matrix: [1, 0, 0, 1, 0, 0],
    rule: source.fillRule ?? "nonzero",
    enabled: true,
  };
}

/** Turns a vector mask back into an editable path layer above its target (document
 * space) and removes the mask. Re-applying the edited path restores it. */
export function releaseVectorClip(
  d: ProDocument,
  targetId: string,
  index: number,
  stroke: string,
): { document: ProDocument; id: string } {
  const target = d.layers.find((l) => l.id === targetId),
    clip = target?.vectorClips?.[index];
  if (!target || !clip) throw Error("That vector mask no longer exists.");
  const world = mapContours(compose(affine(target.transform), clip.matrix), clip.contours),
    points = world.flatMap((c) => c.anchors.flatMap((a) => [a, a.incoming ?? a, a.outgoing ?? a])),
    x = Math.floor(Math.min(...points.map((p) => p.x))),
    y = Math.floor(Math.min(...points.map((p) => p.y))),
    local = mapContours([1, 0, 0, 1, -x, -y], world);
  if (local.length > PATH_CONTOUR_LIMIT)
    throw Error("This vector mask has too many contours to edit as one path.");
  const path: Layer = {
    ...layer(
      "shape",
      Math.max(1, Math.ceil(Math.max(...points.map((p) => p.x))) - x),
      Math.max(1, Math.ceil(Math.max(...points.map((p) => p.y))) - y),
    ),
    name: `${target.name} vector mask`,
    ...(target.parentId ? { parentId: target.parentId } : {}),
    shape: "path",
    ...local[0]!,
    subpaths: local.slice(1),
    fillRule: clip.rule,
    vectorOverflow: true,
    transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
    fill: "transparent",
    stroke,
    strokeWidth: 2,
  };
  // Insert above the target's clipping stack so clipped layers keep their base.
  const peers = siblings(d, target.parentId);
  let top = peers.indexOf(target);
  while (peers[top + 1]?.clipped) top++;
  const at = d.layers.indexOf(peers[top]!),
    clips = target.vectorClips!.filter((_, i) => i !== index),
    layers = d.layers.map((l) => {
      if (l.id !== target.id) return l;
      const { vectorClips: _removed, ...rest } = l;
      return clips.length ? { ...rest, vectorClips: clips } : rest;
    });
  layers.splice(at + 1, 0, path);
  const document = { ...d, layers };
  validateDocument(document);
  return { document, id: path.id };
}
