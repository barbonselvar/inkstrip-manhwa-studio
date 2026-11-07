#!/usr/bin/env node
/**
 * End-to-end test of the real Windows desktop app (Playwright's Electron driver).
 *
 *   node apps/desktop/test/e2e-desktop.mjs [--exe "<path to Inkstrip Manhwa Studio.exe>"] [--out <dir>]
 *
 * Without --exe it runs the unpackaged build (apps/desktop, `npm run build` first).
 * Every scenario uses its own throw-away profile (INKSTRIP_PROFILE_DIR) and runs with
 * the network disabled, so it never touches the user's real projects.
 *
 * Covers: offline startup, project creation, image import, Composition & FX (panel
 * extension + fade) persisting across workspaces, Save (Ctrl+S) to .inkstrip with
 * integrity, backups on re-save, chapter export, clean close, reopening the file in a
 * brand-new profile with byte-identical records and artwork, crash recovery after a
 * killed process, rejection of a corrupted file, and the close-without-saving prompt.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const root = resolve(desktop, "..", "..");
const { _electron: electron } = await import(pathToFileURL(join(root, "node_modules", "playwright", "index.mjs")).href);

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const exe = arg("--exe");
const out = resolve(arg("--out") ?? join(tmpdir(), `inkstrip-e2e-${Date.now()}`));
mkdirSync(out, { recursive: true });
const results = [];
const timings = {};
const step = (name, data = {}) => {
  results.push({ step: name, ok: true, ...data });
  console.log(`✓ ${name}`, Object.keys(data).length ? JSON.stringify(data) : "");
};

async function launch(profile, extraArgs = []) {
  const executablePath = exe ?? join(desktop, "node_modules", "electron", "dist", "electron.exe");
  const args = exe ? extraArgs : [desktop, ...extraArgs];
  const started = Date.now();
  const app = await electron.launch({
    executablePath,
    args,
    env: { ...process.env, INKSTRIP_PROFILE_DIR: profile },
    timeout: 60_000,
  });
  await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    // Expected: libraries probe `new Function` support and the CSP correctly refuses it.
    if (/unsafe-eval/.test(text)) return;
    errors.push(text);
  });
  await page.waitForSelector(".hero-title, [data-composition], .desktop-statusbar, main", { timeout: 60_000 });
  return { app, page, errors, launchMs: Date.now() - started };
}

/** Make native dialogs deterministic: the next Save/Open dialog returns `path`. */
const stubSave = (app, path) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, path);
const stubOpen = (app, path) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, path);
/** Exports (<a download>) go straight to `folder` instead of a Save dialog. */
const autoDownloads = (app, folder) =>
  app.evaluate(({ session }, dir) => {
    session.defaultSession.on("will-download", (_e, item) => item.setSavePath(`${dir}\\${item.getFilename()}`));
  }, folder);

async function closeApp(app) {
  const exited = new Promise((r) => app.process().once("exit", r));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error("app did not exit")), 30_000))]);
}

/** Every workspace record plus a SHA-256 of every stored image, from IndexedDB. */
const dumpWorkspace = (page) =>
  page.evaluate(async () => {
    const open = (name) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const all = (db, store) =>
      new Promise((res, rej) => {
        if (!db.objectStoreNames.contains(store)) return res([]);
        const tx = db.transaction(store);
        const r = tx.objectStore(store).getAll();
        const k = tx.objectStore(store).getAllKeys();
        tx.oncomplete = () => res(store === "blobs" ? k.result.map((key, i) => [key, r.result[i]]) : r.result);
        tx.onerror = () => rej(tx.error);
      });
    const db = await open("inkstrip");
    const blobs = {};
    for (const [key, blob] of await all(db, "blobs")) {
      const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      blobs[key] = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("") + `:${blob.type}`;
    }
    const sort = (a) => [...a].sort((x, y) => (x.id < y.id ? -1 : 1));
    const out = {
      projects: sort(await all(db, "projects")),
      chapters: sort(await all(db, "chapters")),
      panels: sort(await all(db, "panels")),
      blobs,
    };
    db.close();
    return JSON.parse(JSON.stringify(out));
  });

