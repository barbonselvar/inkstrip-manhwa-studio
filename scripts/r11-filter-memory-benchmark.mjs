/** Peak memory of whole-plane versus R10 halo-tiled Smart Filters. Every case runs
 * in its own child process, so the reported peak is that one algorithm's resident
 * high-water mark above its already-allocated input, not a shared-process sample.
 * Output equality is checked by SHA-256 over the complete RGBA result. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);

if (process.argv[2] === "--case") {
  const { processSmart } = await import("../src/lib/studio/pro/smart-filters.ts");
  const { processSmartTiled } = await import("../src/lib/studio/pro/smart-tiles.ts");
  const [width, height] = process.argv[3].split("x").map(Number),
    operation = JSON.parse(process.argv[4]),
    mode = process.argv[5];
  const input = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < input.length; i++) input[i] = i % 4 === 3 ? 255 : (i * 37) % 256;
  // Fault the input pages in before the baseline so only the filter's own work counts.
  let touch = 0;
  for (let i = 0; i < input.length; i += 4096) touch += input[i];
  globalThis.gc?.();
  const baseKiB = process.resourceUsage().maxRSS,
    start = performance.now(),
    out =
      mode === "whole"
        ? processSmart(input, width, height, operation)
        : await processSmartTiled(input, width, height, operation, { checkpoint: async () => {} }),
    ms = performance.now() - start,
    peakKiB = process.resourceUsage().maxRSS;
  console.log(
    JSON.stringify({
      ms,
      inputMiB: input.byteLength / 2 ** 20,
      peakAboveInputMiB: (peakKiB - baseKiB) / 1024,
      sha256: createHash("sha256").update(out).digest("hex"),
      touch: touch > -1,
    }),
  );
  process.exit(0);
}

const runs = Number(process.argv[2] ?? 3),
  sizes = ["1080x1920", "1080x3700"],
  operations = [
    { kind: "gaussian", radius: 1 },
    { kind: "gaussian", radius: 2 },
    { kind: "median", radius: 1 },
  ],
  percentile = (values, p) => {
    const s = [...values].sort((a, b) => a - b),
      i = (s.length - 1) * p,
      lo = Math.floor(i);
    return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
  },
  results = [];
for (const size of sizes)
  for (const operation of operations) {
    const row = { size, operation, runs };
    for (const mode of ["whole", "tiled"]) {
      const samples = [];
      for (let r = 0; r < runs; r++)
        samples.push(
          JSON.parse(
            execFileSync(
              process.execPath,
              [
                "--expose-gc",
                "--experimental-strip-types",
                "--no-warnings",
                self,
                "--case",
                size,
                JSON.stringify(operation),
                mode,
              ],
              { encoding: "utf8" },
            ).trim(),
          ),
        );
      assert.equal(new Set(samples.map((s) => s.sha256)).size, 1, "deterministic output");
      row[mode] = {
        sha256: samples[0].sha256,
        inputMiB: samples[0].inputMiB,
        peakAboveInputMiB: {
          p50: percentile(
            samples.map((s) => s.peakAboveInputMiB),
            0.5,
          ),
          max: Math.max(...samples.map((s) => s.peakAboveInputMiB)),
        },
        ms: {
          p50: percentile(
            samples.map((s) => s.ms),
            0.5,
          ),
          p95: percentile(
            samples.map((s) => s.ms),
            0.95,
          ),
        },
      };
    }
    row.identical = row.whole.sha256 === row.tiled.sha256;
    assert.ok(row.identical, `${size} ${operation.kind} tiled output must equal whole-plane`);
    results.push(row);
    console.log(
      `${size} ${operation.kind}(${operation.radius}) whole ${row.whole.peakAboveInputMiB.p50.toFixed(1)} MiB / tiled ${row.tiled.peakAboveInputMiB.p50.toFixed(1)} MiB, identical ${row.identical}`,
    );
  }
await mkdir("/workspace/r11-evidence", { recursive: true });
await writeFile(
  "/workspace/r11-evidence/filter-memory.json",
  JSON.stringify({ node: process.version, results }, null, 2),
);
