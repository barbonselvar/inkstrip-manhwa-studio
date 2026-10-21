import { validateDocument, type ProDocument, type Transform, type Point } from "./model.ts";
import { translateLayers } from "./layers.ts";
import { isLocked } from "./operations.ts";
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
  const moved = translation.x || translation.y ? translateLayers(doc, [id], translation) : doc,
    result = { ...moved, layers: moved.layers.map((l) => (l.id === id ? { ...l, transform } : l)) };
  validateDocument(result);
  return result;
}
