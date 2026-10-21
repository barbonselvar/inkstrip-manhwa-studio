/** Real-worker gradients, styles and independent adjustments, native/export and touch regression checks. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { TRANSFORM } from "../src/lib/studio/pro/model.ts";
import { defaultEffect } from "../src/lib/studio/pro/effects.ts";

const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(
  ["localhost", "127.0.0.1", "inkstrip-manhwa-studio.vercel.app"].includes(new URL(base).hostname),
);
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
          c.getAttribute("aria-busy") === "false" &&
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

async function effects(p) {
  await tab(p, "Properties");
  if (!(await p.getByLabel("Enable Drop Shadow", { exact: true }).isVisible()))
    await p.getByText("Editable layer effects", { exact: true }).click();
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await context.newPage(),
    source = await start(p);
  const originalChapter = (await records(p))[0];
  await open(p);
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Gradient layer", exact: true }).click();
  await p.getByLabel("Gradient type", { exact: true }).waitFor();
  await pixel(p, 64, 48, [129, 129, 129, 255]);
  await p.getByLabel("Gradient type", { exact: true }).selectOption("radial");
  await pixel(p, 64, 48, [3, 3, 3, 255]);
  await p.getByLabel("Gradient scale", { exact: true }).fill("200");
  await pixel(p, 64, 48, [2, 2, 2, 255]);
  await p.getByLabel("Gradient angle", { exact: true }).fill("90");
  await p.getByLabel("Gradient center X", { exact: true }).fill("25");
  await p.getByLabel("Gradient preset", { exact: true }).selectOption("Cyanotype");
  await p.getByRole("button", { name: "Add gradient stop", exact: true }).click();
  await p.getByLabel("Gradient stop 2 position", { exact: true }).fill("40");
  await p.getByLabel("Gradient stop 2 opacity", { exact: true }).fill("50");
  const gradientImage = await raster(p),
    gradientNative = await native(p);
  assert.equal(gradientNative.value.document.layers[1].kind, "gradient");
  assert.equal(gradientNative.value.document.layers[1].gradient.stops[1].opacity, 0.5);
  await imported(p, gradientNative.bytes);
  same(await raster(p), gradientImage);
  same(await preview(p), gradientImage);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  same(await raster(p), gradientImage);
  for (const mime of ["image/jpeg", "image/webp"]) {
    const out = await raster(p, mime);
    assert.equal(out.width, 128);
    assert.equal(out.height, 96);
    assert.ok(at(out, 64, 48)[3] > 0);
  }
  console.log(
    "Editable linear/radial gradients, color/opacity stops, controls, native/history and PNG/JPEG/WebP passed.",
  );
  const d = fixture();
  d.layers[0].visible = false;
  const base = shape("Styled artwork", "#ff0000", 20, 20, 40, 30);
  base.effects = [{ ...defaultEffect("dropShadow"), radius: 0, distance: 10, angle: 0 }];
  d.layers.push(base);
  await load(p, d, source);
  await pixel(p, 65, 40, [0, 0, 0, 255]);
  await pixel(p, 45, 40, [255, 0, 0, 255]);
  await effects(p);
  await p.getByLabel("Drop Shadow distance", { exact: true }).fill("20");
  await pixel(p, 75, 40, [0, 0, 0, 255]);
  await p.getByLabel("Drop Shadow color", { exact: true }).fill("#0000ff");
  await pixel(p, 75, 40, [0, 0, 255, 255]);
  await p.getByLabel("Enable Color Overlay", { exact: true }).check();
  await p.getByLabel("Color Overlay color", { exact: true }).fill("#00ff00");
  await pixel(p, 45, 40, [0, 255, 0, 255]);
  await p.getByLabel("Enable Stroke", { exact: true }).check();
  await p.getByLabel("Stroke effect size", { exact: true }).fill("3");
  await p.getByLabel("Stroke color", { exact: true }).fill("#ffffff");
  await pixel(p, 38, 40, [255, 255, 255, 255]);
  await p.getByLabel("Stroke effect position", { exact: true }).selectOption("inside");
  await pixel(p, 41, 40, [255, 255, 255, 255]);
  await p.getByRole("button", { name: "Move style later · Color Overlay", exact: true }).click();
  await pixel(p, 41, 40, [0, 255, 0, 255]);
  await p.getByLabel("Enable Gradient Overlay", { exact: true }).check();
  await p.getByLabel("Overlay gradient type", { exact: true }).selectOption("radial");
  assert.notDeepEqual(at(await preview(p), 45, 40), [0, 255, 0, 255]);
  await p.getByLabel("Enable Inner Shadow", { exact: true }).check();
  await p.getByLabel("Inner Shadow distance", { exact: true }).fill("3");
  await p.getByLabel("Enable Inner Glow", { exact: true }).check();
  await p.getByLabel("Enable Outer Glow", { exact: true }).check();
  const styled = await raster(p),
    styledNative = await native(p);
  assert.equal(styledNative.value.document.layers[1].effects.length, 7);
  await imported(p, styledNative.bytes);
  same(await raster(p), styled);
  await effects(p);
  await p.getByRole("button", { name: "Remove all layer effects", exact: true }).click();
  await pixel(p, 75, 40, [0, 0, 0, 0]);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  same(await raster(p), styled);
  // Original geometry outside the document must still cast a shadow into the canvas.
  const outside = fixture();
  outside.layers[0].visible = false;
  const off = shape("Off canvas", "#ff0000", 20, 20, -20, 20);
  off.effects = [
    { ...defaultEffect("dropShadow"), radius: 0, distance: 10, angle: 0, color: "#0000ff" },
  ];
  outside.layers.push(off);
  await load(p, outside, source);
  await pixel(p, 5, 25, [0, 0, 255, 255]);
  // The masked silhouette, rather than the unmasked source rectangle, casts the shadow.
  const maskedStyle = fixture();
  maskedStyle.layers[0].visible = false;
  const maskedArt = shape("Masked style", "#ff0000", 20, 20, 40, 30);
  maskedArt.mask = {
    enabled: true,
    strokes: [],
    selection: {
      regions: [
        {
          kind: "rectangle",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 20 },
          ],
          operation: "add",
        },
      ],
      inverted: false,
      feather: 0,
    },
  };
  maskedArt.effects = [{ ...defaultEffect("dropShadow"), radius: 0, distance: 10, angle: 0 }];
  maskedStyle.layers.push(maskedArt);
  await load(p, maskedStyle, source);
  await pixel(p, 45, 40, [255, 0, 0, 255]);
  await pixel(p, 55, 40, [0, 0, 0, 255]);
  await pixel(p, 65, 40, [0, 0, 0, 0]);
  const blue = shape("Clipped tint", "#0000ff");
  blue.clipped = true;
  maskedStyle.layers.push(blue);
  await load(p, maskedStyle, source);
  await pixel(p, 45, 40, [0, 0, 255, 255]);
  await pixel(p, 55, 40, [0, 0, 255, 255]);
  await pixel(p, 65, 40, [0, 0, 0, 0]);
  same(await raster(p), await preview(p));
  console.log(
    "All seven effects, ordering, live properties, padding beyond source/document edges, native/history and exports passed.",
  );
  // Independent adjustment changes its visible backdrop, then respects alpha, masks and clipping.
  const adjustment = fixture();
  adjustment.layers[0].visible = false;
  const backdrop = shape("Backdrop", "#808080");
  backdrop.opacity = 0.5;
  adjustment.layers.push(backdrop);
  await load(p, adjustment, source);
  await pixel(p, 30, 40, [128, 128, 128, 128]);
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Adjustment layer", exact: true }).click();
  await colors(p);
  await p.getByLabel("Enable Threshold", { exact: true }).check();
  await p.getByLabel("Threshold level", { exact: true }).fill("200");
  await pixel(p, 30, 40, [0, 0, 0, 128]);
  await p.getByLabel("Layer opacity", { exact: true }).fill("50");
  await pixel(p, 30, 40, [64, 64, 64, 128]);
  let adj = (await native(p)).value.document;
  adj.source.assetId = "source";
  adj.layers[0].assetId = "source";
  const last = adj.layers.at(-1);
  assert.equal(last.kind, "adjustment");
  last.opacity = 1;
  last.mask = {
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
  await load(p, adj, source);
  await pixel(p, 30, 40, [0, 0, 0, 128]);
  await pixel(p, 90, 40, [128, 128, 128, 128]);
  const adjusted = await raster(p),
    adjustedNative = await native(p);
  await imported(p, adjustedNative.bytes);
  same(await raster(p), adjusted);
  same(await preview(p), adjusted);
  await colors(p);
  await p.getByRole("button", { name: "Reset professional color", exact: true }).click();
  await pixel(p, 30, 40, [128, 128, 128, 128]);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await pixel(p, 30, 40, [0, 0, 0, 128]);
  // Clipped adjustment targets one isolated base, not the red backdrop or its transparency.
  const clipped = fixture();
  clipped.layers[0].visible = false;
  const red = shape("Red backdrop", "#ff0000"),
    gray = shape("Clip base", "#808080", 40, 40, 30, 30),
    op = layer("adjustment", 128, 96);
  op.clipped = true;
  op.color = { threshold: 200 };
  clipped.layers.push(red, gray, op);
  await load(p, clipped, source);
  await pixel(p, 40, 40, [0, 0, 0, 255]);
  await pixel(p, 90, 40, [255, 0, 0, 255]);
  // A group applies adjustment only to its children; effects and group opacity survive composition.
  const g = layer("group", 128, 96, "g");
  gray.parentId = op.parentId = g.id;
  g.opacity = 0.5;
  clipped.layers.push(g);
  await load(p, clipped, source);
  // Use an independent Canvas reference: Chromium quantizes globalAlpha differently across backends.
  const groupReference = await p.evaluate(() => {
    const c = document.createElement("canvas"),
      g = document.createElement("canvas");
    c.width = g.width = 128;
    c.height = g.height = 96;
    g.getContext("2d").fillRect(30, 30, 40, 40);
    const x = c.getContext("2d");
    x.fillStyle = "#ff0000";
    x.fillRect(0, 0, 128, 96);
    x.globalAlpha = 0.5;
    x.drawImage(g, 0, 0);
    return [...x.getImageData(40, 40, 1, 1).data];
  });
  await pixel(p, 40, 40, groupReference);
  await pixel(p, 90, 40, [255, 0, 0, 255]);
  const mergedBefore = await raster(p);
  await tab(p, "Layers");
  await p.getByRole("button", { name: "Merge visible", exact: true }).click();
  same(await raster(p), mergedBefore);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  same(await raster(p), mergedBefore);
  await imported(p, styledNative.bytes);
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  const final = await raster(p);
  await p.getByRole("button", { name: "Apply to chapter", exact: true }).click();
  await p
    .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
      exact: true,
    })
    .waitFor();
  const chapter = (await records(p))[0];
  assert.equal(chapter.original.blobId, originalChapter.blobId);
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
  }, chapter.original.blobId);
  assert.equal(Buffer.from(originalBytes).toString("base64"), source);
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p.getByRole("button", { name: "Open in Vector Studio", exact: true }).waitFor();
  await open(p, "Vector");
  same(await raster(p), final);
  await p.screenshot({ path: "/workspace/screenshots/appearance-desktop.png" });
  await context.close();
  console.log(
    "Independent adjustment backdrop/opacity/mask/clip/group semantics, merge fidelity, local reopen and Chapter handoff passed.",
  );
  for (const width of [320, 390]) {
    const c = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
      }),
      p = await c.newPage();
    await start(p);
    await open(p);
    await tab(p, "Layers");
    await p.getByRole("button", { name: "Gradient layer", exact: true }).tap();
    await p.getByLabel("Gradient type", { exact: true }).selectOption("radial");
    await pixel(p, 64, 48, [3, 3, 3, 255]);
    await p.getByLabel("Gradient angle", { exact: true }).fill("45");
    await p.getByLabel("Gradient scale", { exact: true }).fill("125");
    await effects(p);
    await p.getByLabel("Enable Color Overlay", { exact: true }).check();
    await p.getByLabel("Color Overlay color", { exact: true }).fill("#00ff00");
    await pixel(p, 64, 48, [0, 255, 0, 255]);
    const file = await native(p);
    await imported(p, file.bytes);
    await pixel(p, 64, 48, [0, 255, 0, 255]);
    await tab(p, "Layers");
    await p.getByRole("button", { name: "Adjustment layer", exact: true }).tap();
    await colors(p);
    await p.getByLabel("Enable Threshold", { exact: true }).check();
    await p.getByLabel("Threshold level", { exact: true }).fill("200");
    await pixel(p, 64, 48, [0, 0, 0, 255]);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await p.evaluate(() => scrollY), 0);
    await p.screenshot({ path: `/workspace/screenshots/appearance-mobile-${width}.png` });
    await c.close();
    console.log(
      `Chromium ${width}px: touch layer creation, radial controls, editable styles, adjustments and native reopen passed.`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, physicalAndroid: false }));
} finally {
  await browser.close();
}
