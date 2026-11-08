#!/usr/bin/env node
/** Quick structural probe of the window shell: lists pages, title-bar state, view bounds. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { _electron: electron } = await import(pathToFileURL(join(desktop, "..", "..", "node_modules", "playwright", "index.mjs")).href);
const kill = setTimeout(() => (console.log("TIMEOUT"), process.exit(2)), 60_000);
const app = await electron.launch({
  executablePath: join(desktop, "node_modules", "electron", "dist", "electron.exe"),
  args: [desktop],
  env: { ...process.env, INKSTRIP_PROFILE_DIR: mkdtempSync(join(tmpdir(), "inkstrip-probe-")) },
});
await new Promise((r) => setTimeout(r, 5000));
console.log("pages:", app.windows().map((w) => w.url()));
console.log(
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { title: w.getTitle(), size: w.getContentSize(), views: w.contentView.children.map((v) => v.getBounds()) };
  }),
);
const shell = app.windows().find((w) => w.url().includes("/__shell/"));
if (shell) console.log("titlebar:", await shell.evaluate(() => ({ design: document.body.dataset.design, ready: document.body.classList.contains("ready"), text: document.body.innerText.replace(/\s+/g, " ").slice(0, 200) })));
clearTimeout(kill);
await app.evaluate(({ app }) => app.exit(0));
process.exit(0);
