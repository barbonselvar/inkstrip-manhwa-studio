/**
 * Offline SFX / artwork extraction primitives.
 *
 * Everything here is pure typed-array math (no DOM, no network, no model download),
 * so it runs identically in the browser, in a worker and in node tests. Source pixel
 * buffers are never mutated: every operation returns a new buffer or edits a mask the
 * caller owns.
 *
 * Masks are `Uint8Array` of `width * height` coverage values (0 = removed, 255 = kept).
 * RGBA buffers are straight (non-premultiplied) 8-bit, row-major, like `ImageData`.
 */
export type Point = { x: number; y: number };
export type RGB = [number, number, number];
export type Rect = { x: number; y: number; width: number; height: number };
export type Pixels = Uint8Array | Uint8ClampedArray;

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function assertSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw Error("Invalid extraction surface size.");
}

/** Axis-aligned rectangle selection; corners may be given in any order and are clipped. */
export function rectSelection(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  assertSize(width, height);
  const mask = new Uint8Array(width * height);
  const left = Math.max(0, Math.round(Math.min(x0, x1))),
    right = Math.min(width, Math.round(Math.max(x0, x1))),
    top = Math.max(0, Math.round(Math.min(y0, y1))),
    bottom = Math.min(height, Math.round(Math.max(y0, y1)));
  for (let y = top; y < bottom; y++) mask.fill(255, y * width + left, y * width + right);
  return mask;
}

/** Even-odd scanline fill sampled at pixel centers. Used for polygon and lasso selections. */
export function polygonSelection(width: number, height: number, points: Point[]) {
  assertSize(width, height);
  const mask = new Uint8Array(width * height);
  if (points.length < 3) return mask;
  const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y)))),
    maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((p) => p.y))));
  const xs: number[] = [];
  for (let y = minY; y <= maxY; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!,
        b = points[(i + 1) % points.length]!;
      if (a.y <= cy === b.y <= cy) continue;
      xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      // Pixel x is inside when its center x + 0.5 lies in [xs[i], xs[i+1]).
      const start = Math.max(0, Math.ceil(xs[i]! - 0.5)),
        end = Math.min(width, Math.ceil(xs[i + 1]! - 0.5));
      if (end > start) mask.fill(255, y * width + start, y * width + end);
    }
  }
  return mask;
}

/** Bounding box of mask values above `threshold`, or null when empty. */
export function maskBounds(
  mask: Pixels,
  width: number,
  height: number,
  threshold = 0,
): Rect | null {
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++)
      if (mask[row + x]! > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Alpha channel of an RGBA buffer as a mask. */
export function alphaChannel(rgba: Pixels, width: number, height: number) {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3]!;
  return out;
}

/** Pixels inside the selection that touch its edge or the image edge. */
export function selectionBorder(selection: Pixels, width: number, height: number) {
  const out: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!selection[i]) continue;
      if (
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !selection[i - 1] ||
        !selection[i + 1] ||
        !selection[i - width] ||
        !selection[i + width]
      )
        out.push(i);
    }
  return out;
}

const distance2 = (a: RGB, r: number, g: number, b: number) =>
  (a[0] - r) ** 2 + (a[1] - g) ** 2 + (a[2] - b) ** 2;

/**
 * Estimate up to `k` background colors from the selection border using deterministic
 * farthest-point initialisation + k-means. Clusters below 15% of the border are dropped
 * (stray strokes crossing the selection edge must not become "background").
 */
