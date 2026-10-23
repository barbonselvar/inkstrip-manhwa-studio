import type { Point, Region } from "./model.ts";

export type ColorSelectionOptions = {
  tolerance: number;
  contiguous: boolean;
  antiAlias: boolean;
};
export const MAX_SELECTION_RUNS = 200_000;
/** Straight-alpha sRGB distance in 0..255. Hidden RGB in transparent pixels is ignored. */
export function colorDistance(pixels: Uint8ClampedArray, a: number, b: number) {
  const aa = pixels[a + 3]! / 255,
    ba = pixels[b + 3]! / 255;
  return Math.max(
    Math.abs(pixels[a]! * aa - pixels[b]! * ba),
    Math.abs(pixels[a + 1]! * aa - pixels[b + 1]! * ba),
    Math.abs(pixels[a + 2]! * aa - pixels[b + 2]! * ba),
    Math.abs(pixels[a + 3]! - pixels[b + 3]!),
  );
}
/** Four-connected flood fill or whole-image color range, always at input resolution.
 * Runs are row-bounded [start, length, coverage] triples, with zero coverage omitted.
 * A one-pixel binomial filter provides optional subpixel boundary coverage.
 */
export function selectColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  point: Point,
  options: ColorSelectionOptions,
): Region {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 16_777_216 ||
    pixels.length !== width * height * 4 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= width ||
    point.y >= height ||
    !Number.isFinite(options.tolerance) ||
    options.tolerance < 0 ||
    options.tolerance > 255
  )
    throw new Error("Invalid color selection input.");
  const count = width * height,
    seed = Math.floor(point.y) * width + Math.floor(point.x),
    selected = new Uint8Array(count),
    matches = (i: number) => colorDistance(pixels, i * 4, seed * 4) <= options.tolerance;
  if (options.contiguous) {
    const queue = new Int32Array(count);
    let head = 0,
      tail = 1;
    queue[0] = seed;
    selected[seed] = 255;
    const visit = (i: number) => {
      if (selected[i]) return;
      // Remember rejected pixels too: each pixel is visited at most once.
      selected[i] = matches(i) ? 255 : 1;
      if (selected[i] === 255) queue[tail++] = i;
    };
    while (head < tail) {
      const i = queue[head++]!,
        x = i % width;
      if (x) visit(i - 1);
      if (x + 1 < width) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i + width < count) visit(i + width);
    }
    for (let i = 0; i < count; i++) if (selected[i] !== 255) selected[i] = 0;
  } else {
    for (let i = 0; i < count; i++) if (matches(i)) selected[i] = 255;
  }
  const coverage = (x: number, y: number) => {
    if (!options.antiAlias) return selected[y * width + x]!;
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const px = Math.max(0, Math.min(width - 1, x + dx)),
          py = Math.max(0, Math.min(height - 1, y + dy));
        sum += selected[py * width + px]! * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
      }
    return Math.round(sum / 16);
  };
  const runs: number[] = [];
  for (let y = 0; y < height; y++) {
    let start = 0,
      value = coverage(0, y);
    const flush = (end: number) => {
      if (value) runs.push(y * width + start, end - start, value);
      if (runs.length > MAX_SELECTION_RUNS * 3)
        throw new Error(
          "Selection is too fragmented. Increase tolerance or disable anti-aliasing.",
        );
    };
    for (let x = 1; x < width; x++) {
      const next = coverage(x, y);
      if (next !== value) {
        flush(x);
        start = x;
        value = next;
      }
    }
    flush(width);
  }
  return {
    kind: "pixels",
    operation: "add",
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: height },
    ],
    pixels: { width, height, runs },
  };
}

/** Preserve boolean meaning when an operation follows a globally inverted selection. */
export function appendSelection(selection: import("./model.ts").Selection, region: Region) {
  if (!selection.inverted) return { ...selection, regions: [...selection.regions, region] };
  const operation = region.operation === "add" ? "subtract" : "add";
  const next: Region = {
    ...region,
    operation,
    inverted: region.operation === "intersect" ? !region.inverted : region.inverted,
  };
  return { ...selection, regions: [...selection.regions, next] };
}
