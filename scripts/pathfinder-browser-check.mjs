/** Real Pathfinder worker/UI, independent pixel oracle, native/history/SVG and touch. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [];
const { tab, start, open, load, native, raster, same, preview, records, artboardBounds } =
  proBrowserFixtures(base, errors);
const operations = ["Unite", "Subtract", "Intersect", "Exclude", "Divide", "Trim", "Merge"];
function fixture() {
  const d = fromPanel({ id: "pathfinder", name: "Pathfinder", width: 128, height: 96 }),
    a = layer("shape", 60, 50),
    b = layer("shape", 60, 50);
  d.layers[0].visible = false;
  Object.assign(a, { name: "Back", fill: "#ff0000", strokeWidth: 0 });
  a.transform.x = 12;
  a.transform.y = 12;
  Object.assign(b, { name: "Front", fill: "#00ff00", strokeWidth: 0 });
  b.transform.x = 42;
  b.transform.y = 30;
  d.layers.push(a, b);
  return d;
}
const shapes = (f) => f.value.document.layers.filter((l) => l.kind === "shape");
const at = (image, x, y) =>
  image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
async function choose(p) {
  await tab(p, "Layers");
  await p.getByLabel("Select layer Back", { exact: true }).check();
  await tab(p, "Pathfinder");
}
async function apply(p, operation) {
  const button = p.getByRole("button", { name: `Pathfinder ${operation}`, exact: true });
  assert.ok(await button.isEnabled());
  await button.click();
  await p
    .getByText(new RegExp(`^Pathfinder ${operation.toLowerCase()}: \\d+ editable object`))
    .waitFor();
}
function pixels(image, operation) {
  const regions = ["Divide", "Trim", "Merge"].includes(operation);
  for (let y = 3; y < 94; y += 5)
    for (let x = 3; x < 126; x += 5) {
      if (
        [12, 72, 42, 102].some((edge) => Math.abs(x - edge) < 1) ||
        [12, 62, 30, 80].some((edge) => Math.abs(y - edge) < 1)
      )
        continue;
      const a = x > 12 && x < 72 && y > 12 && y < 62,
        b = x > 42 && x < 102 && y > 30 && y < 80,
        yes =
          operation === "Subtract"
            ? a && !b
            : operation === "Intersect"
              ? a && b
              : operation === "Exclude"
                ? a !== b
                : a || b;
      assert.deepEqual(
        at(image, x, y),
        yes ? (regions && b ? [0, 255, 0, 255] : [255, 0, 0, 255]) : [0, 0, 0, 0],
        `${operation} at ${x},${y}`,
      );
    }
}
async function svg(p) {
  await tab(p, "Export");
  const event = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export SVG · vectors only", exact: true }).click();
  return readFile(await (await event).path(), "utf8");
}
async function importSvg(p, text) {
  await tab(p, "Assets");
  await p
    .getByLabel("Import Pro asset", { exact: true })
    .setInputFiles({ name: "result.svg", mimeType: "image/svg+xml", buffer: Buffer.from(text) });
  await p.getByText("SVG vectors imported. Chapter unchanged.", { exact: true }).waitFor();
}
async function touchDrag(p, from, to) {
  const r = await artboardBounds(p),
    point = (q) => ({ x: r.x + (q.x / 128) * r.width, y: r.y + (q.y / 96) * r.height }),
    a = point(from),
    b = point(to),
    cdp = await p.context().newCDPSession(p);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...a, id: 1 }],
  });
  for (let i = 1; i <= 6; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6, id: 1 }],
    });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await context.newPage(),
    source = await start(p),
    original = (await records(p))[0];
  await open(p, "Vector");
  await tab(p, "Pathfinder");
  for (const op of operations)
    assert.ok(await p.getByRole("button", { name: `Pathfinder ${op}`, exact: true }).isDisabled());
  for (const operation of operations) {
    await load(p, fixture(), source);
    await choose(p);
    const before = await native(p);
    await tab(p, "Pathfinder");
    await apply(p, operation);
    const result = await native(p),
      image = await raster(p);
    pixels(image, operation);
    same(await preview(p), image);
    assert.ok(shapes(result).every((l) => l.shape === "path" && l.closed && !l.pathData));
    assert.equal(result.value.assets[result.value.document.source.assetId].data, source);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    assert.deepEqual(shapes(await native(p)), shapes(before));
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    assert.deepEqual(shapes(await native(p)), shapes(result));
    same(await raster(p), image);
    await load(p, result.value.document, source, result.value.assets);
    same(await raster(p), image);
    const text = await svg(p);
    assert.ok(text.includes("<path"));
    assert.ok(!text.includes("<image"));
    const empty = fixture();
    empty.layers = empty.layers.slice(0, 1);
    await load(p, empty, source);
    await importSvg(p, text);
    same(await raster(p), image, 2);
    assert.deepEqual((await records(p))[0], original);
    console.log(
      `${operation}: independent pixel coverage, real worker, native/history, SVG reimport and source bytes passed.`,
    );
  }
  // Curves and holes go through the same worker and PNG export; interior oracle is independent.
  const curved = fixture();
  curved.layers[1].shape = "ellipse";
  curved.layers[2].shape = "ellipse";
  await load(p, curved, source);
  await choose(p);
  await apply(p, "Intersect");
  const coarseAnchors = shapes(await native(p))[0].anchors.length;
  await load(p, curved, source);
  await choose(p);
  await p.getByLabel("Pathfinder curve tolerance (px)", { exact: true }).fill("0.02");
  await apply(p, "Intersect");
  assert.ok(
    shapes(await native(p))[0].anchors.length > coarseAnchors,
    "finer UI tolerance must produce finer geometry",
  );
  let image = await raster(p);
  // A pixel is sampled at its center. The 0.85px exclusion is the pixel's
  // half-diagonal plus the 0.125px curve conversion/subdivision bound.
  for (let y = 2; y < 94; y += 3)
    for (let x = 2; x < 126; x += 3) {
      const a = Math.hypot((x + 0.5 - 42) / 30, (y + 0.5 - 37) / 25),
        b = Math.hypot((x + 0.5 - 72) / 30, (y + 0.5 - 55) / 25);
      if (Math.abs(a - 1) * 25 > 0.85 && Math.abs(b - 1) * 25 > 0.85)
        assert.equal(at(image, x, y)[3], a < 1 && b < 1 ? 255 : 0, `ellipse ${x},${y}`);
    }
  const holes = fixture();
  Object.assign(holes.layers[1], {
    shape: "path",
    closed: true,
    fillRule: "evenodd",
    anchors: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 50 },
      { x: 0, y: 50 },
    ],
    subpaths: [
      {
        closed: true,
        anchors: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 40 },
          { x: 10, y: 40 },
        ],
      },
    ],
  });
  await load(p, holes, source);
  await choose(p);
  await apply(p, "Unite");
  image = await raster(p);
  assert.equal(at(image, 30, 30)[3], 0);
  assert.equal(at(image, 16, 16)[3], 255);
  // Ordinary native anchor, fill/stroke, transform and layer workflows remain available.
  await load(p, fixture(), source);
  await choose(p);
  await apply(p, "Unite");
  await tab(p, "Properties");
  await p.getByLabel("Selected anchor", { exact: true }).fill("1");
  await p.getByLabel("Outgoing handle X", { exact: true }).fill("10");
  let file = await native(p);
  assert.equal(shapes(file)[0].anchors[0].outgoing.x, 10);
  await tab(p, "Properties");
  await p.getByLabel("Object fill", { exact: true }).evaluate((input) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "#0000ff");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await p.getByLabel("Stroke width", { exact: true }).fill("2");
  await p.getByLabel("Object x", { exact: true }).fill("14");
  file = await native(p);
  assert.equal(shapes(file)[0].fill, "#0000ff");
  assert.equal(shapes(file)[0].transform.x, 14);
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Duplicate", exact: true }).click();
  assert.equal(shapes(await native(p)).length, 2);
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Delete", exact: true }).click();
  assert.equal(shapes(await native(p)).length, 1);
  await load(p, fixture(), source);
  await choose(p);
  await apply(p, "Exclude");
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Release compound path", exact: true }).click();
  assert.equal(shapes(await native(p)).length, 2);
  // Empty outputs and unsupported selections are explicit, atomic, and recoverable.
  const disjoint = fixture();
  disjoint.layers[2].transform.x = 90;
  disjoint.layers[2].width = 20;
  await load(p, disjoint, source);
  await choose(p);
  const retained = await native(p);
  await tab(p, "Pathfinder");
  await p.getByRole("button", { name: "Pathfinder Intersect", exact: true }).click();
  await p.getByRole("alert").filter({ hasText: "Empty Pathfinder result" }).waitFor();
  assert.deepEqual((await native(p)).value.document, retained.value.document);
  await tab(p, "Pathfinder");
  await p.getByLabel("Allow empty Pathfinder result", { exact: true }).check();
  await apply(p, "Intersect");
  assert.equal(shapes(await native(p)).length, 0);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.equal(shapes(await native(p)).length, 2);
  const invalid = fixture();
  invalid.layers[1].mask = {
    enabled: true,
    strokes: [],
    selection: { regions: [], inverted: false, feather: 0 },
  };
  await load(p, invalid, source);
  await choose(p);
  for (const op of operations)
    assert.ok(await p.getByRole("button", { name: `Pathfinder ${op}`, exact: true }).isDisabled());
  await load(p, fixture(), source);
  await choose(p);
  // Start and cancel through actual UI event handlers in the same browser task. No app hooks.
  await p
    .getByRole("button", { name: "Pathfinder Unite", exact: true })
    .evaluate(async (button) => {
      button.click();
      await Promise.resolve();
      const cancel = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "Cancel rendering",
      );
      if (!cancel) throw new Error("Cancel control was not exposed");
      cancel.click();
    });
  await p.getByText("Rendering cancelled. Document retained.", { exact: true }).waitFor();
  assert.equal(shapes(await native(p)).length, 2);
  await tab(p, "Pathfinder");
  await apply(p, "Unite");
  // Keyboard Space works without invoking the canvas pan shortcut.
  await load(p, fixture(), source);
  await choose(p);
  await p.getByRole("button", { name: "Pathfinder Unite", exact: true }).focus();
  await p.keyboard.press("Space");
  await p.getByText(/^Pathfinder unite: 1 editable object/).waitFor();
  await tab(p, "Pathfinder");
  await p.screenshot({ path: "/workspace/screenshots/pathfinder-desktop.png" });
  image = await raster(p);
  for (const mime of ["image/webp", "image/jpeg"]) {
    const exported = await raster(p, mime);
    assert.equal(exported.width, 128);
    assert.equal(exported.height, 96);
    const interior = at(exported, 30, 30),
      outside = at(exported, 1, 1);
    assert.ok(
      interior[0] > 245 && interior[1] < 10 && interior[2] < 10 && interior[3] === 255,
      mime,
    );
    assert.equal(outside[3], mime === "image/jpeg" ? 255 : 0);
    if (mime === "image/jpeg") assert.ok(outside.slice(0, 3).every((c) => c > 245));
  }
  same(await raster(p), image); // JPEG's white backing must not alter the native geometry/background.
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p
    .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
    .waitFor();
  await p.reload();
  await open(p, "Vector");
  same(await raster(p), image);
  await p.getByRole("button", { name: "Apply to chapter", exact: true }).click();
  await p
    .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
      exact: true,
    })
    .waitFor();
  assert.equal((await records(p))[0].original.blobId, original.blobId);
  await p.getByRole("button", { name: "Raster", exact: true }).click();
  same(await raster(p), image);
  assert.equal(await p.getByRole("button", { name: "Pathfinder", exact: true }).count(), 0);
  await p.getByRole("button", { name: "Vector", exact: true }).click();
  same(await raster(p), image);
  await context.close();
  console.log(
    "Curves, holes, result editing, explicit empty/invalid rollback, cancellation, keyboard, local reopen and Chapter/Raster/Vector handoff passed.",
  );
  for (const width of [320, 390]) {
    const c = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
      }),
      p = await c.newPage(),
      source = await start(p);
    await open(p, "Vector");
    await load(p, fixture(), source);
    await tab(p, "Layers");
    await p.getByRole("button", { name: "Multi-select", exact: true }).tap();
    await p.getByLabel("Select layer Back", { exact: true }).tap();
    assert.ok(await p.getByLabel("Select layer Back", { exact: true }).isChecked());
    await tab(p, "Pathfinder");
    for (const op of operations) {
      const button = p.getByRole("button", { name: `Pathfinder ${op}`, exact: true });
      assert.ok(await button.isEnabled());
      const box = await button.boundingBox();
      assert.ok(box.height >= 44 && box.width >= 44);
    }
    await apply(p, "Subtract");
    pixels(await raster(p), "Subtract");
    await p.getByRole("button", { name: "Pro undo", exact: true }).tap();
    assert.equal(shapes(await native(p)).length, 2);
    await p.getByRole("button", { name: "Pro redo", exact: true }).tap();
    assert.equal(shapes(await native(p)).length, 1);
    await tab(p, "Properties");
    await p.getByRole("button", { name: "Direct select tool", exact: true }).tap();
    file = await native(p);
    const l = shapes(file)[0],
      a = l.anchors[0],
      from = { x: a.x + l.transform.x, y: a.y + l.transform.y };
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    await touchDrag(p, from, { x: from.x + 5, y: from.y + 3 });
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    const edited = shapes(await native(p))[0];
    assert.ok(Math.abs(edited.anchors[0].x - a.x - 5) < 0.1);
    assert.ok(Math.abs(edited.anchors[0].y - a.y - 3) < 0.1);
    await p.getByRole("button", { name: "Pro undo", exact: true }).tap();
    await tab(p, "Pathfinder");
    assert.equal(
      await p.locator(".pro-panel-content").evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    assert.ok(
      await p
        .getByRole("region", { name: "Vector Pathfinder" })
        .getByText("1 selected", { exact: true })
        .isVisible(),
    );
    await p.screenshot({ path: `/workspace/screenshots/pathfinder-mobile-${width}.png` });
    file = await native(p);
    image = await raster(p);
    await load(p, file.value.document, source, file.value.assets);
    same(await raster(p), image);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await p.evaluate(() => scrollY), 0);
    await c.close();
    console.log(
      `Chromium ${width}px: touch multi-selection, Pathfinder controls, geometric subtraction, anchor drag, history/native/export and no overflow/scroll passed.`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, physicalAndroid: false }));
} catch (error) {
  for (const c of browser.contexts())
    for (const p of c.pages()) {
      await p.screenshot({ path: "/workspace/screenshots/pathfinder-failure.png" }).catch(() => {});
      console.error(await p.getByRole("alert").allTextContents());
    }
  throw error;
} finally {
  await browser.close();
}