export function estimateBackground(
  rgba: Pixels,
  width: number,
  height: number,
  selection: Pixels,
  k = 3,
): RGB[] {
  let border = selectionBorder(selection, width, height).filter((i) => rgba[i * 4 + 3]! > 0);
  if (!border.length) return [];
  if (border.length > 6000) {
    const step = border.length / 6000;
    border = Array.from({ length: 6000 }, (_, j) => border[Math.floor(j * step)]!);
  }
  const color = (i: number): RGB => [rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!];
  // Start from the median luminance sample so the result is order independent enough.
  const lum = (i: number) =>
    rgba[i * 4]! * 0.299 + rgba[i * 4 + 1]! * 0.587 + rgba[i * 4 + 2]! * 0.114;
  const sorted = [...border].sort((a, b) => lum(a) - lum(b));
  const centers: RGB[] = [color(sorted[Math.floor(sorted.length / 2)]!)];
  while (centers.length < Math.max(1, Math.min(3, k))) {
    let best = -1,
      far = 0;
    for (const i of border) {
      const d = Math.min(
        ...centers.map((c) => distance2(c, rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!)),
      );
      if (d > far) {
        far = d;
        best = i;
      }
    }
    if (best < 0 || far < 24 * 24) break;
    centers.push(color(best));
  }
  const counts = new Array(centers.length).fill(0);
  for (let iteration = 0; iteration < 8; iteration++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts.fill(0);
    for (const i of border) {
      const r = rgba[i * 4]!,
        g = rgba[i * 4 + 1]!,
        b = rgba[i * 4 + 2]!;
      let best = 0,
        bestD = Infinity;
      centers.forEach((c, j) => {
        const d = distance2(c, r, g, b);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      sums[best]![0] += r;
      sums[best]![1] += g;
      sums[best]![2] += b;
      counts[best]++;
    }
    centers.forEach((c, j) => {
      if (counts[j]) {
        c[0] = sums[j]![0]! / counts[j];
        c[1] = sums[j]![1]! / counts[j];
        c[2] = sums[j]![2]! / counts[j];
      }
    });
  }
  return centers
    .filter((_, j) => counts[j] / border.length >= 0.15)
    .map((c) => c.map((v) => Math.round(v)) as RGB);
}

/**
 * `tolerance`: color distance (0–441) still treated as background.
 * `softness`: 0–100 % of the ramp from the tolerance up to the selection's ink contrast.
 * 100 keeps coverage proportional to contrast, preserving antialiasing and gradients.
 */
export type MatteOptions = { tolerance: number; softness: number };
export const DEFAULT_MATTE: MatteOptions = { tolerance: 24, softness: 85 };
/** Resolved key: distance at which coverage starts (`tolerance`) and reaches 255 (`full`). */
export type Key = { tolerance: number; full: number };

/** Distance-to-nearest-background → coverage. Soft ramp keeps antialiased edges. */
export function keyAlpha(r: number, g: number, b: number, backgrounds: RGB[], key: Key) {
  if (!backgrounds.length) return 255;
  let d = Infinity;
  for (const c of backgrounds) d = Math.min(d, distance2(c, r, g, b));
  return clamp255(
    clamp01((Math.sqrt(d) - key.tolerance) / Math.max(1, key.full - key.tolerance)) * 255,
  );
}

/** Ink contrast reference: 95th percentile background distance inside the selection. */
export function resolveKey(
  rgba: Pixels,
  selection: Pixels,
  backgrounds: RGB[],
  options: MatteOptions = DEFAULT_MATTE,
): Key {
  const tolerance = Math.max(0, Math.min(441, options.tolerance));
  const histogram = new Uint32Array(443);
  let total = 0;
  const stride = Math.max(1, Math.floor(selection.length / 250000));
  for (let i = 0; i < selection.length; i += stride) {
    if (!selection[i] || !backgrounds.length) continue;
    let d = Infinity;
    for (const c of backgrounds)
      d = Math.min(d, distance2(c, rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!));
    const v = Math.round(Math.sqrt(d));
    if (v <= tolerance) continue;
    histogram[Math.min(442, v)]++;
    total++;
  }
  let reference = 441;
  if (total) {
    let seen = 0;
    for (let v = 0; v < histogram.length; v++) {
      seen += histogram[v]!;
      if (seen >= total * 0.95) {
        reference = v;
        break;
      }
    }
  }
  const softness = Math.max(0, Math.min(100, options.softness)) / 100;
  return {
    tolerance,
    full: Math.max(tolerance + 1, tolerance + (reference - tolerance) * softness),
  };
}

/** Preliminary foreground matte inside the selection; outside the selection is always 0. */
export function generateMatte(
  rgba: Pixels,
  width: number,
  height: number,
  selection: Pixels,
  options: MatteOptions = DEFAULT_MATTE,
  backgrounds = estimateBackground(rgba, width, height, selection),
) {
  const key = resolveKey(rgba, selection, backgrounds, options);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) {
    const s = selection[i]!;
    if (!s) continue;
    alpha[i] = Math.round(
      (keyAlpha(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!, backgrounds, key) * s) / 255,
    );
  }
  return { alpha, backgrounds, key };
}

function nearest(backgrounds: RGB[], r: number, g: number, b: number) {
  let best = backgrounds[0]!,
    d = Infinity;
  for (const c of backgrounds) {
    const v = distance2(c, r, g, b);
    if (v < d) {
      d = v;
      best = c;
    }
  }
  return best;
}

/**
 * Remove the background color mixed into semi-transparent edge pixels:
 * observed = a·fg + (1−a)·bg  ⇒  fg = (observed − (1−a)·bg) / a.
 * Returns a new RGBA buffer; fully opaque and fully transparent pixels are copied.
 */
export function decontaminate(
  rgba: Pixels,
  alpha: Pixels,
  backgrounds: RGB[],
  minAlpha = 16,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  if (!backgrounds.length) return out;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]!;
    if (a >= 255 || a < minAlpha) continue;
    const t = a / 255,
      o = i * 4,
      bg = nearest(backgrounds, rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
    for (let c = 0; c < 3; c++) out[o + c] = clamp255((rgba[o + c]! - (1 - t) * bg[c]!) / t);
  }
  return out;
}

