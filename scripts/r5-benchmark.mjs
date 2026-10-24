/** Bounded real-worker selected-pixel staging and initial-pose pixel regression. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const p = await browser.newPage();
  p.on("console", (m) => console.log(m.text()));
  await p.goto(base);
  const results = await p.evaluate(async () => {
    const { ProRenderer } = await import("/src/lib/studio/pro/client.ts"),
      { fromPanel } = await import("/src/lib/studio/pro/model.ts");
    const results = [];
    for (const [width, height, alpha] of [
      [128, 96, 0.5],
      [512, 512, 1],
      [1024, 1024, 1],
      [2000, 2000, 1],
    ]) {
      const c = new OffscreenCanvas(width, height),
        ctx = c.getContext("2d"),
        g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, `rgba(20,100,220,${alpha})`);
      g.addColorStop(1, `rgba(220,30,80,${alpha})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      const blob = await c.convertToBlob({ type: "image/png" }),
        doc = fromPanel({ id: "p", name: "R5 benchmark", width, height });
      doc.background = "transparent";
      doc.layers[0].opacity = 0.73;
      doc.layers[0].blend = "multiply";
      doc.selection = {
        inverted: false,
        feather: 3,
        regions: [
          {
            kind: "ellipse",
            points: [
              { x: width * 0.2, y: height * 0.2 },
              { x: width * 0.7, y: height * 0.8 },
            ],
            operation: "add",
          },
        ],
      };
      const session = {
          document: doc,
          assets: { source: blob },
          revision: 0,
          acceptedBlobId: "b",
          updatedAt: 0,
        },
        worker = new ProRenderer();
      try {
        console.log("benchmark", width, height, "sourceBytes", blob.size);
        await worker.init(session, 4_000_000);
        const original = (await worker.export(doc, 4_000_000, "image/png", 1, () => {}, true)).blob;
        const start = performance.now(),
          staged = await worker.stageSelection(doc, 4_000_000, doc.layers[0].id),
          stageMs = performance.now() - start;
        await worker.init(
          {
            ...session,
            document: staged.document,
            assets: { ...session.assets, ...staged.assets },
          },
          4_000_000,
        );
        const restored = (
          await worker.export(staged.document, 4_000_000, "image/png", 1, () => {}, true)
        ).blob;
        async function pixels(blob) {
          const b = await createImageBitmap(blob);
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(b, 0, 0);
          b.close();
          return ctx.getImageData(0, 0, width, height).data;
        }
        const a = await pixels(original),
          b = await pixels(restored);
        let maxAlpha = 0,
          maxPremultiplied = 0;
        for (let i = 0; i < a.length; i += 4) {
          maxAlpha = Math.max(maxAlpha, Math.abs(a[i + 3] - b[i + 3]));
          for (let j = 0; j < 3; j++)
            maxPremultiplied = Math.max(
              maxPremultiplied,
              Math.abs((a[i + j] * a[i + 3]) / 255 - (b[i + j] * b[i + 3]) / 255),
            );
        }
        console.log("reassembly", width, height, maxAlpha, maxPremultiplied);
        if (maxAlpha > 1 || maxPremultiplied > 2)
          throw Error(
            `Reassembly changes appearance: alpha ${maxAlpha}, premultiplied ${maxPremultiplied}`,
          );
        const transformed = {
            ...staged.document,
            imageSize: {
              width: Math.max(1, Math.round(width / 2)),
              height: Math.max(1, Math.round(height / 2)),
              resampling: "lanczos",
            },
            layers: staged.document.layers.map((l) =>
              l.id === staged.layerId
                ? { ...l, transform: { ...l.transform, rotation: 13, scaleX: 1.1, scaleY: 1.1 } }
                : l,
            ),
          },
          exportStart = performance.now();
        const resized = await worker.export(transformed, 4_000_000, "image/png", 1, () => {}),
          transformAndLanczosExportMs = performance.now() - exportStart,
          output = await createImageBitmap(resized.blob);
        if (
          output.width !== transformed.imageSize.width ||
          output.height !== transformed.imageSize.height
        )
          throw Error("Resampled geometry export dimensions changed");
        output.close();
        results.push({
          transformAndLanczosExportMs,
          width,
          height,
          alpha,
          stageMs,
          assetBytes: Object.values(staged.assets).reduce((s, b) => s + b.size, 0),
          maxAlpha,
          maxPremultiplied,
        });
      } finally {
        worker.dispose();
        c.width = c.height = 1;
      }
    }
    return results;
  });
  await writeFile("/workspace/r5-evidence/r5-benchmark.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
