/** Traditional encoded-sRGB color operations; source artwork is never changed. */
export type RGB = [number, number, number];
export type GradientStop = { position: number; color: string; opacity: number };
export type ColorAdjustments = {
  balance?: { shadows: RGB; midtones: RGB; highlights: RGB; preserveLuminance: boolean };
  vibrance?: number;
  mixer?: {
    red: [number, number, number, number];
    green: [number, number, number, number];
    blue: [number, number, number, number];
  };
  shadowsHighlights?: { shadows: number; highlights: number; width: number };
  gradientMap?: { stops: GradientStop[]; amount: number };
  threshold?: number;
  posterize?: number;
};
export const GRADIENT_PRESETS: Record<string, GradientStop[]> = {
  Grayscale: [
    { position: 0, color: "#000000", opacity: 1 },
    { position: 1, color: "#ffffff", opacity: 1 },
  ],
  Sepia: [
    { position: 0, color: "#24130b", opacity: 1 },
    { position: 0.5, color: "#a87949", opacity: 1 },
    { position: 1, color: "#fff4da", opacity: 1 },
  ],
  Cyanotype: [
    { position: 0, color: "#031d4c", opacity: 1 },
    { position: 1, color: "#e1f7ff", opacity: 1 },
  ],
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const finite = (n: unknown, lo: number, hi: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
export function validateStops(stops: GradientStop[]) {
  if (
    !Array.isArray(stops) ||
    stops.length < 2 ||
    stops.length > 16 ||
    stops[0]?.position !== 0 ||
    stops.at(-1)?.position !== 1 ||
    !stops.every(
      (s, i) =>
        s &&
        finite(s.position, 0, 1) &&
        /^#[\da-f]{6}$/i.test(s.color) &&
        finite(s.opacity, 0, 1) &&
        (!i || s.position > stops[i - 1]!.position),
    )
  )
    throw new Error("A gradient needs 2–16 ordered color/opacity stops, including 0% and 100%.");
}
export function validateColor(a: ColorAdjustments) {
  if (
    !a ||
    typeof a !== "object" ||
    Array.isArray(a) ||
    Object.keys(a).some(
      (k) =>
        ![
          "balance",
          "vibrance",
          "mixer",
          "shadowsHighlights",
          "gradientMap",
          "threshold",
          "posterize",
        ].includes(k),
    )
  )
    throw new Error("Invalid color adjustments.");
  const vector = (v: unknown, length: number, min: number, max: number) =>
    Array.isArray(v) && v.length === length && v.every((n) => finite(n, min, max));
  if (
    (a.balance !== undefined &&
      (!a.balance ||
        !vector(a.balance.shadows, 3, -100, 100) ||
        !vector(a.balance.midtones, 3, -100, 100) ||
        !vector(a.balance.highlights, 3, -100, 100) ||
        typeof a.balance.preserveLuminance !== "boolean")) ||
    (a.vibrance !== undefined && !finite(a.vibrance, -100, 100)) ||
    (a.threshold !== undefined && !finite(a.threshold, 0, 255)) ||
    (a.posterize !== undefined &&
      (!Number.isInteger(a.posterize) || !finite(a.posterize, 2, 256))) ||
    (a.mixer !== undefined &&
      (!a.mixer ||
        ![a.mixer.red, a.mixer.green, a.mixer.blue].every((v) => vector(v, 4, -200, 200)))) ||
    (a.shadowsHighlights !== undefined &&
      (!a.shadowsHighlights ||
        !finite(a.shadowsHighlights.shadows, -100, 100) ||
        !finite(a.shadowsHighlights.highlights, -100, 100) ||
        !finite(a.shadowsHighlights.width, 0.01, 1)))
  )
    throw new Error("Invalid color adjustment values.");
  if (a.gradientMap !== undefined) {
    if (!a.gradientMap || !finite(a.gradientMap.amount, 0, 1))
      throw new Error("Invalid gradient map.");
    validateStops(a.gradientMap.stops);
  }
}
/** Compile once per render. Stops interpolate in premultiplied sRGB, including opacity. */
export function gradientSampler(stops: GradientStop[]) {
  const colors = stops.map((s) => [
    parseInt(s.color.slice(1, 3), 16) / 255,
    parseInt(s.color.slice(3, 5), 16) / 255,
    parseInt(s.color.slice(5, 7), 16) / 255,
  ]);
  return (value: number): [number, number, number, number] => {
    const v = clamp(value);
    let i = 0;
    while (i < stops.length - 2 && stops[i + 1]!.position < v) i++;
    const a = stops[i]!,
      b = stops[i + 1]!,
      f = (v - a.position) / (b.position - a.position),
      alpha = a.opacity * (1 - f) + b.opacity * f;
    return [
      ...colors[i]!.map((n, c) =>
        alpha ? (n * a.opacity * (1 - f) + colors[i + 1]![c]! * b.opacity * f) / alpha : 0,
      ),
      alpha,
    ] as [number, number, number, number];
  };
}
/** Retarget luminance while shrinking chroma into gamut, retaining hue without hard channel clipping. */
function relight(rgb: RGB, target: number): RGB {
  const l = luminance(...rgb),
    d = rgb.map((v) => v - l);
  let scale = 1;
  for (const v of d)
    if (v > 0) scale = Math.min(scale, (1 - target) / v);
    else if (v < 0) scale = Math.min(scale, -target / v);
  return d.map((v) => clamp(target + v * Math.max(0, scale))) as RGB;
}
/** Fixed, persisted order: Balance → Vibrance → Mixer → Shadows/Highlights → Map → Threshold → Posterize. */
export function colorPixels(data: Uint8ClampedArray, a: ColorAdjustments) {
  const map = a.gradientMap ? gradientSampler(a.gradientMap.stops) : undefined;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    let rgb: RGB = [data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255];
    if (a.balance) {
      const l = luminance(...rgb),
        weights = [(1 - l) ** 2, 2 * l * (1 - l), l * l],
        ranges = [a.balance.shadows, a.balance.midtones, a.balance.highlights];
      rgb = rgb.map((v, c) =>
        clamp(v + ranges.reduce((n, range, j) => n + range[c]! * weights[j]!, 0) / 100),
      ) as RGB;
      if (a.balance.preserveLuminance) rgb = relight(rgb, l);
    }
    if (a.vibrance) {
      const l = luminance(...rgb),
        saturation = Math.max(...rgb) - Math.min(...rgb),
        strength = (a.vibrance / 100) * (a.vibrance > 0 ? 1 - saturation : 1);
      rgb = rgb.map((v) => clamp(l + (v - l) * (1 + strength))) as RGB;
    }
    if (a.mixer)
      rgb = [a.mixer.red, a.mixer.green, a.mixer.blue].map((row) =>
        clamp((row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2] + row[3]) / 100),
      ) as RGB;
    if (a.shadowsHighlights) {
      const l = luminance(...rgb),
        sh = a.shadowsHighlights,
        shadow = clamp(1 - l / sh.width) ** 2,
        highlight = clamp(1 - (1 - l) / sh.width) ** 2,
        target = clamp(
          l + (sh.shadows / 100) * shadow * (1 - l) - (sh.highlights / 100) * highlight * l,
        );
      rgb = relight(rgb, target);
    }
    if (map && a.gradientMap) {
      const mapped = map(luminance(...rgb)),
        amount = a.gradientMap.amount;
      // Crossfade premultiplied colors; opacity stops intentionally modulate source alpha.
      const alpha = 1 - amount + mapped[3] * amount;
      rgb = rgb.map((v, c) =>
        alpha ? (v * (1 - amount) + mapped[c]! * mapped[3] * amount) / alpha : 0,
      ) as RGB;
      data[i + 3] = data[i + 3]! * alpha;
    }
    if (a.threshold !== undefined) {
      const n = luminance(...rgb) * 255 >= a.threshold ? 1 : 0;
      rgb = [n, n, n];
    }
    if (a.posterize !== undefined) {
      const steps = a.posterize - 1;
      rgb = rgb.map((v) => Math.round(v * steps) / steps) as RGB;
    }
    for (let c = 0; c < 3; c++) data[i + c] = rgb[c]! * 255;
  }
  return data;
}
