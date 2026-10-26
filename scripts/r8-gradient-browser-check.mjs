import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { advancedGradient } from "../src/lib/studio/pro/gradient.ts";
import { gradientFillHandles } from "../src/lib/studio/pro/gradient-tool.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const errors = [],
  results = [],
  fx = proBrowserFixtures(base, errors),
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
async function panel(p, open) {
  const b = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
  if (((await b.getAttribute("aria-expanded")) === "true") !== open) await b.click();
}
async function native(p) {
  await panel(p, true);
  return fx.native(p);
}
async function raster(p) {
  await panel(p, true);
  return fx.raster(p);
}
async function drag(p, fx, from, to, touch, cancel = false) {
  await panel(p, false);
  const b = await fx.artboardBounds(p),
    a = { x: b.x + (from.x / 128) * b.width, y: b.y + (from.y / 96) * b.height },
    z = { x: b.x + (to.x / 128) * b.width, y: b.y + (to.y / 96) * b.height };
  if (touch) {
    const c = await p.context().newCDPSession(p);
    await c.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: a.x, y: a.y, id: 1 }],
    });
    for (let i = 1; i <= 8; i++)
      await c.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: a.x + ((z.x - a.x) * i) / 8, y: a.y + ((z.y - a.y) * i) / 8, id: 1 }],
      });
    await c.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await c.detach();
  } else {
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(z.x, z.y, { steps: 8 });
    if (cancel) {
      await p.keyboard.press("Escape");
      await p.mouse.up();
    } else await p.mouse.up();
  }
}
try {
  await mkdir("/workspace/screenshots", { recursive: true });
  await mkdir("/workspace/r8-evidence", { recursive: true });
  for (const width of process.argv.includes("--quick") ? [1440] : [1440, 768, 390, 360, 320]) {
    const touch = width < 800,
      context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: touch,
        isMobile: width < 500,
      }),
      p = await context.newPage(),
      source = await fx.start(p);
    await fx.open(p);
    const doc = fromPanel({ id: "gradient", name: "Gradient interaction", width: 128, height: 96 });
    doc.version = 3;
    doc.layers[0].visible = false;
    const fill = layer("gradient", 128, 96, "fill");
    fill.gradient = advancedGradient();
    fill.mask = {
      enabled: true,
      strokes: [],
      selection: {
        regions: [
          {
            kind: "rectangle",
            operation: "add",
            points: [
              { x: 0, y: 0 },
              { x: 96, y: 96 },
            ],
          },
        ],
        inverted: false,
        feather: 0,
      },
    };
    doc.layers.push(fill);
    await fx.load(p, doc, source);
    await fx.tab(p, "Layers");
    await p.locator('[data-layer-id="fill"] .pro-layer-select').click();
    const initial = (await native(p)).value,
      initialPixels = await fx.preview(p);
    await p.getByRole("button", { name: "Gradient Fill tool", exact: true }).click();
    await drag(p, fx, { x: 25, y: 25 }, { x: 95, y: 65 }, touch, true);
    fx.same(await fx.preview(p), initialPixels, 0);
    assert.deepEqual((await native(p)).value, initial, "canceled gradient drag is lossless");
    await p.getByRole("button", { name: "Gradient Fill tool", exact: true }).click();
    await drag(p, fx, { x: 25, y: 25 }, { x: 95, y: 65 }, touch);
    const edited = (await native(p)).value,
      next = edited.document.layers.find((l) => l.id === "fill");
    assert.notDeepEqual(next.gradient, fill.gradient);
    assert.deepEqual(next.mask, fill.mask);
    assert.deepEqual(edited.assets, initial.assets);
    const h = gradientFillHandles(next.gradient, 128, 96);
    // Browser events quantize screen coordinates. Pixel persistence comparisons below remain zero tolerance.
    assert.ok(Math.abs(h.from.x - 25) < 1 && Math.abs(h.from.y - 25) < 1);
    assert.ok(Math.abs(h.to.x - 95) < 1 && Math.abs(h.to.y - 65) < 1);
    const pixels = await fx.preview(p);
    assert.notDeepEqual(pixels.pixels, initialPixels.pixels);
    assert.equal(pixels.pixels[(48 * 128 + 110) * 4 + 3], 0, "R7 selection mask retained");
    fx.same(await raster(p), pixels, 0);
    await fx.tab(p, "History");
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    fx.same(await fx.preview(p), initialPixels, 0);
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    fx.same(await fx.preview(p), pixels, 0);
    // Painting on a filtered layer must update pixels beyond the stroke's raw dirty bounds.
    const painted = fromPanel({ id: "paint", name: "Filtered painting", width: 128, height: 96 });
    painted.version = 3;
    painted.layers[0].visible = false;
    const paint = layer("paint", 128, 96, "paint");
    paint.smartFilters = [
      { id: "blur", enabled: true, operation: { kind: "gaussian", radius: 4 } },
    ];
    painted.layers.push(paint);
    await fx.load(p, painted, source);
    await fx.tab(p, "Layers");
    await p.locator('[data-layer-id="paint"] .pro-layer-select').click();
    await p.getByRole("button", { name: "Brush tool", exact: true }).click();
    await fx.tab(p, "Properties");
    await p.getByLabel("Brush size", { exact: true }).fill("8");
    await p.getByLabel("Brush size", { exact: true }).blur();
    await p.getByLabel("Brush hardness", { exact: true }).fill("100");
    await p.getByLabel("Brush hardness", { exact: true }).blur();
    await drag(p, fx, { x: 32, y: 48 }, { x: 64, y: 48 }, touch);
    const paintPreview = await fx.preview(p),
      paintPng = await raster(p);
    fx.same(paintPreview, paintPng, 0);
    await writeFile(
      "/workspace/r8-evidence/paint-diagnostic.json",
      JSON.stringify(
        {
          width,
          native: (await native(p)).value,
          alphaRow: Array.from({ length: 128 }, (_, x) => paintPng.pixels[(48 * 128 + x) * 4 + 3]),
        },
        null,
        2,
      ),
    );
    assert.ok(
      paintPng.pixels[(48 * 128 + 22) * 4 + 3] > 0,
      "blur extends beyond the raw brush radius",
    );
    const saved = (await native(p)).value;
    assert.equal(
      saved.document.layers.find((l) => l.id === "paint").smartFilters[0].operation.radius,
      4,
    );
    await fx.load(p, saved.document, source, saved.assets);
    fx.same(await fx.preview(p), paintPng, 0);
    await p.screenshot({ path: `/workspace/screenshots/r8-gradient-${width}.png` });
    results.push({
      width,
      touch,
      gradientDrag: true,
      cancelExact: true,
      maskRetained: true,
      undoRedoExact: true,
      exportExact: true,
      filteredPaintingDirtyRegion: true,
      nativeReopenExact: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { results, errors, pixelTolerance: 0, physicalAndroid: false };
  await writeFile("/workspace/r8-evidence/gradient-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
