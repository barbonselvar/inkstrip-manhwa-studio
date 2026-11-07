// Quick launch probe: starts the built (unpackaged) app with an isolated profile.
import { _electron as electron } from "../../../node_modules/playwright/index.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const profile = mkdtempSync(join(tmpdir(), "inkstrip-smoke-"));
const app = await electron.launch({
  executablePath: join(import.meta.dirname, "..", "node_modules", "electron", "dist", "electron.exe"),
  args: [join(import.meta.dirname, "..")],
  env: { ...process.env, APPDATA: join(profile, "Roaming"), LOCALAPPDATA: join(profile, "Local") },
});
const page = await app.firstWindow();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.waitForLoadState("domcontentloaded");
await page.waitForSelector(".hero-title, .studio-boot", { timeout: 30000 });
await page.waitForTimeout(4000);
console.log("title:", await page.title());
console.log("url:", page.url());
console.log("bridge:", await page.evaluate(() => !!window.inkstripDesktop?.isDesktop));
console.log("hero:", await page.locator(".hero-title").count(), "desktop panel:", await page.locator(".desktop-library").count());
console.log("errors:\n" + errors.join("\n"));
await page.screenshot({ path: join(process.argv[2] ?? profile, "launch.png") });
await app.close();
