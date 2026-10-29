import { test } from "node:test";
import assert from "node:assert/strict";
import { processSmart, defaultSmartOperation, type SmartOperation } from "./smart-filters.ts";
import { processSmartTiled, smartTilePlan, tiledStackWithinBudget } from "./smart-tiles.ts";
const width = 81,
  height = 67,
  source = Uint8ClampedArray.from(
    { length: width * height * 4 },
    (_, i) => (i * 37 + (i >> 7) * 19) % 256,
  );
const operations: SmartOperation[] = [
  { kind: "gaussian", radius: 1.2 },
  { kind: "unsharp", radius: 2, amount: 1.5, threshold: 10 },
  { kind: "highPass", radius: 1.7 },
  { kind: "median", radius: 2 },
  { kind: "surface", radius: 2, threshold: 50 },
  { kind: "edgeDetect", method: "sobel", strength: 1.8 },
  { kind: "edgeDetect", method: "laplacian", strength: 2 },
];
for (const operation of operations)
  test(`halo tiles preserve exact ${operation.kind} pixels, alpha and border behavior`, async () => {
    const original = source.slice(),
      progress: number[] = [];
    const result = await processSmartTiled(source, width, height, operation, {
      tileSize: 16,
      checkpoint: async () => {},
      progress: (done, total) => {
        assert.ok(done <= total);
        progress.push(done);
      },
    });
    assert.deepEqual(result, processSmart(source, width, height, operation));
    assert.deepEqual(source, original);
    assert.equal(progress.length, 30);
    assert.equal(progress.at(-1), 30);
  });
test("nonlocal, seeded and fractional-sampling algorithms keep the exact original path", async () => {
  for (const kind of ["radial", "grain", "motion", "emboss"] as const) {
    const op = defaultSmartOperation(kind);
    assert.equal(smartTilePlan(width, height, op, 16).tiles.length, 0);
    assert.deepEqual(
      await processSmartTiled(source, width, height, op, { checkpoint: async () => {} }),
      processSmart(source, width, height, op),
    );
  }
});
test("tile cancellation returns no partial result and leaves source untouched", async () => {
  const controller = new AbortController(),
    original = source.slice();
  let checkpoints = 0;
  await assert.rejects(
    processSmartTiled(source, width, height, operations[0]!, {
      tileSize: 16,
      signal: controller.signal,
      checkpoint: async () => {
        if (++checkpoints === 4) controller.abort();
      },
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(source, original);
});
test("native safety budgets and halo-overhead work remain enforced", async () => {
  for (const edge of [0, 15, 513, Infinity])
    assert.throws(() => smartTilePlan(width, height, operations[0]!, edge));
  assert.throws(() => smartTilePlan(1080, 5000, operations[0]!));
  assert.throws(() => smartTilePlan(2000, 2000, { kind: "gaussian", radius: 64 }));
  assert.equal(
    smartTilePlan(2000, 2000, { kind: "gaussian", radius: 2.3 }).tiles.length,
    0,
    "halo overhead falls back inside the unchanged128M work ceiling",
  );
  assert.equal(
    tiledStackWithinBudget(128, 128, [{ id: "a", enabled: true, operation: operations[0]! }]),
    true,
  );
  await assert.rejects(processSmartTiled(new Uint8ClampedArray(0), width, height, operations[0]!));
});
