import type { Region } from "./model.ts";
import { MAX_SELECTION_RUNS } from "./selection.ts";

export type RefineOptions = {
  radius: number;
  smooth: number;
  feather: number;
  contrast: number;
  shift: number;
  edgeAware: boolean;
  cleanup?: number;
  fillHoles?: boolean;
  foreground?: [number, number, number];
  background?: [number, number, number];
};
export const REFINE_DEFAULTS: RefineOptions = {
  radius: 3,
  smooth: 0,
  feather: 0,
  contrast: 0,
  shift: 0,
  edgeAware: true,
};
type Checkpoint = () => Promise<void>;
const noop: Checkpoint = async () => {};
const clamp = (n: number) => Math.max(0, Math.min(255, n));
export function validateRefine(o: RefineOptions) {
  for (const [key, min, max] of [
    ["radius", 0, 64],
    ["smooth", 0, 32],
    ["feather", 0, 100],
    ["contrast", 0, 1],
    ["shift", -64, 64],
  ] as const)
    if (!Number.isFinite(o[key]) || o[key] < min || o[key] > max)
      throw Error(`Invalid refinement ${key}.`);
  if (typeof o.edgeAware !== "boolean") throw Error("Invalid refinement mode.");
  if (
    o.cleanup !== undefined &&
    (!Number.isInteger(o.cleanup) || o.cleanup < 0 || o.cleanup > 4096)
  )
    throw Error("Invalid selection cleanup size.");
  if (o.fillHoles !== undefined && typeof o.fillHoles !== "boolean")
    throw Error("Invalid hole cleanup mode.");
  for (const color of [o.foreground, o.background])
    if (
      color !== undefined &&
      (!Array.isArray(color) ||
        color.length !== 3 ||
        !color.every((n) => Number.isFinite(n) && n >= 0 && n <= 255))
    )
      throw Error("Invalid refinement color sample.");
}
/** Separable square morphology, O(pixels), with replicated document boundaries.
 * Monotonic queues keep radius independent of execution cost. */
