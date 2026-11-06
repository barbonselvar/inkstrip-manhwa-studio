import { test } from "node:test";
import assert from "node:assert/strict";
import {
  liveConfig,
  ownedFixture,
  fixturePath,
  runLiveSecurity,
} from "./accounts-live-security-check.mjs";
const A = "11111111-1111-4111-8111-111111111111",
  P = "22222222-2222-4222-8222-222222222222";
test("live checker refuses network work unless explicitly enabled with canonical HTTPS credentials", async () => {
  assert.equal(liveConfig({}).ready, false);
  for (const url of [
    "http://localhost",
    "https://user:pass@db.test",
    "https://db.test/path",
    "https://db.test?redirect=x",
  ])
    assert.equal(
      liveConfig({
        INKSTRIP_LIVE_QA_ENABLED: "true",
        SUPABASE_URL: url,
        SUPABASE_ANON_KEY: "test",
        SUPABASE_SERVICE_ROLE_KEY: "test",
      }).ready,
      false,
    );
  const r = await runLiveSecurity(liveConfig({}), {
    factory: () => {
      throw Error("must not call provider");
    },
  });
  assert.equal(r.status, "blocked");
});
test("live cleanup requires exact freshly-created identity and server-owned run marker", () => {
  const run = "unique-run",
    user = {
      id: A,
      email: "inkstrip-qa-random@example.invalid",
      app_metadata: { inkstrip_live_qa_run: run },
    };
  assert.equal(ownedFixture(user, A, run), true);
  for (const u of [
    { ...user, id: P },
    { ...user, email: "existing@example.com" },
    { ...user, app_metadata: {}, user_metadata: { inkstrip_live_qa_run: run } },
  ])
    assert.equal(ownedFixture(u, A, run), false);
  assert.equal(ownedFixture(user, A, "other-run"), false);
});
test("fixture file cleanup refuses other users, other projects, traversal and untracked file types", () => {
  const path = `${A}/${P}/${"a".repeat(64)}.part`;
  assert.equal(fixturePath(path, [A], [P]), true);
  for (const p of [
    path.replace(A, P),
    path.replace(P, A),
    path + "/../private",
    `${A}/${P}/avatar.png`,
  ])
    assert.equal(fixturePath(p, [A], [P]), false);
});
test("live checker never creates identities when the target schema is missing and never emits raw provider errors", async () => {
  let created = false;
  const factory = () => ({
    rpc: async () => ({ error: { message: "sensitive-provider-diagnostics" } }),
    auth: {
      admin: {
        createUser: () => {
          created = true;
        },
      },
    },
  });
  const r = await runLiveSecurity(
    { ready: true, url: "https://db.test", anon: "test", service: "test" },
    { factory },
  );
  assert.equal(r.status, "failed");
  assert.equal(created, false);
  assert.doesNotMatch(JSON.stringify(r), /sensitive-provider/);
});