export type BrushMode = "foreground" | "background" | "erase" | "restore";
export type BrushContext = {
  rgba: Pixels;
  /** Generated (or selection) mask that Restore returns to. */
  preliminary: Pixels;
  backgrounds: RGB[];
  key: Key;
};
/**
 * Stamp a round brush onto `alpha` in place (the caller's editable mask).
 * `hardness` 0..1 controls the soft falloff. Returns the dirty rectangle.
 */
export function stampBrush(
  alpha: Uint8Array,
  width: number,
  height: number,
  center: Point,
  radius: number,
  mode: BrushMode,
  context: BrushContext,
  hardness = 0.6,
): Rect | null {
  const r = Math.max(0.5, radius),
    left = Math.max(0, Math.floor(center.x - r)),
    right = Math.min(width - 1, Math.ceil(center.x + r)),
    top = Math.max(0, Math.floor(center.y - r)),
    bottom = Math.min(height - 1, Math.ceil(center.y + r));
  if (left > right || top > bottom) return null;
  const inner = r * clamp01(hardness);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const d = Math.hypot(x + 0.5 - center.x, y + 0.5 - center.y);
      if (d > r) continue;
      const weight = d <= inner ? 1 : 1 - (d - inner) / Math.max(1e-6, r - inner);
      const i = y * width + x,
        old = alpha[i]!;
      let target: number;
      if (mode === "foreground") target = 255;
      else if (mode === "erase") target = 0;
      else if (mode === "restore") target = context.preliminary[i]!;
      else {
        const o = i * 4;
        target = Math.min(
          old,
          keyAlpha(
            context.rgba[o]!,
            context.rgba[o + 1]!,
            context.rgba[o + 2]!,
            context.backgrounds,
            context.key,
          ),
        );
      }
      const next = old + (target - old) * weight;
      // Soft edges only ever move toward the target; never overshoot or reverse.
      alpha[i] = target >= old ? Math.max(old, Math.round(next)) : Math.min(old, Math.round(next));
    }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Stamp along a segment with spacing of a third of the radius. Returns the dirty rect. */
export function strokeBrush(
  alpha: Uint8Array,
  width: number,
  height: number,
  from: Point,
  to: Point,
  radius: number,
  mode: BrushMode,
  context: BrushContext,
  hardness = 0.6,
): Rect | null {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(0.5, radius / 3)),
  );
  let dirty: Rect | null = null;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    dirty = unionRect(
      dirty,
      stampBrush(
        alpha,
        width,
        height,
        { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        radius,
        mode,
        context,
        hardness,
      ),
    );
  }
  return dirty;
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Source RGBA with its alpha multiplied by the mask (new buffer). */
export function applyMatte(rgba: Pixels, alpha: Pixels) {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < alpha.length; i++)
    out[i * 4 + 3] = Math.round((rgba[i * 4 + 3]! * alpha[i]!) / 255);
  return out;
}

/** Copy a rectangle of an RGBA buffer; areas outside the source are transparent. */
export function cropRgba(rgba: Pixels, width: number, height: number, rect: Rect) {
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const sy = rect.y + y;
    if (sy < 0 || sy >= height) continue;
    const x0 = Math.max(0, rect.x),
      x1 = Math.min(width, rect.x + rect.width);
    if (x1 <= x0) continue;
    out.set(
      rgba.subarray((sy * width + x0) * 4, (sy * width + x1) * 4),
      (y * rect.width + (x0 - rect.x)) * 4,
    );
  }
  return out;
}

