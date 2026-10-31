/** Real Fast Anime inference and user transactions at five widths. Isolated data;
 * no paid endpoint, mocked image output, or production writes. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { proBrowserFixtures } from "../pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080",
  browser = await chromium.launch({
    args: ["--no-sandbox"],
    ...(process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } }
      : {}),
  }),
  errors = [],
  results = [];
await mkdir("/workspace/screenshots", { recursive: true });
try {
  for (const width of [1440, 768, 390, 360, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
      }),
      p = await context.newPage(),
      fx = proBrowserFixtures(base, errors);
    await p.route("**/api/studio/ai-edit", () => {
      throw Error("R14 must not invoke paid inference");
    });
    const source = await fx.start(p);
    await p.getByRole("button", { name: "AI Enhance geometry.png", exact: true }).click();
    assert.equal(
      await p.getByLabel("Restoration preset", { exact: true }).inputValue(),
      "fidelity",
    );
    await p.getByLabel("Enhancement model", { exact: true }).selectOption("realesrgan-anime");
    await p.getByLabel("Output size", { exact: true }).selectOption("4");
    await p.getByRole("button", { name: "Enhance image", exact: true }).click();
    await p
      .getByText("Ready to compare. Zoom in on lettering and faces before applying.", {
        exact: true,
      })
      .waitFor({ timeout: 120000 });
    await p.getByLabel("Restoration preset", { exact: true }).selectOption("gentle-cleanup");
    assert.equal(
      await p.getByRole("button", { name: "Apply 1 preview(s)", exact: true }).isEnabled(),
      false,
      "stale settings cannot apply a different preview",
    );
    await p.getByLabel("Restoration preset", { exact: true }).selectOption("fidelity");
    assert.equal(
      await p.getByRole("button", { name: "Apply 1 preview(s)", exact: true }).isEnabled(),
      true,
    );
    await p.getByRole("button", { name: "100% comparison", exact: true }).click();
    const before = p.getByAltText("Original artwork", { exact: true }),
      after = p.getByAltText("AI enhanced artwork", { exact: true });
    await after.evaluate((i) => i.decode());
    await before.evaluate((i) => i.decode());
    const a = await after.boundingBox(),
      b = await before.boundingBox();
    assert.equal(a.width, 512);
    assert.equal(a.height, 384);
    assert.deepEqual(a, b, "before and after use exactly the same display geometry");
    await p.getByLabel("Before and after comparison", { exact: true }).fill("25");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({ path: `/workspace/screenshots/r14-enhance-${width}.png`, fullPage: true });
    await p.getByRole("button", { name: "Apply 1 preview(s)", exact: true }).click();
    await p.getByText(/Applied 1 image\(s\)/).waitFor();
    const applied = (await fx.records(p))[0];
    assert.deepEqual([applied.width, applied.height], [512, 384]);
    assert.ok(applied.original);
    await p.getByRole("button", { name: "Recover originals", exact: true }).click();
    await p.getByText(/Restored 1 original image/).waitFor();
    await p
      .getByRole("dialog", { name: "AI Enhance", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    const restored = (await fx.records(p))[0];
    assert.deepEqual([restored.width, restored.height], [128, 96]);
    const bytes = await p.evaluate(async (id) => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip");
        r.onsuccess = () => resolve(r.result);
      });
      const blob = await new Promise((resolve) => {
        const r = db.transaction("blobs").objectStore("blobs").get(id);
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    }, restored.blobId);
    assert.equal(bytes, source, "original encoded bytes recover exactly");
    await fx.open(p);
    const preview = await fx.preview(p);
    assert.deepEqual([preview.width, preview.height], [128, 96]);
    results.push({
      width,
      realFastAnime4x: true,
      actualPixelComparison: true,
      alpha: "covered by inference-check",
      applyRecoverSourceExact: true,
      rasterOpen: true,
      noOverflow: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await writeFile(
    "/workspace/r14-evidence/browser-check.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
