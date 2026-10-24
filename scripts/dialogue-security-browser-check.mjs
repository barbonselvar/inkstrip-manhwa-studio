import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(`${base}/gallery/provenance.json`);
  const protectedDraft = await page.evaluate(async () => {
    const legacy = await new Promise((resolve, reject) => {
      const r = indexedDB.open("inkstrip", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("projects", { keyPath: "id" });
        db.createObjectStore("chapters", { keyPath: "id" }).createIndex("by_project", "projectId");
        db.createObjectStore("panels", { keyPath: "id" }).createIndex("by_chapter", "chapterId");
        db.createObjectStore("blobs");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = legacy.transaction("projects", "readwrite");
      tx.objectStore("projects").put({
        id: "legacy-project",
        title: "Protected F1 project",
        createdAt: 1,
        updatedAt: 1,
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    legacy.close();

    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("inkstrip-pro", 2);
      r.onupgradeneeded = () => r.result.createObjectStore("sessions", { keyPath: "id" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite");
      tx.objectStore("sessions").put({
        id: "ai-source",
        session: { document: { layers: [{ id: "ai-result", ai: { modelId: "protected" } }] } },
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const { openDb } = await import("/src/lib/studio/db.ts");
    const main = await openDb(),
      mainVersion = main.version;
    const { loadSession } = await import("/src/lib/studio/pro/storage.ts");
    let error = "";
    try {
      await loadSession("ai-source");
    } catch (e) {
      error = e.message;
    }
    const old = await new Promise((resolve, reject) => {
      const r = indexedDB.open("inkstrip-pro", 2);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const data = await new Promise((resolve) => {
      const r = old.transaction("sessions").objectStore("sessions").get("ai-source");
      r.onsuccess = () => resolve(r.result);
    });
    const version = old.version;
    old.close();
    return { error, version, mainVersion, model: data.session.document.layers[0].ai.modelId };
  });
  assert.match(protectedDraft.error, /unreleased F1 AI draft/);
  assert.equal(protectedDraft.version, 2);
  assert.equal(protectedDraft.mainVersion, 1);
  await page.goto(base);
  await page.getByText("Protected F1 project", { exact: true }).waitFor();
  assert.equal(protectedDraft.model, "protected");
  await context.close();
  const ordinary = await browser.newContext(),
    p = await ordinary.newPage();
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).waitFor();
  const ordinaryResults = await p.evaluate(async () => {
    const [
      { fromPanel },
      { saveSession, loadSession },
      { createBubble },
      { nativeFile, readNative },
      { importSvg },
    ] = await Promise.all([
      import("/src/lib/studio/pro/model.ts"),
      import("/src/lib/studio/pro/storage.ts"),
      import("/src/lib/studio/dialogue/operations.ts"),
      import("/src/lib/studio/pro/files.ts"),
      import("/src/lib/studio/pro/svg-import.ts"),
    ]);
    const c = new OffscreenCanvas(32, 32),
      x = c.getContext("2d");
    x.fillStyle = "#408060";
    x.fillRect(0, 0, 32, 32);
    const blob = await c.convertToBlob();
    const doc = createBubble(
      fromPanel({ id: "safe", name: "Source", width: 32, height: 32 }),
      "speech",
    ).document;
    const original = {
      document: doc,
      assets: { source: blob },
      revision: 0,
      acceptedBlobId: "source",
      updatedAt: 0,
    };
    await saveSession(original, 0);
    let stale = false;
    try {
      await saveSession(original, 0);
    } catch (e) {
      stale = /Another tab/.test(e.message);
    }
    const saved = await loadSession("safe");
    const native = JSON.parse(await (await nativeFile(saved)).text());
    native.document.layers.find((l) => l.bubble).bubble.textId = "missing";
    let missingRejected = false;
    try {
      await readNative(new Blob([JSON.stringify(native)]), "safe", "source");
    } catch (e) {
      missingRejected = /missing text layer/.test(e.message);
    }
    let richRejected = false;
    try {
      importSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><g data-inkstrip-dialogue="1"><text>safe</text></g></svg>',
      );
    } catch (e) {
      richRejected = /Rich Dialogue SVG/.test(e.message);
    }
    return {
      stale,
      missingRejected,
      richRejected,
      revision: (await loadSession("safe")).revision,
      unchanged: JSON.stringify((await loadSession("safe")).document) === JSON.stringify(doc),
    };
  });
  assert.deepEqual(ordinaryResults, {
    stale: true,
    missingRejected: true,
    richRejected: true,
    revision: 1,
    unchanged: true,
  });
  await ordinary.close();
  await writeFile(
    "/workspace/screenshots/dialogue-security-results.json",
    JSON.stringify({ protectedDraft, ordinaryResults }, null, 2),
  );
  console.log(
    "Unreleased F1 draft storage, revision conflicts, malformed native references and explicit rich SVG rejection passed.",
  );
} finally {
  await browser.close();
}
