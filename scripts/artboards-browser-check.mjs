/** Actual document/render workers, native/history, clipped output and touch gestures. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { DEFAULT_LAYOUT } from "../src/lib/studio/pro/artboards.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [];
const { tab, start, open, load, native, raster, same, preview, records, artboardBounds } =
  proBrowserFixtures(base, errors);
const at = (im, x, y) => im.pixels.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4);
function fixture() {
  const d = fromPanel({ id: "artboards", name: "Artboard QA", width: 128, height: 96 });
  d.layers[0].visible = false;
  const red = layer("shape", 32, 32, "red");
  Object.assign(red, { name: "Red", fill: "#ff0000", strokeWidth: 0 });
  red.transform.x = 160;
  red.transform.y = 8;
  const blue = layer("shape", 24, 24, "blue");
  Object.assign(blue, { name: "Blue", fill: "#0000ff", strokeWidth: 0 });
  blue.transform.x = -48;
  blue.transform.y = -24;
  d.layers.push(red, blue);
  d.artboards = [
    {
      id: "east",
      name: "East / panel",
      x: 152,
      y: 0,
      width: 64,
      height: 64,
      background: "transparent",
    },
    { id: "west", name: "West", x: -56, y: -32, width: 48, height: 48, background: "transparent" },
  ];
  d.layout = structuredClone(DEFAULT_LAYOUT);
  d.layout.modes.grid = false;
  return d;
}
async function reopen(p, file) {
  await tab(p, "History");
  const count = await p.locator(".pro-history-list li").count();
  await tab(p, "Assets");
  await p
    .getByLabel("Import Pro asset", { exact: true })
    .setInputFiles({
      name: "actual-v3.inkstrip",
      mimeType: "application/json",
      buffer: file.bytes,
    });
  await tab(p, "History");
  await p.waitForFunction(
    (n) => document.querySelectorAll(".pro-history-list li").length === Math.min(51, n + 1),
    count,
  );
}
async function image(p, bytes, mime) {
  return p.evaluate(
    async ({ bytes, mime }) => {
      const blob = new Blob([Uint8Array.from(bytes)], { type: mime });
      const bitmap =
          mime === "image/svg+xml"
            ? await new Promise((resolve, reject) => {
                const img = new Image(),
                  url = URL.createObjectURL(blob);
                img.onload = () => {
                  URL.revokeObjectURL(url);
                  resolve(img);
                };
                img.onerror = () => {
                  URL.revokeObjectURL(url);
                  reject(Error("SVG image did not decode"));
                };
                img.src = url;
              })
            : await createImageBitmap(blob),
        c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return {
        width: c.width,
        height: c.height,
        pixels: [...ctx.getImageData(0, 0, c.width, c.height).data],
      };
    },
    { bytes: [...bytes], mime },
  );
}
async function exportBoard(p, mime = "image/png", scale = 1) {
  await tab(p, "Artboards");
  await p.getByLabel("Artboard export format", { exact: true }).selectOption(mime);
  await p.getByLabel("Artboard raster export scale", { exact: true }).fill(String(scale));
  const ev = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export selected artboard", exact: true }).click();
  const d = await ev;
  const bytes = await readFile(await d.path());
  await p.getByText(/^Exported 1 artboard at native bounds/).waitFor();
  return {
    bytes,
    name: d.suggestedFilename(),
    image: mime === "image/svg+xml" ? null : await image(p, bytes, mime),
  };
}
async function position(p, point) {
  await artboardBounds(p);
  return p.locator('svg[aria-label="Pro selection overlays"]').evaluate((el, point) => {
    const r = el.getBoundingClientRect(),
      b = el.viewBox.baseVal;
    return {
      x: r.x + ((point.x - b.x) / b.width) * r.width,
      y: r.y + ((point.y - b.y) / b.height) * r.height,
    };
  }, point);
}
async function touch(p, from, to, cancel = false, acquire = false) {
  const a = await position(p, from),
    b = await position(p, to),
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
  if (acquire)
    assert.ok(
      await p.getByLabel("Acquired smart guides", { exact: true }).count(),
      "actual acquired smart guides during drag",
    );
  await cdp.send("Input.dispatchTouchEvent", {
    type: cancel ? "touchCancel" : "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  assert.equal(
    await p.getByLabel("Acquired smart guides", { exact: true }).count(),
    0,
    "guides clear on release/cancel",
  );
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const p = await context.newPage(),
    source = await start(p);
  await open(p, "Vector");
  await tab(p, "Artboards");
  await p.getByRole("button", { name: "New artboard", exact: true }).click();
  await p.getByLabel("Artboard name", { exact: true }).fill("Cover");
  await p.getByLabel("Artboard width", { exact: true }).fill("80");
  await p.getByLabel("Artboard height", { exact: true }).fill("60");
  const created = await native(p);
  assert.equal(created.value.version, 3);
  assert.equal(created.value.document.artboards[0].name, "Cover");
  assert.equal(created.value.document.artboards[0].width, 80);
  await tab(p, "Artboards");
  await p.getByRole("button", { name: "Duplicate board", exact: true }).click();
  let n = await native(p);
  assert.equal(n.value.document.artboards.length, 2);
  assert.equal(n.value.document.layers.length, created.value.document.layers.length);
  await tab(p, "Artboards");
  await p.getByRole("button", { name: "Earlier", exact: true }).click();
  n = await native(p);
  assert.match(n.value.document.artboards[0].name, /copy/);
  await tab(p, "Artboards");
  await p.getByRole("button", { name: "Delete boundary", exact: true }).click();
  n = await native(p);
  assert.equal(n.value.document.artboards.length, 1);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  n = await native(p);
  assert.equal(n.value.document.artboards.length, 2);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  await load(p, fixture(), source);
  await tab(p, "Artboards");
  await p.getByLabel("Active artboard", { exact: true }).selectOption("east");
  let result = await exportBoard(p);
  assert.equal(result.name, "01-East-panel.png");
  assert.equal(result.image.width, 64);
  assert.equal(result.image.height, 64);
  assert.deepEqual(at(result.image, 16, 16), [255, 0, 0, 255]);
  assert.deepEqual(at(result.image, 0, 0), [0, 0, 0, 0]);
  const png = result.image;
  result = await exportBoard(p, "image/png", 2);
  assert.equal(result.image.width, 128);
  assert.deepEqual(at(result.image, 32, 32), [255, 0, 0, 255]);
  assert.equal(at(result.image, 0, 0)[3], 0);
  result = await exportBoard(p, "image/jpeg");
  assert.equal(at(result.image, 0, 0)[3], 255);
  assert.ok(
    at(result.image, 0, 0)
      .slice(0, 3)
      .every((v) => v > 245),
  );
  assert.ok(at(result.image, 20, 20)[0] > 245);
  result = await exportBoard(p, "image/webp");
  assert.equal(at(result.image, 0, 0)[3], 0);
  assert.ok(at(result.image, 20, 20)[0] > 245);
  result = await exportBoard(p, "image/svg+xml");
  assert.match(result.bytes.toString(), /viewBox="152 0 64 64"/);
  const svgImage = await image(p, result.bytes, "image/svg+xml");
  same(png, svgImage, 1);
  await p.getByLabel("Active artboard", { exact: true }).selectOption("west");
  result = await exportBoard(p);
  assert.equal(result.image.width, 48);
  assert.deepEqual(at(result.image, 16, 16), [0, 0, 255, 255]);
  const whole = await raster(p);
  assert.equal(whole.width, 128);
  assert.equal(whole.height, 96);
  assert.ok(
    whole.pixels.every((v) => v === 0),
    "whole-document output remains bounded to the original canvas",
  );
  await tab(p, "Artboards");
  await p.getByLabel("Artboard export format", { exact: true }).selectOption("image/png");
  const downloads = [];
  const collect = (d) => downloads.push(d);
  p.on("download", collect);
  await p.getByLabel("Artboard export range", { exact: true }).fill("all");
  await p.getByRole("button", { name: "Export range / all artboards", exact: true }).click();
  await p.getByText(/^Exported 2 artboards/).waitFor();
  p.off("download", collect);
  assert.equal(downloads.length, 2);
  assert.deepEqual(
    downloads.map((d) => d.suggestedFilename()),
    ["01-East-panel.png", "02-West.png"],
  );
  for (const d of downloads) assert.ok((await readFile(await d.path())).length > 0);
  // Persisted guide settings and actual transformed geometric alignment.
  await tab(p, "Layers");
  await p.getByLabel("Select layer Red", { exact: true }).check();
  await tab(p, "Precision");
  await p.getByLabel("Align relative to", { exact: true }).selectOption("selection");
  await p.getByRole("button", { name: "Align top", exact: true }).click();
  n = await native(p);
  const shapes = n.value.document.layers.filter((l) => l.kind === "shape");
  assert.equal(shapes[0].transform.y, shapes[1].transform.y);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await tab(p, "Precision");
  await p.getByLabel("New guide position", { exact: true }).fill("42");
  await p.getByRole("button", { name: "Create guide", exact: true }).click();
  await p.getByLabel("Lock guide 1", { exact: true }).check();
  n = await native(p);
  assert.equal(n.value.document.layout.guides[0].position, 42);
  assert.equal(n.value.document.layout.guides[0].locked, true);
  assert.equal(n.value.assets[n.value.document.source.assetId].data, source);
  await reopen(p, n);
  const reopened = await native(p);
  assert.deepEqual(reopened.value.document.artboards, n.value.document.artboards);
  assert.deepEqual(reopened.value.document.layout, n.value.document.layout);
  await tab(p, "Artboards");
  await p.getByLabel("Active artboard", { exact: true }).selectOption("east");
  same((await exportBoard(p)).image, png);
  // Board alpha/backgrounds remain independent from the legacy canvas background.
  const backgrounds = fromPanel({ id: "backgrounds", name: "Backgrounds", width: 128, height: 96 });
  backgrounds.background = "#ffffff";
  backgrounds.layers[0].visible = false;
  backgrounds.artboards = [
    {
      id: "background",
      name: "Alpha board",
      x: 20,
      y: 20,
      width: 40,
      height: 40,
      background: "transparent",
    },
  ];
  await load(p, backgrounds, source);
  const alphaPreview = await preview(p);
  assert.deepEqual(at(alphaPreview, 0, 0), [255, 255, 255, 255]);
  assert.equal(at(alphaPreview, 30, 30)[3], 0);
  await tab(p, "Artboards");
  await p.getByLabel("Active artboard", { exact: true }).selectOption("background");
  assert.equal(at((await exportBoard(p)).image, 10, 10)[3], 0);
  await p.getByLabel("Artboard background", { exact: true }).selectOption("color");
  await p.getByLabel("Artboard background color", { exact: true }).evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "#123456");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.deepEqual(at((await exportBoard(p)).image, 10, 10), [18, 52, 86, 255]);
  // Off-canvas projection shares the real masked/clipped group compositor.
  const masked = fixture(),
    group = layer("group", 128, 96, "masked-group");
  group.opacity = 0.5;
  const red = masked.layers[1];
  red.parentId = group.id;
  red.mask = {
    enabled: true,
    strokes: [],
    selection: {
      inverted: false,
      feather: 0,
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 0, y: 0 },
            { x: 16, y: 32 },
          ],
        },
      ],
    },
  };
  const green = {
    ...structuredClone(red),
    id: "green",
    name: "Green clip",
    fill: "#00ff00",
    mask: undefined,
    clipped: true,
  };
  masked.layers = [masked.layers[0], group, red, green];
  await load(p, masked, source);
  await tab(p, "Artboards");
  await p.getByLabel("Active artboard", { exact: true }).selectOption("east");
  const clipped = (await exportBoard(p)).image;
  assert.deepEqual(at(clipped, 16, 16).slice(0, 3), [0, 255, 0]);
  assert.ok([127, 128].includes(at(clipped, 16, 16)[3]));
  assert.equal(at(clipped, 32, 16)[3], 0);
  const kept = await native(p);
  await reopen(p, kept);
  await tab(p, "Artboards");
  await p.getByLabel("Active artboard", { exact: true }).selectOption("east");
  same(clipped, (await exportBoard(p)).image);
  await p.screenshot({ path: "/workspace/screenshots/dc-artboards-desktop.png" });
  // Fitting a widely separated board changes the render viewport, retaining full detail.
  const far = fixture();
  far.artboards[0].x = 10000;
  far.layers[1].transform.x = 10008;
  await load(p, far, source);
  await tab(p, "Artboards");
  await p.getByLabel("Active artboard", { exact: true }).selectOption("east");
  await p.getByRole("button", { name: "Fit selected board", exact: true }).click();
  const focused = await preview(p);
  assert.equal(focused.width, 64);
  assert.equal(focused.height, 64);
  assert.deepEqual(at(focused, 16, 16), [255, 0, 0, 255]);
  // Actual movement, off-center transform handles and direct anchors acquire guides.
  const precise = fromPanel({ id: "precision", name: "Precision", width: 128, height: 96 });
  precise.layers[0].visible = false;
  const rectangle = layer("shape", 20, 10, "precise");
  rectangle.strokeWidth = 0;
  rectangle.transform.x = rectangle.transform.y = 20;
  precise.layers.push(rectangle);
  precise.layout = structuredClone(DEFAULT_LAYOUT);
  precise.layout.modes = {
    grid: false,
    objects: false,
    anchors: false,
    guides: true,
    artboards: false,
  };
  precise.layout.guides = [
    { id: "x", axis: "x", position: 60, locked: true },
    { id: "y", axis: "y", position: 40, locked: true },
  ];
  async function mouseDrag(from, to) {
    const a = await position(p, from),
      b = await position(p, to);
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(b.x, b.y, { steps: 8 });
    assert.ok(await p.getByLabel("Acquired smart guides", { exact: true }).count());
    await p.mouse.up();
    assert.equal(await p.getByLabel("Acquired smart guides", { exact: true }).count(), 0);
  }
  await load(p, precise, source);
  await p.getByRole("button", { name: "Move tool", exact: true }).click();
  await mouseDrag({ x: 30, y: 25 }, { x: 49, y: 39 });
  let moved = (await native(p)).value.document.layers[1];
  assert.ok(Math.abs(moved.transform.x - 40) < 0.001);
  assert.ok(Math.abs(moved.transform.y - 35) < 0.001);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await p.getByRole("button", { name: "Free Transform tool", exact: true }).click();
  await mouseDrag({ x: 41, y: 31 }, { x: 60, y: 40 });
  await p
    .locator(".pro-context-bar")
    .getByRole("button", { name: "Apply transform", exact: true })
    .click();
  moved = (await native(p)).value.document.layers[1];
  assert.ok(Math.abs(moved.transform.scaleX - 2) < 0.001);
  assert.ok(Math.abs(moved.transform.scaleY - 2) < 0.001);
  const anchors = structuredClone(precise);
  Object.assign(anchors.layers[1], {
    width: 128,
    height: 96,
    shape: "path",
    closed: false,
    anchors: [
      { x: 20, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 50 },
    ],
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  });
  await load(p, anchors, source);
  await p.getByRole("button", { name: "Direct select tool", exact: true }).click();
  await mouseDrag({ x: 21, y: 21 }, { x: 60.5, y: 40.5 });
  const anchor = (await native(p)).value.document.layers[1].anchors[0];
  assert.ok(Math.abs(anchor.x - 60) < 0.001);
  assert.ok(Math.abs(anchor.y - 40) < 0.001);
  console.log(
    "Desktop: object movement, off-center Free Transform resizing and direct anchor acquisition match exact native guide coordinates.",
  );
  console.log(
    "Desktop: CRUD/order/history, independent/negative bounds, PNG/JPEG/WebP/SVG, 2× alpha, range downloads, geometric alignment, guides/native source retention passed.",
  );
  await context.close();

  for (const width of [320, 390]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
      acceptDownloads: true,
    });
    const p = await ctx.newPage(),
      source = await start(p);
    await open(p, "Vector");
    const d = fixture();
    d.artboards = [
      {
        id: "mobile",
        name: "Mobile",
        x: 0,
        y: 0,
        width: 128,
        height: 96,
        background: "transparent",
      },
    ];
    d.layers = [
      d.layers[0],
      { ...d.layers[1], transform: { ...d.layers[1].transform, x: 10, y: 10 } },
    ];
    d.layout.snapping = false;
    await load(p, d, source);
    await tab(p, "Artboards");
    await p.getByRole("button", { name: "Fit selected board", exact: true }).click();
    await touch(p, { x: 128, y: 96 }, { x: 144, y: 112 });
    n = await native(p);
    assert.equal(n.value.document.artboards[0].width, 144);
    assert.equal(n.value.document.artboards[0].height, 112);
    assert.deepEqual(n.value.document.layers[1].transform, d.layers[1].transform);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await tab(p, "Artboards");
    await p.getByRole("button", { name: "Fit selected board", exact: true }).click();
    await touch(p, { x: 64, y: 48 }, { x: 79, y: 57 }, true);
    n = await native(p);
    assert.deepEqual(n.value.document.artboards, d.artboards, "cancel rolls back all geometry");
    await tab(p, "Artboards");
    await p.getByRole("button", { name: "Fit selected board", exact: true }).click();
    await touch(p, { x: 64, y: 48 }, { x: 74, y: 58 });
    n = await native(p);
    assert.ok(Math.abs(n.value.document.artboards[0].x - 10) < 0.001);
    assert.ok(Math.abs(n.value.document.artboards[0].y - 10) < 0.001);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await tab(p, "Artboards");
    await p.getByLabel("Move contained artwork with artboard", { exact: true }).check();
    await p.getByLabel("Artboard x", { exact: true }).fill("12");
    n = await native(p);
    assert.equal(n.value.document.layers[1].transform.x, 22);
    // A close-to-grid movement acquires actual screen-space Smart Guides.
    await tab(p, "Precision");
    await p.getByLabel("Enable precision snapping", { exact: true }).check();
    await p.getByLabel("Snap to grid", { exact: true }).check();
    await tab(p, "Artboards");
    await p.getByLabel("Move contained artwork with artboard", { exact: true }).uncheck();
    await p.getByRole("button", { name: "Fit selected board", exact: true }).click();
    await touch(p, { x: 76, y: 48 }, { x: 83, y: 57 }, false, true);
    n = await native(p);
    assert.ok(Number.isFinite(n.value.document.artboards[0].x));
    await tab(p, "Precision");
    await p.getByLabel("New guide position", { exact: true }).fill("50");
    await p.getByRole("button", { name: "Create guide", exact: true }).click();
    n = await native(p);
    assert.equal(n.value.document.layout.guides.length, 1);
    await reopen(p, n);
    await tab(p, "Artboards");
    await exportBoard(p);
    await p.getByRole("button", { name: "Fit selected board", exact: true }).click();
    await preview(p);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(
      await p.locator(".pro-inspector").evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
    );
    assert.equal(await p.evaluate(() => scrollY), 0, "canvas touch does not scroll the page");
    await p.screenshot({ path: `/workspace/screenshots/dc-artboards-${width}.png` });
    const original = (await records(p))[0];
    assert.equal((await records(p)).length, 1);
    await p.getByRole("button", { name: "Save draft", exact: true }).click();
    await p
      .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
      .waitFor();
    await p.reload();
    await open(p, "Vector");
    let restored = await native(p);
    assert.deepEqual(restored.value.document.artboards, n.value.document.artboards);
    assert.deepEqual(restored.value.document.layout, n.value.document.layout);
    await p.getByRole("button", { name: "Apply to chapter", exact: true }).click();
    await p
      .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
        exact: true,
      })
      .waitFor();
    assert.equal((await records(p))[0].original.blobId, original.blobId);
    await p.getByRole("button", { name: "Raster", exact: true }).click();
    restored = await native(p);
    assert.deepEqual(restored.value.document.artboards, n.value.document.artboards);
    await p.getByRole("button", { name: "Vector", exact: true }).click();
    restored = await native(p);
    assert.deepEqual(restored.value.document.layout, n.value.document.layout);
    console.log(
      `${width}px touch: board resize/move/cancel, optional artwork movement, smart guide acquisition/cleanup, precision settings, native reopen/export and overflow passed.`,
    );
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Artboard/precision Chromium suite passed; no browser errors. Touch emulation only, no physical Android claim.",
  );
} finally {
  await browser.close();
}
