#!/usr/bin/env node
/**
 * Window-design end-to-end test (real Electron app, isolated profile, offline).
 *
 *   node apps/desktop/test/window-designs-e2e.mjs [--exe <exe>] [--out <dir>] [--scales 1,1.25,1.5,2]
 *
 * For every display scale and every one of the five designs:
 * - the setting applies live (no restart) and the title bar page shows that design,
 * - the studio view starts exactly below the title bar (design height, in DIPs) and fills
 *   the rest of the window; the native caption-button overlay matches the design,
 * - maximize / restore / minimize / restore keep the layout, full screen hides the title
 *   bar and gives the studio the whole window, and leaving it restores the bar,
 * - the title-bar command center (or Ctrl+Shift+P) opens the studio's command palette,
 * - the chosen design survives an application restart; "Restore default" works.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { windowPages } from "./window-pages.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const { _electron: electron } = await import(pathToFileURL(join(desktop, "..", "..", "node_modules", "playwright", "index.mjs")).href);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const exe = arg("--exe");
const scales = (arg("--scales") ?? "1,1.25,1.5,2").split(",").map(Number);
const out = resolve(arg("--out") ?? join(tmpdir(), `inkstrip-window-e2e-${Date.now()}`));
mkdirSync(out, { recursive: true });
const DESIGNS = { studio: 42, win11: 38, gx: 40, vscode: 32, minimal: 30 };
const results = [];
const ok = (scale, step, data = {}) => {
  results.push({ scale, step, ok: true, ...data });
  console.log(`✓ [${scale * 100}%] ${step}`, Object.keys(data).length ? JSON.stringify(data) : "");
};

async function launch(profile, scale) {
  const extra = [`--force-device-scale-factor=${scale}`];
  const app = await electron.launch({
    executablePath: exe ?? join(desktop, "node_modules", "electron", "dist", "electron.exe"),
    args: exe ? extra : [desktop, ...extra],
    env: { ...process.env, INKSTRIP_PROFILE_DIR: profile },
    timeout: 60_000,
  });
  await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  const pages = await windowPages(app);
  // .hero-title is in the prerendered HTML; .desktop-library only exists once React has hydrated.
  await pages.studio.waitForSelector(".desktop-library", { timeout: 60_000 });
  // The desktop shell (shortcuts, dialogs) is its own chunk; wait until it is mounted.
  await pages.studio.waitForSelector(".desktop-toasts", { state: "attached", timeout: 30_000 });
  await pages.shell.waitForSelector("body.ready", { timeout: 30_000 });
  const errors = [];
  for (const p of [pages.studio, pages.shell]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && !/unsafe-eval/.test(m.text()) && errors.push(m.text()));
  }
  return { app, ...pages, errors };
}

const geometry = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const [width, height] = w.getContentSize();
    return {
      content: { width, height },
      view: w.contentView.children[0].getBounds(),
      maximized: w.isMaximized(),
      minimized: w.isMinimized(),
      fullscreen: w.isFullScreen(),
    };
  });

const waitFor = async (fn, what, timeout = 10_000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

const setDesign = (studio, design) =>
  studio.evaluate((d) => window.inkstripDesktop.setSettings({ window: { design: d } }), design);

async function checkLayout(app, shell, design, scale, label) {
  const h = DESIGNS[design];
  await waitFor(async () => (await shell.evaluate(() => document.body.dataset.design)) === design, `design ${design}`);
  const g = await waitFor(async () => {
    const x = await geometry(app);
    return x.view.y === h ? x : null;
  }, `studio view at y=${h}`);
  assert.equal(g.view.x, 0);
  assert.equal(g.view.width, g.content.width);
  assert.ok(Math.abs(g.view.y + g.view.height - g.content.height) <= 1, `studio fills the window (${JSON.stringify(g)})`);
  const bar = await shell.evaluate(() => document.querySelector(".bar").getBoundingClientRect().height);
  assert.ok(Math.abs(bar - h) <= 1, `title bar height ${bar} ≈ ${h}`);
  // Interactive controls are never inside the drag region.
  const noDrag = await shell.evaluate(() =>
    [...document.querySelectorAll("button")].filter((b) => b.offsetParent).every((b) => getComputedStyle(b).getPropertyValue("app-region") === "no-drag" || getComputedStyle(b).getPropertyValue("-webkit-app-region") === "no-drag"),
  );
  assert.ok(noDrag, "all visible title-bar buttons are no-drag");
  ok(scale, `${design}: ${label}`, { barHeight: h, view: g.view });
}

let failure = null;
let lastStudio = null;
try {
  for (const scale of scales) {
    const profile = join(out, `profile-${scale}`);
    let { app, studio, shell, errors } = await launch(profile, scale);
    lastStudio = studio;
    for (const design of Object.keys(DESIGNS)) {
      await setDesign(studio, design);
      await checkLayout(app, shell, design, scale, "applied live, layout correct");

      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
      await waitFor(async () => !(await geometry(app)).maximized, "restored");
      await checkLayout(app, shell, design, scale, "restored window layout");
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
      await waitFor(async () => (await geometry(app)).maximized, "maximized");
      await checkLayout(app, shell, design, scale, "maximized window layout");
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
      await waitFor(async () => (await geometry(app)).minimized, "minimized");
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
      await waitFor(async () => !(await geometry(app)).minimized, "restored from minimize");
      await checkLayout(app, shell, design, scale, "minimize → restore");

      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
      const fs = await waitFor(async () => {
        const g = await geometry(app);
        return g.fullscreen && g.view.y === 0 ? g : null;
      }, "full screen");
      assert.ok(await shell.evaluate(() => getComputedStyle(document.querySelector(".bar")).display === "none"));
      ok(scale, `${design}: full screen hides the title bar, studio fills the screen`, { view: fs.view });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
      await waitFor(async () => !(await geometry(app)).fullscreen, "left full screen");
      await checkLayout(app, shell, design, scale, "leaving full screen restores the title bar");

      if (design === "vscode") {
        await shell.click(".command-center");
        await studio.getByRole("heading", { name: "Command palette" }).waitFor({ timeout: 10_000 });
        await studio.keyboard.press("Escape");
        ok(scale, "vscode: command center opens the command palette");
      }
      await shell.screenshot({ path: join(out, `titlebar-${design}-${scale}.png`) });
    }
    await studio.keyboard.press("Control+Shift+P");
    await studio.getByRole("heading", { name: "Command palette" }).waitFor({ timeout: 10_000 });
    await studio.keyboard.press("Escape");
    ok(scale, "Ctrl+Shift+P opens the command palette");

    // Persistence across restart, then Restore default.
    await setDesign(studio, "gx");
    await studio.evaluate(() => window.inkstripDesktop.setSettings({ window: { accent: "#22c55e" } }));
    assert.deepEqual(errors, []);
    await app.evaluate(({ app }) => app.exit(0));
    ({ app, studio, shell, errors } = await launch(profile, scale));
    lastStudio = studio;
    await checkLayout(app, shell, "gx", scale, "design persisted after restart");
    assert.equal(await shell.evaluate(() => getComputedStyle(document.body).getPropertyValue("--accent").trim()), "#22c55e");
    ok(scale, "accent color persisted after restart");
    await studio.keyboard.press("Control+Comma");
    await studio.getByRole("button", { name: "Restore default", exact: true }).click();
    await checkLayout(app, shell, "studio", scale, "Restore default returns to Creative Studio Pro");
    await studio.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    await app.evaluate(({ app }) => app.exit(0));
  }
} catch (error) {
  failure = error;
  console.error("✗", error);
  await lastStudio?.screenshot({ path: join(out, "failure.png") }).catch(() => {});
} finally {
  writeFileSync(join(out, "window-designs-results.json"), JSON.stringify({ exe: exe ?? "unpackaged", scales, results, failure: failure ? String(failure.stack ?? failure) : null }, null, 2));
  console.log(`Results: ${join(out, "window-designs-results.json")} (${results.length} checks)`);
}
process.exit(failure ? 1 : 0);
