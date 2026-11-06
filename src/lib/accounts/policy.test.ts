import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountConfig } from "./config.server.ts";
import {
  CHUNK_BYTES,
  avatarUrl,
  emailAddress,
  strongPassword,
  displayName,
  validateManifest,
  canonicalManifest,
  safeOrigin,
  storagePath,
} from "./policy.ts";
test("account input policy validates Unicode names and strong passwords without transforming secrets", () => {
  assert.equal(emailAddress(" Creator@Example.com "), "creator@example.com");
  assert.equal(displayName(" 회귀 무사 "), "회귀 무사");
  assert.equal(strongPassword("Warrior 2026!"), "Warrior 2026!");
  for (const p of ["password", "ALLUPPERCASE12!", "Short12!", "longbutweakpassword"])
    assert.throws(() => strongPassword(p));
  assert.throws(() => displayName("a\nname"));
  for (const v of ["invalid", "http://test.test", "https://user:pass@test.test"])
    assert.throws(() => avatarUrl(v));
  assert.equal(avatarUrl(""), null);
});
test("manifests enforce bounded chunks, exact lengths and canonical serialization", () => {
  const m = { version: 1, bytes: 20, parts: [{ digest: "a".repeat(64), bytes: 20 }] };
  assert.equal(canonicalManifest(validateManifest(m)), JSON.stringify(m));
  for (const bad of [
    { ...m, bytes: 21 },
    { ...m, parts: [] },
    { ...m, parts: [{ digest: "bad", bytes: 20 }] },
    { ...m, bytes: CHUNK_BYTES + 1, parts: [{ digest: "a".repeat(64), bytes: CHUNK_BYTES + 1 }] },
  ])
    assert.throws(() => validateManifest(bad));
  assert.throws(() => storagePath("../", "../", "bad"));
});
test("configuration fails closed without credentials and refuses noncanonical or insecure production origins", () => {
  assert.equal(accountConfig({}).ready, false);
  for (const u of [
    "http://example.com",
    "https://example.com/path",
    "https://user@example.com",
    "https://example.com?next=bad",
    "https://localhost:3000",
    "https://localhost.",
    "https://editor.localhost",
    "https://127.0.0.1:8080",
    "https://127.1",
    "https://[::1]",
    "https://0.0.0.0",
    "https://[::]",
  ])
    assert.throws(() => safeOrigin(u, true));
  assert.equal(safeOrigin("http://localhost:8080", false), "http://localhost:8080");
  assert.throws(() => safeOrigin("ftp://localhost", false));
});
test("email templates retain provider-generated verification URLs rather than hardcoded redirects", async () => {
  for (const name of ["confirm-signup", "recover-password"]) {
    const html = await readFile(
      new URL(`../../../supabase/templates/${name}.html`, import.meta.url),
      "utf8",
    );
    assert.match(html, /href="\{\{ \.ConfirmationURL \}\}"/);
    assert.match(html, /\{\{ \.Token \}\}/);
    assert.doesNotMatch(html, /localhost|127\.0\.0\.1|\.SiteURL|access_token=|refresh_token=/);
  }
});