const waitStatus = (page, re, timeout = 20_000) =>
  page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".desktop-statusbar")?.textContent ?? ""), re.source, { timeout });
const tilesReady = (page) =>
  page.waitForFunction(
    () => {
      const t = [...document.querySelectorAll(".composition-tile")];
      return t.length > 0 && t.every((c) => c.dataset.renderStatus === "ready");
    },
    null,
    { timeout: 90_000 },
  );
/** Focus a panel through the studio's Panels list (switching to that tab if needed). */
async function focusPanel(page, n) {
  const button = page.getByRole("button", { name: `Focus panel ${n}`, exact: true });
  if (!(await button.isVisible().catch(() => false)))
    await page.getByRole("button", { name: "Panels", exact: true }).first().click();
  await button.click();
}
/** The bottom fade of panel 3 is shown (selected in the inspector, or in the panel's fade list). */
async function showFade(page) {
  const depth = page.getByLabel("Fade depth (px)", { exact: true });
  if (await depth.isVisible().catch(() => false)) return Number(await depth.inputValue());
  await focusPanel(page, 3);
  await page.getByText("Fades on this panel", { exact: true }).waitFor({ timeout: 15_000 });
  const entry = await page.getByText(/Bottom · \d+ px · \d+%/).first().innerText();
  return Number(/Bottom · (\d+) px/.exec(entry)?.[1]);
}
async function openComposition(page) {
  await page.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await page.locator("[data-composition=studio]").waitFor({ timeout: 60_000 });
  await tilesReady(page);
}
const compositionSaved = (page) =>
  page.waitForFunction(() => document.querySelector("[data-composition=studio]")?.dataset.saveStatus === "saved", null, { timeout: 30_000 });

async function createProject(page, title, files) {
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await page.getByRole("button", { name: "Add images", exact: true }).waitFor({ timeout: 30_000 });
  const t = Date.now();
  await page.locator("input[type=file][multiple]").first().setInputFiles(files);
  await page.getByRole("button", { name: `Display ${files.length}`, exact: true }).waitFor({ timeout: 120_000 });
  timings.importMs = Date.now() - t;
}

const gallery = (name, i) => ({
  name: `0${i + 1}-${name}`,
  mimeType: "image/webp",
  buffer: readFileSync(join(root, "public", "gallery", name)),
});

const fadeState = (dump) => {
  const chapter = dump.chapters[0];
  const doc = chapter?.composition?.document;
  assert.ok(doc, "chapter has a composition document");
  const panels = Object.values(doc.panels);
  return {
    topExtension: Math.max(...panels.map((p) => p.top?.height ?? 0)),
    fades: panels.reduce((n, p) => n + (p.fades?.length ?? 0), 0),
  };
};

