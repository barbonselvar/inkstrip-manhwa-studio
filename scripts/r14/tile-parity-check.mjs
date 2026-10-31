/** Real Fast Anime whole-plane vs halo-tiled output. Zero channel tolerance,
 * including the shared resampling path for 2x output. No inference is mocked. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080",
  browser = await chromium.launch({
    args: ["--no-sandbox"],
    ...(process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } }
      : {}),
  });
try {
  const p = await browser.newPage();
  p.setDefaultTimeout(180000);
  await p.goto(new URL("/gallery/provenance.json", base).href);
  const rows = await p.evaluate(async () => {
    const { EnhancementEngine } = await import("/src/lib/studio/enhance/client.ts"),
      engine = new EnhancementEngine(),
      worker = new Worker("/scripts/r14/model-evaluation-worker.ts", { type: "module" }),
      bitmap = await createImageBitmap(await (await fetch("/gallery/action-720.webp")).blob()),
      input = new OffscreenCanvas(128, 128),
      ctx = input.getContext("2d");
    ctx.drawImage(bitmap, 200, 250, 128, 128, 0, 0, 128, 128);
    bitmap.close();
    const blob = await input.convertToBlob();
    try {
      const whole = await new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) =>
            data.error ? reject(Error(data.error)) : resolve(data.blob);
          worker.onerror = (e) => reject(Error(e.message));
          worker.postMessage({ blob });
        }),
        native = await createImageBitmap(whole),
        rows = [];
      try {
        for (const scale of [4, 2]) {
          const r = await engine.run(
              blob,
              {
                model: "realesrgan-anime",
                scale,
                denoise: 0,
                sharpen: 0,
                color: false,
                artifacts: false,
              },
              () => {},
            ),
            tile = await createImageBitmap(r.blob),
            size = 128 * scale,
            a = new OffscreenCanvas(size, size),
            b = new OffscreenCanvas(size, size),
            ac = a.getContext("2d"),
            bc = b.getContext("2d");
          ac.imageSmoothingQuality = "high";
          ac.drawImage(native, 0, 0, size, size);
          bc.drawImage(tile, 0, 0);
          tile.close();
          const x = ac.getImageData(0, 0, size, size).data,
            y = bc.getImageData(0, 0, size, size).data;
          let changed = 0,
            maxDifference = 0;
          for (let i = 0; i < x.length; i++) {
            const d = Math.abs(x[i] - y[i]);
            if (d) changed++;
            maxDifference = Math.max(maxDifference, d);
          }
          rows.push({ scale, changedChannels: changed, maxDifference, pixels: size * size });
        }
      } finally {
        native.close();
      }
      return rows;
    } finally {
      engine.dispose();
      worker.terminate();
    }
  });
  await writeFile("/workspace/r14-evidence/tile-parity.json", JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows));
  for (const r of rows)
    assert.equal(
      r.changedChannels,
      0,
      "halo tiles and resampling match whole-model pixels exactly",
    );
} finally {
  await browser.close();
}
