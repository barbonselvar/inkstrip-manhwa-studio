#!/usr/bin/env node
/**
 * Large-chapter performance measurements of the real desktop app (offline, isolated
 * profiles). For each size it measures: import, Composition & FX first render, Save
 * (.inkstrip), reopening the file in a brand-new profile, chapter export, plus process
 * memory and CPU from Electron's app metrics.
 *
 *   node apps/desktop/test/perf-desktop.mjs [--exe <installed exe>] [--sizes 20,50,100,200] [--out <dir>]
 *
 * Panels are synthetic 1080×1600 JPEGs (gradients, ink strokes, noise, text) produced by
 * the renderer itself, ~0.3–0.6 MB each, similar to real webtoon panels.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const root = resolve(desktop, "..", "..");
import { waitShellStatus, windowPages } from "./window-pages.mjs";
const { _electron: electron } = await import(pathToFileURL(join(root, "node_modules", "playwright", "index.mjs")).href);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const exe = arg("--exe");
const sizes = (arg("--sizes") ?? "20,50,100,200").split(",").map(Number);
const out = resolve(arg("--out") ?? join(tmpdir(), `inkstrip-perf-${Date.now()}`));
mkdirSync(out, { recursive: true });

async function launch(profile, extra = []) {
  const t = Date.now();
  const app = await electron.launch({
    executablePath: exe ?? join(desktop, "node_modules", "electron", "dist", "electron.exe"),
    args: exe ? extra : [desktop, ...extra],
    env: { ...process.env, INKSTRIP_PROFILE_DIR: profile },
    timeout: 60_000,
  });
  await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  const { studio: page, shell } = await windowPages(app, 120_000);
  await page.waitForSelector(".hero-title, main", { timeout: 120_000 });
  await page.waitForSelector(".desktop-toasts", { state: "attached", timeout: 60_000 });
  return { app, page, shell, startupMs: Date.now() - t };
}

/** Sum of all Electron processes: working set (MB) and CPU %. */
const metrics = (app) =>
  app.evaluate(({ app }) => {
    const m = app.getAppMetrics();
    return {
      workingSetMB: Math.round(m.reduce((s, p) => s + p.memory.workingSetSize, 0) / 1024),
      peakWorkingSetMB: Math.round(m.reduce((s, p) => s + p.memory.peakWorkingSetSize, 0) / 1024),
      cpuPercent: Math.round(m.reduce((s, p) => s + p.cpu.percentCPUUsage, 0)),
      processes: m.length,
    };
  });

