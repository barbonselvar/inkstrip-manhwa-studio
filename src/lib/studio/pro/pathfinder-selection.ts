import { contours, validateDocument, type Layer, type ProDocument } from "./model.ts";
import { isLocked } from "./operations.ts";
function neutral(d: ProDocument, l: Layer) {
  if (l.smartFilters?.length)
    throw new Error(
      "Remove Smart Filters before Pathfinder. Boolean geometry cannot preserve their editable source planes; source objects are unchanged.",
    );
  if (
    !["shape", "group"].includes(l.kind) ||
    isLocked(d, l.id) ||
    !l.visible ||
    l.clipped ||
    l.linkId ||
    l.mask ||
    l.vectorClips?.length ||
    l.appearance !== undefined ||
    l.textPath !== undefined ||
    l.transform.deform ||
    l.strokes.length ||
    l.opacity !== 1 ||
    l.blend !== "source-over" ||
    l.effects?.length ||
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
      "Pathfinder needs visible, unlocked affine shapes or neutral groups without masks, effects, links, clipping, painting or adjustments.",
    );
  if (l.kind === "shape" && (l.fill === "transparent" || (l.fillOpacity ?? 1) !== 1))
    throw new Error(
      "Pathfinder works on opaque filled regions. Stroke-only or translucent fills must be edited separately.",
    );
  const siblings = d.layers.filter((n) => n.parentId === l.parentId),
    next = siblings[siblings.indexOf(l) + 1];
  if (next?.clipped) throw new Error("Release the clipping stack before Pathfinder.");
}
/** Cheap selection eligibility shared by UI and the transaction; no geometry work. */
export function pathfinderSelection(d: ProDocument, ids: string[]) {
  validateDocument(d);
  if (
    !ids.length ||
    ids.length !== new Set(ids).size ||
    ids.some((id) => !d.layers.some((l) => l.id === id))
  )
    throw new Error("Select two or more filled vector objects in Layers.");
  const selected = new Set(ids),
    roots = d.layers.filter((l) => selected.has(l.id));
  if (roots.some((l) => l.parentId !== roots[0]!.parentId))
    throw new Error("Select sibling shapes or groups; do not select both a group and its child.");
  const siblings = d.layers.filter((l) => l.parentId === roots[0]!.parentId),
    start = siblings.indexOf(roots[0]!);
  if (siblings.slice(start, start + roots.length).some((l) => !selected.has(l.id)))
    throw new Error("Select consecutive siblings to preserve the unselected layer stack.");
  for (let parent = roots[0]!.parentId; parent;) {
    const l = d.layers.find((l) => l.id === parent)!;
    if (!l.visible) throw new Error("Show the containing group before Pathfinder.");
    parent = l.parentId;
  }
  const leaves: Layer[] = [],
    removed = new Set<string>();
  const walk = (l: Layer) => {
    neutral(d, l);
    if (
      l.kind === "shape" &&
      (l.shape === "line" ||
        (l.shape === "path" && !l.pathData && contours(l).some((c) => !c.closed)))
    )
      throw new Error(
        "Close every subpath before Pathfinder; open contours are not implicitly closed.",
      );
    removed.add(l.id);
    if (l.kind === "group") {
      const children = d.layers.filter((n) => n.parentId === l.id);
      if (!children.length) throw new Error("Empty groups cannot participate in Pathfinder.");
      children.forEach(walk);
    } else leaves.push(l);
  };
  roots.forEach(walk);
  if (leaves.length < 2 || leaves.length > 16)
    throw new Error("Pathfinder supports 2–16 filled shapes per operation.");
  return { roots, leaves, removed };
}
