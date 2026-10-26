/** Actual native worker/output timings. Safe fixed workloads; never raises product limits. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  results = [];
let peak = 0;
const sample = () => {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,rss="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/).map(Number)),
    ids = new Set([process.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of rows)
      if (ids.has(parent) && !ids.has(pid)) {
        ids.add(pid);
        changed = true;
      }
  }
  peak = Math.max(peak, rows.reduce((n, [pid, _p, rss]) => n + (ids.has(pid) ? rss : 0), 0) / 1024);
};
const interval = setInterval(sample, 250);
try {
  const p = await browser.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).waitFor();
  for (const job of [
    { width: 512, height: 512, spatial: true, shadow: true },
    { width: 1024, height: 1024, spatial: true, shadow: true },
    { width: 2000, height: 2000, spatial: true, shadow: false },
    { width: 4096, height: 4096, spatial: false, shadow: false },
  ]) {
    peak = 0;
    sample();
    const result = await p.evaluate(async (job) => {
      const [
        { ProRenderer },
        { fromPanel, layer },
        { advancedGradient },
        { advancedEffect },
        { nativeFile, readNative },
      ] = await Promise.all([
        import("/src/lib/studio/pro/client.ts"),
        import("/src/lib/studio/pro/model.ts"),
        import("/src/lib/studio/pro/gradient.ts"),
        import("/src/lib/studio/pro/effects.ts"),
        import("/src/lib/studio/pro/files.ts"),
      ]);
      const d = fromPanel({
        id: "bench",
        name: "R8 measured workload",
        width: job.width,
        height: job.height,
      });
      d.version = 3;
      d.layers[0].visible = false;
      const fill = layer("gradient", job.width, job.height, "gradient");
      fill.gradient = advancedGradient();
      fill.gradient.stops = Array.from({ length: job.spatial ? 4 : 128 }, (_, i) => ({
        position: i / (job.spatial ? 3 : 127),
        color:
          "#" +
          [(i * 37) % 256, (i * 71) % 256, (i * 113) % 256]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join(""),
        opacity: 1,
      }));
      if (job.spatial) {
        fill.smartFilters = [
          { id: "blur", enabled: true, operation: { kind: "gaussian", radius: 1 } },
          {
            id: "noise",
            enabled: true,
            operation: {
              kind: "grain",
              distribution: "uniform",
              amount: 3,
              monochrome: true,
              seed: 42,
            },
          },
        ];
        fill.mask = {
          enabled: true,
          strokes: [],
          selection: {
            regions: [
              {
                kind: "ellipse",
                operation: "add",
                points: [
                  { x: job.width * 0.1, y: job.height * 0.1 },
                  { x: job.width * 0.9, y: job.height * 0.9 },
                ],
              },
            ],
            inverted: false,
            feather: 0,
          },
        };
        const bevel = advancedEffect("bevel");
        bevel.size = 4;
        fill.effects = [bevel];
        if (job.shadow) {
          const shadow = advancedEffect("dropShadow");
          shadow.radius = 3;
          shadow.distance = 6;
          fill.effects.unshift(shadow);
        }
      }
      d.layers.push(fill);
      const c = new OffscreenCanvas(job.width, job.height);
      c.getContext("2d").clearRect(0, 0, c.width, c.height);
      const source = await c.convertToBlob({ type: "image/png" });
      c.width = c.height = 1;
      const session = {
          document: d,
          assets: { source },
          revision: 0,
          acceptedBlobId: "accepted",
          updatedAt: 1,
        },
        renderer = new ProRenderer(),
        maxArea = 16_777_216;
      const hash = async (bytes) =>
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
      const pixels = async (blob) => {
        const bitmap = await createImageBitmap(blob),
          c = new OffscreenCanvas(bitmap.width, bitmap.height);
        c.getContext("2d").drawImage(bitmap, 0, 0);
        bitmap.close();
        const width = c.width,
          height = c.height,
          data = c.getContext("2d").getImageData(0, 0, width, height).data;
        c.width = c.height = 1;
        return { width, height, hash: await hash(data) };
      };
      try {
        let t = performance.now();
        await renderer.init(session, maxArea);
        const initMs = performance.now() - t;
        t = performance.now();
        const first = (await renderer.export(d, maxArea, "image/png", 1, () => {})).blob,
          firstExportMs = performance.now() - t,
          firstPixels = await pixels(first);
        t = performance.now();
        const portable = await nativeFile(session),
          reopened = await readNative(portable, "bench", "accepted"),
          nativeRoundtripMs = performance.now() - t;
        await renderer.init(reopened, maxArea);
        t = performance.now();
        const next = (await renderer.export(reopened.document, maxArea, "image/png", 1, () => {}))
            .blob,
          reopenedExportMs = performance.now() - t,
          nextPixels = await pixels(next);
        if (
          firstPixels.width !== job.width ||
          firstPixels.height !== job.height ||
          firstPixels.hash !== nextPixels.hash
        )
          throw Error("Native round-trip changed pixels/dimensions");
        if (
          (await hash(await source.arrayBuffer())) !==
          (await hash(await reopened.assets.source.arrayBuffer()))
        )
          throw Error("Source bytes changed");
        const originalPost = Worker.prototype.postMessage;
        let jobs = 0;
        Worker.prototype.postMessage = function (...args) {
          if (args[0]?.type === "preview") jobs++;
          return originalPost.apply(this, args);
        };
        t = performance.now();
        let burst;
        try {
          const pending = [];
          for (let i = 0; i < 12; i++)
            pending.push(
              renderer.renderLatest(
                {
                  ...d,
                  layers: d.layers.map((l) =>
                    l.id === "gradient" ? { ...l, gradient: { ...l.gradient, angle: i * 3 } } : l,
                  ),
                },
                maxArea,
              ),
            );
          const done = await Promise.allSettled(pending);
          for (const item of done) if (item.status === "fulfilled") item.value.bitmap?.close();
          burst = {
            requests: 12,
            physicalJobs: jobs,
            fulfilled: done.filter((r) => r.status === "fulfilled").length,
            rejected: done.filter((r) => r.status === "rejected").length,
            ms: performance.now() - t,
          };
          if (jobs !== 2 || burst.fulfilled !== 1)
            throw Error("Latest preview queue did not coalesce actual jobs");
        } finally {
          Worker.prototype.postMessage = originalPost;
        }
        return {
          ...job,
          initMs: +initMs.toFixed(2),
          firstExportMs: +firstExportMs.toFixed(2),
          nativeRoundtripMs: +nativeRoundtripMs.toFixed(2),
          reopenedExportMs: +reopenedExportMs.toFixed(2),
          pngBytes: first.size,
          nativeBytes: portable.size,
          gradientStops: fill.gradient.stops.length,
          rgbaSha256: firstPixels.hash,
          pixelExact: true,
          sourceBytesExact: true,
          burst,
        };
      } finally {
        renderer.dispose();
      }
    }, job);
    sample();
    result.sampledNodeBrowserTreePeakRssMiB = +peak.toFixed(1);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  await mkdir("/workspace/r8-evidence", { recursive: true });
  const report = {
    results,
    errors,
    chromium: browser.version(),
    sampleIntervalMs: 250,
    notes:
      "Shared executor CPU/Chromium timings and sampled Node/browser process-tree RSS, not physical mobile/device guarantees. Existing4MP spatial/style and16.8MP document limits retained.",
  };
  await writeFile("/workspace/r8-evidence/render-benchmark.json", JSON.stringify(report, null, 2));
} finally {
  clearInterval(interval);
  await browser.close();
}
