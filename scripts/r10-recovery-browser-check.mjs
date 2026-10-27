/** R10 checkpoint transactions, real workers/UI, native recovery and exact pixels.
 * Only isolated synthetic browser profiles and local failure injection are used. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { advancedGradient } from "../src/lib/studio/pro/gradient.ts";
import { advancedEffect } from "../src/lib/studio/pro/effects.ts";
import { defaultOperation } from "../src/lib/studio/pro/color-engine.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
// Negative API/transaction probes require source modules. All unchanged positive
// UI/pixel assertions can also run against the built server in the same run.
const uiBase = process.argv[3] ?? base;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
assert.ok(["127.0.0.1", "localhost"].includes(new URL(uiBase).hostname));
await mkdir("/workspace/r10-evidence", { recursive: true });
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] }),
  errors = [],
  results = [],
  fx = proBrowserFixtures(uiBase, errors);
const hash = (v) => createHash("sha256").update(v).digest("hex");
function semantic(native) {
  const assets = new Map(
    Object.entries(native.assets).map(([id, a]) => [
      id,
      `${a.mime}:${hash(Buffer.from(a.data, "base64"))}`,
    ]),
  );
  const doc = JSON.parse(
    JSON.stringify(native.document, (k, v) => {
      if (k !== "assetId") return v;
      assert.ok(assets.has(v), "every serialized asset reference resolves");
      return assets.get(v);
    }),
  );
  return { document: doc, assets: [...new Set(assets.values())].sort() };
}
async function panels(p) {
  const toggle = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}
async function save(p) {
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector(".pro-save-state")?.getAttribute("data-save-state") === "saved",
  );
  return p.evaluate(async () => {
    const open = (name) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const all = async (name, store) => {
      const db = await open(name);
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(store),
            r = tx.objectStore(store).getAll();
          tx.oncomplete = () => resolve(r.result);
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    };
    const deadline = performance.now() + 45000;
    while (performance.now() < deadline) {
      if ((await indexedDB.databases()).some((db) => db.name === "inkstrip-pro-recovery")) {
        const panels = await all("inkstrip", "panels"),
          id = panels[0].id;
        const s = (await all("inkstrip-pro", "sessions")).find((r) => r.id === id)?.session;
        const entries = (await all("inkstrip-pro-recovery", "headers")).filter(
          (h) => h.panelId === id,
        );
        if (s && entries.some((h) => h.revision === s.revision))
          return {
            revision: s.revision,
            entries,
            invalid: entries.filter((h) => h.version !== 1).length,
          };
      }
      await new Promise(requestAnimationFrame);
    }
    throw Error("Confirmed primary revision did not receive a matching recovery checkpoint.");
  });
}
function artwork() {
  const d = fromPanel({ id: "fixture", name: "Checkpoint artwork", width: 128, height: 96 });
  d.version = 3;
  const base = d.layers[0];
  base.mask = {
    enabled: true,
    strokes: [],
    selection: {
      regions: [
        {
          kind: "ellipse",
          operation: "add",
          points: [
            { x: 4, y: 4 },
            { x: 120, y: 90 },
          ],
        },
      ],
      inverted: false,
      feather: 2,
    },
  };
  base.smartFilters = [
    {
      id: "blur",
      enabled: true,
      operation: { kind: "gaussian", radius: 0.5 },
      mask: {
        enabled: true,
        inverted: false,
        density: 0.8,
        selection: {
          regions: [
            {
              kind: "rectangle",
              operation: "add",
              points: [
                { x: 8, y: 8 },
                { x: 120, y: 90 },
              ],
            },
          ],
          inverted: false,
          feather: 1,
        },
      },
    },
  ];
  const shadow = advancedEffect("dropShadow");
  shadow.radius = 1;
  shadow.distance = 2;
  base.effects = [shadow];
  const adjustment = layer("adjustment", 128, 96, "levels");
  adjustment.adjustmentLayer = { version: 1, operation: defaultOperation("levels") };
  adjustment.opacity = 0.6;
  const fill = layer("gradient", 128, 96, "gradient");
  fill.gradient = advancedGradient();
  fill.opacity = 0.5;
  fill.name = "Editable gradient";
  fill.mask = {
    enabled: true,
    strokes: [],
    selection: {
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 20, y: 15 },
            { x: 100, y: 80 },
          ],
        },
      ],
      inverted: false,
      feather: 0,
    },
  };
  const group = layer("group", 128, 96, "recovery-group");
  group.name = "Recovery group";
  group.mask = {
    enabled: true,
    strokes: [],
    density: 0.9,
    selection: { regions: [], inverted: true, feather: 0 },
  };
  for (const child of [base, adjustment, fill]) child.parentId = group.id;
  adjustment.clipped = true;
  fill.clipped = true;
  d.layers.push(adjustment, fill, group);
  return d;
}
try {
  // Real IndexedDB: checksum failures, atomic interrupted/quota writes and revision conflicts.
  {
    const context = await browser.newContext(),
      p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base);
    const r = await p.evaluate(async () => {
      const { fromPanel } = await import("/src/lib/studio/pro/model.ts");
      const recovery = await import("/src/lib/studio/pro/recovery.ts");
      const { canonicalNative } = await import("/src/lib/studio/pro/adjustment-schema.ts");
      const { saveSession, loadSession } = await import("/src/lib/studio/pro/storage.ts");
      const c = new OffscreenCanvas(8, 8);
      c.getContext("2d").fillRect(0, 0, 8, 8);
      const source = await c.convertToBlob();
      const s = {
        document: fromPanel({ id: "atomic", name: "Confirmed", width: 8, height: 8 }),
        assets: { source },
        revision: 1,
        acceptedBlobId: "accepted",
        updatedAt: 100,
      };
      const cp = await recovery.createCheckpoint(s, "original", 200);
      await recovery.storeCheckpoint(cp);
      const initial = (await recovery.listCheckpoints("atomic")).entries;
      const failures = {};
      const put = IDBObjectStore.prototype.put;
      for (const mode of ["quota", "interrupted"]) {
        IDBObjectStore.prototype.put = function (...args) {
          if (this.transaction.db.name === recovery.CHECKPOINT_DB && this.name === "snapshots") {
            if (mode === "quota")
              throw new DOMException("Injected full storage", "QuotaExceededError");
            const r = put.apply(this, args);
            r.onsuccess = () => this.transaction.abort();
            return r;
          }
          return put.apply(this, args);
        };
        try {
          await recovery.storeCheckpoint(
            await recovery.createCheckpoint({ ...s, revision: 2 }, mode, 201),
          );
          failures[mode] = "UNEXPECTED SUCCESS";
        } catch (e) {
          failures[mode] = e.name + ":" + e.message;
        } finally {
          IDBObjectStore.prototype.put = put;
        }
        const after = (await recovery.listCheckpoints("atomic")).entries;
        if (JSON.stringify(after) !== JSON.stringify(initial))
          throw Error("Interrupted checkpoint changed the valid index");
        const read = await recovery.readCheckpoint("original", "atomic");
        const beforeBytes = new Uint8Array(await source.arrayBuffer()),
          afterBytes = new Uint8Array(await read.session.assets.source.arrayBuffer());
        if (
          beforeBytes.length !== afterBytes.length ||
          beforeBytes.some((b, i) => b !== afterBytes[i])
        )
          throw Error("Original source bytes changed");
      }
      const sha = async (blob) =>
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
      const seal = async (native, id) => {
        const h = { ...cp.header, id, nativeBytes: native.size, nativeSha256: await sha(native) };
        delete h.integritySha256;
        return {
          header: { ...h, integritySha256: await sha(new Blob([canonicalNative(h)])) },
          native,
        };
      };
      for (const mode of [
        "corrupt-bytes",
        "missing-asset",
        "future-native",
        "future-checkpoint",
        "wrong-document",
      ]) {
        let bad = structuredClone(cp);
        bad.header.id = mode;
        if (mode === "corrupt-bytes")
          bad.native = new Blob(["corrupted"], { type: "application/json" });
        else if (mode === "future-checkpoint") bad.header.version = 99;
        else if (mode === "wrong-document") {
          bad = await seal(cp.native, mode);
          bad.header.documentId = "another document";
          const header = { ...bad.header };
          delete header.integritySha256;
          bad.header.integritySha256 = await sha(new Blob([canonicalNative(header)]));
        } else {
          const n = JSON.parse(await cp.native.text());
          if (mode === "missing-asset") n.assets = {};
          else n.version = 999;
          bad = await seal(new Blob([JSON.stringify(n)], { type: "application/json" }), mode);
        }
        try {
          await recovery.storeCheckpoint(bad);
          failures[mode] = "UNEXPECTED SUCCESS";
        } catch (e) {
          failures[mode] = e.message;
        }
      }
      try {
        await recovery.readCheckpoint("original", "another-page");
        failures.wrongPage = "UNEXPECTED SUCCESS";
      } catch (e) {
        failures.wrongPage = e.message;
      }
      const writeHeader = async (header) => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open(recovery.CHECKPOINT_DB);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          await new Promise((resolve, reject) => {
            const tx = db.transaction("headers", "readwrite");
            tx.objectStore("headers").put(header);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      };
      await writeHeader({ ...cp.header, name: "Tampered index metadata" });
      const damaged = await recovery.listCheckpoints("atomic");
      if (damaged.invalid !== 1 || damaged.entries.length !== 0)
        throw Error("Damaged index metadata was offered as valid recovery");
      try {
        await recovery.storeCheckpoint(
          await recovery.createCheckpoint({ ...s, revision: 2 }, "must-not-prune", 201),
        );
        failures.corruptIndex = "UNEXPECTED SUCCESS";
      } catch (e) {
        failures.corruptIndex = e.message;
      }
      await writeHeader(cp.header);
      if ((await recovery.listCheckpoints("atomic")).entries.length !== 1)
        throw Error("Corrupt-index refusal changed valid checkpoint retention");
      const first = await saveSession({ ...s, revision: 0 }, 0);
      const second = await saveSession(
        { ...first, document: { ...first.document, name: "Newer valid revision" } },
        first.revision,
      );
      try {
        await saveSession(
          { ...first, document: { ...first.document, name: "Must not overwrite" } },
          first.revision,
        );
        failures.conflict = "UNEXPECTED SUCCESS";
      } catch (e) {
        failures.conflict = e.message;
      }
      // Observe durable records rather than a separately imported dev singleton:
      // Vite's HMR timestamp URLs can instantiate a second recorder module.
      let latest;
      const deadline = performance.now() + 45000;
      while (performance.now() < deadline) {
        latest = await recovery.listCheckpoints("atomic");
        if (latest.entries.some((h) => h.revision === second.revision)) break;
        await new Promise(requestAnimationFrame);
      }
      const current = await loadSession("atomic");
      const version = async (name) => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open(name);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const v = db.version;
        db.close();
        return v;
      };
      const checkpointDatabaseVersion = await version(recovery.CHECKPOINT_DB),
        primaryDatabaseVersion = await version("inkstrip-pro");
      await new Promise((resolve, reject) => {
        const r = indexedDB.open(recovery.CHECKPOINT_DB, 2);
        r.onsuccess = () => {
          r.result.close();
          resolve();
        };
        r.onerror = () => reject(r.error);
      });
      try {
        await recovery.listCheckpoints("atomic");
        failures.futureCheckpointDatabase = "UNEXPECTED SUCCESS";
      } catch (e) {
        failures.futureCheckpointDatabase = e.name;
      }
      return {
        failures,
        currentName: current.document.name,
        currentRevision: current.revision,
        expectedRevision: second.revision,
        checkpointRevisions: latest.entries.map((h) => h.revision),
        schema: current.document.version,
        checkpointDatabaseVersion,
        primaryDatabaseVersion,
      };
    });
    console.log("Storage probe", JSON.stringify(r));
    for (const [name, message] of Object.entries(r.failures))
      assert.notEqual(message, "UNEXPECTED SUCCESS", name);
    assert.match(r.failures.quota, /QuotaExceededError/);
    assert.match(r.failures["wrong-document"], /identity does not match/);
    assert.match(r.failures.conflict, /Another tab/);
    assert.match(r.failures.corruptIndex, /index integrity verification failed/);
    assert.equal(r.failures.futureCheckpointDatabase, "VersionError");
    assert.equal(r.checkpointDatabaseVersion, 1);
    assert.equal(r.primaryDatabaseVersion, 5);
    assert.equal(r.currentName, "Newer valid revision");
    assert.equal(r.currentRevision, r.expectedRevision);
    assert.ok(r.checkpointRevisions.includes(r.currentRevision));
    results.push({ storageTransactions: true, ...r });
    await context.close();
  }
  for (const width of [1440, 768, 390, 360, 320]) {
    console.log(`R10 recovery at ${width}px`);
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 1000,
        isMobile: width < 1000,
      }),
      p = await context.newPage();
    p.setDefaultTimeout(45000);
    const source = await fx.start(p);
    const chapterUrl = p.url();
    await fx.open(p);
    await panels(p);
    await fx.load(p, artwork(), source);
    await fx.preview(p);
    const first = await save(p);
    assert.equal(first.invalid, 0);
    const cp = first.entries.find((h) => h.revision === first.revision);
    assert.ok(cp, "confirmed save has a native checkpoint");
    const original = (await fx.native(p)).value,
      pixels = await fx.raster(p);
    fx.same(await fx.preview(p), pixels, 0);
    await fx.tab(p, "Properties");
    await p.getByLabel("Layer opacity", { exact: true }).fill("18");
    await p.getByLabel("Layer opacity", { exact: true }).blur();
    await fx.preview(p);
    const newer = await save(p);
    assert.ok(newer.revision > cp.revision);
    const changed = (await fx.native(p)).value,
      changedPixels = await fx.raster(p);
    assert.notDeepEqual(changedPixels.pixels, pixels.pixels);
    await p.getByRole("button", { name: "Recovery checkpoints", exact: true }).click();
    const restore = p.getByRole("button", {
      name: `Restore checkpoint revision ${cp.revision}`,
      exact: true,
    });
    await restore.waitFor();
    p.once("dialog", (d) => d.dismiss());
    await restore.click();
    assert.deepEqual(
      semantic((await fx.native(p)).value),
      semantic(changed),
      "Cancel changes no settings",
    );
    await p.getByRole("button", { name: "Recovery checkpoints", exact: true }).click();
    p.once("dialog", (d) => d.accept());
    await restore.click();
    await p
      .getByText(
        "Checkpoint restored as one undoable action. Original artwork and previous layers remain recoverable.",
        { exact: true },
      )
      .waitFor();
    assert.deepEqual(semantic((await fx.native(p)).value), semantic(original));
    fx.same(await fx.raster(p), pixels, 0);
    fx.same(await fx.preview(p), pixels, 0);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    fx.same(await fx.raster(p), changedPixels, 0);
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    fx.same(await fx.raster(p), pixels, 0);
    await save(p);
    // Real primary-store denials: neither unavailable storage nor quota can report Saved.
    let lastSaved;
    for (const failure of [
      { name: "SecurityError", state: "unavailable", label: "Storage unavailable" },
      { name: "QuotaExceededError", state: "failed", label: "Save failed" },
    ]) {
      await p.evaluate((name) => {
        window.__r10Open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (database, ...args) {
          if (database === "inkstrip-pro")
            throw new DOMException("Injected primary storage failure", name);
          return window.__r10Open.call(this, database, ...args);
        };
      }, failure.name);
      await fx.tab(p, "Properties");
      await p.getByLabel("Pro layer name", { exact: true }).fill(`Recovery retry ${failure.name}`);
      await p.getByRole("button", { name: "Save draft", exact: true }).click();
      await p.waitForFunction(
        (state) =>
          document.querySelector(".pro-save-state")?.getAttribute("data-save-state") === state,
        failure.state,
      );
      assert.equal(await p.locator(".pro-save-state").innerText(), failure.label);
      await p.evaluate(() => {
        IDBFactory.prototype.open = window.__r10Open;
        delete window.__r10Open;
      });
      lastSaved = await save(p);
      assert.equal(
        await p.locator(".pro-alert").count(),
        0,
        "successful retry clears only the previous save error",
      );
    }
    const final = (await fx.native(p)).value,
      finalPixels = await fx.raster(p);
    // Damage only this synthetic checkpoint's Blob; its checksum must prevent any restore.
    const corrupt = lastSaved.entries.find((h) => h.revision === lastSaved.revision);
    await p.evaluate(async (id) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("inkstrip-pro-recovery");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction("snapshots", "readwrite"),
            store = tx.objectStore("snapshots"),
            r = store.get(id);
          r.onsuccess = () =>
            store.put({
              ...r.result,
              native: new Blob(["corrupted checkpoint"], { type: "application/json" }),
            });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, corrupt.id);
    await p.getByRole("button", { name: "Recovery checkpoints", exact: true }).click();
    p.once("dialog", (d) => d.accept());
    await p
      .getByRole("button", { name: `Restore checkpoint revision ${corrupt.revision}`, exact: true })
      .click();
    await p
      .getByRole("region", { name: "Recovery checkpoints", exact: true })
      .getByRole("alert")
      .filter({ hasText: /integrity verification failed/ })
      .waitFor();
    assert.deepEqual(
      semantic((await fx.native(p)).value),
      semantic(final),
      "corrupt recovery cannot modify the current document",
    );
    fx.same(await fx.raster(p), finalPixels, 0);
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true })
      .waitFor({ state: "detached" });
    await p.goto(chapterUrl);
    await fx.open(p);
    await panels(p);
    assert.deepEqual(semantic((await fx.native(p)).value), semantic(final));
    fx.same(await fx.raster(p), finalPixels, 0);
    assert.equal(await p.locator(".pro-save-state").isVisible(), true);
    assert.equal(
      await p.getByRole("button", { name: "Save draft", exact: true }).isVisible(),
      true,
    );
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const overlaps = await p.locator(".pro-header").evaluate((header) => {
      const buttons = [...header.querySelectorAll("button")]
        .map((b) => ({
          name: b.getAttribute("aria-label") || b.textContent.trim(),
          r: b.getBoundingClientRect(),
        }))
        .filter((b) => b.r.width > 0 && b.r.height > 0);
      const overlaps = [];
      for (let a = 0; a < buttons.length; a++)
        for (let b = a + 1; b < buttons.length; b++) {
          const x = buttons[a].r,
            y = buttons[b].r;
          if (
            Math.min(x.right, y.right) > Math.max(x.left, y.left) &&
            Math.min(x.bottom, y.bottom) > Math.max(x.top, y.top)
          )
            overlaps.push([buttons[a].name, buttons[b].name]);
        }
      return overlaps;
    });
    assert.deepEqual(overlaps, [], "save/recovery/studio controls do not overlap at any viewport");
    await p.getByRole("button", { name: "Recovery checkpoints", exact: true }).click();
    await p.screenshot({
      path: `/workspace/screenshots/r10-recovery-${new URL(uiBase).port}-${width}.png`,
    });
    results.push({
      width,
      persistentEditableCheckpoint: true,
      explicitConfirmAndCancel: true,
      undoRedo: true,
      pixelTolerance: 0,
      storageUnavailableAndRetry: true,
      primaryQuotaAndRetry: true,
      corruptedCheckpointRefused: true,
      groupsClippingAndFilterMasks: true,
      saveReopen: true,
      mobileSaveVisible: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { apiBase: base, uiBase, results, errors, pixelTolerance: 0 };
  await writeFile("/workspace/r10-evidence/recovery-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
