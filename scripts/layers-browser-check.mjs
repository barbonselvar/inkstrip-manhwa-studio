/** Real full-resolution worker/UI validation. Isolated browser profiles; no cloud inference. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { BLEND_MODES } from "../src/lib/studio/pro/blend.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
async function tab(p, name) {
  await p
    .getByRole("navigation", { name: "Pro panels", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function start(p) {
  p.on("pageerror", (e) => errors.push(e.message));
  p.setDefaultTimeout(30000);
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByPlaceholder("Night Market").fill("Advanced layer QA");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  const data = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const x = c.getContext("2d");
    x.fillStyle = "#c04020";
    x.fillRect(0, 0, 64, 96);
    return c.toDataURL().split(",")[1];
  });
  await p
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      { name: "source.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") },
    ]);
  await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
  await p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true }).waitFor();
  return data;
}
function shape(id, fill, w = 40, h = 32, x = 0, y = 0) {
  const l = layer("shape", w, h, id);
  l.name = id;
  l.fill = fill;
  l.strokeWidth = 0;
  l.transform.x = x;
  l.transform.y = y;
  return l;
}
function document(layers) {
  const d = fromPanel({ id: "fixture", name: "Layers QA", width: 128, height: 96 });
  d.layers = layers;
  return d;
}
async function load(p, d, data) {
  await tab(p, "Assets");
  await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
    {
      name: "test.inkstrip",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "inkstrip-pro",
          version: 1,
          document: d,
          assets: { source: { mime: "image/png", data } },
        }),
      ),
    },
  ]);
  await p
    .getByText("Native document imported into this Pro draft. Chapter unchanged.", { exact: true })
    .waitFor();
  await p.waitForFunction(
    () => document.querySelector('canvas[aria-label="Pro composite preview"]')?.width > 0,
  );
}
async function native(p) {
  await tab(p, "Export");
  const ev = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export editable .inkstrip", exact: true }).click();
  return JSON.parse(await readFile(await (await ev).path(), "utf8"));
}
async function values(p, x, y, expected) {
  await p.waitForFunction(
    ({ x, y, expected }) => {
      const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
      return (
        c &&
        c.width === 128 &&
        [...c.getContext("2d").getImageData(x, y, 1, 1).data].every(
          (v, i) => Math.abs(v - expected[i]) <= 1,
        )
      );
    },
    { x, y, expected },
  );
}
async function preview(p) {
  await p.waitForFunction(
    () =>
      document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        ?.getAttribute("aria-busy") === "false",
  );
  return p
    .locator('canvas[aria-label="Pro composite preview"]')
    .evaluate((c) => [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data]);
}
function samePixels(a, b, tolerance = 1) {
  assert.equal(a.length, b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++)
    if (i % 4 === 3 || a[i - (i % 4) + 3] || b[i - (i % 4) + 3])
      max = Math.max(max, Math.abs(a[i] - b[i]));
  if (max > tolerance) {
    const changed = [];
    for (let i = 0; i < a.length && changed.length < 8; i += 4)
      if (a.slice(i, i + 4).some((n, j) => Math.abs(n - b[i + j]) > tolerance))
        changed.push({ pixel: i / 4, before: a.slice(i, i + 4), after: b.slice(i, i + 4) });
    console.error({ max, changed });
  }
  assert.ok(max <= tolerance, `Pixel difference ${max} exceeds ${tolerance}`);
}
async function selected(p, ids) {
  await tab(p, "Layers");
  await p.locator(".pro-layer-select").filter({ hasText: ids[0] }).click();
  for (const id of ids.slice(1)) await p.getByLabel(`Select layer ${id}`, { exact: true }).check();
}
async function merged(p, name) {
  await tab(p, "Layers");
  await p.getByRole("button", { name, exact: true }).click();
  await p
    .getByRole("button", { name: "Cancel rendering", exact: true })
    .waitFor({ state: "hidden" });
  await p
    .getByText("Layers merged at native resolution. Undo restores the editable layer stack.", {
      exact: true,
    })
    .waitFor();
}
try {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await c.newPage(),
    data = await start(p);
  console.log("Testing fractional-alpha multi-clipping, masks and exact export pixels…");
  const baseLayer = shape("Alpha base", "#ff0000", 48, 40, 16, 16);
  baseLayer.opacity = 0.5;
  baseLayer.mask = {
    enabled: true,
    strokes: [],
    selection: {
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 0, y: 0 },
            { x: 24, y: 40 },
          ],
        },
      ],
      inverted: false,
      feather: 0,
    },
  };
  const blue = shape("Blue clip", "#0000ff", 128, 96);
  blue.clipped = true;
  blue.opacity = 0.5;
  const green = shape("Green clip", "#00ff00", 128, 96);
  green.clipped = true;
  green.opacity = 0.5;
  await load(p, document([baseLayer, blue, green]), data);
  await values(p, 24, 24, [64, 128, 64, 128]);
  await values(p, 48, 24, [0, 0, 0, 0]);
  await values(p, 4, 4, [0, 0, 0, 0]);
  await tab(p, "Layers");
  await p.waitForFunction(() => document.querySelectorAll("img.pro-layer-thumb").length === 3);
  await p.getByRole("button", { name: "Hide layer Alpha base", exact: true }).click();
  await values(p, 24, 24, [0, 0, 0, 0]);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await values(p, 24, 24, [64, 128, 64, 128]);
  await selected(p, ["Green clip"]);
  await p.getByRole("button", { name: "Release clipping mask", exact: true }).click();
  await values(p, 4, 4, [0, 255, 0, 128]);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await values(p, 4, 4, [0, 0, 0, 0]);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  await values(p, 4, 4, [0, 255, 0, 128]);
  await p.getByRole("button", { name: "Create clipping mask", exact: true }).click();
  await values(p, 24, 24, [64, 128, 64, 128]);
  const before = await preview(p);
  await tab(p, "Export");
  for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
    await p.getByLabel("Pro export format", { exact: true }).selectOption(mime);
    const ev = p.waitForEvent("download");
    await p.getByRole("button", { name: "Export composite · 128 × 96", exact: true }).click();
    const bytes = await readFile(await (await ev).path());
    const decoded = await p.evaluate(
      async ({ bytes, mime }) => {
        const image = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: mime })),
          c = document.createElement("canvas");
        c.width = image.width;
        c.height = image.height;
        const x = c.getContext("2d");
        x.drawImage(image, 0, 0);
        const sample = [...x.getImageData(24, 24, 1, 1).data],
          outside = [...x.getImageData(4, 4, 1, 1).data];
        image.close();
        return { w: c.width, h: c.height, sample, outside };
      },
      { bytes: [...bytes], mime },
    );
    assert.deepEqual([decoded.w, decoded.h], [128, 96]);
    if (mime === "image/png") assert.deepEqual(decoded.sample, [64, 128, 64, 128]);
    if (mime === "image/jpeg") {
      assert.equal(decoded.sample[3], 255);
      assert.ok(decoded.sample.slice(0, 3).every((v, i) => Math.abs(v - [159, 191, 159][i]) <= 8));
      assert.ok(decoded.outside.slice(0, 3).every((v) => v >= 250));
    } else {
      assert.equal(decoded.outside[3], 0);
      assert.equal(decoded.sample[3], 128);
      assert.ok(decoded.sample.slice(0, 3).every((v, i) => Math.abs(v - [64, 128, 64][i]) <= 8));
    }
  }
  await selected(p, ["Alpha base", "Blue clip", "Green clip"]);
  await merged(p, "Merge selected");
  samePixels(before, await preview(p));
  let n = await native(p);
  assert.equal(n.document.layers.length, 1);
  assert.equal(n.document.layers[0].kind, "raster");
  const mergedAsset = n.document.layers[0].assetId;
  assert.ok(n.assets[mergedAsset]);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  samePixels(before, await preview(p));
  assert.equal((await native(p)).document.layers.length, 3);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  samePixels(before, await preview(p));
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p.getByText("Draft saved", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p.reload();
  await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
  await values(p, 24, 24, [64, 128, 64, 128]);
  assert.equal((await native(p)).document.layers[0].assetId, mergedAsset);
  console.log("Testing clipping blend modes against an independent Canvas backdrop reference…");
  for (const mode of BLEND_MODES) {
    const baseCopy = structuredClone(baseLayer),
      clipCopy = structuredClone(blue);
    baseCopy.blend = "multiply";
    clipCopy.blend = mode;
    await load(p, document([shape("Backdrop", "#204060", 128, 96), baseCopy, clipCopy]), data);
    const expected = await p.evaluate((mode) => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const x = c.getContext("2d");
      x.fillStyle = "#ff0000";
      x.fillRect(0, 0, 1, 1);
      x.globalCompositeOperation = mode;
      x.globalAlpha = 0.5;
      x.fillStyle = "#0000ff";
      x.fillRect(0, 0, 1, 1);
      const rgb = [...x.getImageData(0, 0, 1, 1).data];
      x.globalAlpha = 1;
      x.globalCompositeOperation = "source-over";
      x.fillStyle = "#204060";
      x.fillRect(0, 0, 1, 1);
      x.globalAlpha = 0.5;
      x.globalCompositeOperation = "multiply";
      x.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      x.fillRect(0, 0, 1, 1);
      return [...x.getImageData(0, 0, 1, 1).data];
    }, mode);
    await values(p, 24, 24, expected);
    await values(p, 90, 60, [32, 64, 96, 255]);
  }
  console.log("Testing raster, painted, text and transformed group clipping bases…");
  const r = layer("raster", 128, 96, "raster-base");
  r.assetId = "source";
  r.name = "Raster base";
  const fill = shape("Raster clip", "#00ff00", 128, 96);
  fill.clipped = true;
  await load(p, document([r, fill]), data);
  await values(p, 16, 20, [0, 255, 0, 255]);
  await values(p, 90, 20, [0, 0, 0, 0]);
  const paint = layer("paint", 128, 96, "paint");
  paint.name = "Paint base";
  paint.strokes = [
    {
      points: [
        { x: 32, y: 32 },
        { x: 48, y: 32 },
      ],
      size: 20,
      opacity: 0.5,
      flow: 1,
      hardness: 1,
      color: "#ff0000",
      erase: false,
    },
  ];
  await load(p, document([paint, fill]), data);
  await values(p, 40, 32, [0, 255, 0, 128]);
  await values(p, 80, 32, [0, 0, 0, 0]);
  const text = layer("text", 128, 64, "text");
  text.name = "Text base";
  text.text = "INK";
  text.fontSize = 40;
  text.fill = "#ff0000";
  text.strokeWidth = 0;
  await load(p, document([text, fill]), data);
  await p.waitForFunction(() => {
    const a = document
      .querySelector('canvas[aria-label="Pro composite preview"]')
      .getContext("2d")
      .getImageData(0, 0, 128, 96).data;
    let painted = 0;
    for (let i = 0; i < a.length; i += 4)
      if (a[i + 3]) {
        if (a[i] > 1 || a[i + 1] < 250 || a[i + 2] > 1) return false;
        painted++;
      }
    return painted > 100;
  });
  const g = layer("group", 128, 96, "g");
  g.name = "Clipped group base";
  g.opacity = 0.5;
  const ellipse = shape("Ellipse child", "#ff0000", 40, 24, 40, 32);
  ellipse.shape = "ellipse";
  ellipse.transform.rotation = 20;
  ellipse.opacity = 0.5;
  ellipse.parentId = "g";
  const clipGroup = layer("group", 128, 96, "cg");
  clipGroup.name = "Clip group";
  clipGroup.clipped = true;
  const gc = shape("Group green", "#00ff00", 128, 96);
  gc.parentId = "cg";
  await load(p, document([g, ellipse, clipGroup, gc]), data);
  await values(p, 54, 44, [0, 255, 0, 64]);
  await values(p, 2, 2, [0, 0, 0, 0]);
  const grouped = await preview(p);
  await selected(p, ["Clipped group base", "Clip group"]);
  await merged(p, "Merge selected");
  samePixels(grouped, await preview(p));
  console.log(
    "Testing multi-selection, links, locking, recursive duplication and group management…",
  );
  const a = shape("A layer", "#ff0000", 24, 24, 0, 0),
    b = shape("B layer", "#00ff00", 24, 24, 32, 0),
    top = shape("C layer", "#0000ff", 24, 24, 64, 0),
    d = document([a, b, top]);
  await load(p, d, data);
  await selected(p, ["A layer", "B layer"]);
  await p.getByRole("button", { name: "Link layers", exact: true }).click();
  await p.waitForFunction(() => document.querySelectorAll("img.pro-layer-thumb").length === 3);
  await p.locator(".pro-panel-content").evaluate((el) => (el.scrollTop = 0));
  await p.screenshot({ path: "/workspace/screenshots/inkstrip-advanced-layer-panel.png" });
  n = await native(p);
  assert.ok(n.document.layers[0].linkId);
  assert.equal(n.document.layers[0].linkId, n.document.layers[1].linkId);
  await tab(p, "Properties");
  await p.getByLabel("Object x", { exact: true }).fill("10");
  await p.getByLabel("Object x", { exact: true }).press("Tab");
  n = await native(p);
  assert.deepEqual(
    n.document.layers.map((l) => l.transform.x),
    [10, 42, 64],
  );
  await selected(p, ["B layer"]);
  await p.getByRole("button", { name: "Lock layer B layer", exact: true }).click();
  await selected(p, ["A layer"]);
  await tab(p, "Properties");
  await p.getByLabel("Object x", { exact: true }).fill("20");
  await p.getByLabel("Object x", { exact: true }).press("Tab");
  await p.getByRole("alert").filter({ hasText: "Unlock" }).waitFor();
  n = await native(p);
  assert.deepEqual(
    n.document.layers.map((l) => l.transform.x),
    [10, 42, 64],
  );
  await selected(p, ["B layer"]);
  await p.getByRole("button", { name: "Unlock layer B layer", exact: true }).click();
  await selected(p, ["A layer"]);
  await p.getByRole("button", { name: "Unlink layers", exact: true }).click();
  n = await native(p);
  assert.ok(n.document.layers.every((l) => !l.linkId));
  await selected(p, ["A layer", "B layer"]);
  await p.getByRole("button", { name: "Group selected", exact: true }).click();
  n = await native(p);
  const group = n.document.layers.find((l) => l.kind === "group");
  assert.ok(group);
  assert.equal(n.document.layers.filter((l) => l.parentId === group.id).length, 2);
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Duplicate", exact: true }).click();
  n = await native(p);
  assert.equal(n.document.layers.filter((l) => l.kind === "group").length, 2);
  assert.equal(n.document.layers.length, 7);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await tab(p, "Layers");
  await p.locator(".pro-layer-select").filter({ hasText: "Layer group" }).click();
  await p.getByRole("button", { name: "Ungroup", exact: true }).click();
  assert.equal((await native(p)).document.layers.length, 3);
  await selected(p, ["A layer"]);
  await p.locator('[data-layer-id="' + a.id + '"]').click({ button: "right" });
  await p.getByRole("menuitem", { name: "Duplicate selected", exact: true }).click();
  assert.equal((await native(p)).document.layers.length, 4);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await selected(p, ["A layer"]);
  await p.getByRole("button", { name: "Duplicate", exact: true }).focus();
  await p.keyboard.press("Space");
  assert.equal((await native(p)).document.layers.length, 4);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await selected(p, ["A layer"]);
  await p
    .getByRole("button", { name: "Drag layer A layer", exact: true })
    .dragTo(p.locator('[data-layer-id="' + top.id + '"]'));
  n = await native(p);
  assert.equal(n.document.layers.at(-1).id, a.id);
  console.log("Testing selected/visible/flatten fidelity, hidden retention and failure safety…");
  await load(p, d, data);
  const original = await preview(p);
  await selected(p, ["A layer", "B layer"]);
  await merged(p, "Merge selected");
  samePixels(original, await preview(p));
  n = await native(p);
  assert.equal(n.document.layers.length, 2);
  assert.equal(n.document.layers[1].id, top.id);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  samePixels(original, await preview(p));
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Hide layer C layer", exact: true }).click();
  const hiddenBefore = await native(p),
    visiblePixels = await preview(p);
  await merged(p, "Merge visible");
  samePixels(visiblePixels, await preview(p));
  n = await native(p);
  assert.ok(n.document.layers.some((l) => l.id === top.id && !l.visible));
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.deepEqual((await native(p)).document, hiddenBefore.document);
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Flatten image…", exact: true }).click();
  await p.getByRole("alertdialog", { name: "Flatten this image?", exact: true }).waitFor();
  await p.getByRole("button", { name: "Keep layers", exact: true }).click();
  assert.deepEqual((await native(p)).document, hiddenBefore.document);
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Flatten image…", exact: true }).click();
  await p.getByRole("button", { name: "Flatten now", exact: true }).click();
  await p
    .getByText("Layers merged at native resolution. Undo restores the editable layer stack.", {
      exact: true,
    })
    .waitFor();
  samePixels(visiblePixels, await preview(p));
  assert.equal((await native(p)).document.layers.length, 1);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.deepEqual((await native(p)).document, hiddenBefore.document);
  b.blend = "multiply";
  await load(p, d, data);
  const protectedDoc = await native(p);
  await selected(p, ["B layer", "C layer"]);
  await p.getByRole("button", { name: "Merge selected", exact: true }).click();
  await p.getByRole("alert").filter({ hasText: "backdrop" }).waitFor();
  assert.deepEqual((await native(p)).document, protectedDoc.document);
  const blended = await preview(p);
  await merged(p, "Merge visible");
  samePixels(blended, await preview(p));
  console.log("Testing actual native-resolution merge cancellation with unchanged metadata…");
  const large = document(
    Array.from({ length: 16 }, (_, i) =>
      shape(`Heavy layer ${i}`, i % 2 ? "#203040" : "#708090", 4000, 4000),
    ),
  );
  large.width = large.height = 4000;
  await load(p, large, data);
  const cancelBefore = await native(p);
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Merge visible", exact: true }).click();
  await p.getByRole("button", { name: "Cancel rendering", exact: true }).click();
  await p.getByText("Rendering cancelled. Document retained.", { exact: true }).waitFor();
  assert.deepEqual((await native(p)).document, cancelBefore.document);
  await load(p, d, data);
  await tab(p, "Layers");
  await p.locator(".pro-panel-content").evaluate((el) => (el.scrollTop = 0));
  await p.screenshot({ path: "/workspace/screenshots/inkstrip-advanced-layers-desktop.png" });
  await c.close();
  for (const width of [320, 390]) {
    console.log(`Testing native touch layer reorder and multi-select at ${width}px…`);
    const context = await browser.newContext({
        viewport: { width, height: 844 },
        hasTouch: true,
        isMobile: true,
      }),
      p = await context.newPage(),
      src = await start(p);
    await load(
      p,
      document([
        shape("A touch", "#ff0000"),
        shape("B touch", "#00ff00"),
        shape("C touch", "#0000ff"),
      ]),
      src,
    );
    await selected(p, ["A touch"]);
    const handle = p.getByRole("button", { name: "Drag layer A touch", exact: true });
    await handle.scrollIntoViewIfNeeded();
    const target = p.locator('[data-layer-id="C touch"]');
    await target.scrollIntoViewIfNeeded();
    await handle.scrollIntoViewIfNeeded();
    const hb = await handle.boundingBox();
    const client = await context.newCDPSession(p);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }],
    });
    const tr = await target.boundingBox();
    for (let i = 1; i <= 12; i++)
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: hb.x + hb.width / 2,
            y: hb.y + hb.height / 2 + ((tr.y + 5 - hb.y - hb.height / 2) * i) / 12,
          },
        ],
      });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    n = await native(p);
    assert.equal(n.document.layers.at(-1).name, "A touch");
    await selected(p, ["A touch", "B touch"]);
    assert.equal(await p.getByText("2 selected", { exact: true }).count(), 1);
    await p.getByRole("button", { name: "Link layers", exact: true }).click();
    await p.getByRole("button", { name: "Save draft", exact: true }).click();
    await p.getByText("Draft saved", { exact: true }).waitFor();
    const saved = await native(p);
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p.reload();
    await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
    assert.deepEqual((await native(p)).document, saved.document);
    await selected(p, ["A touch"]);
    const grip = p.getByRole("button", { name: "Drag layer A touch", exact: true });
    await grip.scrollIntoViewIfNeeded();
    const r = await grip.boundingBox();
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: r.x + r.width / 2, y: r.y - 25 }],
    });
    await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    assert.deepEqual((await native(p)).document, saved.document);
    await tab(p, "Layers");
    await p.waitForFunction(() => document.querySelectorAll("img.pro-layer-thumb").length === 3);
    await p.screenshot({ path: `/workspace/screenshots/inkstrip-advanced-layers-${width}.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "fractional alpha clipping and multiple clips",
        "transformed masks/groups/raster/paint/text bases",
        "native save/reopen and merged assets",
        "PNG/JPEG/WebP export pixels",
        "links and locked movement",
        "recursive duplicate/group/ungroup",
        "desktop context menu/drag",
        "native touch reorder at320/390",
        "selected/visible/flatten undo redo",
        "hidden layer retention",
        "backdrop-dependent merge rejection",
      ],
    }),
  );
} finally {
  await browser.close();
}