let failure = null;
let currentPage = null;
try {
  // ───────────── Scenario A: create, edit, save (offline) ─────────────
  const profileA = join(out, "profile-a");
  const projectFile = join(out, "files", "Desktop QA.inkstrip");
  mkdirSync(dirname(projectFile), { recursive: true });
  mkdirSync(join(out, "exports"), { recursive: true });
  let { app, page, errors, launchMs } = await launch(profileA);
  currentPage = () => page;
  timings.firstLaunchMs = launchMs;
  assert.equal(await page.evaluate(() => window.inkstripDesktop?.isDesktop), true);
  assert.equal(new URL(page.url()).protocol, "app:");
  await page.locator(".desktop-library").waitFor();
  step("A1 offline launch from the bundled app:// studio", { url: page.url(), launchMs });

  await createProject(page, "Desktop QA", ["fantasy-720.webp", "horror-720.webp", "romance-720.webp"].map(gallery));
  step("A2 project created and 3 images imported offline", { importMs: timings.importMs });

  await openComposition(page);
  await focusPanel(page, 2);
  await page.getByLabel("Top extension (px)", { exact: true }).fill("300");
  await page.getByLabel("Top extension (px)", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
  await compositionSaved(page);
  await focusPanel(page, 3);
  await page.getByRole("button", { name: "Add bottom fade", exact: true }).click();
  await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
  await compositionSaved(page);
  let dump = await dumpWorkspace(page);
  assert.deepEqual(fadeState(dump), { topExtension: 300, fades: 1 });
  step("A3 Composition & FX: 300 px extension and a bottom fade saved", fadeState(dump));

  await page.getByRole("button", { name: "Images", exact: true }).click();
  await page.getByRole("button", { name: "Open in Raster Studio", exact: true }).waitFor({ timeout: 30_000 });
  await openComposition(page);
  assert.equal(await showFade(page), 350);
  dump = await dumpWorkspace(page);
  assert.deepEqual(fadeState(dump), { topExtension: 300, fades: 1 });
  if (await page.getByRole("button", { name: "Return to Chapter", exact: true }).isVisible())
    await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
  step("A4 fade and extension persist across Images ⇄ Composition navigation");

  await stubSave(app, projectFile);
  let t = Date.now();
  await page.keyboard.press("Control+s");
  await page.getByText(/Saved to Desktop QA\.inkstrip/).waitFor({ timeout: 60_000 });
  timings.firstSaveMs = Date.now() - t;
  assert.ok(existsSync(projectFile));
  assert.equal(readFileSync(projectFile).subarray(0, 16).toString(), "INKSTRIP-BACKUP\n");
  await waitStatus(page, /Saved · Desktop QA\.inkstrip/);
  step("A5 Ctrl+S saves a verified .inkstrip file", { bytes: statSync(projectFile).size, saveMs: timings.firstSaveMs });

  // Edit again → unsaved → save over the file → previous version kept as backup.
  await focusPanel(page, 2);
  await page.getByLabel("Top extension (px)", { exact: true }).fill("320");
  await page.getByLabel("Top extension (px)", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
  await compositionSaved(page);
  await waitStatus(page, /Unsaved changes/);
  const titleDirty = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
  assert.match(titleDirty, /^● Desktop QA/);
  t = Date.now();
  await page.keyboard.press("Control+s");
  await waitStatus(page, /Saved · Desktop QA\.inkstrip/, 60_000);
  timings.resaveMs = Date.now() - t;
  const backupRoot = join(profileA, "Roaming", "Inkstrip Manhwa Studio", "backups");
  const backupFiles = readdirSync(backupRoot, { recursive: true }).filter((f) => String(f).endsWith(".inkstrip"));
  assert.equal(backupFiles.length, 1);
  step("A6 unsaved-change tracking (status bar + ● title) and backup of the previous version", {
    title: titleDirty,
    backups: backupFiles.length,
  });

  await autoDownloads(app, join(out, "exports"));
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Output width", { exact: true }).fill("640");
  t = Date.now();
  await page.getByRole("button", { name: "Export images", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Exported "), null, { timeout: 120_000 });
  timings.exportMs = Date.now() - t;
  const exported = readdirSync(join(out, "exports"));
  assert.ok(exported.length >= 1 && statSync(join(out, "exports", exported[0])).size > 1000);
  await page.keyboard.press("Escape");
  step("A7 chapter export written to disk offline", { files: exported, exportMs: timings.exportMs });

  const savedDump = await dumpWorkspace(page);
  writeFileSync(join(out, "workspace-a.json"), JSON.stringify(savedDump, null, 1));
  await page.screenshot({ path: join(out, "a-composition.png") });
  assert.deepEqual(errors, []);
  await closeApp(app);
  const sessionA = JSON.parse(readFileSync(join(profileA, "Roaming", "Inkstrip Manhwa Studio", "metadata", "session.json"), "utf8"));
  assert.equal(sessionA.clean, true);
  step("A8 clean close with no unsaved work and no console errors");

  // ───────────── Scenario B: open the file in a brand-new profile ─────────────
  const profileB = join(out, "profile-b");
  ({ app, page, errors } = await launch(profileB, [projectFile]));
  t = Date.now();
  await page.waitForURL(/\/p\/[^/]+$/, { timeout: 120_000 });
  timings.openMs = Date.now() - t;
  await waitStatus(page, /Saved · Desktop QA\.inkstrip/);
  const reopened = await dumpWorkspace(page);
  writeFileSync(join(out, "workspace-b.json"), JSON.stringify(reopened, null, 1));
  assert.deepEqual(reopened.projects, savedDump.projects);
  assert.deepEqual(reopened.chapters, savedDump.chapters);
  assert.deepEqual(reopened.panels, savedDump.panels);
  assert.deepEqual(reopened.blobs, savedDump.blobs);
  assert.deepEqual(fadeState(reopened), { topExtension: 320, fades: 1 });
  step("B1 file opened from the command line in a new profile: records and artwork identical", {
    records: reopened.projects.length + reopened.chapters.length + reopened.panels.length,
    images: Object.keys(reopened.blobs).length,
    openMs: timings.openMs,
  });

  await page.locator("a[href*='/c/'], [href*='/c/']").first().click();
  await openComposition(page);
  assert.equal(await showFade(page), 350);
  await page.screenshot({ path: join(out, "b-reopened-composition.png") });
  step("B2 reopened composition shows the saved fade in the editor");

  // Unsaved edit, then the process is killed (crash / power loss).
  if (await page.getByRole("button", { name: "Return to Chapter", exact: true }).isVisible())
    await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
  await focusPanel(page, 2);
  await page.getByLabel("Top extension (px)", { exact: true }).fill("333");
  await page.getByLabel("Top extension (px)", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
  await compositionSaved(page);
  await waitStatus(page, /Unsaved changes/);
  assert.deepEqual(errors, []);
  // Simulated crash / power loss: the whole process tree dies at once.
  const pid = app.process().pid;
  const gone = new Promise((r) => app.process().once("exit", r));
  execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  await gone;
  await new Promise((r) => setTimeout(r, 3000));

  ({ app, page, errors } = await launch(profileB));
  await page.getByRole("heading", { name: "Inkstrip didn't close normally" }).waitFor({ timeout: 30_000 });
  assert.match(await page.getByRole("dialog").innerText(), /Desktop QA/);
  await page.screenshot({ path: join(out, "b-crash-recovery.png") });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const afterCrash = await dumpWorkspace(page);
  assert.equal(fadeState(afterCrash).topExtension, 333);
  step("B3 after a killed process: recovery notice lists the project and the unsaved edit survived");

  // A damaged file is rejected before anything is imported.
  const bytes = readFileSync(projectFile);
  const damaged = join(out, "files", "damaged.inkstrip");
  writeFileSync(damaged, bytes.subarray(0, bytes.length - 1000));
  await stubOpen(app, damaged);
  await page.keyboard.press("Control+o");
  await page.getByText(/incomplete or damaged|not a valid/i).first().waitFor({ timeout: 20_000 });
  const afterDamaged = await dumpWorkspace(page);
  assert.deepEqual(afterDamaged.projects.map((p) => p.id), afterCrash.projects.map((p) => p.id));
  step("B4 truncated project file rejected; workspace unchanged");

  // Closing with unsaved work asks first; "close without saving to file" keeps the workspace copy.
  const exited = new Promise((r) => app.process().once("exit", r));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await page.getByRole("heading", { name: "Save changes before closing?" }).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(out, "b-close-prompt.png") });
  await page.getByRole("button", { name: "Close without saving to file", exact: true }).click();
  await exited;
  ({ app, page, errors } = await launch(profileB));
  const kept = await dumpWorkspace(page);
  assert.equal(fadeState(kept).topExtension, 333);
  await page.getByRole("heading", { name: "Inkstrip didn't close normally" }).waitFor({ timeout: 4000 }).then(
    () => assert.fail("a clean close must not show the crash notice"),
    () => {},
  );
  assert.deepEqual(errors, []);
  // Unsaved changes still exist → the prompt appears again; that is expected.
  const finished = new Promise((r) => app.process().once("exit", r));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await page.getByRole("button", { name: "Close without saving to file", exact: true }).click();
  await finished;
  step("B5 close prompt for unsaved work; declining keeps the edit in the workspace (no data loss)");
} catch (error) {
  failure = error;
  console.error("✗", error);
  await currentPage?.()
    ?.screenshot({ path: join(out, "failure.png") })
    .catch(() => {});
} finally {
  writeFileSync(join(out, "e2e-results.json"), JSON.stringify({ exe: exe ?? "unpackaged", results, timings, failure: failure ? String(failure.stack ?? failure) : null }, null, 2));
  console.log(`Results: ${join(out, "e2e-results.json")}`);
}
process.exit(failure ? 1 : 0);