const hex = (color: string): RGB => {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) throw Error("Use a #rrggbb color.");
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as RGB;
};

/**
 * Recolor lettering while keeping alpha. `shading` 0..1 keeps the source's light/dark
 * variation around the new color (0 = flat fill).
 */
export function recolor(rgba: Pixels, color: string, strength = 1, shading = 0) {
  const c = hex(color),
    s = clamp01(strength),
    out = new Uint8ClampedArray(rgba);
  for (let o = 0; o < out.length; o += 4) {
    if (!rgba[o + 3]) continue;
    const lum = rgba[o]! * 0.299 + rgba[o + 1]! * 0.587 + rgba[o + 2]! * 0.114,
      shift = (lum - 128) * shading;
    for (let k = 0; k < 3; k++)
      out[o + k] = clamp255(rgba[o + k]! + (c[k]! + shift - rgba[o + k]!) * s);
  }
  return out;
}

/** 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
  }
}
/** Euclidean distance (pixels) from every pixel to the nearest pixel with alpha ≥ threshold. */
export function distanceField(alpha: Pixels, width: number, height: number, threshold = 128) {
  const INF = 1e20,
    grid = new Float64Array(width * height),
    n = Math.max(width, height),
    f = new Float64Array(n),
    d = new Float64Array(n),
    v = new Int32Array(n),
    z = new Float64Array(n + 1);
  for (let i = 0; i < grid.length; i++) grid[i] = alpha[i]! >= threshold ? 0 : INF;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]!;
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]!;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x]!;
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = Math.sqrt(d[x]!);
  }
  return grid;
}

/** Antialiased dilation of the silhouette by `radius` pixels (outline coverage). */
export function dilateAlpha(alpha: Pixels, width: number, height: number, radius: number) {
  const out = new Uint8Array(width * height);
  if (radius <= 0) {
    out.set(alpha);
    return out;
  }
  const dist = distanceField(alpha, width, height);
  for (let i = 0; i < out.length; i++)
    out[i] = Math.max(alpha[i]!, clamp255(clamp01(radius + 0.5 - dist[i]!) * 255));
  return out;
}

/** Three-pass box blur of a mask, approximating a Gaussian of the given radius. */
export function blurMask(mask: Pixels, width: number, height: number, radius: number) {
  let src = Float32Array.from(mask);
  const r = Math.max(0, Math.round(radius / 1.7));
  if (!r) return Uint8Array.from(src, clamp255);
  let dst = new Float32Array(src.length);
  const pass = (horizontal: boolean) => {
    const len = horizontal ? width : height,
      lines = horizontal ? height : width;
    for (let line = 0; line < lines; line++) {
      const at = (i: number) => (horizontal ? line * width + i : i * width + line);
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[at(Math.min(len - 1, Math.max(0, i)))]!;
      for (let i = 0; i < len; i++) {
        dst[at(i)] = sum / (2 * r + 1);
        sum += src[at(Math.min(len - 1, i + r + 1))]! - src[at(Math.max(0, i - r))]!;
      }
    }
    [src, dst] = [dst, src];
  };
  for (let k = 0; k < 3; k++) {
    pass(true);
    pass(false);
  }
  return Uint8Array.from(src, clamp255);
}

/** Straight-alpha "source over" of a solid-color coverage layer underneath `top`. */
function overColor(top: Uint8ClampedArray, under: Pixels, color: RGB, opacity = 1) {
  for (let i = 0; i < under.length; i++) {
    const o = i * 4,
      ta = top[o + 3]! / 255,
      ua = (under[i]! / 255) * opacity;
    const outA = ta + ua * (1 - ta);
    if (outA <= 0) continue;
    for (let c = 0; c < 3; c++)
      top[o + c] = clamp255((top[o + c]! * ta + color[c]! * ua * (1 - ta)) / outA);
    top[o + 3] = clamp255(outA * 255);
  }
}

export type AssetOptions = {
  decontaminate: boolean;
  recolor?: { color: string; strength: number; shading: number };
  outline?: { color: string; width: number };
  shadow?: { color: string; x: number; y: number; blur: number; opacity: number };
  opacity: number;
  /** Extra transparent margin around the artwork. */
  padding: number;
};
export const DEFAULT_ASSET: AssetOptions = { decontaminate: true, opacity: 1, padding: 2 };

