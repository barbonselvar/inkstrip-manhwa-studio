import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, toLocalSelection } from "../src/lib/studio/pro/model.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  fx = proBrowserFixtures(base, errors),
  results = [];
const ready = async (p) =>
  p.waitForFunction(() => {
    const c = document.querySelector('[aria-label="Layer properties composite preview"]');
    return c?.width === 128 && c.height === 96 && c.getAttribute("aria-busy") === "false";
  });
const preview = async (p) => {
  await ready(p);
  return p.getByLabel("Layer properties composite preview", { exact: true }).evaluate((c) => ({
    width: c.width,
    height: c.height,
    pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
  }));
};
const pixel = (v, x, y) => v.pixels.slice((y * v.width + x) * 4, (y * v.width + x) * 4 + 4);
const number = async (p, name, v) => {
  await p.getByLabel(name, { exact: true }).fill(String(v));
  await p.getByLabel(name, { exact: true }).blur();
};
async function paint(p, context, width, x, y) {
  const c = p.getByLabel("Paintable filter mask canvas", { exact: true });
  await c.scrollIntoViewIfNeeded();
  const r = await c.boundingBox(),
    point = { x: r.x + (x * r.width) / 128, y: r.y + (y * r.height) / 96 };
  if (width < 800) {
    const cdp = await context.newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...point, id: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else await p.mouse.click(point.x, point.y);
}
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
    const doc = fromPanel({ id: "r10-mask", name: "R10 mask", width: 128, height: 96 });
    doc.version = 3;
    doc.selection = {
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 64, y: 0 },
            { x: 128, y: 96 },
          ],
        },
      ],
      inverted: false,
      feather: 0,
    };
    doc.layers[0].smartFilters = [
      {
        id: "noise",
        enabled: true,
        operation: {
          kind: "grain",
          distribution: "uniform",
          amount: 80,
          seed: 42,
          monochrome: true,
        },
      },
    ];
    await fx.load(p, doc, source);
    const original = (await fx.native(p)).value,
      filtered = await fx.preview(p);
    await fx.tab(p, "History");
    const count = await p.locator(".pro-history-list li").count();
    await fx.tab(p, "Properties");
    await p.getByRole("button", { name: "Layer styles and Smart Filters", exact: true }).click();
    await ready(p);
    const d = p.getByRole("dialog", { name: "Layer styles and Smart Filters", exact: true });
    await d.getByRole("tab", { name: "Smart Filters", exact: true }).click();
    await d.getByRole("button", { name: "Paint filter mask", exact: true }).click();
    assert.equal(
      await d.getByRole("button", { name: "Apply layer properties", exact: true }).isDisabled(),
      true,
    );
    await number(d, "Mask brush size", 32);
    await number(d, "Mask brush hardness", 100);
    await number(d, "Mask brush opacity", 100);
    // Existing R7 selection clips painting, including a dab entirely outside its bounds.
    await paint(p, context, width, 48, 48);
    fx.same(await preview(p), filtered, 0);
    await paint(p, context, width, 80, 48);
    const painted = await preview(p);
    assert.notDeepEqual(painted.pixels, filtered.pixels);
    const raw = await p.evaluate(async (source) => {
      const b = await createImageBitmap(
          new Blob([Uint8Array.from(atob(source), (c) => c.charCodeAt(0))], { type: "image/png" }),
        ),
        c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      c.getContext("2d").drawImage(b, 0, 0);
      b.close();
      return {
        width: c.width,
        height: c.height,
        pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
      };
    }, source);
    assert.deepEqual(
      pixel(painted, 80, 48),
      pixel(raw, 80, 48),
      "black mask reveals exact source pixel",
    );
    assert.deepEqual(
      pixel(painted, 48, 48),
      pixel(filtered, 48, 48),
      "unselected pixel remains filtered",
    );
    await d.getByRole("button", { name: "Mask undo", exact: true }).click();
    fx.same(await preview(p), filtered, 0);
    await d.getByRole("button", { name: "Mask redo", exact: true }).click();
    fx.same(await preview(p), painted, 0);
    await d.getByRole("button", { name: "Cancel filter mask", exact: true }).click();
    fx.same(await preview(p), filtered, 0);
    // Repaint with a soft, partial-opacity edge and test the actual mask pixels.
    await d.getByRole("button", { name: "Paint filter mask", exact: true }).click();
    await number(d, "Mask brush size", 32);
    await number(d, "Mask brush hardness", 0);
    await number(d, "Mask brush opacity", 50);
    await paint(p, context, width, 80, 48);
    const coverage = await d
      .getByLabel("Paintable filter mask canvas", { exact: true })
      .evaluate((c) => [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data]);
    const center = coverage[(48 * 128 + 80) * 4],
      edge = coverage[(48 * 128 + 92) * 4];
    assert.ok(center > 120 && center < 160);
    assert.ok(edge > center && edge < 255, "hardness yields soft coverage");
    await d.getByRole("button", { name: "Finish filter mask", exact: true }).click();
    const committed = await preview(p);
    await p.screenshot({ path: `/workspace/screenshots/r10-mask-${width}.png` });
    await d.getByRole("button", { name: "Apply layer properties", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    fx.same(await fx.preview(p), committed, 0);
    fx.same(await fx.raster(p), committed, 0);
    const saved = (await fx.native(p)).value;
    assert.deepEqual(saved.assets, original.assets, "source blobs untouched");
    assert.ok(
      saved.document.layers[0].smartFilters[0].mask.selection.regions[0].pixels.runs.length,
    );
    await fx.tab(p, "History");
    assert.equal(
      await p.locator(".pro-history-list li").count(),
      count + 1,
      "all draft brush movements commit once",
    );
    await p.getByRole("button", { name: "Undo", exact: true }).click();
    fx.same(await fx.preview(p), filtered, 0);
    await p.getByRole("button", { name: "Redo", exact: true }).click();
    fx.same(await fx.preview(p), committed, 0);
    await fx.load(p, saved.document, source, saved.assets);
    fx.same(await fx.preview(p), committed, 0);
    fx.same(await fx.raster(p), committed, 0);
    // Verify captured document-space selection uses R5 translation in source-local mask space.
    const transformed = structuredClone(doc);
    transformed.layers[0].transform.x = 12;
    await fx.load(p, transformed, source);
    await fx.tab(p, "Properties");
    await p.getByRole("button", { name: "Layer styles and Smart Filters", exact: true }).click();
    await ready(p);
    await d.getByRole("tab", { name: "Smart Filters", exact: true }).click();
    await d.getByRole("button", { name: "Use selection as filter mask", exact: true }).click();
    await ready(p);
    await d.getByRole("button", { name: "Apply layer properties", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    const translated = (await fx.native(p)).value;
    assert.deepEqual(
      translated.document.layers[0].smartFilters[0].mask.selection,
      toLocalSelection(transformed.selection, translated.document.layers[0], {
        width: 128,
        height: 96,
      }),
    );
    await p.getByText("Draft saved", { exact: true }).first().waitFor();
    await p.reload();
    await p.getByText("Chapter workspace", { exact: true }).waitFor();
    await fx.open(p);
    fx.same(await fx.preview(p), await fx.raster(p), 0);
    assert.deepEqual((await fx.native(p)).value.document.layers, translated.document.layers);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    results.push({
      width,
      touch: width < 800,
      selectionClip: true,
      softOpacity: true,
      maskUndoRedo: true,
      cancelExact: true,
      oneDocumentHistoryEntry: true,
      sourceUntouched: true,
      nativeReopen: true,
      exportTolerance: 0,
      transformedCapture: true,
      autosaveReload: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { results, errors, pixelTolerance: 0, physicalAndroid: false };
  await writeFile("/workspace/r10-evidence/mask-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
