import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import os from "node:os";
const base = "http://127.0.0.1:8080";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--enable-precise-memory-info"],
});
try {
  const page = await browser.newPage();
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).waitFor();
  const results = await page.evaluate(async () => {
    const [{ ProRenderer }, { fromPanel }, { createBubble }] = await Promise.all([
      import("/src/lib/studio/pro/client.ts"),
      import("/src/lib/studio/pro/model.ts"),
      import("/src/lib/studio/dialogue/operations.ts"),
    ]);
    const results = [];
    for (const [width, height, count] of [
      [640, 480, 12],
      [2048, 2048, 8],
      [1024, 8192, 6],
    ]) {
      const canvas = new OffscreenCanvas(width, height),
        x = canvas.getContext("2d");
      x.fillStyle = "#233e38";
      x.fillRect(0, 0, width, height);
      for (let i = 0; i < 40; i++) {
        x.strokeStyle = i % 2 ? "#a4efd6" : "#142824";
        x.lineWidth = width / 160;
        x.beginPath();
        x.moveTo(0, (height * i) / 40);
        x.lineTo(width, (height * (i + 0.5)) / 40);
        x.stroke();
      }
      const blob = await canvas.convertToBlob();
      canvas.width = canvas.height = 1;
      let d = fromPanel({ id: "bench", name: "Internally drawn fixture", width, height });
      for (let i = 0; i < count; i++) {
        d = createBubble(d, i % 2 ? "thought" : "speech").document;
        const group = d.layers.at(-3).id;
        d = {
          ...d,
          layers: d.layers.map((l) =>
            l.parentId === group
              ? {
                  ...l,
                  transform: {
                    ...l.transform,
                    x: l.transform.x + (i % 3) * width * 0.1 - width * 0.1,
                    y: l.transform.y + Math.floor(i / 3) * height * 0.18,
                  },
                }
              : l,
          ),
        };
      }
      const renderer = new ProRenderer();
      try {
        const init = performance.now();
        await renderer.init({
          document: d,
          assets: { source: blob },
          revision: 0,
          acceptedBlobId: "source",
          updatedAt: 0,
        });
        const initMs = performance.now() - init;
        const preview = performance.now(),
          image = await renderer.render(d, 16_777_216);
        image.bitmap.close();
        const previewMs = performance.now() - preview;
        const start = performance.now(),
          output = await renderer.export(d, 16_777_216, "image/png", 1, () => {});
        if (!output.blob) throw Error("No export");
        results.push({
          width,
          height,
          bubbles: count,
          layers: d.layers.length,
          initMs,
          previewMs,
          pngExportMs: performance.now() - start,
          pngBytes: output.blob.size,
          jsHeapObserved: performance.memory?.usedJSHeapSize ?? null,
        });
      } finally {
        renderer.dispose();
      }
    }
    return {
      results,
      userAgent: navigator.userAgent,
      reportedLogicalCores: navigator.hardwareConcurrency,
      deviceMemoryGB: navigator.deviceMemory ?? null,
    };
  });
  assert.equal(results.results.length, 3);
  const report = {
    ...results,
    environment: {
      cpu: os.cpus()[0]?.model,
      availableParallelism: os.availableParallelism(),
      architecture: os.arch(),
      browser: browser.version(),
    },
    method:
      "One cold renderer per synthetic striped source with real cubic bubble/text layers. Timings include compositing and PNG encoding. JS heap samples are not peak/process/GPU memory; shared host results are not device promises.",
  };
  await writeFile(
    "/workspace/screenshots/dialogue-benchmark.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