export async function morphology(
  input: Uint8Array,
  width: number,
  height: number,
  radius: number,
  expand: boolean,
  checkpoint: Checkpoint = noop,
): Promise<Uint8Array> {
  const r = Math.ceil(radius);
  if (!r) return input.slice();
  let source = input;
  for (const vertical of [false, true]) {
    const length = vertical ? height : width,
      lines = vertical ? width : height;
    const out = new Uint8Array(input.length),
      queue = new Int32Array(length + 2 * r);
    for (let line = 0; line < lines; line++) {
      if (line % 64 === 0) await checkpoint();
      const at = (i: number) =>
        vertical
          ? Math.max(0, Math.min(length - 1, i)) * width + line
          : line * width + Math.max(0, Math.min(length - 1, i));
      let head = 0,
        tail = 0;
      for (let i = -r; i < length + r; i++) {
        while (head < tail && queue[head]! < i - 2 * r) head++;
        while (
          head < tail &&
          (expand
            ? source[at(queue[tail - 1]!)]! <= source[at(i)]!
            : source[at(queue[tail - 1]!)]! >= source[at(i)]!)
        )
          tail--;
        queue[tail++] = i;
        if (i >= r) out[at(i - r)] = source[at(queue[head]!)]!;
      }
    }
    source = out;
  }
  return source;
}
/** Sliding box filter. Float intermediates avoid quantizing faint hair coverage. */
export async function boxFilter(
  input: Float32Array,
  width: number,
  height: number,
  radius: number,
  checkpoint: Checkpoint = noop,
): Promise<Float32Array> {
  const r = Math.ceil(radius);
  if (!r) return input.slice();
  let source = input;
  for (const vertical of [false, true]) {
    const length = vertical ? height : width,
      lines = vertical ? width : height;
    const out = new Float32Array(input.length);
    for (let line = 0; line < lines; line++) {
      if (line % 64 === 0) await checkpoint();
      const at = (i: number) =>
        vertical
          ? Math.max(0, Math.min(length - 1, i)) * width + line
          : line * width + Math.max(0, Math.min(length - 1, i));
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += source[at(i)]!;
      for (let i = 0; i < length; i++) {
        out[at(i)] = sum / (2 * r + 1);
        sum += source[at(i + r + 1)]! - source[at(i - r)]!;
      }
    }
    source = out;
  }
  return source;
}
export function coverageRegion(input: Uint8Array, width: number, height: number): Region {
  if (input.length !== width * height) throw Error("Invalid mask dimensions.");
  const runs: number[] = [];
  for (let y = 0; y < height; y++) {
    let start = 0,
      value = input[y * width]!;
    for (let x = 1; x <= width; x++) {
      const next = x === width ? -1 : input[y * width + x]!;
      if (next === value) continue;
      if (value) runs.push(y * width + start, x - start, value);
      if (runs.length > MAX_SELECTION_RUNS * 3)
        throw Error(
          "Refined mask exceeds the safe coverage budget. Reduce radius or feathering; the original selection is unchanged.",
        );
      start = x;
      value = next;
    }
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
/** Local color-line matting inside a bounded unknown band. This is traditional
 * image processing, not semantic segmentation. Ambiguous low-contrast pixels
 * retain the original matte. RGB statistics are weighted by source alpha. */
export async function refineSelection(
  rgba: Uint8ClampedArray,
  input: Uint8Array,
  width: number,
  height: number,
  options: RefineOptions,
  checkpoint: Checkpoint = noop,
): Promise<Uint8Array> {
  validateRefine(options);
  const count = width * height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    count > 16_777_216 ||
    input.length !== count ||
    rgba.length !== count * 4
  )
    throw Error("Invalid refinement image.");
  await checkpoint();
  let coverage: Uint8Array = input.slice();
  if (options.shift)
    coverage = await morphology(
      coverage,
      width,
      height,
      Math.abs(options.shift),
      options.shift > 0,
      checkpoint,
    );
  if (options.edgeAware && options.radius > 0) {
    const outer = await morphology(coverage, width, height, options.radius, true, checkpoint),
      inner = await morphology(coverage, width, height, options.radius, false, checkpoint),
      fgWeight = new Float32Array(count),
      bgWeight = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      fgWeight[i] = ((inner[i]! / 255) * rgba[i * 4 + 3]!) / 255;
      bgWeight[i] = ((1 - outer[i]! / 255) * rgba[i * 4 + 3]!) / 255;
    }
    const r = Math.max(2, options.radius * 2),
      fg = await boxFilter(fgWeight, width, height, r, checkpoint),
      bg = await boxFilter(bgWeight, width, height, r, checkpoint),
      numerator = new Float32Array(count),
      denominator = new Float32Array(count);
    for (let c = 0; c < 3; c++) {
      const values = new Float32Array(count);
      for (let i = 0; i < count; i++) values[i] = rgba[i * 4 + c]! * fgWeight[i]!;
      const f = await boxFilter(values, width, height, r, checkpoint);
      for (let i = 0; i < count; i++) values[i] = rgba[i * 4 + c]! * bgWeight[i]!;
      const b = await boxFilter(values, width, height, r, checkpoint);
      for (let i = 0; i < count; i++) {
        if (outer[i] === inner[i]) continue;
        if ((!options.foreground && fg[i]! < 0.001) || (!options.background && bg[i]! < 0.001))
          continue;
        const fc = options.foreground?.[c] ?? f[i]! / fg[i]!,
          bc = options.background?.[c] ?? b[i]! / bg[i]!,
          delta = fc - bc;
        numerator[i] += (rgba[i * 4 + c]! - bc) * delta;
        denominator[i] += delta * delta;
      }
      await checkpoint();
    }
    for (let i = 0; i < count; i++)
      if (outer[i] !== inner[i] && denominator[i]! > 75)
        coverage[i] = Math.round(clamp((255 * numerator[i]!) / denominator[i]!));
  }
  let result: Float32Array = Float32Array.from(coverage);
  if (options.smooth) result = await boxFilter(result, width, height, options.smooth, checkpoint);
  // Three sliding boxes approximate a Gaussian without Canvas/CSS blur.
  if (options.feather)
    for (let pass = 0; pass < 3; pass++)
      result = await boxFilter(result, width, height, options.feather / 2, checkpoint);
  const gain = 1 / Math.max(0.01, 1 - options.contrast);
  for (let i = 0; i < count; i++)
    coverage[i] = Math.round(clamp((result[i]! - 127.5) * gain + 127.5));
  await checkpoint();
  return coverage;
}

