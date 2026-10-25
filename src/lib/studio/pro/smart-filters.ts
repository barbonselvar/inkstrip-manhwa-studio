import {
  defaultOperation,
  processColor,
  validateOperation,
  validateColorWork,
  type ColorOperation,
} from "./color-engine.ts";
import { validateSelection, type Selection } from "./model.ts";
import { validateNativeTree } from "./adjustment-schema.ts";

type Reused = Extract<
  ColorOperation,
  { kind: "gaussian" | "motion" | "unsharp" | "highPass" | "median" }
>;
export type SmartOperation =
  | Reused
  | { kind: "radial"; mode: "spin" | "zoom"; strength: number; center: { x: number; y: number } }
  | { kind: "surface"; radius: number; threshold: number }
  | { kind: "emboss"; angle: number; height: number; strength: number }
  | { kind: "edgeDetect"; method: "sobel" | "laplacian"; strength: number }
  | {
      kind: "grain";
      distribution: "uniform" | "gaussian";
      monochrome: boolean;
      amount: number;
      seed: number;
    };
export type FilterMask = {
  selection: Selection;
  enabled: boolean;
  density: number;
  inverted: boolean;
};
export type SmartFilter = {
  id: string;
  enabled: boolean;
  operation: SmartOperation;
  mask?: FilterMask;
};
export const SMART_FILTER_NAMES = {
  gaussian: "Gaussian Blur",
  motion: "Motion Blur",
  radial: "Radial Blur",
  unsharp: "Unsharp Mask",
  highPass: "High Pass",
  grain: "Noise",
  median: "Median",
  surface: "Surface Blur",
  emboss: "Emboss",
  edgeDetect: "Edge Detection",
} as const;
export const SMART_MAX_AREA = 4_000_000,
  SMART_MAX_TAPS = 128_000_000,
  SMART_MAX_FILTERS = 12;
