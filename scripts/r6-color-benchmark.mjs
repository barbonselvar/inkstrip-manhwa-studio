/** Actual Node CPU timings and peak process RSS; local synthetic RGBA, no image/network model. */
import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import {
  processColor,
  defaultOperation,
  validateColorWork,
} from "../src/lib/studio/pro/color-engine.ts";
function representative(kind) {
  const a = defaultOperation(kind);
  if (a.kind === "levels")
    a.channels.rgb = { black: 16, white: 238, gamma: 0.9, outBlack: 4, outWhite: 250 };
  if (a.kind === "curves")
    a.channels.rgb = [
      { x: 0, y: 0 },
      { x: 64, y: 50 },
      { x: 128, y: 150 },
      { x: 255, y: 255 },
    ];
  if (a.kind === "exposure") {
    a.stops = 0.7;
    a.gamma = 1.1;
  }
  if (a.kind === "vibrance") {
    a.vibrance = 35;
    a.saturation = 10;
  }
  if (a.kind === "hsl") {
    a.hue = 15;
    a.saturation = 8;
    a.lightness = 4;
  }
  if (a.kind === "balance") a.midtones = [8, 2, -4];
  return a;
}
const results = [];
for (const [width, height, ops] of [
  [
    128,
    96,
    [
      representative("levels"),
      representative("curves"),
      representative("hsl"),
      representative("balance"),
      representative("noise"),
      representative("median"),
      { kind: "gaussian", radius: 32 },
    ],
  ],
  [
    1024,
    1024,
    [
      representative("levels"),
      representative("curves"),
      representative("exposure"),
      representative("vibrance"),
      { kind: "gaussian", radius: 4 },
      { kind: "box", radius: 32 },
      representative("unsharp"),
      representative("motion"),
      representative("median"),
      representative("edges"),
      representative("denoise"),
    ],
  ],
  [
    2000,
    2000,
    [
      representative("levels"),
      representative("curves"),
      representative("exposure"),
      representative("vibrance"),
      { kind: "gaussian", radius: 1 },
      { kind: "box", radius: 32 },
      { kind: "unsharp", radius: 1, amount: 100, threshold: 2 },
    ],
  ],
]) {
  const source = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < source.length; p += 4) {
    source[p] = (p / 4) % 256;
    source[p + 1] = (p / 1024) % 256;
    source[p + 2] = 128;
    source[p + 3] = p % 20 === 0 ? 128 : 255;
  }
  for (const operation of ops) {
    global.gc?.();
    const before = process.memoryUsage(),
      start = performance.now();
    const out = processColor(source, width, height, operation),
      milliseconds = performance.now() - start,
      after = process.memoryUsage();
    let checksum = 0;
    for (let p = 0; p < out.length; p += 997) checksum = (checksum + out[p]) >>> 0;
    results.push({
      width,
      height,
      operation,
      milliseconds: +milliseconds.toFixed(2),
      rssBefore: before.rss,
      rssAfter: after.rss,
      arrayBuffersBefore: before.arrayBuffers,
      arrayBuffersAfter: after.arrayBuffers,
      peakProcessRssBytes: process.resourceUsage().maxRSS * 1024,
      checksum,
    });
    console.log(`${width}x${height} ${operation.kind}: ${milliseconds.toFixed(2)}ms`);
  }
}
let largeRadiusRejected = false;
try {
  validateColorWork(2000, 2000, { kind: "gaussian", radius: 32 });
} catch {
  largeRadiusRejected = true;
}
await mkdir("/workspace/r6-evidence", { recursive: true });
await writeFile(
  "/workspace/r6-evidence/benchmark.json",
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      results,
      largeRadiusRejected,
      notes:
        "Non-neutral color settings; single timed runs after optional GC, process RSS includes runtime/allocator retention; not browser heap or Android measurements. Pixel loops only, PNG/decode excluded.",
    },
    null,
    2,
  ),
);
