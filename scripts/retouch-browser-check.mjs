/** Local deterministic fixtures only; optional upstream anime image supplied explicitly for detector QA. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(30000);
try {
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByPlaceholder("Night Market").fill("Retouch QA");
  await page.getByRole("button", { name: "Create chapter 1" }).click();
  const fixture = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const x = c.getContext("2d");
    x.fillStyle = "rgb(80,100,120)";
    x.fillRect(0, 0, 128, 96);
    x.fillStyle = "rgb(240,20,20)";
    x.fillRect(55, 40, 15, 15);
    return c.toDataURL().split(",")[1];
  });
  const files = [
    { name: "repair.png", mimeType: "image/png", buffer: Buffer.from(fixture, "base64") },
  ];
  if (process.argv[3])
    files.push({
      name: "anime-detector-qa.png",
      mimeType: "image/png",
      buffer: await readFile(process.argv[3]),
    });
  await page.locator("input[type=file]").first().setInputFiles(files);
  const open = async (name) => {
    await page.getByRole("button", { name: `Edit Image ${name}`, exact: true }).click();
    await page.getByRole("button", { name: "Object Eraser & Retouch", exact: true }).click();
    await page.getByRole("dialog", { name: "Object Eraser & Retouch", exact: true }).waitFor();
  };
  await open("repair.png");
  await page.getByLabel("Selection shape", { exact: true }).selectOption("rectangle");
  const selection = page.getByLabel("Retouch selection", { exact: true });
  const r = await selection.boundingBox();
  await page.mouse.move(r.x + r.width * 0.39, r.y + r.height * 0.34);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.62, r.y + r.height * 0.64, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Preview removal", exact: true }).click();
  await page.getByRole("button", { name: "Accept preview", exact: true }).waitFor();
  const decoded = await page
    .getByAltText("Retouch image preview", { exact: true })
    .evaluate(async (img) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      return {
        width: c.width,
        height: c.height,
        center: [...x.getImageData(60, 46, 1, 1).data],
        outside: [...x.getImageData(8, 8, 1, 1).data],
      };
    });
  assert.deepEqual([decoded.width, decoded.height], [128, 96]);
  assert.deepEqual(decoded.outside, [80, 100, 120, 255]);
  assert.ok(decoded.center[0] < 160, "unwanted red object replaced by background texture");
  await page.getByRole("button", { name: "Accept preview", exact: true }).click();
  await page.getByRole("button", { name: "Undo result", exact: true }).click();
  await page.getByRole("button", { name: "Redo result", exact: true }).click();
  await page.getByRole("button", { name: "Save accepted image", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Object Eraser & Retouch", exact: true })
    .waitFor({ state: "hidden" });
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
  const state = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const panels = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    const panel = panels.find((p) => p.name === "repair.png");
    const blob = await new Promise((resolve) => {
      const r = db.transaction("blobs").objectStore("blobs").get(panel.original.blobId);
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return {
      original: btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()))),
      panel,
    };
  });
  assert.equal(state.original, fixture);
  assert.ok(state.panel.original);
  await page.reload();
  await page.getByRole("button", { name: "Edit Image repair.png", exact: true }).waitFor();
  if (process.argv[3]) {
    await open("anime-detector-qa.png");
    await page.getByRole("button", { name: "Detect possible anime faces", exact: true }).click();
    await page
      .getByRole("button", { name: "Select face 1", exact: true })
      .waitFor({ timeout: 120000 });
    const n = await page.getByRole("button", { name: /^Select face \d+$/ }).count();
    assert.ok(n > 0);
    console.log("Real trained anime cascade detected", n, "candidate faces in upstream example");
    await page.getByRole("button", { name: "Select face 1", exact: true }).click();
    await page.getByLabel("Face width percent", { exact: true }).fill("15");
    await page.getByLabel("Face width percent", { exact: true }).press("Tab");
  }
  assert.deepEqual(errors, []);
  console.log(
    "Retouch worker, mask, output pixels, accepted save, original bytes, reload, face selection: PASS",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  console.error(errors);
  throw error;
} finally {
  await browser.close();
}
