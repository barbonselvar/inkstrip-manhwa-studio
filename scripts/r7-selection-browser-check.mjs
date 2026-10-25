/** R7: real UI/worker selection pixels, masks, clipboard and Quick Mask at desktop and touch widths. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel } from "../src/lib/studio/pro/model.ts";
import { maskFromSelection } from "../src/lib/studio/pro/masks.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  results = [],
  fx = proBrowserFixtures(base, errors);
await mkdir("/workspace/screenshots", { recursive: true });
await mkdir("/workspace/r7-evidence", { recursive: true });
const W = 128,
  H = 96;
const pixel = (image, x, y) => image.pixels.slice((y * W + x) * 4, (y * W + x) * 4 + 4);
const rect = (x0, y0, x1, y1, operation = "add") => ({
  kind: "rectangle",
  operation,
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ],
});
const selectionOf = (...regions) => ({ regions, inverted: false, feather: 0 });
function fixture(selection) {
  const d = fromPanel({ id: "p", name: "R7 fixture", width: W, height: H });
  d.background = "transparent";
  if (selection) d.selection = selection;
  return d;
}
async function panels(p, open = true) {
  const b = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
  if (((await b.getAttribute("aria-expanded")) === "true") !== open) await b.click();
}
async function openTab(p, name) {
  await panels(p);
  await fx.tab(p, name);
}
async function loadDoc(p, ...args) {
  await panels(p);
  return fx.load(p, ...args);
}
async function exportNative(p) {
  await panels(p);
  return fx.native(p);
}
async function exportRaster(p) {
  await panels(p);
  return fx.raster(p);
}
async function section(p, title) {
  const s = p.locator("summary").filter({ hasText: new RegExp(`^${title}$`) });
  if (!(await s.evaluate((el) => el.parentElement.open))) await s.click();
}
async function command(p, key) {
  await panels(p);
  await p.locator(".pro-panel-tabs").evaluate((el) => {
    document.activeElement?.blur();
    el.focus();
  });
  await p.keyboard.press(key);
}
async function tool(p, name) {
  await panels(p, false);
  await p.getByRole("button", { name: `${name} tool`, exact: true }).click();
}
/** Document point → viewport point on the settled artboard. */
async function at(p, x, y) {
  const r = await fx.artboardBounds(p);
  return { x: r.x + (x / W) * r.width, y: r.y + (y / H) * r.height };
}
async function clickDoc(p, x, y) {
  const s = await at(p, x, y);
  await p.mouse.click(s.x, s.y);
}
async function dragDoc(p, a, b, steps = 8) {
  const s = await at(p, a.x, a.y),
    e = await at(p, b.x, b.y);
  await p.mouse.move(s.x, s.y);
  await p.mouse.down();
  await p.mouse.move(e.x, e.y, { steps });
  await p.mouse.up();
}
/** Selection coverage (0–255) as drawn by the real overlay at document resolution. */
async function coverage(p, x, y, selected) {
  await p
    .waitForFunction(
      ({ x, y, selected }) => {
        const c = document.querySelector('canvas[aria-label="Selected coverage preview"]');
        if (!c || c.width !== 128) return false;
        const a = c.getContext("2d").getImageData(x, y, 1, 1).data[3];
        return selected ? a > 80 : a === 0;
      },
      { x, y, selected },
      { timeout: 15000 },
    )
    .catch(async (e) => {
      const a = await p.evaluate(
        ({ x, y }) => {
          const c = document.querySelector('canvas[aria-label="Selected coverage preview"]');
          return {
            alpha: c ? c.getContext("2d").getImageData(x, y, 1, 1).data[3] : null,
            alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent),
          };
        },
        { x, y },
      );
      console.error("Coverage mismatch", { x, y, selected }, a);
      throw e;
    });
}
async function historyCount(p) {
  await openTab(p, "History");
  return p.locator(".pro-history-list li").count();
}
async function waitIdle(p) {
  await p.waitForFunction(
    () =>
      document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        ?.getAttribute("aria-busy") === "false",
  );
}
try {
  const widths = (process.env.R7_WIDTHS ?? "1440,768,390,360,320").split(",").map(Number);
  for (const width of widths) {
    const context = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
      }),
      p = await context.newPage(),
      checks = {};
    console.log(`R7 viewport ${width}`);
    const source = await fx.start(p);
    await fx.open(p);
    const box = selectionOf(rect(40, 20, 56, 32));
    await loadDoc(p, fixture(box), source);
    const before = await fx.preview(p);

    // --- Freehand lasso beyond the point budget still commits (desktop stress run).
    if (width === 1440) {
      await tool(p, "Freehand lasso");
      await p.getByLabel("Selection operation", { exact: true }).selectOption("replace");
      const c = await at(p, 64, 48),
        r = Math.min((await fx.artboardBounds(p)).height / 3, 160);
      await p.mouse.move(c.x + r, c.y);
      await p.mouse.down();
      let moves = 0;
      for (let turn = 0; turn < 24 && moves < 6200; turn++)
        for (let i = 0; i < 300; i++, moves++) {
          const a = (i / 300) * Math.PI * 2,
            rr = r * (1 - turn * 0.02);
          await p.mouse.move(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
        }
      await p.mouse.up();
      await p.getByText("This lasso reached its point limit", { exact: false }).waitFor();
      const lasso = (await exportNative(p)).value.document.selection;
      assert.equal(lasso.regions.length, 1);
      assert.equal(lasso.regions[0].kind, "lasso");
      assert.equal(lasso.regions[0].points.length, 5000);
      await coverage(p, 2, 2, false); // outside the drawn outline
      checks.lassoPastLimit = { moves, points: 5000 };
      await panels(p);
      await p.getByRole("button", { name: "Pro undo", exact: true }).click();
      await coverage(p, 44, 24, true);
    }

    // --- Polygonal lasso: Backspace removes the last point, never the layer.
    await tool(p, "Polygonal lasso");
    await p.getByLabel("Selection operation", { exact: true }).selectOption("replace");
    for (const [x, y] of [
      [70, 40],
      [110, 40],
      [110, 80],
      [100, 90],
    ])
      await clickDoc(p, x, y);
    await p.getByRole("button", { name: "Finish polygon selection", exact: true }).waitFor();
    await p.keyboard.press("Backspace");
    await p.keyboard.press("Enter");
    let native = (await exportNative(p)).value.document;
    assert.equal(native.layers.length, 1, "Backspace must not delete the layer");
    assert.deepEqual(
      native.selection.regions.map((r) => [r.kind, r.points.length]),
      [["lasso", 3]],
    );
    await coverage(p, 100, 50, true);
    await coverage(p, 44, 24, false);
    checks.polygonBackspace = true;

    // --- Replace + fixed-ratio marquee.
    await tool(p, "Rectangle selection");
    await p.getByLabel("Selection operation", { exact: true }).selectOption("replace");
    await p.getByLabel("Marquee aspect ratio", { exact: true }).selectOption("1");
    await dragDoc(p, { x: 10, y: 10 }, { x: 50, y: 20 });
    native = (await exportNative(p)).value.document;
    assert.equal(native.selection.regions.length, 1);
    const [a, b] = native.selection.regions[0].points;
    assert.ok(Math.abs(Math.abs(b.x - a.x) - Math.abs(b.y - a.y)) < 0.01, "1:1 marquee");
    assert.ok(Math.abs(b.x - a.x) > 30);
    await p.getByLabel("Marquee aspect ratio", { exact: true }).selectOption("0");
    checks.replaceAndRatio = true;

    // --- Region limit: the 101st boolean operation compacts instead of failing.
    const many = selectionOf(
      ...Array.from({ length: 100 }, (_, i) =>
        rect((i % 10) * 12, Math.floor(i / 10) * 9, (i % 10) * 12 + 4, Math.floor(i / 10) * 9 + 4),
      ),
    );
    await loadDoc(p, fixture(many), source);
    await tool(p, "Rectangle selection");
    await p.getByLabel("Selection operation", { exact: true }).selectOption("add");
    await dragDoc(p, { x: 6, y: 6 }, { x: 10, y: 8 });
    native = (await exportNative(p)).value.document;
    assert.equal(native.selection.regions.length, 1);
    assert.equal(native.selection.regions[0].kind, "pixels");
    await coverage(p, 1, 1, true);
    await coverage(p, 7, 6, true);
    await coverage(p, 6, 1, false);
    checks.regionLimitCompaction = true;

    // --- Color Range: live preview, Cancel restores exactly, Apply commits once.
    await loadDoc(p, fixture(box), source);
    const startCount = await historyCount(p);
    await tool(p, "Color Range");
    await p.getByLabel("Selection operation", { exact: true }).selectOption("add");
    await p.getByLabel("Color tolerance", { exact: true }).fill("20");
    await clickDoc(p, 100, 70);
    await coverage(p, 100, 70, true); // live preview
    await panels(p, false);
    await p.getByRole("button", { name: "Cancel color range", exact: true }).click();
    await coverage(p, 100, 70, false);
    await coverage(p, 44, 24, true);
    native = (await exportNative(p)).value.document;
    assert.deepEqual(native.selection, box);
    assert.equal(await historyCount(p), startCount);
    await tool(p, "Color Range");
    await clickDoc(p, 100, 70);
    await p.getByRole("button", { name: "Apply color range", exact: true }).click();
    await coverage(p, 100, 70, true);
    await coverage(p, 44, 24, true);
    await coverage(p, 10, 10, false);
    assert.equal(await historyCount(p), startCount + 1);
    checks.colorRange = true;

    // --- Modify: expand, contract, border, smooth (each one undo step).
    await loadDoc(p, fixture(box), source);
    await panels(p);
    await openTab(p, "Properties");
    await section(p, "Modify selection");
    const amount = p.getByLabel("Modify amount (px)", { exact: true });
    await amount.fill("4");
    await amount.blur();
    const modify = async (name) => {
      await panels(p);
      await p.getByRole("button", { name, exact: true }).click();
      await waitIdle(p);
    };
    await modify("Expand");
    await coverage(p, 37, 25, true);
    await coverage(p, 34, 25, false);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await coverage(p, 38, 25, false);
    await modify("Contract");
    await coverage(p, 42, 25, false);
    await coverage(p, 45, 26, true);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await modify("Border");
    await coverage(p, 40, 26, true);
    await coverage(p, 48, 26, false);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await modify("Smooth");
    await coverage(p, 48, 26, true);
    await coverage(p, 30, 26, false);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    native = (await exportNative(p)).value.document;
    assert.deepEqual(native.selection, box);
    checks.modify = true;

    // --- Masks ↔ selection: loading a mask never changes it; adding keeps the old mask.
    const masked = fixture();
    masked.layers[0].mask = maskFromSelection(
      selectionOf(rect(40, 20, 64, 48)),
      masked.layers[0],
      masked,
    );
    await loadDoc(p, masked, source);
    await panels(p);
    await openTab(p, "Layers");
    await p.getByRole("button", { name: "Imported artwork", exact: false }).first().click();
    await openTab(p, "Properties");
    await section(p, "Selection and masks");
    await p.getByRole("button", { name: "Selection from mask", exact: true }).click();
    await coverage(p, 50, 30, true);
    await coverage(p, 30, 30, false);
    native = (await exportNative(p)).value.document;
    assert.deepEqual(native.layers[0].mask, JSON.parse(JSON.stringify(masked.layers[0].mask)));
    await tool(p, "Rectangle selection");
    await p.getByLabel("Selection operation", { exact: true }).selectOption("replace");
    await dragDoc(p, { x: 80, y: 60 }, { x: 100, y: 80 });
    await panels(p);
    await openTab(p, "Properties");
    await section(p, "Selection and masks");
    await p.getByRole("button", { name: "Add selection to mask", exact: true }).click();
    await waitIdle(p);
    const maskedOut = await fx.preview(p);
    assert.ok(pixel(maskedOut, 50, 30)[3] > 200, "old mask area stays revealed");
    assert.ok(pixel(maskedOut, 90, 70)[3] > 200, "selection added to mask");
    assert.equal(pixel(maskedOut, 70, 30)[3], 0, "outside both stays hidden");
    native = (await exportNative(p)).value.document;
    assert.equal(native.layers[0].mask.enabled, masked.layers[0].mask.enabled);
    checks.masks = true;

    // --- Clipboard: copy/paste, cut, layer via copy/cut, all undoable.
    await loadDoc(p, fixture(box), source);
    await panels(p);
    await openTab(p, "Layers");
    await p.getByRole("button", { name: "Imported artwork", exact: false }).first().click();
    await openTab(p, "Properties");
    await section(p, "Copy, cut and paste");
    await p.getByRole("button", { name: "Copy pixels", exact: true }).click();
    await p.getByText("Copied 16 × 12 px", { exact: false }).waitFor();
    await p.getByRole("button", { name: "Paste as layer", exact: true }).click();
    native = (await exportNative(p)).value;
    assert.equal(native.document.layers.length, 2);
    assert.equal(Object.keys(native.assets).length, 2);
    const pasted = native.document.layers[1];
    assert.deepEqual([pasted.width, pasted.height], [16, 12]);
    assert.deepEqual([pasted.transform.x, pasted.transform.y], [40, 20]);
    fx.same(await fx.preview(p), before);
    await panels(p);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await openTab(p, "Layers");
    await p.getByRole("button", { name: "Imported artwork", exact: false }).first().click();
    await openTab(p, "Properties");
    await section(p, "Copy, cut and paste");
    await p.getByRole("button", { name: "Cut pixels", exact: true }).click();
    await waitIdle(p);
    const cut = await fx.preview(p);
    assert.equal(pixel(cut, 44, 24)[3], 0);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (!(x >= 40 && x < 56 && y >= 20 && y < 32))
          assert.deepEqual(pixel(cut, x, y), pixel(before, x, y));
    await p.getByRole("button", { name: "Paste as layer", exact: true }).click();
    fx.same(await fx.preview(p), before);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    fx.same(await fx.preview(p), before);
    await command(p, "Control+j");
    await p.getByText("copied to a new layer", { exact: false }).waitFor();
    native = (await exportNative(p)).value.document;
    assert.equal(native.layers.length, 2);
    fx.same(await fx.preview(p), before);
    checks.clipboard = true;

    // --- Quick Mask: exact round trip, real brush painting/erasing, export blocked.
    await loadDoc(p, fixture(box), source);
    await panels(p);
    await openTab(p, "Properties");
    await p.getByRole("button", { name: "Quick Mask", exact: true }).click();
    await p.getByRole("button", { name: "Exit Quick Mask", exact: true }).waitFor();
    await openTab(p, "Export");
    await p.getByRole("button", { name: "Export editable .inkstrip", exact: true }).click();
    await p.getByText("Exit Quick Mask before exporting", { exact: false }).waitFor();
    await tool(p, "Brush");
    await openTab(p, "Properties");
    const size = p.getByLabel("Brush size", { exact: true });
    await size.fill("4");
    await size.blur();
    await panels(p, false);
    await dragDoc(p, { x: 86, y: 64 }, { x: 96, y: 64 });
    await tool(p, "Eraser");
    await clickDoc(p, 44, 24);
    await waitIdle(p);
    await command(p, "q");
    await p.getByText("Quick Mask converted to a selection", { exact: false }).waitFor();
    await coverage(p, 90, 64, true);
    await coverage(p, 50, 30, true);
    await coverage(p, 44, 24, false);
    await coverage(p, 20, 70, false);
    native = (await exportNative(p)).value.document;
    assert.equal(native.layers.length, 1, "Quick Mask layer removed on exit");
    assert.equal(native.selection.regions[0].kind, "pixels");
    fx.same(await fx.preview(p), before);
    // Undo restores Quick Mask, a second undo the original selection.
    await panels(p);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await openTab(p, "Properties");
    await p.getByRole("button", { name: "Exit Quick Mask", exact: true }).waitFor();
    checks.quickMask = true;

    // --- Selection persists through Save, close and reopen.
    await command(p, "q");
    await p.getByRole("button", { name: "Quick Mask", exact: true }).waitFor();
    await command(p, "Control+s");
    await p
      .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
      .waitFor();
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true })
      .waitFor({ state: "detached" });
    await fx.open(p);
    await coverage(p, 90, 64, true);
    await coverage(p, 44, 24, false);
    fx.same(await exportRaster(p), before);
    checks.persistence = true;

    await panels(p, false);
    await p.screenshot({ path: `/workspace/screenshots/r7-${width}.png` });
    await panels(p);
    await openTab(p, "Properties");
    await p
      .locator("summary")
      .filter({ hasText: /^Selection tools$/ })
      .scrollIntoViewIfNeeded();
    await p.screenshot({ path: `/workspace/screenshots/r7-${width}-panel.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks.noOverflow = true;
    results.push({ width, ...checks });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "/workspace/r7-evidence/r7-browser.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }));
} finally {
  await browser.close();
}
