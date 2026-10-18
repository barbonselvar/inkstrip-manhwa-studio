export type MaskPoint = { x: number; y: number };
export type MaskStroke = {
  mode: "add" | "subtract";
  size: number;
  hardness: number;
  opacity: number;
  points: MaskPoint[];
};
export type MaskMapping = { a: number; b: number; c: number; d: number; e: number; f: number };
export const MASK_LIMITS = { strokes: 128, points: 8192, perStroke: 512 } as const;
export function validateStrokes(strokes: MaskStroke[] | undefined) {
  if (strokes === undefined) return;
  if (!Array.isArray(strokes) || strokes.length > MASK_LIMITS.strokes)
    throw new Error("The selection is too complex. Clear it or use fewer strokes.");
  let points = 0;
  for (const stroke of strokes) {
    if (
      !stroke ||
      !["add", "subtract"].includes(stroke.mode) ||
      !Number.isFinite(stroke.size) ||
      stroke.size < 1 ||
      stroke.size > 2048 ||
      !Number.isFinite(stroke.hardness) ||
      stroke.hardness < 0 ||
      stroke.hardness > 1 ||
      !Number.isFinite(stroke.opacity) ||
      stroke.opacity < 0 ||
      stroke.opacity > 1 ||
      !Array.isArray(stroke.points) ||
      !stroke.points.length ||
      stroke.points.length > MASK_LIMITS.perStroke
    )
      throw new Error("Invalid selection brush stroke.");
    points += stroke.points.length;
    for (const point of stroke.points)
      if (
        !point ||
        !Number.isFinite(point.x) ||
        point.x < 0 ||
        point.x > 1 ||
        !Number.isFinite(point.y) ||
        point.y < 0 ||
        point.y > 1
      )
        throw new Error("Selection points must stay inside the source image.");
  }
  if (points > MASK_LIMITS.points)
    throw new Error("The selection has too many points. Clear it or use fewer strokes.");
}
/** Source-coordinate capsule coverage, stable across zoom, output transforms and tiles. */
export function rasterizeMask(
  strokes: MaskStroke[],
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  originX = 0,
  originY = 0,
  scaleX = width / sourceWidth,
  scaleY = height / sourceHeight,
  mapping?: MaskMapping,
) {
  const mask = new Float32Array(width * height);
  const m = mapping ?? {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: -originX * scaleX,
    f: -originY * scaleY,
  };
  const determinant = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new Error("Invalid mask mapping.");
  const map = (x: number, y: number) => ({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  });
  for (const stroke of strokes) {
    const coverage = new Float32Array(mask.length),
      radius = stroke.size / 2;
    for (let i = 0; i < stroke.points.length; i++) {
      const a = stroke.points[Math.max(0, i - 1)]!,
        b = stroke.points[i]!;
      const ax = a.x * sourceWidth,
        ay = a.y * sourceHeight,
        bx = b.x * sourceWidth,
        by = b.y * sourceHeight;
      const corners = [
        map(Math.min(ax, bx) - radius, Math.min(ay, by) - radius),
        map(Math.max(ax, bx) + radius, Math.min(ay, by) - radius),
        map(Math.min(ax, bx) - radius, Math.max(ay, by) + radius),
        map(Math.max(ax, bx) + radius, Math.max(ay, by) + radius),
      ];
      const left = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x)))),
        right = Math.min(width - 1, Math.ceil(Math.max(...corners.map((p) => p.x))));
      const top = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y)))),
        bottom = Math.min(height - 1, Math.ceil(Math.max(...corners.map((p) => p.y))));
      const dx = bx - ax,
        dy = by - ay,
        length = dx * dx + dy * dy;
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++) {
          const px = (m.d * (x + 0.5 - m.e) - m.c * (y + 0.5 - m.f)) / determinant,
            py = (-m.b * (x + 0.5 - m.e) + m.a * (y + 0.5 - m.f)) / determinant;
          const t = length
            ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
            : 0;
          const distance = Math.hypot(px - ax - t * dx, py - ay - t * dy) / radius;
          const edge = Math.max(1e-6, 1 - stroke.hardness);
          const alpha =
            (distance <= stroke.hardness ? 1 : Math.max(0, (1 - distance) / edge)) * stroke.opacity;
          const p = y * width + x;
          coverage[p] = Math.max(coverage[p]!, alpha);
        }
    }
    for (let p = 0; p < mask.length; p++)
      mask[p] =
        stroke.mode === "add" ? Math.max(mask[p]!, coverage[p]!) : mask[p]! * (1 - coverage[p]!);
  }
  return mask;
}
export function blendSelection(
  base: Uint8ClampedArray,
  changed: Uint8ClampedArray,
  mask: Float32Array,
) {
  if (base.length !== changed.length || base.length !== mask.length * 4)
    throw new Error("Invalid selection buffer.");
  const result = base.slice();
  for (let p = 0; p < mask.length; p++)
    if (mask[p] && base[p * 4 + 3])
      for (let c = 0; c < 3; c++)
        result[p * 4 + c] = base[p * 4 + c]! * (1 - mask[p]!) + changed[p * 4 + c]! * mask[p]!;
  return result;
}
