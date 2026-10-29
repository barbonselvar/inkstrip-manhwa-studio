/**
 * Lossless page splitting for images over Raster Studio's limits (R10 D1, audit #4).
 *
 * A long page is cut into full-width horizontal parts that each fit this device's Raster
 * budget. Parts are new Chapter images; the original image is never changed. PNG pixels are
 * copied row for row (same bit depth, channels, palette and transparency), so stacking the
 * parts reproduces the original exactly. Anything that cannot be split exactly is refused
 * with a reason instead of being converted.
 */
export type SplitBudget = { maxSide: number; maxArea: number };
export type SplitPart = { y: number; height: number };

export class SplitError extends Error {}

/** True when an image is over the Raster budget and could become editable by splitting. */
export function needsSplit(width: number, height: number, budget: SplitBudget) {
  return width <= budget.maxSide && (height > budget.maxSide || width * height > budget.maxArea);
}

/** Full-width bands, as even as possible, each within `budget`. Covers every row once. */
export function splitPlan(width: number, height: number, budget: SplitBudget): SplitPart[] {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0))
    throw new SplitError("Image dimensions must be positive whole pixels.");
  const maxHeight = Math.min(budget.maxSide, Math.floor(budget.maxArea / width));
  if (width > budget.maxSide || maxHeight < 1)
    throw new SplitError(
      `This image is ${width}px wide; Raster Studio edits up to ${budget.maxSide}px per side, so splitting by height cannot help.`,
    );
  const count = Math.ceil(height / maxHeight);
  if (count > 64) throw new SplitError("Splitting would create more than 64 pages.");
  const base = Math.floor(height / count),
    extra = height % count,
    parts: SplitPart[] = [];
  for (let i = 0, y = 0; i < count; i++) {
    const h = base + (i < extra ? 1 : 0);
    parts.push({ y, height: h });
    y += h;
  }
  return parts;
}

/** PNG chunks whose loss would change how pixels are displayed or animated. */
const UNSPLITTABLE: Record<string, string> = {
  iCCP: "an embedded colour profile",
  gAMA: "gamma information",
  cHRM: "colour primaries",
  cICP: "colour space signalling",
  mDCV: "display colour volume metadata",
  cLLI: "light level metadata",
  acTL: "animation",
};

/** Refuse PNGs whose split parts could not display identically. */
export function checkPngSplittable(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset),
      type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (UNSPLITTABLE[type])
      throw new SplitError(
        `This PNG contains ${UNSPLITTABLE[type]}, which split pages would not keep. Export it as a plain sRGB PNG to split it; the original is unchanged.`,
      );
    if (type === "IDAT" || type === "IEND") return;
    offset += 12 + length;
  }
}

/** Elements of the decoded data array per row (packed bytes below 8 bits per sample). */
export function rowElements(width: number, channels: number, depth: number) {
  return depth >= 8 ? width * channels : Math.ceil((width * channels * depth) / 8);
}

export const partName = (name: string, index: number, count: number) => {
  const stem = name.replace(/\.[^.]+$/, "") || "page";
  return `${stem}-part-${String(index + 1).padStart(2, "0")}-of-${String(count).padStart(2, "0")}.png`;
};
