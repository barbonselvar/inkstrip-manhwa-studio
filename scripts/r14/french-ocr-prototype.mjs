/** Real French OCR using the existing OcrRuntime, with a descriptor injected only
 * into this isolated research page. Production language/native enums are untouched.
 * No automatic translation output is simulated or claimed. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080",
  browser = await chromium.launch({
    args: ["--no-sandbox"],
    ...(process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } }
      : {}),
  });
try {
  const p = await browser.newPage();
  p.setDefaultTimeout(180000);
  await p.goto(new URL("/gallery/provenance.json", base).href);
  const result = await p.evaluate(async () => {
    const { OCR_MODELS } = await import("/src/lib/studio/dialogue/ocr-models.ts"),
      { OcrRuntime } = await import("/src/lib/studio/dialogue/ocr-runtime.ts");
    Object.defineProperty(OCR_MODELS, "fra", {
      value: {
        code: "fra",
        bytes: 1130365,
        sha256: "ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca",
      },
      configurable: true,
    });
    const c = new OffscreenCanvas(1100, 280),
      ctx = c.getContext("2d"),
      expected = "UNE HISTOIRE À PARIS";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1100, 280);
    ctx.font = "64px Arial";
    ctx.fillStyle = "black";
    ctx.fillText(expected, 45, 160);
    const runtime = new OcrRuntime();
    try {
      const r = await runtime.recognize(ctx.getImageData(0, 0, 1100, 280), "fra");
      return {
        expected,
        text: r.text,
        elapsedMs: r.elapsedMs,
        engine: r.engine,
        realFrenchWeights: true,
        prototypeOnly: true,
        nativeFrenchLanguageSupported: false,
        note: "Production French metadata needs an explicit compatibility strategy; no prototype regions were persisted. Machine translation remains unimplemented.",
      };
    } finally {
      runtime.cancel();
      delete OCR_MODELS.fra;
    }
  });
  await writeFile(
    "/workspace/r14-evidence/french-ocr-prototype.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  const normalize = (s) =>
    s
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  assert.equal(
    normalize(result.text),
    normalize(result.expected),
    "French words and accent must be recognized",
  );
} finally {
  await browser.close();
}
