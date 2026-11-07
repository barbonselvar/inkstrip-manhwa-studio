#!/usr/bin/env node
/** Bundle the Electron main process and the sandboxed preload script (CommonJS). */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(desktop, "..", "..");
const { build } = await import(pathToFileURL(join(root, "node_modules", "rolldown", "dist", "index.mjs")).href);

let commit = process.env.GITHUB_SHA ?? "";
if (!/^[a-f0-9]{40}$/.test(commit)) {
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    commit = "unknown";
  }
}

const external = (id) => id === "electron" || id === "electron-updater" || id.startsWith("node:") || /^(fs|path|os|crypto|stream|url|child_process|zlib|util|events|buffer)$/.test(id);

for (const [input, file] of [
  ["src/main/index.ts", "build/main/index.js"],
  ["src/preload/index.ts", "build/preload/index.cjs"],
]) {
  mkdirSync(join(desktop, dirname(file)), { recursive: true });
  await build({
    input: join(desktop, input),
    platform: "node",
    external,
    transform: { define: { __INKSTRIP_COMMIT__: JSON.stringify(commit) } },
    output: { file: join(desktop, file), format: "cjs", sourcemap: true, minify: false },
    logLevel: "warn",
  });
  console.log(`built ${file}`);
}