async function sampleWhile(app, work) {
  let peak = 0,
    cpu = [];
  let running = true;
  const sampler = (async () => {
    while (running) {
      const m = await metrics(app).catch(() => null);
      if (m) {
        peak = Math.max(peak, m.workingSetMB);
        cpu.push(m.cpuPercent);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
  const t = Date.now();
  try {
    await work();
  } finally {
    running = false;
    await sampler;
  }
  return { ms: Date.now() - t, peakWorkingSetMB: peak, avgCpuPercent: cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : null };
}

async function makePanels(page, n) {
  const files = [];
  for (let i = 0; i < n; i += 10) {
    const batch = await page.evaluate(async ({ start, count }) => {
      const out = [];
      for (let k = start; k < start + count; k++) {
        const c = new OffscreenCanvas(1080, 1600),
          g = c.getContext("2d");
        const grad = g.createLinearGradient(0, 0, 1080, 1600);
        grad.addColorStop(0, `hsl(${(k * 37) % 360} 45% 70%)`);
        grad.addColorStop(1, `hsl(${(k * 37 + 140) % 360} 35% 25%)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, 1080, 1600);
        let seed = k * 9973 + 1;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        g.lineCap = "round";
        for (let s = 0; s < 160; s++) {
          g.strokeStyle = `rgba(10,10,20,${0.25 + rnd() * 0.6})`;
          g.lineWidth = 1 + rnd() * 6;
          g.beginPath();
          g.moveTo(rnd() * 1080, rnd() * 1600);
          g.bezierCurveTo(rnd() * 1080, rnd() * 1600, rnd() * 1080, rnd() * 1600, rnd() * 1080, rnd() * 1600);
          g.stroke();
        }
        const img = g.getImageData(0, 0, 1080, 1600);
        for (let p = 0; p < img.data.length; p += 4) {
          const v = (rnd() - 0.5) * 18;
          img.data[p] += v;
          img.data[p + 1] += v;
          img.data[p + 2] += v;
        }
        g.putImageData(img, 0, 0);
        g.fillStyle = "white";
        g.font = "bold 72px sans-serif";
        g.fillText(`PANEL ${k + 1}`, 60, 140);
        const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
        out.push(btoa(bin));
      }
      return out;
    }, { start: i, count: Math.min(10, n - i) });
    batch.forEach((b64, j) =>
      files.push({ name: `${String(i + j + 1).padStart(3, "0")}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") }),
    );
  }
  return files;
}

const results = [];
for (const n of sizes) {
  const row = { panels: n };
  console.log(`\n── ${n} panels ──`);
  const profile = join(out, `p${n}-a`);
  let { app, page, startupMs } = await launch(profile);
  row.startupMs = startupMs;
  row.idle = await metrics(app);
  const files = await makePanels(page, n);
  row.inputMB = +(files.reduce((s, f) => s + f.buffer.length, 0) / 1048576).toFixed(1);
  // Real files on disk, like a user's import (Playwright caps in-memory uploads at 50 MB).
  const panelDir = join(out, `panels-${n}`);
  mkdirSync(panelDir, { recursive: true });
  const paths = files.map((f) => {
    const p = join(panelDir, f.name);
    writeFileSync(p, f.buffer);
    return p;
  });
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project title").fill(`Perf ${n}`);
  await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await page.getByRole("button", { name: "Add images", exact: true }).waitFor({ timeout: 30_000 });
  row.import = await sampleWhile(app, async () => {
    await page.locator("input[type=file][multiple]").first().setInputFiles(paths);
    await page.getByRole("button", { name: `Display ${n}`, exact: true }).waitFor({ timeout: 15 * 60_000 });
  });
  console.log("import", row.import);
  row.composition = await sampleWhile(app, async () => {
    await page.getByRole("button", { name: "Composition & FX", exact: true }).click();
    await page.locator("[data-composition=studio]").waitFor({ timeout: 120_000 });
    await page.waitForFunction(
      () => {
        const t = [...document.querySelectorAll(".composition-tile")];
        return t.length > 0 && t.some((c) => c.dataset.renderStatus === "ready");
      },
      null,
      { timeout: 5 * 60_000 },
    );
  });
  console.log("composition first render", row.composition);
  // Scroll the whole chapter (virtualized rendering) to the end and back.
  row.scroll = await sampleWhile(app, async () => {
    for (let k = 0; k < 30; k++) {
      await page.mouse.move(900, 500);
      await page.mouse.wheel(0, 2400);
      await page.waitForTimeout(60);
    }
  });
  const file = join(out, `perf-${n}.inkstrip`);
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, file);
  row.save = await sampleWhile(app, async () => {
    await page.keyboard.press("Control+s");
    await page.getByText(/Saved to perf-/).waitFor({ timeout: 15 * 60_000 });
  });
  row.fileMB = +(statSync(file).size / 1048576).toFixed(1);
  console.log("save", row.save, row.fileMB, "MB");
  if (n <= 100) {
    const dir = join(out, `exports-${n}`);
    mkdirSync(dir, { recursive: true });
    await app.evaluate(({ session }, d) => {
      session.defaultSession.on("will-download", (_e, item) => item.setSavePath(`${d}\\${item.getFilename()}`));
    }, dir);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByLabel("Output width", { exact: true }).fill("800");
    row.export = await sampleWhile(app, async () => {
      await page.getByRole("button", { name: "Export images", exact: true }).click();
      await page.waitForFunction(() => document.body.innerText.includes("Exported "), null, { timeout: 20 * 60_000 });
    });
    console.log("export", row.export);
    await page.keyboard.press("Escape");
  } else row.export = "not run (≤100 panels only in this suite)";
  row.afterWork = await metrics(app);
  await app.evaluate(({ app }) => app.exit(0));

  let shell;
  ({ app, page, shell } = await launch(join(out, `p${n}-b`), [file]));
  row.reopen = await sampleWhile(app, async () => {
    await page.waitForURL(/\/p\/[^/]+$/, { timeout: 20 * 60_000 });
    await waitShellStatus(shell, /Saved · perf-/, 60_000);
  });
  console.log("reopen", row.reopen);
  await app.evaluate(({ app }) => app.exit(0));
  results.push(row);
  writeFileSync(join(out, `perf-results-${sizes.join("-")}.json`), JSON.stringify({ exe: exe ?? "unpackaged", machine: process.env.COMPUTERNAME, results }, null, 2));
}
console.log(JSON.stringify(results, null, 1));
console.log(`Results: ${join(out, `perf-results-${sizes.join("-")}.json`)}`);
process.exit(0);
