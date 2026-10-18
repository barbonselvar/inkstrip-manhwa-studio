import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const output = ".vercel/output";
const config = JSON.parse(readFileSync(join(output, "config.json"), "utf8"));
assert.equal(config.version, 3, "Expected Vercel Build Output API v3");
const server = join(output, "functions/__server.func");
const functionConfig = JSON.parse(readFileSync(join(server, ".vc-config.json"), "utf8"));
assert.ok(existsSync(join(server, functionConfig.handler)), "Missing server handler");
assert.match(functionConfig.runtime, /^nodejs(?:22|24)\.x$/, "Unsupported Node runtime");
assert.ok(existsSync(join(output, "static/__grok/icon-180.png")), "Missing PWA icon");
const assets = readdirSync(join(output, "static/assets"));
assert.ok(assets.some((file) => file.endsWith(".js")), "Missing browser JavaScript");
assert.ok(assets.some((file) => file.endsWith(".css")), "Missing browser styles");

// A bare tslib import would need a separately packaged dependency at runtime.
for (const file of readdirSync(server, { recursive: true })) {
  if (!file.endsWith(".mjs") && !file.endsWith(".js")) continue;
  const code = readFileSync(join(server, file), "utf8");
  assert.equal(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["']tslib(?:\/[^"']*)?["']/.test(code),
    false,
    `Unbundled tslib import in ${file}`,
  );
}
console.log("Vercel server, browser assets, PWA icon, and tslib bundling verified.");
