/** Native anchor operations. All coordinates/handles remain in the layer's local space. */
import {
  type Anchor,
  type Layer,
  type Point,
  type ProDocument,
  validateDocument,
} from "./model.ts";
import { isLocked } from "./operations.ts";
export type AnchorEdit =
  | { kind: "move"; point: Point }
  | { kind: "handle"; part: "incoming" | "outgoing"; point: Point; independent?: boolean }
  | { kind: "mode"; mode: NonNullable<Anchor["mode"]> }
  | { kind: "clear" }
  | { kind: "delete" };
const moved = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });
/** Pure per-anchor edit also used by live pointer preview. Alt breaks handle coupling. */
export function editedAnchor(
  a: Anchor,
  edit: Exclude<AnchorEdit, { kind: "delete" }>,
  previous?: Anchor,
  next?: Anchor,
): Anchor {
  if (edit.kind === "move") {
    const dx = edit.point.x - a.x,
      dy = edit.point.y - a.y;
    return {
      ...a,
      ...edit.point,
      incoming: a.incoming ? moved(a.incoming, dx, dy) : undefined,
      outgoing: a.outgoing ? moved(a.outgoing, dx, dy) : undefined,
    };
  }
  if (edit.kind === "clear") return { x: a.x, y: a.y, mode: "corner" };
  if (edit.kind === "handle") {
    const other = edit.part === "incoming" ? "outgoing" : "incoming",
      result = { ...a, [edit.part]: { ...edit.point } };
    if (edit.independent) return { ...result, mode: "corner" };
    if (!a.mode || a.mode === "corner") return result;
    const dx = edit.point.x - a.x,
      dy = edit.point.y - a.y,
      length = Math.hypot(dx, dy);
    // A collapsed handle has no direction. Retain the opposite smooth tangent.
    if (!length)
      return a.mode === "symmetric" ? { ...result, [other]: { x: a.x, y: a.y } } : result;
    const otherLength =
      a.mode === "symmetric"
        ? length
        : a[other]
          ? Math.hypot(a[other]!.x - a.x, a[other]!.y - a.y)
          : 0;
    return {
      ...result,
      [other]: { x: a.x - (dx * otherLength) / length, y: a.y - (dy * otherLength) / length },
    };
  }
  if (edit.mode === "corner") return { ...a, mode: edit.mode };
  // Prefer the outgoing direction, then the incoming direction, then neighbor chord.
  const out = a.outgoing ? { x: a.outgoing.x - a.x, y: a.outgoing.y - a.y } : { x: 0, y: 0 },
    inc = a.incoming ? { x: a.x - a.incoming.x, y: a.y - a.incoming.y } : { x: 0, y: 0 },
    ol = Math.hypot(out.x, out.y),
    il = Math.hypot(inc.x, inc.y),
    tangent = ol
      ? out
      : il
        ? inc
        : { x: (next ?? a).x - (previous ?? a).x, y: (next ?? a).y - (previous ?? a).y },
    tl = Math.hypot(tangent.x, tangent.y),
    unit = tl ? { x: tangent.x / tl, y: tangent.y / tl } : { x: 1, y: 0 },
    incomingLength = il || (previous ? Math.hypot(a.x - previous.x, a.y - previous.y) / 3 : ol),
    outgoingLength = ol || (next ? Math.hypot(next.x - a.x, next.y - a.y) / 3 : il),
    length = (incomingLength + outgoingLength) / 2;
  return {
    ...a,
    mode: edit.mode,
    incoming: moved(
      a,
      -unit.x * (edit.mode === "symmetric" ? length : incomingLength),
      -unit.y * (edit.mode === "symmetric" ? length : incomingLength),
    ),
    outgoing: moved(
      a,
      unit.x * (edit.mode === "symmetric" ? length : outgoingLength),
      unit.y * (edit.mode === "symmetric" ? length : outgoingLength),
    ),
  };
}
function editable(doc: ProDocument, id: string): Layer {
  validateDocument(doc);
  const l = doc.layers.find((l) => l.id === id);
  if (!l || l.kind !== "shape" || l.shape !== "path" || l.pathData)
    throw new Error(
      "Choose a native Bézier path. Imported SVG paths need conversion before anchor editing.",
    );
  if (isLocked(doc, id))
    throw new Error("Unlock the path and its ancestors before editing anchors.");
  return l;
}
function replace(doc: ProDocument, l: Layer, anchors: Anchor[]): ProDocument {
  const result = { ...doc, layers: doc.layers.map((n) => (n.id === l.id ? { ...n, anchors } : n)) };
  validateDocument(result);
  return result;
}
export function editAnchor(
  doc: ProDocument,
  id: string,
  index: number,
  edit: AnchorEdit,
): ProDocument {
  const l = editable(doc, id),
    n = l.anchors.length;
  if (!Number.isInteger(index) || index < 0 || index >= n)
    throw new Error("Choose an existing anchor.");
  if (edit.kind === "delete") {
    if (n <= (l.closed ? 3 : 2))
      throw new Error("Keep at least two anchors on an open path or three on a closed path.");
    // Adjacent handles are deliberately retained. Removing an anchor changes the path geometry.
    return replace(
      doc,
      l,
      l.anchors.filter((_, i) => i !== index),
    );
  }
  const previous = l.anchors[index > 0 ? index - 1 : l.closed ? n - 1 : -1],
    next = l.anchors[index + 1 < n ? index + 1 : l.closed ? 0 : -1];
  return replace(
    doc,
    l,
    l.anchors.map((a, i) => (i === index ? editedAnchor(a, edit, previous, next) : a)),
  );
}
/** Reverse traversal without changing the geometric locus or closed path's first anchor. */
export function reverseAnchors(doc: ProDocument, id: string): ProDocument {
  const l = editable(doc, id),
    reversed =
      l.closed && l.anchors.length
        ? [l.anchors[0]!, ...l.anchors.slice(1).reverse()]
        : [...l.anchors].reverse();
  return replace(
    doc,
    l,
    reversed.map(({ incoming, outgoing, ...a }) => ({
      ...a,
      ...(outgoing ? { incoming: { ...outgoing } } : {}),
      ...(incoming ? { outgoing: { ...incoming } } : {}),
    })),
  );
}
