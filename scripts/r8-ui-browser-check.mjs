import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel } from "../src/lib/studio/pro/model.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  fx = proBrowserFixtures(base, errors),
  results = [];
const ready = async (p) =>
  p.waitForFunction(() => {
    const c = document.querySelector('[aria-label="Layer properties composite preview"]'),
      b = [...document.querySelectorAll(".r8-lab button")].find(
        (b) => b.textContent === "Apply layer properties",
      );
    return (
      c?.width === 128 &&
      c.height === 96 &&
      c.getAttribute("aria-busy") === "false" &&
      b &&
      !b.disabled
    );
  });
const preview = async (p) => {
  await ready(p);
  return p.getByLabel("Layer properties composite preview", { exact: true }).evaluate((c) => ({
    width: c.width,
    height: c.height,
    pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
  }));
};
const number = async (p, label, value) => {
  await p.getByLabel(label, { exact: true }).fill(String(value));
  await p.getByLabel(label, { exact: true }).blur();
};
try {
  await mkdir("/workspace/screenshots", { recursive: true });
  await mkdir("/workspace/r8-evidence", { recursive: true });
  for (const width of process.argv.includes("--quick") ? [1440] : [1440, 768, 390, 360, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
      }),
      p = await context.newPage(),
      source = await fx.start(p);
    await fx.open(p);
    const doc = fromPanel({ id: "r8-ui", name: "R8 UI", width: 128, height: 96 });
    await fx.load(p, doc, source);
    await fx.tab(p, "Properties");
    assert.equal(
      await p.getByText("Editable layer effects", { exact: true }).isVisible(),
      true,
      "legacy documents retain their existing direct appearance controls",
    );
    const original = (await fx.native(p)).value,
      originalPixels = await fx.preview(p);
    await fx.tab(p, "History");
    const count = await p.locator(".pro-history-list li").count();
    await fx.tab(p, "Properties");
    await p.getByRole("button", { name: "New Gradient Fill", exact: true }).click();
    await ready(p);
    await p.getByRole("button", { name: "Cancel layer properties", exact: true }).click();
    assert.deepEqual((await fx.native(p)).value, original);
    await fx.tab(p, "History");
    assert.equal(
      await p.locator(".pro-history-list li").count(),
      count,
      "Cancel creation adds no history",
    );
    await fx.tab(p, "Properties");
    await p.getByRole("button", { name: "New Gradient Fill", exact: true }).click();
    await ready(p);
    const dialog = p.getByRole("dialog", { name: "Layer styles and Smart Filters", exact: true });
    await dialog.getByRole("tab", { name: "Gradient", exact: true }).click();
    await dialog.getByLabel("Gradient type", { exact: true }).selectOption("diamond");
    await dialog.getByLabel("Gradient interpolation", { exact: true }).selectOption("oklab");
    for (const i of [1, 2]) {
      await dialog.getByLabel(`Select gradient stop ${i}`, { exact: true }).click();
      await dialog.getByLabel("Stop color", { exact: true }).fill("#0000ff");
    }
    await dialog.getByRole("button", { name: "Add gradient stop", exact: true }).click();
    await number(dialog, "Stop midpoint", 40);
    await dialog.getByRole("button", { name: "Add gradient stop", exact: true }).click();
    await number(dialog, "Stop midpoint", 30);
    const marker = dialog.getByLabel("Select gradient stop 2", { exact: true });
    await marker.scrollIntoViewIfNeeded();
    const ramp = await dialog.locator(".r8-stop-ramp").boundingBox(),
      handle = await marker.boundingBox(),
      a = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      z = { x: ramp.x + ramp.width * 0.75, y: a.y };
    if (width < 800) {
      const c = await context.newCDPSession(p);
      await c.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ ...a, id: 1 }],
      });
      for (let i = 1; i <= 8; i++)
        await c.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: a.x + ((z.x - a.x) * i) / 8, y: a.y, id: 1 }],
        });
      await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await c.detach();
    } else {
      await p.mouse.move(a.x, a.y);
      await p.mouse.down();
      await p.mouse.move(z.x, z.y, { steps: 8 });
      await p.mouse.up();
    }
    await dialog.getByLabel("Active gradient stop", { exact: true }).selectOption("2");
    assert.equal(
      await dialog.getByLabel("Stop midpoint", { exact: true }).inputValue(),
      "30",
      "drag preserves/reorders the actual stop record",
    );
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
      "properties panel has no horizontal overflow",
    );
    await dialog.getByRole("tab", { name: "Layer Styles", exact: true }).click();
    await dialog.getByLabel("Enable Color Overlay", { exact: true }).check();
    await dialog.getByLabel("Color Overlay color", { exact: true }).fill("#ff0000");
    await number(dialog, "Color Overlay opacity", 50);
    const style = await preview(p);
    assert.deepEqual(
      style.pixels.slice((48 * 128 + 64) * 4, (48 * 128 + 64) * 4 + 4),
      [128, 0, 128, 255],
    );
    await dialog.getByRole("tab", { name: "Smart Filters", exact: true }).click();
    await dialog.getByLabel("Add Smart Filter", { exact: true }).selectOption("gaussian");
    await dialog.getByLabel("Add Smart Filter", { exact: true }).selectOption("grain");
    await dialog.getByLabel("Noise distribution", { exact: true }).selectOption("gaussian");
    await number(dialog, "Noise strength", 20);
    await number(dialog, "Noise seed", 42);
    // Temporarily hide overlay so processing order has a direct, observable pixel effect.
    await dialog.getByRole("tab", { name: "Layer Styles", exact: true }).click();
    await dialog.getByLabel("Enable Color Overlay", { exact: true }).uncheck();
    const beforeOrder = await preview(p);
    await dialog.getByRole("tab", { name: "Smart Filters", exact: true }).click();
    await dialog.getByRole("button", { name: "Move filter earlier", exact: true }).last().click();
    const afterOrder = await preview(p);
    assert.notDeepEqual(
      afterOrder.pixels,
      beforeOrder.pixels,
      "filter reorder changes actual pixels",
    );
    for (const seed of [43, 99, 100]) await number(dialog, "Noise seed", seed);
    await dialog.getByLabel("Compare committed layer properties", { exact: true }).check();
    await p.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Layer properties composite preview"]')
          ?.getAttribute("aria-busy") === "false",
    );
    const comparison = await dialog
      .getByLabel("Layer properties composite preview", { exact: true })
      .evaluate((c) => ({
        width: c.width,
        height: c.height,
        pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
      }));
    fx.same(comparison, originalPixels, 0);
    await dialog.getByLabel("Compare committed layer properties", { exact: true }).uncheck();
    await ready(p);
    await dialog.locator(".r8-presets summary").click();
    await dialog.getByLabel("Layer property preset name", { exact: true }).fill(`R8 ${width}`);
    await dialog.getByRole("button", { name: "Save layer property preset", exact: true }).click();
    await p.screenshot({ path: `/workspace/screenshots/r8-properties-${width}.png` });
    const applied = await preview(p);
    await dialog.getByRole("button", { name: "Apply layer properties", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await p.getByText("Editable layer effects", { exact: true }).count(),
      0,
      "upgraded documents use the transactional editor without duplicate legacy controls",
    );
    fx.same(await fx.preview(p), applied, 0);
    fx.same(await fx.raster(p), applied, 0);
    const native = (await fx.native(p)).value;
    assert.equal(native.version, 9);
    assert.equal(native.document.version, 3);
    assert.equal(native.document.layers.length, original.document.layers.length + 1);
    assert.deepEqual(native.assets, original.assets);
    assert.deepEqual(native.document.layers[0], original.document.layers[0]);
    const fill = native.document.layers.at(-1);
    assert.equal(fill.kind, "gradient");
    assert.equal(fill.gradient.kind, "diamond");
    assert.equal(fill.gradient.interpolation, "oklab");
    assert.equal(fill.gradient.stops.length, 4);
    assert.equal(fill.gradient.stops[2].midpoint, 0.3);
    assert.equal(fill.smartFilters[0].operation.seed, 100);
    assert.deepEqual(
      fill.smartFilters.map((f) => f.operation.kind),
      ["grain", "gaussian"],
    );
    await fx.tab(p, "History");
    assert.equal(
      await p.locator(".pro-history-list li").count(),
      Math.min(51, count + 1),
      "create and all preview edits commit once",
    );
    await fx.tab(p, "Properties");
    await p.getByRole("button", { name: "Layer styles and Smart Filters", exact: true }).click();
    fx.same(await preview(p), applied, 0);
    await dialog.getByRole("tab", { name: "Layer Styles", exact: true }).click();
    await dialog.getByLabel("Enable Bevel and Emboss", { exact: true }).check();
    assert.notDeepEqual((await preview(p)).pixels, applied.pixels);
    await dialog.getByRole("button", { name: "Cancel layer properties", exact: true }).click();
    assert.deepEqual((await fx.native(p)).value, native, "Cancel restores exact settings/assets");
    await fx.load(p, native.document, source, native.assets);
    fx.same(await fx.preview(p), applied, 0);
    fx.same(await fx.raster(p), applied, 0);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    await p.screenshot({ path: `/workspace/screenshots/r8-ui-${width}.png` });
    results.push({
      width,
      creationCancelExact: true,
      oneHistoryEntry: true,
      stylesPixels: true,
      filterReorderPixels: true,
      presetSaved: true,
      stopDragReorder: true,
      beforeAfterExact: true,
      rapidParameters: true,
      nativeExact: true,
      cancelExact: true,
      sourcePreserved: true,
      overflow: false,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = {
    results,
    errors,
    pixelTolerance: 0,
    chromium: browser.version(),
    physicalAndroid: false,
  };
  await writeFile("/workspace/r8-evidence/ui-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
