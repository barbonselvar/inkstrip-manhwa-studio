/** R14 extension of R13's held-out gallery evaluation. Same actual editor worker;
 * PSNR is a reconstruction metric, not proof of identity or perceptual superiority. */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
let peak = 0;
const sample = () => {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,rss="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((r) => r.trim().split(/\s+/).map(Number)),
    ids = new Set([process.pid]);
  let more = true;
  while (more) {
    more = false;
    for (const [id, parent] of rows)
      if (ids.has(parent) && !ids.has(id)) {
        ids.add(id);
        more = true;
      }
  }
  peak = Math.max(peak, rows.reduce((n, [id, _p, rss]) => n + (ids.has(id) ? rss : 0), 0) / 1024);
};
const timer = setInterval(sample, 250),
  browser = await chromium.launch({
    args: ["--no-sandbox"],
    ...(process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } }
      : {}),
  });
await mkdir("/workspace/screenshots", { recursive: true });
try {
  const p = await browser.newPage();
  p.setDefaultTimeout(900000);
  p.on("requestfailed", (request) =>
    console.log("NETWORK", new URL(request.url()).hostname, request.failure()?.errorText),
  );
  p.on("console", (message) => {
    if (message.type() === "error") console.log("BROWSER", message.text().slice(0, 300));
  });
  p.on("console", (m) => {
    if (m.text().startsWith("R14AI ")) console.log(m.text());
  });
  await p.goto(new URL("/gallery/provenance.json", base).href);
  const result = await p.evaluate(async () => {
    const { EnhancementEngine } = await import("/src/lib/studio/enhance/client.ts"),
      engine = new EnhancementEngine(),
      rows = [],
      images = [];
    const image = async (blob) => {
      const b = await createImageBitmap(blob),
        c = new OffscreenCanvas(b.width, b.height);
      c.getContext("2d").drawImage(b, 0, 0);
      b.close();
      return c;
    };
    const resize = (src, w, h) => {
      const c = new OffscreenCanvas(w, h),
        ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, w, h);
      return c;
    };
    const metrics = (truth, got) => {
      const a = truth.getContext("2d").getImageData(0, 0, 256, 256).data,
        b = got.getContext("2d").getImageData(0, 0, 256, 256).data;
      let se = 0,
        mae = 0,
        edges = 0;
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) {
          const i = (y * 256 + x) * 4,
            l = (v, p) => 0.299 * v[p] + 0.587 * v[p + 1] + 0.114 * v[p + 2],
            d = l(a, i) - l(b, i);
          se += d * d;
          for (let c = 0; c < 3; c++) mae += Math.abs(a[i + c] - b[i + c]);
          if (x > 0) edges += Math.abs(l(a, i) - l(a, i - 4) - (l(b, i) - l(b, i - 4)));
        }
      return {
        psnrY: 10 * Math.log10(255 ** 2 / (se / 65536)),
        rgbMAE: mae / (65536 * 3),
        horizontalEdgeMAE: edges / (256 * 255),
      };
    };
    try {
      for (const name of [
        "action",
        "manga",
        "romance",
        "murim",
        "fantasy",
        "medieval",
        "horror",
        "scifi",
        "adventure",
      ]) {
        const full = await image(await (await fetch(`/gallery/${name}-720.webp`)).blob()),
          truth = new OffscreenCanvas(256, 256);
        truth
          .getContext("2d")
          .drawImage(
            full,
            (full.width - 256) / 2,
            (full.height - 256) / 2,
            256,
            256,
            0,
            0,
            256,
            256,
          );
        const low = resize(truth, 128, 128),
          blob = await low.convertToBlob(),
          row = {
            name,
            input: [128, 128],
            output: [256, 256],
            bicubic: metrics(truth, resize(low, 256, 256)),
          };
        const saved = {
          name,
          truth: await truth.convertToBlob(),
          bicubic: await resize(low, 256, 256).convertToBlob(),
        };
        for (const model of ["swin2sr", "realesrgan-anime"]) {
          const start = performance.now(),
            result = await engine.run(
              blob,
              { model, scale: 2, denoise: 0, sharpen: 0, color: false, artifacts: false },
              () => {},
            ),
            canvas = await image(result.blob);
          row[model] = { ...metrics(truth, canvas), ms: performance.now() - start };
          saved[model] = result.blob;
        }
        if (images.length < 3) images.push(saved);
        rows.push(row);
        console.log("R14AI " + JSON.stringify(row));
      }
    } finally {
      engine.dispose();
    }
    const toData = async (blob) =>
      new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(blob);
      });
    const gallery = [];
    for (const item of images) {
      const row = { name: item.name };
      for (const k of ["truth", "bicubic", "swin2sr", "realesrgan-anime"])
        row[k] = await toData(item[k]);
      gallery.push(row);
    }
    return {
      rows,
      gallery,
      note: "Centre crops of nine original gallery artworks, 128→256; single-thread WASM. Includes model preparation for each switch. Metrics do not establish identity consistency.",
    };
  });
  const gallery = result.gallery;
  delete result.gallery;
  result.sampledProcessTreePeakRssMiB = peak;
  result.memoryNote =
    "250ms samples of Node/Chromium descendants, includes QA/browser infrastructure, not isolated WASM/GPU peaks.";
  await writeFile(
    "/workspace/r14-evidence/quality-benchmark.json",
    JSON.stringify(result, null, 2),
  );
  for (const row of gallery) {
    await p.setContent(
      `<html><body style="background:#15191a;color:white;font:14px sans-serif"><h1>${row.name}: real inference comparison</h1><div style="display:flex;gap:16px">${["truth", "bicubic", "swin2sr", "realesrgan-anime"].map((k) => `<figure style="margin:0"><figcaption>${k}</figcaption><img width="256" height="256" src="${row[k]}"></figure>`).join("")}</div></body></html>`,
    );
    await p.screenshot({ path: `/workspace/screenshots/r14-quality-${row.name}.png` });
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearInterval(timer);
  await browser.close();
}
