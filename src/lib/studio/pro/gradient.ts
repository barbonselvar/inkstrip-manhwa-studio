import { oklab } from "./color-distance.ts";
import { gradientSampler, GRADIENT_PRESETS, validateStops, type GradientStop } from "./color.ts";
export type Gradient = {
  version?: 2;
  kind: "linear" | "radial" | "angular" | "reflected" | "diamond";
  interpolation?: "rgb" | "oklab";
  reverse?: boolean;
  smoothness?: number;
  angle: number;
  scale: number;
  center: { x: number; y: number };
  stops: (GradientStop & { midpoint?: number })[];
};
export const defaultGradient = (): Gradient => ({
  kind: "linear",
  angle: 0,
  scale: 1,
  center: { x: 0.5, y: 0.5 },
  stops: structuredClone(GRADIENT_PRESETS.Grayscale!),
});
export function validateGradient(g: Gradient) {
  const n = (v: unknown, a: number, b: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;
  if (
    !g ||
    !(
      g.version === 2
        ? ["linear", "radial", "angular", "reflected", "diamond"]
        : ["linear", "radial"]
    ).includes(g.kind) ||
    !n(g.angle, -360, 360) ||
    !n(g.scale, 0.01, 10) ||
    !g.center ||
    !n(g.center.x, -2, 3) ||
    !n(g.center.y, -2, 3)
  )
    throw new Error("Invalid gradient geometry.");
  if (g.version === undefined) {
    if (
      g.interpolation !== undefined ||
      g.reverse !== undefined ||
      g.smoothness !== undefined ||
      g.stops?.some((s) => s.midpoint !== undefined)
    )
      throw Error("Advanced gradient settings need version 2.");
    validateStops(g.stops);
  } else {
    if (
      g.version !== 2 ||
      Object.keys(g).some(
        (k) =>
          ![
            "version",
            "kind",
            "angle",
            "scale",
            "center",
            "stops",
            "interpolation",
            "reverse",
            "smoothness",
          ].includes(k),
      ) ||
      Object.keys(g.center).some((k) => !["x", "y"].includes(k)) ||
      !["rgb", "oklab"].includes(g.interpolation!) ||
      typeof g.reverse !== "boolean" ||
      !n(g.smoothness, 0, 1)
    )
      throw Error("Invalid advanced gradient options.");
    if (
      !Array.isArray(g.stops) ||
      g.stops.length < 2 ||
      g.stops.length > 128 ||
      g.stops[0]?.position !== 0 ||
      g.stops.at(-1)?.position !== 1
    )
      throw Error("Use 2–128 gradient stops including 0% and 100%.");
    for (const [i, s] of g.stops.entries())
      if (
        !s ||
        Object.keys(s).some((k) => !["position", "color", "opacity", "midpoint"].includes(k)) ||
        !n(s.position, 0, 1) ||
        typeof s.color !== "string" ||
        !/^#[\da-f]{6}$/i.test(s.color) ||
        !n(s.opacity, 0, 1) ||
        (s.midpoint !== undefined && !n(s.midpoint, 0.01, 0.99)) ||
        (i > 0 && s.position <= g.stops[i - 1]!.position)
      )
        throw Error("Invalid advanced gradient stop.");
  }
}
export function gradientField(g: Gradient, width: number, height: number) {
  const rad = (g.angle * Math.PI) / 180,
    c = Math.cos(rad),
    s = Math.sin(rad),
    span = Math.abs(width * c) + Math.abs(height * s),
    sample = g.version === 2 ? advancedGradientSampler(g) : gradientSampler(g.stops);
  return (x: number, y: number) => {
    const dx = x - g.center.x * width,
      dy = y - g.center.y * height,
      u = dx * c + dy * s,
      v = -dx * s + dy * c;
    return sample(
      g.kind === "linear"
        ? 0.5 + u / (span * g.scale)
        : g.kind === "angular"
          ? ((Math.atan2(v, u) / (2 * Math.PI) + 1) % 1) / g.scale
          : g.kind === "reflected"
            ? Math.abs((2 * u) / (span * g.scale))
            : g.kind === "diamond"
              ? (Math.abs(u / (width / 2)) + Math.abs(v / (height / 2))) / g.scale
              : Math.hypot(u / (width / 2), v / (height / 2)) / g.scale,
    );
  };
}
export function gradientPixels(width: number, height: number, g: Gradient) {
  const out = new Uint8ClampedArray(width * height * 4),
    sample = gradientField(g, width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const rgba = sample(x + 0.5, y + 0.5),
        i = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[i + c] = rgba[c]! * 255;
    }
  return out;
}

export function advancedGradient(): Gradient {
  return { ...defaultGradient(), version: 2, interpolation: "rgb", smoothness: 0, reverse: false };
}
const limit = (x: number) => Math.max(0, Math.min(1, x));
/** Ottosson inverse OKLab -> linear RGB -> encoded sRGB; gamut is explicitly clipped. */
function fromLab([L, a, b]: number[]): number[] {
  const l = (L! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3,
    m = (L! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3,
    s = (L! - 0.0894841775 * a! - 1.291485548 * b!) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => limit(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055));
}
/** Compile once, binary-search stops per sample. RGB and OKLab are alpha-premultiplied. */
export function advancedGradientSampler(g: Gradient) {
  const colors = g.stops.map((s) => {
    const rgb = [1, 3, 5].map((i) => parseInt(s.color.slice(i, i + 2), 16));
    return g.interpolation === "oklab" ? oklab(rgb[0]!, rgb[1]!, rgb[2]!) : rgb.map((v) => v / 255);
  });
  const powers = g.stops.map((s) => Math.log(0.5) / Math.log(s.midpoint ?? 0.5));
  return (value: number): [number, number, number, number] => {
    const v = limit(g.reverse ? 1 - value : value);
    let lo = 0,
      hi = g.stops.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (g.stops[m]!.position < v) lo = m;
      else hi = m;
    }
    const a = g.stops[lo]!,
      b = g.stops[hi]!;
    let t = (v - a.position) / (b.position - a.position);
    t = t ** powers[lo]!;
    t = t * (1 - (g.smoothness ?? 0)) + t * t * (3 - 2 * t) * (g.smoothness ?? 0);
    const alpha = a.opacity * (1 - t) + b.opacity * t;
    let rgb = colors[lo]!.map((c, i) =>
      alpha ? (c * a.opacity * (1 - t) + colors[hi]![i]! * b.opacity * t) / alpha : 0,
    );
    if (g.interpolation === "oklab" && alpha) rgb = fromLab(rgb);
    return [rgb[0]!, rgb[1]!, rgb[2]!, alpha];
  };
}
