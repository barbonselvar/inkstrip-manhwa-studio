import type { Resampling } from "./geometry.ts";
const sinc = (x: number) => (Math.abs(x) < 1e-8 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
function kernel(x: number, method: Resampling) {
  x = Math.abs(x);
  if (method === "bilinear") return Math.max(0, 1 - x);
  if (method === "lanczos") return x < 3 ? sinc(x) * sinc(x / 3) : 0;
  // Catmull–Rom cubic, a = -0.5.
  return x < 1
    ? 1.5 * x ** 3 - 2.5 * x ** 2 + 1
    : x < 2
      ? -0.5 * x ** 3 + 2.5 * x ** 2 - 4 * x + 2
      : 0;
}
function weights(input: number, output: number, method: Resampling) {
  const scale = Math.max(1, input / output),
    radius = (method === "lanczos" ? 3 : method === "bicubic" ? 2 : 1) * scale;
  return Array.from({ length: output }, (_, n) => {
    const center = ((n + 0.5) * input) / output - 0.5,
      entries: [number, number][] = [];
    let sum = 0;
    for (
      let i = Math.max(0, Math.ceil(center - radius));
      i <= Math.min(input - 1, Math.floor(center + radius));
      i++
    ) {
      const weight = kernel((i - center) / scale, method);
      if (!weight) continue;
      const index = Math.max(0, Math.min(input - 1, i));
      if (entries.at(-1)?.[0] === index) entries.at(-1)![1] += weight;
      else entries.push([index, weight]);
      sum += weight;
    }
    return entries.map(([i, w]): [number, number] => [i, w / sum]);
  });
}
/** Separable, scale-widened reconstruction in premultiplied sRGB. Bounded row cache, no full float image. */
export function resample(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
  method: Resampling,
): Uint8ClampedArray<ArrayBuffer> {
  if (
    ![width, height, outWidth, outHeight].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 16384,
    ) ||
    width * height > 16_777_216 ||
    outWidth * outHeight > 16_777_216 ||
    pixels.length !== width * height * 4 ||
    !["nearest", "bilinear", "bicubic", "lanczos"].includes(method)
  )
    throw new Error("Invalid resampling dimensions or method.");
  if (width === outWidth && height === outHeight) return pixels.slice();
  const result = new Uint8ClampedArray(outWidth * outHeight * 4);
  if (method === "nearest") {
    for (let y = 0; y < outHeight; y++)
      for (let x = 0; x < outWidth; x++) {
        const i =
            (Math.min(height - 1, Math.floor(((y + 0.5) * height) / outHeight)) * width +
              Math.min(width - 1, Math.floor(((x + 0.5) * width) / outWidth))) *
            4,
          o = (y * outWidth + x) * 4;
        result.set(pixels.subarray(i, i + 4), o);
      }
    return result;
  }
  const wx = weights(width, outWidth, method),
    wy = weights(height, outHeight, method),
    cache = new Map<number, Float32Array>();
  function row(y: number) {
    if (cache.has(y)) return cache.get(y)!;
    const r = new Float32Array(outWidth * 4);
    for (let x = 0; x < outWidth; x++)
      for (const [sx, w] of wx[x]!) {
        const i = (y * width + sx) * 4,
          o = x * 4,
          a = pixels[i + 3]! / 255;
        r[o]! += pixels[i]! * a * w;
        r[o + 1]! += pixels[i + 1]! * a * w;
        r[o + 2]! += pixels[i + 2]! * a * w;
        r[o + 3]! += pixels[i + 3]! * w;
      }
    if (cache.size >= 16) cache.delete(cache.keys().next().value!);
    cache.set(y, r);
    return r;
  }
  for (let y = 0; y < outHeight; y++) {
    const line = new Float32Array(outWidth * 4);
    for (const [sy, w] of wy[y]!) {
      const r = row(sy);
      for (let x = 0; x < line.length; x++) line[x]! += r[x]! * w;
    }
    for (let x = 0; x < outWidth; x++) {
      const i = x * 4,
        o = (y * outWidth + x) * 4,
        a = Math.max(0, Math.min(255, line[i + 3]!));
      result[o + 3] = a;
      if (!result[o + 3]) continue;
      for (let c = 0; c < 3; c++) result[o + c] = (line[i + c]! * 255) / a;
    }
  }
  return result;
}
