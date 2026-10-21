/**
 * Traditional healing color adaptation. The sampled texture is preserved, while
 * its average RGB tone is shifted to match the target neighborhood. This is a
 * deterministic local image operation; it does not use or imply generative AI.
 */
export function matchRepairColor(
  sampled: Uint8ClampedArray,
  target: Uint8ClampedArray,
): Uint8ClampedArray {
  if (sampled.length !== target.length || sampled.length % 4 !== 0)
    throw new Error("Healing pixel buffers must have matching RGBA dimensions.");
  const sourceMean = [0, 0, 0],
    targetMean = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < sampled.length; i += 4) {
    const alpha = Math.min(sampled[i + 3]!, target[i + 3]!);
    if (!alpha) continue;
    for (let c = 0; c < 3; c++) {
      sourceMean[c]! += sampled[i + c]! * alpha;
      targetMean[c]! += target[i + c]! * alpha;
    }
    count += alpha;
  }
  if (!count) return new Uint8ClampedArray(sampled);
  for (let c = 0; c < 3; c++) {
    sourceMean[c]! /= count;
    targetMean[c]! /= count;
  }
  const output = new Uint8ClampedArray(sampled);
  for (let i = 0; i < output.length; i += 4) {
    if (!output[i + 3]) continue;
    for (let c = 0; c < 3; c++)
      output[i + c] = Math.max(0, Math.min(255, output[i + c]! + targetMean[c]! - sourceMean[c]!));
  }
  return output;
}

import type { Point, Selection, Stroke } from "./model.ts";
export type RepairKind = "spot" | "patch" | "heal";
export type RepairRequest = { kind: RepairKind; layerId: string; stroke: Stroke; source?: Point };
export type RepairRect = { x: number; y: number; width: number; height: number };
export const MAX_REPAIR_PIXELS = 1_000_000;

/** Normalized convolution of intact target-minus-donor colors. Damaged pixels do
 * not contribute to tone estimates. The varying low-frequency correction keeps
 * donor detail, uses local support, and falls back to the surrounding mean only
 * when the interior has no local support. This is traditional pixel processing.
 */
export function spatialHeal(
  donor: Uint8ClampedArray,
  target: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  donorMask?: Uint8ClampedArray,
) {
  const count = width * height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    count > MAX_REPAIR_PIXELS ||
    donor.length !== count * 4 ||
    target.length !== count * 4 ||
    mask.length !== count * 4 ||
    (donorMask !== undefined && donorMask.length !== count * 4) ||
    !Number.isFinite(radius) ||
    radius < 1 ||
    radius > 128
  )
    throw new Error("Invalid or oversized repair neighborhood (up to one megapixel per stroke).");
  radius = Math.ceil(radius);
  const horizontal = new Float32Array(count * 4),
    global = [0, 0, 0, 0];
  const value = (i: number, channel: number) => {
    const weight =
      mask[i * 4 + 3]! > 0 || (donorMask?.[i * 4 + 3] ?? 0) > 0
        ? 0
        : Math.min(donor[i * 4 + 3]!, target[i * 4 + 3]!) / 255;
    return channel === 3 ? weight : (target[i * 4 + channel]! - donor[i * 4 + channel]!) * weight;
  };
  for (let y = 0; y < height; y++) {
    const sum = [0, 0, 0, 0];
    for (let x = 0; x < Math.min(width, radius + 1); x++)
      for (let c = 0; c < 4; c++) sum[c]! += value(y * width + x, c);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (let c = 0; c < 4; c++) {
        horizontal[i * 4 + c] = sum[c]!;
        global[c]! += value(i, c);
        if (x - radius >= 0) sum[c]! -= value(y * width + x - radius, c);
        if (x + radius + 1 < width) sum[c]! += value(y * width + x + radius + 1, c);
      }
    }
  }
  const output = new Uint8ClampedArray(donor);
  for (let x = 0; x < width; x++) {
    const sum = [0, 0, 0, 0];
    for (let y = 0; y < Math.min(height, radius + 1); y++)
      for (let c = 0; c < 4; c++) sum[c]! += horizontal[(y * width + x) * 4 + c]!;
    for (let y = 0; y < height; y++) {
      const i = y * width + x,
        denominator = sum[3]! > 1e-6 ? sum[3]! : global[3]!,
        correction = sum[3]! > 1e-6 ? sum : global;
      if (mask[i * 4 + 3] && donor[i * 4 + 3] && denominator > 1e-6)
        for (let c = 0; c < 3; c++)
          output[i * 4 + c] = donor[i * 4 + c]! + correction[c]! / denominator;
      for (let c = 0; c < 4; c++) {
        if (y - radius >= 0) sum[c]! -= horizontal[((y - radius) * width + x) * 4 + c]!;
        if (y + radius + 1 < height) sum[c]! += horizontal[((y + radius + 1) * width + x) * 4 + c]!;
      }
    }
  }
  return output;
}

