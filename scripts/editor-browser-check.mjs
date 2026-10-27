/** Phase 2 checks use isolated browser profiles and synthetic artwork, never a user's library. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
async function setup(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => {
    errors.push(e.stack || e.message);
    console.log("Runtime error:", e.stack);
  });
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByPlaceholder("Night Market").fill("Phase 2 QA");
  await page.getByRole("button", { name: "Create chapter 1" }).click();
  await page.getByText("Chapter workspace", { exact: true }).waitFor();
  const files = await page.evaluate(() =>
    ["quadrants.png", "second.png"].map((name, i) => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgb(255,10,10)";
      ctx.fillRect(0, 0, 64, 48);
      ctx.fillStyle = "rgb(10,240,10)";
      ctx.fillRect(64, 0, 64, 48);
      ctx.fillStyle = "rgb(10,10,240)";
      ctx.fillRect(0, 48, 64, 48);
      ctx.fillStyle = "rgb(240,220,10)";
      ctx.fillRect(64, 48, 64, 48);
      ctx.clearRect(0, 0, i ? 8 : 4, 4);
      return { name, data: canvas.toDataURL("image/png").split(",")[1] };
    }),
  );
  await page.locator('input[type="file"]').setInputFiles(
    files.map((f) => ({
      name: f.name,
      mimeType: "image/png",
      buffer: Buffer.from(f.data, "base64"),
    })),
  );
  await page.getByRole("button", { name: "Display 2", exact: true }).waitFor();
  return { page, files };
}
async function records(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const req = indexedDB.open("inkstrip");
      req.onsuccess = () => resolve(req.result);
    });
    const read = (name) =>
      new Promise((resolve) => {
        const req = db.transaction(name).objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result);
      });
    const [panels, chapters] = await Promise.all([read("panels"), read("chapters")]);
    db.close();
    return { panels: panels.sort((a, b) => a.order - b.order), chapters };
  });
}
async function blobInfo(page, id) {
  return page.evaluate(async (blobId) => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const blob = await new Promise((resolve) => {
      const r = db.transaction("blobs").objectStore("blobs").get(blobId);
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const center = [
      ...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data,
    ];
    const corner = [...ctx.getImageData(0, 0, 1, 1).data];
    const bytes = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    return { width: canvas.width, height: canvas.height, center, corner, bytes };
  }, id);
}
async function previewPixel(page, expected) {
  await page.waitForFunction(
    (rgba) => {
      const c = document.querySelector('canvas[aria-label="Edited preview"]');
      if (!c || c.width !== 96 || c.height !== 128) return false;
      const pixel = [...c.getContext("2d").getImageData(24, 32, 1, 1).data];
      return pixel.every((value, i) => value === rgba[i]);
    },
    expected,
    { timeout: 20000 },
  );
}
async function openEditor(page) {
  await page.getByRole("button", { name: "Edit Image quadrants.png", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas[aria-label="Edited preview"]');
    return c?.width === 128 && c.height === 96;
  });
}
async function waitValue(page, label, expected) {
  for (let i = 0; i < 50; i++) {
    if ((await page.getByLabel(label, { exact: true }).inputValue()) === expected) return;
    await page.waitForTimeout(100);
  }
  assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), expected);
}
async function number(page, label, value) {
  await page.getByLabel(label, { exact: true }).fill(String(value));
  await page.getByLabel(label, { exact: true }).press("Tab");
  await waitValue(page, label, String(value));
}
async function cancel(page, dirty = false) {
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  if (dirty) await page.getByRole("button", { name: "Discard edits", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
}
async function quota(page, store) {
  await page.evaluate((name) => {
    window.__editorPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === name) throw new DOMException("QA quota failure", "QuotaExceededError");
      return window.__editorPut.apply(this, args);
    };
  }, store);
}
async function endQuota(page) {
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__editorPut;
  });
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const { page, files } = await setup(desktop);
  const original = (await records(page)).panels[0];
  console.log("Desktop: context menu, double-click, keyboard, transforms and crop…");
  await page
    .getByRole("button", { name: "Select image quadrants.png", exact: true })
    .click({ button: "right" });
  await page.getByRole("button", { name: "Edit Image", exact: true }).click();
  await page.getByLabel("Output width", { exact: true }).waitFor();
  await cancel(page);
  await page.getByRole("button", { name: "Select image quadrants.png", exact: true }).dblclick();
  await page.getByLabel("Output width", { exact: true }).waitFor();
  await cancel(page);
  await page.getByRole("button", { name: "Select image quadrants.png", exact: true }).focus();
  await page.keyboard.press("e");
  await page.getByLabel("Output width", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await waitValue(page, "Output width", "96");
  await waitValue(page, "Output height", "128");
  await previewPixel(page, [10, 10, 240, 255]);
  await page.getByRole("button", { name: "Flip horizontally", exact: true }).click();
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Flip horizontally" }).getAttribute("aria-pressed"),
    "false",
  );
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Flip horizontally" }).getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Flip vertically", exact: true }).click();
  await previewPixel(page, [10, 240, 10, 255]);
  await page.getByRole("button", { name: "Reset all edits", exact: true }).click();
  await number(page, "Rotation degrees", 12.5);
  await waitValue(page, "Rotation degrees", "12.5");
  await page.getByRole("button", { name: "Reset all edits", exact: true }).click();
  await page.getByRole("button", { name: "Lock aspect ratio", exact: true }).click();
  await number(page, "Output width", 64);
  await waitValue(page, "Output height", "96");
  await page.getByRole("button", { name: "Reset size", exact: true }).click();
  await page.getByRole("button", { name: "Lock aspect ratio", exact: true }).click();
  await page.getByRole("button", { name: "Fit chapter width", exact: true }).click();
  await waitValue(page, "Output width", "800");
  await page.getByRole("button", { name: "Reset all edits", exact: true }).click();
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await page.getByLabel("Crop aspect ratio", { exact: true }).selectOption("1");
  await waitValue(page, "Crop width", "96");
  await page.getByRole("button", { name: "Reset crop", exact: true }).click();
  await number(page, "Crop width", 64);
  await number(page, "Crop height", 48);
  await page.getByRole("button", { name: "Transform", exact: true }).click();
  await number(page, "Scale percent", 200);
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await waitValue(page, "Output width", "96");
  await waitValue(page, "Output height", "128");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.equal(await page.getByLabel("Preview zoom", { exact: true }).innerText(), "125%");
  const stage = page.getByLabel("Image editing viewport", { exact: true });
  const stageBox = await stage.boundingBox();
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    stageBox.x + stageBox.width / 2 + 30,
    stageBox.y + stageBox.height / 2 + 20,
  );
  await page.mouse.up();
  assert.notEqual(await stage.getAttribute("data-pan"), "0,0");
  await page.getByRole("button", { name: "Fit image to viewport", exact: true }).click();
  await page.getByRole("button", { name: "After", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Before", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Before", exact: true }).click();
  await page.screenshot({ path: "/workspace/screenshots/phase2-editor-desktop.png" });
  await quota(page, "blobs");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "out of space" }).waitFor();
  assert.equal((await records(page)).panels[0].blobId, original.blobId);
  await endQuota(page);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
  let saved = (await records(page)).panels[0];
  assert.equal(saved.width, 96);
  assert.equal(saved.height, 128);
  assert.equal(saved.original.blobId, original.blobId);
  assert.equal(saved.edit.source.blobId, original.blobId);
  const output = await blobInfo(page, saved.blobId);
  assert.deepEqual(
    output.center,
    [255, 10, 10, 255],
    "Crop/rotation/resize must render expected source pixels",
  );
  await page.reload();
  await page.getByRole("button", { name: "Edit Image quadrants.png", exact: true }).click();
  await page.getByLabel("Output width", { exact: true }).waitFor();
  await waitValue(page, "Output width", "96");
  await waitValue(page, "Rotation degrees", "90");
  await number(page, "Output width", 48);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
  saved = (await records(page)).panels[0];
  assert.equal(saved.width, 48);
  assert.equal(saved.height, 64);
  assert.equal(saved.edit.source.blobId, original.blobId);
  await page.getByRole("button", { name: "Edit Image quadrants.png", exact: true }).click();
  await page.getByRole("button", { name: "Restore original", exact: true }).click();
  await cancel(page, true);
  assert.equal((await records(page)).panels[0].blobId, saved.blobId);
  await page.getByRole("button", { name: "Edit Image quadrants.png", exact: true }).click();
  await page.getByRole("button", { name: "Restore original", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
  assert.equal((await records(page)).panels[0].blobId, original.blobId);
  assert.equal((await blobInfo(page, original.blobId)).bytes, files[0].data);
  console.log("Desktop: byte-exact recovery, persistence and quota rollback passed.");
  await openEditor(page);
  await number(page, "Output width", 10000);
  assert.equal(
    await page.getByRole("button", { name: "Save changes", exact: true }).isDisabled(),
    true,
  );
  await cancel(page, true);
  await page.getByText("Chapter settings", { exact: true }).click();
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  await page.getByRole("button", { name: "Display 2", exact: true }).click();
  await page.locator(".manhwa-image").first().waitFor();
  const oldStrip = (await records(page)).chapters[0].strip;
  await openEditor(page);
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
  assert.equal(
    await page.getByRole("button", { name: "Save", exact: true }).isDisabled(),
    true,
    "Stale chapter exports must require rebuilding",
  );
  await quota(page, "chapters");
  await page.getByRole("button", { name: "Display 2", exact: true }).click();
  await page.getByText("This device is out of space", { exact: false }).waitFor();
  assert.equal((await records(page)).chapters[0].strip.parts[0].blobId, oldStrip.parts[0].blobId);
  assert.ok(
    await blobInfo(page, oldStrip.parts[0].blobId),
    "Previous export remains readable after a failed rebuild",
  );
  await endQuota(page);
  await page.getByRole("button", { name: "Display 2", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save")
        ?.disabled,
  );
  assert.equal((await records(page)).chapters[0].strip.format, "image/png");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  assert.match((await download).suggestedFilename(), /\.png$/);
  await desktop.close();

  console.log("Mobile: native long press, scroll cancellation, crop drawing and pan…");
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const { page: phone } = await setup(mobile);
  const target = phone.getByRole("button", {
    name: "Select image quadrants.png",
    exact: true,
  });
  await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await phone.waitForTimeout(500);
  const box = await target.boundingBox();
  const cdp = await mobile.newCDPSession(phone);
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await phone.waitForTimeout(650);
  await phone.getByRole("dialog", { name: "Image tools", exact: true }).waitFor();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await phone.getByRole("dialog", { name: "Image tools", exact: true }).waitFor();
  await phone.getByRole("button", { name: "Edit Image", exact: true }).click();
  await phone.getByLabel("Output width", { exact: true }).waitFor();
  await phone.waitForFunction(
    () => document.querySelector('canvas[aria-label="Edited preview"]')?.width === 128,
  );
  await phone.getByRole("button", { name: "Crop", exact: true }).click();
  const imageBox = await phone.locator(".image-plane").boundingBox();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: imageBox.x + imageBox.width * 0.2, y: imageBox.y + imageBox.height * 0.2 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: imageBox.x + imageBox.width * 0.7, y: imageBox.y + imageBox.height * 0.7 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.ok(Number(await phone.getByLabel("Crop width", { exact: true }).inputValue()) < 128);
  await phone.getByRole("button", { name: "Undo edit", exact: true }).click();
  await waitValue(phone, "Crop width", "128");
  await phone.getByRole("button", { name: "Redo edit", exact: true }).click();
  await phone.screenshot({ path: "/workspace/screenshots/phase2-editor-mobile.png" });
  assert.equal(
    await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await cancel(phone, true);
  await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  const moved = await target.boundingBox();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 - 45 }],
  });
  await phone.waitForTimeout(650);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.equal(
    await phone.getByRole("dialog", { name: "Image tools", exact: true }).count(),
    0,
    "Scrolling must cancel long press",
  );
  assert.equal((await records(phone)).panels[0].name, "quadrants.png");
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "desktop edit access",
        "rotate/flip/resize/crop",
        "history",
        "before/after",
        "zoom/pan",
        "preview pixels",
        "recipe persistence",
        "quota rollback",
        "byte-exact recovery",
        "export rebuild and format",
        "mobile long press",
        "scroll cancellation",
        "touch crop",
        "no overflow/runtime errors",
      ],
    }),
  );
} finally {
  await browser.close();
}
