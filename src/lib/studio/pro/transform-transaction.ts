import { transformGroupMask } from "./masks.ts";
import {
  validateDocument,
  contours,
  type ProDocument,
  type Transform,
  type Point,
} from "./model.ts";
import { translateLayers, translationIds } from "./layers.ts";
import { isLocked } from "./operations.ts";
import { affine, bounds, compose, fromAffine, inverse } from "./transform.ts";
/** A group is an isolated stack in document coordinates. Transform each leaf exactly once,
 * preserving parents, stack order, group opacity/blend, local masks and immutable textures. */
export function transformForest(
  doc: ProDocument,
  ids: string[],
  base: Transform,
  value: Transform,
) {
  if (base.deform || value.deform)
    throw new Error("Multiple layers and groups support affine transforms only.");
  const members = translationIds(doc, ids);
  if (!ids.length || ids.some((id) => !doc.layers.some((l) => l.id === id)))
    throw new Error("Select layers to transform.");
  if ([...members].some((id) => isLocked(doc, id)))
    throw new Error("Unlock every selected or linked descendant before transforming.");
  const delta = compose(affine(value), inverse(affine(base))),
    unchanged = delta.every((n, i) => Math.abs(n - [1, 0, 0, 1, 0, 0][i]!) < 1e-12);
  const result = {
    ...doc,
    layers: doc.layers.map((l) =>
      !unchanged && members.has(l.id) && l.kind !== "group"
        ? { ...l, transform: fromAffine(compose(delta, affine(l.transform)), l.transform) }
        : !unchanged && members.has(l.id)
          ? transformGroupMask(l, delta)
          : l,
    ),
  };
  validateDocument(result);
  return result;
}
export function forestFrame(doc: ProDocument, ids: string[]) {
  const members = translationIds(doc, ids),
    boxes = doc.layers
      .filter((l) => members.has(l.id) && l.kind !== "group")
      .map((l) => bounds(l.transform, l.width, l.height));
  if (!boxes.length) throw new Error("The selected groups have no artwork to transform.");
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y)),
    width = Math.max(1, Math.max(...boxes.map((b) => b.x + b.width)) - x),
    height = Math.max(1, Math.max(...boxes.map((b) => b.y + b.height)) - y);
  if (width > 16384 || height > 16384)
    throw new Error("Transform selection exceeds the 16384px frame limit.");
  return { width, height, transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 } as Transform };
}
/** Apply active-layer geometry plus the existing linked-translation contract as one history transaction. */
export function transformDocument(
  doc: ProDocument,
  id: string,
  transform: Transform,
  translation: Point = { x: 0, y: 0 },
) {
  const l = doc.layers.find((l) => l.id === id);
  if (!l || l.kind === "group" || isLocked(doc, id))
    throw new Error("Select an unlocked non-group layer for Free Transform.");
  if (transform.deform && l.vectorOverflow && l.kind === "shape") {
    const margin =
      l.stroke !== "transparent"
        ? (l.strokeWidth / 2) * (l.lineJoin === "miter" ? (l.miterLimit ?? 10) : 1)
        : 0;
    if (
      contours(l).some((c) =>
        c.anchors.some((a) =>
          [a, a.incoming, a.outgoing].some(
            (p) =>
              p &&
              (p.x < margin || p.y < margin || p.x > l.width - margin || p.y > l.height - margin),
          ),
        ),
      )
    )
      throw new Error(
        "Cancel the transform and use Fit vector frame to content before Perspective or Warp. No geometry was cropped.",
      );
  }
  const moved = translation.x || translation.y ? translateLayers(doc, [id], translation) : doc,
    result = { ...moved, layers: moved.layers.map((l) => (l.id === id ? { ...l, transform } : l)) };
  validateDocument(result);
  return result;
}
