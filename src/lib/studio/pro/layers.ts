import { transformGroupMask } from "./masks.ts";
/** Layer structure is bottom-to-top within each parent. Clipping stacks never cross groups. */
import { layer, validateDocument, type Layer, type ProDocument, type Point } from "./model.ts";
import { isLocked } from "./operations.ts";
export type Stack = { base?: Layer; clips: Layer[] };
export function stacks(layers: Layer[]): Stack[] {
  const result: Stack[] = [];
  for (const l of layers) {
    if (l.clipped) {
      if (!result.length) result.push({ clips: [] });
      result.at(-1)!.clips.push(l);
    } else result.push({ base: l, clips: [] });
  }
  return result;
}
export function siblings(d: ProDocument, parentId?: string) {
  return d.layers.filter((l) => l.parentId === parentId);
}
export function descendants(d: ProDocument, ids: string[]): Set<string> {
  const result = new Set(ids);
  for (let n = 0; n < 4; n++)
    for (const l of d.layers) if (l.parentId && result.has(l.parentId)) result.add(l.id);
  return result;
}
export function selectedRoots(d: ProDocument, ids: string[]): Layer[] {
  const chosen = new Set(ids);
  return d.layers.filter((l) => {
    if (!chosen.has(l.id)) return false;
    let parent = l.parentId;
    while (parent) {
      if (chosen.has(parent)) return false;
      parent = d.layers.find((l) => l.id === parent)?.parentId;
    }
    return true;
  });
}
export function clipBase(d: ProDocument, id: string) {
  const l = d.layers.find((l) => l.id === id);
  return (
    l &&
    stacks(siblings(d, l.parentId)).find(
      (s) => s.base?.id === id || s.clips.some((c) => c.id === id),
    )?.base
  );
}
/** Effective visibility includes hidden ancestors AND the base of a clipping stack. */
export function visibleLayerIds(d: ProDocument): Set<string> {
  const result = new Set<string>();
  const visit = (parent?: string) => {
    for (const { base, clips } of stacks(siblings(d, parent))) {
      if (!base?.visible) continue;
      for (const l of [base, ...clips]) {
        if (!l.visible) continue;
        result.add(l.id);
        if (l.kind === "group") visit(l.id);
      }
    }
  };
  visit();
  return result;
}
function unlocked(d: ProDocument, ids: Iterable<string>) {
  if ([...ids].some((id) => isLocked(d, id)))
    throw new Error("Unlock the selected layers and their groups before this operation.");
}
function checked(d: ProDocument): ProDocument {
  validateDocument(d);
  return d;
}
function cleanLinks(d: ProDocument): ProDocument {
  const counts = new Map<string, number>();
  for (const l of d.layers) if (l.linkId) counts.set(l.linkId, (counts.get(l.linkId) ?? 0) + 1);
  return {
    ...d,
    layers: d.layers.map((l) =>
      l.linkId && counts.get(l.linkId) === 1 ? { ...l, linkId: undefined } : l,
    ),
  };
}
/** Moving a base moves its complete clipping stack; moving an individual clip changes its base by order. */
function withBaseClips(d: ProDocument, roots: Layer[]): Layer[] {
  const ids = new Set(roots.map((l) => l.id));
  for (const l of roots) {
    if (l.clipped) continue;
    const stack = stacks(siblings(d, l.parentId)).find((s) => s.base?.id === l.id);
    for (const c of stack?.clips ?? []) ids.add(c.id);
  }
  return selectedRoots(d, [...ids]);
}
export function duplicateLayers(d: ProDocument, ids: string[]) {
  const roots = withBaseClips(d, selectedRoots(d, ids));
  if (!roots.length) throw new Error("Select layers to duplicate.");
  const all = descendants(
    d,
    roots.map((l) => l.id),
  );
  unlocked(d, all);
  const mapping = new Map<string, string>([...all].map((id) => [id, crypto.randomUUID()]));
  const links = new Map<string, string>();
  for (const l of d.layers) if (all.has(l.id) && l.linkId) links.set(l.linkId, crypto.randomUUID());
  const copies = d.layers
    .filter((l) => all.has(l.id))
    .map((l) => ({
      ...structuredClone(l),
      id: mapping.get(l.id)!,
      ...(l.bubble
        ? {
            bubble: {
              ...structuredClone(l.bubble),
              textId: l.bubble.textId ? mapping.get(l.bubble.textId) : undefined,
            },
          }
        : {}),
      name: (l.name + " copy").slice(0, 100),
      parentId: l.parentId && mapping.has(l.parentId) ? mapping.get(l.parentId) : l.parentId,
      linkId: l.linkId ? links.get(l.linkId) : undefined,
    }));
  // Insert each copied root after its original stack, keeping every subtree and clip chain intact.
  const layers = [...d.layers];
  for (const root of roots) {
    const stack = stacks(siblings(d, root.parentId)).find(
      (s) => s.base?.id === root.id || s.clips.some((c) => c.id === root.id),
    );
    const last = stack?.clips.at(-1) ?? root;
    const index = layers.findIndex((l) => l.id === last.id);
    const already = roots.filter(
      (r) =>
        r.parentId === root.parentId &&
        (stack?.base?.id === r.id || stack?.clips.some((c) => c.id === r.id)),
    );
    if (already.at(-1)?.id !== root.id) continue;
    const rootIds = new Set(already.map((l) => mapping.get(l.id)!));
    layers.splice(index + 1, 0, ...copies.filter((l) => rootIds.has(l.id)));
  }
  layers.push(...copies.filter((l) => l.parentId && mappingHasValue(mapping, l.parentId)));
  const document = checked(cleanLinks({ ...d, layers }));
  return { document, ids: roots.map((l) => mapping.get(l.id)!) };
}
function mappingHasValue(map: Map<string, string>, id: string) {
  return [...map.values()].includes(id);
}
export function linkLayers(d: ProDocument, ids: string[]): ProDocument {
  const chosen = selectedRoots(d, ids);
  if (chosen.length < 2) throw new Error("Select at least two layers to link.");
  const previous = new Set(chosen.flatMap((l) => (l.linkId ? [l.linkId] : [])));
  const members = new Set(
    d.layers
      .filter((l) => ids.includes(l.id) || (l.linkId && previous.has(l.linkId)))
      .map((l) => l.id),
  );
  unlocked(d, members);
  const linkId = crypto.randomUUID();
  return checked({ ...d, layers: d.layers.map((l) => (members.has(l.id) ? { ...l, linkId } : l)) });
}
export function unlinkLayers(d: ProDocument, ids: string[]): ProDocument {
  unlocked(d, ids);
  return cleanLinks({
    ...d,
    layers: d.layers.map((l) => (ids.includes(l.id) ? { ...l, linkId: undefined } : l)),
  });
}
/** Translation propagates through selected groups and linked objects exactly once. */
export function translationIds(d: ProDocument, ids: string[]): Set<string> {
  const result = descendants(d, ids);
  for (let n = 0; n < d.layers.length; n++) {
    const previous = result.size;
    const links = new Set(
      d.layers.flatMap((l) => (result.has(l.id) && l.linkId ? [l.linkId] : [])),
    );
    for (const l of d.layers) if (l.linkId && links.has(l.linkId)) result.add(l.id);
    for (const id of descendants(d, [...result])) result.add(id);
    if (result.size === previous) break;
  }
  return result;
}
export function translateLayers(d: ProDocument, ids: string[], delta: Point): ProDocument {
  const all = translationIds(d, ids);
  unlocked(d, all);
  return checked({
    ...d,
    layers: d.layers.map((l) =>
      all.has(l.id) && l.kind !== "group"
        ? {
            ...l,
            transform: { ...l.transform, x: l.transform.x + delta.x, y: l.transform.y + delta.y },
          }
        : all.has(l.id)
          ? transformGroupMask(l, [1, 0, 0, 1, delta.x, delta.y])
          : l,
    ),
  });
}
export function setClipping(d: ProDocument, ids: string[], clipped: boolean): ProDocument {
  const chosen = selectedRoots(d, ids);
  unlocked(
    d,
    chosen.map((l) => l.id),
  );
  const next = {
    ...d,
    layers: d.layers.map((l) => (chosen.some((c) => c.id === l.id) ? { ...l, clipped } : l)),
  };
  if (clipped && chosen.some((l) => !clipBase(next, l.id)))
    throw new Error("A clipping mask needs an unclipped base below it in the same group.");
  return checked(next);
}
function completeRange(d: ProDocument, ids: string[]) {
  const chosen = selectedRoots(d, ids);
  if (!chosen.length || chosen.some((l) => l.parentId !== chosen[0]!.parentId))
    throw new Error("Select layers in the same group.");
  const list = siblings(d, chosen[0]!.parentId),
    indices = chosen.map((l) => list.indexOf(l));
  const lo = Math.min(...indices),
    hi = Math.max(...indices);
  if (hi - lo + 1 !== chosen.length)
    throw new Error("Select a consecutive layer range to preserve stacking order.");
  if (list[lo]!.clipped || list[hi + 1]?.clipped)
    throw new Error(
      "Include the entire clipping stack, including its base, before grouping or merging.",
    );
  return { chosen: list.slice(lo, hi + 1), list, lo, hi, parentId: chosen[0]!.parentId };
}
export function groupLayers(d: ProDocument, ids: string[]) {
  const range = completeRange(d, ids);
  if (
    range.chosen.some((l) => !l.clipped && l.blend !== "source-over") &&
    (range.lo > 0 || (!range.parentId && d.background !== "transparent"))
  )
    throw new Error(
      "Include the blend backdrop when creating an isolated group, or use Merge visible.",
    );
  if (
    range.lo > 0 &&
    [...descendants(d, ids)].some((id) => d.layers.find((l) => l.id === id)?.kind === "adjustment")
  )
    throw new Error(
      "Include the adjustment layer’s complete backdrop when creating an isolated group.",
    );
  if (range.chosen.length < 2) throw new Error("Select at least two consecutive layers to group.");
  unlocked(d, descendants(d, ids));
  const g = layer("group", d.width, d.height);
  g.parentId = range.parentId;
  g.name = "Layer group";
  const chosen = new Set(range.chosen.map((l) => l.id)),
    layers: Layer[] = [];
  for (const l of d.layers) {
    if (l.id === range.chosen[0]!.id) layers.push(g);
    layers.push(chosen.has(l.id) ? { ...l, parentId: g.id } : l);
  }
  return { document: checked({ ...d, layers }), id: g.id };
}
export function reparentLayers(d: ProDocument, ids: string[], parentId?: string) {
  const roots = withBaseClips(d, selectedRoots(d, ids));
  if (!roots.length || roots.every((l) => l.parentId === parentId)) return d;
  const all = descendants(
    d,
    roots.map((l) => l.id),
  );
  unlocked(d, all);
  if (parentId) {
    const parent = d.layers.find((l) => l.id === parentId);
    if (!parent || parent.kind !== "group" || all.has(parentId))
      throw new Error("A group cannot contain itself or its ancestors.");
    unlocked(d, [parentId]);
  }
  if (roots.some((l) => l.clipped && !roots.some((b) => b.id === clipBase(d, l.id)?.id)))
    throw new Error("Move the clipping base with its clipped layers when changing groups.");
  return checked({
    ...d,
    layers: [
      ...d.layers.filter((l) => !roots.includes(l)),
      ...roots.map((l) => ({ ...l, parentId })),
    ],
  });
}
/** Insertion reordering; siblings not selected retain their relative order. */
export function reorderLayers(
  d: ProDocument,
  ids: string[],
  targetId: string,
  edge: "before" | "after",
) {
  const roots = withBaseClips(d, selectedRoots(d, ids)),
    target = d.layers.find((l) => l.id === targetId);
  if (!target || !roots.length || roots.some((l) => l.parentId !== target.parentId))
    throw new Error("Reorder layers in the same group, or use Move to group.");
  unlocked(
    d,
    descendants(
      d,
      roots.map((l) => l.id),
    ),
  );
  if (roots.includes(target)) return d;
  const moving = new Set(roots.map((l) => l.id)),
    list = siblings(d, target.parentId).filter((l) => !moving.has(l.id));
  const targetStack = stacks(list).find(
    (s) => s.base?.id === target.id || s.clips.some((c) => c.id === target.id),
  );
  const boundary =
    roots.some((l) => !l.clipped) && targetStack?.base
      ? edge === "before"
        ? targetStack.base
        : (targetStack.clips.at(-1) ?? targetStack.base)
      : target;
  const index = list.indexOf(boundary) + (edge === "after" ? 1 : 0);
  list.splice(index, 0, ...roots);
  let n = 0;
  return checked({
    ...d,
    layers: d.layers.map((l) => (l.parentId === target.parentId ? list[n++]! : l)),
  });
}
export function moveLayers(d: ProDocument, ids: string[], direction: -1 | 1) {
  const roots = withBaseClips(d, selectedRoots(d, ids));
  if (!roots.length) return d;
  if (roots.some((l) => l.parentId !== roots[0]!.parentId))
    throw new Error("Reorder layers in the same group.");
  const list = siblings(d, roots[0]!.parentId),
    indices = roots.map((l) => list.indexOf(l));
  const target = list[(direction === 1 ? Math.max(...indices) : Math.min(...indices)) + direction];
  return target
    ? reorderLayers(
        d,
        roots.map((l) => l.id),
        target.id,
        direction === 1 ? "after" : "before",
      )
    : d;
}
export function deleteLayers(d: ProDocument, ids: string[]) {
  const roots = withBaseClips(d, selectedRoots(d, ids)),
    all = descendants(
      d,
      roots.map((l) => l.id),
    );
  unlocked(d, all);
  return checked(cleanLinks({ ...d, layers: d.layers.filter((l) => !all.has(l.id)) }));
}
export type MergeMode = "selected" | "visible" | "flatten";
export type MergePlan = {
  render: ProDocument;
  replacement: Layer;
  remove: string[];
  position?: string;
  retained?: Layer[];
};
/** Refuse backdrop-dependent partial merges rather than silently changing their blend result. */
export function planMerge(
  d: ProDocument,
  mode: MergeMode,
  ids: string[],
  assetId: string,
): MergePlan {
  const replacement = layer("raster", d.width, d.height);
  replacement.assetId = assetId;
  replacement.name =
    mode === "flatten"
      ? "Flattened image"
      : mode === "visible"
        ? "Merged visible"
        : "Merged layers";
  if (mode === "flatten")
    return { render: d, replacement, remove: d.layers.map((l) => l.id), retained: [] };
  if (mode === "visible") {
    const visible = visibleLayerIds(d);
    if (!visible.size) throw new Error("There are no visible layers to merge.");
    unlocked(d, visible);
    const retained: Layer[] = [];
    const keep = (l: Layer): boolean =>
      !visible.has(l.id) || (l.kind === "group" && siblings(d, l.id).some(keep));
    for (const l of d.layers)
      if (keep(l)) retained.push(visible.has(l.id) ? { ...l, visible: false, clipped: false } : l);
    return { render: d, replacement, remove: [...visible], retained };
  }
  const range = completeRange(d, ids),
    all = descendants(
      d,
      range.chosen.map((l) => l.id),
    );
  unlocked(d, all);
  if (!range.parentId && range.chosen.length === siblings(d).length)
    return { render: d, replacement, remove: [...all], retained: [] };
  if (d.layers.some((l) => all.has(l.id) && l.kind === "adjustment"))
    throw new Error("Use Merge visible to include the complete adjustment backdrop.");
  const units = stacks(range.chosen);
  if (units.length > 1 && range.chosen.some((l) => !l.clipped && l.blend !== "source-over"))
    throw new Error(
      "These blend modes depend on the backdrop. Include the full stack or use Merge visible to preserve appearance.",
    );
  replacement.parentId = range.parentId;
  const single = units.length === 1 ? units[0]!.base : undefined;
  if (single) {
    replacement.blend = single.blend;
    replacement.opacity = single.opacity;
    replacement.visible = single.visible;
  }
  const render: ProDocument = {
    ...d,
    background: "transparent",
    layers: d.layers
      .filter((l) => all.has(l.id))
      .map((l) => ({
        ...l,
        parentId: range.chosen.some((r) => r.id === l.id) ? undefined : l.parentId,
        ...(single?.id === l.id ? { opacity: 1, blend: "source-over" as const } : {}),
      })),
  };
  return { render, replacement, remove: [...all], position: range.chosen[0]!.id };
}
export function finishMerge(d: ProDocument, plan: MergePlan): ProDocument {
  if (plan.retained)
    return checked(cleanLinks({ ...d, layers: [...plan.retained, plan.replacement] }));
  const removed = new Set(plan.remove),
    layers: Layer[] = [];
  for (const l of d.layers) {
    if (l.id === plan.position) layers.push(plan.replacement);
    if (!removed.has(l.id)) layers.push(l);
  }
  return checked(cleanLinks({ ...d, layers }));
}
