import { layer, validateDocument, type ProDocument } from "./model.ts";
import { isLocked } from "./operations.ts";
import { visibleLayerIds } from "./layers.ts";
import { hasActiveSelection } from "./fill.ts";
import { documentSources } from "./raster-budget.ts";

// Three native RGBA planes plus selection coverage and encoder/renderer scratch.
// Keep the staging operation bounded independently of ordinary document limits.
export const SELECTION_TRANSFORM_MAX_AREA = 4_000_000;
export function selectionTransformTarget(doc: ProDocument, id: string, maxArea = 16_777_216) {
  const target = doc.layers.find((l) => l.id === id);
  if (
    !target ||
    !["raster", "paint"].includes(target.kind) ||
    isLocked(doc, id) ||
    !visibleLayerIds(doc).has(id)
  )
    throw Error("Selected-pixel transforms require one visible, unlocked raster or paint layer.");
  if (!hasActiveSelection(doc.selection)) throw Error("Create a pixel selection first.");
  if (doc.width * doc.height > Math.min(maxArea, SELECTION_TRANSFORM_MAX_AREA))
    throw Error(
      "Selected-pixel staging supports canvases up to 4MP on this device. Whole-layer transforms retain the normal document limit.",
    );
  if (
    target.transform.deform ||
    target.linkId ||
    target.clipped ||
    target.effects?.some((e) => e.enabled) ||
    doc.layers.some((l) => l.parentId === target.parentId && l.clipped)
  )
    throw Error(
      "Selected-pixel staging requires affine artwork without linked layers, clipping stacks or enabled effects. Original artwork is unchanged.",
    );
  return target;
}

/** Lift A*S and factor the remainder so source-over at the initial pose recovers A.
 * For feathered opaque pixels this retains background coverage under the lifted edge.
 * RGB stays straight, including semitransparent colors; no preview pixels are used. */
export function splitSelectedPixels(rgba: Uint8ClampedArray, coverage: Uint8ClampedArray) {
  if (rgba.length !== coverage.length * 4) throw Error("Selection coverage size mismatch.");
  const remaining = new Uint8ClampedArray(rgba),
    lifted = new Uint8ClampedArray(rgba);
  let count = 0;
  for (let i = 0; i < coverage.length; i++) {
    const a = rgba[i * 4 + 3]!,
      selected = Math.round((a * coverage[i]!) / 255);
    lifted[i * 4 + 3] = selected;
    remaining[i * 4 + 3] =
      selected === 255 ? 0 : Math.round(((a - selected) * 255) / (255 - selected));
    // Canvas stores 8-bit premultiplied color. Factor that quantized color as
    // well as alpha, so low-alpha feather edges do not accumulate a second
    // unpremultiply/PNG rounding error when the pieces are recomposited.
    const restAlpha = remaining[i * 4 + 3]!;
    if (selected && selected < 255 && restAlpha) {
      for (let channel = 0; channel < 3; channel++) {
        const color = rgba[i * 4 + channel]!,
          originalPremultiplied = Math.round((color * a) / 255),
          liftedPremultiplied = Math.round((color * selected) / 255),
          restPremultiplied = Math.round(
            (originalPremultiplied - liftedPremultiplied) / (1 - selected / 255),
          );
        remaining[i * 4 + channel] = Math.round((restPremultiplied * 255) / restAlpha);
      }
    }
    if (selected) count++;
  }
  if (!count) throw Error("No visible pixels are selected on this layer.");
  return { remaining, lifted, count };
}
export function stageSelectionDocument(
  doc: ProDocument,
  id: string,
  remainingAsset: string,
  liftedAsset: string,
  ids: { group: string; remaining: string; floating: string },
  maxArea = 16_777_216,
  frame = { x: 0, y: 0, width: doc.width, height: doc.height },
) {
  if (
    ![frame.x, frame.y, frame.width, frame.height].every(Number.isInteger) ||
    frame.x < 0 ||
    frame.y < 0 ||
    frame.width < 1 ||
    frame.height < 1 ||
    frame.x + frame.width > doc.width ||
    frame.y + frame.height > doc.height
  )
    throw Error("Invalid selected-pixel frame.");
  const target = selectionTransformTarget(doc, id, maxArea),
    group = {
      ...layer("group", doc.width, doc.height, ids.group),
      name: `${target.name.slice(0, 80)} · pixel transform`,
      parentId: target.parentId,
      opacity: target.opacity,
      blend: target.blend,
    },
    remaining = {
      ...layer("raster", doc.width, doc.height, ids.remaining),
      name: "Remaining pixels",
      assetId: remainingAsset,
      parentId: group.id,
    },
    floating = {
      ...layer("raster", frame.width, frame.height, ids.floating),
      transform: { x: frame.x, y: frame.y, scaleX: 1, scaleY: 1, rotation: 0 },
      name: "Transformed pixels",
      assetId: liftedAsset,
      parentId: group.id,
    },
    document = {
      ...doc,
      layers: doc.layers.flatMap((l) =>
        l.id === id
          ? [group, { ...l, visible: false, parentId: group.id }, remaining, floating]
          : [l],
      ),
    };
  validateDocument(document); // Includes layer count and group nesting safety.
  documentSources(document, maxArea);
  return { document, layerId: floating.id };
}
