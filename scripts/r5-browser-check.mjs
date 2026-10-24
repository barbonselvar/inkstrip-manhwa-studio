/** R5 recovery: real native/worker/UI pixel transactions at desktop and touch widths. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, TRANSFORM } from "../src/lib/studio/pro/model.ts";
import { maskFromSelection } from "../src/lib/studio/pro/masks.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  results = [],
  fx = proBrowserFixtures(base, errors);
await mkdir("/workspace/screenshots", { recursive: true });
const pixel = (image, x, y) =>
  image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
const near = (a, b, tolerance = 1) =>
  a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) <= tolerance, `${a} != ${b}`));
async function number(p, name, value) {
  const n = p.getByLabel(name, { exact: true });
  await n.fill(String(value));
  await n.blur();
}
async function panels(p, open = true) {
  const b = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
  if (((await b.getAttribute("aria-expanded")) === "true") !== open) await b.click();
}
async function command(p, key) {
  await p.locator(".pro-panel-tabs").evaluate((el) => {
    document.activeElement?.blur();
    el.focus();
  });
  await p.keyboard.press(key);
}
async function session(p) {
  return p.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("inkstrip-pro");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const rows = await new Promise((resolve) => {
      const r = db.transaction("sessions").objectStore("sessions").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return rows.map((r) => ({
      document: r.session.document,
      assets: Object.keys(r.session.assets),
    }));
  });
}
try {
  for (const width of [1440, 768, 390, 360, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
      }),
      p = await context.newPage();
    console.log(`R5 viewport ${width}`);
    const source = await fx.start(p);
    await fx.open(p);
    const d = fromPanel({ id: "p", name: "R5 fixture", width: 128, height: 96 });
    d.background = "transparent";
    d.selection = {
      regions: [
        {
          kind: "rectangle",
          points: [
            { x: 40, y: 20 },
            { x: 56, y: 32 },
          ],
          operation: "add",
        },
      ],
      inverted: false,
      feather: 0,
    };
    await fx.load(p, d, source);
    const before = await fx.preview(p);
    // Cancel a lift without publishing temporary assets or layer metadata.
    await fx.tab(p, "Transform");
    await p.getByRole("button", { name: "Transform selected pixels", exact: true }).click();
    await p.getByLabel("Transform X", { exact: true }).waitFor();
    fx.same(await fx.preview(p), before);
    await number(p, "Transform X", 8);
    await p.getByRole("button", { name: "Cancel transform", exact: true }).first().click();
    fx.same(await fx.preview(p), before);
    const cancelled = (await fx.native(p)).value;
    assert.equal(cancelled.document.layers.length, 1);
    assert.equal(Object.keys(cancelled.assets).length, 1);
    assert.equal(Object.values(cancelled.assets)[0].data, source);
    // Stage again, transform only the selected pixels, and record one history entry.
    await fx.tab(p, "History");
    const count = await p.locator(".pro-history-list li").count();
    await fx.tab(p, "Transform");
    await p.getByRole("button", { name: "Transform selected pixels", exact: true }).click();
    await p.getByLabel("Transform X", { exact: true }).waitFor();
    // Exercise the actual gesture-owned draft clone before numeric positioning.
    await panels(p, false);
    await fx.artboardBounds(p);
    const handle = await p.locator('[data-transform-handle="se"]').boundingBox();
    assert.ok(handle);
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    if (width < 800) {
      const cdp = await context.newCDPSession(p);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: start.x - 8, y: start.y - 6 }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else {
      await p.mouse.move(start.x, start.y);
      await p.mouse.down();
      await p.mouse.move(start.x - 8, start.y - 6, { steps: 4 });
      await p.mouse.up();
    }
    await panels(p);
    assert.ok(
      Number(await p.getByLabel("Transform width percent", { exact: true }).inputValue()) < 100,
    );
    await p.getByRole("button", { name: "Restore initial transform", exact: true }).click();
    assert.equal(await p.getByLabel("Transform width", { exact: true }).inputValue(), "16");
    assert.equal(await p.getByLabel("Pivot X", { exact: true }).inputValue(), "8");
    await number(p, "Transform X", 48);
    await p.getByRole("button", { name: "Apply transform", exact: true }).first().click();
    const moved = await fx.preview(p);
    assert.equal(pixel(moved, 42, 22)[3], 0);
    near(pixel(moved, 62, 22), pixel(before, 54, 22));
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 128; x++)
        if (!(x >= 40 && x < 64 && y >= 20 && y < 32))
          near(pixel(moved, x, y), pixel(before, x, y), 0);
    await fx.tab(p, "History");
    assert.equal(await p.locator(".pro-history-list li").count(), count + 1);
    await command(p, "Control+z");
    fx.same(await fx.preview(p), before);
    await command(p, "Control+Shift+z");
    fx.same(await fx.preview(p), moved);
    const saved = (await fx.native(p)).value;
    assert.equal(saved.document.layers.length, 4);
    assert.equal(
      saved.document.layers.find((l) => l.id === cancelled.document.layers[0].id).visible,
      false,
    );
    assert.ok(Object.values(saved.assets).some((a) => a.data === source));
    assert.equal(Object.keys(saved.assets).length, 3);
    fx.same(await fx.raster(p), moved);
    await fx.load(p, saved.document, source, saved.assets);
    fx.same(await fx.preview(p), moved);
    // A staged lift cannot be persisted by Save or Close.
    await fx.load(p, d, source);
    await command(p, "Control+s");
    await p
      .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
      .waitFor();
    const storedBefore = await session(p);
    await fx.tab(p, "Transform");
    await p.getByRole("button", { name: "Transform selected pixels", exact: true }).click();
    await p.getByLabel("Transform X", { exact: true }).waitFor();
    await command(p, "Control+s");
    const stored = await session(p);
    assert.deepEqual(stored, storedBefore);
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true })
      .waitFor({ state: "detached" });
    await fx.open(p);
    fx.same(await fx.preview(p), before);
    // Mask-only Free Transform and keyboard nudge preserve the artwork pose.
    const maskSelection = {
      regions: [
        {
          kind: "rectangle",
          points: [
            { x: 40, y: 20 },
            { x: 64, y: 48 },
          ],
          operation: "add",
        },
      ],
      inverted: false,
      feather: 0,
    };
    const masked = structuredClone(d);
    masked.selection = undefined;
    masked.layers[0].mask = maskFromSelection(maskSelection, masked.layers[0], masked);
    await fx.load(p, masked, source);
    await fx.tab(p, "Layers");
    await p.getByRole("button", { name: "Edit mask Imported artwork", exact: true }).click();
    await command(p, "f");
    await p.getByText("Mask only (affine)", { exact: false }).waitFor();
    await number(p, "Transform X", 8);
    await p.getByRole("button", { name: "Apply transform", exact: true }).first().click();
    const maskImage = await fx.preview(p);
    assert.equal(pixel(maskImage, 42, 22)[3], 0);
    near(pixel(maskImage, 68, 22), pixel(before, 68, 22));
    await command(p, "ArrowRight");
    const maskNative = (await fx.native(p)).value;
    assert.deepEqual(maskNative.document.layers[0].transform, TRANSFORM);
    assert.equal(maskNative.document.layers[0].mask.placement[4], 9);
    // Whole-layer percentage sizing, quick rotations and document-space nudging.
    await fx.load(p, d, source);
    await command(p, "f");
    await number(p, "Transform width percent", 125);
    assert.equal(
      await p.getByLabel("Transform height percent", { exact: true }).inputValue(),
      "125",
    );
    await p.getByRole("button", { name: "Rotate 90°", exact: true }).click();
    assert.equal(await p.getByLabel("Transform rotation", { exact: true }).inputValue(), "90");
    await p.getByRole("button", { name: "Restore initial transform", exact: true }).click();
    await number(p, "Large nudge step", 7);
    for (let turn = 0; turn < 4; turn++) {
      await command(p, "Shift+ArrowRight");
      assert.equal(
        await p.getByLabel("Transform X", { exact: true }).inputValue(),
        String(7 * (turn + 1)),
      );
      await p.getByRole("button", { name: "Rotate canvas view right", exact: true }).click();
    }
    assert.equal(await p.getByLabel("Transform rotation", { exact: true }).inputValue(), "0");
    await p.getByRole("button", { name: "Cancel transform", exact: true }).first().click();
    // Center-anchored canvas resize: output pixel offsets and recovery.
    await fx.tab(p, "Geometry");
    const section = p.locator("summary").filter({ hasText: "Canvas size" });
    if (!(await section.evaluate((el) => el.parentElement.open))) await section.click();
    await p.getByLabel("Canvas anchor", { exact: true }).selectOption("center");
    await number(p, "Document width", 148);
    await number(p, "Document height", 116);
    await p.getByRole("button", { name: "Resize canvas", exact: true }).click();
    const extended = await fx.preview(p);
    assert.equal(extended.width, 148);
    near(pixel(extended, 60, 40), pixel(before, 50, 30));
    await command(p, "Control+z");
    fx.same(await fx.preview(p), before);
    // Percentage output grid, cancellation, real resampling and native metadata.
    await p.getByLabel("Image size in percent", { exact: true }).check();
    await number(p, "Image width percent", 50);
    await p.getByRole("button", { name: "Cancel pending image size", exact: true }).click();
    assert.equal(await p.getByLabel("Image width percent", { exact: true }).inputValue(), "100");
    await number(p, "Image width percent", 50);
    await p.getByLabel("Image resampling", { exact: true }).selectOption("lanczos");
    await p.getByRole("button", { name: "Apply image size", exact: true }).click();
    const out = await fx.raster(p);
    assert.equal(out.width, 64);
    assert.equal(out.height, 48);
    await panels(p, false);
    await p.screenshot({ path: `/workspace/screenshots/r5-${width}.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    results.push({
      width,
      selectedPixels: true,
      cancel: true,
      protectedPixels: true,
      native: true,
      history: true,
      maskOnly: true,
      nudge: true,
      percent: true,
      canvasAnchor: true,
      resampling: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "/workspace/r5-evidence/r5-browser.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }));
} finally {
  await browser.close();
}
