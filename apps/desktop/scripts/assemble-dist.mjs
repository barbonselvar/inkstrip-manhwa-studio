#!/usr/bin/env node
/**
 * Assemble the Windows deliverables after `electron-builder`:
 *
 *   dist/windows/
 *     Inkstrip-Manhwa-Studio-Setup.exe        ← byte-identical copy of the versioned installer
 *     release-notes.md                        ← this version's notes (RELEASE_NOTES.md)
 *     checksums.txt                           ← SHA-256 of every file below
 *     update/                                 ← exactly what a desktop-v<version> release publishes
 *       latest.yml
 *       Inkstrip-Manhwa-Studio-Setup-<version>.exe
 *       Inkstrip-Manhwa-Studio-Setup-<version>.exe.blockmap
 *
 * The updater metadata (latest.yml) references the versioned installer name, so that
 * file is copied unchanged; the fixed-name Setup.exe is only a convenience copy.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(desktop, "..", "..");
const { version } = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const built = join(root, "dist", "windows", "electron-builder");
const out = join(root, "dist", "windows");
const update = join(out, "update");
const installer = `Inkstrip-Manhwa-Studio-Setup-${version}.exe`;

for (const name of [installer, `${installer}.blockmap`, "latest.yml"])
  if (!existsSync(join(built, name))) {
    console.error(`Missing ${name} in ${built}. Run electron-builder first.`);
    process.exit(1);
  }

const latest = readFileSync(join(built, "latest.yml"), "utf8");
if (!latest.includes(`version: ${version}`) || !latest.includes(`path: ${installer}`)) {
  console.error("latest.yml does not describe this version's installer.");
  process.exit(1);
}
const sha512 = await hash(join(built, installer), "sha512", "base64");
if (!latest.includes(`sha512: ${sha512}`)) {
  console.error("latest.yml sha512 does not match the installer.");
  process.exit(1);
}

rmSync(update, { recursive: true, force: true });
mkdirSync(update, { recursive: true });
for (const name of [installer, `${installer}.blockmap`, "latest.yml"]) copyFileSync(join(built, name), join(update, name));
copyFileSync(join(built, installer), join(out, "Inkstrip-Manhwa-Studio-Setup.exe"));

const notes = releaseNotes(version);
writeFileSync(join(out, "release-notes.md"), notes);
writeFileSync(join(update, "release-notes.md"), notes);

const files = [
  ["Inkstrip-Manhwa-Studio-Setup.exe", join(out, "Inkstrip-Manhwa-Studio-Setup.exe")],
  [`update/${installer}`, join(update, installer)],
  [`update/${installer}.blockmap`, join(update, `${installer}.blockmap`)],
  ["update/latest.yml", join(update, "latest.yml")],
];
const lines = [];
for (const [label, path] of files) lines.push(`${await hash(path, "sha256", "hex")}  ${label}`);
writeFileSync(join(out, "checksums.txt"), `${lines.join("\n")}\n`);
writeFileSync(
  join(update, "SHA256SUMS.txt"),
  `${lines.filter((l) => l.includes("update/")).map((l) => l.replace("update/", "")).join("\n")}\n`,
);
console.log(`Assembled ${out}\n${lines.join("\n")}`);

function hash(path, algorithm, encoding) {
  return new Promise((resolve, reject) => {
    const h = createHash(algorithm);
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest(encoding)));
  });
}

/** The `## <version>` section of apps/desktop/RELEASE_NOTES.md (required for releases). */
export function releaseNotes(v) {
  const text = readFileSync(join(desktop, "RELEASE_NOTES.md"), "utf8");
  const start = text.indexOf(`\n## ${v}`);
  if (start < 0) {
    console.error(`RELEASE_NOTES.md has no "## ${v}" section.`);
    process.exit(1);
  }
  const rest = text.slice(start + 1);
  const end = rest.indexOf("\n## ", 4);
  return `${(end < 0 ? rest : rest.slice(0, end)).trim()}\n`;
}
