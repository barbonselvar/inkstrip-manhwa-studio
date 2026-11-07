/**
 * Deterministic bubble-placement suggestions.
 *
 * The analysis is advisory: it returns candidate rectangles and never moves an
 * existing object. Costs combine local visual detail (empty areas are cheap),
 * detected faces, existing lettering, and reading order.
 */
export type Rect = { x: number; y: number; width: number; height: number };
export type DetailGrid = {
  /** Region in chapter coordinates covered by the grid. */
  region: Rect;
  columns: number;
  rows: number;
  /** Row-major detail values in 0..1 (0 = flat, empty area). */
  values: Float32Array;
};
export type Suggestion = Rect & { cost: number; reason: string };

/** Per-cell detail from RGBA pixels: luminance spread plus mean gradient. */
export function detailGrid(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  region: Rect,
  cell = 8,
): DetailGrid {
  const columns = Math.max(1, Math.floor(width / cell)),
    rows = Math.max(1, Math.floor(height / cell)),
    values = new Float32Array(columns * rows);
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3]! / 255;
    // Transparent pixels read as empty white page.
    lum[i] =
      ((rgba[i * 4]! * 0.299 + rgba[i * 4 + 1]! * 0.587 + rgba[i * 4 + 2]! * 0.114) * a +
        255 * (1 - a)) /
      255;
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      let sum = 0,
        sq = 0,
        grad = 0,
        count = 0;
      for (let y = r * cell; y < Math.min(height, (r + 1) * cell); y++)
        for (let x = c * cell; x < Math.min(width, (c + 1) * cell); x++) {
          const v = lum[y * width + x]!;
          sum += v;
          sq += v * v;
          if (x + 1 < width) grad += Math.abs(lum[y * width + x + 1]! - v);
          if (y + 1 < height) grad += Math.abs(lum[(y + 1) * width + x]! - v);
          count++;
        }
      const mean = sum / count,
        std = Math.sqrt(Math.max(0, sq / count - mean * mean));
      values[r * columns + c] = Math.min(1, std * 2.2 + (grad / count) * 3);
    }
  return { region, columns, rows, values };
}

function overlapArea(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
export function iou(a: Rect, b: Rect) {
  const i = overlapArea(a, b);
  return i / (a.width * a.height + b.width * b.height - i || 1);
}

export function suggestPlacements(
  grid: DetailGrid,
  size: { width: number; height: number },
  options: {
    faces?: Rect[];
    occupied?: Rect[];
    /** Reading direction inside a row; webtoons default to left-to-right. */
    rtl?: boolean;
    margin?: number;
    count?: number;
  } = {},
): Suggestion[] {
  const { region, columns, rows, values } = grid,
    margin = options.margin ?? 16,
    count = options.count ?? 3,
    faces = options.faces ?? [],
    occupied = options.occupied ?? [];
  const cw = region.width / columns,
    ch = region.height / rows;
  const width = Math.min(size.width, region.width - margin * 2),
    height = Math.min(size.height, region.height - margin * 2);
  if (width <= 0 || height <= 0) return [];
  // Summed-area table gives O(1) mean detail per candidate.
  const sat = new Float64Array((columns + 1) * (rows + 1));
  for (let r = 0; r < rows; r++) {
    let line = 0;
    for (let c = 0; c < columns; c++) {
      line += values[r * columns + c]!;
      sat[(r + 1) * (columns + 1) + c + 1] = sat[r * (columns + 1) + c + 1]! + line;
    }
  }
  const sum = (c0: number, r0: number, c1: number, r1: number) =>
    sat[r1 * (columns + 1) + c1]! -
    sat[r0 * (columns + 1) + c1]! -
    sat[r1 * (columns + 1) + c0]! +
    sat[r0 * (columns + 1) + c0]!;
  // Reading order: a new bubble should follow the last existing one.
  const last = occupied.reduce<Rect | null>(
    (best, o) => (!best || o.y + o.height / 2 > best.y + best.height / 2 ? o : best),
    null,
  );
  const candidates: Suggestion[] = [];
  const step = Math.max(cw, ch, 8);
  for (let y = region.y + margin; y + height <= region.y + region.height - margin + 1e-6; y += step)
    for (
      let x = region.x + margin;
      x + width <= region.x + region.width - margin + 1e-6;
      x += step
    ) {
      const rect = { x, y, width, height };
      const c0 = Math.max(0, Math.floor((x - region.x) / cw)),
        r0 = Math.max(0, Math.floor((y - region.y) / ch)),
        c1 = Math.min(columns, Math.ceil((x + width - region.x) / cw)),
        r1 = Math.min(rows, Math.ceil((y + height - region.y) / ch));
      const detail = sum(c0, r0, c1, r1) / Math.max(1, (c1 - c0) * (r1 - r0));
      const area = width * height;
      const face = faces.reduce((v, f) => v + overlapArea(rect, f), 0) / area,
        collide = occupied.reduce((v, o) => v + overlapArea(rect, o), 0) / area;
      let order = 0;
      if (last) {
        const lastCenter = last.y + last.height / 2,
          center = y + height / 2;
        if (center < lastCenter - height * 0.25) order = 0.6;
        else if (Math.abs(center - lastCenter) < height * 0.5) {
          // Same row: continue in reading direction.
          const ahead = options.rtl ? x + width <= last.x + 1 : x >= last.x + last.width - 1;
          order = ahead ? 0 : 0.4;
        }
      }
      // A light preference for the upper part keeps dialogue near the start of a beat.
      const vertical = ((y - region.y) / Math.max(1, region.height - height)) * 0.12,
        horizontal =
          ((options.rtl ? region.x + region.width - (x + width) : x - region.x) /
            Math.max(1, region.width - width)) *
          0.04;
      const cost = detail + face * 6 + collide * 4 + order + vertical + horizontal;
      const reason =
        face > 0.01
          ? "overlaps a detected face"
          : collide > 0.01
            ? "touches existing lettering"
            : detail < 0.08
              ? "empty area"
              : detail < 0.25
                ? "low-detail area"
                : "busy artwork";
      candidates.push({ ...rect, cost, reason });
    }
  candidates.sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
  // Prefer clearly separate alternatives; allow light overlap only to fill the list.
  const picked: Suggestion[] = [];
  for (const limit of [0, 0.25])
    for (const c of candidates) {
      if (picked.length >= count) break;
      if (
        !picked.includes(c) &&
        picked.every((p) => (limit ? iou(p, c) < limit : !overlapArea(p, c)))
      )
        picked.push(c);
    }
  return picked;
}
