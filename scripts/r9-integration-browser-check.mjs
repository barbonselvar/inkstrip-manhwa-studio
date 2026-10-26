/** R9 × R8 × PR #21 integration: one schema3 document with an R8 layer style, Smart
 * Filters and an advanced Gradient Fill, edited with R9's Raster tools (parametric shapes,
 * Join, Shift+T text on a path, % rulers, guide locking/clearing, align to canvas). Checks
 * exported pixels, undo/redo, that refusals leave the document unchanged (Join on a
 * Smart-Filtered path; RTL text on a path) and native save/reopen. 1440 and 390 px. */
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
const grain = () => [
  {
    id: "grain",
    enabled: true,
    operation: { kind: "grain", distribution: "uniform", amount: 0, seed: 7, monochrome: true },
  },
];

function document() {
  const d = fromPanel({ id: "p", name: "R9 × R8", width: 128, height: 96 });
  d.version = 3;
  d.layers[0].visible = false;
  const shape = (name, kind, x, y, w, h, fill) => {
    const l = layer("shape", w, h);
    Object.assign(l, { name, shape: kind, fill, strokeWidth: 0 });
    l.transform.x = x;
    l.transform.y = y;
    return l;
  };
  const path = (name, anchors) => {
    const l = layer("shape", 128, 96);
    Object.assign(l, {
      name,
      shape: "path",
      anchors,
      closed: false,
      fill: "transparent",
      stroke: "#101010",
      strokeWidth: 2,
    });
    return l;
  };
  const fill = layer("gradient", 128, 96);
  fill.name = "Fill";
  fill.gradient = advancedGradient();
  fill.gradient.stops = [
    { position: 0, color: "#00ff00", opacity: 1 },
    { position: 1, color: "#00ff00", opacity: 1 },
  ];
  const star = shape("Star", "star", 10, 10, 40, 40, "#ff0000");
  const overlay = advancedEffect("colorOverlay");
  overlay.color = "#0000ff";
  overlay.opacity = 1;
  star.effects = [overlay];
  const rounded = shape("Rounded", "rectangle", 70, 10, 40, 30, "#ffff00");
  rounded.smartFilters = grain();
  const filteredPath = path("PathA", [
    { x: 60, y: 70 },
    { x: 80, y: 70 },
  ]);
  filteredPath.smartFilters = grain();
  d.layers.push(
    fill,
    star,
    rounded,
    shape("Hex", "polygon", 10, 60, 30, 30, "#ff00ff"),
    filteredPath,
    path("PathB", [
      { x: 80, y: 70 },
      { x: 100, y: 70 },
    ]),
    path("Curve", [
      { x: 60, y: 92, outgoing: { x: 80, y: 78 } },
      { x: 124, y: 92, incoming: { x: 104, y: 78 } },
    ]),
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
  console.log(`R9 × R8 integration at ${view.width}px`);
  const panel = async (visible = true) => {
    const b = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
    if (((await b.getAttribute("aria-expanded")) === "true") !== visible) await b.click();
  };
  const tab = async (name) => {
    await panel();
    await fx.tab(p, name);
  };
  const envelope = async () => {
    await panel();
    return (await fx.native(p)).value;
  };
  const native = async () => (await envelope()).document;
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
  const alert = (text) => p.getByRole("alert").filter({ hasText: text }).first();
  /** Screen position of a 128 × 96 document point through zoom, pan and view rotation. */
  const point = (x, y) =>
    p.locator(".pro-artboard").evaluate(
      (el, { x, y }) => {
        const v = el.parentElement.getBoundingClientRect(),
          s = getComputedStyle(el),
          w = parseFloat(s.width),
          h = parseFloat(s.height);
        const q = new DOMPoint((x / 128 - 0.5) * w, (y / 96 - 0.5) * h).matrixTransform(
          new DOMMatrix(s.transform),
        );
        return { x: v.left + v.width / 2 + w / 2 + q.x, y: v.top + v.height / 2 + h / 2 + q.y };
      },
      { x, y },
    );
  const dragScreen = async (a, b, touch = false) => {
    if (touch) {
      const cdp = await context.newCDPSession(p);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] });
      for (let i = 1; i <= 8; i++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }],
        });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else {
      await p.mouse.move(a.x, a.y);
      await p.mouse.down();
      await p.mouse.move(b.x, b.y, { steps: 8 });
      await p.mouse.up();
    }
  };

  const source = await fx.start(p);
  await fx.open(p, "Raster");
  await fx.load(p, document(), source);

  // 1. R8 rendering of R9 shapes: color overlay on a star, Smart Filter on a rectangle.
  let image = await png();
  assert.deepEqual(rgb(image, 30, 30), [0, 0, 255]); // star centre: R8 colour overlay
  assert.deepEqual(rgb(image, 11, 11), [0, 255, 0]); // outside the star: Gradient Fill
  assert.deepEqual(rgb(image, 71, 11), [255, 255, 0]); // sharp corner, identity grain
  checks.r8Render = true;

  // 2. Parametric shape options keep R8 styles and Smart Filters; undo/redo.
  await select("Rounded");
  await tab("Properties");
  await p.getByLabel("Corner radius", { exact: true }).fill("10");
  image = await png();
  assert.deepEqual(rgb(image, 71, 11), [0, 255, 0]); // corner cut: Fill shows through
  assert.deepEqual(rgb(image, 90, 25), [255, 255, 0]);
  let doc = await native();
  assert.equal(named(doc, "Rounded").shapeOptions.radius, 10);
  assert.equal(named(doc, "Rounded").smartFilters[0].operation.kind, "grain");
  await undo();
  assert.deepEqual(rgb(await png(), 71, 11), [255, 255, 0]);
  await redo();
  assert.deepEqual(rgb(await png(), 71, 11), [0, 255, 0]);
  await select("Star");
  await tab("Properties");
  await p.getByLabel("Star points", { exact: true }).fill("7");
  await p.getByLabel("Star inner radius %", { exact: true }).fill("40");
  await select("Hex");
  await tab("Properties");
  await p.getByLabel("Polygon sides", { exact: true }).fill("8");
  doc = await native();
  assert.equal(named(doc, "Star").shapeOptions.sides, 7);
  near(named(doc, "Star").shapeOptions.inner, 0.4, 1e-9, "star inner radius");
  assert.equal(named(doc, "Star").effects[0].kind, "colorOverlay");
  assert.equal(named(doc, "Hex").shapeOptions.sides, 8);
  assert.deepEqual(rgb(await png(), 30, 30), [0, 0, 255]);
  checks.shapes = true;

  // 3. Join refuses a Smart-Filtered path and leaves both paths exactly as they were.
  const beforeJoin = await native();
  await select("PathA", "PathB");
  await tab("Properties");
  await p.getByRole("button", { name: /^Join with PathB/ }).click();
  await alert(/Remove Smart Filters before joining paths/).waitFor();
  doc = await native();
  assert.deepEqual(doc.layers, beforeJoin.layers);
  checks.joinGuard = true;

  // 4. Shift+T creates text on the selected path; RTL text is refused without changes.
  const beforeText = await png();
  await select("Curve");
  await panel(false);
  await p.locator(".pro-viewport").focus();
  await p.keyboard.press("Shift+T");
  await tab("Typography");
  await p.getByLabel("Path text content", { exact: true }).fill("INK");
  doc = await native();
  const pathText = doc.layers.find((l) => l.kind === "text" && l.textPath);
  assert.ok(pathText, "Shift+T created text on the path");
  assert.equal(pathText.text, "INK");
  const afterText = await png();
  let changed = 0;
  for (let i = 0; i < afterText.pixels.length; i += 4)
    if (afterText.pixels[i] !== beforeText.pixels[i]) changed++;
  assert.ok(changed > 10, `text renders (${changed} pixels changed)`);
  await tab("Typography");
  await p.getByLabel("Path text content", { exact: true }).fill("مرحبا");
  await alert(/cannot shape contextual\/RTL scripts/).waitFor();
  doc = await native();
  assert.equal(doc.layers.find((l) => l.id === pathText.id).text, "INK");
  fx.same(await png(), afterText, 0);
  checks.textOnPath = true;

  // 5. Align an R8-styled star to the canvas; styles move with it; undoable.
  await select("Star");
  await tab("Precision");
  await p.getByLabel("Align relative to", { exact: true }).selectOption("canvas");
  await p.getByRole("button", { name: "Align right", exact: true }).click();
  doc = await native();
  // Geometry bounds: a 7-point star's rightmost point is 20 + 20·cos(4π/7 − π/2) from x.
  near(
    named(doc, "Star").transform.x,
    108 - 20 * Math.cos((4 * Math.PI) / 7 - Math.PI / 2),
    0.01,
    "star right edge",
  );
  assert.deepEqual(rgb(await png(), 115, 30), [0, 0, 255]); // inside the star, right of Rounded
  await undo();
  assert.equal(named(await native(), "Star").transform.x, 10);
  checks.align = true;

  // 6. Rulers in % and guides: create (touch on mobile), lock, clear unlocked, unlock all.
  await panel(false);
  await p.getByLabel("Show rulers", { exact: true }).check();
  await p.getByLabel("Ruler units", { exact: true }).selectOption("%");
  await p.locator('.pro-rulers[data-unit="%"]').waitFor();
  const labels = await p.locator('[data-ruler="top"] text').allTextContents();
  assert.ok(labels.includes("0") && labels.includes("100"), `% labels: ${labels}`);
  await p.getByLabel("Ruler units", { exact: true }).selectOption("px");
  const exportBefore = await png();
  await panel(false);
  const topRuler = await p.locator('[data-ruler="top"]').boundingBox(),
    leftRuler = await p.locator('[data-ruler="left"]').boundingBox(),
    target = await point(64, 48);
  await dragScreen({ x: target.x, y: topRuler.y + 10 }, target, !!view.mobile);
  await dragScreen({ x: leftRuler.x + 10, y: target.y }, target, !!view.mobile);
  doc = await native();
  assert.equal(doc.layout.guides.length, 2);
  const horizontal = doc.layout.guides.find((g) => g.axis === "y");
  near(horizontal.position, 48, 1, "horizontal guide");
  fx.same(await png(), exportBefore, 0); // guides are never exported
  await tab("Precision");
  const first = doc.layout.guides[0].axis === "y" ? 1 : 2;
  await p.getByLabel(`Lock guide ${first}`, { exact: true }).check();
  await panel(false);
  await p.getByRole("button", { name: "Move tool", exact: true }).click();
  await dragScreen(await point(20, horizontal.position), await point(20, 70));
  doc = await native();
  near(doc.layout.guides.find((g) => g.id === horizontal.id).position, 48, 1, "locked guide");
  // A locked guide is not grabbed: the drag moved the Gradient Fill under the pointer instead.
  near(named(doc, "Fill").transform.y, 22, 1, "artwork moved instead of the locked guide");
  await undo();
  assert.equal(named(await native(), "Fill").transform.y, 0);
  await tab("Precision");
  await p.getByRole("button", { name: "Clear unlocked guides", exact: true }).click();
  doc = await native();
  assert.deepEqual(
    doc.layout.guides.map((g) => [g.id, g.locked]),
    [[horizontal.id, true]],
  );
  await tab("Precision");
  await p.getByRole("button", { name: "Unlock all guides", exact: true }).click();
  await p.getByRole("button", { name: "Clear unlocked guides", exact: true }).click();
  assert.equal((await native()).layout.guides.length, 0);
  await undo();
  assert.equal((await native()).layout.guides.length, 1);
  checks.rulersGuides = true;

  // 7. Save, close, reopen: R8 and R9 structures survive; export unchanged.
  const before = await envelope(),
    exportSaved = await png();
  assert.equal(before.version, 9);
  assert.equal(before.document.version, 3);
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p
    .getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true })
    .waitFor({ state: "detached" });
  await fx.open(p, "Raster");
  const after = await native();
  assert.deepEqual(after.layers, before.document.layers);
  assert.deepEqual(after.layout.guides, before.document.layout.guides);
  fx.same(await png(), exportSaved, 0);
  fx.same(await fx.preview(p), exportSaved, 0);
  checks.persistence = true;

  await panel(false);
  await p.screenshot({ path: `/workspace/screenshots/r9-integration-${view.width}.png` });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  results.push({ width: view.width, ...checks });
  await context.close();
}
await browser.close();
assert.deepEqual(errors, []);
console.log(JSON.stringify({ results, errors }));
