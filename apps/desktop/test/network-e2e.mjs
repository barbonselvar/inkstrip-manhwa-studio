#!/usr/bin/env node
/**
 * Network transitions on the PACKAGED app (the updater is active only when packaged):
 *
 *   node apps/desktop/test/network-e2e.mjs --exe "<…\win-unpacked\Inkstrip Manhwa Studio.exe>" [--out <dir>]
 *
 * 1. Online start: the background update check reaches GitHub and settles (no release /
 *    not newer / rate-limited are all "settled"), the app is usable.
 * 2. Connection lost while editing: project creation, image import, composition edits
 *    and Save keep working.
 * 3. Connection lost during an export: the export completes (it is local).
 * 4. Connection lost during an update check: a clear "offline" state, no error dialog,
 *    the studio stays usable.
 * 5. Connection restored: a new update check settles again.
 */
import assert from "node:assert/strict";
import { launchElectron } from "./launch-electron.mjs";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { waitShellStatus, windowPages } from "./window-pages.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const { _electron: electron } = await import(pathToFileURL(join(root, "node_modules", "playwright", "index.mjs")).href);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const exe = arg("--exe");
assert.ok(exe, "--exe <packaged app> is required (the updater only runs packaged)");
const out = resolve(arg("--out") ?? join(tmpdir(), `inkstrip-network-${Date.now()}`));
mkdirSync(join(out, "exports"), { recursive: true });
const results = [];
const ok = (step, data = {}) => {
  results.push({ step, ok: true, ...data });
  console.log(`✓ ${step}`, Object.keys(data).length ? JSON.stringify(data) : "");
};
/** Simulate losing the connection for the page AND the main process (updater requests):
 * network emulation covers page requests, a dead proxy covers main-process requests. */
const setOnline = (app, online) =>
  app.evaluate(async ({ session }, on) => {
    session.defaultSession.enableNetworkEmulation({ offline: !on });
    await session.defaultSession.setProxy(on ? { mode: "system" } : { proxyRules: "http://127.0.0.1:9", proxyBypassRules: "<-loopback>" });
    await session.defaultSession.closeAllConnections();
  }, online);
const settled = (s) => ["not-available", "available", "error", "disabled", "idle"].includes(s?.status);

let failure = null;
let app;
try {
  app = await launchElectron(electron, { executablePath: exe, env: { ...process.env, INKSTRIP_PROFILE_DIR: join(out, "profile") }, timeout: 60_000 });
  const { studio, shell } = await windowPages(app);
  const errors = [];
  studio.on("pageerror", (e) => errors.push(e.message));
  await studio.waitForSelector(".desktop-toasts", { state: "attached", timeout: 60_000 });

  // 1. Online start: the automatic check runs ~8 s after launch.
  const first = await studio.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      const s = await window.inkstripDesktop.updateState();
      if (s.status !== "idle" && s.status !== "checking") return s;
      await new Promise((r) => setTimeout(r, 500));
    }
    return window.inkstripDesktop.updateState();
  });
  assert.ok(settled(first), JSON.stringify(first));
  ok("1 online start: automatic update check settled", { status: first.status, offline: first.offline ?? false });

  // 2. Lose the connection while editing.
  await studio.getByRole("button", { name: "New project", exact: true }).click();
  await studio.getByLabel("Project title").fill("Network QA");
  await studio.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await studio.getByRole("button", { name: "Add images", exact: true }).waitFor({ timeout: 30_000 });
  await setOnline(app, false);
  const files = ["fantasy-720.webp", "horror-720.webp"].map((n, i) => ({
    name: `0${i + 1}-${n}`,
    mimeType: "image/webp",
    buffer: readFileSync(join(root, "public", "gallery", n)),
  }));
  await studio.locator("input[type=file][multiple]").first().setInputFiles(files);
  await studio.getByRole("button", { name: "Display 2", exact: true }).waitFor({ timeout: 60_000 });
  await studio.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await studio.locator("[data-composition=studio]").waitFor({ timeout: 60_000 });
  const file = join(out, "network-qa.inkstrip");
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, file);
  await studio.keyboard.press("Control+s");
  await waitShellStatus(shell, /Saved · network-qa\.inkstrip/, 60_000);
  ok("2 offline mid-session: import, Composition & FX and Save all work", { bytes: statSync(file).size });

  // 3. Lose the connection during an export (start online, cut it immediately).
  await setOnline(app, true);
  await app.evaluate(({ session }, d) => {
    session.defaultSession.on("will-download", (_e, item) => item.setSavePath(`${d}\\${item.getFilename()}`));
  }, join(out, "exports"));
  await studio.getByRole("button", { name: "Export", exact: true }).click();
  await studio.getByRole("button", { name: "Export images", exact: true }).click();
  await setOnline(app, false);
  await studio.waitForFunction(() => document.body.innerText.includes("Exported "), null, { timeout: 120_000 });
  const exported = readdirSync(join(out, "exports"));
  assert.ok(exported.length > 0);
  await studio.keyboard.press("Escape");
  ok("3 connection lost during export: export completed", { files: exported });

  // 4. Update check while offline.
  const offline = await studio.evaluate(() => window.inkstripDesktop.checkForUpdates());
  assert.equal(offline.status, "error");
  assert.equal(offline.offline, true);
  await studio.getByRole("button", { name: "Composition & FX", exact: true }).waitFor();
  ok("4 update check while offline: calm offline state, studio usable", { message: offline.message });

  // 5. Connection restored.
  await setOnline(app, true);
  const again = await studio.evaluate(() => window.inkstripDesktop.checkForUpdates());
  assert.ok(settled(again) && !(again.status === "error" && again.offline), JSON.stringify(again));
  ok("5 connection restored: update check settles online", { status: again.status });
  assert.deepEqual(errors, []);
  const exited = new Promise((r) => app.process().once("exit", r));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;
} catch (error) {
  failure = error;
  console.error("✗", error);
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
} finally {
  writeFileSync(join(out, "network-results.json"), JSON.stringify({ exe, results, failure: failure ? String(failure.stack ?? failure) : null }, null, 2));
  console.log(`Results: ${join(out, "network-results.json")}`);
}
process.exit(failure ? 1 : 0);