/** Native-resolution tiles with a full kernel halo. Only the output coverage and
 * input image scale with document area; temporary color statistics are bounded. */
export async function refineTiled(
  rgba: Uint8ClampedArray,
  input: Uint8Array,
  width: number,
  height: number,
  options: RefineOptions,
  checkpoint: Checkpoint = noop,
  progress: (done: number, total: number) => void = () => {},
): Promise<Uint8Array> {
  validateRefine(options);
  if (
    input.length !== width * height ||
    rgba.length !== width * height * 4 ||
    width * height > 16_777_216 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw Error("Invalid refinement image.");
  if (options.cleanup) {
    input = await cleanupCoverage(
      input,
      width,
      height,
      options.cleanup,
      !!options.fillHoles,
      checkpoint,
    );
  }
  const halo =
      Math.ceil(Math.abs(options.shift)) +
      (options.edgeAware
        ? Math.ceil(options.radius) + Math.ceil(Math.max(2, options.radius * 2))
        : 0) +
      Math.ceil(options.smooth) +
      3 * Math.ceil(options.feather / 2),
    out = new Uint8Array(input.length),
    tile = 256;
  let done = 0;
  const total = Math.ceil(width / tile) * Math.ceil(height / tile);
  for (let y = 0; y < height; y += tile)
    for (let x = 0; x < width; x += tile) {
      await checkpoint();
      const left = Math.max(0, x - halo),
        top = Math.max(0, y - halo),
        right = Math.min(width, x + tile + halo),
        bottom = Math.min(height, y + tile + halo),
        w = right - left,
        h = bottom - top,
        pixels = new Uint8ClampedArray(w * h * 4),
        mask = new Uint8Array(w * h);
      for (let row = 0; row < h; row++) {
        pixels.set(
          rgba.subarray(((top + row) * width + left) * 4, ((top + row) * width + right) * 4),
          row * w * 4,
        );
        mask.set(input.subarray((top + row) * width + left, (top + row) * width + right), row * w);
      }
      const result = await refineSelection(pixels, mask, w, h, options, checkpoint);
      for (let row = y; row < Math.min(height, y + tile); row++)
        out.set(
          result.subarray(
            (row - top) * w + x - left,
            (row - top) * w + Math.min(width, x + tile) - left,
          ),
          row * width + x,
        );
      progress(++done, total);
    }
  return out;
}

/** Four-connected small-island removal, optionally filling enclosed small holes.
 * Coverage of retained components is unchanged, including semi-transparent edges.
 * Border-connected background is never filled. */
export async function cleanupCoverage(
  input: Uint8Array,
  width: number,
  height: number,
  minimum: number,
  fillHoles: boolean,
  checkpoint: Checkpoint = noop,
) {
  const out = input.slice(),
    count = width * height,
    seen = new Uint8Array(count),
    queue = new Uint32Array(count);
  for (let start = 0; start < count; start++) {
    if (start % 65536 === 0) await checkpoint();
    if (seen[start]) continue;
    const foreground = input[start]! >= 128;
    let head = 0,
      tail = 1,
      border = false;
    queue[0] = start;
    seen[start] = 1;
    while (head < tail) {
      if (head % 65536 === 0) await checkpoint();
      const i = queue[head++]!,
        x = i % width,
        y = Math.floor(i / width);
      border ||= x === 0 || y === 0 || x === width - 1 || y === height - 1;
      for (const next of [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ])
        if (next >= 0 && !seen[next] && input[next]! >= 128 === foreground) {
          seen[next] = 1;
          queue[tail++] = next;
        }
    }
    if (tail < minimum && (foreground || (fillHoles && !border)))
      for (let i = 0; i < tail; i++) out[queue[i]!] = foreground ? 0 : 255;
  }
  return out;
}
