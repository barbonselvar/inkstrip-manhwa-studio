/** R6 real UI, native/PNG pixels, immutable preview, history and R3/R5 integration. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { maskFromSelection } from "../src/lib/studio/pro/masks.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  results = [],
  fx = proBrowserFixtures(base, errors);
await mkdir("/workspace/screenshots", { recursive: true });
await mkdir("/workspace/r6-evidence", { recursive: true });
const pixel = (image, x, y) =>
  image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
async function number(p, name, value) {
  const input = p.getByLabel(name, { exact: true });
  await input.fill(String(value));
  await input.blur();
}
async function lab(p) {
  await fx.tab(p, "Properties");
  await p.getByRole("button", { name: "Color & Filters…", exact: true }).click();
  await p.getByRole("dialog", { name: "Color & Filters", exact: true }).waitFor();
  await ready(p);
}
async function ready(p) {
  await p.getByRole("button", { name: "Apply color", exact: true }).waitFor();
  await p.waitForFunction(() => {
    const b = [...document.querySelectorAll(".r6-lab button")].find(
      (b) => b.textContent === "Apply color",
    );
    return b && !b.disabled;
  });
  await p.waitForFunction(
    () => document.querySelector('[aria-label="Native color preview"]')?.width === 128,
  );
}
async function preview(p) {
  return p.getByLabel("Native color preview", { exact: true }).evaluate((c) => ({
    width: c.width,
    height: c.height,
    pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
  }));
}
async function command(p, key) {
  await p.locator(".pro-panel-tabs").evaluate((el) => {
    document.activeElement?.blur();
    el.focus();
  });
  await p.keyboard.press(key);
}
try {
  for (const width of process.argv.includes("--group-only") ? [] : [1440, 768, 390, 360, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
      }),
      p = await context.newPage();
    console.log(`R6 viewport ${width}`);
    const source = await fx.start(p);
    await fx.open(p);
    const doc = fromPanel({ id: "r6", name: "Color fixture", width: 128, height: 96 });
    doc.selection = {
      regions: [
        {
          kind: "rectangle",
          points: [
            { x: 32, y: 16 },
            { x: 80, y: 64 },
          ],
          operation: "add",
        },
      ],
      inverted: false,
      feather: 0,
    };
    await fx.load(p, doc, source);
    const before = await fx.preview(p);
    await fx.tab(p, "History");
    const historyCount = await p.locator(".pro-history-list li").count();
    await lab(p);
    fx.same(await preview(p), before);
    await number(p, "Brightness", 20);
    await ready(p);
    const changed = await preview(p);
    assert.notDeepEqual(pixel(changed, 50, 30), pixel(before, 50, 30));
    await p.getByLabel("Compare original color", { exact: true }).check();
    await p.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Native color preview"]')
          .getContext("2d")
          .getImageData(50, 30, 1, 1).data[0] === 100,
    );
    fx.same(await preview(p), before);
    await p.getByLabel("Compare original color", { exact: true }).uncheck();
    await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("levels");
    await p.getByLabel("Color channel", { exact: true }).selectOption("red");
    await number(p, "Output black", 20);
    await number(p, "Output white", 220);
    await ready(p);
    const levels = await preview(p);
    assert.equal(pixel(levels, 64, 40)[0], 120);
    assert.deepEqual(pixel(levels, 64, 40).slice(1), pixel(before, 64, 40).slice(1));
    await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("curves");
    await p.getByRole("button", { name: "Add curve point", exact: true }).click();
    await number(p, "Curve output", 200);
    await ready(p);
    const graph = p.getByLabel("Curves graph: tap to add or drag points", { exact: true });
    await graph.scrollIntoViewIfNeeded();
    const bounds = await graph.boundingBox(),
      start = {
        x: bounds.x + (bounds.width * 128) / 255,
        y: bounds.y + (bounds.height * 55) / 255,
      };
    if (width < 800) {
      const cdp = await context.newCDPSession(p);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: start.x + 12, y: start.y - 8 }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else {
      await p.mouse.move(start.x, start.y);
      await p.mouse.down();
      await p.mouse.move(start.x + 12, start.y - 8, { steps: 3 });
      await p.mouse.up();
    }
    assert.ok(Number(await p.getByLabel("Curve input", { exact: true }).inputValue()) > 128);
    await number(p, "Curve input", 128);
    await number(p, "Curve output", 200);
    await ready(p);
    const curve = await preview(p);
    assert.ok(pixel(curve, 64, 40)[0] > 190);
    await p.getByRole("button", { name: "Remove curve point", exact: true }).click();
    await ready(p);
    fx.same(await preview(p), before);
    if (width === 1440) {
      await p.locator(".r6-lab summary").filter({ hasText: "Presets" }).click();
      await p
        .getByLabel("Color preset", { exact: true })
        .selectOption({ label: "Manhwa Color Enhancement" });
      await number(p, "Vibrance", 31);
      await p.getByLabel("Custom color preset name", { exact: true }).fill("R6 test preset");
      await p.getByRole("button", { name: "Save color preset", exact: true }).click();
      await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("invert");
      await p.getByLabel("Color preset", { exact: true }).selectOption({ label: "R6 test preset" });
      assert.equal(await p.getByLabel("Vibrance", { exact: true }).inputValue(), "31");
      await p.getByRole("button", { name: "Delete R6 test preset", exact: true }).click();
      await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("curves");
      await ready(p);
      // Exercise all spatial operations through their actual worker/PNG preview.
      for (const kind of [
        "gaussian",
        "box",
        "motion",
        "sharpen",
        "unsharp",
        "noise",
        "denoise",
        "median",
        "highPass",
        "edges",
      ]) {
        await p.getByLabel("Adjustment or filter", { exact: true }).selectOption(kind);
        await ready(p);
        const filtered = await preview(p);
        assert.deepEqual(pixel(filtered, 24, 40).slice(3), [128], kind);
        assert.deepEqual(pixel(filtered, 8, 40), [0, 0, 0, 0], kind);
        if (["highPass", "edges", "noise"].includes(kind))
          assert.notDeepEqual(pixel(filtered, 64, 40), pixel(before, 64, 40), kind);
      }
    }
    // No document/history mutation from lab shortcuts or a cancelled in-flight filter.
    await p.getByRole("button", { name: "Reset color settings", exact: true }).focus();
    await p.keyboard.press("Control+z");
    assert.equal(await p.getByRole("dialog", { name: "Color & Filters", exact: true }).count(), 1);
    await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("gaussian");
    await number(p, "Gaussian sigma", 32);
    await p.getByRole("button", { name: "Cancel color", exact: true }).click();
    fx.same(await fx.preview(p), before);
    await fx.tab(p, "History");
    assert.equal(await p.locator(".pro-history-list li").count(), historyCount);
    const cancelled = (await fx.native(p)).value;
    assert.equal(cancelled.document.layers.length, 1);
    assert.equal(Object.keys(cancelled.assets).length, 1);
    assert.ok(Object.values(cancelled.assets).some((a) => a.data === source));
    // Capture selection, supersede parameters rapidly, then apply exactly the displayed PNG.
    await lab(p);
    await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("exposure");
    await number(p, "Exposure stops", 3);
    await number(p, "Exposure stops", -2);
    await number(p, "Exposure stops", 1);
    await ready(p);
    const exposure = await preview(p);
    assert.equal(pixel(exposure, 64, 40)[0], 176);
    await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("invert");
    await p.getByLabel("Process captured selection only", { exact: true }).check();
    await ready(p);
    const staged = await preview(p);
    assert.deepEqual(pixel(staged, 50, 30), [155, 195, 175, 255]);
    assert.deepEqual(pixel(staged, 90, 30), pixel(before, 90, 30));
    await p.screenshot({ path: `/workspace/screenshots/r6-lab-${width}.png` });
    const overflow = await p.locator(".r6-lab").evaluate((el) => ({
      overflow: el.scrollWidth > el.clientWidth + 1,
      bounds: el.getBoundingClientRect().toJSON(),
    }));
    assert.equal(overflow.overflow, false);
    assert.ok(overflow.bounds.x >= 0 && overflow.bounds.right <= width + 1);
    await p.getByRole("button", { name: "Apply color", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Color & Filters", exact: true })
      .waitFor({ state: "hidden" });
    console.log(`R6 ${width}: Apply complete`);
    const applied = await fx.preview(p);
    fx.same(applied, staged);
    await fx.tab(p, "History");
    assert.equal(await p.locator(".pro-history-list li").count(), historyCount + 1);
    await command(p, "Control+z");
    fx.same(await fx.preview(p), before);
    await command(p, "Control+Shift+z");
    fx.same(await fx.preview(p), applied);
    const saved = (await fx.native(p)).value;
    assert.equal(saved.version, 1);
    assert.equal(saved.document.layers.length, 2);
    assert.equal(saved.document.layers[0].visible, false);
    assert.ok(Object.values(saved.assets).some((a) => a.data === source));
    fx.same(await fx.raster(p), applied);
    await fx.load(p, saved.document, source, saved.assets);
    fx.same(await fx.preview(p), applied);
    console.log(`R6 ${width}: native and export complete`);
    // R5 transform still acts on the processed layer and Undo restores processed pixels.
    await fx.tab(p, "Transform");
    await p.getByRole("button", { name: "Free Transform tool", exact: true }).click();
    await number(p, "Transform X", 4);
    await p.getByRole("button", { name: "Apply transform", exact: true }).first().click();
    const moved = await fx.preview(p);
    assert.deepEqual(pixel(moved, 54, 30), pixel(applied, 50, 30));
    await command(p, "Control+z");
    fx.same(await fx.preview(p), applied);
    // Native touch/desktop brush creates editable R3 paint above immutable processed raster.
    const toggle = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
    await p.getByRole("button", { name: "Brush tool", exact: true }).click();
    const r = await fx.artboardBounds(p),
      x = r.x + r.width * 0.45,
      y = r.y + r.height * 0.5;
    if (width < 800) {
      const cdp = await context.newCDPSession(p);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + 12, y: y + 8 }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else {
      await p.mouse.move(x, y);
      await p.mouse.down();
      await p.mouse.move(x + 12, y + 8, { steps: 3 });
      await p.mouse.up();
    }
    await toggle.click();
    const painted = (await fx.native(p)).value;
    assert.ok(painted.document.layers.some((l) => l.kind === "paint" && l.strokes.length > 0));
    results.push({
      width,
      pixelApplyCancelHistoryNativeExport: true,
      levelsCurvesExposure: true,
      selection: true,
      rapidPreview: true,
      r3Painting: true,
      r5Transform: true,
      touchEmulation: width < 800,
    });
    await context.close();
  }
  // Group/mask/clipping integration: a neutral bake must preserve the exact final composite.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      p = await context.newPage();
    const source = await fx.start(p);
    await fx.open(p);
    const d = fromPanel({ id: "group", name: "Group integration", width: 128, height: 96 }),
      base = d.layers[0];
    base.name = "Masked source";
    base.parentId = "g";
    const group = layer("group", 128, 96, "g");
    group.opacity = 0.8;
    const selection = {
      regions: [
        {
          kind: "rectangle",
          points: [
            { x: 16, y: 10 },
            { x: 100, y: 80 },
          ],
          operation: "add",
        },
      ],
      inverted: false,
      feather: 2,
    };
    base.mask = maskFromSelection(selection, base, d);
    base.mask.density = 0.65;
    base.mask.linked = false;
    const clip = layer("shape", 60, 45, "clip");
    clip.parentId = "g";
    clip.clipped = true;
    clip.fill = "#ff4000";
    clip.strokeWidth = 0;
    clip.opacity = 0.35;
    clip.blend = "screen";
    const adjustment = layer("adjustment", 128, 96, "adjustment");
    adjustment.parentId = "g";
    adjustment.color = { vibrance: 25 };
    adjustment.opacity = 0.7;
    d.layers = [group, base, clip, adjustment];
    await fx.load(p, d, source);
    await fx.tab(p, "Layers");
    await p.locator(`[data-layer-id="${base.id}"] .pro-layer-select`).click();
    const before = await fx.preview(p);
    await lab(p);
    await p.getByRole("button", { name: "Apply color", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Color & Filters", exact: true })
      .waitFor({ state: "hidden" });
    fx.same(await fx.preview(p), before);
    const saved = (await fx.native(p)).value,
      target = saved.document.layers.find((l) => l.name === "Masked source");
    assert.deepEqual(target.mask, JSON.parse(JSON.stringify(base.mask)));
    assert.equal(target.parentId, "g");
    assert.ok(saved.document.layers.some((l) => l.id === "adjustment" && l.kind === "adjustment"));
    fx.same(await fx.raster(p), before);
    await lab(p);
    await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("invert");
    await ready(p);
    await p.getByRole("button", { name: "Apply color", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Color & Filters", exact: true })
      .waitFor({ state: "hidden" });
    const masked = await fx.preview(p);
    assert.notDeepEqual(pixel(masked, 50, 30), pixel(before, 50, 30));
    assert.deepEqual(pixel(masked, 110, 85), pixel(before, 110, 85));
    for (let i = 3; i < masked.pixels.length; i += 4)
      assert.equal(masked.pixels[i], before.pixels[i]);
    fx.same(await fx.raster(p), masked);
    await fx.tab(p, "Layers");
    await p.getByRole("button", { name: "Edit mask Masked source", exact: true }).click();
    await fx.tab(p, "Properties");
    assert.ok(await p.getByRole("button", { name: "Color & Filters…", exact: true }).isDisabled());
    await fx.tab(p, "Layers");
    await p.locator(`[data-layer-id="${base.id}"] .pro-layer-select`).click();
    await p.getByRole("button", { name: "Lock layer Masked source", exact: true }).click();
    await fx.tab(p, "Properties");
    assert.ok(await p.getByRole("button", { name: "Color & Filters…", exact: true }).isDisabled());
    results.push({
      groupMaskClippingExistingAdjustment: true,
      neutralBakeExact: true,
      lockedTargetRejected: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, results, errors }, null, 2));
  await writeFile(
    process.argv.includes("--group-only")
      ? "/workspace/r6-evidence/browser-group-only.json"
      : "/workspace/r6-evidence/browser.json",
    JSON.stringify({ passed: true, results, errors }, null, 2),
  );
} finally {
  await browser.close();
}
