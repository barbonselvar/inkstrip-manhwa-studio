#!/usr/bin/env node
/**
 * Signed-update test on the PACKAGED app with loopback feeds (stops before installing).
 *
 *   node apps/desktop/test/update-signature-e2e.mjs --exe <packaged exe> --update <dir with latest.yml + installer + .sig>
 *        --bad <dir whose .sig was made with a different key> [--out <dir>]
 *
 * 1. Good feed: the app finds the newer version, downloads it, verifies the Ed25519
 *    signature against its built-in key, and reaches "ready to install".
 * 2. Bad feed (same installer, signature from another key): the download is rejected,
 *    deleted, and the app reports that the signature check failed.
 * The installer is never run, so no installation on this computer is touched.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { windowPages } from "./window-pages.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const { _electron: electron } = await import(pathToFileURL(join(root, "node_modules", "playwright", "index.mjs")).href);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const exe = arg("--exe"),
  good = arg("--update"),
  bad = arg("--bad");
assert.ok(exe && good && bad, "--exe, --update and --bad are required");
const out = resolve(arg("--out") ?? join(tmpdir(), `inkstrip-update-sig-${Date.now()}`));
mkdirSync(out, { recursive: true });
const results = [];

function serve(dir, port) {
  const child = spawn(process.execPath, [join(here, "update-feed-server.mjs"), dir, String(port)], { stdio: "pipe" });
  return new Promise((r) => child.stdout.once("data", () => r(child)));
}

async function run(feed, profile) {
  const app = await electron.launch({
    executablePath: exe,
    env: { ...process.env, INKSTRIP_PROFILE_DIR: profile, INKSTRIP_UPDATE_TEST_FEED: feed },
    timeout: 60_000,
  });
  const { studio } = await windowPages(app);
  await studio.waitForSelector(".desktop-toasts", { state: "attached", timeout: 60_000 });
  const state = await studio.evaluate(async () => {
    for (let i = 0; i < 240; i++) {
      const s = await window.inkstripDesktop.updateState();
      if (["downloaded", "error", "not-available"].includes(s.status)) return s;
      await new Promise((r) => setTimeout(r, 500));
    }
    return window.inkstripDesktop.updateState();
  });
  await app.evaluate(({ app }) => app.exit(0));
  return state;
}

let failure = null;
const servers = [];
try {
  servers.push(await serve(good, 8766), await serve(bad, 8767));
  const ok = await run("http://127.0.0.1:8766/", join(out, "good"));
  assert.equal(ok.status, "downloaded", JSON.stringify(ok));
  results.push({ step: "signed update downloaded and verified with the built-in key", ok: true, version: ok.version });
  console.log(`✓ signed update ${ok.version} verified and ready to install`);
  const rejected = await run("http://127.0.0.1:8767/", join(out, "bad"));
  assert.equal(rejected.status, "error", JSON.stringify(rejected));
  assert.match(rejected.message, /signature check failed/);
  results.push({ step: "update signed with another key rejected and discarded", ok: true, message: rejected.message });
  console.log(`✓ foreign-key update rejected: ${rejected.message}`);
} catch (error) {
  failure = error;
  console.error("✗", error);
} finally {
  for (const s of servers) s.kill();
  writeFileSync(join(out, "update-signature-results.json"), JSON.stringify({ exe, results, failure: failure ? String(failure.stack ?? failure) : null }, null, 2));
}
process.exit(failure ? 1 : 0);
