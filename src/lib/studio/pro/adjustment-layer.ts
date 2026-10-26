import { COLOR_OPERATIONS } from "./color-engine.ts";
import { canonicalNative } from "./adjustment-schema.ts";
import { layer, validateDocument, type ProDocument, type Layer } from "./model.ts";
import { validateAdjustmentLayer, type AdjustmentLayerSettings } from "./adjustment-schema.ts";
import { isLocked } from "./operations.ts";
import { siblings, stacks } from "./layers.ts";
import { documentSources } from "./raster-budget.ts";

export type AdjustmentDraft = {
  origin: ProDocument;
  layerId: string;
  created?: Layer;
  afterId?: string;
};
/** An explicit schema1→2 metadata migration; all prior layer/source identities survive. */
export function upgradeAdjustmentDocument(doc: ProDocument): ProDocument {
  validateDocument(doc);
  return doc.version >= 2 ? doc : { ...doc, version: 2 };
}
export function createAdjustmentDraft(
  doc: ProDocument,
  anchorId?: string,
  id: string = crypto.randomUUID(),
): AdjustmentDraft {
  validateDocument(doc);
  const anchor = doc.layers.find((l) => l.id === anchorId),
    parentId = anchor?.kind === "group" ? anchor.id : anchor?.parentId;
  if (parentId && isLocked(doc, parentId))
    throw Error("Unlock the destination group before adding an adjustment.");
  const created = {
    ...layer("adjustment", doc.width, doc.height, id),
    name: "Color adjustment",
    parentId,
  };
  const stack =
    anchor && anchor.kind !== "group"
      ? stacks(siblings(doc, parentId)).find(
          (s) => s.base?.id === anchor.id || s.clips.some((l) => l.id === anchor.id),
        )
      : undefined;
  return {
    origin: doc,
    layerId: id,
    created,
    afterId: stack ? (stack.clips.at(-1) ?? stack.base)?.id : undefined,
  };
}
export function adjustmentDocument(
  draft: AdjustmentDraft,
  settings: AdjustmentLayerSettings,
  maxArea: number,
): ProDocument {
  validateAdjustmentLayer(settings);
  const doc = draft.origin;
  let layers: Layer[];
  if (draft.created) {
    if (doc.layers.some((l) => l.id === draft.layerId) || draft.created.id !== draft.layerId)
      throw Error("The adjustment layer identity is no longer available.");
    const created = {
      ...draft.created,
      name: `${COLOR_OPERATIONS[settings.operation.kind]} adjustment`,
      adjustmentLayer: structuredClone(settings),
    };
    const own = siblings(doc, created.parentId);
    // Insert above the selected complete clipping stack, or at the top inside a selected group.
    const last = stacks(own).at(-1),
      top = draft.afterId
        ? own.find((l) => l.id === draft.afterId)
        : (last?.clips.at(-1) ?? last?.base);
    const index = top
      ? doc.layers.findIndex((l) => l.id === top.id) + 1
      : created.parentId
        ? doc.layers.findIndex((l) => l.id === created.parentId) + 1
        : doc.layers.length;
    layers = [...doc.layers.slice(0, index), created, ...doc.layers.slice(index)];
  } else {
    const target = doc.layers.find((l) => l.id === draft.layerId);
    if (
      !target ||
      target.kind !== "adjustment" ||
      !target.adjustmentLayer ||
      isLocked(doc, target.id)
    )
      throw Error("Choose an unlocked persistent color adjustment layer.");
    layers = doc.layers.map((l) =>
      l.id === target.id ? { ...l, adjustmentLayer: structuredClone(settings) } : l,
    );
  }
  const next = { ...upgradeAdjustmentDocument(doc), layers };
  validateDocument(next);
  documentSources(next, maxArea);
  if (
    !draft.created &&
    canonicalNative(doc.layers.find((l) => l.id === draft.layerId)!.adjustmentLayer) ===
      canonicalNative(settings)
  )
    return doc;
  return next;
}
export function commitAdjustmentDocument(
  current: ProDocument,
  draft: AdjustmentDraft,
  settings: AdjustmentLayerSettings,
  maxArea: number,
) {
  if (current !== draft.origin)
    throw Error(
      "Adjustment canceled because the document changed. Reopen the current layer settings.",
    );
  return adjustmentDocument(draft, settings, maxArea);
}
