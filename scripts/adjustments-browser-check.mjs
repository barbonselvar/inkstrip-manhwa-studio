/** Phase 3: isolated synthetic artwork, local QA servers only. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { applyAdjustments, NEUTRAL } from "../src/lib/studio/editor/adjustments.ts";
import { blendSelection, rasterizeMask } from "../src/lib/studio/editor/mask.ts";
import { sourceToOutput } from "../src/lib/studio/editor/geometry.ts";
const base = process.argv[2] || "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
async function setup(context, mobile = false) {
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByPlaceholder("Night Market").fill("Phase 3 QA");
  await page.getByRole("button", { name: "Create chapter 1" }).click();
  await page.getByText("Chapter workspace", { exact: true }).waitFor();
  const files = await page.evaluate(
    (phone) =>
      (phone
        ? [["tone.png", 128, 96]]
        : [
            ["tone.png", 128, 96],
            ["edges.png", 800, 480],
            ["large.png", 900, 1200],
          ]
      ).map(([name, width, height]) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (name === "tone.png") {
          ctx.fillStyle = "rgb(80,100,120)";
          ctx.fillRect(0, 0, width, height);
          ctx.clearRect(0, 0, 8, 8);
          ctx.clearRect(width - 8, height - 8, 8, 8);
          ctx.fillStyle = "rgba(80,100,120,.5)";
          ctx.fillRect(width - 8, height - 8, 8, 8);
        } else {
          const pixels = ctx.createImageData(width, height);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const i = (y * width + x) * 4;
              pixels.data.set(
                [
                  40 + ((x * 7 + y * 3) % 170),
                  50 + ((x * 5 + y * 11) % 160),
                  60 + ((x * 3 + y * 7) % 140),
                  x % 71 === 0 ? 128 : 255,
                ],
                i,
              );
            }
          ctx.putImageData(pixels, 0, 0);
          ctx.fillStyle = "rgb(10,10,10)";
          ctx.fillRect(380, 0, 8, height);
        }
        return { name, data: canvas.toDataURL("image/png").split(",")[1] };
      }),
    mobile,
  );
  await page.locator('input[type="file"]').setInputFiles(
    files.map((f) => ({
      name: f.name,
      mimeType: "image/png",
      buffer: Buffer.from(f.data, "base64"),
    })),
  );
  await page.getByRole("button", { name: `Edit Image ${files[0].name}`, exact: true }).waitFor();
  return { page, files };
}
async function records(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const panels = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return panels;
  });
}
async function decoded(page, id, recipe) {
  return page.evaluate(
    async ({ id, recipe }) => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip", 1);
        r.onsuccess = () => resolve(r.result);
      });
      const blob = await new Promise((resolve) => {
        const r = db.transaction("blobs").objectStore("blobs").get(id);
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      if (!blob) throw Error("Missing blob");
      const bitmap = await createImageBitmap(blob),
        canvas = document.createElement("canvas");
      canvas.width = recipe?.width ?? bitmap.width;
      canvas.height = recipe?.height ?? bitmap.height;
      const ctx = canvas.getContext("2d");
      if (recipe) {
        const m = recipe.matrix;
        ctx.imageSmoothingQuality = "high";
        ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        const c = recipe.crop;
        ctx.drawImage(bitmap, c.x, c.y, c.width, c.height, c.x, c.y, c.width, c.height);
      } else ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let binary = "";
      for (let i = 0; i < data.length; i += 16384)
        binary += String.fromCharCode(...data.subarray(i, i + 16384));
      const bytes = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.readAsDataURL(blob);
      });
      return { width: canvas.width, height: canvas.height, pixels: btoa(binary), bytes };
    },
    { id, recipe },
  );
}
async function number(page, label, value) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(String(value));
  await input.press("Tab");
  await page.waitForFunction(
    ({ label, value }) => {
      const labels = [...document.querySelectorAll("label")];
      const el = labels.find((el) => el.textContent.trim() === label)?.querySelector("input");
      return el?.value === String(value);
    },
    { label, value },
    { timeout: 10000 },
  );
}
async function open(page, name = "tone.png") {
  await page.getByRole("button", { name: `Edit Image ${name}`, exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector(".image-property-fields");
    return el && !el.disabled;
  });
}
async function pixel(page, x, y, rgba) {
  await page.waitForFunction(
    ({ x, y, rgba }) => {
      const c = document.querySelector('canvas[aria-label="Edited preview"]');
      if (!c || c.width <= x || c.height <= y) return false;
      const data = c.getContext("2d").getImageData(x, y, 1, 1).data;
      return rgba.every((v, i) => Math.abs(v - data[i]) <= 1);
    },
    { x, y, rgba },
    { timeout: 25000 },
  );
}
async function save(page) {
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
}
async function paint(page, x, y, cdp) {
  const box = await page.locator(".image-plane").boundingBox();
  const px = box.x + box.width * x,
    py = box.y + box.height * y;
  if (cdp) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: px, y: py }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.click(px, py);
  }
}
async function compareSaved(page, panel) {
  const recipe = panel.edit.recipe,
    source = await decoded(page, panel.edit.source.blobId, {
      ...recipe,
      matrix: sourceToOutput(recipe),
    }),
    accepted = await decoded(page, panel.blobId);
  let expected = applyAdjustments(
    new Uint8ClampedArray(Buffer.from(source.pixels, "base64")),
    recipe.width,
    recipe.height,
    recipe.adjustments ?? NEUTRAL,
  );
  if (recipe.selective) {
    const mask = rasterizeMask(
      recipe.selective.strokes,
      recipe.width,
      recipe.height,
      panel.edit.source.width,
      panel.edit.source.height,
      0,
      0,
      1,
      1,
      sourceToOutput(recipe),
    );
    expected = blendSelection(
      expected,
      applyAdjustments(expected, recipe.width, recipe.height, recipe.selective.adjustments),
      mask,
    );
  }
  const actual = Buffer.from(accepted.pixels, "base64");
  let maxDifference = 0;
  for (let i = 0; i < expected.length; i++) {
    if (i % 4 === 3) assert.equal(actual[i], expected[i], `alpha at ${i}`);
    else if (expected[i - (i % 4) + 3])
      maxDifference = Math.max(maxDifference, Math.abs(actual[i] - expected[i]));
  }
  assert.ok(
    maxDifference <= 2,
    `Tiled worker differs from whole-frame reference by ${maxDifference}`,
  );
  return accepted;
}
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const { page, files } = await setup(desktop);
  const original = (await records(page)).find((p) => p.name === "tone.png");
  await open(page);
  await number(page, "Output width", 115);
  await number(page, "Artwork scale percent", 91);
  await page.getByRole("button", { name: "Align right", exact: true }).click();
  assert.equal(
    await page.getByLabel("Artwork X offset", { exact: true }).evaluate((el) => el.validity.valid),
    true,
  );
  await number(page, "Artwork X offset", 5.175);
  await page.getByRole("button", { name: "Reset all edits", exact: true }).click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  console.log("Testing tonal/color controls and before/after pixels…");
  for (const [label, value, rgba] of [
    ["Brightness", 20, [131, 151, 171, 255]],
    ["Exposure", 1, [160, 200, 240, 255]],
    ["Saturation", -100, [97, 97, 97, 255]],
    ["Temperature", 10, [83, 100, 117, 255]],
    ["Contrast", 25, [60, 89, 117, 255]],
  ]) {
    await number(page, label, value);
    await pixel(page, 64, 48, rgba);
    await page.getByRole("button", { name: `Reset ${label.toLowerCase()}`, exact: true }).click();
    await pixel(page, 64, 48, [80, 100, 120, 255]);
  }
  await page.getByRole("button", { name: "Monochrome", exact: true }).click();
  assert.equal(await page.getByLabel("Saturation", { exact: true }).inputValue(), "-100");
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await page.getByRole("button", { name: "Selective", exact: true }).click();
  await number(page, "Brush size", 32);
  await number(page, "Brush hardness percent", 100);
  await number(page, "Selective brightness", 40);
  await paint(page, 0.25, 0.5);
  await pixel(page, 32, 48, [182, 202, 222, 255]);
  await pixel(page, 96, 48, [80, 100, 120, 255]);
  await page.keyboard.press("Control+z");
  await pixel(page, 32, 48, [80, 100, 120, 255]);
  await page.keyboard.press("Control+Shift+z");
  await pixel(page, 32, 48, [182, 202, 222, 255]);
  await page.getByRole("button", { name: "After", exact: true }).click();
  await page.getByRole("button", { name: "Before", exact: true }).click();
  await page.getByRole("button", { name: "Erase mask", exact: true }).click();
  await number(page, "Brush size", 8);
  await paint(page, 0.25, 0.5);
  await pixel(page, 32, 48, [80, 100, 120, 255]);
  await pixel(page, 40, 48, [182, 202, 222, 255]);
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await pixel(page, 32, 48, [182, 202, 222, 255]);
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await pixel(page, 32, 48, [80, 100, 120, 255]);
  await page.screenshot({ path: "/workspace/screenshots/phase3-selective-desktop.png" });
  // Quota failure must preserve accepted media and resume the preview after Save.
  await page.evaluate(() => {
    window.__savedPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "blobs") throw new DOMException("QA quota failure", "QuotaExceededError");
      return window.__savedPut.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "out of space" }).waitFor();
  assert.equal((await records(page)).find((p) => p.id === original.id).blobId, original.blobId);
  await page.locator(".image-stage-rendering").waitFor({ state: "hidden" });
  await pixel(page, 40, 48, [182, 202, 222, 255]);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__savedPut;
  });
  await save(page);
  let panel = (await records(page)).find((p) => p.id === original.id);
  assert.equal(panel.edit.recipe.selective.strokes.length, 2);
  assert.equal(panel.original.blobId, original.blobId);
  await compareSaved(page, panel);
  await page.reload();
  await open(page);
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await number(page, "Crop width", 96);
  await number(page, "Crop height", 80);
  await number(page, "Crop X", 16);
  await number(page, "Crop Y", 8);
  await page.getByRole("button", { name: "Transform", exact: true }).click();
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await number(page, "Artwork scale percent", 50);
  await page.getByRole("button", { name: "Align right", exact: true }).click();
  await page.getByRole("button", { name: "Align top", exact: true }).click();
  await save(page);
  panel = (await records(page)).find((p) => p.id === original.id);
  assert.equal(panel.width, 80);
  assert.equal(panel.height, 96);
  const placed = await compareSaved(page, panel);
  assert.equal(
    Buffer.from(placed.pixels, "base64")[3],
    0,
    "Alignment must leave transparent margins",
  );
  await open(page);
  await page.getByRole("button", { name: "Restore original", exact: true }).click();
  await save(page);
  assert.equal((await decoded(page, original.blobId)).bytes, files[0].data);
  console.log("Testing detail filters across tile boundaries and recipe persistence…");
  await open(page, "edges.png");
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  for (const [label, value] of [
    ["Noise reduction", 35],
    ["Blur radius", 2],
    ["Sharpening", 40],
    ["Brightness", 7],
  ])
    await number(page, label, value);
  await save(page);
  panel = (await records(page)).find((p) => p.name === "edges.png");
  const filtered = await compareSaved(page, panel);
  await page.getByRole("button", { name: "Uncheck large.png", exact: true }).click();
  await page.getByText("Chapter settings", { exact: true }).click();
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  await page.getByRole("button", { name: "Display 2", exact: true }).click();
  await page.locator(".manhwa-image").first().waitFor();
  const exported = await page
    .locator(".manhwa-image")
    .first()
    .evaluate(async (el) => {
      const bitmap = await createImageBitmap(await (await fetch(el.src)).blob()),
        canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...ctx.getImageData(200, 700, 1, 1).data];
    });
  const expectedExport = Buffer.from(filtered.pixels, "base64").subarray(
    (100 * 800 + 200) * 4,
    (100 * 800 + 200) * 4 + 4,
  );
  assert.deepEqual(
    exported,
    [...expectedExport],
    "Chapter export must use accepted filtered artwork",
  );
  await open(page, "large.png");
  await number(page, "Output width", 2400);
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await number(page, "Noise reduction", 100);
  await number(page, "Blur radius", 12);
  const before = (await records(page)).find((p) => p.name === "large.png").blobId;
  await page.evaluate(() => {
    window.__ticks = 0;
    window.__tickTimer = setInterval(() => window.__ticks++, 10);
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
  assert.equal((await records(page)).find((p) => p.name === "large.png").blobId, before);
  assert.ok(
    (await page.evaluate(() => {
      clearInterval(window.__tickTimer);
      return window.__ticks;
    })) > 0,
  );
  await page.evaluate(() =>
    Object.defineProperty(window, "OffscreenCanvas", { value: undefined, configurable: true }),
  );
  await page.getByRole("button", { name: "Edit Image tone.png", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "OffscreenCanvas" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Save changes", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await desktop.close();
  console.log("Testing native touch mask strokes, scrolling controls and discard…");
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const { page: phone } = await setup(mobile, true);
  await open(phone);
  await phone.getByRole("button", { name: "Selective", exact: true }).click();
  await number(phone, "Brush size", 32);
  await number(phone, "Brush hardness percent", 100);
  await number(phone, "Selective brightness", 30);
  const cdp = await mobile.newCDPSession(phone);
  await paint(phone, 0.5, 0.5, cdp);
  await pixel(phone, 64, 48, [156, 176, 196, 255]);
  await phone.getByRole("button", { name: "Undo edit", exact: true }).click();
  await pixel(phone, 64, 48, [80, 100, 120, 255]);
  await phone.getByRole("button", { name: "Redo edit", exact: true }).click();
  await pixel(phone, 64, 48, [156, 176, 196, 255]);
  await phone.getByRole("button", { name: "Hide mask", exact: true }).click();
  await phone.locator(".image-stage-rendering").waitFor({ state: "hidden" });
  await phone.screenshot({ path: "/workspace/screenshots/phase3-selective-mobile.png" });
  assert.equal(
    await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await phone.getByRole("button", { name: "Paint mask", exact: true }).click();
  const cancelBox = await phone.locator(".image-plane").boundingBox();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: cancelBox.x + cancelBox.width * 0.8, y: cancelBox.y + cancelBox.height * 0.3 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await phone.getByText("1 mask strokes", { exact: false }).waitFor();
  await phone.getByRole("button", { name: "Cancel", exact: true }).click();
  await phone.getByRole("button", { name: "Discard edits", exact: true }).click();
  assert.equal((await records(phone))[0].edit, undefined);
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "pixel controls and resets",
        "preset undo",
        "paint/erase masks",
        "outside-mask preservation",
        "touch painting/history/discard",
        "crop/rotation/alignment mapping",
        "persisted recipes",
        "alpha preservation",
        "whole-frame vs tiled processing",
        "chapter export includes filters",
        "byte-exact original recovery",
        "worker cancellation and responsive UI",
      ],
    }),
  );
} finally {
  await browser.close();
}
