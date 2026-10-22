import {
  contours,
  worldPoint,
  validateDocument,
  type Layer,
  type Point,
  type ProDocument,
} from "./model.ts";
import { bounds } from "./transform.ts";
import { nativePath } from "./compound.ts";
import { anchorCurve, cubicPoint } from "./bezier.ts";
import {
  descendants,
  selectedRoots,
  translateLayers,
  translationIds,
  visibleLayerIds,
} from "./layers.ts";
import { artboards, layout, unionFrames, type Frame } from "./artboards.ts";
export type SnapGuide = { axis: "x" | "y"; position: number; kind: string };
type Candidate = SnapGuide & { priority: number; id: string };
export type SnapIndex = { x: Candidate[]; y: Candidate[]; points: Point[]; boxes: Frame[] };
/** Geometric fill/centerline bounds (stroke/effect extents deliberately excluded).
 * Cubic derivative roots preserve extrema after affine transforms, not just control hulls. */
export function layerBounds(l: Layer): Frame {
  if (l.kind !== "shape" || l.transform.deform) return bounds(l.transform, l.width, l.height);
  const n = nativePath(l),
    points: Point[] = [];
  for (const c of contours(n)) {
    points.push(...c.anchors.map((a) => worldPoint(a, n)));
    for (let i = 0; i < c.anchors.length - (c.closed ? 0 : 1); i++) {
      const curve = anchorCurve(c.anchors[i]!, c.anchors[(i + 1) % c.anchors.length]!).map((p) =>
        worldPoint(p, n),
      ) as ReturnType<typeof anchorCurve>;
      for (const axis of ["x", "y"] as const) {
        const [p, q, r, s] = curve.map((p) => p[axis]),
          a = -p! + 3 * q! - 3 * r! + s!,
          b = 2 * (p! - 2 * q! + r!),
          cc = q! - p!;
        const discriminant = b * b - 4 * a * cc;
        const roots =
          Math.abs(a) < 1e-12
            ? Math.abs(b) > 1e-12
              ? [-cc / b]
              : []
            : discriminant >= 0
              ? [(-b + Math.sqrt(discriminant)) / (2 * a), (-b - Math.sqrt(discriminant)) / (2 * a)]
              : [];
        for (const t of roots) if (t > 0 && t < 1) points.push(cubicPoint(curve, t));
      }
    }
  }
  return points.length
    ? unionFrames(points.map((p) => ({ ...p, width: 0, height: 0 })))
    : bounds(l.transform, l.width, l.height);
}
export function objectBounds(d: ProDocument, id: string): Frame | undefined {
  const ids = descendants(d, [id]),
    boxes = d.layers.filter((l) => ids.has(l.id) && l.kind !== "group").map(layerBounds);
  return boxes.length ? unionFrames(boxes) : undefined;
}
export function selectionBounds(d: ProDocument, ids: string[]) {
  const members = translationIds(d, ids);
  const boxes = d.layers.filter((l) => members.has(l.id) && l.kind !== "group").map(layerBounds);
  return unionFrames(boxes);
}
export function buildSnapIndex(
  d: ProDocument,
  excluded: string[] = [],
  boardId?: string,
): SnapIndex {
  validateDocument(d);
  const index: SnapIndex = { x: [], y: [], points: [], boxes: [] },
    s = layout(d),
    skip = translationIds(d, excluded),
    visible = visibleLayerIds(d);
  const axis = (axis: "x" | "y", position: number, kind: string, priority: number, id: string) =>
    index[axis].push({ axis, position, kind, priority, id });
  const box = (b: Frame, kind: string, priority: number, id: string) => {
    for (const [a, size] of [
      ["x", "width"],
      ["y", "height"],
    ] as const)
      for (const ratio of [0, 0.5, 1]) axis(a, b[a] + b[size] * ratio, kind, priority, id);
  };
  if (s.modes.artboards) {
    box({ x: 0, y: 0, width: d.width, height: d.height }, "canvas", 2, "canvas");
    for (const b of artboards(d)) if (b.id !== boardId) box(b, "artboard", 2, b.id);
  }
  if (s.modes.guides && s.guidesVisible)
    for (const g of s.guides) axis(g.axis, g.position, "guide", 0, g.id);
  for (const l of d.layers) {
    if (skip.has(l.id) || !visible.has(l.id) || l.kind === "group" || l.kind === "adjustment")
      continue;
    if (s.modes.objects) {
      const b = layerBounds(l);
      box(b, "object", 3, l.id);
      index.boxes.push(b);
    }
    if (s.modes.anchors && l.kind === "shape") {
      const n = nativePath(l);
      for (const c of contours(n)) for (const a of c.anchors) index.points.push(worldPoint(a, n));
    }
  }
  // Adjacent peers offer one stable equal-gap target between their facing edges.
  if (s.smart && s.modes.objects)
    for (const a of ["x", "y"] as const) {
      const size = a === "x" ? "width" : "height",
        other = a === "x" ? "y" : "x",
        otherSize = a === "x" ? "height" : "width";
      const ordered = [...index.boxes].sort((b, c) => b[a] - c[a]);
      for (let i = 1; i < ordered.length; i++) {
        const left = ordered[i - 1]!,
          right = ordered[i]!;
        if (
          left[a] + left[size] < right[a] &&
          Math.max(left[other], right[other]) <=
            Math.min(left[other] + left[otherSize], right[other] + right[otherSize])
        )
          axis(a, (left[a] + left[size] + right[a]) / 2, "equal spacing", 4, `space:${i}`);
      }
    }
  for (const a of ["x", "y"] as const)
    index[a].sort(
      (a, b) => a.position - b.position || a.priority - b.priority || a.id.localeCompare(b.id),
    );
  return index;
}
function nearby(sorted: Candidate[], value: number, tolerance: number) {
  let low = 0,
    high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid]!.position < value - tolerance) low = mid + 1;
    else high = mid;
  }
  const found: Candidate[] = [];
  for (let i = low; i < sorted.length && sorted[i]!.position <= value + tolerance; i++)
    found.push(sorted[i]!);
  return found;
}
/** Sorted candidates are built once at pointer-down. Screen pixels / zoom define acquisition.
 * Point drags acquire a nearby anchor first; axis distance wins next, then
 * guides, boards, objects, spacing and grid break ties deterministically. */
