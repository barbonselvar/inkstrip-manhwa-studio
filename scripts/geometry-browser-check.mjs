/** Full-canvas editing, real worker crop/resampling output, native persistence and touch QA. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { resample } from "../src/lib/studio/pro/resample.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [];
async function tab(p, name) {
  await p
    .getByRole("navigation", { name: "Pro panels", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function records(p) {
  return p.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const rows = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return rows;
  });
}
async function start(p) {
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByPlaceholder("Night Market").fill("Geometry QA");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await p.getByText("Chapter workspace", { exact: true }).waitFor();
  const source = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const x = c.getContext("2d");
    const image = x.createImageData(128, 96);
    for (let y = 0; y < 96; y++)
      for (let px = 0; px < 128; px++)
        image.data.set([px * 2, y * 2, 80, px < 16 ? 0 : px < 32 ? 128 : 255], (y * 128 + px) * 4);
    x.putImageData(image, 0, 0);
    return c.toDataURL().split(",")[1];
  });
  await p
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      { name: "geometry.png", mimeType: "image/png", buffer: Buffer.from(source, "base64") },
    ]);
  await p.getByRole("button", { name: "Edit Image geometry.png", exact: true }).waitFor();
  return source;
}
async function open(p, mode = "Raster") {
  const button = p.getByRole("button", { name: `Open in ${mode} Studio`, exact: true });
  await button.scrollIntoViewIfNeeded();
  assert.ok(await button.isVisible());
  assert.ok(await button.isEnabled());
  await button.click();
  await p.getByRole("dialog", { name: `Inkstrip ${mode} Studio`, exact: true }).waitFor();
}
async function pixels(p, x, y) {
  return p.evaluate(
    ({ x, y }) => [
      ...document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        .getContext("2d")
        .getImageData(x, y, 1, 1).data,
    ],
    { x, y },
  );
}
async function pixel(p, x, y, expected) {
  await p
    .waitForFunction(
      ({ x, y, expected }) => {
        const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
        return (
          c?.width === 128 &&
          [...c.getContext("2d").getImageData(x, y, 1, 1).data].every(
            (n, i) => Math.abs(n - expected[i]) <= 1,
          )
        );
      },
      { x, y, expected },
    )
    .catch(async (error) => {
      console.error("Repair pixel mismatch", {
        x,
        y,
        expected,
        actual: await pixels(p, x, y),
        alerts: await p.getByRole("alert").allTextContents(),
      });
      await p.screenshot({ path: "/workspace/screenshots/repair-failure.png" });
      throw error;
    });
}
async function point(p, x, y) {
  const r = await p.locator(".pro-artboard").boundingBox();
  return { x: r.x + (x / 128) * r.width, y: r.y + (y / 96) * r.height };
}
async function click(p, x, y) {
  const q = await point(p, x, y);
  await p.mouse.click(q.x, q.y);
}
async function drag(p, a, b) {
  const x = await point(p, ...a),
    y = await point(p, ...b);
  await p.mouse.move(x.x, x.y);
  await p.mouse.down();
  await p.mouse.move(y.x, y.y, { steps: 12 });
  await p.mouse.up();
}
async function load(p, d, source) {
  await tab(p, "History");
  const count = await p.locator(".pro-history-list li").count();
  await tab(p, "Assets");
  await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
    {
      name: "repair.inkstrip",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "inkstrip-pro",
          version: 1,
          document: d,
          assets: { source: { mime: "image/png", data: source } },
        }),
      ),
    },
  ]);
  await tab(p, "History");
  await p.waitForFunction(
    (n) => document.querySelectorAll(".pro-history-list li").length === n + 1,
    count,
  );
}
async function native(p) {
  await tab(p, "Export");
  const ev = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export editable .inkstrip", exact: true }).click();
  const bytes = await readFile(await (await ev).path());
  return { bytes, value: JSON.parse(bytes.toString()) };
}
async function raster(p, mime = "image/png") {
  await tab(p, "Export");
  await p.getByLabel("Pro export format", { exact: true }).selectOption(mime);
  const ev = p.waitForEvent("download");
  await p.getByRole("button", { name: /^Export composite ·/ }).click();
  const bytes = await readFile(await (await ev).path());
  return p.evaluate(
    async ({ data, mime }) => {
      const b = await createImageBitmap(new Blob([Uint8Array.from(data)], { type: mime })),
        c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      const x = c.getContext("2d");
      x.drawImage(b, 0, 0);
      b.close();
      return {
        width: c.width,
        height: c.height,
        pixels: [...x.getImageData(0, 0, c.width, c.height).data],
      };
    },
    { data: [...bytes], mime },
  );
}
function fixture() {
  return fromPanel({ id: "repair-fixture", name: "Geometry fixture", width: 128, height: 96 });
}
const cropApply = (p) =>
  p.locator(".pro-context-bar").getByRole("button", { name: "Apply crop", exact: true });
async function setCrop(p, c) {
  await p.getByRole("button", { name: "Crop tool", exact: true }).click();
  await p.getByLabel("Crop aspect ratio", { exact: true }).selectOption("0");
  for (const [key, value] of Object.entries(c))
    await p
      .getByLabel(
        key === "rotation"
          ? "Straighten angle"
          : `Crop ${key === "x" ? "X" : key === "y" ? "Y" : key}`,
        { exact: true },
      )
      .fill(String(value));
  await cropApply(p).click();
}
async function outputSize(p, w, h, method) {
  await tab(p, "Geometry");
  await p.getByLabel("Lock image aspect ratio", { exact: true }).uncheck();
  await p.getByLabel("Image width", { exact: true }).fill(String(w));
  await p.getByLabel("Image height", { exact: true }).fill(String(h));
  await p.getByLabel("Image resampling", { exact: true }).selectOption(method);
  await p.getByRole("button", { name: "Apply image size", exact: true }).click();
}
function at(image, x, y) {
  return image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
}
function sameImage(a, b, tolerance = 1) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  assert.equal(a.pixels.length, b.pixels.length);
  for (let i = 0; i < a.pixels.length; i++)
    assert.ok(
      Math.abs(a.pixels[i] - b.pixels[i]) <= tolerance,
      `Channel ${i}: ${a.pixels[i]} ≠ ${b.pixels[i]}`,
    );
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await context.newPage(),
    source = await start(p);
  const before = (await records(p))[0];
  await open(p);
  await pixel(p, 64, 48, [128, 96, 80, 255]);
  const original = await raster(p);
  // Apply/cancel is a document transaction. Every drag remains local until Apply.
  await p.getByRole("button", { name: "Crop tool", exact: true }).click();
  await p.getByLabel("Crop width", { exact: true }).fill("64");
  await p.getByLabel("Crop height", { exact: true }).fill("48");
  await p
    .locator(".pro-context-bar")
    .getByRole("button", { name: "Cancel crop", exact: true })
    .click();
  assert.equal((await native(p)).value.document.crop, undefined);
  await setCrop(p, { x: 16, y: 12, width: 64, height: 48, rotation: 0 });
  const cropped = await raster(p);
  assert.equal(cropped.width, 64);
  assert.equal(cropped.height, 48);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 64; x++) assert.deepEqual(at(cropped, x, y), at(original, x + 16, y + 12));
  const croppedNative = await native(p);
  assert.deepEqual(croppedNative.value.document.crop, {
    x: 16,
    y: 12,
    width: 64,
    height: 48,
    rotation: 0,
  });
  assert.equal(croppedNative.value.document.layers[0].width, 128);
  assert.equal(croppedNative.value.assets[croppedNative.value.document.source.assetId].data, source);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  sameImage(await raster(p), original);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  sameImage(await raster(p), cropped);
  console.log("Crop/cancel/history/export pixel checks passed.");
  await p.getByRole("button", { name: "Crop tool", exact: true }).click();
  await drag(p, [100, 80], [112, 88]);
  assert.equal(await p.getByLabel("Crop width", { exact: true }).inputValue(), "12");
  assert.equal(await p.getByLabel("Crop height", { exact: true }).inputValue(), "8");
  await p
    .locator(".pro-context-bar")
    .getByRole("button", { name: "Cancel crop", exact: true })
    .click();
  // All four real filters work in the worker; alpha survives a semi-transparent crop edge.
  for (const method of ["nearest", "bilinear", "bicubic", "lanczos"]) {
    await outputSize(p, 32, 24, method);
    const actual = await raster(p),
      expected = resample(new Uint8ClampedArray(cropped.pixels), 64, 48, 32, 24, method);
    sameImage(actual, { width: 32, height: 24, pixels: [...expected] }, 2);
    assert.equal(at(actual, 0, 12)[3], 128);
  }
  console.log("Four worker resampling filters and alpha checks passed.");
  const resizedNative = await native(p);
  await tab(p, "Geometry");
  await p.getByRole("button", { name: "Reset image size", exact: true }).click();
  // Ninety-degree straighten with analytically known coordinates, outside-canvas transparency/JPEG.
  await setCrop(p, { x: 32, y: 24, width: 64, height: 48, rotation: 90 });
  const rotated = await raster(p);
  assert.deepEqual(at(rotated, 32, 24), at(original, 63, 48));
  await setCrop(p, { x: -16, y: 0, width: 64, height: 48, rotation: 0 });
  const extended = await raster(p);
  assert.equal(at(extended, 0, 12)[3], 0);
  const jpeg = await raster(p, "image/jpeg");
  for (const n of at(jpeg, 0, 12)) assert.ok(n >= 250);
  // Crop handles and ratio, including edge drags; Space and pinch retain draft geometry.
  await p.getByRole("button", { name: "Crop tool", exact: true }).click();
  await p.getByLabel("Crop X", { exact: true }).fill("16");
  await p.getByLabel("Crop Y", { exact: true }).fill("12");
  await p.getByLabel("Crop width", { exact: true }).fill("64");
  await p.getByLabel("Crop height", { exact: true }).fill("48");
  await p.getByLabel("Crop aspect ratio", { exact: true }).selectOption("1");
  await drag(p, [80, 76], [88, 84]);
  assert.equal(await p.getByLabel("Crop width", { exact: true }).inputValue(), "72");
  assert.equal(await p.getByLabel("Crop height", { exact: true }).inputValue(), "72");
  await drag(p, [52, 12], [52, 4]);
  assert.equal(await p.getByLabel("Crop height", { exact: true }).inputValue(), "80");
  await p.keyboard.press("Escape");
  assert.ok(
    await p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true }).isVisible(),
  );
  assert.equal((await native(p)).value.document.crop.x, -16);
  console.log("Straighten/transparent JPEG/ratio/mouse handles/Escape checks passed.");
  // Reimport saved resize/crop metadata and prove exact output after full native save/reopen.
  await tab(p, "Assets");
  await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles({
    name: "geometry.inkstrip",
    mimeType: "application/json",
    buffer: resizedNative.bytes,
  });
  await p
    .getByText("Native document imported into this Pro draft. Chapter unchanged.", { exact: true })
    .waitFor();
  const reopened = await raster(p);
  sameImage(
    reopened,
    {
      width: 32,
      height: 24,
      pixels: [...resample(new Uint8ClampedArray(cropped.pixels), 64, 48, 32, 24, "lanczos")],
    },
    2,
  );
  // Canvas resizing is independent and keeps geometry/pixel assets, selection and masks aligned.
  await tab(p, "Geometry");
  await p.locator("summary").filter({ hasText: "Canvas size · no resampling" }).click();
  await p.getByLabel("Document width", { exact: true }).fill("160");
  await p.getByLabel("Document height", { exact: true }).fill("120");
  await p.getByRole("button", { name: "Resize canvas", exact: true }).click();
  const resizedCanvas = await native(p);
  assert.equal(resizedCanvas.value.document.width, 160);
  assert.equal(resizedCanvas.value.document.layers[0].width, 128);
  sameImage(await raster(p), reopened);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  console.log("Native reopen and independent canvas resizing checks passed.");
  // Crop-aware masking and editable text survive all output stages.
  const d = fixture();
  d.layers[0].mask = {
    enabled: true,
    strokes: [],
    selection: {
      inverted: false,
      feather: 0,
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 0, y: 0 },
            { x: 64, y: 96 },
          ],
        },
      ],
    },
  };
  d.crop = { x: 48, y: 20, width: 32, height: 32, rotation: 0 };
  d.imageSize = { width: 64, height: 64, resampling: "nearest" };
  const text = layer("text", 20, 20);
  text.text = "A";
  text.transform.x = 100;
  text.fontSize = 12;
  d.layers.push(text);
  await load(p, d, source);
  const masked = await raster(p);
  assert.deepEqual(at(masked, 0, 0), at(original, 48, 20));
  assert.equal(at(masked, 40, 20)[3], 0);
  // Sampling outside the output crop must still capture the full source canvas.
  await load(p, fixture(), source);
  await setCrop(p, { x: 16, y: 12, width: 64, height: 48, rotation: 0 });
  await p.getByRole("button", { name: "Clone Stamp tool", exact: true }).click();
  await tab(p, "Properties");
  await p.getByLabel("Brush size", { exact: true }).fill("8");
  await p.getByLabel("Brush hardness", { exact: true }).fill("100");
  await p.keyboard.down("Alt");
  await click(p, 100, 48);
  await p.keyboard.up("Alt");
  await p
    .getByText("Clone source captured from the visible composite at full document resolution.", {
      exact: true,
    })
    .waitFor();
  await p
    .getByRole("button", { name: "Apply to chapter", exact: true })
    .waitFor({ state: "visible" });
  await p.waitForFunction(
    () => !document.querySelector('button[aria-label="Clone Stamp tool"]').disabled,
  );
  await click(p, 40, 48);
  const sampled = await raster(p);
  assert.deepEqual(at(sampled, 24, 36), at(original, 100, 48));
  const snapshot = await native(p);
  assert.equal(snapshot.value.document.layers.at(-1).strokes[0].clone.width, 128);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.equal(
    await p
      .getByRole("button", { name: "Clone Stamp tool", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  assert.equal(
    await p
      .getByRole("button", { name: "Clone Stamp tool", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  console.log("Crop-aware masks, text and full-canvas Clone sampling passed.");
  // Export uses source-resolution pixels beyond the 1400px preview cap.
  const wide = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 2000;
    c.height = 128;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ab1234";
    ctx.fillRect(0, 0, 2000, 128);
    ctx.fillStyle = "#234567";
    ctx.fillRect(1800, 0, 200, 128);
    return c.toDataURL().split(",")[1];
  });
  await load(p, fromPanel({ id: "wide", name: "Beyond preview", width: 2000, height: 128 }), wide);
  await setCrop(p, { x: 1850, y: 32, width: 128, height: 64, rotation: 0 });
  await outputSize(p, 64, 32, "nearest");
  const wideOut = await raster(p);
  assert.deepEqual(at(wideOut, 32, 16), [35, 69, 103, 255]);
  assert.equal(wideOut.width, 64);
  assert.equal(wideOut.height, 32);
  console.log("Source-resolution crop and resize beyond the preview cap passed.");
  // Reset restores full original artwork with its source bytes; Chapter apply exports exact crop size.
  await load(p, fixture(), source);
  await setCrop(p, { x: 16, y: 12, width: 64, height: 48, rotation: 0 });
  await outputSize(p, 32, 24, "nearest");
  await p.getByRole("button", { name: "Apply to chapter", exact: true }).click();
  await p
    .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
      exact: true,
    })
    .waitFor();
  const after = (await records(p))[0];
  assert.equal(after.width, 32);
  assert.equal(after.height, 24);
  assert.equal(after.original.blobId, before.blobId);
  const sourceBytes = await p.evaluate(async (id) => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const blob = await new Promise((resolve) => {
      const r = db.transaction("blobs").objectStore("blobs").get(id);
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, after.original.blobId);
  assert.equal(Buffer.from(sourceBytes).toString("base64"), source);

  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).waitFor();
  await open(p);
  sameImage(
    await raster(p),
    {
      width: 32,
      height: 24,
      pixels: [...resample(new Uint8ClampedArray(cropped.pixels), 64, 48, 32, 24, "nearest")],
    },
    2,
  );
  await tab(p, "Geometry");
  await p.getByRole("button", { name: "Reset crop", exact: true }).click();
  await p.getByRole("button", { name: "Reset image size", exact: true }).click();
  sameImage(await raster(p), original);
  await p.screenshot({ path: "/workspace/screenshots/geometry-desktop.png" });
  await context.close();
  console.log(
    "Desktop: crop Apply/Cancel, 8-handle math, mouse corners/edges, ratio, straighten, RGBA/export, 4 resamplers, undo/redo, native reopen, masks/text, canvas size and Chapter preservation passed.",
  );
  for (const width of [320, 390]) {
    const mobile = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
      }),
      p = await mobile.newPage();
    await start(p);
    assert.ok(
      await p.getByRole("button", { name: "Open in Vector Studio", exact: true }).isVisible(),
    );
    await open(p, "Vector");
    await pixel(p, 64, 48, [128, 96, 80, 255]);
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).waitFor();
    await open(p);
    await setCrop(p, { x: 16, y: 12, width: 64, height: 48, rotation: 0 });
    await p.getByRole("button", { name: "Crop tool", exact: true }).click();
    const cdp = await mobile.newCDPSession(p),
      a = await point(p, 80, 60),
      b = await point(p, 90, 70);
    const scroll = await p.evaluate(() => scrollY);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: a.x, y: a.y, id: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: b.x, y: b.y, id: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.equal(await p.getByLabel("Crop width", { exact: true }).inputValue(), "74");
    const draft = await p.getByLabel("Crop X", { exact: true }).inputValue();
    const r = await p.getByLabel("Pro editing viewport", { exact: true }).boundingBox(),
      cx = r.x + r.width / 2,
      cy = r.y + r.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: cx - 20, y: cy, id: 2 },
        { x: cx + 20, y: cy, id: 3 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: cx - 35 + 5, y: cy + 5, id: 2 },
        { x: cx + 35 + 5, y: cy + 5, id: 3 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.equal(await p.getByLabel("Crop X", { exact: true }).inputValue(), draft);
    assert.equal(await p.getByLabel("Pro zoom", { exact: true }).textContent(), "175%");
    assert.equal(await p.evaluate(() => scrollY), scroll);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({ path: `/workspace/screenshots/geometry-crop-touch-${width}.png` });
    await cropApply(p).click();
    const out = await raster(p);
    assert.equal(out.width, 74);
    assert.equal(out.height, 58);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    assert.equal((await raster(p)).width, 64);
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    assert.equal((await raster(p)).width, 74);
    await tab(p, "Geometry");
    await p.screenshot({ path: `/workspace/screenshots/geometry-mobile-${width}.png` });
    console.log(
      `Chromium touch ${width}px: both Chapter entry points, selected image, 44px crop handles, pinch/pan, no page scroll/overflow, Apply, export and undo/redo passed.`,
    );
    await mobile.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Geometry browser checks passed; no console/page errors. Physical Android hardware was not tested.",
  );
} finally {
  await browser.close();
}
