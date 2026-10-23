import type { Layer, ProDocument } from "./model.ts";
import { defaultGradient, gradientField, validateGradient, type Gradient } from "./gradient.ts";
import { blendClippedPixels } from "./clipping.ts";
import { blendPixel, isBlendMode } from "./blend.ts";
export const EFFECT_NAMES = {
  dropShadow: "Drop Shadow",
  innerShadow: "Inner Shadow",
  outerGlow: "Outer Glow",
  innerGlow: "Inner Glow",
  stroke: "Stroke",
  colorOverlay: "Color Overlay",
  gradientOverlay: "Gradient Overlay",
} as const;
export type Effect = {
  kind: keyof typeof EFFECT_NAMES;
  enabled: boolean;
  opacity: number;
  blend: Layer["blend"];
  color: string;
  radius: number;
  distance: number;
  angle: number;
  size: number;
  position: "inside" | "outside" | "center";
  gradient: Gradient;
};
export function defaultEffect(kind: Effect["kind"]): Effect {
  return {
    kind,
    enabled: true,
    opacity: 1,
    blend: "source-over",
    color: kind.includes("Glow") ? "#ffffff" : "#000000",
    radius: 8,
    distance: 12,
    angle: 135,
    size: 3,
    position: "outside",
    gradient: defaultGradient(),
  };
}
export function validateEffects(effects: Effect[]) {
  const n = (v: unknown, a: number, b: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;
  if (
    !Array.isArray(effects) ||
    effects.length > 7 ||
    new Set(effects.map((e) => e?.kind)).size !== effects.length
  )
    throw new Error("Use at most one of each of the seven layer effects.");
  for (const e of effects) {
    if (
      !e ||
      !Object.hasOwn(EFFECT_NAMES, e.kind) ||
      typeof e.enabled !== "boolean" ||
      !n(e.opacity, 0, 1) ||
      !isBlendMode(e.blend) ||
      typeof e.color !== "string" ||
      !/^#[\da-f]{6}$/i.test(e.color) ||
      !n(e.radius, 0, 64) ||
      !n(e.distance, 0, 256) ||
      !n(e.angle, -360, 360) ||
      !n(e.size, 0, 64) ||
      !["inside", "outside", "center"].includes(e.position)
    )
      throw new Error("Invalid layer effect.");
    validateGradient(e.gradient);
  }
}
export function effectExtent(effects: Effect[] = [], scale = 1) {
  return Math.ceil(
    Math.max(
      0,
      ...effects
        .filter((e) => e.enabled)
        .map((e) =>
          e.kind === "dropShadow"
            ? e.distance * scale + 3 * Math.ceil((e.radius * scale) / 2)
            : e.kind === "outerGlow"
              ? 3 * Math.ceil((e.radius * scale) / 2)
              : e.kind === "stroke" && e.position !== "inside"
                ? e.size * scale
                : 0,
        ),
    ),
  );
}
/** Isolated nested groups can expand their children's effects again. */
export function effectPadding(d: ProDocument, scale = 1) {
  return Math.max(
    0,
    ...d.layers.map((l) => {
      if (!l.visible) return 0;
      const visited = new Set([l.id]);
      let extent = effectExtent(l.effects, scale),
        p = l.parentId;
      while (p) {
        if (visited.has(p)) throw new Error("Invalid group hierarchy.");
        visited.add(p);
        const parent = d.layers.find((n) => n.id === p);
        if (!parent) break;
        if (!parent.visible) return 0;
        extent += effectExtent(parent.effects, scale);
        p = parent.parentId;
      }
      return extent;
    }),
  );
}
/** Separable running-sum box filter, zero outside the image. Three passes approximate a Gaussian. */
export function blurAlpha(input: Float32Array, w: number, h: number, radius: number) {
  const r = Math.ceil(radius / 2);
  if (!r) return new Float32Array(input);
  let src = new Float32Array(input),
    dst = new Float32Array(input.length);
  const divisor = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++)
    for (const vertical of [false, true]) {
      const lines = vertical ? w : h,
        length = vertical ? h : w,
        stride = vertical ? w : 1;
      for (let line = 0; line < lines; line++) {
        const start = vertical ? line : line * w;
        let sum = 0;
        for (let p = 0; p <= r && p < length; p++) sum += src[start + p * stride]!;
        for (let p = 0; p < length; p++) {
          dst[start + p * stride] = sum / divisor;
          const entering = p + r + 1,
            leaving = p - r;
          if (entering < length) sum += src[start + entering * stride]!;
          if (leaving >= 0) sum -= src[start + leaving * stride]!;
        }
      }
      [src, dst] = [dst, src];
    }
  return src;
}
/** Sliding deque morphology has O(width*height) work independent of stroke radius. */
export function morphology(input: Float32Array, w: number, h: number, r: number, dilate: boolean) {
  r = Math.ceil(r);
  if (!r) return new Float32Array(input);
  let src = new Float32Array(input),
    dst = new Float32Array(input.length);
  const deque = new Int32Array(Math.max(w, h) + 2 * r),
    values = new Float32Array(deque.length);
  for (const vertical of [false, true]) {
    const lines = vertical ? w : h,
      length = vertical ? h : w,
      stride = vertical ? w : 1;
    for (let line = 0; line < lines; line++) {
      const start = vertical ? line : line * w;
      let head = 0,
        tail = 0;
      for (let p = -r; p < length + r; p++) {
        const value = p < 0 || p >= length ? 0 : src[start + p * stride]!;
        while (tail > head && (dilate ? values[tail - 1]! <= value : values[tail - 1]! >= value))
          tail--;
        deque[tail] = p;
        values[tail++] = value;
        while (tail > head && deque[head]! < p - 2 * r) head++;
        const center = p - r;
        if (center >= 0 && center < length) dst[start + center * stride] = values[head]!;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
function at(a: Float32Array, w: number, h: number, x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  let out = 0;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const px = ix + i,
        py = iy + j;
      if (px >= 0 && py >= 0 && px < w && py < h)
        out += a[py * w + px]! * (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
    }
  return out;
}
/** W3C source-over blend, including alpha; used for exterior styles. */
export function overPixels(
  back: Uint8ClampedArray,
  front: Uint8ClampedArray,
  opacity = 1,
  blend: Layer["blend"] = "source-over",
) {
  const mixed = new Float64Array(3);
  for (let i = 0; i < back.length; i += 4) {
    const ab = back[i + 3]! / 255,
      as = (front[i + 3]! / 255) * opacity,
      a = as + ab * (1 - as);
    if (!as) continue;
    blendPixel(blend, back, front, i, mixed);
    for (let c = 0; c < 3; c++) {
      const b = back[i + c]! / 255,
        s = front[i + c]! / 255,
        m = mixed[c]!;
      back[i + c] = a ? ((as * ((1 - ab) * s + ab * m) + ab * (1 - as) * b) / a) * 255 : 0;
    }
    back[i + 3] = a * 255;
  }
  return back;
}
/** Exterior styles composite behind fill; interior styles keep the original fill alpha. */
export function effectPixels(
  source: Uint8ClampedArray,
  w: number,
  h: number,
  effects: Effect[],
  scale = 1,
) {
  if (!effects.some((e) => e.enabled)) return new Uint8ClampedArray(source);
  const alpha = new Float32Array(w * h),
    fill = new Uint8ClampedArray(source),
    behind = new Uint8ClampedArray(source.length);
  let left = w,
    top = h,
    right = 0,
    bottom = 0;
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = source[i * 4 + 3]! / 255;
    if (alpha[i]) {
      left = Math.min(left, i % w);
      right = Math.max(right, (i % w) + 1);
      top = Math.min(top, Math.floor(i / w));
      bottom = Math.max(bottom, Math.floor(i / w) + 1);
    }
  }
  if (right <= left) return fill;
  for (const e of effects) {
    if (
      !e.enabled ||
      !e.opacity ||
      (e.kind === "stroke" && !e.size) ||
      (["innerGlow", "outerGlow"].includes(e.kind) && !e.radius) ||
      (e.kind === "innerShadow" && !e.radius && !e.distance)
    )
      continue;
    const overlay = new Uint8ClampedArray(source.length),
      rgb = [
        parseInt(e.color.slice(1, 3), 16),
        parseInt(e.color.slice(3, 5), 16),
        parseInt(e.color.slice(5, 7), 16),
      ],
      blur = ["dropShadow", "innerShadow", "outerGlow", "innerGlow"].includes(e.kind)
        ? blurAlpha(alpha, w, h, e.radius * scale)
        : undefined,
      radius = e.size * scale * (e.position === "center" ? 0.5 : 1),
      dilated =
        e.kind === "stroke" && e.position !== "inside"
          ? morphology(alpha, w, h, radius, true)
          : undefined,
      eroded =
        e.kind === "stroke" && e.position !== "outside"
          ? morphology(alpha, w, h, radius, false)
          : undefined,
      angle = (e.angle * Math.PI) / 180,
      dx = Math.cos(angle) * e.distance * scale,
      dy = Math.sin(angle) * e.distance * scale,
      gradient =
        e.kind === "gradientOverlay"
          ? gradientField(e.gradient, right - left, bottom - top)
          : undefined;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x,
          i = p * 4,
          a = alpha[p]!;
        let coverage = 1,
          color = rgb,
          opacity = 1;
        if (e.kind === "dropShadow") coverage = at(blur!, w, h, x - dx, y - dy);
        if (e.kind === "innerShadow") coverage = 1 - at(blur!, w, h, x - dx, y - dy);
        if (e.kind === "outerGlow") coverage = blur![p]! * (1 - a);
        if (e.kind === "innerGlow") coverage = 1 - blur![p]!;
        if (e.kind === "stroke")
          coverage =
            e.position === "inside"
              ? 1 - eroded![p]!
              : e.position === "outside"
                ? dilated![p]! * (1 - a)
                : 1 - eroded![p]!;
        if (gradient) {
          const v = gradient(x + 0.5 - left, y + 0.5 - top);
          color = v.slice(0, 3).map((n) => n * 255);
          opacity = v[3];
        }
        for (let c = 0; c < 3; c++) overlay[i + c] = color[c]!;
        overlay[i + 3] = clamp(coverage) * opacity * 255;
      }
    if (
      ["dropShadow", "outerGlow"].includes(e.kind) ||
      (e.kind === "stroke" && e.position === "outside")
    )
      overPixels(behind, overlay, e.opacity, e.blend);
    else {
      blendClippedPixels(fill, overlay, e.opacity, e.blend);
      if (e.kind === "stroke" && e.position === "center") {
        for (let i = 0; i < alpha.length; i++)
          overlay[i * 4 + 3] = dilated![i]! * (1 - alpha[i]!) * 255;
        overPixels(behind, overlay, e.opacity, e.blend);
      }
    }
  }
  return overPixels(behind, fill);
}
