import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleAccount, type ClientFactory } from "./server.server.ts";
const env = {
  NODE_ENV: "production",
  INKSTRIP_ACCOUNTS_ENABLED: "true",
  INKSTRIP_ACCOUNT_ORIGIN: "https://inkstrip.test",
  SUPABASE_URL: "https://provider.test",
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  INKSTRIP_ACCOUNT_RATE_SECRET: "a".repeat(40),
  INKSTRIP_GOOGLE_ENABLED: "true",
  INKSTRIP_FACEBOOK_ENABLED: "true",
};
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "creator@example.com",
  email_confirmed_at: "2026-11-06",
  created_at: "2026-11-06",
  identities: [{ provider: "email" }],
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const calls: any[] = [],
    actions: any[] = [],
    jar = new Map<string, string>();
  let signed = false,
    invalid = false,
    verifyError = false,
    limits = false,
    unverified = false,
    autoConfirm = false,
    grantExpiry = false,
    logoutError = false;
  const result = (data: any = null, error: any = null) => Promise.resolve({ data, error });
  function query(table: string) {
    let data: any = null;
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      in: () => q,
      update: (v: any) => {
        calls.push(["update", table, v]);
        data = { id: user.id };
        return q;
      },
      insert: (v: any) => {
        calls.push(["insert", table, v]);
        if (table === "inkstrip_account_actions") actions.push(v);
        return q;
      },
      delete: () => q,
      upsert: () => q,
      single: () =>
        result(
          table === "inkstrip_profiles"
            ? { display_name: "Creator", preferences: {}, deleting_at: null }
            : data,
        ),
      maybeSingle: () => result(data),
      then: (resolve: any) => result(data).then(resolve),
    };
    return q;
  }
  const auth: any = {
    getUser: () =>
      result({
        user: signed
          ? { ...user, email_confirmed_at: unverified ? null : user.email_confirmed_at }
          : null,
      }),
    getClaims: () => result({ claims: { session_id: "session-A" } }),
    signUp: (v: any) => {
      calls.push(["signup", v]);
      return result({ session: autoConfirm ? {} : null });
    },
    signInWithPassword: (v: any) => {
      calls.push(["login", v]);
      if (invalid) return result({}, { status: 400, message: "sensitive provider details" });
      signed = true;
      return result({ user });
    },
    verifyOtp: (v: any) => {
      calls.push(["verify", v]);
      if (verifyError) return result({}, { status: 400 });
      signed = true;
      return result({ user });
    },
    resend: (v: any) => {
      calls.push(["resend", v]);
      return result();
    },
    resetPasswordForEmail: (v: any) => {
      calls.push(["forgot", v]);
      return result();
    },
    signOut: (v: any) => {
      calls.push(["logout", v]);
      if (logoutError) return result(null, { status: 503 });
      signed = false;
      return result();
    },
    updateUser: (v: any) => {
      calls.push(["password", v]);
      return result({ user });
    },
    signInWithOAuth: (v: any) => {
      calls.push(["oauth", v]);
      return result({ url: "https://provider.test/auth/v1/authorize" });
    },
    linkIdentity: (v: any) => {
      calls.push(["link", v]);
      return result({ url: "https://provider.test/auth/v1/authorize" });
    },
    exchangeCodeForSession: (v: any) => {
      calls.push(["exchange", v]);
      signed = true;
      return result({ user });
    },
  };
  const client = { auth, from: query };
  const admin = {
    auth: {
      admin: {
        deleteUser: (id: string) => {
          calls.push(["delete-user", id]);
          return result();
        },
      },
    },
    storage: {
      from: () => ({
        list: () => result([]),
        remove: (paths: string[]) => {
          calls.push(["remove", paths]);
          return result();
        },
      }),
    },
    from: query,
    rpc: (name: string, p: any) => {
      calls.push(["rpc", name, p]);
      if (name === "inkstrip_schema_version") return result(1);
      if (name === "inkstrip_consume_rate") return result({ allowed: !limits, retry: 60 });
      if (name === "inkstrip_consume_action") {
        const a = actions.find(
          (a) =>
            a.id_hash === p.p_hash &&
            a.kind === p.p_kind &&
            !a.used &&
            (!p.p_user || a.user_id === p.p_user) &&
            (!p.p_session || a.session_id === p.p_session),
        );
        if (!a || grantExpiry) return result(null, { message: "expired" });
        a.used = true;
        return result(a);
      }
      return result(null);
    },
  };
  const factory: ClientFactory = (_r, c) => {
    if (signed)
      c.setAll([
        {
          name: "__Host-inkstrip-session",
          value: "opaque-test-cookie",
          options: {
            maxAge: 40000000,
            httpOnly: false,
            secure: false,
            path: "/bad",
            domain: "evil.test",
          },
        },
      ]);
    return { user: client as unknown as SupabaseClient, admin: admin as unknown as SupabaseClient };
  };
  async function req(path: string, body?: unknown, headers: Record<string, string> = {}) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
      r = await handleAccount(
        new Request("https://inkstrip.test/api/account/" + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            cookie,
            origin: env.INKSTRIP_ACCOUNT_ORIGIN,
            "content-type": "application/json",
            "x-inkstrip-csrf": jar.get("__Host-inkstrip-csrf") ?? "",
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
        factory,
      );
    for (const line of r.headers.getSetCookie()) {
      const first = line.split(";")[0],
        i = first.indexOf("=");
      jar.set(first.slice(0, i), first.slice(i + 1));
    }
    return r;
  }
  return {
    req,
    calls,
    actions,
    jar,
    setSigned: (v: boolean) => (signed = v),
    setInvalid: () => (invalid = true),
    setVerifyError: () => (verifyError = true),
    setLimited: () => (limits = true),
    setUnverified: () => (unverified = true),
    setAutoConfirm: () => (autoConfirm = true),
    expire: () => (grantExpiry = true),
    failLogout: () => (logoutError = true),
  };
}
test("missing credentials return an honest setup state without initializing provider clients", async () => {
  const r = await handleAccount(
    new Request("https://inkstrip.test/api/account/session"),
    {},
    () => {
      throw Error("must not initialize");
    },
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).configured, false);
  assert.match(r.headers.get("cache-control")!, /no-store/);
});
test("CSRF and hostile origins rejected before provider calls", async () => {
  const f = fixture();
  await f.req("session");
  for (const h of [
    { origin: "https://evil.test" },
    { "x-inkstrip-csrf": "wrong" },
    { "sec-fetch-site": "cross-site" },
  ] as Record<string, string>[])
    assert.equal((await f.req("login", { email: user.email, password: "secret" }, h)).status, 403);
  assert.ok(!f.calls.some((c) => c[0] === "login"));
});
test("registration is validated server-side and generic; auto-confirmed installations fail closed", async () => {
  const f = fixture();
  await f.req("session");
  assert.equal(
    (
      await f.req("signup", {
        email: user.email,
        name: "Creator",
        password: "weak",
        accepted: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.req("signup", {
        email: user.email,
        name: "Creator",
        password: "Warrior 2026!",
        accepted: false,
      })
    ).status,
    400,
  );
  const r = await f.req("signup", {
    email: user.email,
    name: "Creator",
    password: "Warrior 2026!",
    accepted: true,
  });
  assert.equal(r.status, 200);
  assert.match((await r.json()).message, /eligible/);
  f.setAutoConfirm();
  assert.equal(
    (
      await f.req("signup", {
        email: user.email,
        name: "Creator",
        password: "Warrior 2026!",
        accepted: true,
      })
    ).status,
    503,
  );
});
test("login protects provider errors, restores session and requires email confirmation", async () => {
  const f = fixture();
  await f.req("session");
  f.setInvalid();
  const r = await f.req("login", { email: user.email, password: "incorrect" });
  assert.equal(r.status, 401);
  assert.doesNotMatch(await r.text(), /sensitive provider/);
  const g = fixture();
  await g.req("session");
  assert.equal(
    (await g.req("login", { email: user.email, password: "Warrior 2026!", remember: true })).status,
    200,
  );
  const restored = await g.req("session");
  assert.equal((await restored.json()).user.id, user.id);
  assert.match(restored.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(restored.headers.get("set-cookie")!, /Secure/);
  assert.match(restored.headers.get("set-cookie")!, /Max-Age=2592000/);
  g.setUnverified();
  assert.equal((await g.req("projects")).status, 403);
});
test("remember false creates session cookies, and logout clears account state", async () => {
  const f = fixture();
  await f.req("session");
  await f.req("login", { email: user.email, password: "Warrior 2026!", remember: false });
  const r = await f.req("session");
  const session = r.headers.getSetCookie().find((s) => s.startsWith("__Host-inkstrip-session="))!;
  assert.ok(!session.includes("Max-Age"));
  assert.equal((await f.req("logout", {})).status, 200);
  assert.equal((await (await f.req("session")).json()).user, null);
});
test("verification uses provider OTP and reports expired codes without provider details", async () => {
  const f = fixture();
  await f.req("session");
  assert.equal(
    (await f.req("verify", { email: user.email, code: "123", type: "signup" })).status,
    400,
  );
  f.setVerifyError();
  assert.equal(
    (await f.req("verify", { email: user.email, code: "123456", type: "signup" })).status,
    400,
  );
  assert.ok(f.calls.some((c) => c[0] === "verify" && c[1].type === "signup"));
});
test("OTP attempt/resend limits fail closed before sending or verifying", async () => {
  const f = fixture();
  await f.req("session");
  f.setLimited();
  const r = await f.req("verify", { email: user.email, code: "123456", type: "signup" });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "60");
  assert.ok(!f.calls.some((c) => c[0] === "verify"));
});
test("recovery requires a server-side single-use session-bound grant, not a client flag", async () => {
  const f = fixture();
  await f.req("session");
  await f.req("login", { email: user.email, password: "Warrior 2026!" });
  assert.equal(
    (await f.req("reset-password", { password: "Newwarrior 2026!", verified: true })).status,
    403,
  );
  await f.req("forgot", { email: user.email });
  await f.req("verify", { email: user.email, code: "123456", type: "recovery" });
  const token = f.jar.get("__Host-inkstrip-recovery")!;
  assert.ok(f.actions.some((a) => a.id_hash === hash(token) && a.session_id === "session-A"));
  assert.equal((await f.req("reset-password", { password: "Newwarrior 2026!" })).status, 200);
  assert.ok(f.calls.some((c) => c[0] === "logout" && c[1].scope === "global"));
  f.setSigned(true);
  f.jar.set("__Host-inkstrip-recovery", token);
  assert.equal((await f.req("reset-password", { password: "Newwarrior 2026!" })).status, 403);
});
test("expired reauthentication grants cannot change passwords", async () => {
  const f = fixture();
  await f.req("session");
  f.setSigned(true);
  await f.req("reauth", { password: "Warrior 2026!" });
  f.expire();
  assert.equal((await f.req("change-password", { password: "Newwarrior 2026!" })).status, 403);
  assert.ok(!f.calls.some((c) => c[0] === "password"));
});
for (const provider of ["google", "facebook"])
  test(`${provider} OAuth uses PKCE redirect flow, nonce binding, cancellation handling and single use`, async () => {
    const f = fixture();
    await f.req("session");
    assert.equal((await f.req("oauth", { provider })).status, 200);
    const intent = f.calls.find((c) => c[0] === "oauth")[1];
    assert.equal(intent.provider, provider);
    assert.match(
      intent.options.redirectTo,
      /^https:\/\/inkstrip.test\/api\/account\/callback\?flow=/,
    );
    assert.equal(
      (await f.req("callback?flow=wrong&code=example")).headers.get("location"),
      "https://inkstrip.test/account?notice=oauth_failed",
    );
    const flow = f.jar.get("__Host-inkstrip-flow")!;
    assert.equal(
      (await f.req(`callback?flow=${flow}&code=example`)).headers.get("location"),
      "https://inkstrip.test/account",
    );
    assert.equal(f.calls.filter((c) => c[0] === "exchange").length, 1);
    await f.req(`callback?flow=${flow}&code=example`);
    assert.equal(f.calls.filter((c) => c[0] === "exchange").length, 1);
    await f.req("oauth", { provider });
    const cancelled = f.jar.get("__Host-inkstrip-flow");
    assert.equal(
      (await f.req(`callback?flow=${cancelled}&error=access_denied`)).headers.get("location"),
      "https://inkstrip.test/account?notice=oauth_cancelled",
    );
    assert.equal(f.calls.filter((c) => c[0] === "exchange").length, 1);
  });
test("OAuth reauthentication cannot grant rights to a different account", async () => {
  const f = fixture();
  await f.req("session");
  f.setSigned(true);
  await f.req("oauth", { provider: "google", purpose: "reauth" });
  f.actions[0].user_id = "22222222-2222-4222-8222-222222222222";
  const flow = f.jar.get("__Host-inkstrip-flow");
  const r = await f.req(`callback?flow=${flow}&code=example`);
  assert.match(r.headers.get("location")!, /identity_mismatch/);
  assert.equal(f.jar.get("__Host-inkstrip-fresh"), undefined);
});
test("signed-out private endpoints and deletion require verified identity and fresh grant", async () => {
  const f = fixture();
  await f.req("session");
  for (const route of ["projects", "revision?project=11111111-1111-4111-8111-111111111111"])
    assert.equal((await f.req(route)).status, 401);
  f.setSigned(true);
  assert.equal((await f.req("delete-account", { confirm: "DELETE", verified: true })).status, 403);
  assert.ok(!f.calls.some((c) => c[0] === "update"));
});

test("failed session revocation after a password update is reported rather than claimed successful", async () => {
  const f = fixture();
  await f.req("session");
  f.setSigned(true);
  await f.req("reauth", { password: "Warrior 2026!" });
  f.failLogout();
  const r = await f.req("change-password", { password: "Newwarrior 2026!" });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /password was updated, but other sessions/);
});
test("account deletion uses only the confirmed server identity and acknowledges preserved local copies", async () => {
  const f = fixture();
  await f.req("session");
  f.setSigned(true);
  await f.req("reauth", { password: "Warrior 2026!" });
  const r = await f.req("delete-account", {
    confirm: "DELETE",
    owner: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { deleted: true, localCopiesPreserved: true });
  assert.ok(f.calls.some((c) => c[0] === "delete-user" && c[1] === user.id));
  assert.ok(
    f.calls.some((c) => c[0] === "update" && c[1] === "inkstrip_profiles" && c[2].deleting_at),
  );
});
test("cloud write owner is derived from the verified session, never submitted owner data", async () => {
  const f = fixture();
  await f.req("session");
  f.setSigned(true);
  await f.req("open-project", {
    localId: "local-A",
    title: "Warrior",
    owner: "22222222-2222-4222-8222-222222222222",
  });
  const rpc = f.calls.find((c) => c[0] === "rpc" && c[1] === "inkstrip_open_project");
  assert.equal(rpc[2].p_owner, user.id);
});
