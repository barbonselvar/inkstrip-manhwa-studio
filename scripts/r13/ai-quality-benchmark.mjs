/** R13 AI quality benchmark: real Swin2SR inference through the app's own
 * EnhancementEngine/worker (dev server module graph), on Inkstrip's nine original
 * manhwa-style gallery illustrations. Each 720x960 artwork is halved, then restored 2x
 * and compared with the original: PSNR on luma (Y, BT.601), plus a bicubic baseline
 * (canvas, imageSmoothingQuality "high"). Needs network access to huggingface.co for
 * the pinned model weights. Nothing is mocked: if the model cannot load, it fails.
 * Usage: node scripts/r13/ai-quality-benchmark.mjs [dev-base] [out.json] */
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
const out = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const p = await browser.newPage();
p.setDefaultTimeout(600000);
await p.goto(base);
// A dev server may re-optimize dependencies on first use and reload the page; retry once.
async function evaluateOnce(fn) {
  try {
    return await p.evaluate(fn);
  } catch (error) {
    if (!/Execution context was destroyed|navigation/i.test(String(error))) throw error;
    await p.waitForLoadState("load");
    await p.waitForTimeout(2000);
    return p.evaluate(fn);
  }
}
const result = await evaluateOnce(async () => {
  const { EnhancementEngine } = await import("/src/lib/studio/enhance/client.ts");
  const names = [
    "action",
    "adventure",
    "fantasy",
    "horror",
    "manga",
    "medieval",
    "murim",
    "romance",
    "scifi",
  ];
  const pixels = async (blob) => {
    const bitmap = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    return c.getContext("2d").getImageData(0, 0, c.width, c.height);
  };
  const resize = async (image, w, h) => {
    const src = new OffscreenCanvas(image.width, image.height);
    src.getContext("2d").putImageData(image, 0, 0);
    const dst = new OffscreenCanvas(w, h),
      ctx = dst.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    return {
      image: ctx.getImageData(0, 0, w, h),
      blob: await dst.convertToBlob({ type: "image/png" }),
    };
  };
  const psnrY = (a, b) => {
    let se = 0;
    const n = a.width * a.height;
    for (let i = 0; i < n * 4; i += 4) {
      const ya = 0.299 * a.data[i] + 0.587 * a.data[i + 1] + 0.114 * a.data[i + 2];
      const yb = 0.299 * b.data[i] + 0.587 * b.data[i + 1] + 0.114 * b.data[i + 2];
      se += (ya - yb) ** 2;
    }
    return +(10 * Math.log10((255 * 255) / (se / n))).toFixed(2);
  };
  const engine = new EnhancementEngine();
  const presets = {
    fidelity: { scale: 2, denoise: 0, sharpen: 0, color: false, artifacts: false },
    appDefault: { scale: 2, denoise: 15, sharpen: 15, color: false, artifacts: true },
  };
  const rows = [];
  let modelLoadMs = 0;
  for (const name of names) {
    const truth = await pixels(await (await fetch(`/gallery/${name}-720.webp`)).blob());
    const low = await resize(truth, truth.width / 2, truth.height / 2);
    const bicubic = (await resize(low.image, truth.width, truth.height)).image;
    const row = {
      name,
      size: `${low.image.width}x${low.image.height} -> ${truth.width}x${truth.height}`,
      bicubic: psnrY(bicubic, truth),
    };
    for (const [preset, options] of Object.entries(presets)) {
      if (preset === "appDefault" && rows.length >= 3) continue;
      const t0 = performance.now();
      const enhanced = await engine.run(low.blob, options, () => {});
      const ms = performance.now() - t0;
      if (!modelLoadMs) modelLoadMs = Math.round(ms);
      else row[`${preset}Ms`] = Math.round(ms);
      const image = await pixels(enhanced.blob);
      if (image.width !== truth.width || image.height !== truth.height)
        throw Error(`${name}: wrong output size`);
      row[preset] = psnrY(image, truth);
    }
    rows.push(row);
  }
  engine.dispose();
  const mean = (k) =>
    +(
      rows.filter((r) => r[k] !== undefined).reduce((s, r) => s + r[k], 0) /
      rows.filter((r) => r[k] !== undefined).length
    ).toFixed(2);
  return {
    model: "Xenova/swin2SR-classical-sr-x2-64@93dfc90 (pinned)",
    firstRunIncludingModelLoadMs: modelLoadMs,
    rows,
    meanPsnrY: {
      bicubic: mean("bicubic"),
      fidelity: mean("fidelity"),
      appDefault: mean("appDefault"),
      bicubicOnDefaultSubset: +(rows.slice(0, 3).reduce((s, r) => s + r.bicubic, 0) / 3).toFixed(2),
    },
  };
});
await browser.close();
console.log(JSON.stringify(result, null, 2));
if (out) await writeFile(out, JSON.stringify(result, null, 2));
