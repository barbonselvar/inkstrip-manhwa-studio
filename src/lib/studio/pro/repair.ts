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
      output[i + c] = Math.max(
        0,
        Math.min(255, output[i + c]! + targetMean[c]! - sourceMean[c]!),
      );
  }
  return output;
}
