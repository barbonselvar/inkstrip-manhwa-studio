/** R13 large-chapter open benchmark (real UI + IndexedDB). Imports N pages once,
 * then reloads the chapter `runs` times and measures time from navigation start
 * until every page thumbnail is displayed. Usage:
 * node scripts/r13/chapter-open-benchmark.mjs [base] [runs] [out] */
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
const runs = Number(process.argv[3] ?? 5);
const out = process.argv[4];
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y),
    i = (s.length - 1) * p,
    lo = Math.floor(i);
  return +(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)).toFixed(1);
};
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const report = {};
for (const pages of [20, 80, 160]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await context.newPage();
  p.setDefaultTimeout(240000);
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByPlaceholder("Night Market").fill(`Open ${pages}`);
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await p.getByText("Chapter workspace", { exact: true }).waitFor();
  const png = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 720;
    c.height = 1280;
    const x = c.getContext("2d");
    x.fillStyle = "#f3efe6";
    x.fillRect(0, 0, 720, 1280);
    x.fillStyle = "#243b32";
    for (let y = 0; y < 1280; y += 80) x.fillRect(60, y, 600, 40);
    return c.toDataURL().split(",")[1];
  });
  const buffer = Buffer.from(png, "base64");
  for (let start = 0; start < pages; start += 40) {
    const files = Array.from({ length: Math.min(40, pages - start) }, (_, i) => ({
      name: `p${String(start + i).padStart(3, "0")}.png`,
      mimeType: "image/png",
      buffer,
    }));
    await p.locator("input[type=file]").first().setInputFiles(files);
    await p.getByRole("button", { name: `Edit Image ${files.at(-1).name}`, exact: true }).waitFor();
  }
  const url = p.url(),
    firstScreen = [],
    longTasks = [];
  await p.addInitScript(() => {
    window.__lt = 0;
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => (window.__lt += e.duration)),
    ).observe({ type: "longtask", buffered: true });
  });
  for (let r = 0; r < runs; r++) {
    await p.goto(url);
    // Every thumbnail row rendered, and every thumbnail inside the viewport decoded.
    await p.waitForFunction(
      (n) => {
        const imgs = [...document.querySelectorAll('img[src^="blob:"]')];
        if (imgs.length < n) return false;
        return imgs.every((img) => {
          const r = img.getBoundingClientRect();
          return r.bottom < 0 || r.top > innerHeight || (img.complete && img.naturalWidth > 0);
        });
      },
      pages,
      { polling: "raf" },
    );
    firstScreen.push(await p.evaluate(() => performance.now()));
    await p.waitForTimeout(1500);
    longTasks.push(await p.evaluate(() => window.__lt));
  }
  report[pages] = {
    firstScreenMs: { p50: pct(firstScreen, 0.5), p95: pct(firstScreen, 0.95), n: runs },
    longTaskMs: { p50: pct(longTasks, 0.5), p95: pct(longTasks, 0.95), n: runs },
  };
  console.log(pages, "pages", JSON.stringify(report[pages]));
  await context.close();
}
await browser.close();
if (out) await writeFile(out, JSON.stringify({ base, runs, report }, null, 2));
