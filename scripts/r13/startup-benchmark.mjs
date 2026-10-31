/** R13 startup benchmark: per-route network bytes, JS bytes, long tasks and timings
 * against a built preview. Deterministic byte counts are the primary signal;
 * timings are reported as p50/p95 over N fresh contexts (shared-sandbox noise). */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
const runs = Number(process.argv[3] ?? 5);
const out = process.argv[4];
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y),
    i = (s.length - 1) * p,
    lo = Math.floor(i);
  return +(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)).toFixed(1);
};
async function measure(mobile, scenario) {
  const context = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } },
  );
  const p = await context.newPage();
  const cdp = await context.newCDPSession(p);
  await cdp.send("Network.enable");
  const sizes = new Map(),
    types = new Map(),
    urls = new Map();
  cdp.on("Network.responseReceived", (e) => {
    types.set(e.requestId, e.type);
    urls.set(e.requestId, e.response.url);
  });
  cdp.on("Network.loadingFinished", (e) => sizes.set(e.requestId, e.encodedDataLength));
  await p.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => window.__long.push(e.duration)),
    ).observe({ type: "longtask", buffered: true });
  });
  const t0 = Date.now();
  await p.goto(base, { waitUntil: "load" });
  await p.getByRole("button", { name: "New project", exact: true }).waitFor();
  const home = Date.now() - t0;
  const nav = await p.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { domInteractive: n.domInteractive, load: n.loadEventEnd, fcp: fcp?.startTime ?? 0 };
  });
  const snapshot = () => {
    let total = 0,
      js = 0,
      n = 0;
    const big = [];
    for (const [id, s] of sizes) {
      total += s;
      n++;
      const u = urls.get(id) ?? "";
      if (types.get(id) === "Script" || /\.m?js(\?|$)/.test(u)) js += s;
      if (s > 50_000) big.push(`${u.split("/").pop()}:${Math.round(s / 1024)}KB`);
    }
    return { requests: n, totalKB: Math.round(total / 1024), jsKB: Math.round(js / 1024), big };
  };
  const result = { home, ...nav, homeNet: snapshot() };
  if (scenario === "chapter" || scenario === "raster") {
    sizes.clear();
    const t1 = Date.now();
    await p.getByRole("button", { name: "New project", exact: true }).click();
    await p.getByPlaceholder("Night Market").fill("Bench");
    await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
    await p.getByText("Chapter workspace", { exact: true }).waitFor();
    result.chapterOpen = Date.now() - t1;
    result.chapterNet = snapshot();
    if (scenario === "raster") {
      const png = await p.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 1080;
        c.height = 1920;
        const x = c.getContext("2d");
        const g = x.createLinearGradient(0, 0, 1080, 1920);
        g.addColorStop(0, "#246");
        g.addColorStop(1, "#fc8");
        x.fillStyle = g;
        x.fillRect(0, 0, 1080, 1920);
        return c.toDataURL().split(",")[1];
      });
      await p
        .locator("input[type=file]")
        .first()
        .setInputFiles([
          { name: "page.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") },
        ]);
      await p.getByRole("button", { name: "Edit Image page.png", exact: true }).waitFor();
      sizes.clear();
      const t2 = Date.now();
      await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
      await p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true }).waitFor();
      await p.locator(".pro-artboard canvas").first().waitFor();
      result.rasterOpen = Date.now() - t2;
      result.rasterNet = snapshot();
    }
  }
  result.longTasks = await p.evaluate(() => ({
    count: window.__long.length,
    total: Math.round(window.__long.reduce((a, b) => a + b, 0)),
  }));
  result.heapMB = +(
    (await p.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)) / 1048576
  ).toFixed(1);
  await context.close();
  return result;
}
const report = {};
for (const mobile of [false, true])
  for (const scenario of ["home", "chapter", "raster"]) {
    const key = `${mobile ? "390" : "1440"}-${scenario}`,
      rows = [];
    for (let i = 0; i < runs; i++) rows.push(await measure(mobile, scenario));
    const stat = (f) => {
      const v = rows.map(f).filter((x) => x !== undefined);
      return v.length ? { p50: pct(v, 0.5), p95: pct(v, 0.95) } : undefined;
    };
    report[key] = {
      homeMs: stat((r) => r.home),
      fcp: stat((r) => r.fcp),
      domInteractive: stat((r) => r.domInteractive),
      chapterOpenMs: stat((r) => r.chapterOpen),
      rasterOpenMs: stat((r) => r.rasterOpen),
      longTaskMs: stat((r) => r.longTasks.total),
      heapMB: stat((r) => r.heapMB),
      homeNet: rows[0].homeNet,
      chapterNet: rows[0].chapterNet,
      rasterNet: rows[0].rasterNet,
    };
    console.log(key, JSON.stringify(report[key]));
  }
await browser.close();
if (out) await writeFile(out, JSON.stringify({ base, runs, report }, null, 2));
