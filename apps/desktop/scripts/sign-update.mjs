#!/usr/bin/env node
/**
 * Sign (and verify) a desktop update installer with the Ed25519 update-signing key.
 *
 *   INKSTRIP_UPDATE_SIGNING_KEY=<PEM> node apps/desktop/scripts/sign-update.mjs <installer.exe> <version>
 *   node apps/desktop/scripts/sign-update.mjs <installer.exe> <version> --key-file <private.pem>
 *
 * Writes `<installer>.sig` next to it and immediately verifies it against the public key
 * built into the app (src/main/update-signature.ts), so a release can never be published
 * with a key the installed apps would reject. Never prints key material.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const { signInstaller, verifyInstaller, SIGNATURE_SUFFIX } = await import(
  pathToFileURL(join(desktop, "src", "main", "update-signature.ts")).href
);
const [installer, version] = process.argv.slice(2);
const keyFileIndex = process.argv.indexOf("--key-file");
if (!installer || !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: sign-update.mjs <installer.exe> <x.y.z> [--key-file <pem>]");
  process.exit(2);
}
const pem = keyFileIndex > 0 ? readFileSync(process.argv[keyFileIndex + 1], "utf8") : process.env.INKSTRIP_UPDATE_SIGNING_KEY;
if (!pem) {
  console.error("No signing key: set INKSTRIP_UPDATE_SIGNING_KEY or pass --key-file.");
  process.exit(2);
}
const path = resolve(installer);
const signature = await signInstaller(path, version, pem);
const sigPath = path + SIGNATURE_SUFFIX;
writeFileSync(sigPath, JSON.stringify(signature, null, 2));
await verifyInstaller(path, JSON.parse(readFileSync(sigPath, "utf8")), { appVersion: version, file: signature.file });
console.log(`Signed and verified ${signature.file} (${version}) → ${sigPath}`);
