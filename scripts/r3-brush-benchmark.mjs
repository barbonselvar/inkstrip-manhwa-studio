/** R3 brush benchmark in Chromium: real stroke() rasterization and real sample
 * recording. Synthetic fixtures on this machine; not a universal FPS claim. */
import { writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const p = await browser.newPage();
await p.goto(base, { waitUntil: "networkidle" });
const run = () =>
  p.evaluate(async () => {
    const { stroke } = await import("/src/lib/studio/pro/render.ts");
    const { appendBrushSample, finishBrushStroke, DAB_DEFAULTS } =
      await import("/src/lib/studio/pro/brush-dynamics.ts");
    const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const time = (fn, n = 5) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        fn();
        out.push(performance.now() - t);
      }
      return Math.round(median(out) * 10) / 10;
    };
    const canvas = new OffscreenCanvas(2048, 2048),
      ctx = canvas.getContext("2d");
    const render = (s) => () => {
      ctx.clearRect(0, 0, 2048, 2048);
      stroke(ctx, s);
      ctx.getImageData(0, 0, 1, 1); // flush
    };
    // 10 s of a 1 kHz mouse drawing a 1,600 px wave: 10,000 raw samples.
    const raw = Array.from({ length: 10_000 }, (_, i) => ({
      x: 200 + i * 0.16,
      y: 1024 + Math.sin(i / 600) * 400,
      time: i,
    }));
    const recordAll = (base) => ({ ...base, points: raw.map(({ x, y }) => ({ x, y })) });
    const recordR3 = (base) => {
      const s = { ...base, points: [{ x: raw[0].x, y: raw[0].y }] };
      let filtered;
      const t = performance.now();
      for (const p of raw.slice(1))
        filtered = appendBrushSample(s, filtered, p, {
          pointerType: "mouse",
          pressure: 0.5,
        }).filtered;
      finishBrushStroke(s, filtered, raw.at(-1));
      return {
        s,
        perSampleUs: Math.round(((performance.now() - t) / raw.length) * 1000 * 100) / 100,
      };
    };
    const brushes = {
      "default brush 24px (legacy path)": {
        size: 24,
        hardness: 0.8,
        opacity: 1,
        flow: 1,
        color: "#000000",
        erase: false,
      },
      "hard 8px (dab path)": {
        size: 8,
        hardness: 1,
        opacity: 1,
        flow: 1,
        color: "#000000",
        erase: false,
        dynamics: { ...DAB_DEFAULTS },
      },
      "soft 200px flow 0.2 opacity 0.6 (dab path)": {
        size: 200,
        hardness: 0,
        opacity: 0.6,
        flow: 0.2,
        color: "#000000",
        erase: false,
        dynamics: { ...DAB_DEFAULTS },
      },
    };
    const results = {};
    for (const [name, b] of Object.entries(brushes)) {
      const all = recordAll(b),
        { s, perSampleUs } = recordR3(b);
      results[name] = {
        rawSamples: raw.length,
        storedBefore: all.points.length,
        storedR3: s.points.length,
        recordUsPerSample: perSampleUs,
        renderMsBefore: time(render(all)),
        renderMsR3: time(render(s)),
      };
    }
    return results;
  });
let results;
try {
  results = await run();
} catch (e) {
  if (!/context was destroyed/.test(e.message)) throw e;
  await p.waitForLoadState("networkidle");
  results = await run();
}
const report = {
  environment: {
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    browser: `Chromium ${browser.version()} headless`,
    canvas: "2048×2048 OffscreenCanvas 2D, median of 5",
  },
  results,
};
await writeFile("/workspace/screenshots/r3-brush-benchmark.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await browser.close();
