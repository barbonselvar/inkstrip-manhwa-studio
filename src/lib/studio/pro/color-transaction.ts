import { NEUTRAL } from "../editor/adjustments.ts";
import { visibleLayerIds } from "./layers.ts";
import { isLocked } from "./operations.ts";
import { validateAssets, validateDocument, type ProDocument, type ProSession } from "./model.ts";
import { documentSources } from "./raster-budget.ts";
import { COLOR_MAX_AREA } from "./color-engine.ts";

export function colorTarget(doc: ProDocument, id: string, maxArea: number) {
  const target = doc.layers.find((l) => l.id === id);
  if (
    !target ||
    !["raster", "paint"].includes(target.kind) ||
    isLocked(doc, id) ||
    !visibleLayerIds(doc).has(id)
  )
    throw Error(
      "Choose one visible, unlocked raster or paint layer for pixel processing. Existing editable adjustment layers remain in Properties.",
    );
  if (!Number.isInteger(target.width) || !Number.isInteger(target.height))
    throw Error("Pixel color processing requires integer native layer dimensions.");
  if (target.width * target.height > Math.min(COLOR_MAX_AREA, maxArea))
    throw Error(
      "Pixel color processing supports native layers up to 4MP on this device. Use existing editable adjustments for larger layers.",
    );
  if (doc.layers.length >= 48)
    throw Error("The layer budget has no room to retain the editable original.");
  documentSources(doc, maxArea);
  return target;
}
/** Keep the original directly below its replacement, including clipping membership.
 * Never inject new native fields or bake masks, effects, opacity or geometry twice. */
export function colorDocument(
  doc: ProDocument,
  id: string,
  assetId: string,
  originalId: string,
  maxArea: number,
) {
  const target = colorTarget(doc, id, maxArea);
  const replacement = {
    ...target,
    kind: "raster" as const,
    assetId,
    strokes: [],
    adjustments: { ...NEUTRAL },
    color: undefined,
    colorSelection: undefined,
    hue: 0,
    black: 0,
    white: 255,
    gamma: 1,
    curve: [0, 64, 128, 192, 255],
  };
  const original = {
    ...target,
    id: originalId,
    name: `${target.name.slice(0, 70)} · original`,
    visible: false,
    linkId: undefined,
  };
  const next = {
    ...doc,
    layers: doc.layers.flatMap((l) => (l.id === id ? [original, replacement] : [l])),
  };
  validateDocument(next);
  documentSources(next, maxArea);
  return next;
}
export function prepareColorCommit(
  session: ProSession,
  current: ProDocument,
  origin: ProDocument,
  id: string,
  blob: Blob,
  assetId: string,
  originalId: string,
  maxArea: number,
) {
  if (current !== origin)
    throw Error(
      "Color operation canceled because the document changed. Reopen it on the current revision.",
    );
  if (blob.type !== "image/png" || !blob.size) throw Error("The processed PNG is missing.");
  const document = colorDocument(current, id, assetId, originalId, maxArea),
    next = { ...session, document, assets: { ...session.assets, [assetId]: blob } };
  validateAssets(next);
  return next;
}
