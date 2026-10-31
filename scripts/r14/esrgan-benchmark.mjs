/** Real converted-weight evaluation. No production model selection is changed. */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080",
  out = process.argv[3] ?? "/workspace/r14-evidence/esrgan-quality.json";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(240000);
  await page.goto(base);
  const result = await page.evaluate(async () => {
    const worker = new Worker(new URL("/scripts/r14/model-evaluation-worker.ts", location.origin), {
      type: "module",
    });
    const run = (blob) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.terminate();
          reject(Error("Candidate inference exceeded 120 seconds."));
        }, 120000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          if (data.error) reject(Error(data.error));
          else resolve(data);
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          reject(Error(e.message));
        };
        worker.postMessage({ blob });
      });
    const rows = [];
    try {
      for (const name of ["action", "manga", "romance"]) {
        const bitmap = await createImageBitmap(
            await (await fetch(`/gallery/${name}-720.webp`)).blob(),
          ),
          truth = new OffscreenCanvas(256, 256),
          tc = truth.getContext("2d");
        tc.drawImage(
          bitmap,
          (bitmap.width - 256) / 2,
          (bitmap.height - 256) / 2,
          256,
          256,
          0,
          0,
          256,
          256,
        );
        bitmap.close();
        const low = new OffscreenCanvas(128, 128),
          lc = low.getContext("2d");
        lc.imageSmoothingQuality = "high";
        lc.drawImage(truth, 0, 0, 128, 128);
        const r = await run(await low.convertToBlob()),
          restored = await createImageBitmap(r.blob),
          preview = new OffscreenCanvas(256, 256),
          pc = preview.getContext("2d");
        pc.imageSmoothingQuality = "high";
        pc.drawImage(restored, 0, 0, 256, 256);
        restored.close();
        const a = tc.getImageData(0, 0, 256, 256).data,
          b = pc.getImageData(0, 0, 256, 256).data;
        let se = 0;
        for (let p = 0; p < a.length; p += 4) {
          const y =
            0.299 * (a[p] - b[p]) + 0.587 * (a[p + 1] - b[p + 1]) + 0.114 * (a[p + 2] - b[p + 2]);
          se += y * y;
        }
        const row = {
          name,
          input: [128, 128],
          nativeOutput: [512, 512],
          comparisonOutput: [256, 256],
          psnrY: 10 * Math.log10(255 ** 2 / (se / 256 ** 2)),
          modelLoadMs: r.modelLoadMs,
          inferenceMs: r.inferenceMs,
        };
        rows.push(row);
        console.log("R14ESR " + JSON.stringify(row));
      }
    } finally {
      worker.terminate();
    }
    return {
      model:
        "tidus2102/Real-ESRGAN@c9a1cd990b587ccf20be2373fad8eb021e24ab01/RealESR-AnimeVideo-v3_x4.onnx",
      note: "Converted third-party artifact; output reduced to 2x for same-input comparison. Not adopted.",
      rows,
    };
  });
  await writeFile(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
