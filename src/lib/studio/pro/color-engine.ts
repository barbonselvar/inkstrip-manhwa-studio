import { applyAdjustments, blurPixels, NEUTRAL } from "../editor/adjustments.ts";
import { colorPixels, type RGB } from "./color.ts";

export type Channel = "rgb" | "red" | "green" | "blue";
export const CHANNELS: Channel[] = ["rgb", "red", "green", "blue"];
export type CurvePoint = { x: number; y: number };
export type Level = {
  black: number;
  white: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
};
export type ColorOperation =
  | { kind: "brightnessContrast"; brightness: number; contrast: number }
  | { kind: "levels"; channels: Record<Channel, Level> }
  | { kind: "curves"; channels: Record<Channel, CurvePoint[]> }
  | { kind: "hsl"; hue: number; saturation: number; lightness: number; range: string }
  | { kind: "balance"; shadows: RGB; midtones: RGB; highlights: RGB; preserveLuminance: boolean }
  | { kind: "exposure"; stops: number; gamma: number }
  | { kind: "vibrance"; vibrance: number; saturation: number }
  | { kind: "blackWhite"; red: number; green: number; blue: number }
  | { kind: "invert" }
  | { kind: "threshold"; level: number }
  | { kind: "posterize"; levels: number }
  | { kind: "gaussian"; radius: number }
  | { kind: "box"; radius: number }
  | { kind: "highPass"; radius: number }
  | { kind: "motion"; length: number; angle: number }
  | { kind: "sharpen"; amount: number }
  | { kind: "unsharp"; radius: number; amount: number; threshold: number }
  | { kind: "noise"; amount: number; monochrome: boolean; seed: number }
  | { kind: "denoise"; amount: number }
  | { kind: "median"; radius: number }
  | { kind: "edges" };
export const COLOR_OPERATIONS = {
  brightnessContrast: "Brightness / Contrast",
  levels: "Levels",
  curves: "Curves",
  hsl: "Hue / Saturation / Lightness",
  balance: "Color Balance",
  exposure: "Exposure / Gamma",
  vibrance: "Vibrance / Saturation",
  blackWhite: "Black and White",
  invert: "Invert",
  threshold: "Threshold",
  posterize: "Posterize",
  gaussian: "Gaussian Blur",
  box: "Box Blur",
  motion: "Motion Blur",
  sharpen: "Sharpen",
  unsharp: "Unsharp Mask",
  noise: "Add Noise",
  denoise: "Noise Reduction",
  median: "Median",
  highPass: "High Pass",
  edges: "Edge Detection",
} as const;
export const HUE_RANGES = ["all", "reds", "yellows", "greens", "cyans", "blues", "magentas"];
export const COLOR_MAX_AREA = 4_000_000;
export const COLOR_MAX_TAPS = 128_000_000;
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export function defaultOperation(kind: ColorOperation["kind"]): ColorOperation {
  switch (kind) {
    case "brightnessContrast":
      return { kind, brightness: 0, contrast: 0 };
    case "levels":
      return {
        kind,
        channels: Object.fromEntries(
          CHANNELS.map((c) => [c, { black: 0, white: 255, gamma: 1, outBlack: 0, outWhite: 255 }]),
        ) as Record<Channel, Level>,
      };
    case "curves":
      return {
        kind,
        channels: Object.fromEntries(
          CHANNELS.map((c) => [
            c,
            [
              { x: 0, y: 0 },
              { x: 255, y: 255 },
            ],
          ]),
        ) as Record<Channel, CurvePoint[]>,
      };
    case "hsl":
      return { kind, hue: 0, saturation: 0, lightness: 0, range: "all" };
    case "balance":
      return {
        kind,
        shadows: [0, 0, 0],
        midtones: [0, 0, 0],
        highlights: [0, 0, 0],
        preserveLuminance: true,
      };
    case "exposure":
      return { kind, stops: 0, gamma: 1 };
    case "vibrance":
      return { kind, vibrance: 0, saturation: 0 };
    case "blackWhite":
      return { kind, red: 21.26, green: 71.52, blue: 7.22 };
    case "invert":
    case "edges":
      return { kind };
    case "threshold":
      return { kind, level: 128 };
    case "posterize":
      return { kind, levels: 8 };
    case "gaussian":
    case "box":
    case "highPass":
      return { kind, radius: 2 };
    case "motion":
      return { kind, length: 9, angle: 0 };
    case "sharpen":
      return { kind, amount: 100 };
    case "unsharp":
      return { kind, radius: 2, amount: 100, threshold: 2 };
    case "noise":
      return { kind, amount: 10, monochrome: true, seed: 12345 };
    case "denoise":
      return { kind, amount: 30 };
    case "median":
      return { kind, radius: 1 };
  }
}
const finite = (n: unknown, lo: number, hi: number, integer = false) =>
  typeof n === "number" &&
  Number.isFinite(n) &&
  n >= lo &&
  n <= hi &&
  (!integer || Number.isInteger(n));
