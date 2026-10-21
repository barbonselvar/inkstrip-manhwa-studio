/** Compound/source-safe SVG integration through the real UI, worker and exporters. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  { tab, records, start, open, load, native, raster, same, preview, artboardBounds } =
    proBrowserFixtures(base, errors);
const at = (image, x, y) =>
  image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
function fixture() {
  const d = fromPanel({ id: "compound-fixture", name: "Compound fixture", width: 128, height: 96 }),
    a = layer("shape", 100, 76),
    b = layer("shape", 40, 36);
  d.layers[0].visible = false;
  a.name = "Outer";
  a.fill = "#ff0000";
  a.strokeWidth = 0;
  a.transform.x = 10;
  a.transform.y = 10;
  b.name = "Inner";
  b.fill = "#00ff00";
  b.strokeWidth = 0;
  b.transform.x = 40;
  b.transform.y = 30;
  d.layers.push(a, b);
  return d;
}
async function svgImport(p, svg) {
  await tab(p, "History");
  const count = await p.locator(".pro-history-list li").count();
  await tab(p, "Assets");
  await p
    .getByLabel("Import Pro asset", { exact: true })
    .setInputFiles({ name: "compound.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await p.getByText("SVG vectors imported. Chapter unchanged.", { exact: true }).waitFor();
  await tab(p, "History");
  await p.waitForFunction(
    (n) => document.querySelectorAll(".pro-history-list li").length === Math.min(51, n + 1),
    count,
  );
}
async function properties(p) {
  await tab(p, "Properties");
  await p.getByLabel("Selected subpath", { exact: true }).waitFor();
}
async function reference(p, svg) {
  return p.evaluate(async (svg) => {
    const image = new Image(),
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      image.src = url;
      await image.decode();
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 96;
      const x = c.getContext("2d");
      x.drawImage(image, 0, 0);
      return { width: 128, height: 96, pixels: [...x.getImageData(0, 0, 128, 96).data] };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, svg);
}
async function svgExport(p) {
  await tab(p, "Export");
  const e = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export SVG · vectors only", exact: true }).click();
  return readFile(await (await e).path(), "utf8");
}
async function compound(p) {
  await tab(p, "Layers");
  await p.getByLabel("Select layer Outer", { exact: true }).check();
  await p.getByRole("button", { name: "Create compound path", exact: true }).click();
  await properties(p);
}
const compoundLayer = (file) => file.value.document.layers.find((l) => l.name === "Compound path");
async function empty(p, source) {
  const d = fromPanel({ id: "empty", name: "SVG reference", width: 128, height: 96 });
  d.layers[0].visible = false;
  await load(p, d, source);
}
async function touchDrag(p, from, to) {
  const r = await artboardBounds(p),
    point = (p) => ({ x: r.x + (p.x / 128) * r.width, y: r.y + (p.y / 96) * r.height }),
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
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await c.newPage(),
    source = await start(p);
  const original = (await records(p))[0];
  await open(p, "Vector");
  await load(p, fixture(), source);
  await compound(p);
  let file = await native(p),
    l = compoundLayer(file);
  assert.equal(l.subpaths.length, 1);
  assert.equal(l.fillRule, "evenodd");
  let out = await raster(p);
  assert.deepEqual(at(out, 20, 20), [255, 0, 0, 255]);
  assert.deepEqual(at(out, 60, 48), [0, 0, 0, 0]);
  same(await preview(p), out);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  file = await native(p);
  assert.equal(file.value.document.layers.filter((l) => l.kind === "shape").length, 2);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  same(await raster(p), out);
  await properties(p);
  await p.getByLabel("Path fill rule", { exact: true }).selectOption("nonzero");
  assert.deepEqual(at(await raster(p), 60, 48), [255, 0, 0, 255]);
  await properties(p);
  await p.getByLabel("Selected subpath", { exact: true }).selectOption("1");
  await p.getByRole("button", { name: "Reverse path direction", exact: true }).click();
  assert.deepEqual(at(await raster(p), 60, 48), [0, 0, 0, 0]);
  file = await native(p);
  const outer = compoundLayer(file).anchors;
  await properties(p);
  await p
    .getByLabel("Anchor X", { exact: true })
    .fill(String(compoundLayer(file).subpaths[0].anchors[0].x + 3));
  file = await native(p);
  assert.deepEqual(compoundLayer(file).anchors, outer);
  const compoundSaved = file;
  out = await raster(p);
  await load(p, file.value.document, source, file.value.assets);
  same(await raster(p), out);
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p
    .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
    .waitFor();
  await p.reload();
  await open(p, "Vector");
  same(await raster(p), out);
  const svg = await svgExport(p);
  assert.match(svg, /fill-rule="nonzero"/);
  assert.equal((svg.match(/ M/g) ?? []).length, 1);
  same(await reference(p, svg), out, 2);
  await empty(p, source);
  await svgImport(p, svg);
  same(await raster(p), out, 2);
  await properties(p);
  assert.equal(
    await p.getByLabel("Selected subpath", { exact: true }).locator("option").count(),
    2,
  );
  // Hole hit testing must choose underlying raster, while filled regions choose the compound.
  const hitFixture = fixture();
  hitFixture.layers[0].visible = true;
  await load(p, hitFixture, source);
  await compound(p);
  await p.getByRole("button", { name: "Move tool", exact: true }).click();
  const r = await artboardBounds(p);
  await p.mouse.click(r.x + (60 / 128) * r.width, r.y + (48 / 96) * r.height);
  await tab(p, "Properties");
  assert.equal(
    await p.getByLabel("Pro layer name", { exact: true }).inputValue(),
    "Imported artwork",
  );
  await p.mouse.click(r.x + (20 / 128) * r.width, r.y + (20 / 96) * r.height);
  await properties(p);
  assert.equal(await p.getByLabel("Pro layer name", { exact: true }).inputValue(), "Compound path");
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Release compound path", exact: true }).click();
  file = await native(p);
  assert.equal(file.value.document.layers.filter((l) => l.kind === "shape").length, 2);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.equal(compoundLayer(await native(p)).subpaths.length, 1);
  console.log(
    "Compound creation/release, nested winding/holes, independent subpath editing, history, local/native reopen, hit testing and SVG/PNG fidelity passed.",
  );
  const cases = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><path fill="#ff0000" fill-rule="evenodd" stroke="#ffffff" stroke-width="2" stroke-linejoin="bevel" d="M10 10H118V86H10Z M40 30v36h40v-36z"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><g opacity="0.5" transform="translate(5 4)"><g transform="matrix(-1 0 .15 1 110 0)" fill="#0000ff"><path d="M10 10h40v40h-40z"/><path fill="red" d="M30 30h40v40h-40z"/></g></g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="-20 -10 100 100" preserveAspectRatio="none"><path fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="4" stroke-dasharray="7 3 2" stroke-dashoffset="-2" d="M-10 20l30 -10q20 0 30 20t20 30"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><path fill="#36aabb" stroke="#ffffff" stroke-width="2" d="M20 40a40 25 25 1 0 80 0a40 25 25 1 0-80 0z"/><path fill="none" stroke="red" d="M5 80c15-20 25-20 35 0s25 20 35 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="-20 -10 100 100"><rect x="-20" y="-10" width="100" height="100" rx="10" fill="white"/><circle cx="30" cy="40" r="20" fill="#123456"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><path style="fill:rgba(255,0,0,0.5);stroke:blue;stroke-width:3;fill-opacity:0.5;stroke-opacity:0.5;stroke-linecap:square" d="M10 10L110 10L60 80Z"/></svg>',
  ];
  for (const [index, markup] of cases.entries()) {
    await empty(p, source);
    await svgImport(p, markup);
    const image = await raster(p),
      ref = await reference(p, markup);
    let error = 0,
      max = 0;
    for (let i = 0; i < image.pixels.length; i++) {
      const delta = Math.abs(image.pixels[i] - ref.pixels[i]);
      error += delta;
      max = Math.max(max, delta);
    }
    // Independent SVG and Canvas rasterizers differ at antialias boundaries; the
    // geometry itself has a separately tested <=0.01 document-pixel arc bound.
    assert.ok(
      error / image.pixels.length < 0.5,
      `SVG case ${index}: mean channel error ${error / image.pixels.length}, max ${max}`,
    );
    file = await native(p);
    assert.ok(
      file.value.document.layers.filter((l) => l.kind === "shape").every((l) => !l.pathData),
    );
    await load(p, file.value.document, source, file.value.assets);
    same(await raster(p), image);
    const serialized = await svgExport(p);
    console.log(
      `SVG comparison ${index}: mean channel difference ${error / image.pixels.length}, max ${max}`,
    );
    same(await reference(p, serialized), image, 2);
  }
  console.log(
    "Independent SVG comparisons: path commands/arcs, viewBox/negative coordinates, affine reflection/shear, isolated nested groups, winding, stroke/dash/cap/join and opacity passed.",
  );
  await empty(p, source);
  await svgImport(
    p,
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path fill="red" d="M40 20h80v40H40Z"/></svg>',
  );
  let viewportImage = await raster(p);
  assert.deepEqual(at(viewportImage, 50, 40), [255, 0, 0, 255]);
  assert.deepEqual(at(viewportImage, 70, 40), [0, 0, 0, 0]);
  file = await native(p);
  assert.ok(file.value.document.layers[1].mask.enabled);
  await load(p, file.value.document, source, file.value.assets);
  same(await raster(p), viewportImage);
  await tab(p, "Properties");
  if (!(await p.getByLabel("Enable layer mask", { exact: true }).isVisible()))
    await p.getByText("Layer mask", { exact: true }).click();
  await p.getByLabel("Enable layer mask", { exact: true }).uncheck();
  assert.deepEqual(at(await raster(p), 70, 40), [255, 0, 0, 255]);
  console.log(
    "Differently sized SVG viewport clipping, editable native mask and recovery of off-viewport source geometry passed.",
  );
  await empty(p, source);
  await svgImport(
    p,
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><path fill="none" stroke="white" stroke-width="4" d="M20 20L30 20"/></svg>',
  );
  assert.deepEqual(at(await raster(p), 70, 20), [0, 0, 0, 0]);
  await properties(p);
  await p.getByLabel("Selected anchor", { exact: true }).fill("2");
  await p.getByLabel("Anchor X", { exact: true }).fill("80");
  assert.deepEqual(at(await raster(p), 70, 20), [255, 255, 255, 255]);
  assert.equal((await native(p)).value.version, 2);
  const extendedImage = await raster(p);
  await properties(p);
  await p.getByRole("button", { name: "Fit vector frame to content", exact: true }).click();
  same(await raster(p), extendedImage, 2);
  // Legacy native raw path data has an explicit undoable conversion action.
  const legacy = fixture();
  legacy.layers = legacy.layers.slice(0, 2);
  legacy.layers[1].shape = "path";
  legacy.layers[1].pathData = "M0 0H80V60H0Z M20 20q20-10 40 0v20h-40z";
  legacy.layers[1].fillRule = "evenodd";
  await load(p, legacy, source);
  const legacyImage = await raster(p);
  await tab(p, "Properties");
  await p
    .getByRole("button", { name: "Convert SVG path to editable contours", exact: true })
    .click();
  same(await raster(p), legacyImage, 2);
  file = await native(p);
  assert.equal(file.value.document.layers[1].subpaths.length, 1);
  assert.equal(file.value.document.layers[1].pathData, undefined);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.equal((await native(p)).value.document.layers[1].pathData, legacy.layers[1].pathData);
  for (const markup of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path onload="alert(1)" d="M0 0L1 1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://example.com/a)" d="M0 0L1 1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.com/a.svg"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0A1e-310 1e-310 0 0 1 1 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0A1 1 0 0 1 1e-200 0"/></svg>',
    '<!DOCTYPE svg [<!ENTITY external SYSTEM "https://example.com/">]><svg xmlns="http://www.w3.org/2000/svg"><text>&external;</text></svg>',
  ]) {
    const before = await native(p);
    await tab(p, "Assets");
    await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles({
      name: "unsafe.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(markup),
    });
    await p.getByRole("alert").waitFor();
    assert.deepEqual((await native(p)).value.document, before.value.document);
  }
  assert.deepEqual((await records(p))[0], original);
  await load(p, compoundSaved.value.document, source, compoundSaved.value.assets);
  const chapterImage = await raster(p);
  await properties(p);
  await p.getByLabel("Selected subpath", { exact: true }).selectOption("1");
  await p.getByRole("button", { name: "Direct select tool", exact: true }).click();
  await p.getByLabel("Selected subpath", { exact: true }).scrollIntoViewIfNeeded();
  await p.screenshot({ path: "/workspace/screenshots/compound-desktop.png" });
  await p.getByRole("button", { name: "Apply to chapter", exact: true }).click();
  await p
    .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
      exact: true,
    })
    .waitFor();
  const applied = (await records(p))[0];
  assert.equal(applied.original.blobId, original.blobId);
  const originalBytes = await p.evaluate(async (id) => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const blob = await new Promise((resolve) => {
      const r = db.transaction("blobs").objectStore("blobs").get(id);
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, applied.original.blobId);
  assert.equal(Buffer.from(originalBytes).toString("base64"), source);
  await p.getByRole("button", { name: "Raster", exact: true }).click();
  same(await raster(p), chapterImage);
  await p.getByRole("button", { name: "Vector", exact: true }).click();
  assert.equal(compoundLayer(await native(p)).subpaths.length, 1);
  await c.close();
  console.log(
    "Legacy conversion, unsafe/unsupported SVG and malformed-path atomic rollback, and Chapter source isolation passed.",
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
    await compound(p);
    assert.deepEqual(at(await raster(p), 60, 48), [0, 0, 0, 0]);
    await properties(p);
    await p.getByLabel("Selected subpath", { exact: true }).selectOption("1");
    file = await native(p);
    const outer = compoundLayer(file).anchors;
    await p.getByRole("button", { name: "Direct select tool", exact: true }).tap();
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    await touchDrag(p, { x: 40, y: 30 }, { x: 45, y: 32 });
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    file = await native(p);
    l = compoundLayer(file);
    assert.deepEqual(l.anchors, outer);
    assert.ok(Math.abs(l.subpaths[0].anchors[0].x - 36) < 0.1); // normalized compound origin is (9,9)
    await properties(p);
    await p.getByLabel("Selected subpath", { exact: true }).scrollIntoViewIfNeeded();
    await p.screenshot({ path: `/workspace/screenshots/compound-mobile-${width}.png` });
    const image = await raster(p);
    await load(p, file.value.document, source, file.value.assets);
    same(await raster(p), image);
    await tab(p, "Layers");
    await p.getByRole("button", { name: "Release compound path", exact: true }).tap();
    assert.equal(
      (await native(p)).value.document.layers.filter((l) => l.kind === "shape").length,
      2,
    );
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await p.evaluate(() => scrollY), 0);
    await c.close();
    console.log(
      `Chromium ${width}px: compound creation/release, touch subpath dragging, holes, native/export and no page overflow/scroll passed.`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, physicalAndroid: false }));
} finally {
  await browser.close();
}
