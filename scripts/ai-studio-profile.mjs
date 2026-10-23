/** Real, hash-verified ONNX execution; original procedural illustrations, no model-output mocks. */
import assert from "node:assert/strict";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { SWIN } from "../src/lib/studio/ai/registry.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const root = ".vercel/output/static/assets";
let path;
for (const file of await readdir(root))
  if (
    /^worker-.*\.js$/.test(file) &&
    (await readFile(`${root}/${file}`, "utf8")).includes("Restoring fine detail")
  )
    path = "/assets/" + file;
assert.ok(path, "Find the built enhancement worker");
const cache = process.env.INKSTRIP_QA_MODEL_CACHE
  ? await readFile(process.env.INKSTRIP_QA_MODEL_CACHE)
  : null;
if (cache) assert.equal(createHash("sha256").update(cache).digest("hex"), SWIN.sha256);
const memorySamples = [];
const sampleMemory = async () => {
  try {
    memorySamples.push(Number(await readFile("/sys/fs/cgroup/memory.current", "utf8")));
  } catch {
    /* non-Linux runner */
  }
};
await sampleMemory();
const memorySampler = setInterval(() => void sampleMemory(), 500);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  // Local Nitro preview compresses large WASM synchronously with Brotli. Exclude
  // that QA-host transport cost from the worker compute profile; bytes are identical.
  const c = await browser.newContext({ extraHTTPHeaders: { "Accept-Encoding": "identity" } });
  if (cache)
    await c.route(SWIN.artifact, (r) =>
      r.fulfill({ body: cache, contentType: "application/octet-stream" }),
    );
  const p = await c.newPage();
  // Isolate worker compute from homepage software WebGL/React animation work.
  await p.route(base + "/__ai_runtime_audit", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local AI runtime audit</title>",
    }),
  );
  await p.goto(base + "/__ai_runtime_audit");
  const report = await p.evaluate(async (path) => {
    const worker = new Worker(path, { type: "module" }),
      runs = [];
    const run = (blob) =>
      new Promise((ok, no) => {
        worker.onmessage = ({ data }) => {
          if (data.type === "result") ok(data.result);
          if (data.type === "error") no(Error(data.error));
        };
        worker.onerror = no;
        worker.postMessage({
          blob,
          options: { scale: 1, denoise: 0, sharpen: 0, color: false, artifacts: false },
        });
      });
    const encode = async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (const n of bytes) s += String.fromCharCode(n);
      return btoa(s);
    };
    try {
      for (const category of [
        "black-and-white-manga",
        "colored-manhwa",
        "detailed-line-art",
        "character-portrait",
        "background-artwork",
      ]) {
        const canvas = new OffscreenCanvas(64, 64),
          ctx = canvas.getContext("2d");
        ctx.fillStyle = category === "black-and-white-manga" ? "#fff" : "#ccd9ea";
        ctx.fillRect(0, 0, 64, 64);
        ctx.strokeStyle = "#182032";
        ctx.lineWidth = 1;
        if (category === "background-artwork") {
          ctx.fillStyle = "#8595b2";
          ctx.fillRect(5, 12, 19, 50);
          ctx.fillStyle = "#b3a6af";
          ctx.fillRect(29, 4, 30, 60);
          for (let y = 9; y < 60; y += 9)
            for (let x = 32; x < 58; x += 8) {
              ctx.strokeRect(x, y, 5, 5);
            }
          ctx.beginPath();
          ctx.moveTo(0, 64);
          ctx.lineTo(32, 40);
          ctx.lineTo(64, 64);
          ctx.stroke();
        } else {
          ctx.fillStyle = category === "black-and-white-manga" ? "#fff" : "#eac2b3";
          ctx.beginPath();
          ctx.ellipse(32, 32, 17, 23, 0, 0, 7);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#273047";
          ctx.beginPath();
          ctx.moveTo(13, 30);
          ctx.bezierCurveTo(8, 0, 50, 1, 52, 30);
          ctx.lineTo(42, 16);
          ctx.lineTo(36, 29);
          ctx.lineTo(27, 16);
          ctx.lineTo(20, 33);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(21, 33);
          ctx.quadraticCurveTo(26, 28, 30, 33);
          ctx.moveTo(35, 33);
          ctx.quadraticCurveTo(40, 28, 44, 33);
          ctx.moveTo(29, 45);
          ctx.quadraticCurveTo(34, 48, 38, 44);
          ctx.stroke();
        }
        if (category === "detailed-line-art" || category === "black-and-white-manga") {
          ctx.lineWidth = 0.4;
          for (let i = 0; i < 20; i++) {
            ctx.beginPath();
            ctx.moveTo(i * 3, 0);
            ctx.lineTo(i * 3 + 12, 20);
            ctx.stroke();
          }
        }
        // Include transparent and partially transparent source pixels in every fixture.
        const input = ctx.getImageData(0, 0, 64, 64);
        for (let y = 0; y < 64; y++)
          for (let x = 0; x < 4; x++) input.data[(y * 64 + x) * 4 + 3] = x < 2 ? 0 : 128;
        ctx.putImageData(input, 0, 0);
        const normalizedSource = ctx.getImageData(0, 0, 64, 64).data;
        const blob = await canvas.convertToBlob(),
          started = performance.now(),
          output = await run(blob);
        const totalMs = performance.now() - started;
        const bitmap = await createImageBitmap(output.blob),
          out = new OffscreenCanvas(64, 64),
          ox = out.getContext("2d");
        ox.drawImage(bitmap, 0, 0);
        bitmap.close();
        const values = ox.getImageData(0, 0, 64, 64).data;
        let alphaChanges = 0,
          changed = 0;
        for (let i = 0; i < values.length; i += 4) {
          if (values[i + 3] !== normalizedSource[i + 3]) alphaChanges++;
          if (
            values[i] !== normalizedSource[i] ||
            values[i + 1] !== normalizedSource[i + 1] ||
            values[i + 2] !== normalizedSource[i + 2]
          )
            changed++;
        }
        const record = {
          category,
          totalMs,
          timings: output.timings,
          width: output.width,
          height: output.height,
          alphaChanges,
          changedPixels: changed,
          before: await encode(blob),
          after: await encode(output.blob),
        };
        if (!runs.length) {
          const start = performance.now(),
            warm = await run(blob);
          record.sameInputWarm = {
            totalMs: performance.now() - start,
            timings: warm.timings,
            identicalPng: (await encode(warm.blob)) === record.after,
          };
        }
        runs.push(record);
      }
    } finally {
      worker.terminate();
    }
    return { runs, jsHeap: performance.memory?.usedJSHeapSize ?? null };
  }, path);
  await mkdir("docs/benchmarks/f1-audit-illustrations", { recursive: true });
  for (const r of report.runs) {
    assert.equal(r.width, 64);
    assert.equal(r.height, 64);
    assert.equal(r.alphaChanges, 0);
    assert.ok(r.changedPixels > 0);
    if (r.sameInputWarm) assert.equal(r.sameInputWarm.identicalPng, true);
    for (const type of ["before", "after"]) {
      await writeFile(
        `docs/benchmarks/f1-audit-illustrations/${r.category}-${type}.png`,
        Buffer.from(r[type], "base64"),
      );
      delete r[type];
    }
  }
  await writeFile(
    "docs/benchmarks/phase-f1-audit-profile.json",
    JSON.stringify(
      {
        browser: browser.version(),
        backend: "ORT 1.22.0 WASM SIMD single-thread",
        runtimeTransport:
          "identity encoding on loopback QA host; avoids on-demand Brotli compression, not a production header change",

        model: SWIN,
        method:
          "Built real worker in an isolated same-origin test document (homepage animation absent), sequential original procedural illustrations; no competing QA. Cold session then repeated same-input warm session, then four warm illustrations. Transport uses exact verified local checkpoint when configured; does not measure Internet download latency. JS heap snapshot excludes WASM/native/process peak memory.",
        sampledCgroupMemory: {
          firstBytes: memorySamples[0] ?? null,
          maximumObservedBytes: memorySamples.length ? Math.max(...memorySamples) : null,
          lastBytes: memorySamples.at(-1) ?? null,
          samples: memorySamples.length,
          intervalMs: 500,
          limitation:
            "Whole shared execution cgroup, including browser, Node model cache and preview server; sampled maximum is not per-model or guaranteed peak memory.",
        },
        ...report,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(report));
} finally {
  clearInterval(memorySampler);
  await browser.close();
}
