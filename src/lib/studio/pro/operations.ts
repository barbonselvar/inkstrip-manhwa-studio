import type { ProDocument, Layer } from "./model.ts";
export function isLocked(d: ProDocument, id: string): boolean {
  let l = d.layers.find((l) => l.id === id);
  while (l) {
    if (l.locked) return true;
    l = d.layers.find((p) => p.id === l?.parentId);
  }
  return false;
}
export function reorderLayer(d: ProDocument, fromId: string, toId: string): ProDocument {
  const from = d.layers.find((l) => l.id === fromId),
    to = d.layers.find((l) => l.id === toId);
  if (!from || !to || from.parentId !== to.parentId || isLocked(d, fromId)) return d;
  const layers = [...d.layers],
    a = layers.indexOf(from),
    b = layers.indexOf(to);
  layers.splice(a, 1);
  layers.splice(b, 0, from);
  return { ...d, layers };
}
/** Ungroup only neutral, visible groups: group alpha/blend cannot be distributed losslessly. */
export function ungroupLayers(d: ProDocument, id: string): ProDocument {
  const g = d.layers.find((l) => l.id === id);
  if (!g || g.kind !== "group") return d;
  if (isLocked(d, id) || !g.visible || g.opacity !== 1 || g.blend !== "source-over")
    throw new Error(
      "To ungroup without changing appearance, unlock/show the group and set its opacity to 100% and blend to Normal first.",
    );
  const children = d.layers
      .filter((l) => l.parentId === id)
      .map((l) => ({ ...l, parentId: g.parentId })),
    layers: Layer[] = [];
  for (const l of d.layers) {
    if (l.id === id) layers.push(...children);
    else if (l.parentId !== id) layers.push(l);
  }
  return { ...d, layers };
}
