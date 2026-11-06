/** Non-mutating Auth error-redirect diagnostics. No email, real token or user lookup. */
import { pathToFileURL } from "node:url";
import { safeOrigin } from "../src/lib/accounts/policy.ts";
export async function checkAccountRedirects(env, transport = fetch) {
  if (env.INKSTRIP_LIVE_REDIRECT_QA_ENABLED !== "true")
    return { blocked: true, reason: "Explicit redirect QA opt-in is required." };
  let provider, origin;
  try {
    provider = safeOrigin(env.SUPABASE_URL, true);
    origin = safeOrigin(env.INKSTRIP_ACCOUNT_ORIGIN, true);
  } catch {
    return {
      blocked: true,
      reason: "Canonical HTTPS provider and application origins are required.",
    };
  }
  const checks = [];
  for (const [name, type, callback] of [
    ["Production Site URL", "signup", false],
    ["Signup callback allow-list", "signup", true],
    ["Recovery callback allow-list", "recovery", true],
  ]) {
    const expected = new URL(
      callback ? origin + "/api/account/email-callback?flow=" + "a".repeat(64) : origin + "/",
    );
    const request = new URL(provider + "/auth/v1/verify");
    // Intentionally invalid and not associated with an account; never a real OTP.
    request.searchParams.set("token", "inkstrip-nonexistent-redirect-diagnostic");
    request.searchParams.set("type", type);
    if (callback) request.searchParams.set("redirect_to", expected.href);
    try {
      const response = await transport(request, {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      const location = response.headers.get("location");
      const resolved = location ? new URL(location) : null;
      checks.push({
        name,
        passed:
          [302, 303].includes(response.status) &&
          !!resolved &&
          resolved.origin === expected.origin &&
          resolved.pathname === expected.pathname &&
          (!callback || resolved.searchParams.get("flow") === expected.searchParams.get("flow")),
        status: response.status,
        resolvedOrigin: resolved?.origin ?? null,
        resolvedPath: resolved?.pathname ?? null,
      });
    } catch {
      checks.push({
        name,
        passed: false,
        reason: "Provider diagnostic failed; raw details suppressed.",
      });
    }
  }
  return { blocked: false, ok: checks.every((c) => c.passed), diagnosticOnly: true, checks };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkAccountRedirects(process.env);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.blocked ? 2 : result.ok ? 0 : 1;
}
