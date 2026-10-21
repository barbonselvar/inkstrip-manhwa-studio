import {
  contours,
  layer,
  validateDocument,
  type Contour,
  type Layer,
  type ProDocument,
} from "./model.ts";
import { affine, applyMatrix, compose, fromAffine, inverse } from "./transform.ts";
import { isLocked } from "./operations.ts";
import { parseSvgPath } from "./svg-path.ts";
import { shapePath } from "./paths.ts";
/** Convert legacy raw SVG or primitive geometry, retaining local coordinates and appearance. */
export function nativePath(l: Layer, tolerance = 0.01): Layer {
  if (l.kind !== "shape") throw new Error("Only vector shapes can become native paths.");
  if (l.shape === "path" && !l.pathData) return structuredClone(l);
  const converted = parseSvgPath(shapePath(l), tolerance).contours,
    first = converted[0] ?? { anchors: [], closed: false };
  return { ...l, shape: "path", pathData: undefined, ...first, subpaths: converted.slice(1) };
}
export function convertPath(doc: ProDocument, id: string): ProDocument {
  validateDocument(doc);
  const l = doc.layers.find((l) => l.id === id);
  if (!l || isLocked(doc, id)) throw new Error("Choose an unlocked vector shape.");
  const m = affine(l.transform),
    norm = Math.hypot(m[0], m[1], m[2], m[3]),
    result = {
      ...doc,
      layers: doc.layers.map((n) =>
        n.id === id ? nativePath(n, Math.max(1e-6, 0.01 / Math.max(1, norm))) : n,
      ),
    };
  validateDocument(result);
  return result;
}
/** Rebase the source frame without moving world curves or the transform pivot. */
export function fitVectorFrame(doc: ProDocument, id: string): ProDocument {
  validateDocument(doc);
  const l = doc.layers.find((l) => l.id === id);
  if (!l || l.kind !== "shape" || l.shape !== "path" || l.pathData || isLocked(doc, id))
    throw new Error("Choose an unlocked native vector path.");
  if (l.mask || l.strokes.length || l.colorSelection || l.transform.deform)
    throw new Error(
      "Remove masks, strokes and captured color selections, and use an affine transform before fitting the vector frame. Source data is unchanged.",
    );
  const cs = contours(l),
    points = cs.flatMap((c) =>
      c.anchors.flatMap((a) => [
        a,
        ...(a.incoming ? [a.incoming] : []),
        ...(a.outgoing ? [a.outgoing] : []),
      ]),
    );
  if (!points.length) throw new Error("The path has no geometry to fit.");
  const margin = Math.max(1, l.strokeWidth * (l.lineJoin === "miter" ? (l.miterLimit ?? 10) : 1)),
    x = Math.floor(Math.min(...points.map((p) => p.x)) - margin),
    y = Math.floor(Math.min(...points.map((p) => p.y)) - margin),
    width = Math.ceil(Math.max(...points.map((p) => p.x)) + margin) - x,
    height = Math.ceil(Math.max(...points.map((p) => p.y)) + margin) - y,
    shifted = cs.map((c) => ({
      ...c,
      anchors: c.anchors.map((a) => ({
        ...a,
        x: a.x - x,
        y: a.y - y,
        ...(a.incoming ? { incoming: { x: a.incoming.x - x, y: a.incoming.y - y } } : {}),
        ...(a.outgoing ? { outgoing: { x: a.outgoing.x - x, y: a.outgoing.y - y } } : {}),
      })),
    })),
    pivot = { x: (l.transform.pivot?.x ?? 0) - x, y: (l.transform.pivot?.y ?? 0) - y },
    result = {
      ...doc,
      layers: doc.layers.map((n) =>
        n.id === id
          ? {
              ...n,
              ...shifted[0]!,
              subpaths: shifted.slice(1),
              vectorOverflow: true,
              width,
              height,
              transform: fromAffine(compose(affine(l.transform), [1, 0, 0, 1, x, y]), {
                ...l.transform,
                pivot,
              }),
            }
          : n,
      ),
    };
  validateDocument(result);
  return result;
}
function neutral(d: ProDocument, l: Layer) {
  if (
    l.kind !== "shape" ||
    isLocked(d, l.id) ||
    !l.visible ||
    l.clipped ||
    l.linkId ||
    l.mask ||
    l.transform.deform ||
    l.opacity !== 1 ||
    l.blend !== "source-over" ||
    l.effects?.some((e) => e.enabled) ||
    l.colorSelection ||
    (l.color && Object.keys(l.color).length) ||
    Object.values(l.adjustments).some((n) => n !== 0) ||
    l.hue ||
    l.black ||
    l.white !== 255 ||
    l.gamma !== 1 ||
    l.curve.some((n, i) => n !== [0, 64, 128, 192, 255][i])
  )
    throw new Error(
      "Compound operations require visible unlocked affine vector shapes with neutral opacity/blending and no masks, effects, links, clipping or adjustments. Release those relationships first.",
    );
  const siblings = d.layers.filter((n) => n.parentId === l.parentId),
    next = siblings[siblings.indexOf(l) + 1];
  if (next?.clipped) throw new Error("Release the clipping stack before changing its base path.");
}
export function createCompound(
  doc: ProDocument,
  ids: string[],
  fillRule: Layer["fillRule"] = "evenodd",
): { document: ProDocument; id: string } {
  validateDocument(doc);
  const chosen = doc.layers.filter((l) => ids.includes(l.id)),
    base = chosen[0];
  if (
    !base ||
    chosen.length < 2 ||
    chosen.length !== new Set(ids).size ||
    chosen.some((l) => l.parentId !== base.parentId)
  )
    throw new Error("Select at least two sibling vector shapes to create a compound path.");
  for (const l of chosen) neutral(doc, l);
  const siblings = doc.layers.filter((l) => l.parentId === base.parentId),
    begin = siblings.indexOf(base);
  if (siblings.slice(begin, begin + chosen.length).some((l) => !ids.includes(l.id)))
    throw new Error(
      "Select consecutive sibling shapes so compound creation preserves stack order.",
    );
  const baseMatrix = affine(base.transform),
    inv = inverse(baseMatrix),
    resultContours: Contour[] = [];
  for (const l of chosen) {
    const matrix = compose(inv, affine(l.transform)),
      magnitude = Math.hypot(...affine(l.transform).slice(0, 4)),
      converted = nativePath(l, Math.max(1e-6, 0.01 / Math.max(1, magnitude)));
    for (const c of contours(converted))
      resultContours.push({
        closed: c.closed,
        anchors: c.anchors.map((a) => ({
          ...a,
          ...applyMatrix(matrix, a),
          ...(a.incoming ? { incoming: applyMatrix(matrix, a.incoming) } : {}),
          ...(a.outgoing ? { outgoing: applyMatrix(matrix, a.outgoing) } : {}),
        })),
      });
  }
  if (
    resultContours.length > 128 ||
    resultContours.reduce((n, c) => n + c.anchors.length, 0) > 1000
  )
    throw new Error("Compound path exceeds the 128-subpath or 1000-anchor limit.");
  const points = resultContours.flatMap((c) =>
    c.anchors.flatMap((a) => [
      a,
      ...(a.incoming ? [a.incoming] : []),
      ...(a.outgoing ? [a.outgoing] : []),
    ]),
  );
  if (!points.length) throw new Error("Selected shapes contain no path geometry.");
  const margin =
      Math.max(base.strokeWidth, 1) * (base.lineJoin === "miter" ? (base.miterLimit ?? 10) : 1),
    x = Math.floor(Math.min(...points.map((p) => p.x)) - margin),
    y = Math.floor(Math.min(...points.map((p) => p.y)) - margin),
    width = Math.ceil(Math.max(...points.map((p) => p.x)) + margin) - x,
    height = Math.ceil(Math.max(...points.map((p) => p.y)) + margin) - y;
  const shifted = resultContours.map((c) => ({
    ...c,
    anchors: c.anchors.map((a) => ({
      ...a,
      x: a.x - x,
      y: a.y - y,
      ...(a.incoming ? { incoming: { x: a.incoming.x - x, y: a.incoming.y - y } } : {}),
      ...(a.outgoing ? { outgoing: { x: a.outgoing.x - x, y: a.outgoing.y - y } } : {}),
    })),
  }));
  const compound: Layer = {
    ...structuredClone(base),
    name: "Compound path",
    vectorOverflow: true,
    shape: "path",
    pathData: undefined,
    ...shifted[0]!,
    subpaths: shifted.slice(1),
    fillRule,
    width,
    height,
    transform: fromAffine(compose(baseMatrix, [1, 0, 0, 1, x, y]), {
      ...base.transform,
      pivot: undefined,
    }),
  };
  const document = {
    ...doc,
    layers: doc.layers.flatMap((l) =>
      l.id === base.id ? [compound] : ids.includes(l.id) ? [] : [l],
    ),
  };
  validateDocument(document);
  return { document, id: compound.id };
}
/** Releasing deliberately removes hole semantics; geometry/curves remain editable. */
export function releaseCompound(
  doc: ProDocument,
  id: string,
): { document: ProDocument; ids: string[] } {
  validateDocument(doc);
  const l = doc.layers.find((l) => l.id === id);
  if (!l || !l.subpaths?.length) throw new Error("Choose a compound path to release.");
  neutral(doc, l);
  if (doc.layers.length + l.subpaths.length > 48)
    throw new Error("Releasing exceeds the 48-layer limit.");
  const parts = contours(l).map((c, i) => ({
    ...structuredClone(l),
    id: layer("shape", l.width, l.height).id,
    name: `${l.name} · contour ${i + 1}`,
    ...structuredClone(c),
    subpaths: undefined,
  }));
  const document = { ...doc, layers: doc.layers.flatMap((n) => (n.id === id ? parts : [n])) };
  validateDocument(document);
  return { document, ids: parts.map((p) => p.id) };
}
