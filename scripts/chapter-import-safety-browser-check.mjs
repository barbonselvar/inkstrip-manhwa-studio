/** R1.1 actual Chapter import/storage/decoding. Source-module target: local DEV only.
 * Decoder delays and quota failures are explicitly injected failure-boundary tests;
 * normal imports, pixel decoding and all IndexedDB transactions are real. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const results = [],
  errors = [];
const file = async (name, fixture = "original.png", mimeType = "image/png") => ({
  name,
  mimeType,
  buffer: await readFile(`src/lib/studio/fixtures/import/${fixture}`),
});
async function idle(p) {
  await p.evaluate(async () => {
    if (window.__r11Store) return;
    const candidates = performance
      .getEntriesByType("resource")
      .filter((x) => new URL(x.name).pathname === "/src/lib/studio/store.ts");
    for (const entry of candidates) {
      const store = (await import(entry.name)).useStudio;
      if (
        store.getState().ready &&
        store.getState().chapters.some((c) => location.pathname.endsWith(c.id))
      ) {
        window.__r11Store = store;
        return;
      }
    }
    throw Error("Could not identify the loaded Chapter store module");
  });
  await p.waitForFunction(() => window.__r11Store.getState().job === null);
}
async function snapshot(p) {
  await idle(p);
  return p.evaluate(async () => {
    const { openDb } = await import("/src/lib/studio/db.ts"),
      db = await openDb();
    const tx = db.transaction(["projects", "chapters", "panels", "blobs"]);
    const get = (r) =>
      new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const [projects, chapters, panels, keys] = await Promise.all([
      get(tx.objectStore("projects").getAll()),
      get(tx.objectStore("chapters").getAll()),
      get(tx.objectStore("panels").getAll()),
      get(tx.objectStore("blobs").getAllKeys()),
    ]);
    return { projects, chapters, panels, keys };
  });
}
async function input(p, files) {
  await p.locator('input[type="file"]').first().setInputFiles(files);
  await idle(p);
}
async function counters(p) {
  return p.evaluate(() => ({ bitmaps: window.__audit.bitmaps, images: window.__audit.images }));
}
async function pause(p) {
  await p.evaluate(() => {
    window.__audit.pause = true;
    window.__audit.held = null;
    window.__audit.release = null;
  });
}
async function release(p) {
  await p.evaluate(() => {
    window.__audit.pause = false;
    window.__audit.release?.();
  });
  await p.waitForTimeout(80);
}
try {
  for (const width of [1440, 320, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      hasTouch: width < 500,
      isMobile: width < 500,
    });
    const p = await context.newPage();
    p.setDefaultTimeout(45000);
    const { start, open } = proBrowserFixtures(base, errors);
    await start(p);
    await idle(p);
    const initial = await snapshot(p),
      chapter = initial.chapters[0],
      project = initial.projects[0];
    await p.evaluate(() => {
      const native = window.createImageBitmap,
        NativeImage = window.Image;
      window.__audit = { bitmaps: 0, images: 0, pause: false, held: null, release: null };
      window.createImageBitmap = async (...args) => {
        window.__audit.bitmaps++;
        const bitmap = await native(...args);
        if (window.__audit.pause) {
          window.__audit.held = bitmap;
          await new Promise((resolve) => {
            window.__audit.release = resolve;
          });
        }
        return bitmap;
      };
      window.Image = new Proxy(NativeImage, {
        construct(target, args) {
          window.__audit.images++;
          return Reflect.construct(target, args);
        },
      });
    });
    // Every rejected fixture must stop at the predecode boundary, not just fail later.
    const huge = Buffer.alloc(24);
    huge.set([137, 80, 78, 71, 13, 10, 26, 10]);
    huge.write("IHDR", 12);
    huge.writeUInt32BE(0xffffffff, 16);
    huge.writeUInt32BE(0xffffffff, 20);
    const png = await file("truncated.png");
    png.buffer = png.buffer.subarray(0, png.buffer.length - 1);
    for (const rejected of [
      { name: "huge.png", mimeType: "image/png", buffer: huge },
      png,
      {
        name: "spoof.png",
        mimeType: "image/png",
        buffer: Buffer.from("<html>not an image</html>"),
      },
    ]) {
      const before = await snapshot(p),
        calls = await counters(p);
      await input(p, [rejected]);
      assert.deepEqual(await snapshot(p), before);
      assert.deepEqual(await counters(p), calls);
    }
    // The same aggregate rejection happens before ANY valid-looking member is decoded.
    const plane = await file("plane.png", "batch-plane.png");
    const aggregate = Array.from({ length: width < 500 ? 5 : 9 }, (_, i) => ({
      ...plane,
      name: `large-${i}.png`,
    }));
    // A real32×24 fixture with a deliberately constrained policy tests aggregate work separately below.
    const { aggregateRejected, decoderCalls } = await p.evaluate(async () => {
      const { preflightImages, imagePolicy } = await import("/src/lib/studio/image-policy.ts");
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 24;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const n = window.__audit.bitmaps;
      let aggregateRejected = false;
      try {
        await preflightImages([blob, blob], { ...imagePolicy(), maxBatchPixels: 1000 });
      } catch (e) {
        aggregateRejected = /Batch/.test(e.message);
      }
      return { aggregateRejected, decoderCalls: window.__audit.bitmaps - n };
    });
    assert.ok(aggregateRejected);
    assert.equal(decoderCalls, 0);
    const beforeAggregate = await counters(p);
    await input(p, aggregate);
    assert.deepEqual(await snapshot(p), initial);
    assert.deepEqual(await counters(p), beforeAggregate);
    assert.match(
      await p.evaluate(() => window.__r11Store.getState().banner),
      /Batch exceeds aggregate/,
    );

    const valid = await file("valid-as-text.dat", "original.png", "text/plain");
    await input(p, [
      valid,
      { name: "bad.png", mimeType: "image/png", buffer: huge },
      await file("valid-jpeg.jpg", "original.jpg", "image/jpeg"),
    ]);
    let state = await snapshot(p);
    assert.deepEqual(
      state.panels.sort((a, b) => a.order - b.order).map((x) => x.name),
      ["geometry.png", "valid-as-text.dat", "valid-jpeg.jpg"],
    );
    assert.equal(state.panels.find((x) => x.name === "valid-as-text.dat").mime, "image/png");
    // Real drag/drop and paste entry points share the same transaction/policy.
    await p.evaluate(
      async (bytes) => {
        const dt = new DataTransfer();
        dt.items.add(new File([Uint8Array.from(bytes)], "dropped.png", { type: "image/png" }));
        document
          .querySelector(".studio-aside")
          .dispatchEvent(
            new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
          );
      },
      [...valid.buffer],
    );
    await idle(p);
    await p.evaluate(
      async (bytes) => {
        const dt = new DataTransfer();
        dt.items.add(new File([Uint8Array.from(bytes)], "pasted.png", { type: "image/png" }));
        window.dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }),
        );
      },
      [...valid.buffer],
    );
    await idle(p);
    state = await snapshot(p);
    assert.equal(state.panels.length, 5);
    // Actual decoder delay, cancellation, late ImageBitmap closure and zero orphan writes.
    const beforeCancel = await snapshot(p);
    await pause(p);
    await p
      .locator('input[type="file"]')
      .first()
      .setInputFiles(await file("cancel.png"));
    await p.waitForFunction(() => window.__audit.held !== null);
    await p.getByRole("button", { name: "Cancel image import", exact: true }).click();
    await release(p);
    assert.equal(await p.evaluate(() => window.__audit.held.width), 0);
    assert.deepEqual(await snapshot(p), beforeCancel);
    // Atomic batch quota failure: no panel, timestamp or orphan blob changes.
    await p.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      window.__restoreAdd = () => {
        IDBObjectStore.prototype.add = add;
      };
      let writes = 0;
      IDBObjectStore.prototype.add = function (...args) {
        if (this.name === "blobs" && ++writes === 2)
          throw new DOMException("Injected quota failure", "QuotaExceededError");
        return add.apply(this, args);
      };
    });
    const beforeQuota = await snapshot(p);
    await input(p, [await file("quota.png")]);
    assert.deepEqual(await snapshot(p), beforeQuota);
    await p.evaluate(() => window.__restoreAdd());
    // Switching Chapters aborts the old destination without publishing into either page list.
    const other = await p.evaluate(
      async (id) => window.__r11Store.getState().createChapter(id),
      project.id,
    );
    const beforeSwitch = await snapshot(p);
    await pause(p);
    await p
      .locator('input[type="file"]')
      .first()
      .setInputFiles(await file("old-chapter.png"));
    await p.waitForFunction(() => window.__audit.held !== null);
    await p.getByLabel("Navigate chapters", { exact: true }).selectOption(other);
    await release(p);
    assert.deepEqual(await snapshot(p), beforeSwitch);
    await p.getByLabel("Navigate chapters", { exact: true }).selectOption(chapter.id);
    // Repeated imports continue working after all failures/cancellations.
    await input(p, [await file("retry.png")]);
    assert.equal((await snapshot(p)).panels.length, 6);
    // Invalid replacement never enters a decoder or mutates the current page/references.
    let beforeReplace = await snapshot(p);
    const counts = await counters(p);
    const replacement = await p.evaluate(
      async ({ id, bytes }) => {
        try {
          await window.__r11Store
            .getState()
            .replacePanelImage(id, new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
          return "unexpected";
        } catch (e) {
          return e.message;
        }
      },
      { id: initial.panels[0].id, bytes: [...huge] },
    );
    assert.match(replacement, /dimensions|header/);
    assert.deepEqual(await snapshot(p), beforeReplace);
    assert.deepEqual(await counters(p), counts);
    // This environment has no TIFF pixel decoder. Its genuine valid header is
    // accepted, then actual bitmap/Image decoding fails without publishing data.
    await input(p, [await file("unsupported-codec.tiff", "original.tiff", "image/tiff")]);
    assert.deepEqual(await snapshot(p), beforeReplace);
    // Cancellation also protects direct editor/AI replacement callers.
    await pause(p);
    await p.evaluate(
      async ({ id, bytes }) => {
        window.__replacementController = new AbortController();
        window.__replacementResult = null;
        window.__r11Store
          .getState()
          .replacePanelImage(id, new Blob([Uint8Array.from(bytes)], { type: "image/png" }), {
            signal: window.__replacementController.signal,
          })
          .then(
            () => {
              window.__replacementResult = "success";
            },
            (e) => {
              window.__replacementResult = e.name;
            },
          );
      },
      { id: initial.panels[0].id, bytes: [...valid.buffer] },
    );
    await p.waitForFunction(() => window.__audit.held !== null);
    await p.evaluate(() => window.__replacementController.abort());
    await release(p);
    await p.waitForFunction(() => window.__replacementResult !== null);
    assert.equal(await p.evaluate(() => window.__replacementResult), "AbortError");
    assert.deepEqual(await snapshot(p), beforeReplace);
    const failedReplace = await p.evaluate(
      async ({ id, bytes }) => {
        const put = IDBObjectStore.prototype.put;
        let writes = 0;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === "blobs" && ++writes === 2)
            throw new DOMException("Replacement quota", "QuotaExceededError");
          return put.apply(this, args);
        };
        try {
          await window.__r11Store
            .getState()
            .replacePanelImage(id, new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
          return "unexpected";
        } catch (e) {
          return e.name;
        } finally {
          IDBObjectStore.prototype.put = put;
        }
      },
      { id: initial.panels[0].id, bytes: [...valid.buffer] },
    );
    assert.equal(failedReplace, "QuotaExceededError");
    assert.deepEqual(await snapshot(p), beforeReplace);
    // A successful edit retains original bytes. Corrupted original recovery is
    // rejected; restoring the untouched fixture afterward proves normal recovery.
    const recovery = await p.evaluate(
      async ({ id, bytes }) => {
        const useStudio = window.__r11Store,
          { getBlob, openDb } = await import("/src/lib/studio/db.ts");
        const old = useStudio.getState().panels.find((x) => x.id === id),
          source = await getBlob(old.blobId);
        await useStudio
          .getState()
          .replacePanelImage(id, new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
        const accepted = useStudio.getState().panels.find((x) => x.id === id);
        const write = async (blob) => {
          const db = await openDb(),
            tx = db.transaction("blobs", "readwrite");
          tx.objectStore("blobs").put(blob, old.blobId);
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
        };
        await write(new Blob(["bad"], { type: "image/png" }));
        let rejected = false;
        try {
          await useStudio.getState().restorePanel(id);
        } catch {
          rejected = true;
        }
        const currentUnchanged =
          useStudio.getState().panels.find((x) => x.id === id).blobId === accepted.blobId;
        await write(source);
        await useStudio.getState().restorePanel(id);
        const restored = useStudio.getState().panels.find((x) => x.id === id);
        const restoredBytes = new Uint8Array(await (await getBlob(restored.blobId)).arrayBuffer()),
          original = new Uint8Array(await source.arrayBuffer());
        return {
          rejected,
          currentUnchanged,
          originalPreserved:
            accepted.original.blobId === old.blobId &&
            restored.blobId === old.blobId &&
            restoredBytes.every((n, i) => n === original[i]),
        };
      },
      { id: initial.panels[0].id, bytes: [...valid.buffer] },
    );
    assert.deepEqual(recovery, { rejected: true, currentUnchanged: true, originalPreserved: true });
    beforeReplace = await snapshot(p);
    // Full backup preflight is also before mutation; no unsafe recovered thumbnail/source.
    const rejectedRecovery = await p.evaluate(async (id) => {
      const { readProjectData, writeProjectData } = await import("/src/lib/studio/backup-store.ts");
      const data = await readProjectData(id);
      data.blobs.set(data.panels[0].thumbId, new Blob(["bad"], { type: "image/png" }));
      try {
        await writeProjectData(data);
        return "unexpected";
      } catch (e) {
        return e.message;
      }
    }, project.id);
    assert.match(rejectedRecovery, /Backup image rejected/);
    assert.deepEqual(await snapshot(p), beforeReplace);
    const backupGuards = await p.evaluate(async (id) => {
      const { readProjectData, writeProjectData } = await import("/src/lib/studio/backup-store.ts");
      const outcomes = [];
      const n = window.__audit.bitmaps;
      for (const kind of ["dimensions", "character reference"]) {
        const data = await readProjectData(id);
        if (kind === "dimensions") data.panels[0].width = 0xffffffff;
        else
          data.project.characters = [
            {
              id: "unsafe",
              references: [
                { id: "unsafe", angle: "front", blob: new Blob(["bad"], { type: "image/png" }) },
              ],
            },
          ];
        try {
          await writeProjectData(data);
          outcomes.push("unexpected");
        } catch (e) {
          outcomes.push(e.message);
        }
      }
      return { outcomes, decodes: window.__audit.bitmaps - n };
    }, project.id);
    assert.match(backupGuards.outcomes[0], /dimensions disagree/);
    assert.match(backupGuards.outcomes[1], /Backup image rejected/);
    assert.equal(backupGuards.decodes, 0);
    assert.deepEqual(await snapshot(p), beforeReplace);
    // Repeated import/removal must release actual thumbnail object URLs, while
    // preserving other Chapter media references. No production test hooks.
    for (let i = 0; i < 3; i++) {
      await input(p, [await file(`temporary-${i}.png`)]);
      const removed = await p.evaluate(async (name) => {
        const state = window.__r11Store.getState(),
          panel = state.panels.find((x) => x.name === name);
        const url = state.thumbs[panel.id],
          revoke = URL.revokeObjectURL,
          revoked = [];
        URL.revokeObjectURL = (value) => {
          revoked.push(value);
          return revoke(value);
        };
        try {
          await state.removePanel(panel.id);
        } finally {
          URL.revokeObjectURL = revoke;
        }
        return {
          hadUrl: !!url,
          revoked: revoked.includes(url),
          retained: !!window.__r11Store.getState().thumbs[panel.id],
        };
      }, `temporary-${i}.png`);
      assert.deepEqual(removed, { hadUrl: true, revoked: true, retained: false });
    }
    // Both existing studio entry points retain selected-image context.
    await open(p, "Raster");
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await open(p, "Vector");
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    if (width === 1440) {
      // A real second tab commits first. The stale first-tab transaction cannot
      // append orphan assets or overwrite order/media/timestamps from the winner.
      await pause(p);
      await p
        .locator('input[type="file"]')
        .first()
        .setInputFiles(await file("stale-tab.png"));
      await p.waitForFunction(() => window.__audit.held !== null);
      const q = await context.newPage();
      await q.goto(p.url());
      await q.getByText("Chapter workspace", { exact: true }).waitFor();
      await input(q, [await file("other-tab.png")]);
      const winning = await snapshot(q);
      await release(p);
      assert.deepEqual(await snapshot(p), winning);
      await q.close();
    }
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({ path: `/workspace/screenshots/r11-import-${width}.png` });
    results.push({
      width,
      rejectedDecodeCalls: 0,
      defaultAggregateRejectedBeforeDecode: true,
      mixedOrder: true,
      pickerDropPaste: true,
      cancellationAndLateClose: true,
      atomicQuotaRollback: true,
      staleChapter: true,
      replacementProtection: true,
      replacementQuotaAndCancellation: true,
      actualDecoderFailure: true,
      recoveryProtection: true,
      recoveryMetadataAndReferences: true,
      originalBytes: true,
      crossTab: width === 1440,
      retriesAndUrlCleanup: true,
      studioEntries: true,
    });
    await context.close();
  }
  // Full browser-supported format decoding, canonical MIME and original bytes.
  const context = await browser.newContext(),
    p = await context.newPage();
  const { start } = proBrowserFixtures(base, errors);
  await start(p);
  const formats = [];
  for (const ext of ["png", "jpg", "webp", "gif", "bmp", "ico", "avif"]) {
    const data = await file(`format.${ext}`, `original.${ext}`, "application/octet-stream");
    await input(p, [data]);
    const state = await snapshot(p),
      panel = state.panels.find((x) => x.name === data.name);
    assert.ok(panel, `${ext} actual browser decoding/import must work`);
    const equal = await p.evaluate(
      async ({ id, bytes }) => {
        const { getBlob } = await import("/src/lib/studio/db.ts");
        return [...new Uint8Array(await (await getBlob(id)).arrayBuffer())].every(
          (n, i) => n === bytes[i],
        );
      },
      { id: panel.blobId, bytes: [...data.buffer] },
    );
    assert.ok(equal);
    formats.push(ext);
  }
  await input(p, [
    {
      name: "safe.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="#234656"/></svg>',
      ),
    },
  ]);
  assert.ok((await snapshot(p)).panels.some((x) => x.name === "safe.svg"));
  formats.push("safe svg");
  results.push({ actualBrowserFormats: formats, originalBytes: true });
  await context.close();
  assert.deepEqual(errors, []);
  await mkdir("/workspace/screenshots", { recursive: true });
  const output = {
    results,
    errors,
    physicalAndroid: false,
    injectedBoundaryTests: ["decoder delay", "quota", "stored original corruption"],
    actualInference: "not part of this targeted suite; existing regressions run separately",
  };
  await writeFile(
    "/workspace/screenshots/r11-import-results.json",
    JSON.stringify(output, null, 2),
  );
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}
