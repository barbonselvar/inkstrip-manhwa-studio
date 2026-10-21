/** Native Bézier UI, exact geometry, real worker/export, history and mobile touch checks. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer, worldPoint } from "../src/lib/studio/pro/model.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [];
async function tab(p, name) {
  await p
    .getByRole("navigation", { name: "Pro panels", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}

async function records(p) {
  return p.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const rows = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return rows;
  });
}

async function start(p) {
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByPlaceholder("Night Market").fill("Transform QA");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  const source = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const x = c.getContext("2d");
    const image = x.createImageData(128, 96);
    for (let y = 0; y < 96; y++)
      for (let px = 0; px < 128; px++)
        image.data.set([px * 2, y * 2, 80, px < 16 ? 0 : px < 32 ? 128 : 255], (y * 128 + px) * 4);
    x.putImageData(image, 0, 0);
    return c.toDataURL().split(",")[1];
  });
  await p
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      { name: "geometry.png", mimeType: "image/png", buffer: Buffer.from(source, "base64") },
    ]);
  await p.getByRole("button", { name: "Edit Image geometry.png", exact: true }).waitFor();
  return source;
}

async function open(p, mode = "Raster") {
  const button = p.getByRole("button", { name: `Open in ${mode} Studio`, exact: true });
  await button.scrollIntoViewIfNeeded();
  assert.ok(await button.isVisible());
  assert.ok(await button.isEnabled());
  await button.click();
  await p.getByRole("dialog", { name: `Inkstrip ${mode} Studio`, exact: true }).waitFor();
}

async function load(p, d, source, assets = { source: { mime: "image/png", data: source } }) {
  await tab(p, "History");
  const count = await p.locator(".pro-history-list li").count();
  await tab(p, "Assets");
  await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
    {
      name: "transform.inkstrip",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "inkstrip-pro",
          version: 1,
          document: d,
          assets,
        }),
      ),
    },
  ]);
  await tab(p, "History");
  await p.waitForFunction(
    (n) => document.querySelectorAll(".pro-history-list li").length === n + 1,
    count,
  );
}

async function native(p) {
  await tab(p, "Export");
  const ev = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export editable .inkstrip", exact: true }).click();
  const bytes = await readFile(await (await ev).path());
  return { bytes, value: JSON.parse(bytes.toString()) };
}

async function raster(p, mime = "image/png") {
  await tab(p, "Export");
  await p.getByLabel("Pro export format", { exact: true }).selectOption(mime);
  const ev = p.waitForEvent("download");
  await p.getByRole("button", { name: /^Export composite ·/ }).click();
  const bytes = await readFile(await (await ev).path());
  return p.evaluate(
    async ({ data, mime }) => {
      const b = await createImageBitmap(new Blob([Uint8Array.from(data)], { type: mime })),
        c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      const x = c.getContext("2d");
      x.drawImage(b, 0, 0);
      b.close();
      return {
        width: c.width,
        height: c.height,
        pixels: [...x.getImageData(0, 0, c.width, c.height).data],
      };
    },
    { data: [...bytes], mime },
  );
}

function same(a, b, tolerance = 1) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  for (let i = 0; i < a.pixels.length; i++)
    assert.ok(
      Math.abs(a.pixels[i] - b.pixels[i]) <= tolerance,
      `channel ${i}: ${a.pixels[i]} ≠ ${b.pixels[i]}`,
    );
}

async function preview(p) {
  await p.waitForFunction(
    () =>
      document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        ?.getAttribute("aria-busy") === "false",
  );
  return p.evaluate(() => {
    const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
    return {
      width: c.width,
      height: c.height,
      pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
    };
  });
}
function fixture() {
  const d = fromPanel({ id: "anchor-fixture", name: "Anchors", width: 128, height: 96 }),
    path = layer("shape", 128, 96, "curve");
  d.layers[0].visible = false;
  path.shape = "path";
  path.name = "Editable curve";
  path.fill = "transparent";
  path.stroke = "#ffffff";
  path.strokeWidth = 4;
  path.anchors = [
    { x: 20, y: 48, outgoing: { x: 20, y: 8 } },
    { x: 100, y: 48, incoming: { x: 100, y: 88 } },
  ];
  d.layers.push(path);
  return d;
}
const pathOf = (file) => file.value.document.layers.find((l) => l.name === "Editable curve");
async function properties(p) {
  await tab(p, "Properties");
  await p.getByLabel("Selected anchor", { exact: true }).waitFor();
}
async function at(p, point) {
  const r = await p.locator(".pro-artboard").boundingBox();
  return { x: r.x + (point.x / 128) * r.width, y: r.y + (point.y / 96) * r.height };
}
async function drag(p, from, to, modifier) {
  const a = await at(p, from),
    b = await at(p, to);
  if (modifier) await p.keyboard.down(modifier);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(b.x, b.y, { steps: 8 });
  await p.mouse.up();
  if (modifier) await p.keyboard.up(modifier);
}
async function touchDrag(p, from, to, cancel = false) {
  const a = await at(p, from),
    b = await at(p, to),
    cdp = await p.context().newCDPSession(p);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...a, id: 1 }],
  });
  for (let i = 1; i <= 8; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8, id: 1 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: cancel ? "touchCancel" : "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}
const near = (a, b, e = 0.05) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await context.newPage(),
    source = await start(p);
  const originalChapter = (await records(p))[0];
  await open(p, "Vector");
  const d = fixture();
  await load(p, d, source);
  const initial = await raster(p);
  await properties(p);
  await p.getByRole("button", { name: "Direct select tool", exact: true }).click();
  await p.locator("[data-split-segment]").click();
  let file = await native(p),
    path = pathOf(file);
  assert.equal(path.anchors.length, 3);
  assert.deepEqual({ x: path.anchors[1].x, y: path.anchors[1].y }, { x: 60, y: 48 });
  assert.equal(path.anchors[1].mode, "smooth");
  same(await raster(p), initial, 2);
  same(await preview(p), initial, 2);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.equal(pathOf(await native(p)).anchors.length, 2);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  assert.equal(pathOf(await native(p)).anchors.length, 3);
  same(await raster(p), initial, 2);
  await properties(p);
  await p.getByLabel("Selected anchor", { exact: true }).fill("2");
  await p.getByLabel("Anchor handle mode", { exact: true }).selectOption("symmetric");
  await p.getByLabel("Outgoing handle X", { exact: true }).fill("80");
  await p.getByLabel("Outgoing handle Y", { exact: true }).fill("68");
  file = await native(p);
  path = pathOf(file);
  assert.deepEqual(path.anchors[1].outgoing, { x: 80, y: 68 });
  assert.deepEqual(path.anchors[1].incoming, { x: 40, y: 28 });
  await properties(p);
  await drag(p, { x: 60, y: 48 }, { x: 66, y: 53 });
  file = await native(p);
  path = pathOf(file);
  near(path.anchors[1].x, 66);
  near(path.anchors[1].y, 53);
  near(path.anchors[1].incoming.x, 46);
  near(path.anchors[1].outgoing.y, 73);
  // Pointer cancellation restores geometry and does not append a history action.
  const beforeCancel = path.anchors;
  await properties(p);
  const startPoint = await at(p, { x: 66, y: 53 });
  await p.mouse.move(startPoint.x, startPoint.y);
  await p.mouse.down();
  await p.mouse.move(startPoint.x + 30, startPoint.y + 20);
  await p.locator(".pro-viewport").dispatchEvent("pointercancel", { pointerId: 1 });
  await p.mouse.up();
  assert.deepEqual(pathOf(await native(p)).anchors, beforeCancel);
  await properties(p);
  await drag(p, { x: 86, y: 73 }, { x: 90, y: 75 }, "Alt");
  path = pathOf(await native(p));
  assert.equal(path.anchors[1].mode, "corner");
  near(path.anchors[1].incoming.x, 46);
  near(path.anchors[1].incoming.y, 33);
  near(path.anchors[1].outgoing.x, 90);
  near(path.anchors[1].outgoing.y, 75);
  await properties(p);
  await p.getByLabel("Selected anchor", { exact: true }).scrollIntoViewIfNeeded();
  await p.screenshot({ path: "/workspace/screenshots/vector-anchors-desktop.png" });
  const beforeReverse = await raster(p);
  await properties(p);
  await p.getByRole("button", { name: "Reverse path direction", exact: true }).click();
  same(await raster(p), beforeReverse, 2);
  await properties(p);
  // Keyboard Delete changes the selected anchor, never deletes its layer.
  await p.locator(".pro-viewport").focus();
  await p.keyboard.press("Delete");
  path = pathOf(await native(p));
  assert.equal(path.anchors.length, 2);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.equal(pathOf(await native(p)).anchors.length, 3);
  // Numeric traveled-distance insertion on a nonuniform straight cubic.
  const straight = fixture();
  straight.layers[1].anchors = [
    { x: 20, y: 48 },
    { x: 100, y: 48 },
  ];
  await load(p, straight, source);
  const straightImage = await raster(p);
  await properties(p);
  await p.getByLabel("Selected anchor", { exact: true }).fill("1");
  await p.getByLabel("Anchor insertion measurement", { exact: true }).selectOption("distance");
  await p.getByLabel("Segment insertion distance %", { exact: true }).fill("25");
  await p
    .getByRole("button", { name: "Insert anchor without changing curve", exact: true })
    .click();
  path = pathOf(await native(p));
  near(path.anchors[1].x, 40);
  near(path.anchors[1].y, 48);
  same(await raster(p), straightImage, 1);
  const svgDownload = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export SVG · vectors only", exact: true }).click();
  const svg = await readFile(await (await svgDownload).path(), "utf8");
  assert.equal((svg.match(/ C/g) ?? []).length, 2);
  const svgRaster = await p.evaluate(async (svg) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
      image = new Image();
    try {
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: [...ctx.getImageData(0, 0, 128, 96).data],
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, svg);
  same(svgRaster, straightImage, 1);
  const closed = fixture();
  closed.layers[1].closed = true;
  await load(p, closed, source);
  const closedImage = await raster(p);
  await properties(p);
  await p.getByLabel("Selected anchor", { exact: true }).fill("2");
  await p
    .getByRole("button", { name: "Insert anchor without changing curve", exact: true })
    .click();
  path = pathOf(await native(p));
  assert.equal(path.closed, true);
  assert.equal(path.anchors.length, 3);
  near(path.anchors[2].x, 60);
  near(path.anchors[2].y, 48);
  same(await raster(p), closedImage, 2);
  console.log(
    "Desktop: exact canvas insertion, numeric arc-distance insertion, anchor/handle edits, coupling/Alt, reversal, Delete, cancellation and undo/redo passed.",
  );
  // Transform-aware editing through the existing inverse projection; mask and clip survive.
  const transformed = fixture(),
    tpath = transformed.layers[1];
  transformed.layers[0].visible = true;
  tpath.clipped = true;
  tpath.transform = {
    x: 6,
    y: 4,
    scaleX: 0.85,
    scaleY: 0.8,
    rotation: 5,
    deform: {
      kind: "perspective",
      width: 128,
      height: 96,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0.1 },
        { x: 0.95, y: 1 },
        { x: 0.05, y: 0.95 },
      ],
    },
  };
  tpath.mask = {
    enabled: true,
    strokes: [],
    selection: { regions: [], feather: 0, inverted: false },
  };
  await load(p, transformed, source);
  await properties(p);
  await drag(p, worldPoint(tpath.anchors[0], tpath), worldPoint({ x: 28, y: 55 }, tpath));
  file = await native(p);
  path = pathOf(file);
  near(path.anchors[0].x, 28);
  near(path.anchors[0].y, 55);
  assert.deepEqual(path.transform, tpath.transform);
  assert.deepEqual(path.mask, tpath.mask);
  assert.equal(path.clipped, true);
  const exported = await raster(p);
  same(await preview(p), exported);
  await load(p, file.value.document, source, file.value.assets);
  same(await raster(p), exported);
  const reopened = await native(p);
  assert.deepEqual(pathOf(reopened).anchors, path.anchors);
  assert.equal(reopened.value.assets[reopened.value.document.source.assetId].data, source);
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p
    .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
    .waitFor();
  await p.reload();
  await open(p, "Vector");
  same(await raster(p), exported);
  assert.deepEqual((await records(p))[0], originalChapter);
  await p.getByRole("button", { name: "Apply to chapter", exact: true }).click();
  await p
    .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
      exact: true,
    })
    .waitFor();
  const panel = (await records(p))[0];
  assert.equal(panel.original.blobId, originalChapter.blobId);
  await p.getByRole("button", { name: "Raster", exact: true }).click();
  same(await raster(p), exported);
  console.log(
    "Perspective-aware anchors, mask/clip metadata, source bytes, native/local save-reopen, worker PNG and Raster/Vector/Chapter handoff passed.",
  );
  await properties(p);
  await p.screenshot({ path: "/workspace/screenshots/vector-anchors-chapter-handoff.png" });
  await context.close();
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
    await properties(p);
    await p.getByRole("button", { name: "Direct select tool", exact: true }).tap();
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    await touchDrag(p, { x: 20, y: 48 }, { x: 28, y: 55 });
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    let file = await native(p),
      path = pathOf(file);
    near(path.anchors[0].x, 28);
    near(path.anchors[0].y, 55);
    await properties(p);
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    await touchDrag(p, { x: 28, y: 55 }, { x: 45, y: 60 }, true);
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    assert.deepEqual(pathOf(await native(p)).anchors, path.anchors);
    await properties(p);
    await p.getByLabel("Selected anchor", { exact: true }).fill("1");
    await p.getByLabel("Anchor handle mode", { exact: true }).selectOption("smooth");
    await p
      .getByRole("button", { name: "Insert anchor without changing curve", exact: true })
      .tap();
    file = await native(p);
    assert.equal(pathOf(file).anchors.length, 3);
    const out = await raster(p);
    await load(p, file.value.document, source, file.value.assets);
    same(await raster(p), out);
    await properties(p);
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    const beforePinch = await p.locator(".pro-artboard").getAttribute("style"),
      cdp = await c.newCDPSession(p),
      center = await at(p, { x: 64, y: 48 });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: center.x - 30, y: center.y, id: 1 },
        { x: center.x + 30, y: center.y, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: center.x - 40, y: center.y + 10, id: 1 },
        { x: center.x + 40, y: center.y + 10, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    assert.notEqual(await p.locator(".pro-artboard").getAttribute("style"), beforePinch);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await p.evaluate(() => scrollY), 0);
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    assert.deepEqual(pathOf(await native(p)).anchors, pathOf(file).anchors);
    await properties(p);
    await p.getByLabel("Selected anchor", { exact: true }).scrollIntoViewIfNeeded();
    await p.screenshot({ path: `/workspace/screenshots/vector-anchors-mobile-${width}.png` });
    await c.close();
    console.log(
      `Chromium ${width}px: CDP touch anchor drag/cancel, numeric/coupled handles, insertion, native/export, pinch/pan and no page scroll/overflow passed.`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, physicalAndroid: false }));
} finally {
  await browser.close();
}
