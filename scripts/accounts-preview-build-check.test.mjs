import { test } from "node:test";
import assert from "node:assert/strict";
import {
  previewQaConfig,
  runPreviewBuildCheck,
  seedPreviewFixture,
} from "./accounts-preview-build-check.mjs";
const run = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const env = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "codex/cloud-accounts-cinematic-auth",
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  INKSTRIP_LIVE_QA_COMMIT: "a".repeat(40),
  INKSTRIP_LIVE_QA_ENABLED: "true",
  SUPABASE_URL: "https://provider.test",
  SUPABASE_ANON_KEY: "test-public",
  SUPABASE_SERVICE_ROLE_KEY: "test-private",
  INKSTRIP_PREVIEW_QA_FIXTURE: "true",
  INKSTRIP_QA_FIXTURE_RUN: run,
  INKSTRIP_QA_FIXTURE_PASSWORD: "Test-only-password-" + "a".repeat(24) + "A1!",
  INKSTRIP_QA_FIXTURE_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
};
test("build QA does no work by default and rejects production, other branches/commits and missing credentials", async () => {
  const never = () => {
    throw Error("Provider must not run");
  };
  assert.equal((await runPreviewBuildCheck({}, { runSecurity: never })).liveTestsPassed, false);
  for (const patch of [
    { VERCEL_ENV: "production" },
    { VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) },
    { INKSTRIP_LIVE_QA_COMMIT: "" },
    { SUPABASE_SERVICE_ROLE_KEY: "" },
  ]) {
    assert.equal(previewQaConfig({ ...env, ...patch }).ready, false);
    await assert.rejects(runPreviewBuildCheck({ ...env, ...patch }, { runSecurity: never }));
  }
});
test("a failed security/cleanup gate blocks seeding and Preview deployment", async () => {
  for (const security of [
    { status: "failed", cleanup: { passed: true } },
    { status: "passed", cleanup: { passed: false } },
  ]) {
    let seeded = false,
      saved = false;
    await assert.rejects(
      runPreviewBuildCheck(env, {
        runSecurity: async () => security,
        seedFixture: async () => {
          seeded = true;
        },
        saveReport: async () => {
          saved = true;
        },
      }),
    );
    assert.equal(seeded, false);
    assert.equal(saved, true);
  }
});
test("successful report contains scoped synthetic metadata and no private credentials or email/browser claims", async () => {
  let saved;
  const report = await runPreviewBuildCheck(env, {
    runSecurity: async () => ({
      status: "passed",
      checks: [{ name: "isolated", passed: true }],
      cleanup: { passed: true },
    }),
    seedFixture: async () => ({ userId: id, run }),
    saveReport: async (data) => {
      saved = data;
    },
  });
  assert.equal(saved, report);
  assert.equal(report.commit, env.VERCEL_GIT_COMMIT_SHA);
  assert.equal(report.emailVerified, false);
  assert.equal(report.browserVerified, false);
  assert.ok(!JSON.stringify(report).includes(env.SUPABASE_SERVICE_ROLE_KEY));
  assert.ok(!JSON.stringify(report).includes(env.INKSTRIP_QA_FIXTURE_PASSWORD));
});
test("fixture seeding uses fresh reserved identity and server-owned marker without sending mail", async () => {
  let body;
  const fixture = await seedPreviewFixture(
    env,
    { url: env.SUPABASE_URL, service: env.SUPABASE_SERVICE_ROLE_KEY },
    () => ({
      auth: {
        admin: {
          createUser: async (data) => {
            body = data;
            return {
              data: {
                user: {
                  id,
                  email: data.email,
                  email_confirmed_at: new Date().toISOString(),
                  app_metadata: data.app_metadata,
                },
              },
            };
          },
        },
      },
    }),
  );
  assert.equal(body.email_confirm, true);
  assert.equal(body.app_metadata.inkstrip_live_qa_run, run);
  assert.equal(fixture.email, `inkstrip-qa-${run}@example.invalid`);
  assert.ok(!JSON.stringify(fixture).includes(body.password));
});
test("fixture reuse refuses unmarked existing users and invalid TTL before mutations", async () => {
  const backend = { url: env.SUPABASE_URL, service: env.SUPABASE_SERVICE_ROLE_KEY };
  await assert.rejects(
    seedPreviewFixture(
      { ...env, INKSTRIP_QA_FIXTURE_EXPIRES_AT: new Date(Date.now() - 1000).toISOString() },
      backend,
      () => {
        throw Error("No provider calls");
      },
    ),
    /Invalid bounded/,
  );
  await assert.rejects(
    seedPreviewFixture({ ...env, INKSTRIP_QA_FIXTURE_ID: id }, backend, () => ({
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { id, email: `inkstrip-qa-${run}@example.invalid`, app_metadata: {} } },
          }),
        },
      },
    })),
    /ownership mismatch/,
  );
});
