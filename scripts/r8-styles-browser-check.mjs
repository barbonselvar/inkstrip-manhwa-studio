import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { EFFECT_NAMES } from "../src/lib/studio/pro/effects.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const errors = [],
  results = [],
  fx = proBrowserFixtures(base, errors),
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
async function modal(p) {
  await fx.tab(p, "Properties");
  await p.getByRole("button", { name: "Layer styles and Smart Filters", exact: true }).click();
  await p.getByRole("dialog", { name: "Layer styles and Smart Filters", exact: true }).waitFor();
  await ready(p);
  return p.getByRole("dialog", { name: "Layer styles and Smart Filters", exact: true });
}
async function ready(p) {
  await p.waitForFunction(() => {
    const c = document.querySelector('[aria-label="Layer properties composite preview"]'),
      b = [...document.querySelectorAll(".r8-lab button")].find(
        (b) => b.textContent === "Apply layer properties",
      );
    return c?.getAttribute("aria-busy") === "false" && b && !b.disabled;
  });
}
async function pixels(p) {
  await ready(p);
  return p
    .getByLabel("Layer properties composite preview", { exact: true })
    .evaluate((c) => ({
      width: c.width,
      height: c.height,
      pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
    }));
}
try {
  await mkdir("/workspace/screenshots", { recursive: true });
  await mkdir("/workspace/r8-evidence", { recursive: true });
  for (const width of [1440, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 500,
        isMobile: width < 500,
      }),
      p = await context.newPage(),
      source = await fx.start(p);
    await fx.open(p);
    const d = fromPanel({ id: "styles", name: "Layer styles", width: 128, height: 96 });
    d.layers[0].visible = false;
    const a = layer("paint", 128, 96, "a");
    a.name = "First paint";
    a.strokes = [
      {
        points: [
          { x: 24, y: 36 },
          { x: 64, y: 36 },
        ],
        size: 14,
        hardness: 1,
        opacity: 1,
        flow: 1,
        color: "#808080",
        erase: false,
      },
    ];
    const b = structuredClone(a);
    b.id = "b";
    b.name = "Second paint";
    b.transform.y = 36;
    d.layers.push(a, b);
    await fx.load(p, d, source);
    await fx.tab(p, "Layers");
    await p.locator('[data-layer-id="a"] .pro-layer-select').click();
    const basePixels = await fx.preview(p),
      original = (await fx.native(p)).value;
    let dialog = await modal(p);
    for (const name of Object.values(EFFECT_NAMES)) {
      await dialog.getByLabel(`Enable ${name}`, { exact: true }).check();
      assert.notDeepEqual(
        (await pixels(p)).pixels,
        basePixels.pixels,
        `${name} must change actual composite pixels`,
      );
      await dialog.getByLabel(`Enable ${name}`, { exact: true }).uncheck();
      fx.same(await pixels(p), basePixels, 0);
    }
    await dialog.getByLabel("Enable Stroke", { exact: true }).check();
    await dialog.getByLabel("Stroke fill", { exact: true }).selectOption("gradient");
    await dialog.getByLabel("Enable Pattern Overlay", { exact: true }).check();
    await dialog.getByLabel("Pattern texture", { exact: true }).selectOption("dots");
    await dialog.getByLabel("Enable Bevel and Emboss", { exact: true }).check();
    await dialog.getByLabel("Bevel direction", { exact: true }).selectOption("down");
    await dialog.getByLabel("Bevel and Emboss global light", { exact: true }).check();
    await dialog.getByLabel("Shared light angle", { exact: true }).fill("45");
    await dialog.getByLabel("Shared light angle", { exact: true }).blur();
    await dialog.getByRole("button", { name: "Copy layer style", exact: true }).click();
    await dialog.locator(".r8-presets summary").click();
    await dialog.getByLabel("Layer property preset name", { exact: true }).fill("Fixture style");
    await dialog.getByRole("button", { name: "Save layer property preset", exact: true }).click();
    await dialog.getByRole("button", { name: "Duplicate style preset", exact: true }).click();
    assert.equal(
      await dialog
        .getByLabel("Layer property preset", { exact: true })
        .locator("option")
        .filter({ hasText: "Fixture style copy" })
        .count(),
      1,
    );
    const styledA = await pixels(p);
    await dialog.getByRole("button", { name: "Apply layer properties", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    fx.same(await fx.preview(p), styledA, 0);
    const first = (await fx.native(p)).value;
    await fx.tab(p, "Layers");
    await p.locator('[data-layer-id="b"] .pro-layer-select').click();
    dialog = await modal(p);
    await dialog.getByRole("button", { name: "Paste layer style", exact: true }).click();
    const styledBoth = await pixels(p);
    await dialog.getByRole("button", { name: "Apply layer properties", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    fx.same(await fx.preview(p), styledBoth, 0);
    const both = (await fx.native(p)).value;
    assert.deepEqual(
      both.document.layers.find((l) => l.id === "a").effects,
      both.document.layers.find((l) => l.id === "b").effects,
    );
    assert.deepEqual(both.assets, original.assets);
    assert.deepEqual(both.document.layers.find((l) => l.id === "b").strokes, b.strokes);
    dialog = await modal(p);
    await dialog.getByRole("button", { name: "Remove all layer effects", exact: true }).click();
    const removed = await pixels(p);
    await dialog.getByRole("button", { name: "Apply layer properties", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const noStyle = (await fx.native(p)).value;
    assert.equal(noStyle.document.layers.find((l) => l.id === "b").effects, undefined);
    fx.same(await fx.preview(p), removed, 0);
    await fx.tab(p, "History");
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    fx.same(await fx.preview(p), styledBoth, 0);
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    fx.same(await fx.preview(p), removed, 0);
    assert.deepEqual(first.document.layers.find((l) => l.id === "a").strokes, a.strokes);
    // Quick Mask is an actual temporary R7 coverage layer, never an R8 properties target.
    await p.locator(".pro-panel-tabs").evaluate((el) => {
      document.activeElement?.blur();
      el.focus();
    });
    await p.keyboard.press("q");
    await fx.tab(p, "Properties");
    assert.equal(
      await p
        .getByRole("button", { name: "Layer styles and Smart Filters", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await p.getByRole("button", { name: "New Gradient Fill", exact: true }).isDisabled(),
      true,
    );
    await p.screenshot({ path: `/workspace/screenshots/r8-style-management-${width}.png` });
    results.push({
      width,
      nineEffectsRealPixels: true,
      disableExact: true,
      gradientStroke: true,
      pattern: true,
      bevel: true,
      copyPasteExact: true,
      duplicatePreset: true,
      removeUndoRedoExact: true,
      quickMaskExcluded: true,
      sourcePreserved: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { results, errors, pixelTolerance: 0 };
  await writeFile("/workspace/r8-evidence/styles-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