export function snapGeometry(
  d: ProDocument,
  index: SnapIndex,
  frame: Frame,
  pixelsPerUnit: number,
  pointOnly = false,
  axes: ("x" | "y")[] = ["x", "y"],
) {
  if (
    ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) ||
    frame.width < 0 ||
    frame.height < 0
  )
    throw Error("Invalid snapping geometry.");
  const s = layout(d),
    delta = { x: 0, y: 0 },
    guides: SnapGuide[] = [];
  if (!s.snapping) return { delta, guides };
  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) throw Error("Invalid snapping zoom.");
  const tolerance = s.tolerance / pixelsPerUnit;
  if (s.modes.anchors && pointOnly && axes.length === 2) {
    let best: Point | undefined,
      distance = tolerance;
    for (const p of index.points) {
      const n = Math.hypot(p.x - frame.x, p.y - frame.y);
      if (n < distance) {
        distance = n;
        best = p;
      }
    }
    if (best)
      return {
        delta: { x: best.x - frame.x, y: best.y - frame.y },
        guides: s.smart
          ? [
              { axis: "x" as const, position: best.x, kind: "anchor" },
              { axis: "y" as const, position: best.y, kind: "anchor" },
            ]
          : [],
      };
  }
  for (const a of axes) {
    const size = a === "x" ? "width" : "height",
      values = pointOnly
        ? [frame[a]]
        : [frame[a], frame[a] + frame[size] / 2, frame[a] + frame[size]];
    let best: { distance: number; change: number; target: Candidate } | undefined;
    for (const value of values) {
      const candidates = nearby(index[a], value, tolerance);
      if (s.modes.grid)
        candidates.push({
          axis: a,
          position: Math.round(value / s.spacing) * s.spacing,
          priority: 5,
          kind: "grid",
          id: "grid",
        });
      for (const target of candidates) {
        if (
          target.kind === "equal spacing" &&
          (pointOnly || Math.abs(value - frame[a] - frame[size] / 2) > 1e-9)
        )
          continue;
        const change = target.position - value,
          distance = Math.abs(change);
        if (
          distance <= tolerance &&
          (!best ||
            distance < best.distance - 1e-9 ||
            (Math.abs(distance - best.distance) < 1e-9 && target.priority < best.target.priority))
        )
          best = { distance, change, target };
      }
    }
    if (best) {
      delta[a] = best.change;
      if (s.smart) guides.push(best.target);
    }
  }
  return { delta, guides };
}
export type AlignOperation =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom"
  | "distribute-x"
  | "distribute-y"
  | "space-x"
  | "space-y";
