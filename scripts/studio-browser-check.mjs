/** Isolated browser data only. Run with a local dev server; never opens existing profiles. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] || "http://127.0.0.1:8080";
const origin = new URL(base);
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname), "Local QA servers only");
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } }
    : {}),
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("requestfailed", (request) =>
    console.log("Request failed:", new URL(request.url()).hostname, request.failure()?.errorText),
  );
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByPlaceholder("Night Market").fill("QA · preserved story");
  await page.getByRole("button", { name: "Create chapter 1" }).click();
  await page.getByText("Chapter workspace", { exact: true }).waitFor();
  const chapterUrl = page.url();
  const fixtures = await page.evaluate(() =>
    [
      { name: "page-1.png", width: 32, height: 48 },
      { name: "page-2.png", width: 32, height: 48 },
      { name: "long-page.png", width: 96, height: 1800 },
    ].map((item) => {
      const canvas = document.createElement("canvas");
      canvas.width = item.width;
      canvas.height = item.height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#faf6ed";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#202c39";
      ctx.fillRect(4, 4, canvas.width - 8, canvas.height / 2);
      ctx.fillStyle = "#a9e6d9";
      ctx.fillRect(8, 8, 10, 15);
      ctx.fillStyle = "#151515";
      ctx.font = "8px sans-serif";
      ctx.fillText("INK", 5, canvas.height - 6);
      return { name: item.name, data: canvas.toDataURL("image/png").split(",")[1] };
    }),
  );
  await page.locator('input[type="file"]').setInputFiles(
    fixtures.map((item) => ({
      name: item.name,
      mimeType: "image/png",
      buffer: Buffer.from(item.data, "base64"),
    })),
  );
  await page.getByRole("button", { name: "AI Enhance page-1.png", exact: true }).waitFor();
  await page.getByRole("button", { name: "Display 3", exact: true }).waitFor();
  await page.getByRole("button", { name: "Display 3", exact: true }).click();
  await page.locator(".manhwa-image").first().waitFor({ state: "visible" });
  const images = page.locator(".manhwa-image");
  assert.ok((await images.count()) > 0);
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".reader-chapter-info").getAttribute("data-hidden"), "true");
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".reader-chapter-info").getAttribute("data-hidden"), "false");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Panels", exact: true }).click();
  // Enhance the accepted crop, while retaining the imported original for recovery.
  await page.getByRole("button", { name: "Edit Image page-1.png", exact: true }).click();
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  for (const [label, value] of [
    ["Crop width", "16"],
    ["Crop height", "24"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press("Tab");
  }
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await page.getByLabel("Brightness", { exact: true }).fill("5");
  await page.getByLabel("Brightness", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
  const acceptedBeforeAI = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const panels = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return panels.map((p) => [p.id, p.blobId]);
  });
  await page.getByRole("button", { name: "AI Enhance page-1.png", exact: true }).click();
  await page.getByRole("button", { name: "Enhance image", exact: true }).click();
  console.log("Running real Swin2SR inference on an adjusted 16×24 crop…");
  const timer = setInterval(async () => {
    try {
      console.log(
        (await page.locator(".ai-progress, .ai-message").first().innerText()).slice(0, 180),
      );
    } catch {
      /* Processing finished. */
    }
  }, 15000);
  try {
    await page.locator(".ai-message").waitFor({ state: "visible", timeout: 240000 });
    assert.match(await page.locator(".ai-message").innerText(), /Ready to compare/);
    await page.getByRole("button", { name: "Apply 1 preview(s)", exact: true }).waitFor();
  } catch (error) {
    console.log("AI status:", await page.locator('[role="dialog"]').innerText());
    throw error;
  } finally {
    clearInterval(timer);
  }
  assert.ok(
    (await page.getByAltText("AI enhanced artwork").getAttribute("src")).startsWith("blob:"),
  );
  await page.getByRole("slider", { name: "Before and after comparison" }).focus();
  await page.getByRole("slider", { name: "Before and after comparison" }).press("ArrowRight");
  await page.screenshot({
    path: "/workspace/screenshots/inkstrip-ai-comparison.png",
    fullPage: true,
  });
  // Inject one quota failure and verify that the original panel record survives.
  await page.evaluate(() => {
    window.__originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "blobs") throw new DOMException("QA quota failure", "QuotaExceededError");
      return window.__originalPut.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Apply 1 preview(s)", exact: true }).click();
  await page.getByText(/0 image\(s\) applied/).waitFor();
  const failedSaveOriginal = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const panels = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    IDBObjectStore.prototype.put = window.__originalPut;
    return panels.map((panel) => [panel.id, panel.blobId]);
  });
  assert.deepEqual(
    failedSaveOriginal,
    acceptedBeforeAI,
    "A failed save must not replace any accepted record",
  );
  await page.getByRole("button", { name: "Apply 1 preview(s)", exact: true }).click();
  await page.getByText(/Applied 1 image/).waitFor();
  const enhancedSize = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const panels = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    const panel = panels.find((p) => p.name === "page-1.png");
    return [panel.width, panel.height, !!panel.edit];
  });
  assert.deepEqual(
    enhancedSize,
    [32, 48, false],
    "AI must upscale the accepted crop rather than reopening the uncropped import",
  );

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "AI Enhance page-1.png", exact: true }).click();
  await page.getByRole("button", { name: "Recover originals", exact: true }).click();
  await page.getByText(/Restored 1 original/).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  // Single-image enhancement must not change any unrelated image or chapter.
  const saved = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const read = (store) =>
      new Promise((resolve) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const panels = await read("panels");
    const chapters = await read("chapters");
    const blobs = [];
    for (const panel of panels) {
      const blob = await new Promise((resolve) => {
        const r = db.transaction("blobs").objectStore("blobs").get(panel.blobId);
        r.onsuccess = () => resolve(r.result);
      });
      blobs.push({
        name: panel.name,
        data: btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()))),
      });
    }
    db.close();
    return { panels, chapters, blobs };
  });
  assert.equal(saved.panels.length, 3);
  assert.equal(saved.chapters.length, 1);
  for (const fixture of fixtures)
    assert.equal(
      saved.blobs.find((item) => item.name === fixture.name).data,
      fixture.data,
      "Original bytes must survive recovery",
    );
  // Cancellation terminates the worker, leaves no original overwritten.
  await page.getByRole("button", { name: "AI Enhance page-1.png", exact: true }).click();
  await page.getByRole("button", { name: "Enhance image", exact: true }).click();
  await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
  await page.getByText(/Cancelled\./).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Uncheck long-page.png", exact: true }).click();
  await page.getByRole("button", { name: "AI Enhance · 2 selected", exact: true }).click();
  await page.getByRole("button", { name: "Enhance 2 images", exact: true }).click();
  await page
    .getByRole("button", { name: "Apply 2 preview(s)", exact: true })
    .waitFor({ state: "visible", timeout: 180000 });
  await page.getByText("Ready to compare.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Apply 2 preview(s)", exact: true }).click();
  await page.getByText(/Applied 2 image/).waitFor();
  await page.getByRole("button", { name: "Recover originals", exact: true }).click();
  await page.getByText(/Restored 2 original/).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({
    path: "/workspace/screenshots/inkstrip-editor-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    "Mobile must not overflow",
  );
  assert.deepEqual(errors, [], "No runtime errors");
  console.log(
    JSON.stringify({
      ok: true,
      chapterUrl,
      checks: [
        "create/import/stitch",
        "scroll direction",
        "real neural inference",
        "comparison",
        "apply/reload/byte-exact original recovery",
        "cancellation",
        "batch enhancement and recovery",
        "mobile overflow",
      ],
    }),
  );
} finally {
  await browser.close();
}
