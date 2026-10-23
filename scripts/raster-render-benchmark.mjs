import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { DAB_DEFAULTS } from "../src/lib/studio/pro/brush-dynamics.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const server = await chromium.launchServer({ headless: true, args: ["--no-sandbox"] }),
  browser = await chromium.connect(server.wsEndpoint()),
  errors = [];
const { start, open, load, tab } = proBrowserFixtures(base, errors),
  measurements = [];
let rssPeak = 0;
function rss() {
  const rows = execFileSync("ps", ["-eo", "pid,ppid,rss"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .slice(1)
    .map((s) => s.trim().split(/\s+/).map(Number));
  const ids = new Set([server.process().pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, parent] of rows)
      if (ids.has(parent) && !ids.has(id)) {
        ids.add(id);
        changed = true;
      }
  }
  const kib = rows.filter(([id]) => ids.has(id)).reduce((n, row) => n + row[2], 0);
  rssPeak = Math.max(rssPeak, kib);
  return kib;
}
const timer = setInterval(rss, 200);
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await context.newPage();
  p.setDefaultTimeout(120000);
  await start(p);
  await open(p);
  for (const [width, height] of [
    [2048, 2048],
    [4096, 4096],
    [1024, 8192],
  ]) {
    const source = await p.evaluate(
      ({ width, height }) => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const x = c.getContext("2d");
        x.fillStyle = "#eeeade";
        x.fillRect(0, 0, width, height);
        x.fillStyle = "#243b32";
        for (let y = 0; y < height; y += 96) {
          x.fillRect(width * 0.2, y, width * 0.6, 64);
          x.clearRect(width * 0.48, y, 8, 64);
        }
        return c.toDataURL().split(",")[1];
      },
      { width, height },
    );
    const d = fromPanel({ id: "benchmark", name: "Large raster", width, height }),
      paint = layer("paint", width, height, "paint"),
      overlay = layer("raster", width, height, "overlay");
    overlay.assetId = "source";
    overlay.opacity = 0.15;
    const mask = {
      enabled: true,
      density: 0.9,
      feather: 2,
      selection: {
        regions: [
          {
            kind: "rectangle",
            operation: "add",
            points: [
              { x: 0, y: 0 },
              { x: width * 0.8, y: height },
            ],
          },
        ],
        inverted: false,
        feather: 0,
      },
      strokes: [],
    };
    overlay.mask = mask;
    paint.strokes = Array.from({ length: 50 }, (_, i) => ({
      points: [
        { x: width * 0.1, y: 32 + i * 48 },
        { x: width * 0.9, y: 32 + i * 48 },
      ],
      size: 16,
      hardness: 0.8,
      opacity: 0.5,
      flow: 0.4,
      color: "#a4efd6",
      erase: false,
      dynamics: { ...DAB_DEFAULTS },
      seed: i + 1,
    }));
    d.layers.push(overlay, paint);
    let begin = performance.now();
    await load(p, d, source);
    await p.waitForFunction(
      () =>
        document
          .querySelector('canvas[aria-label="Pro composite preview"]')
          ?.getAttribute("aria-busy") === "false",
      null,
      { timeout: 120000 },
    );
    const importPreviewMs = performance.now() - begin;
    begin = performance.now();
    for (let i = 0; i < 4; i++)
      await p.getByRole("button", { name: "Pro zoom in", exact: true }).click();
    for (let i = 0; i < 4; i++)
      await p.getByRole("button", { name: "Pro zoom out", exact: true }).click();
    const zoomControlMs = performance.now() - begin;
    await tab(p, "Export");
    await p.getByLabel("Pro export format", { exact: true }).selectOption("image/png");
    begin = performance.now();
    const event = p.waitForEvent("download");
    await p.getByRole("button", { name: /^Export composite ·/ }).click();
    const download = await event,
      filename = `/workspace/screenshots/ee-benchmark-${width}x${height}.png`;
    await download.saveAs(filename);
    const bytes = await readFile(filename),
      exportMs = performance.now() - begin;
    const dimensions = await p.evaluate(
      async (data) => {
        const bitmap = await createImageBitmap(
            new Blob([Uint8Array.from(data)], { type: "image/png" }),
          ),
          r = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return r;
      },
      [...bytes],
    );
    assert.deepEqual(dimensions, { width, height });
    rss();
    measurements.push({
      width,
      height,
      layers: 3,
      strokes: 50,
      mask: "density 0.9 / feather 2",
      importPreviewMs: +importPreviewMs.toFixed(1),
      eightZoomControlClicksMs: +zoomControlMs.toFixed(1),
      pngExportMs: +exportMs.toFixed(1),
      pngBytes: bytes.length,
      dimensionsVerified: true,
      browserTreeSampledPeakRssMiB: +(rssPeak / 1024).toFixed(1),
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        cpu: os.cpus()[0]?.model,
        platform: os.platform(),
        browser: browser.version(),
        method:
          "Single cold import/preview and native PNG export per document. Three real layers, source texture, large feathered mask, 50 deterministic brush strokes. Zoom measurement includes UI automation. Peak is summed process-tree RSS sampled every 200 ms, may double-count shared pages; includes browser/runtime/GPU processes, not a per-document allocation measurement.",
        measurements,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(timer);
  await browser.close();
  await server.close();
}
