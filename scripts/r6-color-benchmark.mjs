/** Actual Node CPU timings and peak process RSS; local synthetic RGBA, no image/network model. */
import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import {
  processColor,
  defaultOperation,
  validateColorWork,
} from "../src/lib/studio/pro/color-engine.ts";
const results = [];
for (const [width, height, ops] of [
  [
    128,
    96,
    [
      defaultOperation("levels"),
      defaultOperation("curves"),
      defaultOperation("hsl"),
      defaultOperation("balance"),
      defaultOperation("noise"),
      defaultOperation("median"),
      { kind: "gaussian", radius: 32 },
    ],
  ],
  [
    1024,
    1024,
    [
      defaultOperation("levels"),
      defaultOperation("curves"),
      defaultOperation("exposure"),
      defaultOperation("vibrance"),
      { kind: "gaussian", radius: 4 },
      { kind: "box", radius: 32 },
      defaultOperation("unsharp"),
      defaultOperation("motion"),
      defaultOperation("median"),
      defaultOperation("edges"),
      defaultOperation("denoise"),
    ],
  ],
  [
    2000,
    2000,
    [
      defaultOperation("levels"),
      defaultOperation("curves"),
      defaultOperation("exposure"),
      defaultOperation("vibrance"),
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
        "Single timed runs after optional GC, process RSS includes runtime/allocator retention; not browser heap or Android measurements. Pixel loops only, PNG/decode excluded.",
    },
    null,
    2,
  ),
);
