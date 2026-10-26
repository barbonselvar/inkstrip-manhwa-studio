/** Native9 autosave/reload, interrupted-close barrier, fresh-context Chapter backup recovery. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { advancedGradient } from "../src/lib/studio/pro/gradient.ts";
import { advancedEffect } from "../src/lib/studio/pro/effects.ts";
import { canonicalNative } from "../src/lib/studio/pro/adjustment-schema.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const errors = [],
  fx = proBrowserFixtures(base, errors),
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
async function stored(p) {
  return p.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("inkstrip-pro");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
      rows = await new Promise((resolve, reject) => {
        const t = db.transaction("sessions"),
          r = t.objectStore("sessions").getAll();
        t.oncomplete = () => resolve(r.result);
        t.onerror = () => reject(t.error);
      });
    const version = db.version;
    db.close();
    return { version, rows };
  });
}
async function settled(p) {
  await p.waitForFunction(() => {
    const c = document.querySelector('[aria-label="Layer properties composite preview"]'),
      b = [...document.querySelectorAll(".r8-lab button")].find(
        (b) => b.textContent === "Apply layer properties",
      );
    return c?.getAttribute("aria-busy") === "false" && b && !b.disabled;
  });
}
try {
  await mkdir("/workspace/r8-evidence", { recursive: true });
  await mkdir("/workspace/screenshots", { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await context.newPage(),
    source = await fx.start(p);
  await fx.open(p);
  const d = fromPanel({ id: "r8-recovery", name: "R8 recovery", width: 128, height: 96 });
  d.version = 3;
  d.layers[0].visible = false;
  d.styleLight = 45;
  const group = layer("group", 128, 96, "group");
  group.opacity = 0.8;
  const fill = layer("gradient", 128, 96, "fill");
  fill.parentId = "group";
  fill.gradient = {
    ...advancedGradient(),
    kind: "reflected",
    interpolation: "oklab",
    stops: [
      { position: 0, color: "#203d91", opacity: 0.5, midpoint: 0.4 },
      { position: 0.6, color: "#e1b674", opacity: 1, midpoint: 0.7 },
      { position: 1, color: "#a6edda", opacity: 0.7 },
    ],
  };
  fill.transform = { ...fill.transform, x: 3, y: 2, rotation: 5 };
  fill.mask = {
    enabled: true,
    strokes: [],
    density: 0.9,
    selection: {
      regions: [
        {
          kind: "ellipse",
          operation: "add",
          points: [
            { x: 6, y: 6 },
            { x: 120, y: 90 },
          ],
        },
      ],
      inverted: false,
      feather: 1,
    },
  };
  fill.smartFilters = [
    { id: "blur", enabled: true, operation: { kind: "gaussian", radius: 1 } },
    {
      id: "noise",
      enabled: true,
      operation: {
        kind: "grain",
        distribution: "gaussian",
        amount: 5,
        monochrome: false,
        seed: 123,
      },
      mask: {
        enabled: true,
        density: 0.7,
        inverted: false,
        selection: {
          regions: [
            {
              kind: "rectangle",
              operation: "add",
              points: [
                { x: 0, y: 0 },
                { x: 64, y: 96 },
              ],
            },
          ],
          inverted: false,
          feather: 0,
        },
      },
    },
  ];
  const stroke = advancedEffect("stroke");
  stroke.position = "inside";
  stroke.size = 1;
  stroke.fillKind = "gradient";
  stroke.gradient = advancedGradient();
  const bevel = advancedEffect("bevel");
  bevel.opacity = 0.35;
  bevel.globalLight = true;
  const pattern = advancedEffect("patternOverlay");
  pattern.opacity = 0.15;
  fill.effects = [stroke, bevel, pattern];
  const paint = layer("paint", 128, 96, "paint");
  paint.parentId = "group";
  paint.clipped = true;
  paint.strokes = [
    {
      points: [
        { x: 20, y: 60 },
        { x: 90, y: 60 },
      ],
      size: 7,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#0088ff",
      erase: false,
    },
  ];
  const adjustment = layer("adjustment", 128, 96, "adjustment");
  adjustment.parentId = "group";
  adjustment.adjustmentLayer = {
    version: 1,
    operation: { kind: "vibrance", vibrance: 20, saturation: 5 },
  };
  d.layers.push(group, fill, paint, adjustment);
  d.selection = {
    regions: [
      {
        kind: "rectangle",
        operation: "add",
        points: [
          { x: 8, y: 8 },
          { x: 90, y: 80 },
        ],
      },
    ],
    inverted: false,
    feather: 1,
  };
  await fx.load(p, d, source);
  const initial = await fx.preview(p);
  fx.same(initial, await fx.raster(p), 0);
  const original = (await fx.native(p)).value,
    chapterUrl = p.url();
  assert.equal(original.version, 9);
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p.waitForFunction(async () => {
    const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip-pro");
        r.onsuccess = () => resolve(r.result);
      }),
      rows = await new Promise((resolve) => {
        const r = db.transaction("sessions").objectStore("sessions").getAll();
        r.onsuccess = () => resolve(r.result);
      });
    db.close();
    return rows.some(
      (r) =>
        r.session.document.version === 3 &&
        r.session.document.layers.some((l) => l.id === "fill" && l.smartFilters?.length === 2),
    );
  });
  const persisted = await stored(p);
  assert.equal(persisted.version, 5);
  assert.equal(
    canonicalNative(
      persisted.rows.find((r) => r.session.document.layers.some((l) => l.id === "fill")).session
        .document.layers,
    ),
    canonicalNative(original.document.layers),
  );
  const oldReader = await p.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("inkstrip-pro", 4);
        r.onerror = () => resolve(r.error.name);
        r.onsuccess = () => {
          r.result.close();
          resolve("opened");
        };
      }),
  );
  assert.equal(oldReader, "VersionError", "R6/R7 storage writer cannot overwrite schema3 drafts");
  await p.reload();
  await fx.open(p);
  fx.same(await fx.preview(p), initial, 0);
  const reload = (await fx.native(p)).value;
  assert.deepEqual(reload.document.layers, original.document.layers);
  assert.deepEqual(reload.assets, original.assets);
  // Hold an actual read-write transaction before changing settings, then request close.
  await p.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("inkstrip-pro");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
      original = IDBDatabase.prototype.transaction,
      tx = original.call(db, "sessions", "readwrite"),
      store = tx.objectStore("sessions");
    let active = true;
    const pump = () => {
      store.get("__r8-save-barrier__").onsuccess = () => {
        if (active) pump();
      };
    };
    pump();
    window.__r8QueuedSaves = 0;
    IDBDatabase.prototype.transaction = function (...args) {
      if (this.name === "inkstrip-pro" && args[1] === "readwrite") window.__r8QueuedSaves++;
      return original.apply(this, args);
    };
    window.__r8Release = () => {
      IDBDatabase.prototype.transaction = original;
      active = false;
      db.close();
    };
  });
  let saved, pixels, png;
  const encodedExports = {};
  try {
    await fx.tab(p, "Layers");
    await p.locator('[data-layer-id="fill"] .pro-layer-select').click();
    await fx.tab(p, "Properties");
    await p.getByRole("button", { name: "Layer styles and Smart Filters", exact: true }).click();
    const dialog = p.getByRole("dialog", { name: "Layer styles and Smart Filters", exact: true });
    await settled(p);
    await dialog.getByRole("tab", { name: "Gradient", exact: true }).click();
    await dialog.getByLabel("Gradient scale", { exact: true }).fill("125");
    await dialog.getByLabel("Gradient scale", { exact: true }).blur();
    await settled(p);
    await dialog.getByRole("button", { name: "Apply layer properties", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    saved = (await fx.native(p)).value;
    pixels = await fx.preview(p);
    png = await fx.raster(p);
    fx.same(pixels, png, 0);
    for (const mime of ["image/jpeg", "image/webp"])
      encodedExports[mime] = await fx.raster(p, mime);
    assert.equal(saved.document.layers.find((l) => l.id === "fill").gradient.scale, 1.25);
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p.waitForFunction(() => window.__r8QueuedSaves > 0);
    await p.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(
      await p.locator(".pro-studio").isVisible(),
      true,
      "close must wait for the pending native9 commit",
    );
  } finally {
    await p.evaluate(() => window.__r8Release());
  }
  await p.locator(".pro-studio").waitFor({ state: "hidden" });
  const durable = await stored(p);
  assert.equal(
    canonicalNative(
      durable.rows.find((r) => r.session.document.layers.some((l) => l.id === "fill")).session
        .document.layers,
    ),
    canonicalNative(saved.document.layers),
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
  rp.on("pageerror", (e) => errors.push(e.message));
  rp.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await rp.goto(base);
  await rp
    .locator('input[accept=".inkstrip-project"]')
    .setInputFiles([
      { name: "r8.inkstrip-project", mimeType: "application/octet-stream", buffer: backup },
    ]);
  await rp.waitForURL(/\/p\//);
  await rp.goto(chapterUrl);
  await fx.open(rp);
  const recovered = (await fx.native(rp)).value;
  assert.deepEqual(recovered.document.layers, saved.document.layers);
  assert.deepEqual(recovered.assets, saved.assets);
  fx.same(await fx.preview(rp), pixels, 0);
  fx.same(await fx.raster(rp), png, 0);
  for (const mime of ["image/jpeg", "image/webp"])
    fx.same(await fx.raster(rp, mime), encodedExports[mime], 0);
  await rp.getByRole("button", { name: "Save draft", exact: true }).click();
  await rp.waitForFunction(async () => {
    const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip-pro");
        r.onsuccess = () => resolve(r.result);
      }),
      rows = await new Promise((resolve) => {
        const r = db.transaction("sessions").objectStore("sessions").getAll();
        r.onsuccess = () => resolve(r.result);
      });
    db.close();
    return rows.some((r) => r.session.document.version === 3);
  });
  await rp.screenshot({ path: "/workspace/screenshots/r8-recovery-mobile.png" });
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    schema: 3,
    envelope: 9,
    storage: 5,
    legacyWriterRejected: true,
    autosaveReloadExact: true,
    interruptedCloseBarrier: true,
    newSettingsDurable: true,
    freshContextBackupRecoveryExact: true,
    styles: true,
    filterMask: true,
    gradientEditable: true,
    r6Adjustment: true,
    r7SelectionMask: true,
    r3Paint: true,
    r5TransformedLayer: true,
    sourceAssetsExact: true,
    jpegWebpRecoveryExact: true,
    pixelTolerance: 0,
    errors,
  };
  await writeFile("/workspace/r8-evidence/recovery-browser.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await recovery.close();
  await context.close();
} finally {
  await browser.close();
}