const n = (v: unknown, a: number, b: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;
function keys(v: object, allowed: string[]) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !allowed.includes(k))
  )
    throw Error("Invalid Smart Filter record.");
}
export function defaultSmartOperation(kind: SmartOperation["kind"]): SmartOperation {
  switch (kind) {
    case "radial":
      return { kind, mode: "spin", strength: 0.15, center: { x: 0.5, y: 0.5 } };
    case "surface":
      return { kind, radius: 2, threshold: 24 };
    case "emboss":
      return { kind, angle: 135, height: 1, strength: 1 };
    case "edgeDetect":
      return { kind, method: "sobel", strength: 1 };
    case "grain":
      return { kind, distribution: "uniform", amount: 10, monochrome: true, seed: 1 };
    default:
      return defaultOperation(kind) as Reused;
  }
}
export function validateSmartOperation(a: SmartOperation) {
  validateNativeTree(a);
  if (!a || !Object.hasOwn(SMART_FILTER_NAMES, a.kind)) throw Error("Unknown Smart Filter type.");
  switch (a.kind) {
    case "radial":
      keys(a, ["kind", "mode", "strength", "center"]);
      keys(a.center, ["x", "y"]);
      if (
        !["spin", "zoom"].includes(a.mode) ||
        !n(a.strength, 0, 1) ||
        !n(a.center.x, 0, 1) ||
        !n(a.center.y, 0, 1)
      )
        throw Error("Invalid radial blur.");
      break;
    case "surface":
      keys(a, ["kind", "radius", "threshold"]);
      if (!Number.isInteger(a.radius) || !n(a.radius, 1, 16) || !n(a.threshold, 1, 255))
        throw Error("Invalid Surface Blur.");
      break;
    case "emboss":
      keys(a, ["kind", "angle", "height", "strength"]);
      if (!n(a.angle, -360, 360) || !n(a.height, 1, 32) || !n(a.strength, 0, 10))
        throw Error("Invalid Emboss.");
      break;
    case "edgeDetect":
      keys(a, ["kind", "method", "strength"]);
      if (!["sobel", "laplacian"].includes(a.method) || !n(a.strength, 0, 10))
        throw Error("Invalid edge detector.");
      break;
    case "grain":
      keys(a, ["kind", "distribution", "amount", "monochrome", "seed"]);
      if (
        !["uniform", "gaussian"].includes(a.distribution) ||
        !n(a.amount, 0, 100) ||
        typeof a.monochrome !== "boolean" ||
        !Number.isInteger(a.seed) ||
        !n(a.seed, 0, 0xffffffff)
      )
        throw Error("Invalid seeded noise.");
      break;
    default:
      validateOperation(a);
  }
}
export function validateSmartFilters(stack: SmartFilter[]) {
  if (!Array.isArray(stack) || stack.length > SMART_MAX_FILTERS)
    throw Error("Use at most12 Smart Filters per layer.");
  const ids = new Set<string>();
  for (const f of stack) {
    keys(f, ["id", "enabled", "operation", "mask"]);
    if (
      typeof f.id !== "string" ||
      !f.id ||
      f.id.length > 128 ||
      ids.has(f.id) ||
      typeof f.enabled !== "boolean"
    )
      throw Error("Invalid Smart Filter identity.");
    ids.add(f.id);
    validateSmartOperation(f.operation);
    if (f.mask !== undefined) {
      keys(f.mask, ["selection", "enabled", "density", "inverted"]);
      if (
        typeof f.mask.enabled !== "boolean" ||
        typeof f.mask.inverted !== "boolean" ||
        !n(f.mask.density, 0, 1)
      )
        throw Error("Invalid Smart Filter mask.");
      validateSelection(f.mask.selection);
    }
  }
}
function taps(a: SmartOperation) {
  switch (a.kind) {
    case "gaussian":
    case "unsharp":
    case "highPass":
      return 2 * (2 * Math.ceil(3 * a.radius) + 1);
    case "median":
      return (2 * a.radius + 1) ** 2 * 3;
    case "motion":
      return a.length;
    case "radial":
      return Math.max(1, Math.ceil(a.strength * 64)) * 4;
    case "surface":
      return (2 * a.radius + 1) ** 2;
    case "emboss":
      return 2;
    case "edgeDetect":
      return 9;
    default:
      return 1;
  }
}
/** Native kernel samples across this ordered stack; used for per-layer and document budgets. */
export function smartFilterWork(w: number, h: number, stack: SmartFilter[] = []) {
  return stack.reduce((sum, f) => sum + (f.enabled ? taps(f.operation) : 0), 0) * w * h;
}
/** Validate native dimensions even for reduced previews. No silent downscaling/budget bypass. */
export function validateSmartWork(w: number, h: number, stack: SmartFilter[]) {
  validateSmartFilters(stack);
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    w > 16384 ||
    h > 16384 ||
    w * h > SMART_MAX_AREA
  )
    throw Error(
      "Smart Filters support source layers up to4MP. Original resolution was not changed.",
    );
  if (smartFilterWork(w, h, stack) > SMART_MAX_TAPS)
    throw Error(
      "Smart Filter stack exceeds128M kernel taps. Reduce radius, strength or active filter count.",
    );
}
/** Premultiplied crossfade, not source-over: zero mask restores exact original bytes. */
export function mixFilterMask(
  original: Uint8ClampedArray,
  filtered: Uint8ClampedArray,
  coverage: Uint8ClampedArray,
  mask: FilterMask,
) {
  for (let i = 0; i < original.length; i += 4) {
    const amount =
      mask.density * (mask.inverted ? 1 - coverage[i + 3]! / 255 : coverage[i + 3]! / 255);
    if (!amount) {
      filtered.set(original.subarray(i, i + 4), i);
      continue;
    }
    const a = original[i + 3]! * (1 - amount) + filtered[i + 3]! * amount;
    for (let c = 0; c < 3; c++)
      filtered[i + c] = a
        ? (original[i + c]! * original[i + 3]! * (1 - amount) +
            filtered[i + c]! * filtered[i + 3]! * amount) /
          a
        : 0;
    filtered[i + 3] = a;
  }
  return filtered;
}
const clamp = (v: number, max = 1) => Math.max(0, Math.min(max, v));
/** Clamp border, bilinear premultiplied sample. Transparent hidden RGB cannot make halos. */
function sample(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  out: Float64Array,
) {
  x = clamp(x, w - 1);
  y = clamp(y, h - 1);
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  out.fill(0);
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const i = (Math.min(h - 1, iy + dy) * w + Math.min(w - 1, ix + dx)) * 4,
        weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy),
        a = src[i + 3]! / 255;
      for (let c = 0; c < 3; c++) out[c] += src[i + c]! * a * weight;
      out[3] += src[i + 3]! * weight;
    }
}
export function processSmart(
  input: Uint8ClampedArray,
  w: number,
  h: number,
  a: SmartOperation,
): Uint8ClampedArray {
  validateSmartWork(w, h, [{ id: "process", enabled: true, operation: a }]);
  if (input.length !== w * h * 4) throw Error("Invalid Smart Filter pixel buffer.");
  if (["gaussian", "motion", "unsharp", "highPass", "median"].includes(a.kind)) {
    validateColorWork(w, h, a as Reused);
    return processColor(
      input,
      w,
      h,
      a as Reused,
      undefined,
      a.kind === "gaussian" || a.kind === "motion" ? "blur" : "preserve",
    );
  }
  if (a.kind === "grain" && a.distribution === "uniform")
    return processColor(input, w, h, {
      kind: "noise",
      amount: a.amount,
      monochrome: a.monochrome,
      seed: a.seed,
    });
  if (a.kind === "edgeDetect" && a.method === "sobel") {
    const edges = processColor(input, w, h, { kind: "edges" });
    if (a.strength !== 1)
      for (let i = 0; i < edges.length; i += 4)
        for (let c = 0; c < 3; c++) edges[i + c] = edges[i + c]! * a.strength;
    return edges;
  }
  const out = new Uint8ClampedArray(input),
    tmp = new Float64Array(4),
    sum = new Float64Array(4);
  const index = (x: number, y: number) =>
    (clamp(Math.round(y), h - 1) * w + clamp(Math.round(x), w - 1)) * 4;
  const lum = (i: number) =>
    ((0.2126 * input[i]! + 0.7152 * input[i + 1]! + 0.0722 * input[i + 2]!) * input[i + 3]!) / 255;
  let seed = a.kind === "grain" ? a.seed : 1;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (a.kind === "radial") {
        if (!a.strength) continue;
        sum.fill(0);
        const steps = Math.max(1, Math.ceil(a.strength * 64)),
          cx = a.center.x * (w - 1),
          cy = a.center.y * (h - 1),
          dx = x - cx,
          dy = y - cy;
        for (let j = 0; j < steps; j++) {
          const t = steps === 1 ? 0 : j / (steps - 1) - 0.5,
            theta = t * a.strength * Math.PI,
            factor = 1 + t * a.strength;
          sample(
            input,
            w,
            h,
            cx + (a.mode === "spin" ? dx * Math.cos(theta) - dy * Math.sin(theta) : dx * factor),
            cy + (a.mode === "spin" ? dx * Math.sin(theta) + dy * Math.cos(theta) : dy * factor),
            tmp,
          );
          for (let c = 0; c < 4; c++) sum[c] += tmp[c]!;
        }
        for (let c = 0; c < 3; c++) out[i + c] = sum[3] ? (sum[c]! * 255) / sum[3]! : 0;
        out[i + 3] = sum[3]! / steps;
      } else if (a.kind === "surface") {
        if (!input[i + 3]) continue;
        sum.fill(0);
        let weight = 0;
        for (let dy = -a.radius; dy <= a.radius; dy++)
          for (let dx = -a.radius; dx <= a.radius; dx++) {
            const j = index(x + dx, y + dy),
              range = Math.max(...[0, 1, 2].map((c) => Math.abs(input[j + c]! - input[i + c]!)));
            if (range > a.threshold || !input[j + 3]) continue;
            const k =
              (Math.exp(
                -(dx * dx + dy * dy) / (2 * a.radius * a.radius) -
                  (range * range) / (2 * a.threshold * a.threshold),
              ) *
                input[j + 3]!) /
              255;
            weight += k;
            for (let c = 0; c < 3; c++) sum[c] += input[j + c]! * k;
          }
        if (weight) for (let c = 0; c < 3; c++) out[i + c] = sum[c]! / weight;
      } else if (a.kind === "emboss") {
        const theta = (a.angle * Math.PI) / 180,
          dx = Math.cos(theta) * a.height,
          dy = Math.sin(theta) * a.height,
          v = 128 + (lum(index(x + dx, y + dy)) - lum(index(x - dx, y - dy))) * a.strength;
        out[i] = out[i + 1] = out[i + 2] = v;
      } else if (a.kind === "edgeDetect") {
        const at = (dx: number, dy: number) => lum(index(x + dx, y + dy));
        const gx = -at(-1, -1) + at(1, -1) - 2 * at(-1, 0) + 2 * at(1, 0) - at(-1, 1) + at(1, 1),
          gy = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1),
          v =
            (a.method === "sobel"
              ? Math.hypot(gx, gy) / 4
              : Math.abs(4 * at(0, 0) - at(-1, 0) - at(1, 0) - at(0, -1) - at(0, 1))) * a.strength;
        out[i] = out[i + 1] = out[i + 2] = v;
      } else if (a.kind === "grain") {
        if (!input[i + 3]) continue;
        const noise = () =>
          a.distribution === "uniform"
            ? random() * 2 - 1
            : (Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random())) / 3;
        const mono = noise();
        for (let c = 0; c < 3; c++)
          out[i + c] = input[i + c]! + (a.monochrome ? mono : noise()) * a.amount * 2.55;
      }
    }
  return out;
}
/** Spatial parameters are native layer units. Point/range/seed parameters do not scale. */
export function scaledSmartOperation(a: SmartOperation, scale: number): SmartOperation {
  if (a.kind === "gaussian" || a.kind === "unsharp" || a.kind === "highPass")
    return { ...a, radius: Math.max(0.1, a.radius * scale) };
  if (a.kind === "median" || a.kind === "surface")
    return { ...a, radius: Math.max(1, Math.ceil(a.radius * scale)) };
  if (a.kind === "motion") return { ...a, length: Math.max(1, Math.round(a.length * scale)) };
  if (a.kind === "emboss") return { ...a, height: Math.max(1, a.height * scale) };
  return a;
}