/**
 * Build the final transparent asset from source pixels and the edited mask.
 * Crops to the artwork (plus outline/shadow room). Returns null if the mask is empty.
 */
export function buildAsset(
  rgba: Pixels,
  width: number,
  height: number,
  alpha: Pixels,
  backgrounds: RGB[],
  options: AssetOptions = DEFAULT_ASSET,
): {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  x: number;
  y: number;
} | null {
  const bounds = maskBounds(alpha, width, height, 0);
  if (!bounds) return null;
  const outline = Math.max(0, options.outline?.width ?? 0),
    shadow = options.shadow,
    reach =
      outline +
      (shadow ? Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) + shadow.blur * 2 : 0) +
      Math.max(0, Math.round(options.padding));
  const rect = {
    x: bounds.x - Math.ceil(reach),
    y: bounds.y - Math.ceil(reach),
    width: bounds.width + Math.ceil(reach) * 2,
    height: bounds.height + Math.ceil(reach) * 2,
  };
  const source = options.decontaminate ? decontaminate(rgba, alpha, backgrounds) : rgba;
  let art = applyMatte(cropRgba(source, width, height, rect), cropMask(alpha, width, height, rect));
  const w = rect.width,
    h = rect.height;
  if (options.recolor && options.recolor.strength > 0)
    art = recolor(art, options.recolor.color, options.recolor.strength, options.recolor.shading);
  if (outline > 0 && options.outline)
    overColor(art, dilateAlpha(alphaChannel(art, w, h), w, h, outline), hex(options.outline.color));
  if (shadow && shadow.opacity > 0) {
    const silhouette = alphaChannel(art, w, h),
      shifted = new Uint8Array(w * h),
      dx = Math.round(shadow.x),
      dy = Math.round(shadow.y);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = x - dx,
          sy = y - dy;
        if (sx >= 0 && sy >= 0 && sx < w && sy < h) shifted[y * w + x] = silhouette[sy * w + sx]!;
      }
    overColor(
      art,
      blurMask(shifted, w, h, shadow.blur),
      hex(shadow.color),
      clamp01(shadow.opacity),
    );
  }
  if (options.opacity < 1)
    for (let o = 3; o < art.length; o += 4) art[o] = clamp255(art[o]! * clamp01(options.opacity));
  return { data: art, width: w, height: h, x: rect.x, y: rect.y };
}

export function cropMask(mask: Pixels, width: number, height: number, rect: Rect) {
  const out = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const sy = rect.y + y;
    if (sy < 0 || sy >= height) continue;
    const x0 = Math.max(0, rect.x),
      x1 = Math.min(width, rect.x + rect.width);
    if (x1 > x0)
      out.set(mask.subarray(sy * width + x0, sy * width + x1), y * rect.width + (x0 - rect.x));
  }
  return out;
}

/** Work-surface size that respects a pixel-area budget while keeping aspect ratio. */
export function fitArea(width: number, height: number, maxArea: number, maxSide = 16384) {
  const scale = Math.min(
    1,
    Math.sqrt(maxArea / Math.max(1, width * height)),
    maxSide / Math.max(width, height),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}

/**
 * Display pixels for one rectangle of the editor preview: source RGBA (optionally
 * decontaminated per pixel) with the mask applied. `rect` must lie inside the surface.
 */
export function previewRegion(
  rgba: Pixels,
  alpha: Pixels,
  width: number,
  rect: Rect,
  backgrounds: RGB[],
  clean: boolean,
) {
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++)
    for (let x = 0; x < rect.width; x++) {
      const i = (rect.y + y) * width + rect.x + x,
        o = i * 4,
        p = (y * rect.width + x) * 4,
        a = alpha[i]!;
      out[p + 3] = Math.round((rgba[o + 3]! * a) / 255);
      if (clean && backgrounds.length && a < 255 && a >= 16) {
        const t = a / 255,
          bg = nearest(backgrounds, rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
        for (let c = 0; c < 3; c++) out[p + c] = clamp255((rgba[o + c]! - (1 - t) * bg[c]!) / t);
      } else {
        out[p] = rgba[o]!;
        out[p + 1] = rgba[o + 1]!;
        out[p + 2] = rgba[o + 2]!;
      }
    }
  return out;
}
