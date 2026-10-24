/** Real UI OCR/approval/native/raster/ZIP/project recovery. No OCR mocks. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
const production = new URL(base).hostname === "inkstrip-manhwa-studio.vercel.app",
  expected = process.argv[3];
assert.ok(production || ["127.0.0.1", "localhost"].includes(new URL(base).hostname));
if (production)
  assert.match(expected ?? "", /^[a-f0-9]{40}$/i, "Supply the intended production SHA");
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(production && process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {}),
});
async function state(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("inkstrip-pro");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const tx = db.transaction("sessions"),
        sessions = await new Promise((resolve) => {
          const r = tx.objectStore("sessions").getAll();
          r.onsuccess = () => resolve(r.result);
        });
      return sessions.map((s) => ({
        id: s.id,
        doc: s.session.document,
        assets: Object.keys(s.session.assets),
        source: s.session.assets.source?.size,
      }));
    } finally {
      db.close();
    }
  });
}
async function saved(page) {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
    .waitFor();
}
async function tab(page, name) {
  await page
    .getByRole("navigation", { name: "Pro panels", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function download(page, button, name) {
  const pending = page.waitForEvent("download", { timeout: 120000 });
  await page.getByRole("button", { name: button, exact: true }).click();
  const d = await pending,
    path = `/workspace/screenshots/${name}`;
  await d.saveAs(path);
  return path;
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(45000);
  await page.goto(base);
  if (production)
    assert.equal(
      await page.locator('meta[name="inkstrip-release"]').getAttribute("content"),
      expected,
    );
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByPlaceholder("Night Market").fill("Dialogue workflow");
  await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await page.getByText("Chapter workspace", { exact: true }).waitFor();
  const chapterUrl = page.url();
  const source = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    const x = c.getContext("2d");
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 640, 480);
    x.fillStyle = "#111";
    x.font = "32px Arial";
    x.fillText("EVERY FRAME", 170, 250);
    return c.toDataURL().split(",")[1];
  });
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      { name: "ocr-fixture.png", mimeType: "image/png", buffer: Buffer.from(source, "base64") },
      { name: "second-page.png", mimeType: "image/png", buffer: Buffer.from(source, "base64") },
    ]);
  await page.getByRole("button", { name: "Edit Image ocr-fixture.png", exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit Image second-page.png", exact: true }).waitFor();
  await page.getByRole("button", { name: "Text & Bubbles", exact: true }).click();
  await page.getByRole("button", { name: "Edit dialogue · ocr-fixture.png", exact: true }).click();
  await page.getByRole("button", { name: "Full editor", exact: true }).click();
  await page.getByRole("button", { name: "Detect text locally", exact: true }).click();
  await page.getByLabel("Original OCR", { exact: true }).waitFor({ timeout: 180000 });
  const recognized = await page.getByLabel("Original OCR", { exact: true }).inputValue();
  assert.match(recognized, /EVERY FRAME/);
  await page.getByLabel("Corrected original", { exact: true }).fill("Every frame");
  await page.getByLabel("Replacement text", { exact: true }).fill("A NEW WORLD");
  for (const [key, value] of Object.entries({ x: 160, y: 210, width: 280, height: 60 }))
    await page.getByLabel(`Review ${key}`, { exact: true }).fill(String(value));
  await saved(page);
  const before = await state(page);
  assert.equal(before[0].doc.layers.filter((l) => l.dialogueRole === "cleanup").length, 0);
  await page.getByRole("button", { name: "Preview flat background cleanup", exact: true }).click();
  await page.getByRole("button", { name: "Approve dialogue preview", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Save dialogue to chapter", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    (await state(page))[0].doc.layers.filter((l) => l.dialogueRole === "cleanup").length,
    0,
    "preview must not be autosaved",
  );
  await page.getByRole("button", { name: "Cancel dialogue operation", exact: true }).click();
  await page.getByRole("button", { name: "Preview flat background cleanup", exact: true }).click();
  await page.getByRole("button", { name: "Approve dialogue preview", exact: true }).click();
  await saved(page);
  assert.equal(
    (await state(page))[0].doc.layers.filter((l) => l.dialogueRole === "cleanup").length,
    1,
  );
  await page.getByRole("button", { name: "Preview replacement lettering", exact: true }).click();
  await page.getByRole("button", { name: "Approve dialogue preview", exact: true }).click();
  await page.getByRole("button", { name: "Approve reviewed region", exact: true }).click();
  await saved(page);
  await page.getByLabel("Replacement text", { exact: true }).fill("A NEW WORLD!");
  assert.equal(
    await page.getByRole("button", { name: "Approve reviewed region", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Preview replacement lettering", exact: true }).click();
  await page.getByRole("button", { name: "Approve dialogue preview", exact: true }).click();
  await page.getByRole("button", { name: "Approve reviewed region", exact: true }).click();
  await saved(page);
  const accepted = await state(page);
  assert.equal(accepted[0].doc.dialogue.regions[0].status, "approved");
  assert.equal(accepted[0].doc.layers.filter((l) => l.dialogueRole === "text").length, 1);
  await page.getByRole("button", { name: "Pro undo", exact: true }).click();
  await page.getByRole("button", { name: "Pro redo", exact: true }).click();
  await saved(page);
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
    return c?.width === 640 && c.getAttribute("aria-busy") === "false";
  });
  await page.screenshot({
    path: "/workspace/screenshots/dialogue-approved-desktop.png",
    fullPage: true,
  });
  await tab(page, "Export");
  const native = await download(page, "Export editable .inkstrip", "dialogue-workflow.inkstrip");
  const file = JSON.parse(await readFile(native, "utf8"));
  assert.equal(file.version, 7);
  assert.equal(file.document.dialogue.regions[0].replacement, "A NEW WORLD!");
  assert.equal(file.assets.source.data, source, "original PNG bytes unchanged");
  for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
    await page.getByLabel("Pro export format", { exact: true }).selectOption(mime);
    const path = await download(
      page,
      "Export composite · 640 × 480",
      `dialogue-workflow.${mime.split("/")[1]}`,
    );
    const pixels = await page.evaluate(
      async (bytes) => {
        const b = await createImageBitmap(new Blob([new Uint8Array(bytes)])),
          c = document.createElement("canvas");
        c.width = b.width;
        c.height = b.height;
        const x = c.getContext("2d");
        x.drawImage(b, 0, 0);
        b.close();
        return { width: c.width, height: c.height, p: [...x.getImageData(5, 5, 1, 1).data] };
      },
      [...(await readFile(path))],
    );
    assert.deepEqual([pixels.width, pixels.height], [640, 480]);
    assert.deepEqual(pixels.p, [255, 255, 255, 255]);
  }
  const layered = await download(page, "Export layered assets ZIP", "dialogue-layered.zip");
  const listing = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps(z.namelist()))",
        layered,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.ok(listing.includes("project.inkstrip"));
  assert.ok(listing.some((n) => n.startsWith("layers/")));
  await page.getByRole("button", { name: "Save dialogue to chapter", exact: true }).click();
  await page
    .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
      exact: true,
    })
    .waitFor();
  const preserved = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const panels = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    const p = panels.find((p) => p.name === "ocr-fixture.png"),
      blob = await new Promise((resolve) => {
        const r = db.transaction("blobs").objectStore("blobs").get(p.original.blobId);
        r.onsuccess = () => resolve(r.result);
      });
    db.close();
    return {
      changed: p.blobId !== p.original.blobId,
      original: btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()))),
    };
  });
  assert.equal(preserved.changed, true);
  assert.equal(preserved.original, source);
  await page.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Inkstrip Dialogue Studio", exact: true })
    .waitFor({ state: "detached" });
  await page.getByText("Professional Chapter export", { exact: true }).click();
  const batch = await download(page, "Export Chapter ZIP", "dialogue-chapter.zip");
  const batchListing = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps(z.namelist()))",
        batch,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.ok(batchListing.includes("0001-ocr-fixture.png.png"));
  assert.ok(batchListing.includes("0002-second-page.png.png"));
  await page.getByRole("link", { name: "Back to Dialogue workflow", exact: true }).click();
  const backup = await download(page, "Backup", "dialogue-project.inkstrip-project");
  const recovered = await browser.newContext({
      viewport: { width: 390, height: 900 },
      hasTouch: true,
    }),
    rp = await recovered.newPage();
  rp.setDefaultTimeout(45000);
  rp.on("pageerror", (e) => errors.push(e.message));
  await rp.goto(base);
  await rp.locator('input[accept=".inkstrip-project"]').setInputFiles(backup);
  await rp.waitForURL(/\/p\//);
  await rp.goto(chapterUrl);
  await rp.getByRole("button", { name: "Text & Bubbles", exact: true }).click();
  await rp.getByRole("button", { name: "Edit dialogue · ocr-fixture.png", exact: true }).click();
  await rp.getByRole("button", { name: "Detect text locally", exact: true }).waitFor();
  await saved(rp);
  const restored = await state(rp);
  assert.deepEqual(restored[0].doc, accepted[0].doc);
  assert.deepEqual(errors, []);
  await rp.waitForFunction(() => {
    const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
    return c?.width === 640 && c.getAttribute("aria-busy") === "false";
  });
  await rp.screenshot({
    path: "/workspace/screenshots/dialogue-recovery-mobile.png",
    fullPage: true,
  });
  await writeFile(
    "/workspace/screenshots/dialogue-workflow-results.json",
    JSON.stringify(
      {
        recognized,
        realOcr: true,
        previewCancellation: true,
        approval: true,
        undoRedo: true,
        originalUnchanged: true,
        chapterApplicationOriginalRetained: true,
        native: 7,
        rasterFormats: ["png", "jpeg", "webp"],
        layered: listing,
        chapter: batchListing,
        backupFreshProfile: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Dialogue workflow: real OCR, approved cleanup/text, history, native, PNG/JPEG/WebP, layered/Chapter ZIP and fresh-profile project recovery passed.",
  );
  await recovered.close();
  await context.close();
} catch (e) {
  for (const c of browser.contexts())
    for (const p of c.pages())
      await p
        .screenshot({
          path: "/workspace/screenshots/dialogue-workflow-failure.png",
          fullPage: true,
        })
        .catch(() => {});
  throw e;
} finally {
  await browser.close();
}