export function alignObjects(
  d: ProDocument,
  ids: string[],
  operation: AlignOperation,
  reference: "selection" | "artboard" | "key",
  boardId?: string,
  keyId?: string,
) {
  if (
    ![
      "left",
      "center-x",
      "right",
      "top",
      "center-y",
      "bottom",
      "distribute-x",
      "distribute-y",
      "space-x",
      "space-y",
    ].includes(operation) ||
    !["selection", "key", "artboard"].includes(reference)
  )
    throw Error("Invalid alignment operation.");
  const roots = selectedRoots(d, ids),
    groups = roots.map((l) => ({
      id: l.id,
      box: objectBounds(d, l.id)!,
      members: translationIds(d, [l.id]),
    }));
  if (groups.length < (reference === "artboard" ? 1 : 2) || groups.some((g) => !g.box))
    throw Error("Select enough non-empty objects to align.");
  const owner = new Set<string>();
  for (const g of groups)
    for (const id of g.members) {
      if (
        owner.has(id) ||
        !descendants(
          d,
          roots.map((l) => l.id),
        ).has(id)
      )
        throw Error("Unlink objects with coupled or external membership before alignment.");
      owner.add(id);
    }
  const target =
    reference === "artboard"
      ? artboards(d).find((b) => b.id === boardId)
      : reference === "key"
        ? groups.find((g) => g.id === keyId)?.box
        : unionFrames(groups.map((g) => g.box));
  if (!target) throw Error("Select an active artboard or key object.");
  const a = ["left", "center-x", "right", "distribute-x", "space-x"].includes(operation)
      ? "x"
      : "y",
    size = a === "x" ? "width" : "height",
    ordered = [...groups].sort((a1, b) => a1.box[a] - b.box[a] || a1.id.localeCompare(b.id));
  const distribute = operation.startsWith("distribute"),
    space = operation.startsWith("space");
  if ((distribute || space) && (groups.length < 3 || reference !== "selection"))
    throw Error("Distribution requires at least three independent objects, relative to Selection.");
  const start = ordered[0]!.box[a],
    end = ordered.at(-1)!.box[a],
    firstCenter = start + ordered[0]!.box[size] / 2,
    lastCenter = end + ordered.at(-1)!.box[size] / 2;
  const gap =
    (end + ordered.at(-1)!.box[size] - start - ordered.reduce((n, g) => n + g.box[size], 0)) /
    (groups.length - 1);
  let next = d,
    cursor = start;
  for (let i = 0; i < ordered.length; i++) {
    const g = ordered[i]!;
    let position: number;
    if (space) {
      position = cursor;
      cursor += g.box[size] + gap;
    } else if (distribute)
      position =
        firstCenter + ((lastCenter - firstCenter) * i) / (groups.length - 1) - g.box[size] / 2;
    else {
      const ratio = operation.startsWith("center")
        ? 0.5
        : operation === "right" || operation === "bottom"
          ? 1
          : 0;
      position = target[a] + ratio * (target[size] - g.box[size]);
    }
    if (reference === "key" && g.id === keyId) continue;
    next = translateLayers(next, [g.id], {
      x: a === "x" ? position - g.box.x : 0,
      y: a === "y" ? position - g.box.y : 0,
    });
  }
  validateDocument(next);
  return next;
}

/** Acquire the geometric handle, not the finger's grab offset. Solve the local
 * drag response in world coordinates; constrained edge/aspect drags choose one
 * feasible axis. Only exact resulting alignments are advertised as guides. */
export function snapHandle(
  d: ProDocument,
  index: SnapIndex,
  pointer: Point,
  pixelsPerUnit: number,
  positionAt: (pointer: Point) => Point,
) {
  const origin = positionAt(pointer),
    hit = snapGeometry(d, index, { ...origin, width: 0, height: 0 }, pixelsPerUnit, true);
  if (!hit.delta.x && !hit.delta.y) return { pointer, guides: hit.guides };
  const x = positionAt({ x: pointer.x + 1, y: pointer.y }),
    y = positionAt({ x: pointer.x, y: pointer.y + 1 }),
    a = x.x - origin.x,
    b = y.x - origin.x,
    c = x.y - origin.y,
    e = y.y - origin.y,
    det = a * e - b * c;
  let dx = 0,
    dy = 0;
  if (Math.abs(det) > 1e-8) {
    dx = (e * hit.delta.x - b * hit.delta.y) / det;
    dy = (a * hit.delta.y - c * hit.delta.x) / det;
  } else {
    const options = [
      { axis: "x" as const, change: hit.delta.x, vx: a, vy: b },
      { axis: "y" as const, change: hit.delta.y, vx: c, vy: e },
    ]
      .filter((v) => Math.abs(v.change) > 1e-10 && v.vx * v.vx + v.vy * v.vy > 1e-10)
      .sort((a, b) => Math.abs(a.change) - Math.abs(b.change));
    const v = options[0];
    if (v) {
      const axis = v.axis;
      const target = origin[axis] + v.change,
        direction = Math.sign(v.change),
        length = v.vx * v.vx + v.vy * v.vy;
      let low = 0,
        high = Math.abs(v.change) / length;
      const valueAt = (t: number) =>
        positionAt({ x: pointer.x + direction * t * v.vx, y: pointer.y + direction * t * v.vy })[
          axis
        ];
      for (let i = 0; i < 8 && direction * (valueAt(high) - target) < 0; i++) high *= 2;
      for (let i = 0; i < 36; i++) {
        const mid = (low + high) / 2;
        if (direction * (valueAt(mid) - target) < 0) low = mid;
        else high = mid;
      }
      const t = (direction * (low + high)) / 2;
      dx = t * v.vx;
      dy = t * v.vy;
    }
  }
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    Math.hypot(dx, dy) * pixelsPerUnit > layout(d).tolerance * 8
  )
    return { pointer, guides: [] };
  const result = { x: pointer.x + dx, y: pointer.y + dy },
    actual = positionAt(result);
  return {
    pointer: result,
    guides: hit.guides.filter((g) => Math.abs(actual[g.axis] - g.position) < 1e-5),
  };
}
