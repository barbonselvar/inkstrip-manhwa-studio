import { bounds, mapping, applyMatrix, type Matrix } from "./transform.ts";
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
/** Lazy premultiplied box pyramid. Additional Float32 RGBA storage is approximately 1/3 source pixels for 2D images
 * (up to one source plane for thin strips); odd edges include transparent virtual pixels. */
function pyramid(pixels: Uint8ClampedArray, width: number, height: number) {
  type Level = { data: Float32Array; width: number; height: number };
  const levels: Level[] = [];
  return (level: number): Level => {
    while (levels.length < level) {
      const prev = levels.at(-1),
        w = prev?.width ?? width,
        h = prev?.height ?? height,
        next = {
          width: Math.ceil(w / 2),
          height: Math.ceil(h / 2),
          data: new Float32Array(Math.ceil(w / 2) * Math.ceil(h / 2) * 4),
        };
      for (let y = 0; y < next.height; y++)
        for (let x = 0; x < next.width; x++) {
          const dest = (y * next.width + x) * 4;
          for (let j = 0; j < 2; j++)
            for (let i = 0; i < 2; i++) {
              if (x * 2 + i >= w || y * 2 + j >= h) continue;
              const src = ((y * 2 + j) * w + x * 2 + i) * 4;
              if (prev) for (let c = 0; c < 4; c++) next.data[dest + c]! += prev.data[src + c]! / 4;
              else {
                const a = pixels[src + 3]! / 255;
                for (let c = 0; c < 3; c++) next.data[dest + c]! += (pixels[src + c]! * a) / 4;
                next.data[dest + 3]! += a / 4;
              }
            }
        }
      levels.push(next);
    }
    return levels[level - 1]!;
  };
}
/** Accumulate bilinear premultiplied samples without quantizing low alpha. */
function accumulate(
  data: Uint8ClampedArray | Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  out: Float64Array,
) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -1 || y < -1 || x > w || y > h) return;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      if (ix + i < 0 || iy + j < 0 || ix + i >= w || iy + j >= h) continue;
      const n = ((iy + j) * w + ix + i) * 4,
        weight = (i ? fx : 1 - fx) * (j ? fy : 1 - fy),
        a = data[n + 3]! * (data instanceof Uint8ClampedArray ? 1 / 255 : 1);
      for (let c = 0; c < 3; c++)
        out[c]! += data[n + c]! * weight * (data instanceof Uint8ClampedArray ? a : 1);
      out[3]! += a * weight;
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
    mip = pyramid(pixels, width, height),
    rgba = new Float64Array(4),
    area = bounds(t, t.deform?.width ?? width / scale, t.deform?.height ?? height / scale),
    left = Math.max(0, Math.floor((area.x - origin.x) * scale) - 1),
    top = Math.max(0, Math.floor((area.y - origin.y) * scale) - 1),
    right = Math.min(outWidth, Math.ceil((area.x + area.width - origin.x) * scale) + 1),
    bottom = Math.min(outHeight, Math.ceil((area.y + area.height - origin.y) * scale) + 1);
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const p = m.backward({ x: (x + 0.5) / scale + origin.x, y: (y + 0.5) / scale + origin.y });
      // Local inverse Jacobian measures the source footprint of one output pixel.
      const px = m.backward({ x: (x + 1) / scale + origin.x, y: (y + 0.5) / scale + origin.y }),
        py = m.backward({ x: (x + 0.5) / scale + origin.x, y: (y + 1) / scale + origin.y }),
        ax = (px.x - p.x) * scale * 2,
        ay = (px.y - p.y) * scale * 2,
        bx = (py.x - p.x) * scale * 2,
        by = (py.y - p.y) * scale * 2,
        trace = ax * ax + ay * ay + bx * bx + by * by,
        determinant = (ax * by - ay * bx) ** 2,
        major = Math.sqrt((trace + Math.sqrt(Math.max(0, trace * trace - 4 * determinant))) / 2),
        minor = major ? Math.sqrt(determinant) / major : 1,
        index = (y * outWidth + x) * 4;
      if (!Number.isFinite(major)) continue;
      if (major <= 1.5) {
        sampleRgba(pixels, width, height, p.x * scale - 0.5, p.y * scale - 0.5, out, index);
        continue;
      }
      // Up to 8x8 stratified samples plus a minification pyramid. The anisotropy cap
      // trades detail in the narrow direction for bounded work on extreme reductions.
      const maxLevel = Math.ceil(Math.log2(Math.max(width, height))),
        level = Math.min(
          maxLevel,
          Math.max(0, Math.floor(Math.log2(Math.max(1, minor, major / 8)))),
        ),
        factor = 2 ** level,
        source = level ? mip(level) : { data: pixels, width, height },
        nx = Math.min(8, Math.max(1, Math.ceil(Math.hypot(ax, ay) / factor))),
        ny = Math.min(8, Math.max(1, Math.ceil(Math.hypot(bx, by) / factor)));
      rgba.fill(0);
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const q = m.backward({
            x: (x + (i + 0.5) / nx) / scale + origin.x,
            y: (y + (j + 0.5) / ny) / scale + origin.y,
          });
          accumulate(
            source.data,
            source.width,
            source.height,
            (q.x * scale) / factor - 0.5,
            (q.y * scale) / factor - 0.5,
            rgba,
          );
        }
      if (rgba[3]! > 0) {
        for (let c = 0; c < 3; c++) out[index + c] = rgba[c]! / rgba[3]!;
        out[index + 3] = (rgba[3]! * 255) / (nx * ny);
      }
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
  premapping?: Matrix,
) {
  const out = new Uint8ClampedArray(outWidth * outHeight * 4),
    m = mapping(t);
  for (let y = 0; y < outHeight; y++)
    for (let x = 0; x < outWidth; x++) {
      const local = { x: (x + 0.5) / scale, y: (y + 0.5) / scale };
      const p = m.forward(premapping ? applyMatrix(premapping, local) : local);
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
