#!/usr/bin/env node
/**
 * Build the studio as a static desktop renderer and stage it for packaging.
 *
 *   1. `vite build` at the repository root with INKSTRIP_TARGET=desktop
 *      (TanStack Start SPA mode, no server) → dist/desktop-renderer/client
 *   2. copy it to apps/desktop/build/renderer
 *   3. pin every inline bootstrap <script> by SHA-256 for the Content Security Policy
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(desktop, "..", "..");
const out = join(desktop, "build", "renderer");

const vite = join(root, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(vite)) {
  console.error("Root dependencies are missing. Run `npm ci` in the repository root first.");
  process.exit(1);
}
const result = spawnSync(process.execPath, [vite, "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, INKSTRIP_TARGET: "desktop", VITE_AUTH_ENABLED: "false" },
});
if (result.status !== 0) process.exit(result.status ?? 1);

const client = join(root, "dist", "desktop-renderer", "client");
const index = join(client, "index.html");
if (!existsSync(index)) {
  console.error("The desktop renderer build produced no index.html.");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(client, out, { recursive: true });

const html = readFileSync(join(out, "index.html"), "utf8");
const scriptHashes = [];
for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
  const body = match[1];
  if (!body) continue;
  // The HTML parser replaces U+0000 in script text with U+FFFD before CSP hashing, and
  // TanStack's dehydrated router state contains NUL separators ("__root__\0").
  const parsed = body.replace(/\u0000/g, "\uFFFD");
  scriptHashes.push(`sha256-${createHash("sha256").update(parsed, "utf8").digest("base64")}`);
}
writeFileSync(join(out, ".inkstrip-csp.json"), JSON.stringify({ scriptHashes }, null, 2));
cpSync(join(desktop, "resources", "icons", "icon.ico"), join(desktop, "build", "icon.ico"));
console.log(`Desktop renderer staged at ${out} (${scriptHashes.length} inline scripts pinned).`);
