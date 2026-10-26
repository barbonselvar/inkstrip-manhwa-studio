import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { advancedGradient } from "../src/lib/studio/pro/gradient.ts";
import { advancedEffect } from "../src/lib/studio/pro/effects.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const errors = [],
  fx = proBrowserFixtures(base, errors),
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    source = await fx.start(p);
  await fx.open(p);
  const d = fromPanel({ id: "r8", name: "R8 worker baseline", width: 128, height: 96 });
  d.version = 3;
  d.layers[0].visible = false;
  const fill = layer("gradient", 128, 96, "fill");
  fill.gradient = advancedGradient();
  fill.gradient.stops = [
    { position: 0, color: "#0000ff", opacity: 1 },
    { position: 1, color: "#0000ff", opacity: 1 },
  ];
  fill.smartFilters = [
    { id: "blur", enabled: true, operation: { kind: "gaussian", radius: 1 } },
    {
      id: "seed",
      enabled: true,
      operation: { kind: "grain", distribution: "uniform", amount: 0, seed: 42, monochrome: true },
    },
  ];
  fill.mask = {
    enabled: true,
    selection: {
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
      inverted: false,
      feather: 0,
    },
    strokes: [],
  };
  const overlay = advancedEffect("colorOverlay");
  overlay.color = "#ff0000";
  overlay.opacity = 0.5;
  fill.effects = [overlay];
  const adjustment = layer("adjustment", 128, 96, "invert");
  adjustment.adjustmentLayer = { version: 1, operation: { kind: "invert" } };
  d.layers.push(fill, adjustment);
  await fx.load(p, d, source);
  const before = await fx.preview(p);
  assert.equal(before.width, 128);
  assert.equal(before.height, 96);
  const pixel = (x, y) => before.pixels.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 4);
  assert.deepEqual(pixel(32, 48), [127, 255, 127, 255]);
  assert.equal(pixel(96, 48)[3], 0);
  const png = await fx.raster(p);
  fx.same(before, png, 0);
  const native = await fx.native(p);
  assert.equal(native.value.version, 9);
  assert.equal(native.value.document.version, 3);
  assert.deepEqual(
    native.value.document.layers.find((l) => l.id === "fill").smartFilters,
    fill.smartFilters,
  );
  await fx.load(p, native.value.document, source, native.value.assets);
  fx.same(await fx.preview(p), before, 0);
  fx.same(await fx.raster(p), png, 0);
  assert.deepEqual(errors, []);
  await mkdir("/workspace/r8-evidence", { recursive: true });
  await mkdir("/workspace/screenshots", { recursive: true });
  await p.screenshot({ path: "/workspace/screenshots/r8-foundation.png" });
  const result = {
    passed: true,
    schema: 3,
    envelope: 9,
    r6Adjustment: true,
    r7Mask: true,
    filterOrder: true,
    styles: true,
    nativeReopen: true,
    pngExact: true,
    pixelTolerance: 0,
    errors,
  };
  await writeFile(
    "/workspace/r8-evidence/foundation-browser.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
