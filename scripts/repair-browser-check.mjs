/** Real worker repair, editable documents and mouse/pen/touch regression tests. No paid inference. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { patchSelection } from "../src/lib/studio/pro/repair.ts";
import { legacyVector } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [];
let marker = 0;
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
  await p.getByPlaceholder("Night Market").fill("Raster repair QA");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await p.getByText("Chapter workspace", { exact: true }).waitFor();
  const source = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const x = c.getContext("2d");
    for (let px = 0; px < 128; px++) {
      const v = 90 + (px % 4) * 8;
      x.fillStyle = `rgb(${v},${v + 10},${v + 20})`;
      x.fillRect(px, 0, 1, 96);
    }
    x.fillStyle = "#000000";
    x.fillRect(60, 44, 8, 8);
    return c.toDataURL().split(",")[1];
  });
  await p
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      { name: "repair.png", mimeType: "image/png", buffer: Buffer.from(source, "base64") },
    ]);
  await p.getByRole("button", { name: "Edit Image repair.png", exact: true }).waitFor();
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
      console.error("Repair pixel mismatch", {
        x,
        y,
        expected,
        actual: await pixels(p, x, y),
        alerts: await p.getByRole("alert").allTextContents(),
      });
      await p.screenshot({ path: "/workspace/screenshots/repair-failure.png" });
      throw error;
    });
}
async function point(p, x, y) {
  const r = await p.locator(".pro-artboard").boundingBox();
  return { x: r.x + (x / 128) * r.width, y: r.y + (y / 96) * r.height };
}
async function click(p, x, y) {
  const q = await point(p, x, y);
  await p.mouse.click(q.x, q.y);
}
async function drag(p, a, b) {
  const x = await point(p, ...a),
    y = await point(p, ...b);
  await p.mouse.move(x.x, x.y);
  await p.mouse.down();
  await p.mouse.move(y.x, y.y, { steps: 12 });
  await p.mouse.up();
}
async function settings(p) {
  await tab(p, "Properties");
  await p.getByLabel("Brush size", { exact: true }).fill("16");
  await p.getByLabel("Brush hardness", { exact: true }).fill("100");
  await p.getByLabel("Brush opacity", { exact: true }).fill("100");
}
async function load(p, d, source) {
  const mark = layer("shape", 1, 1);
  mark.transform.x = 127;
  mark.transform.y = 0;
  mark.strokeWidth = 0;
  const red = ++marker;
  mark.fill = `#${red.toString(16).padStart(2, "0")}00ff`;
  d.layers.splice(1, 0, mark);
  await tab(p, "Assets");
  await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
    {
      name: "repair.inkstrip",
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
  await pixel(p, 127, 0, [red, 0, 255, 255]);
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
  await p.getByRole("button", { name: "Export composite · 128 × 96", exact: true }).click();
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
async function complete(p) {
  await p
    .getByText("Repair complete at native resolution. Undo restores the previous artwork.", {
      exact: true,
    })
    .waitFor();
}
function fixture() {
  return fromPanel({ id: "repair-fixture", name: "Repair fixture", width: 128, height: 96 });
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await context.newPage(),
    source = await start(p);
  const chapter = await records(p);
  await open(p);
  await pixel(p, 64, 48, [0, 0, 0, 255]);
  for (const tool of ["Spot Healing Brush", "Patch Repair", "Healing Brush"]) {
    await load(p, fixture(), source);
    await pixel(p, 64, 48, [0, 0, 0, 255]);
    await p.getByRole("button", { name: `${tool} tool`, exact: true }).click();
    await settings(p);
    if (tool === "Healing Brush") {
      await p.keyboard.down("Alt");
      await click(p, 32, 48);
      await p.keyboard.up("Alt");
      await p
        .getByText(
          "Clone source captured from the visible composite at full document resolution.",
          { exact: true },
        )
        .waitFor();
    }
    if (tool === "Patch Repair") {
      await drag(p, [60, 44], [68, 52]);
      await click(p, 32, 48);
    } else await click(p, 64, 48);
    await complete(p);
    await p
      .waitForFunction(() => {
        const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
        const value = c?.getContext("2d").getImageData(64, 48, 1, 1).data[0];
        return value >= 75 && value <= 130;
      })
      .catch(async (error) => {
        console.error(
          "Repair result",
          await pixels(p, 64, 48),
          await p.getByRole("alert").allTextContents(),
        );
        throw error;
      });
    const repaired = await pixels(p, 64, 48);
    assert.ok(
      repaired[0] >= 75 && repaired[0] <= 130,
      `${tool} repairs the black defect with local texture`,
    );
    await pixel(p, 16, 20, [90, 100, 110, 255]);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await pixel(p, 64, 48, [0, 0, 0, 255]);
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    await pixel(p, 64, 48, repaired);
    const saved = await native(p),
      kind = tool === "Spot Healing Brush" ? "spot" : tool === "Patch Repair" ? "patch" : "heal",
      stroke = saved.value.document.layers.at(-1).strokes.at(-1);
    assert.equal(stroke.repair.kind, kind);
    assert.equal(stroke.repair.algorithm, "spatial-v1");
    assert.ok(stroke.clone.width * stroke.clone.height <= 1_000_000);
    if (kind === "patch") assert.ok(stroke.patch);
    const before = await raster(p);
    for (const mime of ["image/jpeg", "image/webp"]) {
      const image = await raster(p, mime);
      assert.equal(image.width, 128);
      assert.equal(image.height, 96);
      assert.ok(image.pixels[(48 * 128 + 64) * 4] > 65);
    }
    await p.getByRole("button", { name: "Save draft", exact: true }).click();
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await open(p);
    await pixel(p, 64, 48, repaired);
    assert.deepEqual(
      (await raster(p)).pixels,
      before.pixels,
      `${tool} save/reopen preserves exact exported PNG pixels`,
    );
    await tab(p, "Assets");
    await p
      .getByLabel("Import Pro asset", { exact: true })
      .setInputFiles([
        { name: "saved.inkstrip", mimeType: "application/json", buffer: saved.bytes },
      ]);
    await pixel(p, 64, 48, repaired);
    assert.deepEqual(
      (await raster(p)).pixels,
      before.pixels,
      "Native import/remapping retains repair textures",
    );
    await tab(p, "Properties");
    await p.getByLabel("Object x", { exact: true }).fill("21");
    await pixel(p, 85, 48, repaired);
    await pixel(p, 64, 48, [0, 0, 0, 255]);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await pixel(p, 64, 48, repaired);
    assert.deepEqual(await records(p), chapter);
    console.log(
      `${tool}: real defect repair, history, native reopen/import, PNG/JPEG/WebP and chapter isolation PASS`,
    );
  }
  // Exact selection clipping leaves the unselected half of a defect unchanged.
  const selected = fixture();
  selected.selection = patchSelection({ x: 0, y: 0 }, { x: 64, y: 96 }, 0);
  await load(p, selected, source);
  await p.getByRole("button", { name: "Spot Healing Brush tool", exact: true }).click();
  await settings(p);
  await click(p, 64, 48);
  await complete(p);
  await p.waitForFunction(
    () =>
      document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        .getContext("2d")
        .getImageData(62, 48, 1, 1).data[0] > 60,
  );
  await pixel(p, 66, 48, [0, 0, 0, 255]);
  const selectedNative = await native(p);
  assert.ok(selectedNative.value.document.layers.at(-1).strokes[0].clip);
  // A cancelled patch gesture or off-canvas source adds no repair asset or stroke.
  await p.getByRole("button", { name: "Patch Repair tool", exact: true }).click();
  await drag(p, [60, 44], [68, 52]);
  await p.keyboard.press("Escape");
  assert.equal((await native(p)).value.document.layers.at(-1).strokes.length, 1);
  await drag(p, [60, 44], [68, 52]);
  await click(p, 1, 1);
  await p.getByRole("alert").filter({ hasText: "source region must fit" }).waitFor();
  assert.equal((await native(p)).value.document.layers.at(-1).strokes.length, 1);
  // Pressure is a real pen pointer stream, not mouse movement simulated as pressure.
  await load(p, fixture(), source);
  await p.getByRole("button", { name: "Brush tool", exact: true }).click();
  await settings(p);
  await p.getByLabel("Brush color", { exact: true }).fill("#00ff00");
  await p.getByLabel("Brush size", { exact: true }).fill("20");
  await p.getByLabel("Pen pressure size", { exact: true }).check();
  await p.getByLabel("Stroke smoothing", { exact: true }).fill("40");
  const cdp = await context.newCDPSession(p),
    a = await point(p, 24, 72),
    b = await point(p, 96, 72);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...a, pointerType: "pen" });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...a,
    button: "left",
    buttons: 1,
    pointerType: "pen",
    force: 0.2,
  });
  for (let i = 1; i <= 20; i++)
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: a.x + ((b.x - a.x) * i) / 20,
      y: a.y,
      button: "left",
      buttons: 1,
      pointerType: "pen",
      force: 0.2 + (0.7 * i) / 20,
    });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...b,
    button: "left",
    buttons: 0,
    pointerType: "pen",
    force: 0,
  });
  await pixel(p, 28, 72, [0, 255, 0, 255]);
  await pixel(p, 84, 78, [0, 255, 0, 255]);
  assert.notDeepEqual(await pixels(p, 28, 78), [0, 255, 0, 255]);
  const pen = (await native(p)).value.document.layers.at(-1).strokes[0];
  assert.ok(
    pen.points.some((q) => q.pressure <= 0.25) && pen.points.some((q) => q.pressure >= 0.85),
  );
  assert.equal(pen.smoothing, 0.4);
  // Selection clipping also constrains painted layer masks.
  const masked = fixture(),
    paint = layer("paint", 128, 96);
  paint.strokes = [
    {
      points: [
        { x: 0, y: 72 },
        { x: 128, y: 72 },
      ],
      size: 24,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#00ff00",
      erase: false,
    },
  ];
  paint.mask = {
    enabled: true,
    selection: { regions: [], inverted: true, feather: 0 },
    strokes: [],
  };
  masked.layers.push(paint);
  masked.selection = patchSelection({ x: 0, y: 0 }, { x: 64, y: 96 }, 0);
  await load(p, masked, source);
  await tab(p, "Properties");
  await p.getByText("Layer mask", { exact: true }).click();
  await p.getByLabel("Paint layer mask", { exact: true }).check();
  await p.getByRole("button", { name: "Eraser tool", exact: true }).click();
  await p.getByLabel("Brush size", { exact: true }).fill("10");
  await p.getByLabel("Stroke smoothing", { exact: true }).fill("0");
  await drag(p, [32, 72], [96, 72]);
  await pixel(p, 32, 72, [90, 100, 110, 255]);
  await pixel(p, 96, 72, [0, 255, 0, 255]);
  assert.ok((await native(p)).value.document.layers.at(-1).mask.strokes[0].clip);
  await p.screenshot({ path: "/workspace/screenshots/repair-desktop.png" });
  // The visible preview is capped at 1400px; the repair must still use original 2000px coordinates.
  const wideSource = await p.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 2000;
      c.height = 96;
      const x = c.getContext("2d");
      x.fillStyle = "#708090";
      x.fillRect(0, 0, 2000, 96);
      x.fillStyle = "#000000";
      x.fillRect(1600, 44, 8, 8);
      return c.toDataURL().split(",")[1];
    }),
    wide = fromPanel({ id: "wide", name: "Native resolution repair", width: 2000, height: 96 });
  wide.layers.push(layer("paint", 2000, 96));
  await tab(p, "Assets");
  await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
    {
      name: "wide.inkstrip",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "inkstrip-pro",
          version: 1,
          document: wide,
          assets: { source: { mime: "image/png", data: wideSource } },
        }),
      ),
    },
  ]);
  await p.waitForFunction(
    () => document.querySelector('canvas[aria-label="Pro composite preview"]')?.width === 1400,
  );
  await p.getByRole("button", { name: "Spot Healing Brush tool", exact: true }).click();
  await settings(p);
  const wideBoard = await p.locator(".pro-artboard").boundingBox();
  await p.mouse.click(
    wideBoard.x + (1604 / 2000) * wideBoard.width,
    wideBoard.y + (48 / 96) * wideBoard.height,
  );
  await complete(p);
  const wideNative = await native(p),
    wideStroke = wideNative.value.document.layers.at(-1).strokes.at(-1);
  assert.equal(wideStroke.repair.kind, "spot");
  assert.ok(wideStroke.repair.destination.x > 1400);
  assert.ok(
    wideStroke.clone.width < 2000,
    "processed donor textures are cropped, not whole-document duplicates",
  );
  const wideEvent = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export composite · 2000 × 96", exact: true }).click();
  const wideBytes = await readFile(await (await wideEvent).path());
  const widePixel = await p.evaluate(
    async (data) => {
      const b = await createImageBitmap(new Blob([Uint8Array.from(data)], { type: "image/png" })),
        c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      const x = c.getContext("2d");
      x.drawImage(b, 0, 0);
      b.close();
      return { width: c.width, pixel: [...x.getImageData(1604, 48, 1, 1).data] };
    },
    [...wideBytes],
  );
  assert.equal(widePixel.width, 2000);
  assert.deepEqual(widePixel.pixel, [112, 128, 144, 255]);
  await context.close();
  console.log(
    "Selection-aware repairs/mask strokes, invalid-source rollback, patch cancellation and pen pressure/smoothing PASS",
  );
  for (const width of [320, 390]) {
    const c = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: "reduce",
      }),
      p = await c.newPage();
    const originalSource = await start(p);
    const before = await records(p);
    // Vector Studio is hidden from the Chapter workspace until its legacy entry is enabled.
    assert.equal(await p.getByRole("button", { name: "Open in Vector Studio" }).count(), 0);
    await legacyVector(p);
    for (const name of ["Open in Raster Studio", "Open in Vector Studio"]) {
      const entry = p.getByRole("button", { name, exact: true });
      await entry.scrollIntoViewIfNeeded();
      assert.ok(await entry.isVisible());
      assert.ok(await entry.isEnabled());
      const r = await entry.boundingBox();
      assert.ok(r.x >= 0 && r.x + r.width <= width);
    }
    await p.getByRole("button", { name: "Open in Vector Studio", exact: true }).tap();
    await p.getByRole("dialog", { name: "Inkstrip Vector Studio", exact: true }).waitFor();
    await pixel(p, 64, 48, [0, 0, 0, 255]);
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).tap();
    await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).tap();
    await p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true }).waitFor();
    await pixel(p, 64, 48, [0, 0, 0, 255]);
    await p.getByRole("button", { name: "Spot Healing Brush tool", exact: true }).tap();
    await settings(p);
    if (!(await p.locator(".pro-body").evaluate((e) => e.classList.contains("pro-panel-hidden"))))
      await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).tap();
    const q = await point(p, 64, 48);
    await p.touchscreen.tap(q.x, q.y);
    await complete(p);
    await p.waitForFunction(
      () =>
        document
          .querySelector('canvas[aria-label="Pro composite preview"]')
          .getContext("2d")
          .getImageData(64, 48, 1, 1).data[0] > 60,
    );
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await p.getByRole("button", { name: "Pro undo", exact: true }).tap();
    await pixel(p, 64, 48, [0, 0, 0, 255]);
    await p.getByRole("button", { name: "Patch Repair tool", exact: true }).tap();
    const touch = await c.newCDPSession(p),
      ta = await point(p, 60, 44),
      tb = await point(p, 68, 52);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...ta, id: 1 }],
    });
    for (let i = 1; i <= 6; i++)
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: ta.x + ((tb.x - ta.x) * i) / 6, y: ta.y + ((tb.y - ta.y) * i) / 6, id: 1 },
        ],
      });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const sourcePoint = await point(p, 32, 48);
    await p.touchscreen.tap(sourcePoint.x, sourcePoint.y);
    await p.waitForFunction(
      () =>
        document
          .querySelector('canvas[aria-label="Pro composite preview"]')
          .getContext("2d")
          .getImageData(64, 48, 1, 1).data[0] > 60,
    );
    await p.screenshot({ path: `/workspace/screenshots/repair-mobile-${width}.png` });
    await p.getByRole("button", { name: "Apply to chapter", exact: true }).tap();
    await p
      .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
        exact: true,
      })
      .waitFor();
    const after = await records(p);
    assert.notEqual(after[0].blobId, before[0].blobId);
    assert.equal(after[0].original.blobId, before[0].original?.blobId ?? before[0].blobId);
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
    }, after[0].original.blobId);
    assert.equal(
      Buffer.from(originalBytes).toString("base64"),
      originalSource,
      "Original Chapter bytes are retained exactly",
    );
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).tap();
    await p
      .getByRole("button", { name: "Open in Raster Studio", exact: true })
      .waitFor({ state: "visible" });
    await c.close();
    console.log(
      `${width}px: visible Chapter Raster/Vector entries, correct source, touch repair/apply and original retention PASS`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "automatic donor selection",
        "spatial healing",
        "patch regions",
        "pen pressure/smoothing",
        "selection/mask clips",
        "undo/redo",
        "native/export fidelity",
        "mobile Chapter entry/apply",
      ],
    }),
  );
} finally {
  await browser.close();
}
