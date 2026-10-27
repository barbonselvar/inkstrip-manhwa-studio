import { validateSelection, type Selection, type Stroke } from "./model.ts";
export type MaskPaintState = { base: Selection; strokes: Stroke[] };
export function maskPaintSize(width: number, height: number) {
  const w = Math.ceil(width),
    h = Math.ceil(height);
  if (
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w < 1 ||
    h < 1 ||
    w > 16384 ||
    h > 16384 ||
    w * h > 4_000_000
  )
    throw Error(
      "Paintable Smart Filter masks support native source planes up to4MP. No image was resized.",
    );
  return { width: w, height: h };
}
export function validateMaskPaintSelection(s: Selection, area: number) {
  validateSelection(s);
  if (
    (s.frame && s.frame.width * s.frame.height > 4_000_000) ||
    s.regions.some((r) => r.pixels && r.pixels.width * r.pixels.height > 4_000_000) ||
    s.regions.length * area > 64_000_000
  )
    throw Error(
      "This captured selection exceeds the filter-mask editor's preview budget. Clear or simplify the selection before painting.",
    );
}
export function validateMaskPaintWork(strokes: Stroke[], area = 0) {
  if (strokes.length > 50) throw Error("Finish this mask edit before adding more strokes.");
  let points = 0,
    dabs = 0,
    pixels = 0;
  for (const s of strokes) {
    if (
      !s.points.length ||
      !Number.isFinite(s.size) ||
      s.size < 1 ||
      s.size > 512 ||
      !Number.isFinite(s.opacity) ||
      s.opacity < 0 ||
      s.opacity > 1 ||
      !Number.isFinite(s.hardness) ||
      s.hardness < 0 ||
      s.hardness > 1
    )
      throw Error("Invalid filter-mask brush settings.");
    if (s.clip) {
      validateMaskPaintSelection(s.clip, area);
      pixels += s.clip.regions.length * area;
    }
    points += s.points.length;
    let count = 1;
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i]!;
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 100000 ||
        Math.abs(p.y) > 100000
      )
        throw Error("Invalid filter-mask brush point.");
      if (i)
        count += Math.ceil(
          Math.hypot(p.x - s.points[i - 1]!.x, p.y - s.points[i - 1]!.y) /
            Math.max(1, s.size * 0.1),
        );
    }
    dabs += count;
    pixels += count * Math.ceil(s.size) ** 2;
  }
  if (points > 20000 || dabs > 200000 || pixels > 64_000_000)
    throw Error(
      "Mask brush preview reached its safe work budget. Undo a stroke or finish this edit before continuing.",
    );
}
