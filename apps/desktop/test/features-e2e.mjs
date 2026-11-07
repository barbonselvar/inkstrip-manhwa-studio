#!/usr/bin/env node
/**
 * Studio feature workflows inside the real desktop app (offline, isolated profile).
 *
 *   node apps/desktop/test/features-e2e.mjs [--exe <exe>] [--out <dir>]
 *
 * Images: import, reorder + undo. Chapters: create, delete. Raster Studio: brush and
 * eraser strokes, undo/redo, native document saved. Text & Bubbles: add a bubble that
 * persists. Project: rename, Backup (website format) → Delete → Restore with every
 * image, chapter and Raster document intact.
 */
import assert from "node:assert/strict";
import { launchElectron } from "./launch-electron.mjs";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { windowPages } from "./window-pages.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const root = resolve(desktop, "..", "..");
const { _electron: electron } = await import(pathToFileURL(join(root, "node_modules", "playwright", "index.mjs")).href);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const exe = arg("--exe");
const out = resolve(arg("--out") ?? join(tmpdir(), `inkstrip-features-${Date.now()}`));
mkdirSync(join(out, "downloads"), { recursive: true });
const results = [];
const ok = (step, data = {}) => {
  results.push({ step, ok: true, ...data });
  console.log(`✓ ${step}`, Object.keys(data).length ? JSON.stringify(data) : "");
};

/** Records + native Raster sessions from IndexedDB. */
const db = (page) =>
  page.evaluate(async () => {
    const open = (n) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(n);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const all = (d, s) =>
      new Promise((res) => {
        if (!d.objectStoreNames.contains(s)) return res([]);
        const r = d.transaction(s).objectStore(s).getAll();
        r.onsuccess = () => res(r.result);
      });
    const main = await open("inkstrip");
    const pro = await open("inkstrip-pro");
    const out = {
      projects: await all(main, "projects"),
      chapters: await all(main, "chapters"),
      panels: await all(main, "panels"),
      sessions: (await all(pro, "sessions")).map((s) => ({ id: s.id, revision: s.session?.revision, layers: s.session?.document?.layers?.length })),
      staged: (await all(main, "nativeRestores")).map((s) => s.id),
    };
    main.close();
    pro.close();
    return JSON.parse(JSON.stringify(out));
  });

