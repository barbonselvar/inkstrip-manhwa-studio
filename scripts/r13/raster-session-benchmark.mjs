/** R13 Raster long-session benchmark (real UI, real renderer and IndexedDB autosave).
 * Loads documents with N recorded brush strokes (the native model keeps strokes as
 * replayable commands, capped at 100k points), then measures main-thread long-task
 * time and wall latency caused by undo, redo and a real brush stroke, including the
 * 500 ms debounced autosave. Usage: node --experimental-strip-types
 * scripts/r13/raster-session-benchmark.mjs [base] [runs] [out.json] */
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../../src/lib/studio/pro/model.ts";
import { DAB_DEFAULTS } from "../../src/lib/studio/pro/brush-dynamics.ts";
import { proBrowserFixtures } from "../pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
const runs = Number(process.argv[3] ?? 3);
const out = process.argv[4];
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
const fx = proBrowserFixtures(base, errors);
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y),
    i = (s.length - 1) * p,
    lo = Math.floor(i);
  return +(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)).toFixed(1);
};
function documentWith(strokes, points) {
  const d = fromPanel({ id: "bench", name: "Bench", width: 128, height: 96 });
  const layers = Math.max(1, Math.ceil(strokes / 900));
  for (let l = 0; l < layers; l++) {
    const paint = layer("paint", 128, 96, `Paint ${l + 1}`);
    paint.strokes = Array.from({ length: Math.round(strokes / layers) }, (_, i) => ({
      points: Array.from({ length: points }, (_, k) => ({
        x: 4 + ((k * 0.8) % 120),
        y: 4 + ((i * 0.37) % 88),
      })),
      size: 3,
      hardness: 0.8,
      opacity: 0.4,
      flow: 0.5,
      color: "#a4efd6",
      erase: false,
      dynamics: { ...DAB_DEFAULTS },
      seed: i + 1,
    }));
    d.layers.push(paint);
  }
  return d;
}
async function watch(p, action, settle) {
  await p.evaluate(() => {
    window.__lt = [];
    window.__po?.disconnect();
    window.__po = new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => window.__lt.push(e.duration)),
    );
    window.__po.observe({ type: "longtask" });
  });
  const t0 = Date.now();
  await action();
  await settle();
  const wall = Date.now() - t0;
  // Let the 500 ms autosave debounce and its IndexedDB write run inside the window.
  await p
    .waitForFunction(() => !document.querySelector('[data-save-state="saving"]'), null, {
      timeout: 30000,
    })
    .catch(() => {});
  await p.waitForTimeout(1200);
  const long = await p.evaluate(() => window.__lt.reduce((a, b) => a + b, 0));
  return { wall, long };
}
const report = {};
for (const [label, strokes, points] of [
  ["light (50×60 pts)", 50, 60],
  ["heavy (900×100 pts)", 900, 100],
]) {
  const rows = {
    open: [],
    undo: [],
    redo: [],
    stroke: [],
    undoLong: [],
    redoLong: [],
    strokeLong: [],
  };
  for (let r = 0; r < runs; r++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const p = await context.newPage();
    p.setDefaultTimeout(120000);
    const source = await fx.start(p);
    await fx.open(p);
    const opened = Date.now();
    await fx.load(p, documentWith(strokes, points), source);
    await p.waitForFunction(
      () =>
        document
          .querySelector('canvas[aria-label="Pro composite preview"]')
          ?.getAttribute("aria-busy") === "false",
    );
    rows.open.push(Date.now() - opened);
    await p.waitForTimeout(1500);
    const items = () => p.locator(".pro-history-list li").count();
    const current = () =>
      p.evaluate(() =>
        [...document.querySelectorAll(".pro-history-list li")].findIndex(
          (li) => li.dataset.current === "true",
        ),
      );
    for (let i = 0; i < 3; i++) {
      const before = await current();
      const u = await watch(
        p,
        () => p.getByRole("button", { name: "Undo", exact: true }).click(),
        () =>
          p.waitForFunction(
            (b) =>
              [...document.querySelectorAll(".pro-history-list li")].findIndex(
                (li) => li.dataset.current === "true",
              ) ===
              b - 1,
            before,
          ),
      );
      rows.undo.push(u.wall);
      rows.undoLong.push(u.long);
      const v = await watch(
        p,
        () => p.getByRole("button", { name: "Redo", exact: true }).click(),
        () =>
          p.waitForFunction(
            (b) =>
              [...document.querySelectorAll(".pro-history-list li")].findIndex(
                (li) => li.dataset.current === "true",
              ) === b,
            before,
          ),
      );
      rows.redo.push(v.wall);
      rows.redoLong.push(v.long);
    }
    await p.getByRole("button", { name: "Brush tool", exact: true }).click();
    for (let i = 0; i < 3; i++) {
      const n = await items();
      const box = await fx.artboardBounds(p);
      const s = await watch(
        p,
        async () => {
          await p.mouse.move(box.x + box.width * 0.2, box.y + box.height * (0.3 + i * 0.1));
          await p.mouse.down();
          await p.mouse.move(box.x + box.width * 0.8, box.y + box.height * (0.3 + i * 0.1), {
            steps: 12,
          });
          await p.mouse.up();
        },
        () =>
          p.waitForFunction(
            (n) => document.querySelectorAll(".pro-history-list li").length >= Math.min(51, n + 1),
            n,
          ),
      );
      rows.stroke.push(s.wall);
      rows.strokeLong.push(s.long);
    }
    await context.close();
  }
  report[label] = Object.fromEntries(
    Object.entries(rows).map(([k, v]) => [k, { p50: pct(v, 0.5), p95: pct(v, 0.95), n: v.length }]),
  );
  console.log(label, JSON.stringify(report[label]));
}
await browser.close();
if (errors.length) console.log("page errors:", errors.slice(0, 5));
if (out) await writeFile(out, JSON.stringify({ base, runs, report, errors }, null, 2));
