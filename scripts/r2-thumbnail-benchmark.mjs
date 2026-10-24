/** One actual browser sample; counts work during fixed quiet windows, not interaction latency or FPS. */
import assert from "node:assert/strict";
import { cpus, availableParallelism } from "node:os";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8081",
  output = process.argv[3] ?? "/workspace/screenshots/r2-thumbnail-benchmark.json";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    fx = proBrowserFixtures(base, errors);
  const source = await fx.start(p);
  await fx.open(p);
  await p.evaluate(() => {
    const post = Worker.prototype.postMessage,
      tracked = new WeakSet(),
      pending = new WeakMap();
    window.__thumbBench = [];
    window.__thumbRequests = 0;
    Worker.prototype.postMessage = function (data, ...rest) {
      if (!tracked.has(this)) {
        tracked.add(this);
        pending.set(this, new Map());
        this.addEventListener("message", ({ data: d }) => {
          if (d.type === "thumbnails") {
            const start = pending.get(this).get(d.id);
            window.__thumbBench.push({
              count: d.thumbnails.length,
              workerWallMs: performance.now() - start,
            });
            pending.get(this).delete(d.id);
          }
        });
      }
      if (data.type === "thumbnails") {
        window.__thumbRequests++;
        pending.get(this).set(data.id, performance.now());
      }
      return post.call(this, data, ...rest);
    };
  });
  const d = fromPanel({ id: "thumbs", name: "Thumbs", width: 128, height: 96 });
  d.width = d.height = 1024;
  d.layers = [];
  for (let i = 0; i < 36; i++) {
    const l = layer("shape", 96, 96, `tile-${i}`);
    l.name = `Tile ${i}`;
    l.fill = i % 2 ? "#55cc99" : "#332244";
    l.strokeWidth = 0;
    l.transform.x = (i % 6) * 150;
    l.transform.y = Math.floor(i / 6) * 150;
    d.layers.push(l);
  }
  await fx.load(p, d, source);
  await fx.tab(p, "Layers");
  await p.waitForFunction(() => window.__thumbBench.length >= 1);
  await p.waitForTimeout(300);
  const originalUrls = await p
    .locator("img.pro-layer-thumb")
    .evaluateAll((imgs) => imgs.map((i) => i.src));
  assert.equal(originalUrls.length, 36);
  const start = await p.evaluate(() => ({
    events: window.__thumbBench.length,
    requests: window.__thumbRequests,
    time: performance.now(),
  }));
  for (let i = 0; i < 3; i++) {
    await p
      .getByRole("button", { name: `${i % 2 ? "Show" : "Hide"} layer Tile 0`, exact: true })
      .click();
    await p.waitForTimeout(1100);
  }
  const result = await p.evaluate(
    (start) => ({
      events: window.__thumbBench,
      changedJobs: window.__thumbBench.length - start.events,
      changedRequests: window.__thumbRequests - start.requests,
      interactionWallMs: performance.now() - start.time,
    }),
    start,
  );
  const finalUrls = await p
    .locator("img.pro-layer-thumb")
    .evaluateAll((imgs) => imgs.map((i) => i.src));
  result.reusedThumbnailUrls = finalUrls.filter((url, i) => url === originalUrls[i]).length;
  assert.deepEqual(errors, []);
  result.errors = errors;
  result.environment = {
    chromium: browser.version(),
    sharedCPU: cpus()[0]?.model,
    availableCPUs: availableParallelism(),
    viewport: [1440, 1000],
  };
  result.fixture = {
    document: [1024, 1024],
    shapeLayers: 36,
    visibilityToggles: 3,
    quietWindowMs: 1100,
  };
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
