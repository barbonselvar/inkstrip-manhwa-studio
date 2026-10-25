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
  patternOverlay: "Pattern Overlay",
  bevel: "Bevel and Emboss",
} as const;
export type Effect = {
  version?: 2;
  spread?: number;
  choke?: number;
  globalLight?: boolean;
  fillKind?: "solid" | "gradient";
  glowSource?: "edge" | "center";
  pattern?: {
    kind: "checker" | "stripes" | "dots";
    scale: number;
    offsetX: number;
    offsetY: number;
    color2: string;
  };
  bevel?: {
    depth: number;
    direction: "up" | "down";
    soften: number;
    elevation: number;
    highlight: string;
    shadow: string;
    highlightOpacity: number;
    shadowOpacity: number;
  };
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
    ...(kind === "patternOverlay"
      ? {
          version: 2 as const,
          pattern: {
            kind: "checker" as const,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            color2: "#ffffff",
          },
        }
      : {}),
    ...(kind === "bevel"
      ? {
          version: 2 as const,
          bevel: {
            depth: 1,
            direction: "up" as const,
            soften: 0,
            elevation: 45,
            highlight: "#ffffff",
            shadow: "#000000",
            highlightOpacity: 0.75,
            shadowOpacity: 0.75,
          },
        }
      : {}),
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
    effects.length > 9 ||
    new Set(effects.map((e) => e?.kind)).size !== effects.length
  )
    throw new Error("Use at most one of each of the nine layer effects.");
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
    const advanced = [
      "spread",
      "choke",
      "globalLight",
      "fillKind",
      "glowSource",
      "pattern",
      "bevel",
    ];
    if (
      e.version === undefined &&
      (advanced.some((k) => Object.hasOwn(e, k)) || ["patternOverlay", "bevel"].includes(e.kind))
    )
      throw Error("Advanced layer styles need version2.");
    if (e.version !== undefined) {
      if (
        e.version !== 2 ||
        Object.keys(e).some(
          (k) =>
            ![
              "kind",
              "enabled",
              "opacity",
              "blend",
              "color",
              "radius",
              "distance",
              "angle",
              "size",
              "position",
              "gradient",
              "version",
              ...advanced,
            ].includes(k),
        ) ||
        (e.spread !== undefined && !n(e.spread, 0, 64)) ||
        (e.choke !== undefined && !n(e.choke, 0, 64)) ||
        (e.globalLight !== undefined && typeof e.globalLight !== "boolean") ||
        (e.fillKind !== undefined && !["solid", "gradient"].includes(e.fillKind)) ||
        (e.glowSource !== undefined && !["edge", "center"].includes(e.glowSource))
      )
        throw Error("Invalid advanced layer style.");
      const color = (c: unknown) => typeof c === "string" && /^#[\da-f]{6}$/i.test(c);
      if (e.kind === "patternOverlay") {
        const p = e.pattern;
        if (
          !p ||
          Object.keys(p).some(
            (k) => !["kind", "scale", "offsetX", "offsetY", "color2"].includes(k),
          ) ||
          !["checker", "stripes", "dots"].includes(p.kind) ||
          !n(p.scale, 0.1, 32) ||
          !n(p.offsetX, -4096, 4096) ||
          !n(p.offsetY, -4096, 4096) ||
          !color(p.color2)
        )
          throw Error("Invalid pattern texture.");
      } else if (e.pattern !== undefined) throw Error("Pattern settings need a Pattern Overlay.");
      if (e.kind === "bevel") {
        const b = e.bevel;
        if (
          !b ||
          Object.keys(b).some(
            (k) =>
              ![
                "depth",
                "direction",
                "soften",
                "elevation",
                "highlight",
                "shadow",
                "highlightOpacity",
                "shadowOpacity",
              ].includes(k),
          ) ||
          !n(b.depth, 0, 10) ||
          !["up", "down"].includes(b.direction) ||
          !n(b.soften, 0, 32) ||
          !n(b.elevation, 1, 89) ||
          !color(b.highlight) ||
          !color(b.shadow) ||
          !n(b.highlightOpacity, 0, 1) ||
          !n(b.shadowOpacity, 0, 1)
        )
          throw Error("Invalid bevel lighting.");
      } else if (e.bevel !== undefined) throw Error("Relief settings need Bevel and Emboss.");
    }
    if (e.gradient?.version === 2 && e.version !== 2)
      throw Error("Advanced gradient effects need style version2.");
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
            ? (e.distance + (e.spread ?? 0)) * scale + 3 * Math.ceil((e.radius * scale) / 2)
            : e.kind === "outerGlow"
              ? (e.spread ?? 0) * scale + 3 * Math.ceil((e.radius * scale) / 2)
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
  globalLight = 135,
) {
  if (source.length !== w * h * 4 || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1)
    throw Error("Invalid style pixel buffer.");
  if (effects.some((e) => e.enabled && e.version === 2) && w * h > 4_000_000)
    throw Error(
      "Advanced layer styles support rendered planes up to4MP. Source resolution was not reduced.",
    );
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
      expanded =
        e.spread && ["dropShadow", "outerGlow"].includes(e.kind)
          ? morphology(alpha, w, h, e.spread * scale, true)
          : e.choke && ["innerShadow", "innerGlow"].includes(e.kind)
            ? morphology(alpha, w, h, e.choke * scale, false)
            : alpha,
      blur = ["dropShadow", "innerShadow", "outerGlow", "innerGlow"].includes(e.kind)
        ? blurAlpha(expanded, w, h, e.radius * scale)
        : undefined,
      relief =
        e.kind === "bevel"
          ? blurAlpha(alpha, w, h, (e.size + (e.bevel?.soften ?? 0)) * scale)
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
      angle = ((e.globalLight ? globalLight : e.angle) * Math.PI) / 180,
      dx = Math.cos(angle) * e.distance * scale,
      dy = Math.sin(angle) * e.distance * scale,
      gradient =
        e.kind === "gradientOverlay" ||
        (e.fillKind === "gradient" && ["stroke", "outerGlow", "innerGlow"].includes(e.kind))
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
        if (e.kind === "innerGlow")
          coverage = e.glowSource === "center" ? blur![p]! : 1 - blur![p]!;
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
        if (e.kind === "patternOverlay" && e.pattern) {
          const pat = e.pattern,
            tile = 16 * pat.scale * scale,
            px = ((((x - left - pat.offsetX * scale) % tile) + tile) % tile) / tile,
            py = ((((y - top - pat.offsetY * scale) % tile) + tile) % tile) / tile,
            foreground =
              pat.kind === "checker"
                ? px < 0.5 === py < 0.5
                : pat.kind === "stripes"
                  ? (px + py) % 1 < 0.5
                  : Math.hypot(px - 0.5, py - 0.5) < 0.3;
          if (!foreground) color = [1, 3, 5].map((j) => parseInt(pat.color2.slice(j, j + 2), 16));
        }
        if (e.kind === "bevel" && e.bevel && relief) {
          const b = e.bevel,
            elevation = (b.elevation * Math.PI) / 180,
            sign = b.direction === "up" ? 1 : -1,
            nx = -(at(relief, w, h, x + 1, y) - at(relief, w, h, x - 1, y)) * b.depth * 8 * sign,
            ny = -(at(relief, w, h, x, y + 1) - at(relief, w, h, x, y - 1)) * b.depth * 8 * sign,
            norm = Math.hypot(nx, ny, 1),
            light =
              (nx * Math.cos(angle) * Math.cos(elevation) +
                ny * Math.sin(angle) * Math.cos(elevation) +
                Math.sin(elevation)) /
                norm -
              Math.sin(elevation),
            hex = light >= 0 ? b.highlight : b.shadow;
          color = [1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16));
          coverage =
            Math.min(1, Math.abs(light) * 2) * (light >= 0 ? b.highlightOpacity : b.shadowOpacity);
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

/** Opt-in style record, retaining legacy algorithms unless new options are enabled. */
export function advancedEffect(kind: Effect["kind"]): Effect {
  return {
    ...defaultEffect(kind),
    version: 2,
    spread: 0,
    choke: 0,
    globalLight: false,
    fillKind: "solid",
    glowSource: "edge",
  };
}

/** Bound native style work before preview/commit, so a small preview cannot create an unexportable native document. */
export function validateAdvancedStyleWork(d: ProDocument) {
  const visible = (l: Layer) => {
    if (!l.visible) return false;
    let parent = l.parentId;
    const seen = new Set<string>();
    while (parent) {
      if (seen.has(parent)) throw Error("Invalid group hierarchy.");
      seen.add(parent);
      const p = d.layers.find((n) => n.id === parent);
      if (!p || !p.visible) return false;
      parent = p.parentId;
    }
    return true;
  };
  if (!d.layers.some((l) => visible(l) && l.effects?.some((e) => e.enabled && e.version === 2)))
    return;
  const padding = effectPadding(d);
  if ((d.width + 2 * padding) * (d.height + 2 * padding) > 4_000_000)
    throw Error(
      "Advanced styles support native document planes up to4MP including effect padding. Remove the style or use a smaller canvas; original resolution was not changed.",
    );
}
