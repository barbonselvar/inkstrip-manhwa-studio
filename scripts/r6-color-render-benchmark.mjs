/** Local real-worker source extraction, native pixel processing and masked multilayer export. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  page = await browser.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  const results = await page.evaluate(async () => {
    const { ProRenderer } = await import("/src/lib/studio/pro/client.ts"),
      { fromPanel } = await import("/src/lib/studio/pro/model.ts"),
      { prepareColorCommit } = await import("/src/lib/studio/pro/color-transaction.ts");
    const results = [];
    for (const size of [128, 1024, 2000]) {
      const c = new OffscreenCanvas(size, size),
        ctx = c.getContext("2d"),
        image = ctx.createImageData(size, size);
      for (let p = 0; p < image.data.length; p += 4)
        image.data.set([(p / 4) % 256, (p / size / 4) % 256, 120, p % 20 === 0 ? 128 : 255], p);
      ctx.putImageData(image, 0, 0);
      const source = await c.convertToBlob({ type: "image/png" }),
        d = fromPanel({ id: "bench", name: "bench", width: size, height: size }),
        target = d.layers[0];
      target.mask = {
        enabled: true,
        inverted: false,
        strokes: [],
        density: 0.7,
        feather: 4,
        selection: {
          regions: [
            {
              kind: "rectangle",
              points: [
                { x: 0, y: 0 },
                { x: size * 0.8, y: size },
              ],
              operation: "add",
            },
          ],
          inverted: false,
          feather: 2,
        },
      };
      d.layers.push(
        { ...structuredClone(target), id: "copy1", opacity: 0.3 },
        { ...structuredClone(target), id: "copy2", opacity: 0.2 },
      );
      const session = {
          document: d,
          assets: { source },
          revision: 0,
          acceptedBlobId: "bench",
          updatedAt: 0,
        },
        renderer = new ProRenderer();
      await renderer.init(session, 16777216);
      const start = performance.now(),
        raw = await renderer.colorSource(d, 16777216, target.id),
        sourceMs = performance.now() - start;
      const processed = await new Promise((resolve, reject) => {
        const worker = new Worker("/src/lib/studio/pro/color-worker.ts", { type: "module" }),
          start = performance.now();
        worker.onmessage = ({ data }) => {
          worker.terminate();
          if (data.error) reject(Error(data.error));
          else resolve({ ...data, wallMs: performance.now() - start });
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(Error(e.message));
        };
        worker.postMessage({
          source: raw.blob,
          operation: { kind: "gaussian", radius: 1 },
          maxArea: 16777216,
        });
      });
      const next = prepareColorCommit(
        session,
        d,
        d,
        target.id,
        processed.blob,
        "processed",
        "original",
        16777216,
      );
      await renderer.init(next, 16777216);
      const exportStart = performance.now(),
        r = await renderer.export(next.document, 16777216, "image/png", 1, () => {}),
        exportMs = performance.now() - exportStart,
        b = await createImageBitmap(r.blob);
      if (b.width !== size || b.height !== size) throw Error("export size mismatch");
      b.close();
      renderer.dispose();
      c.width = c.height = 1;
      results.push({
        size,
        layers: next.document.layers.length,
        maskedLayers: next.document.layers.filter((l) => l.mask).length,
        sourceMs,
        filterPixelMs: processed.milliseconds,
        filterWorkerWallMs: processed.wallMs,
        exportMs,
        sourceBytes: source.size,
        processedBytes: processed.blob.size,
        exportBytes: r.blob.size,
      });
    }
    return results;
  });
  assert.deepEqual(errors, []);
  await mkdir("/workspace/r6-evidence", { recursive: true });
  await writeFile(
    "/workspace/r6-evidence/render-benchmark.json",
    JSON.stringify(
      {
        results,
        errors,
        notes:
          "Single Chromium desktop runs on shared executor, real native PNG decode/encode, three visible masked layers plus hidden original. No phone hardware or reliable total browser memory measurement.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
