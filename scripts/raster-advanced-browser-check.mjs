/** Raster Studio advanced tools: Pathfinder, path ↔ selection, masks from paths, vector
 * masks and Appearance in Raster mode. Gradients stay with R8's Gradient Fill; this suite
 * checks no duplicate gradient tool exists. Every check reads real data: exported PNG
 * pixels, selection coverage from the native file, and documents after save/close/reopen.
 * Desktop (1440) and mobile (390, touch-enabled context) run the same flow. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [],
  results = [];
const near = (a, b, tolerance, message = "") =>
  assert.ok(Math.abs(a - b) <= tolerance, `${message} ${a} is not near ${b}`);
const at = (image, x, y) =>
  image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
/** Selected pixel count, compositing regions as the renderer does (add = over,
 * subtract = destination-out, intersect = destination-in). */
const coverage = (selection, width = 128, height = 96) => {
  const out = new Float64Array(width * height);
  for (const r of selection.regions) {
    const v = new Float64Array(width * height);
    for (let i = 0; i < r.pixels.runs.length; i += 3)
      v.fill(r.pixels.runs[i + 2] / 255, r.pixels.runs[i], r.pixels.runs[i] + r.pixels.runs[i + 1]);
    for (let i = 0; i < out.length; i++)
      out[i] =
        r.operation === "subtract"
          ? out[i] * (1 - v[i])
          : r.operation === "intersect"
            ? out[i] * v[i]
            : out[i] + v[i] * (1 - out[i]);
  }
  // Count pixels selected at the 50% level, so anti-aliased edges composite fairly.
  return out.reduce((n, a) => n + (a >= 0.5 ? 1 : 0), 0);
};
const named = (doc, name) => doc.layers.find((l) => l.name === name);

