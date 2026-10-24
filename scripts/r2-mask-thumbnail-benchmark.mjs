/** Source-module QA target only. Controlled desktop mask frame, no imported/decoded artwork. */
import assert from "node:assert/strict";
import { cpus, availableParallelism } from "node:os";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080",
  output = process.argv[3] ?? "/workspace/screenshots/r2-mask-thumbnail-benchmark.json";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const p = await browser.newPage();
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).waitFor();
  const result = await p.evaluate(async () => {
    const { layer } = await import("/src/lib/studio/pro/model.ts"),
      { layerMaskCanvas } = await import("/src/lib/studio/pro/render.ts"),
      { maskThumbnailScale } = await import("/src/lib/studio/pro/thumbnails.ts");
    const l = layer("paint", 1, 1, "bounded");
    l.mask = {
      enabled: true,
      width: 4096,
      height: 4096,
      strokes: [],
      selection: { regions: [], inverted: true, feather: 0 },
    };
    const Native = OffscreenCanvas;
    let allocations = [];
    window.OffscreenCanvas = new Proxy(Native, {
      construct(target, args) {
        allocations.push([args[0], args[1]]);
        return Reflect.construct(target, args);
      },
    });
    const measurements = [];
    try {
      for (let run = 0; run < 5; run++)
        for (const mode of ["prior-layer-only-scale", "bounded-mask-plane-scale"]) {
          allocations = [];
          const scale =
              mode === "prior-layer-only-scale"
                ? Math.min(1, 96 / l.width, 72 / l.height)
                : maskThumbnailScale(l),
            begin = performance.now();
          const c = await layerMaskCanvas(l, scale),
            pixel = [...c.getContext("2d").getImageData(0, 0, 1, 1).data];
          measurements.push({
            run,
            mode,
            scale,
            wallMs: performance.now() - begin,
            largestRequestedSurfacePixels: Math.max(...allocations.map(([w, h]) => w * h)),
            pixel,
            allocations,
          });
          c.width = c.height = 1;
        }
    } finally {
      window.OffscreenCanvas = Native;
    }
    return {
      measurements,
      method:
        "Five interleaved runs of the same current mask compositor, comparing the exact prior scale formula with R2. First iteration cold; imports excluded. Requested surface capacity is not measured peak RAM/GPU allocation.",
    };
  });
  for (const m of result.measurements) {
    assert.deepEqual(m.pixel, [255, 255, 255, 255]);
    assert.equal(
      m.largestRequestedSurfacePixels,
      m.mode === "prior-layer-only-scale" ? 4096 * 4096 : 72 * 72,
    );
  }
  result.environment = {
    cpu: cpus()[0]?.model,
    availableCPUs: availableParallelism(),
    node: process.version,
    chromium: browser.version(),
    sharedLinux: true,
  };
  result.peakMemory = "not measured";
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
