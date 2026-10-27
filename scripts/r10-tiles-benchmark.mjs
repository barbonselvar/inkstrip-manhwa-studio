import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { processSmart } from "../src/lib/studio/pro/smart-filters.ts";
import { processSmartTiled, smartTilePlan } from "../src/lib/studio/pro/smart-tiles.ts";
const results = [];
for (const [width, height] of [
  [512, 512],
  [1080, 1920],
  [2000, 2000],
]) {
  const input = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (i * 37) % 256,
    ),
    operation = { kind: "gaussian", radius: 1 };
  const before = process.memoryUsage(),
    start = performance.now(),
    whole = processSmart(input, width, height, operation),
    wholeMs = performance.now() - start,
    wholeMemory = process.memoryUsage(),
    tileStart = performance.now();
  let checkpoints = 0;
  const tiled = await processSmartTiled(input, width, height, operation, {
      checkpoint: async () => {
        checkpoints++;
      },
    }),
    tileMs = performance.now() - tileStart,
    after = process.memoryUsage();
  assert.deepEqual(tiled, whole);
  const plan = smartTilePlan(width, height, operation),
    maxTilePixels = Math.max(...plan.tiles.map((t) => (t.right - t.left) * (t.bottom - t.top)), 0);
  results.push({
    width,
    height,
    wholeMs,
    tileMs,
    tileCount: plan.tiles.length,
    maxTilePixels,
    checkpoints,
    pixelTolerance: 0,
    processMemorySamples: { before, afterWhole: wholeMemory, afterTiles: after },
    note: "Node process memory samples, not isolated GPU or algorithm peak; original and both outputs retained for comparison",
  });
}
await writeFile(
  "/workspace/r10-evidence/tiles-benchmark.json",
  JSON.stringify({ results, node: process.version }, null, 2),
);
console.log(JSON.stringify(results, null, 2));
