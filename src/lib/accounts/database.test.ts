import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  C = "33333333-3333-4333-8333-333333333333",
  sha = "a".repeat(64);
let project: string;
async function as(role: string, id: string, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant select,insert,update,delete on storage.objects to authenticated;`);
  await db.exec(
    await readFile(
      new URL("../../../supabase/migrations/202611060001_inkstrip_accounts.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'a@test.test',now()),($2,'b@test.test',now()),($3,'unverified@test.test',null)",
    [A, B, C],
  );
  const opened = await as(
    "service_role",
    "",
    "select public.inkstrip_open_project($1,'local-project','Private chapter') as value",
    [A],
  );
  project = (opened.rows[0] as any).value.id;
});
after(async () => db.close());
test("actual PostgreSQL RLS isolates profiles and rejects anonymous/unverified access", async () => {
  assert.equal(
    (await as("authenticated", A, "select id from public.inkstrip_profiles")).rows.length,
    1,
  );
  assert.equal(
    (await as("authenticated", B, "select id from public.inkstrip_profiles where id=$1", [A])).rows
      .length,
    0,
  );
  assert.equal(
    (await as("authenticated", C, "select id from public.inkstrip_profiles")).rows.length,
    0,
  );
  await assert.rejects(
    as("anon", "", "select * from public.inkstrip_profiles"),
    /permission denied/,
  );
});
test("profile column grants prevent changing ownership, verified email or deletion state", async () => {
  assert.equal(
    (
      await as(
        "authenticated",
        A,
        "update public.inkstrip_profiles set display_name='Warrior' where id=$1 returning id",
        [A],
      )
    ).rows.length,
    1,
  );
  for (const column of ["email", "id", "deleting_at"])
    await assert.rejects(
      as("authenticated", A, `update public.inkstrip_profiles set ${column}=null where id=$1`, [A]),
      /permission denied/,
    );
  assert.equal(
    (
      await as(
        "authenticated",
        B,
        "update public.inkstrip_profiles set display_name='Attack' where id=$1 returning id",
        [A],
      )
    ).rows.length,
    0,
  );
});
test("private project reads and all service-only mutation RPCs enforce grants", async () => {
  assert.equal(
    (await as("authenticated", A, "select id from public.inkstrip_cloud_projects")).rows.length,
    1,
  );
  assert.equal(
    (await as("authenticated", B, "select id from public.inkstrip_cloud_projects")).rows.length,
    0,
  );
  for (const sql of [
    "select public.inkstrip_open_project('" + B + "','evil','evil')",
    "select public.inkstrip_schema_version()",
    "select public.inkstrip_consume_rate('" + sha + "',100,60)",
    "insert into public.inkstrip_cloud_projects(owner_id,local_id,title) values('" +
      B +
      "','evil','evil')",
    "select * from public.inkstrip_account_actions",
    "select * from public.inkstrip_rate_limits",
    "select * from public.inkstrip_account_audit",
  ])
    await assert.rejects(as("authenticated", B, sql), /permission denied/);
});
test("storage RLS allows only verified owner/project immutable package paths", async () => {
  const path = `${A}/${project}/${sha}.part`;
  await as(
    "authenticated",
    A,
    "insert into storage.objects(bucket_id,name) values('inkstrip-private',$1)",
    [path],
  );
  assert.equal((await as("authenticated", A, "select * from storage.objects")).rows.length, 1);
  assert.equal((await as("authenticated", B, "select * from storage.objects")).rows.length, 0);
  for (const [id, p] of [
    [B, path],
    [C, path],
    [A, `${A}/${project}/../wrong.svg`],
    [A, `${A}/${B}/${sha}.part`],
  ])
    await assert.rejects(
      as(
        "authenticated",
        id,
        "insert into storage.objects(bucket_id,name) values('inkstrip-private',$1)",
        [p],
      ),
      /row-level security/,
    );
  assert.equal(
    (await as("authenticated", A, "update storage.objects set name='bad' returning id")).rows
      .length,
    0,
  );
  assert.equal(
    (await as("authenticated", A, "delete from storage.objects returning id")).rows.length,
    0,
  );
});
test("revision publication requires verified receipts, is idempotent, and detects stale writes", async () => {
  const m = { version: 1, bytes: 10, parts: [{ digest: sha, bytes: 10 }] };
  const commit = (base: number, manifest: any = m, hash = sha) =>
    as(
      "service_role",
      "",
      "select public.inkstrip_commit_revision($1,$2,$3,$4,$5,'Chapter') as value",
      [A, project, base, JSON.stringify(manifest), hash],
    );
  await assert.rejects(commit(0), /Unverified project chunk/);
  await db.query(
    "insert into public.inkstrip_cloud_chunks(project_id,owner_id,digest,bytes,path) values($1,$2,$3,10,$4)",
    [project, A, sha, `${A}/${project}/${sha}.part`],
  );
  assert.deepEqual((await commit(0)).rows[0], { value: { revision: 1, duplicate: false } });
  assert.deepEqual((await commit(0)).rows[0], { value: { revision: 1, duplicate: true } });
  await assert.rejects(commit(0, m, "b".repeat(64)), /REVISION_CONFLICT/);
  await assert.rejects(commit(1, { version: 1, parts: [] }, "b".repeat(64)), /Invalid manifest/);
  await assert.rejects(commit(1, null, "b".repeat(64)), /Invalid manifest/);
  assert.equal(
    (await as("authenticated", B, "select * from public.inkstrip_cloud_revisions")).rows.length,
    0,
  );
  await assert.rejects(
    as("authenticated", A, "delete from public.inkstrip_cloud_revisions"),
    /permission denied/,
  );
});
test("durable rate limiter caps attempts and resets expired windows", async () => {
  const key = "b".repeat(64),
    call = () =>
      as("service_role", "", "select public.inkstrip_consume_rate($1,2,600) as value", [key]);
  assert.equal(((await call()).rows[0] as any).value.allowed, true);
  assert.equal(((await call()).rows[0] as any).value.allowed, true);
  assert.equal(((await call()).rows[0] as any).value.allowed, false);
  await db.query(
    "update public.inkstrip_rate_limits set ends_at=now()-interval '1 second' where key=$1",
    [key],
  );
  assert.equal(((await call()).rows[0] as any).value.allowed, true);
});
test("sensitive action grants bind session and user, expire, and are single-use in PostgreSQL", async () => {
  const token = "c".repeat(64);
  await db.query(
    "insert into public.inkstrip_account_actions(id_hash,kind,user_id,session_id,expires_at) values($1,'fresh',$2,'session-A',now()+interval '1 minute')",
    [token, A],
  );
  const consume = (id: string, session: string) =>
    as("service_role", "", "select public.inkstrip_consume_action($1,'fresh',$2,$3)", [
      token,
      id,
      session,
    ]);
  await assert.rejects(consume(B, "session-A"), /expired or already used/);
  await assert.rejects(consume(A, "session-B"), /expired or already used/);
  await consume(A, "session-A");
  await assert.rejects(consume(A, "session-A"), /expired or already used/);
});
test("deletion pending immediately blocks private storage/project reads while preserving profile for retry", async () => {
  await db.query("update public.inkstrip_profiles set deleting_at=now() where id=$1", [A]);
  assert.equal(
    (await as("authenticated", A, "select * from public.inkstrip_cloud_projects")).rows.length,
    0,
  );
  assert.equal((await as("authenticated", A, "select * from storage.objects")).rows.length, 0);
  assert.equal(
    (await as("authenticated", A, "select * from public.inkstrip_profiles")).rows.length,
    1,
  );
  await db.query("delete from auth.users where id=$1", [A]);
  assert.equal((await db.query("select * from public.inkstrip_cloud_revisions")).rows.length, 0);
});
