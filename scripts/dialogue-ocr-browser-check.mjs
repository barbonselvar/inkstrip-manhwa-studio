/** Actual pinned Tesseract inference on internally typeset Unicode fixtures. No mock inference. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } }
    : {}),
});
const results = [],
  errors = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 500)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 500));
  });
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).waitFor();
  for (const fixture of [
    { language: "eng", text: "A WORLD IN EVERY FRAME", font: "Arial" },
    { language: "kor", text: "새로운 이야기가 시작됩니다", font: "Noto Sans CJK KR" },
    { language: "ara", text: "مرحبا بالعالم", font: "Noto Sans Arabic" },
    { language: "jpn", text: "次の駅で会おう", font: "Noto Sans CJK JP" },
    { language: "jpn_vert", text: "次の駅で会おう", font: "Noto Sans CJK JP" },
  ]) {
    const result = await page.evaluate(async (fixture) => {
      const { LocalOcr } = await import("/src/lib/studio/dialogue/ocr.ts");
      const c = document.createElement("canvas");
      c.width = fixture.language === "jpn_vert" ? 260 : 1100;
      c.height = fixture.language === "jpn_vert" ? 900 : 280;
      const x = c.getContext("2d");
      await document.fonts.load(`64px "${fixture.font}"`, fixture.text);
      x.fillStyle = "#fff";
      x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = "#111";
      x.font = `64px "${fixture.font}"`;
      if (fixture.language === "ara") {
        x.direction = "rtl";
        x.textAlign = "right";
        x.fillText(fixture.text, c.width - 40, 140);
      } else if (fixture.language === "jpn_vert") {
        x.textAlign = "center";
        [...fixture.text].forEach((s, i) => x.fillText(s, 130, 100 + i * 80));
      } else x.fillText(fixture.text, 40, 140);
      const input = x.getImageData(0, 0, c.width, c.height),
        before = input.data.slice();
      const ocr = new LocalOcr(),
        output = await ocr.recognize(input, fixture.language, { x: 13, y: 27 });
      if (!input.data.every((v, i) => v === before[i])) throw Error("OCR changed input pixels");
      return { ...output, expected: fixture.text, fixture: c.toDataURL() };
    }, fixture);
    const normalize = (s) => s.normalize("NFKC").replace(/[\s\p{P}]/gu, "");
    const expected = normalize(fixture.text),
      actual = normalize(result.text);
    let same = 0;
    for (const c of expected) if (actual.includes(c)) same++;
    result.characterCoverage = same / expected.length;
    assert.ok(result.text.trim().length > 0, "real OCR returns text");
    assert.ok(result.regions.length > 0, "real engine returns editable detection boundaries");
    assert.ok(result.regions.every((r) => r.x >= 13 && r.y >= 27 && r.width > 0 && r.height > 0));
    await mkdir("/workspace/screenshots", { recursive: true });
    await writeFile(
      `/workspace/screenshots/dialogue-ocr-${fixture.language}.png`,
      Buffer.from(result.fixture.split(",")[1], "base64"),
    );
    delete result.fixture;
    results.push(result);
    console.log(JSON.stringify(result));
  }
  let unexpectedModelRequests = 0;
  await page.route("https://raw.githubusercontent.com/**", (route) => {
    unexpectedModelRequests++;
    return route.abort();
  });
  const cachedInference = await page.evaluate(async () => {
    const { LocalOcr } = await import("/src/lib/studio/dialogue/ocr.ts");
    const c = new OffscreenCanvas(640, 200),
      x = c.getContext("2d");
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 640, 200);
    x.fillStyle = "#111";
    x.font = "48px Arial";
    x.fillText("CACHE WORKS", 30, 110);
    const output = await new LocalOcr().recognize(x.getImageData(0, 0, 640, 200), "eng");
    return { text: output.text, elapsedMs: output.elapsedMs };
  });
  assert.match(cachedInference.text, /CACHE WORKS/);
  assert.equal(
    unexpectedModelRequests,
    0,
    "real warm OCR uses verified cached model bytes without network retrieval",
  );
  const corruption = await page.evaluate(async () => {
    const [{ LocalOcr }, { OCR_SOURCE }] = await Promise.all([
      import("/src/lib/studio/dialogue/ocr.ts"),
      import("/src/lib/studio/dialogue/ocr-models.ts"),
    ]);
    const cache = await caches.open("inkstrip-ocr-verified-v1"),
      url = `${OCR_SOURCE}/eng.traineddata`;
    await cache.put(url, new Response(new Uint8Array([1, 2, 3, 4])));
    let message = "";
    try {
      await new LocalOcr().recognize(new ImageData(32, 32), "eng");
    } catch (e) {
      message = e.message;
    }
    return { message, removed: !(await cache.match(url)) };
  });
  assert.match(corruption.message, /incomplete/);
  assert.equal(corruption.removed, true);
  await page.unroute("https://raw.githubusercontent.com/**");
  const cancelled = await page.evaluate(async () => {
    const { LocalOcr } = await import("/src/lib/studio/dialogue/ocr.ts");
    const ocr = new LocalOcr();
    const job = ocr.recognize(new ImageData(32, 32), "eng");
    ocr.cancel();
    try {
      await job;
      return false;
    } catch (e) {
      return e.name === "AbortError";
    }
  });
  assert.equal(cancelled, true);
  assert.deepEqual(errors, []);
  const report = {
    results,
    cancelled,
    cachedInference,
    unexpectedModelRequests,
    corruption,
    errors,
    chromium: browser.version(),
    notes:
      "Character coverage is a diagnostic, not a character-error rate or proof of reliable OCR on real comics. Glyph fonts are system Noto in this QA host. No physical Android test.",
  };
  await writeFile(
    "/workspace/screenshots/dialogue-ocr-results.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
