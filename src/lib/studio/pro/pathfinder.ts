/** Filled-region Pathfinder. Cubics are adaptively approximated, never rasterized. */
import Clipper from "clipper-lib";
import {
  contours,
  layer,
  validateDocument,
  type Layer,
  type Point,
  type ProDocument,
} from "./model.ts";
import { affine, applyMatrix } from "./transform.ts";
import { nativePath } from "./compound.ts";
import { anchorCurve, splitCubic, type Cubic } from "./bezier.ts";
import { pathfinderSelection } from "./pathfinder-selection.ts";
export { pathfinderSelection } from "./pathfinder-selection.ts";
export const PATHFINDER_OPERATIONS = [
  "unite",
  "subtract",
  "intersect",
  "exclude",
  "divide",
  "trim",
  "merge",
] as const;
export type PathfinderOperation = (typeof PATHFINDER_OPERATIONS)[number];
export type PathfinderOptions = { tolerance?: number; allowEmpty?: boolean };
export type PathfinderResult = {
  document: ProDocument;
  ids: string[];
  operation: PathfinderOperation;
  tolerance: number;
};
const GRID = 10000,
  INPUT_LIMIT = 4096,
  OUTPUT_LIMIT = 16000;
type Paths = Clipper.Paths;
function checkPaths(paths: Paths) {
  if (
    paths.reduce((n, p) => n + p.length, 0) > OUTPUT_LIMIT ||
    paths.some((p) =>
      p.some(
        (v) =>
          !Number.isSafeInteger(v.X) ||
          !Number.isSafeInteger(v.Y) ||
          Math.abs(v.X) > 1e10 ||
          Math.abs(v.Y) > 1e10,
      ),
    )
  )
    throw new Error(
      "Pathfinder exceeds the geometry precision or complexity budget. Sources retained.",
    );
}
function clip(
  a: Paths,
  b: Paths,
  operation: Clipper.ClipType,
  rule = Clipper.PolyFillType.pftNonZero,
  tree?: Clipper.PolyTree,
): Paths {
  if (!a.length && !b.length) return [];
  const c = new Clipper.Clipper();
  c.StrictlySimple = true;
  c.AddPaths(a, Clipper.PolyType.ptSubject, true);
  c.AddPaths(b, Clipper.PolyType.ptClip, true);
  const result: Paths = [];
  const ok = tree
    ? c.Execute(operation, tree, rule, rule)
    : c.Execute(operation, result, rule, rule);
  if (!ok) throw new Error("Boolean geometry could not be resolved. Sources retained.");
  const paths = tree ? Clipper.Clipper.PolyTreeToPaths(tree) : result;
  checkPaths(paths);
  return paths;
}
const union = (a: Paths, b: Paths = []) => clip(a, b, Clipper.ClipType.ctUnion);
const difference = (a: Paths, b: Paths) =>
  a.length ? (b.length ? clip(a, b, Clipper.ClipType.ctDifference) : a) : [];
const intersection = (a: Paths, b: Paths) =>
  a.length && b.length ? clip(a, b, Clipper.ClipType.ctIntersection) : [];
function distance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    square = dx * dx + dy * dy,
    t = square ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / square)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Control-hull distance to the endpoint segment bounds curve/chord deviation. */
