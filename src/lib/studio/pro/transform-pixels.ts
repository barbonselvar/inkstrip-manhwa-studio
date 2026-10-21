import { bounds, mapping } from "./transform.ts";
import type { Point, Transform } from "./model.ts";
/** Bilinear reconstruction with transparent virtual pixels, in premultiplied alpha. Coordinates are pixel centers minus .5. */
export function sampleRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  index: number,
) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -1 || y < -1 || x > width || y > height)
    return;
  const left = Math.floor(x),
    top = Math.floor(y),
    fx = x - left,
    fy = y - top;
  let a = 0,
    r = 0,
    g = 0,
    b = 0;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const sx = left + i,
        sy = top + j;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const n = (sy * width + sx) * 4,
        w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy),
        alpha = pixels[n + 3]! * w;
      a += alpha;
      r += pixels[n]! * alpha;
      g += pixels[n + 1]! * alpha;
      b += pixels[n + 2]! * alpha;
    }
  out[index + 3] = a;
  if (a > 0) {
    out[index] = r / a;
    out[index + 1] = g / a;
    out[index + 2] = b / a;
  }
}
export function projectPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  t: Transform,
  outWidth: number,
  outHeight: number,
  scale = 1,
  origin: Point = { x: 0, y: 0 },
) {
  const out = new Uint8ClampedArray(outWidth * outHeight * 4),
    m = mapping(t),
    area = bounds(t, t.deform?.width ?? width / scale, t.deform?.height ?? height / scale),
    left = Math.max(0, Math.floor((area.x - origin.x) * scale) - 1),
    top = Math.max(0, Math.floor((area.y - origin.y) * scale) - 1),
    right = Math.min(outWidth, Math.ceil((area.x + area.width - origin.x) * scale) + 1),
    bottom = Math.min(outHeight, Math.ceil((area.y + area.height - origin.y) * scale) + 1);
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const p = m.backward({ x: (x + 0.5) / scale + origin.x, y: (y + 0.5) / scale + origin.y });
      sampleRgba(
        pixels,
        width,
        height,
        p.x * scale - 0.5,
        p.y * scale - 0.5,
        out,
        (y * outWidth + x) * 4,
      );
    }
  return out;
}
/** Pull a document-space selection or immutable clone snapshot into the layer's original local grid. */
export function sampleDocument(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  t: Transform,
  outWidth: number,
  outHeight: number,
  scale = 1,
  offset: Point = { x: 0, y: 0 },
) {
  const out = new Uint8ClampedArray(outWidth * outHeight * 4),
    m = mapping(t);
  for (let y = 0; y < outHeight; y++)
    for (let x = 0; x < outWidth; x++) {
      const p = m.forward({ x: (x + 0.5) / scale, y: (y + 0.5) / scale });
      sampleRgba(
        pixels,
        width,
        height,
        (p.x + offset.x) * scale - 0.5,
        (p.y + offset.y) * scale - 0.5,
        out,
        (y * outWidth + x) * 4,
      );
    }
  return out;
}
