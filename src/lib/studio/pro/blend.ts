/**
 * Layer blend modes, using the Canvas 2D `globalCompositeOperation` names.
 *
 * The browser compositor implements these from the W3C Compositing and Blending Level 1
 * specification. The pixel paths (clipping stacks, layer effects) use the formulas below,
 * taken from the same specification, so preview, export and clipped content agree.
 */
export const BLEND_MODES = [
  "source-over",
  "darken",
  "multiply",
  "color-burn",
  "lighten",
  "screen",
  "color-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_LABELS: Record<BlendMode, string> = {
  "source-over": "Normal",
  darken: "Darken",
  multiply: "Multiply",
  "color-burn": "Color Burn",
  lighten: "Lighten",
  screen: "Screen",
  "color-dodge": "Color Dodge",
  overlay: "Overlay",
  "soft-light": "Soft Light",
  "hard-light": "Hard Light",
  difference: "Difference",
  exclusion: "Exclusion",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
};

/** Menu groups, separated in the UI the way image editors conventionally group them. */
export const BLEND_GROUPS: BlendMode[][] = [
  ["source-over"],
  ["darken", "multiply", "color-burn"],
  ["lighten", "screen", "color-dodge"],
  ["overlay", "soft-light", "hard-light"],
  ["difference", "exclusion"],
  ["hue", "saturation", "color", "luminosity"],
];

export const BLEND_GROUP_NAMES = [
  "Normal",
  "Darken",
  "Lighten",
  "Contrast",
  "Inversion",
  "Component",
];

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === "string" && (BLEND_MODES as readonly string[]).includes(value);
}

/** Separable blend of one channel; b = backdrop, s = source, both in 0..1. */
function channel(mode: BlendMode, b: number, s: number) {
  switch (mode) {
    case "multiply":
      return b * s;
    case "screen":
      return b + s - b * s;
    case "overlay":
      return hardLight(s, b);
    case "darken":
      return Math.min(b, s);
    case "lighten":
      return Math.max(b, s);
    case "color-dodge":
      return b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s));
    case "color-burn":
      return b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
    case "hard-light":
      return hardLight(b, s);
    case "soft-light": {
      if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return b + (2 * s - 1) * (d - b);
    }
    case "difference":
      return Math.abs(b - s);
    case "exclusion":
      return b + s - 2 * b * s;
    default:
      return s;
  }
}
function hardLight(b: number, s: number) {
  return s <= 0.5 ? b * 2 * s : b + (2 * s - 1) - b * (2 * s - 1);
}

type RGB = [number, number, number];
const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c: RGB): RGB {
  const l = lum(c),
    n = Math.min(c[0], c[1], c[2]),
    x = Math.max(c[0], c[1], c[2]);
  let out: RGB = [c[0], c[1], c[2]];
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as RGB;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as RGB;
  return out;
}
function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}
const sat = (c: RGB) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c: RGB, s: number): RGB {
  const order = [0, 1, 2].sort((i, j) => c[i]! - c[j]!),
    [min, mid, max] = order as [number, number, number],
    out: RGB = [0, 0, 0];
  if (c[max] > c[min]) {
    out[mid] = ((c[mid] - c[min]) * s) / (c[max] - c[min]);
    out[max] = s;
  }
  return out;
}

const NON_SEPARABLE = new Set<BlendMode>(["hue", "saturation", "color", "luminosity"]);

/**
 * Blend a source color over a backdrop color (both straight, non-premultiplied 0..1 RGB)
 * and return the mixed color B(Cb, Cs) before alpha compositing.
 */
export function blendColor(mode: BlendMode, b: RGB, s: RGB): RGB {
  switch (mode) {
    case "hue":
      return setLum(setSat(s, sat(b)), lum(b));
    case "saturation":
      return setLum(setSat(b, sat(s)), lum(b));
    case "color":
      return setLum(s, lum(b));
    case "luminosity":
      return setLum(b, lum(s));
    default:
      return [channel(mode, b[0], s[0]), channel(mode, b[1], s[1]), channel(mode, b[2], s[2])];
  }
}

/**
 * Blend RGBA pixel `i` of `back` and `front` (0..255 bytes) into `out` as 0..1 RGB.
 * Separable modes avoid allocation because clipping stacks run this for every pixel.
 */
export function blendPixel(
  mode: BlendMode,
  back: ArrayLike<number>,
  front: ArrayLike<number>,
  i: number,
  out: Float64Array,
) {
  if (NON_SEPARABLE.has(mode)) {
    const c = blendColor(
      mode,
      [back[i]! / 255, back[i + 1]! / 255, back[i + 2]! / 255],
      [front[i]! / 255, front[i + 1]! / 255, front[i + 2]! / 255],
    );
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
    return out;
  }
  for (let c = 0; c < 3; c++) out[c] = channel(mode, back[i + c]! / 255, front[i + c]! / 255);
  return out;
}
