import { layer, validateDocument, type Layer, type ProDocument, type Selection } from "./model.ts";
import { isLocked } from "./operations.ts";
import { documentSources } from "./raster-budget.ts";
import { maskFromSelection } from "./masks.ts";
import { siblings, stacks } from "./layers.ts";
import type { Gradient } from "./gradient.ts";
import type { Effect } from "./effects.ts";
import type { SmartFilter } from "./smart-filters.ts";
export type R8Settings = {
  effects?: Effect[];
  smartFilters?: SmartFilter[];
  gradient?: Gradient;
  light?: number;
};
export type R8Draft = { origin: ProDocument; layerId: string };
export function upgradeR8Document(doc: ProDocument): ProDocument {
  validateDocument(doc);
  return doc.version === 3 ? doc : { ...doc, version: 3 };
}
export function r8Settings(l: Layer, light = 135): R8Settings {
  return structuredClone({
    effects: l.effects,
    smartFilters: l.smartFilters,
    gradient: l.gradient,
    light,
  });
}
export function r8Document(draft: R8Draft, settings: R8Settings, maxArea: number): ProDocument {
  const doc = draft.origin,
    target = doc.layers.find((l) => l.id === draft.layerId);
  if (!target || target.kind === "adjustment" || isLocked(doc, target.id))
    throw Error(
      "Choose an unlocked artwork layer. Backdrop adjustments and Quick Mask are not style/filter targets.",
    );
  const next: ProDocument = {
    ...upgradeR8Document(doc),
    styleLight: settings.light ?? doc.styleLight ?? 135,
    layers: doc.layers.map((l) =>
      l.id === target.id
        ? {
            ...l,
            effects: structuredClone(settings.effects),
            smartFilters: structuredClone(settings.smartFilters),
            ...(target.kind === "gradient" ? { gradient: structuredClone(settings.gradient) } : {}),
          }
        : l,
    ),
  };
  validateDocument(next);
  documentSources(next, maxArea);
  return next;
}
export function commitR8Document(
  current: ProDocument,
  draft: R8Draft,
  settings: R8Settings,
  maxArea: number,
) {
  if (current !== draft.origin)
    throw Error(
      "Layer properties canceled because the document changed. Reopen the current layer.",
    );
  return r8Document(draft, settings, maxArea);
}
/** Metadata-only editable fill, captured selection as a normal layer mask, above the full selected clipping stack. */
export function addGradientFill(
  doc: ProDocument,
  gradient: Gradient,
  selection: Selection,
  anchorId?: string,
  id: string = crypto.randomUUID(),
) {
  const anchor = doc.layers.find((l) => l.id === anchorId),
    parentId = anchor?.kind === "group" ? anchor.id : anchor?.parentId;
  if (parentId && isLocked(doc, parentId))
    throw Error("Unlock the destination group before adding a gradient fill.");
  const fill = layer("gradient", doc.width, doc.height, id);
  fill.gradient = structuredClone(gradient);
  fill.name = "Gradient Fill";
  if (parentId) fill.parentId = parentId;
  if (selection.regions.length || selection.inverted)
    fill.mask = maskFromSelection(selection, fill, doc);
  const own = siblings(doc, parentId),
    stack = stacks(own).find(
      (s) => s.base?.id === anchorId || s.clips.some((l) => l.id === anchorId),
    ),
    top = stack?.clips.at(-1) ?? stack?.base ?? own.at(-1),
    index = top
      ? doc.layers.indexOf(top) + 1
      : parentId
        ? doc.layers.findIndex((l) => l.id === parentId) + 1
        : doc.layers.length;
  const next = {
    ...upgradeR8Document(doc),
    layers: [...doc.layers.slice(0, index), fill, ...doc.layers.slice(index)],
  };
  validateDocument(next);
  return { document: next, layerId: id };
}
