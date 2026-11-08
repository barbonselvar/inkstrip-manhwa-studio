#!/usr/bin/env node
/**
 * Prepare a desktop release candidate:  node apps/desktop/scripts/prepare-release.mjs 1.0.1
 *
 * - checks the version is a plain x.y.z newer than the current one,
 * - sets apps/desktop/package.json "version",
 * - adds a "## <version>" section to RELEASE_NOTES.md if it is missing.
 *
 * Commit the result in a pull request. Publishing happens only when the owner runs and
 * approves the "Desktop release" workflow (see docs/desktop/update-system.md).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const next = process.argv[2] ?? "";
const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
const pkgPath = join(desktop, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const a = parse(next),
  b = parse(pkg.version);
if (!a || !b) {
  console.error("Usage: prepare-release.mjs <major.minor.patch>");
  process.exit(1);
}
const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
if (newer <= 0) {
  console.error(`${next} is not newer than the current version ${pkg.version}.`);
  process.exit(1);
}
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
const notesPath = join(desktop, "RELEASE_NOTES.md");
const notes = readFileSync(notesPath, "utf8");
if (!notes.includes(`\n## ${next}`)) {
  const marker = notes.indexOf("\n## ");
  const section = `\n## ${next} — ${new Date().toISOString().slice(0, 10)}\n\n- Describe what changed.\n`;
  writeFileSync(notesPath, marker < 0 ? notes + section : notes.slice(0, marker) + section + notes.slice(marker));
}
console.log(`Release candidate ${next} prepared. Edit RELEASE_NOTES.md, commit, open a PR, then run "Desktop release".`);
