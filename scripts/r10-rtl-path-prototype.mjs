/** Isolated browser shaping experiment. Does not replace the native R9 path renderer. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const p = await browser.newPage({ viewport: { width: 1000, height: 760 } }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const samples = ["السلام عليكم", "مَرْحَبًا بالعالم", "الفصل 12 — Inkstrip Studio"];
  const escape = (t) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="#101918"/><defs>${samples.map((_, i) => `<path id="baseline-${i}" d="M60 ${100 + i * 180} C280 ${50 + i * 180} 660 ${150 + i * 180} 900 ${100 + i * 180}"/>`).join("")}</defs><g font-family="Arial" font-size="36" fill="#a6edda">${samples.map((s, i) => `<text id="path-${i}" direction="rtl" unicode-bidi="plaintext"><textPath href="#baseline-${i}" startOffset="100%">${escape(s)}</textPath></text><text id="straight-${i}" x="900" y="${160 + i * 180}" direction="rtl" unicode-bidi="plaintext">${escape(s)}</text>`).join("")}</g></svg>`;
  await p.setContent(
    `<html lang="ar"><body style="background:#101918;color:#e7edea"><h1>Shaped runs on native SVG textPath — isolated prototype</h1>${svg}</body></html>`,
  );
  await p.evaluate(() => document.fonts.ready);
  const metrics = await p.evaluate((samples) => {
    const c = document.createElement("canvas"),
      ctx = c.getContext("2d");
    ctx.font = "36px Arial";
    return samples.map((s, i) => ({
      text: s,
      pathLength: document.getElementById(`path-${i}`).getComputedTextLength(),
      ordinaryLength: document.getElementById(`straight-${i}`).getComputedTextLength(),
      wholeRun: ctx.measureText(s).width,
      isolatedLetters: [...s].reduce((n, char) => n + ctx.measureText(char).width, 0),
    }));
  }, samples);
  assert.ok(
    metrics[0].wholeRun < metrics[0].isolatedLetters,
    "whole-run shaping changes connected Arabic advances",
  );
  const render = () =>
    p.evaluate(async (svg) => {
      const b = await createImageBitmap(new Blob([svg], { type: "image/svg+xml" })),
        c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      c.getContext("2d").drawImage(b, 0, 0);
      b.close();
      const bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r))).arrayBuffer());
      return {
        pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
        png: [...bytes],
      };
    }, svg);
  let workerDecodeError = null;
  try {
    await render();
  } catch (error) {
    workerDecodeError = error.message;
  }
  // Window SVG image export is a separate experiment, not a worker fallback in
  // the application. Keep both observed limitations in the resulting evidence.
  const renderWindow = () =>
    p.evaluate(async (svg) => {
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = 960;
        c.height = 640;
        c.getContext("2d").drawImage(image, 0, 0);
        const bytes = new Uint8Array(
          await (await new Promise((resolve) => c.toBlob(resolve))).arrayBuffer(),
        );
        return {
          pixels: [...c.getContext("2d").getImageData(0, 0, 960, 640).data],
          png: [...bytes],
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    }, svg);
  const a = await renderWindow(),
    b = await renderWindow();
  assert.deepEqual(a.pixels, b.pixels, "same shaped SVG produces pixel-identical raster export");
  assert.deepEqual(a.png, b.png);
  assert.deepEqual(errors, []);
  await mkdir("/workspace/screenshots", { recursive: true });
  await p.screenshot({ path: "/workspace/screenshots/r10-rtl-prototype.png" });
  await writeFile("/workspace/r10-evidence/rtl-prototype.svg", svg);
  const report = {
    prototypeOnly: true,
    workerDecodeError,
    windowExportPixelExact: true,
    productionGuardPreserved: true,
    metrics,
    pixelTolerance: 0,
    errors,
    font: "Arial with system Arabic fallback",
    portableEmbeddedFonts: false,
    workerFontParityUnverified: true,
    metricsParityVerified: metrics.every(
      (m) => Math.round(m.pathLength * 64) === Math.round(m.ordinaryLength * 64),
    ),
  };
  await writeFile("/workspace/r10-evidence/rtl-prototype.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(
    workerDecodeError,
    null,
    "native worker SVG decoding must succeed before production adoption",
  );
  for (const m of metrics) {
    assert.ok(m.pathLength > 0);
    assert.equal(
      Math.round(m.pathLength * 64),
      Math.round(m.ordinaryLength * 64),
      "SVG path retains whole-run shaped advances at browser 1/64px precision",
    );
  }
} finally {
  await browser.close();
}
