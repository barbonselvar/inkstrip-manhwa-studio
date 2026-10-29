import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { fromPanel } from "../src/lib/studio/pro/model.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
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
const pixels = async (p) => {
  await ready(p);
  return p.getByLabel("Layer properties composite preview", { exact: true }).evaluate((c) => ({
    width: c.width,
    height: c.height,
    pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
  }));
};
const number = async (p, name, v) => {
  await p.getByLabel(name, { exact: true }).fill(String(v));
  await p.getByLabel(name, { exact: true }).blur();
};
const at = (p, x, y) => p.pixels.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 4);
try {
  await mkdir("/workspace/screenshots", { recursive: true });
  for (const width of process.argv.includes("--quick") ? [1440] : [1440, 768, 390, 360, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
      }),
      p = await context.newPage(),
      source = await fx.start(p);
    await fx.open(p);
    await fx.load(p, fromPanel({ id: "pattern", name: "Pattern", width: 128, height: 96 }), source);
    const original = (await fx.native(p)).value,
      originalPixels = await fx.preview(p);
    const tile = await p.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 2;
      const ctx = c.getContext("2d");
      ctx.putImageData(
        new ImageData(
          new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 240, 120, 0, 0]),
          2,
          2,
        ),
        0,
        0,
      );
      return c.toDataURL().split(",")[1];
    });
    await fx.tab(p, "Properties");
    const open = () =>
      p.getByRole("button", { name: "Layer styles and Smart Filters", exact: true }).click();
    await open();
    await ready(p);
    const d = p.getByRole("dialog", { name: "Layer styles and Smart Filters", exact: true });
    await d.getByLabel("Enable Pattern Overlay", { exact: true }).check();
    const procedural = await pixels(p);
    const input = d.getByLabel("Import bitmap pattern", { exact: true });
    await input.setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("not a PNG"),
    });
    await d.getByText(/Unsupported, malformed|Invalid.*image|Malformed.*image/).waitFor();
    fx.same(await pixels(p), procedural, 0);
    await input.setInputFiles({
      name: "tile.png",
      mimeType: "image/png",
      buffer: Buffer.from(tile, "base64"),
    });
    await d
      .getByText("Bitmap pattern imported into this editable draft. Apply to save it.", {
        exact: true,
      })
      .waitFor();
    const imported = await pixels(p);
    assert.deepEqual(at(imported, 80, 48), [255, 0, 0, 255]);
    assert.equal(at(imported, 20, 48)[3], 128, "overlay preserves source alpha");
    await number(d, "Pattern scale", 2);
    await number(d, "Pattern offsetX", 1);
    await number(d, "Pattern offsetY", 3);
    const scaled = await pixels(p);
    assert.notDeepEqual(scaled.pixels, imported.pixels);
    await d.getByRole("button", { name: "Cancel layer properties", exact: true }).click();
    assert.deepEqual(
      (await fx.native(p)).value,
      original,
      "Cancel cannot leak staged pattern assets",
    );
    fx.same(await fx.preview(p), originalPixels, 0);
    await fx.tab(p, "History");
    const count = await p.locator(".pro-history-list li").count();
    await fx.tab(p, "Properties");
    await open();
    await ready(p);
    await d.getByLabel("Enable Pattern Overlay", { exact: true }).check();
    await input.setInputFiles({
      name: "tile.png",
      mimeType: "image/png",
      buffer: Buffer.from(tile, "base64"),
    });
    await d
      .getByText("Bitmap pattern imported into this editable draft. Apply to save it.", {
        exact: true,
      })
      .waitFor();
    await number(d, "Pattern scale", 2);
    await number(d, "Pattern offsetX", 1);
    await number(d, "Pattern offsetY", 3);
    await number(d, "Pattern Overlay opacity", 65);
    const expected = await pixels(p);
    await p.screenshot({ path: `/workspace/screenshots/r10-pattern-${width}.png` });
    await d.getByRole("button", { name: "Copy layer style", exact: true }).click();
    await d.getByText(/Bitmap styles carry document-owned assets/).waitFor();
    await d.getByRole("button", { name: "Apply layer properties", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    fx.same(await fx.preview(p), expected, 0);
    fx.same(await fx.raster(p), expected, 0);
    const saved = (await fx.native(p)).value,
      pat = saved.document.layers[0].effects[0].pattern;
    assert.equal(saved.version, 9);
    assert.equal(saved.document.version, 3);
    assert.equal(saved.document.layers[0].effects[0].version, 3);
    assert.equal(saved.assets[pat.assetId].data, tile);
    for (const [id, a] of Object.entries(original.assets)) assert.deepEqual(saved.assets[id], a);
    await fx.tab(p, "History");
    assert.equal(await p.locator(".pro-history-list li").count(), count + 1);
    await p.getByRole("button", { name: "Undo", exact: true }).click();
    fx.same(await fx.preview(p), originalPixels, 0);
    await p.getByRole("button", { name: "Redo", exact: true }).click();
    fx.same(await fx.preview(p), expected, 0);
    await fx.load(p, saved.document, source, saved.assets);
    fx.same(await fx.preview(p), expected, 0);
    fx.same(await fx.raster(p), expected, 0);
    const remapped = (await fx.native(p)).value,
      remappedId = remapped.document.layers[0].effects[0].pattern.assetId;
    assert.notEqual(remappedId, pat.assetId);
    assert.equal(remapped.assets[remappedId].data, tile);
    await p.getByText("Draft saved", { exact: true }).first().waitFor();
    await p.reload();
    await p.getByText("Chapter workspace", { exact: true }).waitFor();
    await fx.open(p);
    fx.same(await fx.preview(p), expected, 0);
    assert.equal((await fx.native(p)).value.assets[remappedId].data, tile);
    await fx.tab(p, "Properties");
    await open();
    await ready(p);
    assert.equal(await d.getByLabel("Pattern texture", { exact: true }).inputValue(), "bitmap");
    await d.getByLabel("Pattern texture", { exact: true }).selectOption("stripes");
    assert.notDeepEqual((await pixels(p)).pixels, expected.pixels);
    await d.getByRole("button", { name: "Cancel layer properties", exact: true }).click();
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    results.push({
      width,
      originalBytes: true,
      malformedInputRefused: true,
      cancelNoAssetLeak: true,
      premultipliedTexture: true,
      scalePositionOpacity: true,
      undoRedo: true,
      nativeRemap: true,
      autosaveReload: true,
      exportTolerance: 0,
      proceduralPreserved: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { results, errors, pixelTolerance: 0, physicalAndroid: false };
  await writeFile("/workspace/r10-evidence/pattern-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
