/** Real UI/worker checks in isolated profiles. No user artwork or paid cloud calls. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
async function story(page) {
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByPlaceholder("Night Market").fill("Pro editor QA");
  await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const x = c.getContext("2d");
    x.fillStyle = "#203040";
    x.fillRect(0, 0, 128, 96);
    x.fillStyle = "#708090";
    x.fillRect(0, 0, 16, 16);
    return c.toDataURL().split(",")[1];
  });
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      { name: "source.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") },
    ]);
  await page.getByRole("button", { name: "Edit Image source.png", exact: true }).waitFor();
  return data;
}
async function records(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip");
        r.onsuccess = () => resolve(r.result);
      }),
      panels = await new Promise((resolve) => {
        const r = db.transaction("panels").objectStore("panels").getAll();
        r.onsuccess = () => resolve(r.result);
      });
    db.close();
    return panels;
  });
}
async function open(page) {
  await page.getByRole("button", { name: "Pro Studio · layers & vectors", exact: true }).click();
  await page.getByRole("dialog", { name: "Inkstrip Pro Studio", exact: true }).waitFor();
  await pixel(page, 64, 48, [32, 48, 64, 255]);
}
async function pixel(page, x, y, expected) {
  await page.waitForFunction(
    ({ x, y, expected }) => {
      const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
      if (!c || c.width !== 128 || c.height !== 96) return false;
      return [...c.getContext("2d").getImageData(x, y, 1, 1).data].every(
        (n, i) => Math.abs(n - expected[i]) <= 1,
      );
    },
    { x, y, expected },
  );
}
async function drag(page, a, b) {
  const r = await page.locator(".pro-artboard").boundingBox();
  await page.mouse.move(r.x + (a.x / 128) * r.width, r.y + (a.y / 96) * r.height);
  await page.mouse.down();
  await page.mouse.move(r.x + (b.x / 128) * r.width, r.y + (b.y / 96) * r.height, { steps: 8 });
  await page.mouse.up();
}
async function tab(page, name) {
  await page
    .getByRole("navigation", { name: "Pro panels", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function importNative(page, document, data) {
  await tab(page, "Assets");
  await page.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
    {
      name: "fixture.inkstrip",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "inkstrip-pro",
          version: 1,
          document,
          assets: { source: { mime: "image/png", data } },
        }),
      ),
    },
  ]);
}
try {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await c.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(30000);
  const data = await story(page),
    initial = await records(page);
  await open(page);
  await page.screenshot({ path: "/workspace/screenshots/inkstrip-pro-desktop.png" });
  assert.deepEqual(
    await records(page),
    initial,
    "Opening a Pro document must not migrate or edit legacy data",
  );
  console.log("Testing native import Undo with different source bytes sharing the same asset ID…");
  const alternate = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#d08040";
    ctx.fillRect(0, 0, 128, 96);
    return c.toDataURL().split(",")[1];
  });
  // Hold a real Pro transaction while the native file appends sources, then release it.
  await page.evaluate(() => {
    window.__proRaceRelease = false;
    window.__proRacePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const result = window.__proRacePut.apply(this, args);
      if (this.name === "sessions" && !window.__proRaceRelease) {
        const end = performance.now() + 5000;
        const spin = () => {
          if (!window.__proRaceRelease && performance.now() < end) {
            const read = this.get("__qa_keepalive__");
            read.onsuccess = spin;
          }
        };
        spin();
      }
      return result;
    };
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await importNative(
    page,
    fromPanel({ id: "other", name: "Different source", width: 128, height: 96 }),
    alternate,
  );
  await pixel(page, 64, 48, [208, 128, 64, 255]);
  await page.evaluate(() => {
    window.__proRaceRelease = true;
    IDBObjectStore.prototype.put = window.__proRacePut;
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Pro undo", exact: true }).click();
  await pixel(page, 64, 48, [32, 48, 64, 255]);
  page.setDefaultTimeout(30000);
  await page.getByRole("button", { name: "Pro redo", exact: true }).click();
  await pixel(page, 64, 48, [208, 128, 64, 255]);
  await page.getByRole("button", { name: "Pro undo", exact: true }).click();
  await pixel(page, 64, 48, [32, 48, 64, 255]);
  await tab(page, "Layers");
  await page.locator(".pro-layer-select").first().click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await pixel(page, 64, 48, [0, 0, 0, 0]);
  await page.getByLabel("Compare imported source", { exact: true }).check();
  await pixel(page, 64, 48, [32, 48, 64, 255]);
  await page.getByLabel("Compare imported source", { exact: true }).uncheck();
  await pixel(page, 64, 48, [0, 0, 0, 0]);
  await page.getByRole("button", { name: "Pro undo", exact: true }).click();
  await pixel(page, 64, 48, [32, 48, 64, 255]);

  await page.getByRole("button", { name: "Paint layer", exact: true }).click();
  await page.getByLabel("Brush color", { exact: true }).fill("#00ff00");
  await page.getByLabel("Brush hardness", { exact: true }).fill("100");
  await page.getByLabel("Brush size", { exact: true }).fill("12");
  await page.getByLabel("Brush opacity", { exact: true }).fill("50");
  await drag(page, { x: 32, y: 24 }, { x: 64, y: 24 });
  await pixel(page, 48, 24, [16, 152, 32, 255]);
  await page.getByRole("button", { name: "Pro undo", exact: true }).click();
  await pixel(page, 48, 24, [32, 48, 64, 255]);
  await page.getByLabel("Brush opacity", { exact: true }).fill("100");
  await drag(page, { x: 32, y: 24 }, { x: 64, y: 24 });
  await pixel(page, 48, 24, [0, 255, 0, 255]);
  await page.getByRole("button", { name: "Pro undo", exact: true }).click();
  await pixel(page, 48, 24, [32, 48, 64, 255]);
  await page.getByRole("button", { name: "Pro redo", exact: true }).click();
  await pixel(page, 48, 24, [0, 255, 0, 255]);
  await page.getByRole("button", { name: "Eraser tool", exact: true }).click();
  await drag(page, { x: 48, y: 24 }, { x: 48, y: 24 });
  await pixel(page, 48, 24, [32, 48, 64, 255]);
  await tab(page, "Layers");
  await page.getByRole("button", { name: "Text layer", exact: true }).click();
  await page
    .getByLabel("Pro text content", { exact: true })
    .fill("Hello, world.\nEditable dialogue");
  await page.getByLabel("Text font size", { exact: true }).fill("12");
  await page.getByLabel("Object x", { exact: true }).fill("12");
  await page.getByLabel("Object y", { exact: true }).fill("35");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Inkstrip Pro Studio", exact: true })
    .waitFor({ state: "hidden" });
  assert.deepEqual(
    await records(page),
    initial,
    "Pro draft saving leaves the chapter accepted image unchanged",
  );
  await page.reload();
  await page.getByRole("button", { name: "Pro Studio · layers & vectors", exact: true }).click();
  await page.getByRole("dialog", { name: "Inkstrip Pro Studio", exact: true }).waitFor();
  await tab(page, "Properties");
  assert.equal(
    await page.getByLabel("Pro text content", { exact: true }).inputValue(),
    "Hello, world.\nEditable dialogue",
  );
  const d = fromPanel({ id: "fixture", name: "Composite QA", width: 128, height: 96 }),
    red = layer("shape", 40, 30),
    blue = layer("shape", 40, 30);
  red.name = "Red";
  red.fill = "#ff0000";
  red.strokeWidth = 0;
  red.transform.x = 16;
  red.transform.y = 12;
  blue.name = "Blue";
  blue.fill = "#0000ff";
  blue.strokeWidth = 0;
  blue.transform.x = 16;
  blue.transform.y = 12;
  d.layers.push(red, blue);
  await importNative(page, d, data);
  await pixel(page, 30, 20, [0, 0, 255, 255]);
  await tab(page, "Layers");
  await page.getByRole("button", { name: "Hide layer Blue", exact: true }).click();
  await pixel(page, 30, 20, [255, 0, 0, 255]);
  await page.getByRole("button", { name: "Show layer Blue", exact: true }).click();
  await pixel(page, 30, 20, [0, 0, 255, 255]);
  await page.getByRole("button", { name: "Send layer backward", exact: true }).click();
  await pixel(page, 30, 20, [255, 0, 0, 255]);
  await page.getByRole("button", { name: "Pro undo", exact: true }).click();
  await pixel(page, 30, 20, [0, 0, 255, 255]);
  await tab(page, "Properties");
  await page.getByLabel("Layer opacity", { exact: true }).fill("50");
  await pixel(page, 30, 20, [127, 0, 128, 255]);
  await page.screenshot({ path: "/workspace/screenshots/inkstrip-pro-layers.png" });
  console.log("Testing masks, selection geometry, blend modes and isolated groups…");
  blue.opacity = 1;
  blue.mask = {
    selection: {
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 30 },
          ],
        },
      ],
      inverted: false,
      feather: 0,
    },
    strokes: [],
    enabled: true,
  };
  await importNative(page, d, data);
  await pixel(page, 25, 20, [0, 0, 255, 255]);
  await pixel(page, 50, 20, [255, 0, 0, 255]);
  await tab(page, "Properties");
  await page.getByText("Layer mask", { exact: true }).click();
  await page.getByRole("button", { name: "Invert mask", exact: true }).click();
  await pixel(page, 25, 20, [255, 0, 0, 255]);
  await pixel(page, 50, 20, [0, 0, 255, 255]);
  await page.getByLabel("Paint layer mask", { exact: true }).check();
  await page.getByLabel("Brush size", { exact: true }).fill("6");
  await page.getByRole("button", { name: "Brush tool", exact: true }).click();
  await drag(page, { x: 25, y: 20 }, { x: 25, y: 20 });
  await pixel(page, 25, 20, [0, 0, 255, 255]);
  await pixel(page, 50, 20, [0, 0, 255, 255]);
  await page.getByRole("button", { name: "Eraser tool", exact: true }).click();
  await drag(page, { x: 50, y: 20 }, { x: 50, y: 20 });
  await pixel(page, 50, 20, [255, 0, 0, 255]);
  await page.getByRole("button", { name: "Pro undo", exact: true }).click();
  await pixel(page, 50, 20, [0, 0, 255, 255]);
  await page.getByRole("button", { name: "Pro undo", exact: true }).click();
  await pixel(page, 25, 20, [255, 0, 0, 255]);
  await page.getByRole("button", { name: "Invert mask", exact: true }).click();
  await page.getByRole("button", { name: "Rectangle selection tool", exact: true }).click();
  await drag(page, { x: 20, y: 15 }, { x: 40, y: 35 });
  await page.getByRole("button", { name: "Mask from selection", exact: true }).click();
  await pixel(page, 30, 20, [0, 0, 255, 255]);
  await pixel(page, 50, 20, [255, 0, 0, 255]);
  await page.getByRole("button", { name: "Eraser tool", exact: true }).click();
  await page.getByLabel("Brush size", { exact: true }).fill("6");
  await drag(page, { x: 30, y: 20 }, { x: 30, y: 20 });
  await pixel(page, 30, 20, [255, 0, 0, 255]);
  blue.mask = {
    selection: {
      regions: [
        {
          kind: "ellipse",
          operation: "add",
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 30 },
          ],
        },
        {
          kind: "rectangle",
          operation: "intersect",
          points: [
            { x: 10, y: 0 },
            { x: 30, y: 30 },
          ],
        },
        {
          kind: "rectangle",
          operation: "subtract",
          points: [
            { x: 15, y: 10 },
            { x: 25, y: 20 },
          ],
        },
      ],
      inverted: false,
      feather: 0,
    },
    strokes: [],
    enabled: true,
  };
  await importNative(page, d, data);
  await pixel(page, 28, 27, [0, 0, 255, 255]);
  await pixel(page, 36, 27, [255, 0, 0, 255]);
  await pixel(page, 20, 27, [255, 0, 0, 255]);
  delete blue.mask;
  blue.blend = "multiply";
  await importNative(page, d, data);
  await pixel(page, 30, 20, [0, 0, 0, 255]);
  blue.blend = "source-over";
  const g = layer("group", 128, 96);
  g.opacity = 0.5;
  red.parentId = blue.parentId = g.id;
  d.layers.push(g);
  await importNative(page, d, data);
  await pixel(page, 30, 20, [16, 24, 160, 255]);
  delete red.parentId;
  delete blue.parentId;
  d.layers.pop();
  await importNative(page, d, data);
  await pixel(page, 30, 20, [0, 0, 255, 255]);
  await tab(page, "Assets");
  await page.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
    {
      name: "safe.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><rect x="10" y="70" width="30" height="10" fill="#00ff00"/></svg>',
      ),
    },
  ]);
  await pixel(page, 20, 75, [0, 255, 0, 255]);
  console.log("Testing native cubic paths and direct anchor editing…");
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await drag(page, { x: 20, y: 60 }, { x: 40, y: 40 });
  await drag(page, { x: 80, y: 60 }, { x: 80, y: 60 });
  await page.getByRole("button", { name: "Direct select tool", exact: true }).click();
  const anchor = page.locator('[data-anchor="1"][data-part="point"]');
  await anchor.waitFor();
  const a = await anchor.boundingBox(),
    board = await page.locator(".pro-artboard").boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(board.x + (90 / 128) * board.width, board.y + (70 / 96) * board.height, {
    steps: 6,
  });
  await page.mouse.up();
  await tab(page, "Export");
  const curveDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export editable .inkstrip", exact: true }).click();
  const curves = JSON.parse((await readFile(await (await curveDownload).path())).toString()),
    path = curves.document.layers.find((l) => l.name === "Bézier path");
  assert.equal(path.anchors.length, 2);
  assert.ok(Math.abs(path.anchors[1].x - 90) < 0.01 && Math.abs(path.anchors[1].y - 70) < 0.01);
  assert.ok(path.anchors[0].outgoing);
  await importNative(page, d, data);
  await pixel(page, 30, 20, [0, 0, 255, 255]);

  await tab(page, "Assets");
  await page.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
    {
      name: "unsafe.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    },
  ]);
  await page.getByRole("alert").filter({ hasText: "Unsupported SVG element" }).waitFor();
  assert.equal((await records(page))[0].blobId, initial[0].blobId);
  await page.getByRole("button", { name: "Dismiss Pro error", exact: true }).click();
  await tab(page, "Export");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export editable .inkstrip", exact: true }).click();
  const download = await dl,
    native = JSON.parse((await readFile(await download.path())).toString());
  assert.equal(native.document.layers.length, 3);
  assert.equal(native.assets.source.data, data);
  console.log("Testing exact raster export dimensions and transparent/opaque formats…");
  const transparent = structuredClone(d);
  transparent.layers[0].visible = false;
  await importNative(page, transparent, data);
  await tab(page, "Export");
  for (const format of ["image/png", "image/jpeg", "image/webp"]) {
    await page.getByLabel("Pro export format", { exact: true }).selectOption(format);
    const event = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export composite · 128 × 96", exact: true }).click();
    const file = await event,
      bytes = await readFile(await file.path());
    const output = await page.evaluate(
      async ({ bytes, mime }) => {
        const b = new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], { type: mime }),
          im = await createImageBitmap(b),
          c = document.createElement("canvas");
        c.width = im.width;
        c.height = im.height;
        c.getContext("2d").drawImage(im, 0, 0);
        im.close();
        return {
          size: [c.width, c.height],
          outside: [...c.getContext("2d").getImageData(64, 48, 1, 1).data],
        };
      },
      { bytes: bytes.toString("base64"), mime: format },
    );
    assert.deepEqual(output.size, [128, 96]);
    if (format === "image/jpeg") assert.deepEqual(output.outside, [255, 255, 255, 255]);
    else assert.equal(output.outside[3], 0);
  }
  await importNative(page, d, data);
  await pixel(page, 30, 20, [0, 0, 255, 255]);
  console.log("Testing actual worker export cancellation and UI recovery…");
  const large = structuredClone(d);
  large.width = large.height = 4000;
  const expensive = layer("shape", 4000, 4000);
  expensive.fill = "#6c8080";
  expensive.strokeWidth = 0;
  expensive.adjustments.noise = 100;
  large.layers.push(expensive);
  await importNative(page, large, data);
  await tab(page, "Export");
  let unexpectedDownload = false;
  const observe = () => (unexpectedDownload = true);
  page.on("download", observe);
  await page.getByRole("button", { name: "Export composite · 4000 × 4000", exact: true }).click();
  const cancel = page.getByRole("button", { name: "Cancel rendering", exact: true });
  await cancel.waitFor();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("button")];
    return buttons.some((b) => b.textContent === "Cancel rendering" && !b.disabled);
  });
  await cancel.evaluate((button) => button.click());
  await page.getByText("Rendering cancelled. Document retained.", { exact: true }).waitFor();
  await cancel.waitFor({ state: "hidden" });
  assert.equal(unexpectedDownload, false);
  page.off("download", observe);
  assert.equal((await records(page))[0].blobId, initial[0].blobId);
  await importNative(page, d, data);
  await pixel(page, 30, 20, [0, 0, 255, 255]);
  console.log("Testing atomic failure before chapter application…");
  await page.evaluate(() => {
    window.__proOriginalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "blobs") throw new DOMException("QA quota failure", "QuotaExceededError");
      return window.__proOriginalPut.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Apply to chapter", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "out of space" }).waitFor();
  assert.equal((await records(page))[0].blobId, initial[0].blobId);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__proOriginalPut;
  });
  await page.getByRole("button", { name: "Dismiss Pro error", exact: true }).click();
  await page.getByRole("button", { name: "Apply to chapter", exact: true }).click();
  await page
    .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
      exact: true,
    })
    .waitFor();
  const applied = await records(page);
  assert.notEqual(applied[0].blobId, initial[0].blobId);
  assert.equal(applied[0].original.blobId, initial[0].blobId);
  assert.deepEqual([applied[0].width, applied[0].height], [128, 96]);
  const retainedBytes = await page.evaluate(async (id) => {
    const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip");
        r.onsuccess = () => resolve(r.result);
      }),
      blob = await new Promise((resolve) => {
        const r = db.transaction("blobs").objectStore("blobs").get(id);
        r.onsuccess = () => resolve(r.result);
      });
    db.close();
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  }, applied[0].original.blobId);
  assert.equal(retainedBytes, data);

  await page.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await page.getByRole("button", { name: "Edit Image source.png", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  console.log("Testing cross-tab save conflicts and recovery export…");
  await open(page);
  const other = await c.newPage();
  other.on("pageerror", (e) => errors.push(e.message));
  await other.goto(page.url());
  await open(other);
  await tab(other, "Properties");
  await other.getByLabel("Pro layer name", { exact: true }).fill("Other tab revision");
  await other.getByRole("button", { name: "Save draft", exact: true }).click();
  await other.getByText("Draft saved", { exact: true }).waitFor();
  await tab(page, "Properties");
  await page.getByLabel("Pro layer name", { exact: true }).fill("This tab unsaved");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Another tab saved this Pro document" })
    .waitFor();
  const recoveryEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export recovery document", exact: true }).click();
  const recovery = JSON.parse((await readFile(await (await recoveryEvent).path())).toString());
  assert.equal(recovery.document.layers.at(-1).name, "This tab unsaved");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Leave without saving", exact: true }).click();
  await other.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await other.close();
  assert.deepEqual(errors, []);
  await c.close();
  console.log(
    "Desktop layers, paint/erase, history, compositing, native recovery, safe SVG and chapter application: PASS",
  );
  for (const width of [320, 390]) {
    const mobile = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: "reduce",
      }),
      p = await mobile.newPage(),
      problems = [];
    p.on("pageerror", (e) => problems.push(e.message));
    p.setDefaultTimeout(30000);
    await story(p);
    await open(p);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await p
      .getByRole("dialog", { name: "Inkstrip Pro Studio", exact: true })
      .boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).click();
    await p.getByRole("button", { name: "Rectangle tool", exact: true }).click();
    const r = await p.locator(".pro-artboard").boundingBox(),
      cdp = await mobile.newCDPSession(p),
      pt = (x, y) => ({ x: r.x + (x / 128) * r.width, y: r.y + (y / 96) * r.height });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...pt(20, 20), id: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...pt(70, 60), id: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const zoom = await p.getByLabel("Pro zoom", { exact: true }).innerText();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { ...pt(35, 35), id: 1 },
        { ...pt(80, 55), id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { ...pt(20, 25), id: 1 },
        { ...pt(100, 65), id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.notEqual(
      await p.getByLabel("Pro zoom", { exact: true }).innerText(),
      zoom,
      "Native two-finger pinch updates navigation zoom",
    );
    await p.getByRole("button", { name: "Fit Pro canvas", exact: true }).click();
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).click();
    await tab(p, "Layers");
    await p.getByRole("button", { name: "Paint layer", exact: true }).click();
    await p.getByLabel("Brush color", { exact: true }).fill("#00ff00");
    await p.getByLabel("Brush size", { exact: true }).fill("8");
    await p.getByLabel("Brush hardness", { exact: true }).fill("100");
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).click();
    const rb = await p.locator(".pro-artboard").boundingBox(),
      q = (x, y) => ({ x: rb.x + (x / 128) * rb.width, y: rb.y + (y / 96) * rb.height });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...q(50, 75), id: 3 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...q(80, 75), id: 3 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await pixel(p, 65, 75, [32, 48, 64, 255]);
    if (width === 390)
      await p.screenshot({ path: "/workspace/screenshots/inkstrip-pro-mobile.png" });
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Inkstrip Pro Studio", exact: true })
      .waitFor({ state: "hidden" });
    const stored = await p.evaluate(async () => {
      const db = await new Promise((resolve) => {
          const request = indexedDB.open("inkstrip-pro");
          request.onsuccess = () => resolve(request.result);
        }),
        entries = await new Promise((resolve) => {
          const request = db.transaction("sessions").objectStore("sessions").getAll();
          request.onsuccess = () => resolve(request.result);
        });
      db.close();
      return entries[0].session.document;
    });
    assert.equal(stored.width, 128);
    assert.equal(stored.height, 96);
    assert.equal(stored.layers.filter((l) => l.kind === "shape").length, 1);
    assert.equal(stored.layers.find((l) => l.kind === "paint").strokes.length, 0);
    assert.deepEqual(problems, []);
    await mobile.close();
    console.log(
      `Native touch rectangle, pinch, cancelled paint, recovery and no overflow at ${width}px: PASS`,
    );
  }
  console.log(
    "Testing AI/image-tools handoff and non-destructive return to the latest chapter revision…",
  );
  {
    const recoveryContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      rp = await recoveryContext.newPage();
    await story(rp);
    await open(rp);
    await tab(rp, "AI tools");
    await rp.getByRole("button", { name: "Apply + Image tools", exact: true }).click();
    await rp.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor();
    await rp.getByRole("button", { name: "Rotate right", exact: true }).click();
    await rp.getByRole("button", { name: "Save changes", exact: true }).click();
    await rp.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
    const latest = await records(rp);
    assert.deepEqual([latest[0].width, latest[0].height], [96, 128]);
    await rp.getByRole("button", { name: "Pro Studio · layers & vectors", exact: true }).click();
    await rp
      .getByRole("button", { name: "Use latest chapter image · keep layers", exact: true })
      .waitFor();
    assert.equal(
      await rp.getByRole("button", { name: "Apply to chapter", exact: true }).isEnabled(),
      false,
    );
    await rp
      .getByRole("button", { name: "Use latest chapter image · keep layers", exact: true })
      .click();
    await rp
      .getByText(
        "Latest chapter image added. Earlier layers are hidden and recoverable in Layers.",
        { exact: true },
      )
      .waitFor();
    await rp.waitForFunction(() => {
      const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
      return c?.width === 96 && c.height === 128;
    });
    assert.equal((await records(rp))[0].blobId, latest[0].blobId);
    await rp.getByLabel("Compare imported source", { exact: true }).check();
    await rp.waitForFunction(() => {
      const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
      if (c?.width !== 96 || c.height !== 128) return false;
      const ctx = c.getContext("2d");
      return (
        ctx.getImageData(48, 4, 1, 1).data[3] === 0 &&
        ctx.getImageData(48, 64, 1, 1).data[3] === 255
      );
    });
    await rp.getByLabel("Compare imported source", { exact: true }).uncheck();
    await rp.getByRole("button", { name: "Pro undo", exact: true }).click();
    await rp.waitForFunction(
      () => document.querySelector('canvas[aria-label="Pro composite preview"]')?.width === 128,
    );
    await rp.getByRole("button", { name: "Pro redo", exact: true }).click();
    await rp.waitForFunction(
      () => document.querySelector('canvas[aria-label="Pro composite preview"]')?.width === 96,
    );
    await rp.getByRole("button", { name: "Save draft", exact: true }).click();
    const recovered = await rp.evaluate(async () => {
      const db = await new Promise((resolve) => {
          const r = indexedDB.open("inkstrip-pro");
          r.onsuccess = () => resolve(r.result);
        }),
        sessions = await new Promise((resolve) => {
          const r = db.transaction("sessions").objectStore("sessions").getAll();
          r.onsuccess = () => resolve(r.result);
        });
      db.close();
      return {
        layers: sessions[0].session.document.layers,
        assets: Object.keys(sessions[0].session.assets),
      };
    });
    assert.equal(recovered.layers.length, 2);
    assert.equal(recovered.layers[0].visible, false);
    assert.equal(recovered.layers[1].name, "Latest chapter image");
    assert.equal(recovered.assets.length, 2);
    await recoveryContext.close();
  }
  // Isolated showcase artwork, generated only for QA screenshots, never seeded into the app.
  for (const mobileView of [false, true]) {
    const showcase = await browser.newContext({
        viewport: mobileView ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        isMobile: mobileView,
        hasTouch: mobileView,
        reducedMotion: "reduce",
      }),
      sp = await showcase.newPage();
    await story(sp);
    const poster = await sp.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 480;
      c.height = 720;
      const x = c.getContext("2d"),
        g = x.createLinearGradient(0, 0, 0, 720);
      g.addColorStop(0, "#23413b");
      g.addColorStop(1, "#101c20");
      x.fillStyle = g;
      x.fillRect(0, 0, 480, 720);
      x.fillStyle = "#cfdfcd";
      x.beginPath();
      x.arc(359, 167, 57, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#23413b";
      x.beginPath();
      x.arc(337, 149, 56, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#d8e4db";
      x.font = "11px Arial";
      x.fillText("INKSTRIP / ORIGINAL QA STUDY", 30, 34);
      x.font = "italic 46px Georgia";
      x.fillText("Glass", 30, 105);
      x.fillText("Harbor", 30, 155);
      for (let i = 0; i < 15; i++) {
        const h = 90 + ((i * 47) % 180),
          px = i * 34 - 10;
        x.fillStyle = i % 2 ? "#17292c" : "#102226";
        x.fillRect(px, 720 - h, 30, h);
        x.fillStyle = "#54726b";
        for (let y = 720 - h + 12; y < 700; y += 18)
          for (let cx = px + 5; cx < px + 26; cx += 10) x.fillRect(cx, y, 2, 5);
      }
      x.strokeStyle = "#91b2a82b";
      x.lineWidth = 1;
      for (let i = 0; i < 27; i++) {
        const px = (i * 37) % 480,
          y = (i * 91) % 720;
        x.beginPath();
        x.moveTo(px, y);
        x.lineTo(px - 18, y + 49);
        x.stroke();
      }
      x.fillStyle = "#a7c4b9";
      x.font = "10px Arial";
      x.fillText("CHAPTER 01  /  AFTER THE RAIN", 30, 689);
      return c.toDataURL().split(",")[1];
    });
    await sp.getByRole("button", { name: "Pro Studio · layers & vectors", exact: true }).click();
    await sp.getByRole("dialog", { name: "Inkstrip Pro Studio", exact: true }).waitFor();
    const scene = fromPanel({
        id: "showcase",
        name: "Glass Harbor · chapter artwork",
        width: 480,
        height: 720,
      }),
      bubble = layer("shape", 240, 160),
      caption = layer("text", 194, 80);
    bubble.shape = "bubble";
    bubble.name = "Dialogue · editable bubble";
    bubble.strokeWidth = 2;
    bubble.transform.x = 173;
    bubble.transform.y = 320;
    bubble.tail = { x: 160, y: 150 };
    caption.name = "Dialogue text";
    caption.text = "Somewhere in this city,\nour story is still\nwaiting.";
    caption.fontFamily = "Georgia";
    caption.fontSize = 16;
    caption.lineHeight = 1.4;
    caption.strokeWidth = 0;
    caption.fill = "#172420";
    caption.transform.x = 198;
    caption.transform.y = 340;
    scene.layers.push(bubble, caption);
    await importNative(sp, scene, poster);
    await sp.waitForFunction(() => {
      const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
      return c?.width === 480 && c.height === 720;
    });
    await sp.getByRole("button", { name: "Save draft", exact: true }).click();
    await sp
      .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
      .waitFor();
    await tab(sp, "Properties");
    if (mobileView)
      await sp.getByRole("button", { name: "Toggle Pro panels", exact: true }).click();
    await sp.screenshot({
      path: `/workspace/screenshots/inkstrip-pro-showcase${mobileView ? "-mobile" : ""}.png`,
    });
    await showcase.close();
  }
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "Pro legacy isolation",
        "real worker pixels",
        "paint/eraser",
        "undo/redo",
        "editable text reload",
        "layer order/opacity/multiply/isolated groups",
        "selection and invertible painted masks",
        "Bézier handles and direct anchors",
        "PNG/JPEG/WebP dimensions and transparency",
        "quota rollback and cross-tab recovery",
        "native touch drawing/pinch/cancellation at 320/390px",
        "native source bytes and original recovery after deleting the base layer",
        "native import ID remapping, undo/redo and in-flight save isolation",
        "SVG rejection",
        "safe apply/original retention",
        "AI/image-tools handoff and latest-image recovery with retained layers",
      ],
    }),
  );
} finally {
  await browser.close();
}
