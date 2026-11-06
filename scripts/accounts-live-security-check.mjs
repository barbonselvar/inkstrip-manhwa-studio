/** Actual Supabase-only checks. No email, existing-user lookup, migrations or configuration writes. */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
const bucket = "inkstrip-private",
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const deniedStorage = (r) =>
  !!r.error && [400, 401, 403, 404].includes(Number(r.error.statusCode ?? r.error.status));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function liveConfig(env) {
  const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter(
    (k) => typeof env[k] !== "string" || !env[k].trim(),
  );
  if (env.INKSTRIP_LIVE_QA_ENABLED !== "true" || missing.length)
    return {
      ready: false,
      missing,
      reason: "Live fixture testing is not enabled or credentials are missing.",
    };
  try {
    const url = new URL(env.SUPABASE_URL);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw Error();
    return {
      ready: true,
      url: url.origin,
      anon: env.SUPABASE_ANON_KEY,
      service: env.SUPABASE_SERVICE_ROLE_KEY,
    };
  } catch {
    return { ready: false, missing: [], reason: "A canonical HTTPS Supabase origin is required." };
  }
}
export function ownedFixture(user, id, run) {
  return (
    !!user &&
    uuid.test(id) &&
    user.id === id &&
    user.app_metadata?.inkstrip_live_qa_run === run &&
    user.email?.startsWith("inkstrip-qa-") &&
    user.email.endsWith("@example.invalid")
  );
}
export function fixturePath(path, owners, projects) {
  const parts = path.split("/");
  return (
    parts.length === 3 &&
    owners.includes(parts[0]) &&
    projects.includes(parts[1]) &&
    /^[a-f0-9]{64}\.part$/.test(parts[2])
  );
}
export async function runLiveSecurity(config, { factory = createClient, emit = () => {} } = {}) {
  if (!config.ready) return { status: "blocked", reason: config.reason, missing: config.missing };
  const options = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        debug: false,
      },
    },
    admin = factory(config.url, config.service, options),
    anon = factory(config.url, config.anon, options),
    run = randomUUID(),
    users = [],
    projects = [],
    paths = new Set(),
    checks = [],
    fixtures = [];
  let failed = null,
    cleanup = true,
    creationPending = false;
  const check = (name, ok) => {
    checks.push({ name, passed: !!ok });
    emit({ name, passed: !!ok });
    if (!ok) throw Error(name);
  };
  const privateRows = async (name, result, expected, permissionAllowed = false) => {
    check(
      name,
      expected === 0
        ? (permissionAllowed && result.error?.code === "42501") ||
            (!result.error && result.data?.length === 0)
        : !result.error && result.data?.length === expected,
    );
  };
  try {
    const version = await admin.rpc("inkstrip_schema_version");
    check("Intended Inkstrip schema exists", !version.error && version.data === 1);
    const b = await admin.storage.getBucket(bucket);
    check(
      "Private bucket and bounded uploads",
      !b.error &&
        b.data?.public === false &&
        Number(b.data.file_size_limit) <= 2097152 &&
        Number(b.data.file_size_limit) > 0 &&
        b.data.allowed_mime_types?.length === 1 &&
        b.data.allowed_mime_types[0] === "application/octet-stream",
    );
    // Only fresh, server-marked synthetic identities; admin creation sends no emails.
    for (const confirmed of [true, true, false]) {
      const email = `inkstrip-qa-${randomUUID()}@example.invalid`,
        password = randomBytes(24).toString("base64url") + "aA1!";
      creationPending = true;
      const made = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: confirmed,
        user_metadata: { display_name: "Inkstrip isolated QA" },
        app_metadata: { inkstrip_live_qa_run: run },
      });
      check("Create isolated synthetic identity", !made.error && !!made.data.user);
      const user = made.data.user;
      users.push(user.id);
      creationPending = false;
      check("Fixture ownership marker", ownedFixture(user, user.id, run));
      const client = factory(config.url, config.anon, options),
        sign = await client.auth.signInWithPassword({ email, password });
      if (!confirmed) {
        check(
          "Unverified email cannot establish password session",
          sign.error?.code === "email_not_confirmed" && !sign.data.session,
        );
        continue;
      }
      check(
        "Verified synthetic password session",
        !sign.error && sign.data.user?.id === user.id && !!sign.data.session,
      );
      user.client = client;
      fixtures.push(user);
      const opened = await admin.rpc("inkstrip_open_project", {
        p_owner: user.id,
        p_local: `qa:${run}:${user.id}`,
        p_title: "Inkstrip isolated live QA",
      });
      check(
        "Create owned synthetic cloud project",
        !opened.error && opened.data?.owner_id === user.id && uuid.test(opened.data.id),
      );
      projects.push(opened.data.id);
      user.project = opened.data.id;
      user.bytes = new TextEncoder().encode(
        "Inkstrip isolated live security fixture " + run + user.id,
      );
      user.digest = sha(user.bytes);
      user.path = `${user.id}/${user.project}/${user.digest}.part`;
      paths.add(user.path);
      const upload = await client.storage
        .from(bucket)
        .upload(user.path, user.bytes, { contentType: "application/octet-stream", upsert: false });
      check("Owner can upload private fixture", !upload.error);
      const receipt = await admin.from("inkstrip_cloud_chunks").insert({
        project_id: user.project,
        owner_id: user.id,
        digest: user.digest,
        bytes: user.bytes.length,
        path: user.path,
      });
      check("Seed verified synthetic receipt (test setup)", !receipt.error);
      const manifest = {
          version: 1,
          bytes: user.bytes.length,
          parts: [{ digest: user.digest, bytes: user.bytes.length }],
        },
        hash = sha(JSON.stringify(manifest));
      const commit = await admin.rpc("inkstrip_commit_revision", {
        p_owner: user.id,
        p_project: user.project,
        p_base: 0,
        p_manifest: manifest,
        p_hash: hash,
        p_title: "Inkstrip isolated live QA",
      });
      check("Atomic fixture publication", !commit.error && commit.data?.revision === 1);
    }
    for (const id of users.slice(0, 2)) {
      const row = await admin.auth.admin.getUserById(id);
      check("Recheck isolated identity", !row.error && ownedFixture(row.data.user, id, run));
    }
    // Independent clients/tokens stay in memory; no sessions are emitted or serialized.
    const [A, B] = fixtures;
    check("Independent sessions retained", !!A && !!B);
    for (const viewer of [A, B]) {
      await privateRows(
        "Owner reads own profile",
        await viewer.client.from("inkstrip_profiles").select("id").eq("id", viewer.id),
        1,
      );
      for (const [table, column, id] of [
        ["inkstrip_cloud_projects", "id", viewer.project],
        ["inkstrip_cloud_project_overview", "id", viewer.project],
        ["inkstrip_cloud_revisions", "project_id", viewer.project],
        ["inkstrip_cloud_chunks", "project_id", viewer.project],
      ])
        await privateRows(
          "Owner reads " + table,
          await viewer.client.from(table).select("*").eq(column, id),
          1,
        );
      const other = viewer === A ? B : A;
      for (const [table, column, id] of [
        ["inkstrip_profiles", "id", other.id],
        ["inkstrip_cloud_projects", "id", other.project],
        ["inkstrip_cloud_project_overview", "id", other.project],
        ["inkstrip_cloud_revisions", "project_id", other.project],
        ["inkstrip_cloud_chunks", "project_id", other.project],
      ]) {
        await privateRows(
          "Other account cannot read " + table,
          await viewer.client.from(table).select("*").eq(column, id),
          0,
        );
        await privateRows(
          "Anonymous cannot read " + table,
          await anon.from(table).select("*").eq(column, id),
          0,
          true,
        );
      }
      const read = await viewer.client.storage.from(bucket).download(viewer.path);
      check(
        "Owner retrieves exact private bytes",
        !read.error && sha(new Uint8Array(await read.data.arrayBuffer())) === viewer.digest,
      );
      const foreign = await viewer.client.storage.from(bucket).download(other.path);
      check(
        "Other account cannot download private fixture",
        deniedStorage(foreign) && !foreign.data,
      );
      const publicRead = await anon.storage.from(bucket).download(viewer.path);
      check(
        "Anonymous cannot download private fixture",
        deniedStorage(publicRead) && !publicRead.data,
      );
      const crossPath = `${other.id}/${other.project}/${viewer.digest}.part`;
      paths.add(crossPath);
      const cross = await viewer.client.storage
        .from(bucket)
        .upload(crossPath, viewer.bytes, { contentType: "application/octet-stream" });
      check("Other account cannot upload into foreign project", deniedStorage(cross));
      const update = await viewer.client.storage
        .from(bucket)
        .update(viewer.path, viewer.bytes, { contentType: "application/octet-stream" });
      check("Published private parts cannot be overwritten", deniedStorage(update));
      await viewer.client.storage.from(bucket).remove([other.path]);
      const retained = await other.client.storage.from(bucket).download(other.path);
      check("Foreign deletion cannot remove private fixture", !retained.error && !!retained.data);
      const denied = await viewer.client.rpc("inkstrip_open_project", {
        p_owner: other.id,
        p_local: "denied:" + run,
        p_title: "Denied fixture",
      });
      check("Publication RPC is service-only", denied.error?.code === "42501");
      const columns = await viewer.client
        .from("inkstrip_profiles")
        .update({ email: "forbidden@example.invalid" })
        .eq("id", viewer.id)
        .select("id");
      check(
        "Auth-owned profile columns are immutable to user role",
        columns.error?.code === "42501",
      );
      const foreignProfile = await viewer.client
        .from("inkstrip_profiles")
        .update({ display_name: "Denied change" })
        .eq("id", other.id)
        .select("id");
      await privateRows("Foreign profile update denied", foreignProfile, 0);
      const refresh = await viewer.client.auth.refreshSession();
      check(
        "Provider refresh preserves user identity",
        !refresh.error && refresh.data.user?.id === viewer.id && !!refresh.data.session,
      );
    }
    const snapshot = await A.client.auth.getSession(),
      token = snapshot.data.session?.refresh_token;
    check("In-memory refresh credential exists", !!token);
    const signedOut = await A.client.auth.signOut({ scope: "global" });
    check("Synthetic global logout accepted", !signedOut.error);
    const probe = factory(config.url, config.anon, options),
      after = await probe.auth.refreshSession({ refresh_token: token });
    check(
      "Provider rejects revoked refresh credential",
      !!after.error && [400, 401, 403].includes(Number(after.error.status)) && !after.data.session,
    );
  } catch {
    if (creationPending) cleanup = false;
    failed = checks.findLast((c) => !c.passed)?.name ?? "Provider request failed";
  } finally {
    // Cleanup only identities created in this invocation, with server-owned run metadata.
    const verified = [];
    for (const id of users) {
      try {
        const row = await admin.auth.admin.getUserById(id);
        if (row.error || !ownedFixture(row.data.user, id, run)) {
          cleanup = false;
          continue;
        }
        verified.push(id);
      } catch {
        cleanup = false;
      }
    }
    const safePaths = [...paths].filter((p) => fixturePath(p, verified, projects));
    if (safePaths.length !== paths.size) cleanup = false;
    if (safePaths.length) {
      try {
        const r = await admin.storage.from(bucket).remove(safePaths);
        if (r.error) cleanup = false;
      } catch {
        cleanup = false;
      }
    }
    if (cleanup)
      for (const id of verified) {
        try {
          const r = await admin.auth.admin.deleteUser(id);
          if (r.error) cleanup = false;
        } catch {
          cleanup = false;
        }
      }
  }
  return {
    status: failed || !cleanup ? "failed" : "passed",
    checks,
    failed,
    cleanup: { passed: cleanup, fixtureRun: run, ...(!cleanup ? { syntheticUserIds: users } : {}) },
    limitations: [
      "No email delivery, OTP, OAuth, browser/BFF or actual token-expiry claims are made by this checker.",
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runLiveSecurity(liveConfig(process.env));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === "passed" ? 0 : report.status === "blocked" ? 2 : 1;
  } catch {
    console.error(
      JSON.stringify({
        status: "failed",
        reason:
          "Live checker could not initialize; validate the secret bindings. No raw provider diagnostics are emitted.",
      }),
    );
    process.exitCode = 1;
  }
}
