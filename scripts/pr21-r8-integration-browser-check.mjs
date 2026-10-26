/** PR #21 × R8 integration: one schema3 document with R8 layer styles, Smart Filters and
 * an advanced Gradient Fill, edited with PR #21's Raster tools (Pathfinder, path ↔
 * selection, layer and vector masks, Appearance). Checks exported pixels, undo/redo,
 * native save/reopen and that only R8's gradient tool exists. 1440 and 390 px. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { advancedGradient } from "../src/lib/studio/pro/gradient.ts";
import { advancedEffect } from "../src/lib/studio/pro/effects.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [],
  results = [];
const rgb = (image, x, y) =>
  image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3);
const named = (doc, name) => doc.layers.find((l) => l.name === name);
const near = (a, b, tolerance, message) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} is not near ${b}`);

function document() {
  const d = fromPanel({ id: "p", name: "PR21 × R8", width: 128, height: 96 });
  d.version = 3;
  d.layers[0].visible = false;
  const shape = (name, kind, x, y, w, h, fill) => {
    const l = layer("shape", w, h);
    Object.assign(l, { name, shape: kind, fill, strokeWidth: 0 });
    l.transform.x = x;
    l.transform.y = y;
    return l;
  };
  const fill = layer("gradient", 128, 96);
  fill.name = "Fill";
  fill.gradient = advancedGradient();
  fill.gradient.stops = [
    { position: 0, color: "#00ff00", opacity: 1 },
    { position: 1, color: "#00ff00", opacity: 1 },
  ];
  const styled = shape("Styled", "rectangle", 10, 10, 40, 30, "#ff0000");
  const overlay = advancedEffect("colorOverlay");
  overlay.color = "#0000ff";
  overlay.opacity = 1;
  styled.effects = [overlay];
  const filtered = shape("Filtered", "rectangle", 70, 10, 40, 30, "#ffff00");
  filtered.smartFilters = [
    {
      id: "grain",
      enabled: true,
      operation: { kind: "grain", distribution: "uniform", amount: 0, seed: 7, monochrome: true },
    },
  ];
  d.layers.push(
    fill,
    styled,
    filtered,
    shape("A", "rectangle", 10, 60, 30, 20, "#ff00ff"),
    shape("B", "rectangle", 30, 65, 30, 20, "#ff00ff"),
    shape("Cutter", "ellipse", 15, 5, 30, 30, "#000000"),
    shape("Lens", "ellipse", 75, 15, 20, 20, "#000000"),
  );
  return d;
}

for (const view of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844, mobile: true },
]) {
  const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      hasTouch: !!view.mobile,
      isMobile: !!view.mobile,
    }),
    p = await context.newPage(),
    fx = proBrowserFixtures(base, errors),
    checks = {};
  console.log(`PR21 × R8 integration at ${view.width}px`);
  const panel = async (visible = true) => {
    const b = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
    if (((await b.getAttribute("aria-expanded")) === "true") !== visible) await b.click();
  };
  const tab = async (name) => {
    await panel();
    await fx.tab(p, name);
  };
  const native = async () => {
    await panel();
    return (await fx.native(p)).value;
  };
  const png = async () => {
    await panel();
    return fx.raster(p);
  };
  const select = async (...names) => {
    await tab("Layers");
    await p
      .getByRole("group", { name: "Layer stack", exact: true })
      .locator(".pro-layer-select")
      .filter({
        hasText: new RegExp(`^${names[0]}(shape|gradient|raster|paint|text|group|adjustment)`),
      })
      .first()
      .click();
    for (const name of names.slice(1))
      await p.getByLabel(`Select layer ${name}`, { exact: true }).check();
  };
  const undo = () => p.getByRole("button", { name: "Pro undo", exact: true }).click();
  const redo = () => p.getByRole("button", { name: "Pro redo", exact: true }).click();

  const source = await fx.start(p);
  await fx.open(p, "Raster");
  await fx.load(p, document(), source);

  // 1. One gradient tool only: R8's Gradient Fill. G stays the Paint Bucket.
  const tools = p.getByRole("navigation", { name: "Pro tools", exact: true });
  assert.equal(
    await tools.getByRole("button", { name: "Gradient Fill tool", exact: true }).count(),
    1,
  );
  assert.equal(await tools.getByRole("button", { name: "Gradient tool", exact: true }).count(), 0);
  assert.equal(await tools.getByRole("button", { name: /gradient/i }).count(), 1);
  await panel(false);
  await p.keyboard.press("g");
  assert.equal(
    await tools
      .getByRole("button", { name: "Paint Bucket tool", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  let image = await png();
  assert.deepEqual(rgb(image, 12, 38), [0, 0, 255]); // R8 color overlay on the styled shape
  assert.deepEqual(rgb(image, 72, 37), [255, 255, 0]); // filtered shape (identity grain)
  assert.deepEqual(rgb(image, 120, 90), [0, 255, 0]); // R8 advanced Gradient Fill
  checks.tools = true;

  // 2. Pathfinder in Raster next to R8 layers.
  await select("A", "B");
  await tab("Paths");
  await p.getByRole("button", { name: "Pathfinder Unite", exact: true }).click();
  await p.getByText(/^Pathfinder unite: 1 editable object/).waitFor();
  let value = await native();
  assert.equal(named(value.document, "A"), undefined);
  image = await png();
  assert.deepEqual(rgb(image, 12, 62), [255, 0, 255]);
  assert.deepEqual(rgb(image, 57, 83), [255, 0, 255]);
  await undo();
  assert.ok(named((await native()).document, "A"));
  await redo();
  checks.pathfinder = true;

  // 3. Path → selection and selection → path.
  await select("Lens");
  await tab("Paths");
  await p.getByRole("button", { name: "New selection from path", exact: true }).click();
  value = await native();
  const region = value.document.selection.regions[0];
  let covered = 0;
  for (let i = 0; i < region.pixels.runs.length; i += 3)
    if (region.pixels.runs[i + 2] >= 128) covered += region.pixels.runs[i + 1];
  near(covered, Math.PI * 100, 8, "lens coverage");
  await tab("Paths");
  await p.getByRole("button", { name: "Make path from selection", exact: true }).click();
  assert.equal(named((await native()).document, "Path from selection").shape, "path");
  await p.keyboard.press("Control+d");
  checks.paths = true;

  // 4. Vector mask on an R8-styled shape clips the styled result.
  await select("Cutter");
  await tab("Paths");
  await p.getByLabel("Mask target layer", { exact: true }).selectOption({ label: "Styled" });
  await p.getByRole("button", { name: "Add vector mask from path", exact: true }).click();
  value = await native();
  assert.equal(named(value.document, "Styled").vectorClips.length, 1);
  assert.equal(named(value.document, "Styled").effects[0].kind, "colorOverlay");
  image = await png();
  assert.deepEqual(rgb(image, 30, 20), [0, 0, 255]); // inside circle: overlay kept
  assert.deepEqual(rgb(image, 12, 38), [0, 255, 0]); // rect corner outside circle: clipped
  await undo();
  assert.deepEqual(rgb(await png(), 12, 38), [0, 0, 255]);
  await redo();
  checks.vectorMask = true;

  // 5. Layer mask from a path on a Smart-Filtered layer keeps its filter stack.
  await select("Lens");
  await tab("Paths");
  await p.getByLabel("Mask target layer", { exact: true }).selectOption({ label: "Filtered" });
  await p.getByRole("button", { name: "Add layer mask from path", exact: true }).click();
  value = await native();
  const filtered = named(value.document, "Filtered");
  assert.equal(filtered.mask.enabled, true);
  assert.equal(filtered.smartFilters[0].operation.kind, "grain");
  image = await png();
  assert.deepEqual(rgb(image, 85, 25), [255, 255, 0]); // inside the lens
  assert.deepEqual(rgb(image, 72, 37), [0, 255, 0]); // masked away: Fill shows
  checks.layerMask = true;

  // 6. Appearance: blocked with an explanation on filtered layers, editable elsewhere.
  await select("Filtered");
  await tab("Appearance");
  await p.getByText("This layer has Smart Filters.", { exact: false }).waitFor();
  assert.equal(await p.getByRole("button", { name: "Add stroke", exact: true }).count(), 0);
  await select("Path from selection");
  await tab("Appearance");
  await p.getByRole("button", { name: "Add fill", exact: true }).click();
  value = await native();
  assert.ok(named(value.document, "Path from selection").appearance.length >= 3);
  checks.appearance = true;

  // 7. Save, close, reopen: R8 and PR #21 structures survive; export unchanged.
  const before = await native(),
    exportBefore = await png();
  assert.equal(before.version, 9);
  assert.equal(before.document.version, 3);
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p
    .getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true })
    .waitFor({ state: "detached" });
  await fx.open(p, "Raster");
  const after = await native();
  assert.deepEqual(after.document.layers, before.document.layers);
  fx.same(await png(), exportBefore, 0);
  fx.same(await fx.preview(p), exportBefore, 0);
  checks.persistence = true;

  await panel(false);
  await p.screenshot({ path: `/workspace/screenshots/pr21-r8-${view.width}.png` });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  results.push({ width: view.width, ...checks });
  await context.close();
}
await browser.close();
assert.deepEqual(errors, []);
console.log(JSON.stringify({ results, errors }));