/** Bounded deterministic local patch search, scored on intact context colors
 * and first-order texture differences. It never samples the damaged rectangle.
 */
export function findRepairDonor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  rect: RepairRect,
): Point {
  const { x, y, width: w, height: h } = rect;
  if (
    pixels.length !== width * height * 4 ||
    ![width, height, x, y, w, h].every(Number.isInteger) ||
    width < 1 ||
    height < 1 ||
    width * height > 16_000_000 ||
    w < 1 ||
    h < 1 ||
    x < 0 ||
    y < 0 ||
    x + w > width ||
    y + h > height
  )
    throw new Error("Invalid automatic repair bounds.");
  const span = Math.min(256, Math.max(32, Math.max(w, h) * 3)),
    stride = Math.max(2, Math.ceil(span / 12)),
    context: Point[] = [],
    sampleStep = Math.max(1, Math.ceil(Math.max(w, h) / 12));
  for (let px = -2; px < w + 2; px += sampleStep)
    for (const py of [-2, h + 1]) context.push({ x: px, y: py });
  for (let py = 0; py < h; py += sampleStep)
    for (const px of [-2, w + 1]) context.push({ x: px, y: py });
  let best: Point | undefined,
    score = Infinity;
  const consider = (sx: number, sy: number) => {
    if (
      sx < 0 ||
      sy < 0 ||
      sx + w > width ||
      sy + h > height ||
      (sx < x + w + 1 && sx + w + 1 > x && sy < y + h + 1 && sy + h + 1 > y)
    )
      return;
    // Reject transparent donor interiors, including content hidden in RGB channels.
    for (let py = 0; py < h; py += sampleStep)
      for (let px = 0; px < w; px += sampleStep)
        if (pixels[((sy + py) * width + sx + px) * 4 + 3]! < 250) return;
    let error = 0,
      samples = 0;
    for (const p of context) {
      const ax = x + p.x,
        ay = y + p.y,
        bx = sx + p.x,
        by = sy + p.y;
      if (
        Math.min(ax, ay, bx, by) < 0 ||
        ax >= width ||
        bx >= width ||
        ay >= height ||
        by >= height
      )
        continue;
      const a = (ay * width + ax) * 4,
        b = (by * width + bx) * 4;
      if (pixels[a + 3]! < 250 || pixels[b + 3]! < 250) continue;
      for (let c = 0; c < 3; c++) {
        const difference = pixels[a + c]! - pixels[b + c]!;
        error += difference * difference;
        if (ax + 1 < width && bx + 1 < width) {
          const gradient =
            pixels[a + 4 + c]! - pixels[a + c]! - (pixels[b + 4 + c]! - pixels[b + c]!);
          error += gradient * gradient * 0.5;
        }
      }
      samples++;
    }
    if (samples < 4) return;
    error = error / samples + Math.hypot(sx - x, sy - y) * 0.01;
    if (error < score) {
      score = error;
      best = { x: sx - x, y: sy - y };
    }
  };
  for (const dx of [-w - 3, 0, w + 3])
    for (const dy of [-h - 3, 0, h + 3]) consider(x + dx, y + dy);
  for (let dy = -span; dy <= span; dy += stride)
    for (let dx = -span; dx <= span; dx += stride) consider(x + dx, y + dy);
  if (!best)
    throw new Error(
      "No opaque local donor region fits. Use a shorter/smaller stroke or Patch Repair with an explicit source.",
    );
  return best;
}

/** World-space rectangle selection shared by the patch gesture and its preview. */
export function patchSelection(a: Point, b: Point, feather: number): Selection {
  return {
    regions: [{ kind: "rectangle", operation: "add", points: [a, b] }],
    inverted: false,
    feather,
  };
}