/** Strict runtime boundary for worker requests and untrusted local presets. */
export function validateOperation(value: unknown): asserts value is ColorOperation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid color operation.");
  const a = value as ColorOperation;
  if (!Object.hasOwn(COLOR_OPERATIONS, a.kind)) throw Error("Unknown color operation.");
  const keys = Object.keys(defaultOperation(a.kind));
  if (Object.keys(a).length !== keys.length || Object.keys(a).some((k) => !keys.includes(k)))
    throw Error("Unexpected color settings.");
  const check = (n: unknown, lo: number, hi: number, integer = false) => {
    if (!finite(n, lo, hi, integer)) throw Error("Color settings are outside supported limits.");
  };
  switch (a.kind) {
    case "brightnessContrast":
      check(a.brightness, -100, 100);
      check(a.contrast, -100, 100);
      break;
    case "levels":
    case "curves":
      if (
        !a.channels ||
        Object.keys(a.channels).length !== 4 ||
        CHANNELS.some((c) => !Object.hasOwn(a.channels, c))
      )
        throw Error("Invalid color channels.");
      for (const c of CHANNELS) {
        if (a.kind === "levels") {
          const v = a.channels[c];
          if (!v || Object.keys(v).sort().join() !== "black,gamma,outBlack,outWhite,white")
            throw Error("Invalid level points.");
          check(v.black, 0, 254);
          check(v.white, 1, 255);
          check(v.gamma, 0.1, 5);
          check(v.outBlack, 0, 254);
          check(v.outWhite, 1, 255);
          if (v.black >= v.white || v.outBlack >= v.outWhite)
            throw Error("Black points must precede white points.");
        } else {
          const p = a.channels[c];
          if (
            !Array.isArray(p) ||
            p.length < 2 ||
            p.length > 16 ||
            p[0]?.x !== 0 ||
            p.at(-1)?.x !== 255
          )
            throw Error("Curves need 2–16 points with anchored input endpoints.");
          p.forEach((v, i) => {
            if (!v || Object.keys(v).sort().join() !== "x,y") throw Error("Invalid curve point.");
            check(v.x, 0, 255, true);
            check(v.y, 0, 255);
            if (i && v.x <= p[i - 1]!.x) throw Error("Curve inputs must be strictly ordered.");
          });
        }
      }
      break;
    case "hsl":
      check(a.hue, -180, 180);
      check(a.saturation, -100, 100);
      check(a.lightness, -100, 100);
      if (!HUE_RANGES.includes(a.range)) throw Error("Invalid hue range.");
      break;
    case "balance":
      for (const r of [a.shadows, a.midtones, a.highlights]) {
        if (!Array.isArray(r) || r.length !== 3) throw Error("Invalid balance range.");
        r.forEach((n) => check(n, -100, 100));
      }
      if (typeof a.preserveLuminance !== "boolean") throw Error("Invalid luma option.");
      break;
    case "exposure":
      check(a.stops, -5, 5);
      check(a.gamma, 0.1, 5);
      break;
    case "vibrance":
      check(a.vibrance, -100, 100);
      check(a.saturation, -100, 100);
      break;
    case "blackWhite":
      [a.red, a.green, a.blue].forEach((n) => check(n, -200, 200));
      break;
    case "threshold":
      check(a.level, 0, 255);
      break;
    case "posterize":
      check(a.levels, 2, 256, true);
      break;
    case "gaussian":
    case "highPass":
      check(a.radius, 0.1, 32);
      break;
    case "box":
      check(a.radius, 1, 32, true);
      break;
    case "motion":
      check(a.length, 1, 63, true);
      check(a.angle, -180, 180);
      break;
    case "sharpen":
    case "denoise":
      check(a.amount, 0, a.kind === "denoise" ? 100 : 300);
      break;
    case "unsharp":
      check(a.radius, 0.1, 32);
      check(a.amount, 0, 300);
      check(a.threshold, 0, 255);
      break;
    case "noise":
      check(a.amount, 0, 100);
      check(a.seed, 0, 0xffffffff, true);
      if (typeof a.monochrome !== "boolean") throw Error("Invalid noise option.");
      break;
    case "median":
      check(a.radius, 1, 3, true);
      break;
  }
}
export function validateColorWork(width: number, height: number, a: ColorOperation) {
  validateOperation(a);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > COLOR_MAX_AREA
  )
    throw Error("Color processing supports native layers up to 4MP. No pixels were changed.");
  const taps =
    a.kind === "gaussian" || a.kind === "unsharp" || a.kind === "highPass"
      ? 2 * (2 * Math.ceil(3 * a.radius) + 1)
      : a.kind === "median"
        ? (2 * a.radius + 1) ** 2 * 3
        : a.kind === "motion"
          ? a.length
          : a.kind === "edges"
            ? 9
            : 1;
  if (taps * width * height > COLOR_MAX_TAPS)
    throw Error(
      "This filter exceeds the kernel-work budget. Reduce its radius or use a smaller layer. No resolution was reduced.",
    );
}
/** Shape-preserving cubic Hermite (Fritsch–Carlson tangent limiting), no segment overshoot. */
export function curveLut(points: CurvePoint[]) {
  const n = points.length,
    slopes = points.slice(1).map((p, i) => (p.y - points[i]!.y) / (p.x - points[i]!.x));
  const m = points.map((_, i) =>
    i === 0
      ? slopes[0]!
      : i === n - 1
        ? slopes[n - 2]!
        : slopes[i - 1]! * slopes[i]! <= 0
          ? 0
          : 2 / (1 / slopes[i - 1]! + 1 / slopes[i]!),
  );
  slopes.forEach((s, i) => {
    if (s === 0) {
      m[i] = m[i + 1] = 0;
      return;
    }
    const a = m[i]! / s,
      b = m[i + 1]! / s,
      norm = Math.hypot(a, b);
    if (norm > 3) {
      m[i] = (3 * a * s) / norm;
      m[i + 1] = (3 * b * s) / norm;
    }
  });
  const lut = new Float64Array(256);
  let j = 0;
  for (let x = 0; x < 256; x++) {
    while (j < n - 2 && x > points[j + 1]!.x) j++;
    const a = points[j]!,
      b = points[j + 1]!,
      h = b.x - a.x,
      t = (x - a.x) / h;
    lut[x] = clamp(
      (2 * t ** 3 - 3 * t ** 2 + 1) * a.y +
        (t ** 3 - 2 * t ** 2 + t) * h * m[j]! +
        (-2 * t ** 3 + 3 * t ** 2) * b.y +
        (t ** 3 - t ** 2) * h * m[j + 1]!,
      0,
      255,
    );
  }
  return lut;
}
export function levelValue(n: number, v: Level) {
  return (
    v.outBlack +
    (v.outWhite - v.outBlack) * clamp((n - v.black) / (v.white - v.black)) ** (1 / v.gamma)
  );
}
export function rgbToHsl(r: number, g: number, b: number): RGB {
  const hi = Math.max(r, g, b),
    lo = Math.min(r, g, b),
    d = hi - lo,
    l = (hi + lo) / 2;
  if (!d) return [0, 0, l];
  const h = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, d / (1 - Math.abs(2 * l - 1)), l];
}
export function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h * 6) % 2) - 1)),
    m = l - c / 2;
  const rgb =
    h < 1 / 6
      ? [c, x, 0]
      : h < 2 / 6
        ? [x, c, 0]
        : h < 3 / 6
          ? [0, c, x]
          : h < 4 / 6
            ? [0, x, c]
            : h < 5 / 6
              ? [x, 0, c]
              : [c, 0, x];
  return rgb.map((v) => v + m) as RGB;
}
export const decodeSrgb = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
export const encodeSrgb = (x: number) =>
  x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
