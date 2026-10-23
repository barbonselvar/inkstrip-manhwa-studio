/**
 * Selection feathering without Canvas `filter`.
 *
 * Safari/iOS do not implement `OffscreenCanvasRenderingContext2D.filter`, so a CSS
 * `blur()` there is silently ignored and feathered selections, masks and clipped strokes
 * render hard-edged. This module provides a deterministic replacement for a Gaussian of
 * the requested standard deviation (the same meaning as CSS `blur(<radius>)`): an exact
 * separable kernel for small radii and three variance-matched box blurs above, with edge
 * pixels extended so a selection touching the document edge stays fully selected there.
 */

/** True when the context honours `filter` (Chrome, Edge, Firefox ≥ 116). */
export function supportsCanvasFilter(ctx: { filter?: unknown }) {
  return typeof ctx.filter === "string";
}

/** Odd box widths for `passes` box blurs approximating a Gaussian with this sigma. */
export function gaussianBoxes(sigma: number, passes = 3) {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2,
    lowerCount = Math.round(
      (12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) /
        (-4 * lower - 4),
    );
  return Array.from({ length: passes }, (_, i) => (i < lowerCount ? lower : upper));
}

/** One running-sum box pass along rows or columns, extending edge values. */
function boxPass(
  data: Float32Array,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean,
  line: Float32Array,
) {
  const length = horizontal ? w : h,
    lines = horizontal ? h : w,
    step = horizontal ? 1 : w,
    span = 2 * radius + 1;
  for (let l = 0; l < lines; l++) {
    const start = horizontal ? l * w : l;
    for (let i = 0; i < length; i++) line[i] = data[start + i * step]!;
    const first = line[0]!,
      last = line[length - 1]!;
    let sum = first * (radius + 1);
    for (let i = 1; i <= radius; i++) sum += i < length ? line[i]! : last;
    for (let i = 0; i < length; i++) {
      data[start + i * step] = sum / span;
      const enter = i + radius + 1,
        leave = i - radius;
      sum += (enter < length ? line[enter]! : last) - (leave > 0 ? line[leave]! : first);
    }
  }
}

/** One exact Gaussian pass along rows or columns, extending edge values. */
function kernelPass(
  data: Float32Array,
  w: number,
  h: number,
  kernel: Float32Array,
  horizontal: boolean,
  line: Float32Array,
) {
  const length = horizontal ? w : h,
    lines = horizontal ? h : w,
    step = horizontal ? 1 : w,
    radius = (kernel.length - 1) / 2;
  for (let l = 0; l < lines; l++) {
    const start = horizontal ? l * w : l;
    for (let i = 0; i < length; i++) line[i] = data[start + i * step]!;
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++)
        sum += line[Math.min(length - 1, Math.max(0, i + k))]! * kernel[k + radius]!;
      data[start + i * step] = sum;
    }
  }
}

/** Below this sigma an exact kernel is cheap and box passes are too coarse. */
const EXACT_SIGMA = 4;

/**
 * Feather an 8-bit alpha plane and return the new 8-bit alpha.
 * `sigma` is the Gaussian standard deviation in pixels (CSS `blur()` radius).
 */
export function featherAlpha(alpha: ArrayLike<number>, w: number, h: number, sigma: number) {
  const out = new Uint8ClampedArray(w * h);
  if (!(sigma > 0) || w < 1 || h < 1) {
    for (let i = 0; i < out.length; i++) out[i] = alpha[i]!;
    return out;
  }
  const data = new Float32Array(w * h),
    line = new Float32Array(Math.max(w, h));
  for (let i = 0; i < data.length; i++) data[i] = alpha[i]!;
  if (sigma <= EXACT_SIGMA) {
    const radius = Math.ceil(sigma * 3),
      kernel = new Float32Array(radius * 2 + 1);
    let total = 0;
    for (let i = 0; i < kernel.length; i++)
      total += kernel[i] = Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma));
    for (let i = 0; i < kernel.length; i++) kernel[i] = kernel[i]! / total;
    kernelPass(data, w, h, kernel, true, line);
    kernelPass(data, w, h, kernel, false, line);
  } else
    for (const size of gaussianBoxes(sigma)) {
      const radius = (size - 1) / 2;
      if (radius < 1) continue;
      boxPass(data, w, h, radius, true, line);
      boxPass(data, w, h, radius, false, line);
    }
  for (let i = 0; i < out.length; i++) out[i] = Math.round(data[i]!);
  return out;
}
