/** Updater orchestration with isolated files and deterministic transport failures.
 * Cryptographic acceptance/rejection is separately covered by main-modules.test.ts.
 * No real update is installed and no real user profile or signing key is used.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { DEFAULT_SETTINGS } from "../../../src/lib/desktop/contract.ts";
import * as feed from "../src/main/update-feed.ts";

const require = createRequire(import.meta.url);
const source = ts.transpileModule(await readFile(new URL("../src/main/updater.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "inkstrip-updater-service-"));
  const installer = join(root, "Inkstrip-Manhwa-Studio-Setup-1.1.1.exe");
  const project = join(root, "existing-project.inkstrip");
  await writeFile(installer, "test installer");
  await writeFile(project, "existing user work");
  let installCalls = 0, verificationCalls = 0;
  const updater = {
    on() {}, setFeedURL() {},
    async checkForUpdates() {
      return { isUpdateAvailable: true, updateInfo: { version: "1.1.1", path: "Inkstrip-Manhwa-Studio-Setup-1.1.1.exe" } };
    },
    async downloadUpdate() { return [installer]; },
    quitAndInstall() { installCalls++; },
  };
  const verifier = { async verifyInstaller() { verificationCalls++; return true; }, UPDATE_PUBLIC_KEY: "test key", SIGNATURE_SUFFIX: ".sig" };
  class CancellationToken {
    cancelled = false;
    cancel() { this.cancelled = true; this.onCancel?.(); }
  }
  const mocks = {
    electron: { app: { isPackaged: true }, net: { isOnline: () => true } },
    "electron-updater": { autoUpdater: updater, CancellationToken },
    "./update-feed.ts": feed,
    "./update-signature.ts": verifier,
    "./logger.ts": { log: { info() {}, warn() {}, error() {} } },
  };
  const module = { exports: {} };
  vm.runInNewContext("(function(require, module, exports) {" + source + "\n})", {
    process: { env: { INKSTRIP_UPDATE_TEST_FEED: "http://127.0.0.1:8766/" } },
    fetch: async () => ({ ok: true, json: async () => ({ signature: "test transport metadata" }) }),
    URL, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval,
  })((id) => mocks[id] ?? require(id), module, module.exports);
  const service = new module.exports.UpdateService({
    settings: async () => ({ ...DEFAULT_SETTINGS, updates: { autoCheck: false, autoDownload: false } }),
    emit() {}, signature: Promise.resolve("unsigned"),
  });
  await service.init();
  await service.check(true);
  assert.equal(service.current.status, "available");
  return { service, updater, verifier, installer, project,
    installCalls: () => installCalls, verificationCalls: () => verificationCalls };
}

test("an interrupted download reports failure and preserves the existing project", async () => {
  const f = await fixture();
  f.updater.downloadUpdate = async () => { throw new Error("ECONNRESET"); };
  const state = await f.service.download();
  assert.equal(state.status, "error");
  assert.match(state.message, /installed version is unchanged/);
  assert.equal(await readFile(f.project, "utf8"), "existing user work");
  assert.equal(f.installCalls(), 0);
  await f.service.check(true);
  assert.equal((await f.service.download()).status, "error");
});

test("cancellation permits a fresh download and never installs automatically", async () => {
  const f = await fixture();
  f.updater.downloadUpdate = (token) => new Promise((_, reject) => {
    token.onCancel = () => reject(new Error("cancelled"));
  });
  const pending = f.service.download();
  f.service.cancelDownload();
  assert.equal((await pending).status, "available");
  f.updater.downloadUpdate = async () => [f.installer];
  assert.equal((await f.service.download()).status, "downloaded");
  assert.equal(f.installCalls(), 0, "download completion is not installation approval");
});

test("failed verification removes the downloaded installer and preserves project data", async () => {
  const f = await fixture();
  f.verifier.verifyInstaller = async () => { throw new Error("wrong key or tampered file"); };
  const state = await f.service.download();
  assert.equal(state.status, "error");
  assert.match(state.message, /signature check failed/);
  await assert.rejects(readFile(f.installer), { code: "ENOENT" });
  assert.equal(await readFile(f.project, "utf8"), "existing user work");
  assert.equal(f.installCalls(), 0);
});

test("a failed pre-install verification leaves the running version active", async () => {
  const f = await fixture();
  await f.service.download();
  f.verifier.verifyInstaller = async () => { throw new Error("installer changed after download"); };
  let quitPrepared = false;
  await assert.rejects(f.service.install(() => { quitPrepared = true; }), /installer changed/);
  assert.equal(quitPrepared, false);
  assert.equal(f.installCalls(), 0);
  assert.equal(await readFile(f.project, "utf8"), "existing user work");
});

test("only an explicit install request re-verifies and starts the installer", async () => {
  const f = await fixture();
  await f.service.download();
  assert.equal(f.verificationCalls(), 1);
  assert.equal(f.installCalls(), 0);
  await f.service.install();
  assert.equal(f.verificationCalls(), 2);
  assert.equal(f.installCalls(), 1);
});

test("an unverified update cannot be installed", async () => {
  const f = await fixture();
  await assert.rejects(f.service.install(), /No verified update/);
  assert.equal(f.installCalls(), 0);
});
