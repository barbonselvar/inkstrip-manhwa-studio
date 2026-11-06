import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAccountRedirects } from "./accounts-redirect-check.mjs";
const env = {
  INKSTRIP_LIVE_REDIRECT_QA_ENABLED: "true",
  SUPABASE_URL: "https://provider.test",
  INKSTRIP_ACCOUNT_ORIGIN: "https://inkstrip.test",
};
test("redirect QA refuses missing opt-in, insecure origins and production loopbacks before network", async () => {
  for (const patch of [
    { INKSTRIP_LIVE_REDIRECT_QA_ENABLED: "false" },
    { INKSTRIP_ACCOUNT_ORIGIN: "https://localhost:3000" },
    { SUPABASE_URL: "http://provider.test" },
  ]) {
    const r = await checkAccountRedirects({ ...env, ...patch }, () => {
      throw Error("Network must not run");
    });
    assert.equal(r.blocked, true);
  }
});
test("redirect QA checks provider defaults and both email callback types without emails or tokens", async () => {
  const calls = [];
  const r = await checkAccountRedirects(env, async (url, options) => {
    assert.equal(options.redirect, "manual");
    assert.equal(url.pathname, "/auth/v1/verify");
    assert.equal(url.searchParams.get("token"), "inkstrip-nonexistent-redirect-diagnostic");
    calls.push(url.searchParams.get("type"));
    return new Response(null, {
      status: 303,
      headers: {
        location:
          (url.searchParams.get("redirect_to") ?? "https://inkstrip.test/") +
          "#error=access_denied",
      },
    });
  });
  assert.equal(r.ok, true);
  assert.equal(r.diagnosticOnly, true);
  assert.deepEqual(calls, ["signup", "signup", "recovery"]);
});
test("redirect QA detects provider fallback to localhost and missing callback allow-list", async () => {
  for (const target of ["http://localhost:3000/", "https://inkstrip.test/"]) {
    const r = await checkAccountRedirects(
      env,
      async () =>
        new Response(null, {
          status: 303,
          headers: { location: target + "#error_description=private-diagnostic" },
        }),
    );
    assert.equal(r.ok, false);
    assert.ok(r.checks.slice(1).every((c) => !c.passed));
    assert.ok(!JSON.stringify(r).includes("private-diagnostic"));
  }
});
