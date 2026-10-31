/** Real original 720x960 panel, native 4x output, resource samples and active-tile
 * cancellation. No image scaling is used to pretend a small fixture is a large source. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
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
try {
  const p = await browser.newPage();
  p.setDefaultTimeout(600000);
  await p.goto(new URL("/gallery/provenance.json", base).href);
  const result = await p.evaluate(async () => {
    const { EnhancementEngine } = await import("/src/lib/studio/enhance/client.ts"),
      engine = new EnhancementEngine(),
      source = await (await fetch("/gallery/adventure-720.webp")).blob(),
      hash = async (b) =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", await b.arrayBuffer())),
          (b) => b.toString(16).padStart(2, "0"),
        ).join(""),
      before = await hash(source),
      options = {
        model: "realesrgan-anime",
        scale: 4,
        denoise: 0,
        sharpen: 0,
        color: false,
        artifacts: false,
      };
    let progress;
    try {
      const start = performance.now(),
        r = await engine.run(source, options, (p) => {
          progress = p;
        }),
        ms = performance.now() - start,
        b = await createImageBitmap(r.blob),
        size = [b.width, b.height];
      b.close();
      let cancelled = false,
        started = false;
      const pending = engine.run(source, options, (p) => {
        if (!started && p.stage.startsWith("Restoring fine detail") && p.done >= 1) {
          started = true;
          engine.dispose();
        }
      });
      try {
        await pending;
      } catch (e) {
        cancelled = e.name === "AbortError";
      }
      if (!started || !cancelled) throw Error("Active inference cancellation was not exercised");
      const small = new OffscreenCanvas(16, 16);
      small.getContext("2d");
      const next = await engine.run(
        await small.convertToBlob(),
        { ...options, scale: 2 },
        () => {},
      );
      if (next.width !== 32) throw Error("Engine did not recover after cancellation");
      return {
        source: "public/gallery/adventure-720.webp",
        input: [720, 960],
        output: size,
        ms,
        bytes: r.blob.size,
        sha256: await hash(r.blob),
        sourceExact: before === (await hash(source)),
        completedProgress: progress,
        activeTileCancelled: cancelled,
        newRunAfterCancel: true,
      };
    } finally {
      engine.dispose();
    }
  });
  assert.deepEqual(result.output, [2880, 3840]);
  assert.equal(result.sourceExact, true);
  result.sampledProcessTreePeakMiB = peak;
  result.memoryNote =
    "250ms Node/browser descendant RSS samples; not isolated WASM/GPU peaks or a mobile guarantee.";
  await writeFile("/workspace/r14-evidence/large-panel.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearInterval(timer);
  await browser.close();
}
