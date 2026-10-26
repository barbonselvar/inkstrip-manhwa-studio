import type { ProDocument, Stroke } from "./model.ts";
import { affine, applyMatrix } from "./transform.ts";
import { maskWorld } from "./masks.ts";
type Rect = { x: number; y: number; width: number; height: number };
const unchanged = (a: object, b: object, except: string) => {
  const aa = a as Record<string, unknown>,
    bb = b as Record<string, unknown>;
  return Object.keys({ ...aa, ...bb }).every((key) => key === except || aa[key] === bb[key]);
};
function changedTail(a: Stroke[], b: Stroke[]) {
  if (Math.abs(a.length - b.length) > 1) return;
  const count = Math.max(a.length, b.length);
  if (!count) return;
  for (let i = 0; i < count - 1; i++) if (a[i] !== b[i]) return;
  return [a.at(-1), b.at(-1)].filter((s): s is Stroke => !!s);
}
/** Conservative presentation-only dirty rectangle. The existing worker still
 * computes the bounded full preview; unsafe geometry/filter changes fall back to
 * a complete presentation. Erase/cancel must clear this rectangle before copying. */
export function previewDirtyRect(
  previous: ProDocument | null,
  next: ProDocument,
  width: number,
  height: number,
): Rect | null {
  if (
    !previous ||
    !unchanged(previous, next, "layers") ||
    previous.layers.length !== next.layers.length
  )
    return null;
  if (
    next.layers.some(
      (l) =>
        l.effects?.some((e) => e.enabled) ||
        l.smartFilters?.some((f) => f.enabled) ||
        l.adjustments.blur ||
        l.adjustments.sharpen,
    )
  )
    return null;
  const changed = next.layers.filter((l, i) => l !== previous.layers[i]);
  if (changed.length !== 1) return null;
  const l = changed[0]!,
    old = previous.layers[next.layers.indexOf(l)]!;
  if (l.id !== old.id || l.transform.deform) return null;
  let strokes: Stroke[] | undefined,
    matrix = affine(l.transform);
  if (unchanged(old, l, "strokes")) strokes = changedTail(old.strokes, l.strokes);
  else if (
    unchanged(old, l, "mask") &&
    old.mask &&
    l.mask &&
    unchanged(old.mask, l.mask, "strokes") &&
    !l.mask.feather
  ) {
    strokes = changedTail(old.mask.strokes, l.mask.strokes);
    matrix = maskWorld(l);
  }
  if (!strokes?.length) return null;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const s of strokes) {
    if (s.patch) return null;
    const radius =
      (s.size / 2) * (1 + (s.dynamics?.scatter ?? 0)) * (s.tip === "square" ? Math.SQRT2 : 1) + 2;
    for (const point of s.points)
      for (const dx of [-radius, radius])
        for (const dy of [-radius, radius]) {
          const p = applyMatrix(matrix, { x: point.x + dx, y: point.y + dy });
          left = Math.min(left, p.x);
          top = Math.min(top, p.y);
          right = Math.max(right, p.x);
          bottom = Math.max(bottom, p.y);
        }
  }
  const sx = width / next.width,
    sy = height / next.height;
  const x = Math.max(0, Math.floor(left * sx) - 2),
    y = Math.max(0, Math.floor(top * sy) - 2),
    endX = Math.min(width, Math.ceil(right * sx) + 2),
    endY = Math.min(height, Math.ceil(bottom * sy) + 2);
  return endX > x && endY > y ? { x, y, width: endX - x, height: endY - y } : null;
}
