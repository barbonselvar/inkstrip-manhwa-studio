/** Classical local image editing; no AI inference or network requests. */
export type Adjustments = {
  brightness: number;
  contrast: number;
  exposure: number;
  saturation: number;
  temperature: number;
  sharpen: number;
  noise: number;
  blur: number;
};
export const NEUTRAL: Readonly<Adjustments> = Object.freeze({
  brightness: 0,
  contrast: 0,
  exposure: 0,
  saturation: 0,
  temperature: 0,
  sharpen: 0,
  noise: 0,
  blur: 0,
});
export const ADJUSTMENT_FIELDS = [
  { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1 },
  { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1 },
  { key: "exposure", label: "Exposure", min: -3, max: 3, step: 0.1 },
  { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1 },
  { key: "temperature", label: "Temperature", min: -100, max: 100, step: 1 },
  { key: "sharpen", label: "Sharpening", min: 0, max: 100, step: 1 },
  { key: "noise", label: "Noise reduction", min: 0, max: 100, step: 1 },
  { key: "blur", label: "Blur radius", min: 0, max: 12, step: 1 },
] as const;
export const PRESETS: ReadonlyArray<{ name: string; values: Partial<Adjustments> }> = [
  { name: "Natural ink", values: { contrast: 4, sharpen: 12, noise: 12 } },
  { name: "Soft color", values: { saturation: 6, temperature: 3, contrast: -3 } },
  { name: "Monochrome", values: { saturation: -100, contrast: 8 } },
  { name: "Gentle lift", values: { exposure: 0.3, brightness: 3 } },
];
export function validateAdjustments(values?: Adjustments) {
  if (values === undefined) return;
  if (!values || typeof values !== "object") throw new Error("Invalid image adjustments.");
  for (const field of ADJUSTMENT_FIELDS) {
    const value = values[field.key];
    if (
      !Number.isFinite(value) ||
      value < field.min ||
      value > field.max ||
      (field.step === 1 && !Number.isInteger(value))
    )
      throw new Error(`Invalid ${field.label.toLowerCase()}.`);
  }
}
export function hasAdjustments(values?: Adjustments) {
  return !!values && ADJUSTMENT_FIELDS.some(({ key }) => values[key] !== 0);
}
/** Number of contextual source pixels needed to avoid seams between processing tiles. */
export function adjustmentHalo(values?: Adjustments, scale = 1) {
  return values
    ? (values.noise ? 1 : 0) + (values.sharpen ? 1 : 0) + Math.round(values.blur * scale)
    : 0;
}

/** Alpha-weighted separable box blur. Alpha itself and invisible RGB are preserved. */
export function blurPixels(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
) {
  if (!radius) return input.slice();
  const temp = new Float32Array(input.length);
  const output = input.slice();
  for (let y = 0; y < height; y++) {
    const sum = [0, 0, 0, 0];
    const add = (x: number, sign: number) => {
      const p = (y * width + Math.max(0, Math.min(width - 1, x))) * 4,
        alpha = input[p + 3]! / 255;
      for (let c = 0; c < 3; c++) sum[c]! += input[p + c]! * alpha * sign;
      sum[3]! += alpha * sign;
    };
    for (let x = -radius; x <= radius; x++) add(x, 1);
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) temp[p + c] = sum[c]!;
      add(x - radius, -1);
      add(x + radius + 1, 1);
    }
  }
  for (let x = 0; x < width; x++) {
    const sum = [0, 0, 0, 0];
    const add = (y: number, sign: number) => {
      const p = (Math.max(0, Math.min(height - 1, y)) * width + x) * 4;
      for (let c = 0; c < 4; c++) sum[c]! += temp[p + c]! * sign;
    };
    for (let y = -radius; y <= radius; y++) add(y, 1);
    for (let y = 0; y < height; y++) {
      const p = (y * width + x) * 4;
      if (input[p + 3] && sum[3]! > 0)
        for (let c = 0; c < 3; c++) output[p + c] = sum[c]! / sum[3]!;
      add(y - radius, -1);
      add(y + radius + 1, 1);
    }
  }
  return output;
}
export function applyAdjustments(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  values: Adjustments,
  scale = 1,
) {
  if (input.length !== width * height * 4) throw new Error("Invalid pixel buffer.");
  let pixels = input.slice();
  if (values.noise) {
    const source = pixels.slice(),
      strength = values.noise / 100;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        if (!source[p + 3]) continue;
        let weight = 0;
        const sum = [0, 0, 0];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const q =
              (Math.max(0, Math.min(height - 1, y + dy)) * width +
                Math.max(0, Math.min(width - 1, x + dx))) *
              4;
            const difference = Math.max(
              Math.abs(source[p]! - source[q]!),
              Math.abs(source[p + 1]! - source[q + 1]!),
              Math.abs(source[p + 2]! - source[q + 2]!),
            );
            if (difference > 24 || !source[q + 3]) continue;
            const w = ((1 - difference / 25) * source[q + 3]!) / 255;
            weight += w;
            for (let c = 0; c < 3; c++) sum[c]! += source[q + c]! * w;
          }
        if (weight)
          for (let c = 0; c < 3; c++)
            pixels[p + c] = source[p + c]! * (1 - strength) + (sum[c]! / weight) * strength;
      }
  }
  if (values.blur) pixels = blurPixels(pixels, width, height, Math.round(values.blur * scale));
  if (values.sharpen) {
    const source = pixels.slice(),
      low = blurPixels(source, width, height, 1),
      amount = values.sharpen / 100;
    for (let p = 0; p < pixels.length; p += 4)
      if (source[p + 3])
        for (let c = 0; c < 3; c++) {
          const difference = source[p + c]! - low[p + c]!;
          if (Math.abs(difference) > 2)
            pixels[p + c] = source[p + c]! + Math.max(-32, Math.min(32, difference * amount));
        }
  }
  const exposure = 2 ** values.exposure,
    contrast = 2 ** (values.contrast / 50),
    saturation = 1 + values.saturation / 100,
    brightness = values.brightness * 2.55,
    warm = values.temperature * 0.3;
  for (let p = 0; p < pixels.length; p += 4) {
    if (!pixels[p + 3]) continue;
    let r = (pixels[p]! * exposure - 127.5) * contrast + 127.5 + brightness;
    let g = (pixels[p + 1]! * exposure - 127.5) * contrast + 127.5 + brightness;
    let b = (pixels[p + 2]! * exposure - 127.5) * contrast + 127.5 + brightness;
    const gray = r * 0.2126 + g * 0.7152 + b * 0.0722;
    r = gray + (r - gray) * saturation + warm;
    g = gray + (g - gray) * saturation;
    b = gray + (b - gray) * saturation - warm;
    pixels[p] = r;
    pixels[p + 1] = g;
    pixels[p + 2] = b;
  }
  return pixels;
}
