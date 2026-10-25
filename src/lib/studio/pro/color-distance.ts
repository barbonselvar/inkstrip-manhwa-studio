/** Colour distances shared by the Magic Wand and Color Range (0..255 scale). */
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
/** OKLab (Ottosson 2020) from 8-bit sRGB. */
export function oklab(r: number, g: number, b: number): [number, number, number] {
  const lr = LINEAR[r]!,
    lg = LINEAR[g]!,
    lb = LINEAR[b]!;
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb),
    m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb),
    s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export type ColorMetric = "rgb" | "perceptual";
export type Rgba = [number, number, number, number];
/** Both metrics return 0..255 and agree on alpha: a transparent pixel only matches a
 * transparent reference, and hidden RGB under zero alpha is ignored.
 * - rgb: largest straight-alpha-weighted channel difference (the existing wand metric).
 * - perceptual: OKLab Euclidean distance × 255 (black→white = 255), weighted by the
 *   smaller alpha, so equal visual steps get similar tolerance across hues. */
export function colorDistanceTo(
  pixels: Uint8ClampedArray,
  i: number,
  ref: Rgba,
  metric: ColorMetric,
  refLab?: [number, number, number],
) {
  const a = pixels[i + 3]!,
    alpha = Math.abs(a - ref[3]);
  if (metric === "rgb") {
    const pa = a / 255,
      ra = ref[3] / 255;
    return Math.max(
      Math.abs(pixels[i]! * pa - ref[0] * ra),
      Math.abs(pixels[i + 1]! * pa - ref[1] * ra),
      Math.abs(pixels[i + 2]! * pa - ref[2] * ra),
      alpha,
    );
  }
  const lab = oklab(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!),
    ref2 = refLab ?? oklab(ref[0], ref[1], ref[2]),
    d = Math.hypot(lab[0] - ref2[0], lab[1] - ref2[1], lab[2] - ref2[2]);
  return Math.max(d * 255 * (Math.min(a, ref[3]) / 255), alpha);
}