export function histogram(data: Uint8ClampedArray) {
  const result = Object.fromEntries(CHANNELS.map((c) => [c, Array<number>(256).fill(0)])) as Record<
    Channel,
    number[]
  >;
  for (let p = 0; p < data.length; p += 4) {
    const a = data[p + 3]! / 255;
    if (!a) continue;
    result.rgb[Math.round(luma(data[p]!, data[p + 1]!, data[p + 2]!))]! += a;
    for (let c = 0; c < 3; c++) result[CHANNELS[c + 1]!]![data[p + c]!]! += a;
  }
  return result;
}
/** Clamp borders; convolve premultiplied color and coverage, then normalize. Keep source alpha. */
function gaussian(input: Uint8ClampedArray, w: number, h: number, sigma: number) {
  const radius = Math.ceil(3 * sigma),
    kernel = Array.from({ length: radius * 2 + 1 }, (_, i) =>
      Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)),
    ),
    total = kernel.reduce((a, b) => a + b, 0);
  for (let k = 0; k < kernel.length; k++) kernel[k]! /= total;
  const temp = new Float32Array(input.length),
    out = input.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      for (let k = -radius; k <= radius; k++) {
        const q = (y * w + clamp(x + k, 0, w - 1)) * 4,
          a = input[q + 3]! / 255,
          weight = kernel[k + radius]!;
        for (let c = 0; c < 3; c++) temp[p + c]! += input[q + c]! * a * weight;
        temp[p + 3]! += a * weight;
      }
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (!input[p + 3]) continue;
      let a = 0;
      const sum = [0, 0, 0];
      for (let k = -radius; k <= radius; k++) {
        const q = (clamp(y + k, 0, h - 1) * w + x) * 4,
          weight = kernel[k + radius]!;
        for (let c = 0; c < 3; c++) sum[c]! += temp[q + c]! * weight;
        a += temp[q + 3]! * weight;
      }
      if (a) for (let c = 0; c < 3; c++) out[p + c] = sum[c]! / a;
    }
  return out;
}
function neighborhood(
  input: Uint8ClampedArray,
  w: number,
  h: number,
  a: Extract<ColorOperation, { kind: "motion" | "median" }>,
) {
  const out = input.slice(),
    r = a.kind === "median" ? a.radius : Math.floor(a.length / 2),
    theta = a.kind === "motion" ? (a.angle * Math.PI) / 180 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (!input[p + 3]) continue;
      const rows: { rgb: RGB; alpha: number }[] = [];
      const add = (dx: number, dy: number) => {
        const q = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4,
          alpha = input[q + 3]! / 255;
        if (alpha) rows.push({ rgb: [input[q]!, input[q + 1]!, input[q + 2]!], alpha });
      };
      if (a.kind === "median")
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) add(dx, dy);
      else
        for (let k = 0; k < a.length; k++) {
          const t = k - (a.length - 1) / 2;
          add(Math.round(Math.cos(theta) * t), Math.round(Math.sin(theta) * t));
        }
      const total = rows.reduce((n, v) => n + v.alpha, 0);
      for (let c = 0; c < 3; c++)
        if (a.kind === "motion")
          out[p + c] = rows.reduce((n, v) => n + v.rgb[c]! * v.alpha, 0) / total;
        else {
          rows.sort((v, b) => v.rgb[c]! - b.rgb[c]!);
          let count = 0;
          for (const v of rows) {
            count += v.alpha;
            if (count >= total / 2) {
              out[p + c] = v.rgb[c]!;
              break;
            }
          }
        }
    }
  return out;
}
/** Immutable source in, independent result out. All spatial work stays at source resolution. */
export function processColor(
  input: Uint8ClampedArray,
  w: number,
  h: number,
  a: ColorOperation,
  coverage?: Uint8ClampedArray,
) {
  validateColorWork(w, h, a);
  if (input.length !== w * h * 4 || (coverage && coverage.length !== w * h))
    throw Error("Invalid color pixel buffer.");
  let out = input.slice();
  if (a.kind === "gaussian" || a.kind === "unsharp" || a.kind === "highPass") {
    const low = gaussian(input, w, h, a.radius);
    if (a.kind === "gaussian") out = low;
    else
      for (let p = 0; p < out.length; p += 4)
        if (input[p + 3])
          for (let c = 0; c < 3; c++) {
            const d = input[p + c]! - low[p + c]!;
            out[p + c] =
              a.kind === "highPass"
                ? 128 + d
                : input[p + c]! + (Math.abs(d) >= a.threshold ? (d * a.amount) / 100 : 0);
          }
  } else if (a.kind === "box") out = blurPixels(input, w, h, a.radius);
  else if (a.kind === "denoise")
    out = applyAdjustments(input, w, h, { ...NEUTRAL, noise: a.amount });
  else if (a.kind === "motion" || a.kind === "median") out = neighborhood(input, w, h, a);
  else if (a.kind === "sharpen" || a.kind === "edges") {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        if (!input[p + 3]) continue;
        const at = (dx: number, dy: number, c: number) => {
          const q = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4,
            alpha = input[q + 3]! / 255;
          return input[q + c]! * alpha + input[p + c]! * (1 - alpha);
        };
        if (a.kind === "sharpen")
          for (let c = 0; c < 3; c++)
            out[p + c] =
              input[p + c]! +
              (a.amount / 100) *
                (4 * input[p + c]! - at(-1, 0, c) - at(1, 0, c) - at(0, -1, c) - at(0, 1, c));
        else {
          let gx = 0,
            gy = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const v = luma(at(dx, dy, 0), at(dx, dy, 1), at(dx, dy, 2));
              gx += v * dx * (dy === 0 ? 2 : 1);
              gy += v * dy * (dx === 0 ? 2 : 1);
            }
          out[p] = out[p + 1] = out[p + 2] = Math.hypot(gx, gy) / 4;
        }
      }
  } else if (a.kind === "balance") colorPixels(out, { balance: a });
  else if (a.kind === "threshold") colorPixels(out, { threshold: a.level });
  else if (a.kind === "posterize") colorPixels(out, { posterize: a.levels });
  else if (a.kind === "brightnessContrast")
    out = applyAdjustments(input, w, h, {
      ...NEUTRAL,
      brightness: a.brightness,
      contrast: a.contrast,
    });
  else if (a.kind === "vibrance") {
    colorPixels(out, { vibrance: a.vibrance });
    if (a.saturation) out = applyAdjustments(out, w, h, { ...NEUTRAL, saturation: a.saturation });
  } else if (a.kind === "levels" || a.kind === "curves" || a.kind === "exposure") {
    // Compile point operations once. A source byte indexes the complete composite/channel mapping.
    const curves = a.kind === "curves" ? CHANNELS.map((c) => curveLut(a.channels[c])) : undefined;
    const sample = (lut: Float64Array, n: number) => {
      const i = Math.floor(n),
        f = n - i;
      return lut[i]! * (1 - f) + lut[Math.min(255, i + 1)]! * f;
    };
    const luts = [0, 1, 2].map((c) =>
      Float64Array.from({ length: 256 }, (_, n) => {
        if (a.kind === "levels")
          return levelValue(levelValue(n, a.channels.rgb), a.channels[CHANNELS[c + 1]!]!);
        if (a.kind === "curves") return sample(curves![c + 1]!, sample(curves![0]!, n));
        return clamp(encodeSrgb(clamp(decodeSrgb(n / 255) * 2 ** a.stops))) ** (1 / a.gamma) * 255;
      }),
    );
    for (let p = 0; p < out.length; p += 4)
      if (input[p + 3]) for (let c = 0; c < 3; c++) out[p + c] = luts[c]![input[p + c]!]!;
  } else {
    let seed = a.kind === "noise" ? a.seed : 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let p = 0; p < out.length; p += 4) {
      if (!input[p + 3]) continue;
      let rgb: RGB = [input[p]! / 255, input[p + 1]! / 255, input[p + 2]! / 255];
      switch (a.kind) {
        case "hsl": {
          const [h, s, l] = rgbToHsl(...rgb),
            index = HUE_RANGES.indexOf(a.range) - 1,
            distance = Math.abs(((h * 360 - index * 60 + 540) % 360) - 180),
            t = clamp((60 - distance) / 30),
            weight = a.range === "all" ? 1 : t * t * (3 - 2 * t) * Math.min(1, s / 0.1),
            sat = (a.saturation / 100) * weight,
            light = (a.lightness / 100) * weight;
          rgb = hslToRgb(
            h + (a.hue / 360) * weight,
            clamp(s * (1 + sat)),
            clamp(l + (light >= 0 ? (1 - l) * light : l * light)),
          );
          break;
        }
        case "blackWhite": {
          const v = clamp((rgb[0] * a.red + rgb[1] * a.green + rgb[2] * a.blue) / 100);
          rgb = [v, v, v];
          break;
        }
        case "invert":
          rgb = rgb.map((v) => 1 - v) as RGB;
          break;
        case "noise": {
          const mono = ((random() * 2 - 1) * a.amount) / 100;
          rgb = rgb.map((v) =>
            clamp(v + (a.monochrome ? mono : ((random() * 2 - 1) * a.amount) / 100)),
          ) as RGB;
          break;
        }
      }
      for (let c = 0; c < 3; c++) out[p + c] = rgb[c]! * 255;
    }
  }
  if (coverage)
    for (let p = 0; p < out.length; p += 4) {
      const f = coverage[p / 4]! / 255;
      for (let c = 0; c < 3; c++) out[p + c] = input[p + c]! * (1 - f) + out[p + c]! * f;
    }
  return out;
}
