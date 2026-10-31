/** Real model processing. Baseline parity, alpha, fourfold dimensions, cache
 * integrity recovery, cancellation and input budgets; no intercepted AI outputs. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080",
  baseline = process.argv[3] ?? "http://127.0.0.1:8083";
const browser = await chromium.launch({ args: ["--no-sandbox"] }),
  rows = [];
try {
  const original = await browser.newPage(),
    current = await browser.newPage();
  for (const [page, url] of [
    [original, baseline],
    [current, base],
  ]) {
    page.setDefaultTimeout(180000);
    await page.goto(new URL("/gallery/provenance.json", url).href);
  }
  const run = async (page, model, scale) =>
    page.evaluate(
      async ({ model, scale }) => {
        const { EnhancementEngine } = await import("/src/lib/studio/enhance/client.ts");
        const c = new OffscreenCanvas(24, 16),
          ctx = c.getContext("2d"),
          image = new ImageData(24, 16);
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 24; x++)
            image.data.set(
              [x * 10, y * 15, x < 12 ? 24 : 210, x < 4 ? 0 : x < 12 ? 96 : 255],
              (y * 24 + x) * 4,
            );
        ctx.putImageData(image, 0, 0);
        const input = await c.convertToBlob(),
          hash = async (blob) =>
            Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
              (b) => b.toString(16).padStart(2, "0"),
            ).join("");
        const before = await hash(input),
          engine = new EnhancementEngine(),
          progress = [],
          start = performance.now();
        try {
          const r = await engine.run(
              input,
              { model, scale, denoise: 0, sharpen: 0, color: false, artifacts: false },
              (p) => progress.push(p),
            ),
            b = await createImageBitmap(r.blob),
            out = new OffscreenCanvas(b.width, b.height),
            x = out.getContext("2d");
          x.drawImage(b, 0, 0);
          b.close();
          const rgba = x.getImageData(0, 0, out.width, out.height).data;
          const alpha = new OffscreenCanvas(out.width, out.height),
            a = alpha.getContext("2d");
          a.drawImage(c, 0, 0, out.width, out.height);
          const expected = a.getImageData(0, 0, out.width, out.height).data;
          for (let p = 3; p < rgba.length; p += 4)
            if (rgba[p] !== expected[p]) throw Error("Source alpha changed at " + p);
          if (before !== (await hash(input))) throw Error("Input bytes changed");
          return {
            model,
            scale,
            width: r.width,
            height: r.height,
            rgba: [...rgba],
            alphaExact: true,
            sourceExact: true,
            ms: performance.now() - start,
            progress: progress.at(-1),
          };
        } finally {
          engine.dispose();
        }
      },
      { model, scale },
    );
  for (const scale of [1, 2]) {
    const a = await run(original, undefined, scale),
      b = await run(current, "swin2sr", scale);
    assert.deepEqual(
      b.rgba,
      a.rgba,
      "existing Swin2SR raw output remains pixel-exact, including soft alpha",
    );
    delete a.rgba;
    delete b.rgba;
    rows.push({ baseline: a, current: b, existingPixelsExact: true });
  }
  for (const model of ["swin2sr", "realesrgan-anime"])
    for (const scale of model === "swin2sr" ? [4] : [1, 2, 4]) {
      const r = await run(current, model, scale);
      assert.equal(r.width, 24 * scale);
      assert.equal(r.height, 16 * scale);
      delete r.rgba;
      rows.push(r);
    }
  const safety = await current.evaluate(async () => {
    const { EnhancementEngine } = await import("/src/lib/studio/enhance/client.ts"),
      { ENHANCE_MODELS } = await import("/src/lib/studio/enhance/models.ts");
    const spec = ENHANCE_MODELS["realesrgan-anime"],
      cache = await caches.open(spec.cache);
    await cache.put(spec.url, new Response(new Uint8Array([1, 2, 3])));
    const engine = new EnhancementEngine(),
      canvas = new OffscreenCanvas(16, 16);
    canvas.getContext("2d");
    const blob = await canvas.convertToBlob(),
      options = {
        model: "realesrgan-anime",
        scale: 2,
        denoise: 0,
        sharpen: 0,
        color: false,
        artifacts: false,
      };
    try {
      await engine.run(blob, options, () => {});
      const cached = await cache.match(spec.url);
      if ((await cached.arrayBuffer()).byteLength !== spec.bytes)
        throw Error("Corrupt cache was not replaced by genuine verified model bytes");
    } finally {
      engine.dispose();
    }
    const cancel = new EnhancementEngine();
    const pending = cancel.run(blob, options, () => {});
    cancel.dispose();
    let cancelled = false;
    try {
      await pending;
    } catch (e) {
      cancelled = e.name === "AbortError";
    }
    if (!cancelled) throw Error("Cancellation did not reject");
    const oversized = new OffscreenCanvas(1001, 1000);
    oversized.getContext("2d");
    const big = await oversized.convertToBlob(),
      invalid = new EnhancementEngine();
    let refused = false;
    try {
      await invalid.run(big, { ...options, scale: 4 }, () => {});
    } catch (e) {
      refused = /output limit/.test(e.message);
    } finally {
      invalid.dispose();
    }
    if (!refused) throw Error("4x output budget was bypassed");
    return { corruptCacheRecovered: true, cancelled: true, oversizedOutputRefused: true };
  });
  rows.push(safety);
  await writeFile("/workspace/r14-evidence/inference-check.json", JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await browser.close();
}
