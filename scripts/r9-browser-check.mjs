/** R9 precision vector editing inside Raster Studio: path operations, text on a path,
 * rulers and guides, align to canvas and parametric shapes. Real UI input; checks read the
 * native file and exported PNG pixels, plus save/close/reopen. The full flow runs at 1440
 * and 390 px (touch ruler drag); 768/360/320 px check layout and the new controls. */
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
const named = (doc, name) => doc.layers.find((l) => l.name === name);
const near = (a, b, tolerance, message) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} is not near ${b}`);
const rgb = (image, x, y) =>
  image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3);

function document() {
  const d = fromPanel({ id: "p", name: "R9", width: 128, height: 96 });
  d.version = 2;
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
  const box = layer("shape", 40, 30);
  Object.assign(box, { name: "Box", shape: "rectangle", fill: "#ff0000", strokeWidth: 0 });
  box.transform.x = 80;
  box.transform.y = 60;
  d.layers.push(
    path("Wave", [
      { x: 10, y: 40 },
      { x: 40, y: 10 },
      { x: 70, y: 40 },
    ]),
    path("Line", [
      { x: 10, y: 88 },
      { x: 30, y: 88 },
      { x: 50, y: 88 },
      { x: 70, y: 88 },
    ]),
    path("Curve", [
      { x: 80, y: 50, outgoing: { x: 90, y: 20 } },
      { x: 124, y: 40, incoming: { x: 110, y: 20 } },
    ]),
    box,
  );
  return d;
}

for (const view of [
  { width: 1440, height: 1000, full: true },
  { width: 768, height: 1024 },
  { width: 390, height: 844, mobile: true, full: true },
  { width: 360, height: 780, mobile: true },
  { width: 320, height: 640, mobile: true },
]) {
  const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      hasTouch: !!view.mobile,
      isMobile: !!view.mobile,
    }),
    p = await context.newPage(),
    fx = proBrowserFixtures(base, errors),
    checks = {};
  console.log(`R9 at ${view.width}px`);
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
    await p
      .getByRole("group", { name: "Layer stack", exact: true })
      .locator(".pro-layer-select")
      .filter({ hasText: new RegExp(`^${names[0]}(shape|gradient|raster|paint|text|group)`) })
      .first()
      .click();
    for (const name of names.slice(1))
      await p.getByLabel(`Select layer ${name}`, { exact: true }).check();
  };
  const undo = () => p.getByRole("button", { name: "Pro undo", exact: true }).click();
  const redo = () => p.getByRole("button", { name: "Pro redo", exact: true }).click();
  const tool = (name) => p.getByRole("button", { name: `${name} tool`, exact: true });
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

  // 1. New controls are reachable in Raster at every width.
  const tabs = p.getByRole("navigation", { name: "Pro panels", exact: true });
  await panel();
  for (const name of ["Precision", "Typography"])
    assert.equal(await tabs.getByRole("button", { name, exact: true }).count(), 1, name);
  for (const name of ["Star", "Text on Path"]) assert.equal(await tool(name).count(), 1, name);
  await p.getByLabel("Show rulers", { exact: true }).check();
  await p.locator('[data-ruler="top"]').waitFor();
  await p.locator('[data-ruler="left"]').waitFor();
  checks.controls = true;
  if (!view.full) {
    await panel(false);
    await p.screenshot({ path: `/workspace/screenshots/r9-${view.width}.png` });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "no horizontal page overflow",
    );
    results.push({ width: view.width, ...checks });
    await context.close();
    continue;
  }

  // 2. Path operations: split, undo/redo, join, smooth, simplify.
  await select("Wave");
  await tab("Properties");
  await p.getByLabel("Selected anchor", { exact: true }).fill("2");
  await p.getByRole("button", { name: "Split path at anchor", exact: true }).click();
  let doc = await native();
  assert.equal(named(doc, "Wave").anchors.length, 2);
  assert.equal(named(doc, "Wave (split)").anchors.length, 2);
  await undo();
  doc = await native();
  assert.equal(named(doc, "Wave").anchors.length, 3);
  assert.equal(named(doc, "Wave (split)"), undefined);
  await redo();
  await select("Wave", "Wave (split)");
  await tab("Properties");
  await p.getByRole("button", { name: /^Join with Wave \(split\)/ }).click();
  doc = await native();
  assert.equal(named(doc, "Wave (split)"), undefined);
  assert.deepEqual(
    named(doc, "Wave").anchors.map((a) => [a.x, a.y]),
    [
      [10, 40],
      [40, 10],
      [70, 40],
    ],
  );
  await tab("Properties");
  await p.getByRole("button", { name: "Smooth all anchors", exact: true }).click();
  doc = await native();
  const middle = named(doc, "Wave").anchors[1];
  assert.equal(middle.mode, "smooth");
  assert.ok(middle.incoming && middle.outgoing);
  await select("Line");
  await tab("Properties");
  await p.getByLabel("Simplify tolerance (px)", { exact: true }).fill("0.5");
  await p.getByRole("button", { name: "Simplify path", exact: true }).click();
  doc = await native();
  assert.equal(named(doc, "Line").anchors.length, 2);
  checks.pathOps = true;

  // 3. Text on a path from the Raster toolbar, edited in Typography.
  const beforeText = await png();
  await select("Curve");
  await panel(false);
  await tool("Text on Path").click();
  await tab("Typography");
  await p.getByLabel("Path text content", { exact: true }).fill("INK");
  doc = await native();
  const pathText = doc.layers.find((l) => l.kind === "text" && l.textPath);
  assert.ok(pathText, "text on path layer");
  assert.equal(pathText.text, "INK");
  const afterText = await png();
  let changed = 0;
  for (let i = 0; i < afterText.pixels.length; i += 4)
    if (
      afterText.pixels[i + 3] !== beforeText.pixels[i + 3] ||
      afterText.pixels[i] !== beforeText.pixels[i]
    )
      changed++;
  assert.ok(changed > 10, `text renders (${changed} pixels changed)`);
  checks.textOnPath = true;

  // 4. Shapes: Star tool + points, rounded rectangle pixels.
  await panel(false);
  await tool("Star").click();
  await dragScreen(await point(10, 50), await point(50, 90));
  doc = await native();
  const star = doc.layers.find((l) => l.shape === "star");
  assert.ok(star, "star layer");
  await tab("Properties");
  await p.getByLabel("Star points", { exact: true }).fill("6");
  doc = await native();
  assert.equal(doc.layers.find((l) => l.shape === "star").shapeOptions.sides, 6);
  await select("Box");
  await tab("Properties");
  await p.getByLabel("Corner radius", { exact: true }).fill("10");
  const rounded = await png();
  assert.notDeepEqual(rgb(rounded, 80, 60), [255, 0, 0]); // cut corner
  assert.deepEqual(rgb(rounded, 100, 75), [255, 0, 0]); // body
  assert.equal(named(await native(), "Box").shapeOptions.radius, 10);
  checks.shapes = true;

  // 5. Align to canvas (Precision tab), undoable.
  await select("Box");
  await tab("Precision");
  await p.getByLabel("Align relative to", { exact: true }).selectOption("canvas");
  await p.getByRole("button", { name: "Align left", exact: true }).click();
  doc = await native();
  assert.equal(named(doc, "Box").transform.x, 0);
  await undo();
  assert.equal(named(await native(), "Box").transform.x, 80);
  checks.align = true;

  // 6. Rulers and guides: create from rulers (touch on mobile), move with Move, delete
  //    by dropping on the ruler, never exported, Ctrl/⌘+R toggles.
  const exportBefore = await png();
  await panel(false);
  const topRuler = await p.locator('[data-ruler="top"]').boundingBox(),
    leftRuler = await p.locator('[data-ruler="left"]').boundingBox();
  const target = await point(64, 48);
  await dragScreen({ x: target.x, y: topRuler.y + 10 }, target, !!view.mobile);
  await dragScreen({ x: leftRuler.x + 10, y: target.y }, target);
  doc = await native();
  const horizontal = doc.layout.guides.find((g) => g.axis === "y"),
    vertical = doc.layout.guides.find((g) => g.axis === "x");
  near(horizontal.position, 48, 1, "horizontal guide");
  near(vertical.position, 64, 1, "vertical guide");
  fx.same(await png(), exportBefore, 0);
  await panel(false);
  await tool("Move").click();
  await dragScreen(await point(20, horizontal.position), await point(20, 60));
  doc = await native();
  near(doc.layout.guides.find((g) => g.id === horizontal.id).position, 60, 1, "moved guide");
  await panel(false);
  const moved = await point(20, 60);
  await dragScreen(moved, { x: moved.x, y: topRuler.y + 8 });
  doc = await native();
  assert.equal(
    doc.layout.guides.some((g) => g.id === horizontal.id),
    false,
    "guide deleted",
  );
  assert.equal(doc.layout.guides.length, 1);
  await panel(false);
  await p.locator(".pro-viewport").focus();
  await p.keyboard.press("Control+r");
  await p.locator('[data-ruler="top"]').waitFor({ state: "detached" });
  checks.rulersGuides = true;

  // 7. Save, close, reopen: geometry, text, shape options and guides persist.
  const before = await native(),
    exportSaved = await png();
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p
    .getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true })
    .waitFor({ state: "detached" });
  await fx.open(p, "Raster");
  const after = await native();
  assert.deepEqual(after.layers, before.layers);
  assert.deepEqual(after.layout.guides, before.layout.guides);
  fx.same(await png(), exportSaved, 0);
  checks.persistence = true;

  await panel(false);
  await p.screenshot({ path: `/workspace/screenshots/r9-${view.width}.png` });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  results.push({ width: view.width, ...checks });
  await context.close();
}
await browser.close();
assert.deepEqual(errors, []);
console.log(JSON.stringify({ results, errors }));
