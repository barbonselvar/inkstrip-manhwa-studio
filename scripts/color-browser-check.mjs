/** Real-worker forest transforms and editable color regression checks, desktop and native touch emulation. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { TRANSFORM } from "../src/lib/studio/pro/model.ts";
import { QUAD } from "../src/lib/studio/pro/transform.ts";

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
async function pixels(p, x, y) {
  return p.evaluate(
    ({ x, y }) => [
      ...document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        .getContext("2d")
        .getImageData(x, y, 1, 1).data,
    ],
    { x, y },
  );
}
async function pixel(p, x, y, expected) {
  await p
    .waitForFunction(
      ({ x, y, expected }) => {
        const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
        return (
          c?.width === 128 &&
          [...c.getContext("2d").getImageData(x, y, 1, 1).data].every(
            (n, i) => Math.abs(n - expected[i]) <= 1,
          )
        );
      },
      { x, y, expected },
    )
    .catch(async (error) => {
      console.error("Transform pixel mismatch", {
        x,
        y,
        expected,
        actual: await pixels(p, x, y),
        alerts: await p.getByRole("alert").allTextContents(),
      });
      await p.screenshot({ path: "/workspace/screenshots/transform-failure.png" });
      throw error;
    });
}
async function load(p, d, source) {
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
          assets: { source: { mime: "image/png", data: source } },
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
function fixture() {
  return fromPanel({ id: "transform-fixture", name: "Transform fixture", width: 128, height: 96 });
}
const apply = (p) =>
  p.locator(".pro-context-bar").getByRole("button", { name: "Apply transform", exact: true });
const cancel = (p) =>
  p.locator(".pro-context-bar").getByRole("button", { name: "Cancel transform", exact: true });
const begin = async (p) => {
  await p.getByRole("button", { name: "Free Transform tool", exact: true }).click();
  await p.getByLabel("Transform mode", { exact: true }).waitFor();
};
function at(image, x, y) {
  return image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
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
async function imported(p, bytes) {
  await tab(p, "Assets");
  await p
    .getByLabel("Import Pro asset", { exact: true })
    .setInputFiles({ name: "transform.inkstrip", mimeType: "application/json", buffer: bytes });
  await p
    .getByText("Native document imported into this Pro draft. Chapter unchanged.", { exact: true })
    .waitFor();
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
async function colors(p) {
  await tab(p, "Properties");
  const disclosure = p.getByText("Professional color adjustments", { exact: true });
  if (!(await p.getByLabel("Enable Threshold", { exact: true }).isVisible()))
    await disclosure.click();
}
function shape(name, fill, width = 128, height = 96, x = 0, y = 0) {
  const l = layer("shape", width, height, name);
  l.name = name;
  l.fill = fill;
  l.strokeWidth = 0;
  l.transform = { ...TRANSFORM, x, y };
  return l;
}
function groupFixture() {
  const d = fixture();
  d.layers[0].visible = false;
  const g = layer("group", 128, 96, "g"),
    nested = layer("group", 128, 96, "nested"),
    a = shape("Base", "#ff0000", 40, 32, 16, 20),
    b = shape("Clip", "#0000ff", 40, 32, 16, 20);
  g.name = "Outer";
  g.opacity = 0.5;
  nested.parentId = g.id;
  nested.opacity = 0.8;
  a.parentId = b.parentId = nested.id;
  b.clipped = true;
  b.opacity = 0.5;
  a.mask = {
    enabled: true,
    strokes: [],
    selection: {
      regions: [
        {
          kind: "rectangle",
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 32 },
          ],
          operation: "add",
        },
      ],
      inverted: false,
      feather: 0,
    },
  };
  d.layers.push(a, b, nested, g);
  return d;
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await context.newPage(),
    source = await start(p);
  const chapter = (await records(p))[0];
  await open(p);
  await load(p, groupFixture(), source);
  await pixel(p, 25, 30, [128, 0, 128, 102]);
  const initial = await raster(p);
  await begin(p);
  assert.deepEqual(
    await p
      .getByLabel("Transform mode", { exact: true })
      .locator("option")
      .evaluateAll((a) => a.map((o) => o.value)),
    ["affine"],
  );
  await p.getByLabel("Transform X", { exact: true }).fill("26");
  await pixel(p, 45, 30, [128, 0, 128, 102]);
  await cancel(p).click();
  same(await raster(p), initial);
  await begin(p);
  await p.getByLabel("Transform X", { exact: true }).fill("26");
  await p.getByLabel("Transform width", { exact: true }).fill("60");
  // Scaling 1.5 around the aggregate center, then translating 10px: left edge=16, top=12.
  await pixel(p, 40, 30, [128, 0, 128, 102]);
  await apply(p).click();
  let transformed = await raster(p);
  assert.deepEqual(at(transformed, 50, 30), [0, 0, 0, 0]);
  const groupSaved = await native(p);
  assert.equal(groupSaved.value.document.layers.at(-1).kind, "group");
  assert.equal(groupSaved.value.document.layers[2].clipped, true);
  assert.equal(groupSaved.value.document.layers[1].mask.enabled, true);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  same(await raster(p), initial);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  same(await raster(p), transformed);
  await imported(p, groupSaved.bytes);
  same(await raster(p), transformed);
  // A multi-selection across siblings uses the same aggregate box and does not transform a child twice.
  const multi = fixture();
  multi.layers[0].visible = false;
  multi.layers.push(
    shape("One", "#ff0000", 20, 20, 10, 10),
    shape("Two", "#00ff00", 20, 20, 40, 10),
  );
  await load(p, multi, source);
  await tab(p, "Layers");
  await p.getByLabel("Select layer One", { exact: true }).check();
  await begin(p);
  await p.getByLabel("Transform X", { exact: true }).fill("20");
  await apply(p).click();
  let doc = (await native(p)).value.document;
  assert.equal(doc.layers[1].transform.x, 20);
  assert.equal(doc.layers[2].transform.x, 50);
  console.log(
    "Nested/multi-object affine preview, mask/clipping/group opacity, cancel/history/native/export passed.",
  );
  const c = fixture();
  c.layers[0].visible = false;
  const gray = shape("Color sample", "#808080");
  gray.opacity = 0.5;
  c.layers.push(gray);
  await load(p, c, source);
  await pixel(p, 40, 40, [128, 128, 128, 128]);
  await colors(p);
  await p.getByLabel("Enable Threshold", { exact: true }).check();
  await p.getByLabel("Threshold level", { exact: true }).fill("200");
  await pixel(p, 40, 40, [0, 0, 0, 128]);
  await p.getByRole("button", { name: "Reset Threshold", exact: true }).click();
  await pixel(p, 40, 40, [255, 255, 255, 128]);
  await p.getByLabel("Enable Threshold", { exact: true }).uncheck();
  await pixel(p, 40, 40, [128, 128, 128, 128]);
  await p.getByLabel("Enable Channel Mixer", { exact: true }).check();
  await p.getByLabel("Mixer red Red", { exact: true }).fill("0");
  await p.getByLabel("Mixer red Constant", { exact: true }).fill("100");
  await pixel(p, 40, 40, [255, 128, 128, 128]);
  await p.getByRole("button", { name: "Reset professional color", exact: true }).click();
  await p.getByLabel("Enable Color Balance", { exact: true }).check();
  await p.getByLabel("Preserve balance luminance", { exact: true }).uncheck();
  await p.getByLabel("midtones Cyan / Red", { exact: true }).fill("40");
  await pixel(p, 40, 40, [179, 128, 128, 128]);
  await p.getByRole("button", { name: "Reset professional color", exact: true }).click();
  await p.getByLabel("Enable Vibrance", { exact: true }).check();
  await p.getByLabel("Vibrance amount", { exact: true }).fill("-100");
  await pixel(p, 40, 40, [128, 128, 128, 128]);
  await p.getByRole("button", { name: "Reset professional color", exact: true }).click();
  await p.getByLabel("Enable Shadows and Highlights", { exact: true }).check();
  await p.getByLabel("Tonal width", { exact: true }).fill("100");
  await p.getByLabel("Shadow lift", { exact: true }).fill("80");
  assert.ok((await preview(p)).pixels[(40 * 128 + 40) * 4] > 145);
  await p.getByRole("button", { name: "Reset professional color", exact: true }).click();
  await p.getByLabel("Enable Posterize", { exact: true }).check();
  await p.getByLabel("Posterize levels", { exact: true }).fill("2");
  await pixel(p, 40, 40, [255, 255, 255, 128]);
  await p.getByRole("button", { name: "Reset professional color", exact: true }).click();
  // Color stop opacity is real transparency; alpha is multiplied by the existing layer opacity.
  await p.getByLabel("Enable Gradient Map", { exact: true }).check();
  await p.getByLabel("Gradient stop 1 color", { exact: true }).fill("#ff0000");
  await p.getByLabel("Gradient stop 2 color", { exact: true }).fill("#0000ff");
  await p.getByLabel("Gradient stop 2 opacity", { exact: true }).fill("0");
  await pixel(p, 40, 40, [255, 0, 0, 64]);
  await p.getByRole("button", { name: "Add gradient stop", exact: true }).click();
  await p.getByLabel("Gradient stop 2 position", { exact: true }).fill("40");
  await p.getByLabel("Gradient stop 2 color", { exact: true }).fill("#00ff00");
  await p.getByRole("button", { name: "Remove stop 2", exact: true }).click();
  await pixel(p, 40, 40, [255, 0, 0, 64]);
  await p.getByLabel("Gradient preset", { exact: true }).selectOption("Sepia");
  assert.equal(await p.getByLabel("Gradient stop 2 position", { exact: true }).inputValue(), "50");
  await p.getByLabel("Gradient preset", { exact: true }).scrollIntoViewIfNeeded();
  await p.screenshot({ path: "/workspace/screenshots/color-controls-desktop.png" });
  const mapped = await raster(p),
    colorSaved = await native(p);
  assert.equal(colorSaved.value.document.layers[1].kind, "shape");
  assert.equal(colorSaved.value.document.layers[1].color.gradientMap.stops.length, 3);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.notDeepEqual((await raster(p)).pixels, mapped.pixels);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  same(await raster(p), mapped);
  await imported(p, colorSaved.bytes);
  same(await raster(p), mapped);
  same(await preview(p), mapped);
  // Persisted document-space selection captures color coverage; masks and clip blend still apply.
  const masked = fixture();
  masked.layers[0].visible = false;
  const baseLayer = shape("Mask base", "#808080"),
    clip = shape("Color clip", "#000000");
  baseLayer.mask = {
    enabled: true,
    strokes: [],
    selection: {
      regions: [
        {
          kind: "rectangle",
          points: [
            { x: 0, y: 0 },
            { x: 64, y: 96 },
          ],
          operation: "add",
        },
      ],
      inverted: false,
      feather: 0,
    },
  };
  clip.clipped = true;
  clip.blend = "screen";
  clip.color = { threshold: 0 };
  clip.colorSelection = {
    regions: [
      {
        kind: "rectangle",
        points: [
          { x: 16, y: 0 },
          { x: 48, y: 96 },
        ],
        operation: "add",
      },
    ],
    inverted: false,
    feather: 0,
  };
  masked.layers.push(baseLayer, clip);
  await load(p, masked, source);
  await pixel(p, 8, 40, [128, 128, 128, 255]);
  await pixel(p, 32, 40, [255, 255, 255, 255]);
  await pixel(p, 80, 40, [0, 0, 0, 0]);
  const maskOutput = await raster(p),
    maskNative = await native(p);
  await imported(p, maskNative.bytes);
  same(await raster(p), maskOutput);
  await colors(p);
  assert.equal(await p.getByLabel("Limit color to selection", { exact: true }).isChecked(), true);
  await p.getByLabel("Limit color to selection", { exact: true }).uncheck();
  await pixel(p, 8, 40, [255, 255, 255, 255]);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await pixel(p, 8, 40, [128, 128, 128, 255]);
  // Capture an actual document selection through the UI, rather than only importing mask metadata.
  const captured = fixture();
  captured.layers[0].visible = false;
  captured.layers.push(shape("Selection color", "#808080"));
  captured.selection = {
    regions: [
      {
        kind: "rectangle",
        points: [
          { x: 16, y: 0 },
          { x: 48, y: 96 },
        ],
        operation: "add",
      },
    ],
    inverted: false,
    feather: 0,
  };
  await load(p, captured, source);
  await colors(p);
  await p.getByLabel("Enable Threshold", { exact: true }).check();
  await p.getByLabel("Threshold level", { exact: true }).fill("200");
  await p.getByLabel("Limit color to selection", { exact: true }).check();
  await pixel(p, 8, 40, [128, 128, 128, 255]);
  await pixel(p, 32, 40, [0, 0, 0, 255]);
  assert.ok((await native(p)).value.document.layers[1].colorSelection.frame);
  // Native worker minification of a 256px high-frequency texture, rendered into an 8px projective output.
  const checker = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d"),
      image = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const v = (x + y) % 2 ? 255 : 0;
        image.data.set([v, v, v, 255], (y * 256 + x) * 4);
      }
    ctx.putImageData(image, 0, 0);
    return c.toDataURL().split(",")[1];
  });
  const reduction = fromPanel({ id: "minify", name: "Minification", width: 256, height: 256 });
  reduction.width = reduction.height = 8;
  reduction.layers[0].transform = {
    ...TRANSFORM,
    scaleX: 1 / 32,
    scaleY: 1 / 32,
    deform: {
      kind: "perspective",
      width: 256,
      height: 256,
      points: QUAD.map((q, i) => ({ ...q, x: q.x + (i === 2 ? -0.08 : 0) })),
    },
  };
  await load(p, reduction, checker);
  const reduced = await raster(p);
  assert.equal(reduced.width, 8);
  assert.equal(reduced.height, 8);
  for (let y = 1; y < 7; y++)
    for (let x = 1; x < 6; x++) {
      const value = at(reduced, x, y);
      assert.ok(Math.abs(value[0] - 128) <= 2);
      assert.equal(value[3], 255);
    }
  const reducedNative = await native(p);
  await imported(p, reducedNative.bytes);
  same(await raster(p), reduced);
  same(await preview(p), reduced);
  console.log(
    "Captured-selection UI and native worker projective checkerboard downscaling/reopen/export passed.",
  );
  assert.equal((await records(p))[0].blobId, chapter.blobId);
  await p.screenshot({ path: "/workspace/screenshots/color-desktop.png" });
  // Local persistence and Raster/Vector handoff retain the new editable parameters.
  await imported(p, colorSaved.bytes);
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p.getByRole("button", { name: "Open in Vector Studio", exact: true }).waitFor();
  await open(p, "Vector");
  same(await raster(p), mapped);
  assert.equal((await native(p)).value.document.layers[1].color.gradientMap.stops.length, 3);
  await p.getByRole("button", { name: "Apply to chapter", exact: true }).click();
  await p
    .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
      exact: true,
    })
    .waitFor();
  const accepted = (await records(p))[0];
  assert.equal(accepted.original.blobId, chapter.blobId);
  const stored = await p.evaluate(
    async ({ original, current }) => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip");
        r.onsuccess = () => resolve(r.result);
      });
      const read = (id) =>
        new Promise((resolve) => {
          const r = db.transaction("blobs").objectStore("blobs").get(id);
          r.onsuccess = () => resolve(r.result);
        });
      const old = await read(original),
        blob = await read(current),
        bitmap = await createImageBitmap(blob),
        c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      db.close();
      return {
        original: [...new Uint8Array(await old.arrayBuffer())],
        image: {
          width: c.width,
          height: c.height,
          pixels: [...ctx.getImageData(0, 0, c.width, c.height).data],
        },
      };
    },
    { original: accepted.original.blobId, current: accepted.blobId },
  );
  assert.equal(Buffer.from(stored.original).toString("base64"), source);
  same(stored.image, mapped);
  await context.close();
  console.log(
    "Color local save, Raster/Vector reopen and Chapter pixel/original-byte fidelity passed.",
  );
  console.log(
    "Seven color adjustments, numeric/reset controls, opacity stops/presets, mask/selection/blend/clip rendering, native/history/export passed.",
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
    await open(p);
    await load(p, groupFixture(), source);
    await begin(p);
    const touches = await c.newCDPSession(p),
      box = await p.locator('[data-transform-handle="se"]').boundingBox(),
      x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await touches.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    await touches.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 8, y: y + 6, id: 1 }],
    });
    await touches.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.ok(Number(await p.getByLabel("Transform width", { exact: true }).inputValue()) > 40);
    await apply(p).tap();
    assert.equal((await native(p)).value.document.layers.at(-1).kind, "group");
    const d = fixture();
    d.layers[0].visible = false;
    d.layers.push(shape("Mobile color", "#808080"));
    await load(p, d, source);
    await colors(p);
    await p.getByLabel("Enable Threshold", { exact: true }).check();
    await p.getByLabel("Threshold level", { exact: true }).fill("200");
    await pixel(p, 40, 40, [0, 0, 0, 255]);
    await p.getByRole("button", { name: "Reset professional color", exact: true }).tap();
    await pixel(p, 40, 40, [128, 128, 128, 255]);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await p.evaluate(() => scrollY), 0);
    await p.screenshot({ path: `/workspace/screenshots/color-mobile-${width}.png` });
    await c.close();
    console.log(
      `Chromium ${width}px: native touch group handle/Apply, numeric color/reset and no page overflow passed.`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, physicalAndroid: false }));
} finally {
  await browser.close();
}
