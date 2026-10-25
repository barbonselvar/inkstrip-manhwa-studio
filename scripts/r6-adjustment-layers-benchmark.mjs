/** Real-worker persistent point processing above 4MP, bounded tiles and native pixel fidelity. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
const run = promisify(execFile),
  base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const server = await chromium.launchServer({ headless: true, args: ["--no-sandbox"] }),
  browser = await chromium.connect(server.wsEndpoint()),
  page = await browser.newPage(),
  errors = [];
let peakRssKiB = 0,
  sampling = false;
const sample = async () => {
  if (sampling) return;
  sampling = true;
  try {
    const { stdout } = await run("ps", ["-eo", "pid=,ppid=,rss="]),
      rows = stdout
        .trim()
        .split("\n")
        .map((r) => r.trim().split(/\s+/).map(Number)),
      ids = new Set([server.process().pid]);
    for (let i = 0; i < 8; i++) for (const [pid, parent] of rows) if (ids.has(parent)) ids.add(pid);
    peakRssKiB = Math.max(
      peakRssKiB,
      rows.reduce((sum, [pid, , rss]) => sum + (ids.has(pid) ? rss : 0), 0),
    );
  } finally {
    sampling = false;
  }
};
const timer = setInterval(() => {
  void sample();
}, 100);
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  const results = [];
  for (const size of [512, 2000, 3000, 4096]) {
    peakRssKiB = 0;
    const result = await page.evaluate(async (size) => {
      const { ProRenderer } = await import("/src/lib/studio/pro/client.ts"),
        { fromPanel } = await import("/src/lib/studio/pro/model.ts"),
        { adjustmentDocument, createAdjustmentDraft } =
          await import("/src/lib/studio/pro/adjustment-layer.ts"),
        { nativeFile, readNative } = await import("/src/lib/studio/pro/files.ts"),
        { canonicalNative } = await import("/src/lib/studio/pro/adjustment-schema.ts");
      const max = 16_777_216,
        sourceCanvas = new OffscreenCanvas(size, size),
        ctx = sourceCanvas.getContext("2d"),
        image = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const p = (y * size + x) * 4;
          image.data[p] = x % 256;
          image.data[p + 1] = y % 256;
          image.data[p + 2] = (x + y) % 256;
          image.data[p + 3] = x % 17 ? 255 : 128;
        }
      ctx.putImageData(image, 0, 0);
      const source = await sourceCanvas.convertToBlob({ type: "image/png" });
      sourceCanvas.width = sourceCanvas.height = 1;
      let doc = fromPanel({ id: "p", name: "Large persistent", width: size, height: size });
      doc = adjustmentDocument(
        createAdjustmentDraft(doc, doc.layers[0].id, "exposure"),
        { version: 1, operation: { kind: "exposure", stops: 0.3, gamma: 1.15 } },
        max,
      );
      doc = adjustmentDocument(
        createAdjustmentDraft(doc, "exposure", "hsl"),
        {
          version: 1,
          operation: { kind: "hsl", hue: 12, saturation: 8, lightness: 2, range: "all" },
        },
        max,
      );
      doc.layers[2].opacity = 0.6;
      doc.layers[2].mask = {
        enabled: true,
        inverted: false,
        strokes: [],
        density: 0.8,
        selection: {
          regions: [
            {
              kind: "rectangle",
              points: [
                { x: 0, y: 0 },
                { x: size * 0.7, y: size },
              ],
              operation: "add",
            },
          ],
          inverted: false,
          feather: 0,
        },
      };
      const session = {
          document: doc,
          assets: { source },
          revision: 0,
          acceptedBlobId: "source",
          updatedAt: 0,
        },
        renderer = new ProRenderer(),
        timings = {};
      const time = async (name, f) => {
        const start = performance.now(),
          r = await f();
        timings[name] = performance.now() - start;
        return r;
      };
      await time("initMs", () => renderer.init(session, max));
      const preview = await time("previewMs", () => renderer.render(doc, max));
      const previewSize = [preview.bitmap.width, preview.bitmap.height];
      preview.bitmap.close();
      const histogram = await time("histogramMs", () =>
        renderer.adjustmentHistogram(doc, max, "hsl"),
      );
      if (histogram.histogram.red.reduce((a, b) => a + b, 0) <= 0)
        throw Error("Empty source histogram");
      const png = await time("exportMs", () => renderer.export(doc, max, "image/png", 1, () => {}));
      const hash = async (blob) =>
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      const pixels = async (blob) => {
        const bitmap = await createImageBitmap(blob),
          canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
          c = canvas.getContext("2d");
        if (bitmap.width !== size || bitmap.height !== size) throw Error("Artwork was resized");
        c.drawImage(bitmap, 0, 0);
        bitmap.close();
        const data = c.getImageData(0, 0, size, size).data;
        canvas.width = canvas.height = 1;
        return hash(new Blob([data]));
      };
      const firstHash = await pixels(png.blob),
        sourceHash = await hash(source),
        native = await time("nativeSaveMs", () => nativeFile(session)),
        reopened = await time("nativeReadMs", () => readNative(native, "p", "source"));
      if (
        (await hash(reopened.assets.source)) !== sourceHash ||
        canonicalNative(reopened.document.layers.map((l) => l.adjustmentLayer)) !==
          canonicalNative(doc.layers.map((l) => l.adjustmentLayer))
      )
        throw Error("Source or parameters changed");
      await renderer.init(reopened, max);
      const second = await time("reopenedExportMs", () =>
        renderer.export(reopened.document, max, "image/png", 1, () => {}),
      );
      if ((await pixels(second.blob)) !== firstHash) throw Error("Reopened composite differs");
      const formats = [];
      if (size === 512)
        for (const mime of ["image/jpeg", "image/webp"]) {
          const output = await renderer.export(reopened.document, max, mime, 0.9, () => {}),
            b = await createImageBitmap(output.blob);
          if (output.blob.type !== mime || b.width !== size || b.height !== size)
            throw Error("Raster export mismatch");
          b.close();
          formats.push(mime);
        }
      const pending = renderer.render(doc, max).then(
        (r) => {
          r.bitmap.close();
          return "completed";
        },
        (e) => e.name,
      );
      const latestDoc = structuredClone(doc);
      latestDoc.layers[2].visible = false;
      const latest = await renderer.render(latestDoc, max);
      latest.bitmap.close();
      const superseded = await pending;
      if (superseded !== "AbortError") throw Error("Stale preview was not rejected");
      renderer.dispose();
      return {
        size,
        pixels: size * size,
        pointLayers: 2,
        maskedLayers: 1,
        tileSide: 512,
        timings,
        previewSize,
        nativeBytes: native.size,
        exportBytes: png.blob.size,
        sourceBytes: source.size,
        sourceHash,
        compositeHash: firstHash,
        exactReopen: true,
        stalePreviewRejected: true,
        formats,
      };
    }, size);
    await sample();
    result.browserProcessTreePeakRssMiB = Math.round(peakRssKiB / 1024);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  await mkdir("/workspace/r6-persistent-evidence", { recursive: true });
  await writeFile(
    "/workspace/r6-persistent-evidence/benchmark.json",
    JSON.stringify(
      {
        results,
        errors,
        notes:
          "Single Chromium desktop runs on shared executor. Two persistent point layers, one large selection mask/density. Full native PNG pixels exact before/after reopen; original PNG hash unchanged. Summed process-tree RSS sampled at 100ms includes shared pages, image generation and hashing; it is a coarse resident-memory observation, not allocation accounting or mobile hardware. Preview uses existing 1400px viewport cap; native exports retain full dimensions. Destructive/spatial R6 operations retain their 4MP cap.",
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(timer);
  await browser.close();
  await server.close();
}
