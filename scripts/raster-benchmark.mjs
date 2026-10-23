import os from "node:os";
import { performance } from "node:perf_hooks";
import {
  refineTiled,
  REFINE_DEFAULTS,
  morphology,
} from "../src/lib/studio/pro/refine-selection.ts";
import { brushDabs, DAB_DEFAULTS } from "../src/lib/studio/pro/brush-dynamics.ts";
const result = {
  platform: os.platform(),
  cpu: os.cpus()[0]?.model,
  node: process.version,
  method:
    "One cold run per size; generated line-art character silhouette with fine strands; source-resolution CPU processing; process peak RSS includes input/output and runtime, not browser/GPU memory.",
  measurements: [],
};
for (const [width, height, name] of [
  [2048, 2048, "2K square"],
  [4096, 4096, "4K square"],
  [1024, 8192, "Long chapter"],
]) {
  global.gc?.();
  const pixels = new Uint8ClampedArray(width * height * 4),
    mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = x > width * 0.3 && x < width * 0.7,
        edge = Math.abs(x - width * 0.3) < 5 || Math.abs(x - width * 0.7) < 5,
        strand = y % 13 === 0 && x > width * 0.25 && x < width * 0.75,
        value = strand ? 40 : inside ? 32 : edge ? 128 : 240;
      const i = y * width + x;
      pixels.set([value, value, value, 255], i * 4);
      mask[i] = inside ? 255 : 0;
    }
  let begin = performance.now();
  const refined = await refineTiled(pixels, mask, width, height, {
    ...REFINE_DEFAULTS,
    radius: 3,
    feather: 1,
  });
  const refineMs = performance.now() - begin;
  begin = performance.now();
  await morphology(mask, width, height, 8, true);
  result.measurements.push({
    name,
    width,
    height,
    refineMs: +refineMs.toFixed(2),
    expand8pxMs: +(performance.now() - begin).toFixed(2),
    peakProcessRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
    centerAlpha: refined[Math.floor(height / 2) * width + Math.floor(width / 2)],
  });
}
const stroke = {
  points: Array.from({ length: 2000 }, (_, i) => ({
    x: i * 2,
    y: 50 + Math.sin(i / 30) * 20,
    time: i * 2,
  })),
  size: 24,
  color: "#111111",
  hardness: 0.8,
  opacity: 0.6,
  flow: 0.3,
  erase: false,
  dynamics: { ...DAB_DEFAULTS, scatter: 0.3 },
  seed: 42,
};
const begin = performance.now();
let dabs = 0;
for (let pass = 0; pass < 100; pass++) for (const _dab of brushDabs(stroke)) dabs++;
result.brush = {
  strokes: 100,
  inputPointsPerStroke: 2000,
  dabs,
  ms: +(performance.now() - begin).toFixed(2),
};
console.log(JSON.stringify(result, null, 2));