function document() {
  const d = fromPanel({ id: "p", name: "Advanced raster", width: 128, height: 96 });
  const shape = (name, kind, x, y, w, h, fill) => {
    const l = layer("shape", w, h);
    Object.assign(l, { name, shape: kind, fill, strokeWidth: 0 });
    l.transform.x = x;
    l.transform.y = y;
    return l;
  };
  const magenta = layer("gradient", 128, 96);
  magenta.name = "Magenta";
  magenta.gradient.stops = [
    { position: 0, color: "#ff00ff", opacity: 1 },
    { position: 1, color: "#ff00ff", opacity: 1 },
  ];
  d.layers.push(
    magenta,
    shape("Back", "rectangle", 12, 12, 60, 50, "#ff0000"),
    shape("Front", "rectangle", 42, 30, 60, 50, "#00ff00"),
    shape("Lens", "ellipse", 4, 50, 40, 40, "#0000ff"),
    shape("Card", "rectangle", 70, 10, 50, 40, "#ffff00"),
    shape("Cutter", "ellipse", 80, 15, 30, 30, "#00ffff"),
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
  console.log(`Raster advanced tools at ${view.width}px`);
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
    return (await fx.native(p)).value.document;
  };
  const png = async () => {
    await panel();
    return fx.raster(p);
  };
  const select = async (...names) => {
    await tab("Layers");
    const stack = p.getByRole("group", { name: "Layer stack", exact: true });
    await stack
      .locator(".pro-layer-select")
      // Row text is the name followed by the layer kind ("Cardshape · …"): match exactly.
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
  const statusText = (text) => p.getByText(text, { exact: false }).first().waitFor();
  const source = await fx.start(p);
  await fx.open(p, "Raster");
  await fx.load(p, document(), source);

  // 1. Raster tabs: Paths and Appearance; no Vector-only Pathfinder tab, no Vector switch.
  const tabs = p.getByRole("navigation", { name: "Pro panels", exact: true });
  await panel();
  assert.equal(await tabs.getByRole("button", { name: "Paths", exact: true }).count(), 1);
  assert.equal(await tabs.getByRole("button", { name: "Appearance", exact: true }).count(), 1);
  assert.equal(await tabs.getByRole("button", { name: "Pathfinder", exact: true }).count(), 0);
  const modes = p.getByRole("group", { name: "Switch editing mode", exact: true });
  assert.equal(await modes.getByRole("button", { name: "Vector", exact: true }).count(), 0);
  checks.tabs = true;

  // 2. Pathfinder Unite in Raster: geometry, pixels, undo and redo.
  await select("Back", "Front");
  await tab("Paths");
  await p.getByRole("button", { name: "Pathfinder Unite", exact: true }).click();
  await statusText("Pathfinder unite: 1 editable object");
  let doc = await native();
  assert.equal(named(doc, "Back") ?? named(doc, "Front"), undefined);
  const united = doc.layers.filter((l) => l.kind === "shape" && l.shape === "path");
  assert.equal(united.length, 1);
  let image = await png();
  assert.deepEqual(at(image, 20, 20).slice(0, 3), [255, 0, 0]);
  assert.deepEqual(at(image, 90, 70).slice(0, 3), [255, 0, 0]); // Front area, back's red fill
  assert.deepEqual(at(image, 6, 6).slice(0, 3), [255, 0, 255]); // Magenta below
  await undo();
  doc = await native();
  assert.ok(named(doc, "Back") && named(doc, "Front"));
  await redo();
  doc = await native();
  assert.equal(named(doc, "Back"), undefined);
  checks.pathfinder = true;

  // 3. Path → selection: replace, add, intersect, feather — real coverage.
  const circle = Math.PI * 20 * 20;
  await select("Lens");
  await tab("Paths");
  await p.getByLabel("Path feather (px)", { exact: true }).fill("3");
  await p.getByRole("button", { name: "New selection from path", exact: true }).click();
  doc = await native();
  near(coverage(doc.selection), circle, circle * 0.01, "circle coverage");
  assert.equal(doc.selection.feather, 3);
  await select("Card");
  await tab("Paths");
  await p.getByRole("button", { name: "Add path to selection", exact: true }).click();
  doc = await native();
  near(coverage(doc.selection), circle + 2000, 30, "circle + card coverage");
  await select("Lens");
  await tab("Paths");
  await p.getByRole("button", { name: "Intersect path with selection", exact: true }).click();
  doc = await native();
  // Intersect multiplies coverage (destination-in), which thins anti-aliased edges.
  near(coverage(doc.selection), circle, circle * 0.04, "intersection coverage");
  checks.pathToSelection = true;

  // 4. Selection → path: an editable path along the circle edge.
  await tab("Paths");
  await p.getByLabel("Path tolerance (px)", { exact: true }).fill("0.5");
  await p.getByRole("button", { name: "Make path from selection", exact: true }).click();
  await statusText("Path from selection");
  doc = await native();
  const traced = named(doc, "Path from selection");
  assert.equal(traced.shape, "path");
  assert.ok(traced.anchors.length >= 12);
  near(traced.transform.x, 4, 1, "traced x");
  near(traced.transform.y, 50, 1, "traced y");
  near(traced.width, 40, 2, "traced width");
  assert.equal(
    await p.getByRole("button", { name: "Direct select tool" }).getAttribute("aria-pressed"),
    "true",
  );
  checks.selectionToPath = true;

  // 5. Layer mask from a path on a gradient layer; source hidden; undo restores.
  await select("Lens");
  await tab("Paths");
  await p.getByLabel("Mask target layer", { exact: true }).selectOption({ label: "Magenta" });
  await p.getByLabel("Path feather (px)", { exact: true }).fill("0");
  await p.getByRole("button", { name: "Add layer mask from path", exact: true }).click();
  doc = await native();
  assert.equal(named(doc, "Magenta").mask.enabled, true);
  assert.equal(named(doc, "Lens").visible, false);
  image = await png();
  assert.deepEqual(at(image, 24, 70).slice(0, 3), [255, 0, 255]); // inside the path
  assert.notDeepEqual(at(image, 24, 93).slice(0, 3), [255, 0, 255]); // outside: masked away
  assert.notDeepEqual(at(image, 6, 6).slice(0, 3), [255, 0, 255]);
  await undo();
  doc = await native();
  assert.equal(named(doc, "Magenta").mask, undefined);
  assert.equal(named(doc, "Lens").visible, true);
  await redo();
  checks.layerMask = true;

  // 6. Vector mask on a shape, edit it as a path, re-apply.
  await select("Cutter");
  await tab("Paths");
  await p.getByLabel("Mask target layer", { exact: true }).selectOption({ label: "Card" });
  await p.getByRole("button", { name: "Add vector mask from path", exact: true }).click();
  doc = await native();
  assert.equal(named(doc, "Card").vectorClips.length, 1);
  assert.ok(named(doc, "Card").vectorClips[0].contours[0].anchors.some((a) => a.outgoing));
  image = await png();
  assert.deepEqual(at(image, 95, 30).slice(0, 3), [255, 255, 0]); // inside card ∩ circle
  assert.notDeepEqual(at(image, 73, 47).slice(0, 3), [255, 255, 0]); // card corner, clipped
  await select("Card");
  await tab("Paths");
  await p.getByRole("button", { name: "Edit vector mask 1 as path", exact: true }).click();
  doc = await native();
  assert.equal(named(doc, "Card").vectorClips, undefined);
  assert.ok(named(doc, "Card vector mask"));
  await select("Card vector mask");
  await tab("Paths");
  await p.getByLabel("Mask target layer", { exact: true }).selectOption({ label: "Card" });
  await p.getByRole("button", { name: "Add vector mask from path", exact: true }).click();
  doc = await native();
  assert.equal(named(doc, "Card").vectorClips.length, 1);
  assert.equal(await modes.getByRole("button", { name: "Vector", exact: true }).count(), 0);
  checks.vectorMask = true;

  // 7. Appearance in Raster: add a stroke to a shape (multi fill/stroke stack).
  await select("Card");
  await tab("Appearance");
  await p.getByRole("button", { name: "Add stroke", exact: true }).click();
  doc = await native();
  assert.ok(named(doc, "Card").appearance.filter((a) => a.kind === "stroke").length >= 2);
  assert.equal(await modes.getByRole("button", { name: "Vector", exact: true }).count(), 0);
  checks.appearance = true;

  // 8. No duplicate gradient tool: R8's Gradient Fill will own Raster gradients. G stays
  //    the Paint Bucket and existing gradient layers keep editing as on main.
  await panel(false);
  await p.keyboard.press("g");
  const bucket = p.getByRole("button", { name: "Paint Bucket tool", exact: true });
  assert.equal(await bucket.getAttribute("aria-pressed"), "true");
  assert.equal(await p.getByRole("button", { name: "Gradient tool", exact: true }).count(), 0);
  await p.keyboard.press("Shift+G");
  assert.equal(await bucket.getAttribute("aria-pressed"), "true");
  await select("Magenta");
  await tab("Properties");
  await p.getByLabel("Gradient angle", { exact: true }).fill("30");
  doc = await native();
  assert.equal(named(doc, "Magenta").gradient.angle, 30);
  for (const l of doc.layers.filter((l) => l.gradient))
    assert.deepEqual(Object.keys(l.gradient).sort(), ["angle", "center", "kind", "scale", "stops"]);
  checks.gradient = true;

  // 9. Save, close, reopen: every new structure survives; export is unchanged.
  const before = await native(),
    exportBefore = await png();
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p
    .getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true })
    .waitFor({ state: "detached" });
  await fx.open(p, "Raster");
  const after = await native();
  assert.deepEqual(
    after.layers.map((l) => [l.name, l.kind, l.visible, !!l.mask, l.vectorClips?.length ?? 0]),
    before.layers.map((l) => [l.name, l.kind, l.visible, !!l.mask, l.vectorClips?.length ?? 0]),
  );
  assert.deepEqual(
    after.layers.filter((l) => l.gradient).map((l) => l.gradient),
    before.layers.filter((l) => l.gradient).map((l) => l.gradient),
  );
  assert.deepEqual(named(after, "Card").vectorClips, named(before, "Card").vectorClips);
  assert.deepEqual(named(after, "Card").appearance, named(before, "Card").appearance);
  fx.same(await png(), exportBefore, 2);
  checks.persistence = true;

  await panel(false);
  await p.screenshot({ path: `/workspace/screenshots/raster-advanced-${view.width}.png` });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  results.push({ width: view.width, ...checks });
  await context.close();
}
await browser.close();
assert.deepEqual(errors, []);
console.log(JSON.stringify({ results, errors }));
