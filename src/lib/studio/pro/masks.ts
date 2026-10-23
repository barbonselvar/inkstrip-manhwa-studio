import type { Layer, Mask, Point, Transform } from "./model.ts";
import { affine, compose, fromAffine, inverse, applyMatrix } from "./transform.ts";
const identity: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
/** A mask owns a local coordinate frame. Unlinked placement is in document space;
 * linked placement is relative to its layer. Changing linkage preserves geometry. */
export function maskWorld(layer: Layer) {
  const m = layer.mask;
  if (m?.linked === false) return affine(m.placement ?? identity);
  return compose(affine(layer.transform), affine(m?.placement ?? identity));
}
export function maskLocal(layer: Layer) {
  if (layer.mask?.linked === false) {
    if (layer.transform.deform) throw Error("Relink the mask before Perspective or Warp.");
    return compose(inverse(affine(layer.transform)), maskWorld(layer));
  }
  return affine(layer.mask?.placement ?? identity);
}
export function setMaskLinked(layer: Layer, linked: boolean): Mask {
  if (!layer.mask) throw Error("This layer has no mask.");
  if (layer.transform.deform)
    throw Error("Mask linkage changes require an affine layer. Cancel Perspective or Warp first.");
  const world = maskWorld(layer),
    placement = linked ? compose(inverse(affine(layer.transform)), world) : world;
  return { ...layer.mask, linked, placement: fromAffine(placement, identity) };
}
export function copyLayerMask(layer: Layer): Mask {
  if (!layer.mask) throw Error("This layer has no mask.");
  if (layer.transform.deform)
    throw Error("Copying a deformed mask needs an affine layer. The original mask is unchanged.");
  return structuredClone({
    ...layer.mask,
    width: layer.mask.width ?? layer.width,
    height: layer.mask.height ?? layer.height,
    linked: false,
    placement: fromAffine(maskWorld(layer), identity),
  });
}
export function maskPaintPoint(layer: Layer, layerPoint: Point) {
  const m = inverse(maskLocal(layer));
  return applyMatrix(m, layerPoint);
}

export function transformGroupMask(layer: Layer, delta: import("./transform.ts").Matrix): Layer {
  if (layer.kind !== "group" || !layer.mask || layer.mask.linked === false) return layer;
  return {
    ...layer,
    mask: {
      ...layer.mask,
      placement: fromAffine(compose(delta, affine(layer.mask.placement ?? identity)), identity),
    },
  };
}

/** New affine masks own the entire document frame, so vector paint extending
 * beyond an object's editing box remains maskable without rasterizing it. */
export function maskFromSelection(
  selection: import("./model.ts").Selection,
  layer: Layer,
  document: { width: number; height: number },
): Mask {
  const source =
    selection.regions.length || selection.inverted
      ? structuredClone(selection)
      : { regions: [], inverted: true, feather: 0 };
  if (layer.transform.deform)
    return {
      enabled: true,
      selection: { ...source, frame: { ...document, transform: structuredClone(layer.transform) } },
      strokes: [],
    };
  return {
    enabled: true,
    width: document.width,
    height: document.height,
    placement: fromAffine(inverse(affine(layer.transform)), identity),
    linked: true,
    selection: source,
    strokes: [],
  };
}