let failure = null;
let app;
let studio;
try {
  app = await launchElectron(electron, {
    executablePath: exe ?? join(desktop, "node_modules", "electron", "dist", "electron.exe"),
    args: exe ? [] : [desktop],
    env: { ...process.env, INKSTRIP_PROFILE_DIR: join(out, "profile") },
    timeout: 60_000,
  });
  await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  await app.evaluate(({ session }, d) => {
    session.defaultSession.on("will-download", (_e, item) => item.setSavePath(`${d}\\${item.getFilename()}`));
  }, join(out, "downloads"));
  ({ studio } = await windowPages(app));
  const errors = [];
  studio.on("pageerror", (e) => errors.push(e.message));
  studio.on("console", (m) => m.type() === "error" && !/unsafe-eval/.test(m.text()) && errors.push(m.text()));
  await studio.waitForSelector(".desktop-toasts", { state: "attached", timeout: 60_000 });

  // ── Images ─────────────────────────────────────────────
  await studio.getByRole("button", { name: "New project", exact: true }).click();
  await studio.getByLabel("Project title").fill("Feature QA");
  await studio.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await studio.getByRole("button", { name: "Add images", exact: true }).waitFor({ timeout: 30_000 });
  const names = ["fantasy-720.webp", "horror-720.webp", "romance-720.webp"];
  await studio.locator("input[type=file][multiple]").first().setInputFiles(
    names.map((n, i) => ({ name: `0${i + 1}-${n}`, mimeType: "image/webp", buffer: readFileSync(join(root, "public", "gallery", n)) })),
  );
  await studio.getByRole("button", { name: "Display 3", exact: true }).waitFor({ timeout: 60_000 });
  const order = async () =>
    (await db(studio)).panels.sort((a, b) => a.order - b.order).map((p) => p.name.slice(0, 2));
  assert.deepEqual(await order(), ["01", "02", "03"]);
  await studio.getByRole("button", { name: "Move down", exact: true }).first().click();
  await studio.waitForFunction(() => true);
  const moved = await (async () => {
    for (let i = 0; i < 40; i++) {
      const o = await order();
      if (o[0] !== "01") return o;
      await new Promise((r) => setTimeout(r, 150));
    }
    return order();
  })();
  assert.deepEqual(moved, ["02", "01", "03"]);
  await studio.getByRole("button", { name: "Undo reorder", exact: true }).click();
  for (let i = 0; i < 40 && (await order())[0] !== "01"; i++) await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(await order(), ["01", "02", "03"]);
  ok("images: import 3, reorder, undo reorder");

  // ── Raster Studio ──────────────────────────────────────
  await studio.getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
  const raster = studio.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true });
  await raster.waitFor({ timeout: 60_000 });
  await studio.locator(".pro-artboard canvas, .pro-artboard").first().waitFor({ timeout: 60_000 });
  const board = await studio.locator(".pro-artboard").first().boundingBox();
  const stroke = async (tool, dy) => {
    await studio.getByRole("button", { name: `${tool} tool`, exact: true }).click();
    const y = board.y + board.height * dy;
    await studio.mouse.move(board.x + board.width * 0.3, y);
    await studio.mouse.down();
    await studio.mouse.move(board.x + board.width * 0.7, y, { steps: 12 });
    await studio.mouse.up();
  };
  const undo = studio.getByRole("button", { name: "Pro undo", exact: true });
  const redo = studio.getByRole("button", { name: "Pro redo", exact: true });
  await stroke("Brush", 0.4);
  await undo.waitFor();
  await studio.waitForFunction(() => !document.querySelector('[aria-label="Pro undo"]')?.disabled, null, { timeout: 15_000 });
  await stroke("Eraser", 0.6);
  await undo.click();
  await studio.waitForFunction(() => !document.querySelector('[aria-label="Pro redo"]')?.disabled, null, { timeout: 15_000 });
  await redo.click();
  // The native document autosaves; wait for a saved revision of this page.
  let sessions = [];
  for (let i = 0; i < 60 && !sessions.some((s) => s.revision > 0); i++) {
    await new Promise((r) => setTimeout(r, 250));
    sessions = (await db(studio)).sessions;
  }
  assert.ok(sessions.some((s) => s.revision > 0), JSON.stringify(sessions));
  await studio.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await raster.waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  ok("raster: brush + eraser strokes, undo/redo, native document saved", { sessions });

  // ── Text & Bubbles ─────────────────────────────────────
  await studio.getByRole("button", { name: "Text & Bubbles", exact: true }).click();
  await studio.locator("[data-composition=lettering]").waitFor({ timeout: 60_000 });
  const addBubble = studio.getByRole("button", { name: /^Add .+ bubble$/ }).first();
  await addBubble.waitFor({ timeout: 30_000 });
  const label = await addBubble.getAttribute("aria-label");
  await addBubble.click();
  let objects = 0;
  for (let i = 0; i < 60 && objects === 0; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const chapter = (await db(studio)).chapters[0];
    objects = chapter?.composition?.document?.objects?.length ?? 0;
  }
  assert.ok(objects > 0, "bubble stored in the chapter composition");
  ok("text & bubbles: bubble added and persisted", { added: label, objects });

  // ── Chapters ───────────────────────────────────────────
  // "New chapter" from the chapter workspace creates Chapter 2 and opens it.
  await studio.getByRole("button", { name: "Images", exact: true }).click();
  await studio.getByLabel(/^Back to /).first().click();
  await studio.getByRole("button", { name: "New chapter", exact: true }).click();
  for (let i = 0; i < 40 && (await db(studio)).chapters.length < 2; i++) await new Promise((r) => setTimeout(r, 150));
  assert.equal((await db(studio)).chapters.length, 2);
  await studio.getByLabel(/^Back to /).first().click();
  await studio.getByRole("button", { name: "Delete Chapter 2", exact: true }).click();
  await studio.getByRole("button", { name: "Delete chapter", exact: true }).click();
  for (let i = 0; i < 40 && (await db(studio)).chapters.length > 1; i++) await new Promise((r) => setTimeout(r, 150));
  assert.equal((await db(studio)).chapters.length, 1);
  ok("chapters: create, delete");

  // ── Project rename ─────────────────────────────────────
  await studio.getByRole("button", { name: "Feature QA", exact: true }).first().click();
  await studio.getByLabel("Rename").fill("Feature QA renamed");
  await studio.getByLabel("Rename").press("Enter");
  for (let i = 0; i < 40 && (await db(studio)).projects[0].title !== "Feature QA renamed"; i++) await new Promise((r) => setTimeout(r, 150));
  assert.equal((await db(studio)).projects[0].title, "Feature QA renamed");
  ok("project: rename");

  // ── Backup → Delete → Restore ──────────────────────────
  const before = await db(studio);
  await studio.getByRole("button", { name: "Backup", exact: true }).click();
  let backups = [];
  for (let i = 0; i < 120 && !backups.length; i++) {
    await new Promise((r) => setTimeout(r, 250));
    backups = readdirSync(join(out, "downloads")).filter((f) => f.endsWith(".inkstrip-project"));
  }
  assert.equal(backups.length, 1);
  await studio.getByRole("button", { name: "Delete", exact: true }).click();
  await studio.getByRole("button", { name: "Delete project", exact: true }).click();
  for (let i = 0; i < 60 && (await db(studio)).projects.length; i++) await new Promise((r) => setTimeout(r, 150));
  const deleted = await db(studio);
  assert.equal(deleted.projects.length, 0);
  assert.equal(deleted.sessions.length, 0, "deleting the project removes its Raster documents");
  await studio.waitForURL(/app:\/\/inkstrip\/$/, { timeout: 15_000 }).catch(() => {});
  await studio.locator("input[type=file][accept='.inkstrip-project']").setInputFiles(join(out, "downloads", backups[0]));
  for (let i = 0; i < 120 && !(await db(studio)).projects.length; i++) await new Promise((r) => setTimeout(r, 250));
  const after = await db(studio);
  assert.deepEqual(after.projects, before.projects);
  assert.deepEqual(after.chapters, before.chapters);
  assert.deepEqual(after.panels, before.panels);
  assert.equal(after.staged.length, before.sessions.length, "Raster documents restored (staged for the editor)");
  ok("project: Backup → Delete → Restore with chapters, panels and Raster documents", { backup: backups[0], raster: after.staged.length });

  assert.deepEqual(errors, []);
  await studio.screenshot({ path: join(out, "features-final.png") });
  await app.evaluate(({ app }) => app.exit(0));
} catch (error) {
  failure = error;
  console.error("✗", error);
  await studio?.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
} finally {
  writeFileSync(join(out, "features-results.json"), JSON.stringify({ exe: exe ?? "unpackaged", results, failure: failure ? String(failure.stack ?? failure) : null }, null, 2));
  console.log(`Results: ${join(out, "features-results.json")}`);
}
process.exit(failure ? 1 : 0);