function flatten(c: Cubic, tolerance: number, append: (p: Point) => void, depth = 0) {
  if (Math.max(distance(c[1], c[0], c[3]), distance(c[2], c[0], c[3])) <= tolerance) {
    append(c[3]);
    return;
  }
  if (depth >= 20) throw new Error("Curve exceeds the adaptive subdivision precision budget.");
  const [a, b] = splitCubic(c, 0.5);
  flatten(a, tolerance, append, depth + 1);
  flatten(b, tolerance, append, depth + 1);
}
function rawPaths(l: Layer, tolerance: number, budget: { vertices: number }): Paths {
  const m = affine(l.transform),
    norm = Math.hypot(...m.slice(0, 4)),
    native = nativePath(l, Math.max(1e-6, tolerance / 4 / Math.max(1, norm)));
  const result: Paths = [];
  for (const c of contours(native)) {
    if (!c.closed)
      throw new Error(
        "Close every subpath before Pathfinder; open contours are not implicitly closed.",
      );
    if (c.anchors.length < 3 && !c.anchors.some((a) => a.incoming || a.outgoing))
      throw new Error("A selected path has no filled area.");
    const path: Clipper.Path = [];
    const append = (p: Point) => {
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 1e6 ||
        Math.abs(p.y) > 1e6
      )
        throw new Error("Transformed geometry exceeds Pathfinder coordinate limits.");
      const v = { X: Math.round(p.x * GRID), Y: Math.round(p.y * GRID) },
        last = path.at(-1);
      if (!last || last.X !== v.X || last.Y !== v.Y) {
        path.push(v);
        if (++budget.vertices > INPUT_LIMIT)
          throw new Error(
            "Pathfinder exceeds 4096 input vertices. Use fewer objects or a coarser tolerance.",
          );
      }
    };
    if (!c.anchors.length) throw new Error("A selected contour is empty.");
    append(applyMatrix(m, c.anchors[0]!));
    for (let i = 0; i < c.anchors.length; i++) {
      const a = c.anchors[i]!,
        b = c.anchors[(i + 1) % c.anchors.length]!;
      if (!a.outgoing && !b.incoming) append(applyMatrix(m, b));
      else flatten(anchorCurve(a, b).map((p) => applyMatrix(m, p)) as Cubic, tolerance, append);
    }
    if (path.length > 1 && path[0]!.X === path.at(-1)!.X && path[0]!.Y === path.at(-1)!.Y)
      path.pop();
    if (path.length < 3)
      throw new Error("A selected contour collapses at the integer geometry precision.");
    result.push(path);
  }
  return result;
}
/** Conservative broad phase bounds hostile self-crossing arrangements before clipping. */
function complexity(paths: Paths) {
  const segments = paths.flatMap((p) =>
    p.map((a, i) => {
      const b = p[(i + 1) % p.length]!;
      return [Math.min(a.X, b.X), Math.min(a.Y, b.Y), Math.max(a.X, b.X), Math.max(a.Y, b.Y)];
    }),
  );
  let pairs = 0;
  for (let i = 0; i < segments.length; i++)
    for (let j = 0; j < i; j++) {
      const a = segments[i]!,
        b = segments[j]!;
      if (a[0]! <= b[2]! && b[0]! <= a[2]! && a[1]! <= b[3]! && b[1]! <= a[3]! && ++pairs > 20000)
        throw new Error(
          "Pathfinder intersection complexity exceeds the safe budget. Simplify the selection.",
        );
    }
}
function components(paths: Paths): Paths[] {
  if (!paths.length) return [];
  const tree = new Clipper.PolyTree();
  clip(paths, [], Clipper.ClipType.ctUnion, Clipper.PolyFillType.pftNonZero, tree);
  const parts: Paths[] = [];
  const walk = (node: Clipper.PolyNode) => {
    for (const child of node.Childs()) {
      if (!child.IsHole())
        parts.push([
          child.Contour(),
          ...child
            .Childs()
            .filter((n) => n.IsHole())
            .map((n) => n.Contour()),
        ]);
      walk(child);
    }
  };
  walk(tree);
  return parts;
}
function resultLayer(paths: Paths, source: Layer, name: string, stripStroke: boolean): Layer {
  if (paths.length > 128 || paths.reduce((n, p) => n + p.length, 0) > 1000)
    throw new Error(
      "A Pathfinder object exceeds 128 contours or 1000 editable anchors. Use fewer objects or a coarser tolerance.",
    );
  const points = paths.flat(),
    strokeWidth = stripStroke ? 0 : source.strokeWidth,
    margin = Math.ceil(
      Math.max(1, strokeWidth * (source.lineJoin === "miter" ? (source.miterLimit ?? 10) : 1)),
    ),
    x = Math.floor(Math.min(...points.map((p) => p.X / GRID))) - margin,
    y = Math.floor(Math.min(...points.map((p) => p.Y / GRID))) - margin,
    width = Math.ceil(Math.max(...points.map((p) => p.X / GRID))) - x + margin,
    height = Math.ceil(Math.max(...points.map((p) => p.Y / GRID))) - y + margin,
    cs = paths.map((p) => ({
      closed: true,
      anchors: p.map((a) => ({ x: a.X / GRID - x, y: a.Y / GRID - y, mode: "corner" as const })),
    }));
  return {
    ...layer("shape", width, height),
    name,
    parentId: source.parentId,
    shape: "path",
    ...cs[0]!,
    subpaths: cs.slice(1),
    fillRule: "nonzero",
    vectorOverflow: true,
    transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
    fill: source.fill,
    fillOpacity: 1,
    stroke: stripStroke ? "transparent" : source.stroke,
    strokeWidth,
    strokeOpacity: source.strokeOpacity,
    lineCap: source.lineCap,
    lineJoin: source.lineJoin,
    miterLimit: source.miterLimit,
    dash: stripStroke ? [] : source.dash,
    dashOffset: source.dashOffset,
  };
}
/** Immutable transaction. Original objects are removed only after every result validates. */
export function pathfinder(
  d: ProDocument,
  ids: string[],
  operation: PathfinderOperation,
  options: PathfinderOptions = {},
): PathfinderResult {
  if (!PATHFINDER_OPERATIONS.includes(operation)) throw new Error("Unknown Pathfinder operation.");
  const tolerance = options.tolerance ?? 0.1;
  if (
    !Number.isFinite(tolerance) ||
    tolerance < 0.02 ||
    tolerance > 1 ||
    (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean")
  )
    throw new Error("Pathfinder tolerance must be 0.02–1 document pixel.");
  const { roots, leaves, removed } = pathfinderSelection(d, ids),
    budget = { vertices: 0 },
    raw = leaves.map((l) => rawPaths(l, tolerance, budget));
  complexity(raw.flat());
  const shapes = raw.map((p, i) => {
    let paths = clip(
      p,
      [],
      Clipper.ClipType.ctUnion,
      leaves[i]!.fillRule === "evenodd"
        ? Clipper.PolyFillType.pftEvenOdd
        : Clipper.PolyFillType.pftNonZero,
    );
    if (!leaves[i]!.vectorOverflow) {
      const l = leaves[i]!,
        m = affine(l.transform),
        frame = [
          { x: 0, y: 0 },
          { x: l.width, y: 0 },
          { x: l.width, y: l.height },
          { x: 0, y: l.height },
        ]
          .map((p) => applyMatrix(m, p))
          .map((p) => ({ X: Math.round(p.x * GRID), Y: Math.round(p.y * GRID) }));
      checkPaths([frame]);
      paths = intersection(paths, [frame]);
    }
    if (!paths.length)
      throw new Error("A selected shape has no filled region. Source objects retained.");
    return paths;
  });
  let parts: { paths: Paths; owner: number }[] = [];
  if (operation === "divide") {
    let covered: Paths = [];
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i]!,
        next: typeof parts = [];
      for (const cell of parts) {
        const outside = difference(cell.paths, shape),
          inside = intersection(cell.paths, shape);
        if (outside.length) next.push({ paths: outside, owner: cell.owner });
        if (inside.length) next.push({ paths: inside, owner: i });
      }
      const fresh = difference(shape, covered);
      if (fresh.length) next.push({ paths: fresh, owner: i });
      if (next.length > 256) throw new Error("Divide exceeds the safe region budget.");
      parts = next;
      covered = union(covered, shape);
    }
  } else if (operation === "trim" || operation === "merge") {
    let covered: Paths = [];
    for (let i = shapes.length - 1; i >= 0; i--) {
      const paths = difference(shapes[i]!, covered);
      if (paths.length) parts.unshift({ paths, owner: i });
      covered = union(covered, shapes[i]!);
    }
    if (operation === "merge") {
      const compatible = new Map<string, { paths: Paths; owner: number }>();
      for (const p of parts) {
        const key = leaves[p.owner]!.fill.toLowerCase(),
          old = compatible.get(key);
        compatible.set(key, {
          paths: old ? union(old.paths, p.paths) : p.paths,
          owner: old?.owner ?? p.owner,
        });
      }
      parts = [...compatible.values()];
    }
  } else {
    let paths = shapes[0]!;
    for (let i = 1; i < shapes.length; i++)
      paths =
        operation === "unite"
          ? union(paths, shapes[i]!)
          : operation === "subtract"
            ? difference(paths, shapes[i]!)
            : operation === "intersect"
              ? intersection(paths, shapes[i]!)
              : clip(paths, shapes[i]!, Clipper.ClipType.ctXor);
    if (paths.length) parts = [{ paths, owner: 0 }];
  }
  const split = ["divide", "trim", "merge"].includes(operation),
    objects = parts.flatMap((p) =>
      (split ? components(p.paths) : [p.paths]).map((paths) =>
        resultLayer(paths, leaves[p.owner]!, `Pathfinder ${operation}`, split),
      ),
    );
  // Selected groups are flattened only inside the selected consecutive sibling range.
  for (const l of objects) l.parentId = roots[0]!.parentId;
  if (!objects.length && !options.allowEmpty)
    throw new Error(
      "Empty Pathfinder result. Sources retained. Enable ‘Allow empty result’ to remove selected objects with Undo.",
    );
  if (d.layers.length - removed.size + objects.length > 48)
    throw new Error("Pathfinder exceeds the 48-layer limit. Sources retained.");
  const document = {
    ...d,
    layers: d.layers.flatMap((l) =>
      l.id === roots[0]!.id ? objects : removed.has(l.id) ? [] : [l],
    ),
  };
  validateDocument(document);
  return { document, ids: objects.map((l) => l.id), operation, tolerance };
}
