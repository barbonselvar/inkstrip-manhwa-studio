import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Packaged Electron cannot use Playwright's -r readiness loader. Attaching while
 * its shell and WebContentsView are navigating can strand driver initialization.
 * The shim delays only the browser-debugger announcement until the app's existing
 * startup log (after both loadURL calls). No product code, flags, checks, retries,
 * timeout or assertions are changed. An app that never starts still fails launch.
 */
export async function launchElectron(electron, options) {
  if (process.platform !== "win32") return electron.launch(options);
  const folder = mkdtempSync(join(tmpdir(), "inkstrip-driver-"));
  const launcher = join(folder, "launch.cmd");
  const quote = (value) => String(value).replaceAll("%", "%%");
  const shim = fileURLToPath(new URL("./electron-launch-shim.mjs", import.meta.url));
  writeFileSync(launcher, '@echo off\r\n@"' + quote(process.execPath) + '" "' + quote(shim) + '" "' + quote(resolve(options.executablePath)) + '" %*\r\n');
  const cleanup = () => {
    try { rmSync(folder, { recursive: true, force: true }); }
    catch (error) { console.warn("[desktop driver] Temporary launcher cleanup failed:", error.message); }
  };
  try {
    const app = await electron.launch({ ...options, executablePath: launcher });
    app.process().once("exit", cleanup);
    if (app.process().exitCode !== null) cleanup();
    return app;
  } catch (error) {
    cleanup();
    throw error;
  }
}
