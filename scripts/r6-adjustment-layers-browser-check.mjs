/** Real persistent layer UI, worker pixels, IDB/native/project recovery and R3/R5 compatibility. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { ADJUSTMENT_KINDS, canonicalNative } from "../src/lib/studio/pro/adjustment-schema.ts";
import { defaultOperation, processColor } from "../src/lib/studio/pro/color-engine.ts";
import {
  createAdjustmentDraft,
  adjustmentDocument,
} from "../src/lib/studio/pro/adjustment-layer.ts";
import { blendClippedPixels } from "../src/lib/studio/pro/clipping.ts";
import { maskFromSelection } from "../src/lib/studio/pro/masks.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const widths = process.argv.includes("--recovery-only")
    ? []
    : process.argv.includes("--quick")
      ? [1440]
      : [1440, 768, 390, 360, 320],
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  results = [],
  fx = proBrowserFixtures(base, errors);
await mkdir("/workspace/r6-persistent-evidence", { recursive: true });
await mkdir("/workspace/screenshots", { recursive: true });
const same = (a, b) => fx.same(a, b, 0),
  pixel = (a, x, y) => a.pixels.slice((y * a.width + x) * 4, (y * a.width + x) * 4 + 4);
async function number(p, label, value) {
  const n = p.getByLabel(label, { exact: true });
  await n.fill(String(value));
  await n.blur();
}
async function settle(p) {
  await p.waitForFunction(() => {
    const c = document.querySelector('[aria-label="Adjustment composite preview"]'),
      b = [...document.querySelectorAll(".r6-lab button")].find(
        (b) => b.textContent === "Apply adjustment",
      );
    return c?.width === 128 && c.getAttribute("aria-busy") === "false" && b && !b.disabled;
  });
}
async function modal(p, create = false) {
  await fx.tab(p, "Properties");
  await p
    .getByRole("button", {
      name: create ? "New color adjustment" : "Edit adjustment settings",
      exact: true,
    })
    .click();
  await p.getByRole("dialog", { name: "Color adjustment layer", exact: true }).waitFor();
  await settle(p);
}
async function draftPixels(p) {
  return p.getByLabel("Adjustment composite preview", { exact: true }).evaluate((c) => ({
    width: c.width,
    height: c.height,
    pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
  }));
}
async function apply(p) {
  await settle(p);
  const preview = await draftPixels(p);
  await p.getByRole("button", { name: "Apply adjustment", exact: true }).click();
  await p
    .getByRole("dialog", { name: "Color adjustment layer", exact: true })
    .waitFor({ state: "hidden" });
  same(await fx.preview(p), preview);
  return preview;
}
async function command(p, key) {
  await p.locator(".pro-panel-tabs").evaluate((el) => {
    document.activeElement?.blur();
    el.focus();
  });
  await p.keyboard.press(key);
}
async function select(p, id) {
  await fx.tab(p, "Layers");
  await p.locator(`[data-layer-id="${id}"] .pro-layer-select`).click();
}
async function stored(p) {
  return p.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("inkstrip-pro");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const rows = await new Promise((resolve) => {
      const r = db.transaction("sessions").objectStore("sessions").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return rows.map((r) => ({
      document: r.session.document,
      revision: r.session.revision,
      assets: Object.keys(r.session.assets),
    }));
  });
}
async function waitStored(p, id, kind) {
  await p.waitForFunction(
    async ({ id, kind }) => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip-pro");
        r.onsuccess = () => resolve(r.result);
      });
      const rows = await new Promise((resolve) => {
        const r = db.transaction("sessions").objectStore("sessions").getAll();
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      return rows.some((r) =>
        r.session.document.layers.some(
          (l) => l.id === id && l.adjustmentLayer?.operation.kind === kind,
        ),
      );
    },
    { id, kind },
  );
}
try {
  for (const width of widths) {
    console.log(`Persistent R6 ${width}`);
    const context = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
      }),
      p = await context.newPage(),
      source = await fx.start(p);
    await fx.open(p);
    const d = fromPanel({ id: "p", name: "Persistent fixture", width: 128, height: 96 });
    d.selection = {
      regions: [
        {
          kind: "rectangle",
          points: [
            { x: 32, y: 16 },
            { x: 80, y: 64 },
          ],
          operation: "add",
        },
      ],
      inverted: false,
      feather: 0,
    };
    await fx.load(p, d, source);
    const original = await fx.preview(p);
    await fx.tab(p, "History");
    const initialHistory = await p.locator(".pro-history-list li").count();
    // Opening and cancelling a new adjustment publishes neither schema nor settings.
    await modal(p, true);
    same(await draftPixels(p), original);
    await number(p, "Brightness", 20);
    await settle(p);
    assert.deepEqual(pixel(await draftPixels(p), 64, 40), [179, 131, 131, 255]);
    await p.getByRole("button", { name: "Cancel adjustment", exact: true }).click();
    same(await fx.preview(p), original);
    const cancelled = (await fx.native(p)).value;
    assert.equal(cancelled.version, 1);
    assert.equal(cancelled.document.layers.length, 1);
    assert.equal(Object.keys(cancelled.assets).length, 1);
    await fx.tab(p, "History");
    assert.equal(await p.locator(".pro-history-list li").count(), initialHistory);
    // All channel settings are persistent metadata, not a PNG snapshot.
    await modal(p, true);
    assert.deepEqual(
      await p
        .getByLabel("Adjustment or filter", { exact: true })
        .locator("option")
        .evaluateAll((options) => options.map((o) => o.value)),
      [...ADJUSTMENT_KINDS],
    );
    await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("levels");
    await number(p, "Midtone gamma", 1.4);
    await number(p, "Input black", 10);
    await number(p, "Input white", 240);
    await p.getByLabel("Color channel", { exact: true }).selectOption("red");
    await number(p, "Output black", 8);
    await number(p, "Output white", 250);
    await settle(p);
    await p.getByLabel("Compare committed adjustment", { exact: true }).check();
    await p.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Adjustment composite preview"]')
          .getAttribute("aria-busy") === "false",
    );
    same(await draftPixels(p), original);
    await p.getByLabel("Compare committed adjustment", { exact: true }).uncheck();
    const levels = await apply(p);
    let wire = (await fx.native(p)).value;
    assert.equal(wire.version, 8);
    assert.equal(wire.document.version, 2);
    assert.equal(wire.document.layers.length, 2);
    assert.equal(Object.keys(wire.assets).length, 1);
    assert.ok(Object.values(wire.assets).some((a) => a.data === source));
    const id = wire.document.layers[1].id,
      committed = wire.document.layers[1].adjustmentLayer;
    assert.equal(wire.document.layers[0].kind, "raster");
    assert.equal(wire.document.layers[0].visible, true);
    await fx.tab(p, "History");
    assert.equal(await p.locator(".pro-history-list li").count(), initialHistory + 1);
    await modal(p);
    assert.equal(await p.getByLabel("Midtone gamma", { exact: true }).inputValue(), "1.4");
    await p.getByLabel("Color channel", { exact: true }).selectOption("red");
    assert.equal(await p.getByLabel("Output black", { exact: true }).inputValue(), "8");
    assert.equal(await p.getByLabel("Output white", { exact: true }).inputValue(), "250");
    await number(p, "Output white", 180);
    await settle(p);
    await p.getByRole("button", { name: "Reset adjustment", exact: true }).focus();
    await p.keyboard.press("Control+z");
    assert.equal(
      await p.getByRole("dialog", { name: "Color adjustment layer", exact: true }).count(),
      1,
    );
    await p.getByRole("button", { name: "Cancel adjustment", exact: true }).click();
    same(await fx.preview(p), levels);
    wire = (await fx.native(p)).value;
    assert.deepEqual(wire.document.layers[1].adjustmentLayer, committed);
    // Curves remain editable after Apply, auto-save and a real application reload.
    await modal(p);
    await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("curves");
    await p.getByRole("button", { name: "Add curve point", exact: true }).click();
    await number(p, "Curve output", 180);
    await p.getByLabel("Color channel", { exact: true }).selectOption("blue");
    await p.getByRole("button", { name: "Add curve point", exact: true }).click();
    await number(p, "Curve output", 100);
    await settle(p);
    await p.screenshot({ path: `/workspace/screenshots/r6-persistent-${width}.png` });
    const overflow = await p
      .locator(".r6-lab")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false);
    const curves = await apply(p);
    await command(p, "Control+z");
    same(await fx.preview(p), levels);
    await command(p, "Control+Shift+z");
    same(await fx.preview(p), curves);
    await p.waitForFunction(
      () => document.querySelector(".pro-save-state")?.textContent === "Draft saved",
    );
    await waitStored(p, id, "curves");
    const saved = (await fx.native(p)).value;
    await p.reload();
    await fx.open(p);
    console.log(
      "Recovered persistent kind",
      (await stored(p))[0]?.document.layers.find((l) => l.id === id)?.adjustmentLayer?.operation
        .kind,
    );
    same(await fx.preview(p), curves);
    const recovered = (await fx.native(p)).value;
    assert.deepEqual(recovered.document.layers, saved.document.layers);
    assert.equal(Object.keys(recovered.assets).length, 1);
    await modal(p);
    assert.equal(
      await p.getByLabel("Adjustment or filter", { exact: true }).inputValue(),
      "curves",
    );
    await p.getByLabel("Color channel", { exact: true }).selectOption("blue");
    assert.equal(
      await p.getByLabel("Curve control point", { exact: true }).locator("option").count(),
      3,
    );
    await p.getByLabel("Curve control point", { exact: true }).selectOption("1");
    assert.equal(await p.getByLabel("Curve output", { exact: true }).inputValue(), "100");
    await p.getByRole("button", { name: "Cancel adjustment", exact: true }).click();
    // Cancel while a parameter preview is queued; no late worker result may publish it.
    await modal(p);
    await p.getByLabel("Adjustment or filter", { exact: true }).selectOption("exposure");
    await number(p, "Exposure stops", 1.5);
    await number(p, "Exposure stops", -1);
    await p.getByRole("button", { name: "Cancel adjustment", exact: true }).click();
    same(await fx.preview(p), curves);
    assert.deepEqual((await fx.native(p)).value.document.layers, recovered.document.layers);
    // The old storage reader cannot open or overwrite the schema2 recovery draft.
    const fence = await p.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("inkstrip-pro", 3);
          r.onsuccess = () => {
            r.result.close();
            resolve("unsafe-open");
          };
          r.onerror = (e) => {
            e.preventDefault();
            resolve(r.error.name);
          };
        }),
    );
    assert.equal(fence, "VersionError");
    assert.ok(
      (await stored(p)).some((s) =>
        s.document.layers.some(
          (l) => l.id === id && l.adjustmentLayer?.operation.kind === "curves",
        ),
      ),
    );
    // Ordinary layer visibility/opacity and mask controls act on the persistent record.
    const name = saved.document.layers[1].name;
    await select(p, id);
    await p.getByRole("button", { name: `Hide layer ${name}`, exact: true }).click();
    same(await fx.preview(p), original);
    await command(p, "Control+z");
    same(await fx.preview(p), curves);
    await command(p, "Control+Shift+z");
    same(await fx.preview(p), original);
    await p.getByRole("button", { name: `Show layer ${name}`, exact: true }).click();
    same(await fx.preview(p), curves);
    await number(p, "Layer panel opacity", 50);
    const halfOpacity = await fx.preview(p);
    await command(p, "Control+z");
    same(await fx.preview(p), curves);
    await command(p, "Control+Shift+z");
    same(await fx.preview(p), halfOpacity);
    wire = (await fx.native(p)).value;
    assert.equal(wire.document.layers[1].opacity, 0.5);
    assert.deepEqual(
      wire.document.layers[1].adjustmentLayer,
      saved.document.layers[1].adjustmentLayer,
    );
    await fx.tab(p, "Properties");
    const maskSection = p.locator("summary").filter({ hasText: /^Layer mask$/ });
    if (!(await maskSection.evaluate((el) => el.parentElement.open))) await maskSection.click();
    await p.getByRole("button", { name: "Mask from selection", exact: true }).click();
    await select(p, id);
    const masked = await fx.preview(p);
    await command(p, "Control+z");
    same(await fx.preview(p), halfOpacity);
    await command(p, "Control+Shift+z");
    same(await fx.preview(p), masked);
    assert.deepEqual(pixel(masked, 100, 80), pixel(original, 100, 80));
    assert.notDeepEqual(pixel(masked, 64, 40), pixel(original, 64, 40));
    for (let i = 3; i < masked.pixels.length; i += 4)
      assert.equal(masked.pixels[i], original.pixels[i]);
    same(await fx.raster(p), masked);
    wire = (await fx.native(p)).value;
    assert.ok(wire.document.layers[1].mask);
    assert.equal(Object.keys(wire.assets).length, 1);
    await fx.load(p, wire.document, source, wire.assets);
    same(await fx.preview(p), masked);
    // Explicit save and duplicate/delete/Undo keep typed parameters and source assets.
    await p.getByRole("button", { name: "Save draft", exact: true }).click();
    await select(p, id);
    await p.getByRole("button", { name: "Duplicate", exact: true }).click();
    let dup = (await fx.native(p)).value;
    assert.equal(dup.document.layers.length, 3);
    assert.equal(dup.document.layers[2].kind, "adjustment");
    assert.deepEqual(
      dup.document.layers[2].adjustmentLayer,
      wire.document.layers[1].adjustmentLayer,
    );
    assert.notEqual(dup.document.layers[2].id, id);
    await command(p, "Control+z");
    same(await fx.preview(p), masked);
    await command(p, "Control+Shift+z");
    dup = (await fx.native(p)).value;
    await select(p, dup.document.layers[2].id);
    await p.getByRole("button", { name: "Delete", exact: true }).click();
    assert.equal((await fx.native(p)).value.document.layers.length, 2);
    await command(p, "Control+z");
    assert.equal((await fx.native(p)).value.document.layers.length, 3);
    await command(p, "Control+z");
    same(await fx.preview(p), masked);
    if (width === 1440) {
      // Commit each family through the real UI and verify the input artwork is untouched.
      await select(p, id);
      for (const kind of ADJUSTMENT_KINDS) {
        await modal(p);
        await p.getByLabel("Adjustment or filter", { exact: true }).selectOption(kind);
        await apply(p);
        const record = (await fx.native(p)).value;
        assert.equal(record.document.layers[1].adjustmentLayer.operation.kind, kind);
        const input = new Uint8ClampedArray(pixel(original, 64, 40)),
          changed = processColor(input, 1, 1, defaultOperation(kind));
        changed[3] = 255;
        assert.deepEqual(
          pixel(await fx.preview(p), 64, 40),
          [...blendClippedPixels(input, changed, 0.5, "source-over")],
          kind,
        );

        assert.equal(Object.keys(record.assets).length, 1);
        assert.ok(Object.values(record.assets).some((a) => a.data === source));
      }
      await modal(p);
      await p.locator(".r6-lab summary").filter({ hasText: "Presets" }).click();
      await p.getByLabel("Color preset", { exact: true }).selectOption({ label: "Grayscale" });
      await apply(p);
      wire = (await fx.native(p)).value;
      assert.equal(wire.document.layers[1].adjustmentLayer.preset.name, "Grayscale");
      // Corrupt/future native import rejects atomically, preserving current canonical file.
      const prior = await fx.native(p);
      await fx.tab(p, "Assets");
      await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
        {
          name: "future.inkstrip",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify({ ...prior.value, version: 99 })),
        },
      ]);
      await p
        .getByRole("alert")
        .filter({ hasText: /Unsupported native/ })
        .waitFor();
      const after = await fx.native(p);
      assert.ok(after.bytes.equals(prior.bytes));
    }
    results.push({
      width,
      persistentLevelsCurves: true,
      byteExactPreviewApplyCancelUndoRedo: true,
      autosaveReload: true,
      storageFence: true,
      maskOpacity: true,
      nativeExport: true,
      duplicateDelete: true,
      noRasterSnapshots: true,
    });
    await context.close();
  }
  // Noncommuting adjustment order, clipping/group scope, blend, and R5 source transform.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      p = await context.newPage(),
      source = await fx.start(p);
    await fx.open(p);
    let d = fromPanel({ id: "order", name: "Order", width: 128, height: 96 });
    d = adjustmentDocument(
      createAdjustmentDraft(d, d.layers[0].id, "invert"),
      { version: 1, operation: { kind: "invert" } },
      16777216,
    );
    d = adjustmentDocument(
      createAdjustmentDraft(d, "invert", "bright"),
      { version: 1, operation: { kind: "brightnessContrast", brightness: 20, contrast: 0 } },
      16777216,
    );
    await fx.load(p, d, source);
    const ordered = await fx.preview(p);
    assert.deepEqual(pixel(ordered, 64, 40), [178, 226, 226, 255]);
    await select(p, "invert");
    await p.getByRole("button", { name: "Bring layer forward", exact: true }).click();
    const reordered = await fx.preview(p);
    assert.deepEqual(pixel(reordered, 64, 40), [76, 124, 124, 255]);
    await command(p, "Control+z");
    same(await fx.preview(p), ordered);
    await command(p, "Control+Shift+z");
    same(await fx.preview(p), reordered);
    await select(p, d.layers[0].id);
    await p.getByRole("button", { name: "Free Transform tool", exact: true }).click();
    await number(p, "Transform X", 4);
    await p.getByRole("button", { name: "Apply transform", exact: true }).first().click();
    assert.deepEqual(pixel(await fx.preview(p), 68, 40), pixel(reordered, 64, 40));
    await command(p, "Control+z");
    same(await fx.preview(p), reordered);
    const group = layer("group", 128, 96, "g"),
      artwork = d.layers[0],
      adjust = d.layers.find((l) => l.id === "invert"),
      top = layer("shape", 32, 96, "green"),
      outside = layer("shape", 16, 96, "red");
    artwork.parentId = "g";
    adjust.parentId = "g";
    adjust.clipped = true;
    adjust.opacity = 0.5;
    adjust.blend = "multiply";
    adjust.mask = maskFromSelection(
      {
        regions: [
          {
            kind: "rectangle",
            points: [
              { x: 32, y: 16 },
              { x: 80, y: 64 },
            ],
            operation: "add",
          },
        ],
        inverted: false,
        feather: 0,
      },
      adjust,
      d,
    );
    top.parentId = "g";
    top.fill = "#00ff00";
    top.strokeWidth = 0;
    top.transform.x = 96;
    outside.fill = "#ff0000";
    outside.strokeWidth = 0;
    d = { ...d, layers: [group, artwork, adjust, top, outside] };
    await fx.load(p, d, source);
    const grouped = await fx.preview(p);
    assert.deepEqual(pixel(grouped, 64, 40), [96, 67, 67, 255]);
    assert.deepEqual(pixel(grouped, 90, 40), [180, 80, 80, 255]);
    assert.deepEqual(pixel(grouped, 112, 40), [0, 255, 0, 255]);
    assert.deepEqual(pixel(grouped, 8, 40), [255, 0, 0, 255]);
    same(await fx.raster(p), grouped);
    // R3 paint remains editable above the adjustment pipeline.
    const toggle = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
    await p.getByRole("button", { name: "Brush tool", exact: true }).click();
    const r = await fx.artboardBounds(p);
    await p.mouse.move(r.x + r.width * 0.45, r.y + r.height * 0.5);
    await p.mouse.down();
    await p.mouse.move(r.x + r.width * 0.65, r.y + r.height * 0.5, { steps: 5 });
    await p.mouse.up();
    await toggle.click();
    const painted = (await fx.native(p)).value;
    assert.ok(painted.document.layers.some((l) => l.kind === "paint" && l.strokes.length));
    assert.ok(painted.document.layers.some((l) => l.id === "invert" && l.adjustmentLayer));
    // Back up the Chapter with its actual schema2 native session and recover on a fresh origin context.
    await writeFile(
      "/workspace/r6-persistent-evidence/painted-native.json",
      JSON.stringify(painted),
    );
    const paintedPixels = await fx.preview(p),
      paintedExport = await fx.raster(p),
      chapterUrl = p.url();
    // Hold a real IDB write transaction to prove close waits for durable save.
    // Navigation must follow the completed close, never cancel it mid-transaction.
    await p.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("inkstrip-pro");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const original = IDBDatabase.prototype.transaction;
      const transaction = original.call(db, "sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      let active = true;
      const pump = () => {
        const request = store.get("__r6-save-barrier__");
        request.onsuccess = () => {
          if (active) pump();
        };
      };
      pump();
      window.__r6QueuedSaves = 0;
      IDBDatabase.prototype.transaction = function (...args) {
        if (this.name === "inkstrip-pro" && args[1] === "readwrite") window.__r6QueuedSaves++;
        return original.apply(this, args);
      };
      window.__r6ReleaseSave = () => {
        IDBDatabase.prototype.transaction = original;
        active = false;
        db.close();
      };
    });
    try {
      await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
      await p.waitForFunction(() => window.__r6QueuedSaves > 0);
      await p.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(
        await p.locator(".pro-studio").isVisible(),
        true,
        "close must wait for the durable write",
      );
    } finally {
      await p.evaluate(() => window.__r6ReleaseSave());
    }
    await p.locator(".pro-studio").waitFor({ state: "hidden" });
    const durable = (await stored(p)).find((s) => s.document.panelId === painted.document.panelId);
    assert.equal(
      canonicalNative(durable.document.layers),
      canonicalNative(painted.document.layers),
    );
    await p.goto(chapterUrl.slice(0, chapterUrl.indexOf("/c/")));
    const download = p.waitForEvent("download");
    await p.getByRole("button", { name: "Backup", exact: true }).click();
    const backup = await readFile(await (await download).path());
    const recovery = await browser.newContext({
        viewport: { width: 390, height: 900 },
        hasTouch: true,
        isMobile: true,
      }),
      rp = await recovery.newPage();
    rp.setDefaultTimeout(45000);
    rp.on("pageerror", (e) => errors.push(e.message));
    await rp.goto(base);
    await rp.locator('input[accept=".inkstrip-project"]').setInputFiles([
      {
        name: "persistent.inkstrip-project",
        mimeType: "application/octet-stream",
        buffer: backup,
      },
    ]);
    await rp.waitForURL(/\/p\//);
    await rp.goto(chapterUrl);
    await fx.open(rp);
    const recoveredPreview = await fx.preview(rp),
      restored = (await fx.native(rp)).value;
    assert.deepEqual(restored.document.layers, painted.document.layers);
    assert.deepEqual(restored.assets, painted.assets);
    const recoveredExport = await fx.raster(rp);
    const difference = (a, b) => {
      const mismatches = [];
      for (let i = 0; i < a.pixels.length; i++)
        if (a.pixels[i] !== b.pixels[i]) mismatches.push([i, a.pixels[i], b.pixels[i]]);
      return { count: mismatches.length, first: mismatches.slice(0, 20) };
    };
    await writeFile(
      "/workspace/r6-persistent-evidence/recovery-comparison.json",
      JSON.stringify(
        {
          layersExact: true,
          beforePreviewExport: difference(paintedPixels, paintedExport),
          afterPreviewExport: difference(recoveredPreview, recoveredExport),
          previewRoundtrip: difference(paintedPixels, recoveredPreview),
          exportRoundtrip: difference(paintedExport, recoveredExport),
        },
        null,
        2,
      ),
    );
    same(recoveredExport, paintedExport);
    same(recoveredPreview, paintedPixels);
    await rp.getByRole("button", { name: "Save draft", exact: true }).click();
    assert.ok((await stored(rp)).some((s) => s.document.version === 2));
    await recovery.close();
    results.push({
      order: true,
      groupClippingMaskBlend: true,
      unrelatedArtworkUnaffected: true,
      r3Painting: true,
      r5Transform: true,
      chapterBackupFreshContextRecovery: true,
      blockedSaveCloseBarrier: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { passed: true, widths, results, errors, pixelTolerance: 0 };
  console.log(JSON.stringify(report, null, 2));
  await writeFile(
    `/workspace/r6-persistent-evidence/browser${widths.length === 0 ? "-recovery-only" : widths.length < 5 ? "-quick" : ""}.json`,
    JSON.stringify(report, null, 2),
  );
} catch (error) {
  const failures = [];
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      const i = failures.length;
      await page
        .screenshot({ path: `/workspace/r6-persistent-evidence/failure-${i}.png` })
        .catch(() => {});
      failures.push(
        await page
          .evaluate(() => ({
            url: location.href,
            body: document.body.innerText.slice(-5000),
            dialogs: [...document.querySelectorAll('[role="dialog"]')].map((el) => ({
              label: el.getAttribute("aria-labelledby"),
              hidden: el.getAttribute("aria-hidden"),
            })),
          }))
          .catch(() => ({})),
      );
    }
  await writeFile(
    "/workspace/r6-persistent-evidence/browser-failure.json",
    JSON.stringify({ message: error.message, failures }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
