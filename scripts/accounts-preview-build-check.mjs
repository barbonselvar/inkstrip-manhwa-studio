/** Opt-in, exact-commit Preview verification. Secrets never leave the build worker. */
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { liveConfig, runLiveSecurity, ownedFixture } from "./accounts-live-security-check.mjs";
const branch = "codex/cloud-accounts-cinematic-auth";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function previewQaConfig(env) {
  if (env.INKSTRIP_LIVE_QA_ENABLED !== "true") return { requested: false };
  if (
    env.VERCEL_ENV !== "preview" ||
    env.VERCEL_GIT_COMMIT_REF !== branch ||
    !/^[a-f0-9]{40}$/.test(env.INKSTRIP_LIVE_QA_COMMIT ?? "") ||
    env.VERCEL_GIT_COMMIT_SHA !== env.INKSTRIP_LIVE_QA_COMMIT
  )
    return {
      requested: true,
      ready: false,
      reason: "Live build QA requires the exact reviewed Preview commit and branch.",
    };
  const backend = liveConfig(env);
  if (!backend.ready)
    return { requested: true, ready: false, reason: "Live build QA credentials are incomplete." };
  return { requested: true, ready: true, backend, commit: env.VERCEL_GIT_COMMIT_SHA };
}
export async function seedPreviewFixture(env, backend, factory = createClient) {
  if (env.INKSTRIP_PREVIEW_QA_FIXTURE !== "true") return null;
  const run = env.INKSTRIP_QA_FIXTURE_RUN,
    password = env.INKSTRIP_QA_FIXTURE_PASSWORD;
  const expires = Date.parse(env.INKSTRIP_QA_FIXTURE_EXPIRES_AT ?? "");
  if (
    !uuid.test(run ?? "") ||
    typeof password !== "string" ||
    password.length < 32 ||
    password.length > 128 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^a-zA-Z0-9]/.test(password) ||
    !Number.isFinite(expires) ||
    expires <= Date.now() ||
    expires > Date.now() + 7200000
  )
    throw Error("Invalid bounded synthetic fixture configuration.");
  const admin = factory(backend.url, backend.service, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      debug: false,
    },
  });
  const email = `inkstrip-qa-${run}@example.invalid`;
  let user;
  if (env.INKSTRIP_QA_FIXTURE_ID) {
    if (!uuid.test(env.INKSTRIP_QA_FIXTURE_ID)) throw Error("Invalid synthetic fixture reference.");
    const r = await admin.auth.admin.getUserById(env.INKSTRIP_QA_FIXTURE_ID);
    if (r.error) throw Error("Synthetic fixture could not be verified.");
    user = r.data.user;
  } else {
    // Admin seeding sends no email; this does not count as registration/email verification.
    const r = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Inkstrip isolated Preview QA" },
      app_metadata: {
        inkstrip_live_qa_run: run,
        inkstrip_preview_qa: true,
        inkstrip_qa_expires_at: new Date(expires).toISOString(),
      },
    });
    if (r.error)
      throw Error("Synthetic fixture provisioning failed; existing identities were not changed.");
    user = r.data.user;
  }
  if (
    !ownedFixture(user, user?.id, run) ||
    user.email !== email ||
    !user.email_confirmed_at ||
    user.app_metadata?.inkstrip_preview_qa !== true ||
    user.app_metadata?.inkstrip_qa_expires_at !== new Date(expires).toISOString()
  )
    throw Error("Synthetic fixture ownership mismatch; no identity was modified or deleted.");
  return {
    userId: user.id,
    email,
    run,
    expiresAt: new Date(expires).toISOString(),
    cleanup:
      "Use this fixture's real reauthentication/account-deletion flow after browser QA; never delete an unrelated account.",
  };
}
export async function runPreviewBuildCheck(
  env,
  {
    runSecurity = runLiveSecurity,
    seedFixture = seedPreviewFixture,
    saveReport = async () => {},
  } = {},
) {
  const config = previewQaConfig(env);
  if (!config.requested) return { status: "not-requested", liveTestsPassed: false };
  if (!config.ready) throw Error(config.reason);
  const security = await runSecurity(config.backend);
  const report = {
    commit: config.commit,
    environment: "preview",
    security,
    fixture: null,
    emailVerified: false,
    browserVerified: false,
  };
  if (security.status !== "passed" || !security.cleanup?.passed) {
    await saveReport(report);
    throw Error("Live SDK security or fixture cleanup failed; Preview deployment is blocked.");
  }
  report.fixture = await seedFixture(env, config.backend);
  await saveReport(report);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = ".vercel/output/static/__inkstrip-preview-security.json";
  try {
    if (process.env.INKSTRIP_LIVE_QA_ENABLED !== "true") {
      await rm(path, { force: true });
      console.log("Preview account live QA not requested; no live-test pass claimed.");
    } else {
      const report = await runPreviewBuildCheck(process.env, {
        saveReport: async (data) => {
          await mkdir(".vercel/output/static", { recursive: true });
          await writeFile(path, JSON.stringify(data, null, 2));
        },
      });
      console.log(
        JSON.stringify({
          previewAccountQa: report.security.status,
          checks: report.security.checks,
          cleanup: report.security.cleanup,
          syntheticFixture: report.fixture,
          emailVerified: false,
          browserVerified: false,
        }),
      );
    }
  } catch (e) {
    // Never serialize raw provider errors, credential values or request bodies.
    console.error(
      JSON.stringify({
        previewAccountQa: "failed",
        reason:
          e instanceof Error &&
          /^(Live |Synthetic |Invalid bounded|Invalid synthetic)/.test(e.message)
            ? e.message
            : "Live build verification failed; raw details suppressed.",
      }),
    );
    process.exitCode = 1;
  }
}
