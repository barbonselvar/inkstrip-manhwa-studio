import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
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
test("official SSR client carries recovery PKCE cookies and emits the supported recovery event", async () => {
  const cookies = new Map<string, string>(),
    events: string[] = [];
  let challenge = "";
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, session_id: "session-test" })}.test-signature`;
  const client = createServerClient("https://provider.test", "test-publishable", {
    cookieOptions: { name: "__Host-inkstrip-session" },
    cookies: {
      getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
      setAll: (entries) => {
        for (const e of entries) {
          if (e.options.maxAge === 0) cookies.delete(e.name);
          else cookies.set(e.name, e.value);
        }
      },
    },
    global: {
      fetch: async (input, options) => {
        const request = new Request(input, options),
          url = new URL(request.url),
          body = await request.json();
        if (url.pathname === "/auth/v1/recover") {
          challenge = body.code_challenge;
          assert.equal(body.code_challenge_method, "s256");
          assert.equal(
            url.searchParams.get("redirect_to"),
            "https://inkstrip.test/api/account/email-callback?flow=" + "a".repeat(64),
          );
          return new Response("{}", { headers: { "content-type": "application/json" } });
        }
        assert.equal(url.pathname, "/auth/v1/token");
        assert.equal(url.searchParams.get("grant_type"), "pkce");
        assert.equal(body.auth_code, "provider-code");
        assert.equal(
          createHash("sha256").update(body.code_verifier).digest("base64url"),
          challenge,
        );
        return new Response(
          JSON.stringify({
            access_token: token,
            refresh_token: "test-refresh",
            token_type: "bearer",
            expires_in: 3600,
            user: { ...user, aud: "authenticated", app_metadata: {}, user_metadata: {} },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  });
  const subscription = client.auth.onAuthStateChange((event) => {
    events.push(event);
  }).data.subscription;
  try {
    assert.equal(
      (
        await client.auth.resetPasswordForEmail(user.email, {
          redirectTo: "https://inkstrip.test/api/account/email-callback?flow=" + "a".repeat(64),
        })
      ).error,
      null,
    );
    assert.ok([...cookies.keys()].some((k) => k.includes("code-verifier")));
    assert.equal((await client.auth.exchangeCodeForSession("provider-code")).error, null);
    assert.ok(events.includes("PASSWORD_RECOVERY"));
    // The SDK dual-writes bounded per-flow slots for newer redirects. A legacy
    // exchange consumes the fixed slot; BFF intents separately reject replay.
    assert.equal(cookies.has("__Host-inkstrip-session-code-verifier"), false);
  } finally {
    subscription.unsubscribe();
  }
});
function fixture(overrides: Record<string, string> = {}) {
  const calls: any[] = [],
    actions: any[] = [],
    jar = new Map<string, string>(),
    authEvents = new Set<(event: string) => void>();
  let signed = false,
    invalid = false,
    verifyError = false,
    limits = false,
    unverified = false,
    autoConfirm = false,
    grantExpiry = false,
    logoutError = false,
    verifierCookies = false,
    emailLimited = false,
    redirectType: string | null = null;
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
    onAuthStateChange: (callback: (event: string) => void) => {
      authEvents.add(callback);
      return { data: { subscription: { unsubscribe: () => authEvents.delete(callback) } } };
    },
    getUser: () =>
      result({
        user: signed
          ? { ...user, email_confirmed_at: unverified ? null : user.email_confirmed_at }
          : null,
      }),
    getClaims: () => result({ claims: { session_id: "session-A" } }),
    signUp: (v: any) => {
      calls.push(["signup", v]);
      return result({ session: autoConfirm ? {} : null }, emailLimited ? { status: 429 } : null);
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
      return result(null, emailLimited ? { status: 429 } : null);
    },
    resetPasswordForEmail: (v: any, options: any) => {
      calls.push(["forgot", v, options]);
      return result(null, emailLimited ? { status: 429 } : null);
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
      for (const callback of authEvents)
        callback(redirectType === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN");
      return result({ user, redirectType });
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
    if (verifierCookies)
      c.setAll([
        { name: "__Host-inkstrip-session-code-verifier", value: "", options: { maxAge: 0 } },
        {
          name: "__Host-inkstrip-session-flow-pending-code-verifier",
          value: "opaque-test-verifier",
          options: { maxAge: 2592000 },
        },
      ]);
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
        { ...env, ...overrides },
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
    emailLimited: () => (emailLimited = true),
    recoveryExchange: () => (redirectType = "recovery"),
    verifierCookies: () => (verifierCookies = true),
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
test("email link signup binds PKCE redirect, browser nonce, intended email and single use", async () => {
  const f = fixture({ INKSTRIP_EMAIL_MODE: "link" });
  assert.equal((await (await f.req("session")).json()).emailMode, "link");
  assert.equal(
    (
      await f.req("signup", {
        email: user.email,
        name: "Creator",
        password: "Warrior 2026!",
        accepted: true,
      })
    ).status,
    200,
  );
  const flow = f.jar.get("__Host-inkstrip-email-flow")!;
  assert.equal(
    f.calls.find((c) => c[0] === "signup")[1].options.emailRedirectTo,
    `https://inkstrip.test/api/account/email-callback?flow=${flow}`,
  );
  assert.equal(f.actions[0].email_hash, hash(user.email));
  assert.ok(!JSON.stringify(f.actions).includes(user.email));
  assert.match(
    (await f.req("email-callback?flow=wrong&code=example")).headers.get("location")!,
    /email_failed/,
  );
  assert.equal(f.calls.filter((c) => c[0] === "exchange").length, 0);
  assert.equal(
    (await f.req(`email-callback?flow=${flow}&code=example`)).headers.get("location"),
    "https://inkstrip.test/account?notice=email_verified",
  );
  f.jar.set("__Host-inkstrip-email-flow", flow);
  f.jar.set("__Host-inkstrip-email-kind", "email_signup");
  assert.match(
    (await f.req(`email-callback?flow=${flow}&code=example`)).headers.get("location")!,
    /email_failed/,
  );
  assert.equal(f.calls.filter((c) => c[0] === "exchange").length, 1);
  assert.ok(!f.actions.some((a) => a.kind === "recovery"));
});
for (const mode of ["otp", "link"])
  test(`all ${mode} email requests set a trusted production callback instead of provider defaults`, async () => {
    const f = fixture({ INKSTRIP_EMAIL_MODE: mode });
    await f.req("session");
    await f.req(
      "signup",
      { email: user.email, name: "Creator", password: "Warrior 2026!", accepted: true },
      { host: "localhost:3000", "x-forwarded-host": "evil.test", "x-forwarded-proto": "http" },
    );
    await f.req("forgot", { email: user.email });
    await f.req("resend", { email: user.email });
    const urls = [
      f.calls.find((c) => c[0] === "signup")[1].options.emailRedirectTo,
      f.calls.find((c) => c[0] === "forgot")[2].redirectTo,
      f.calls.find((c) => c[0] === "resend")[1].options.emailRedirectTo,
    ];
    for (const value of urls) {
      const u = new URL(value);
      assert.equal(u.origin, "https://inkstrip.test");
      assert.equal(u.pathname, "/api/account/email-callback");
      assert.match(u.searchParams.get("flow")!, /^[a-f0-9]{64}$/);
      assert.doesNotMatch(value, /localhost|evil\.test/);
    }
    assert.equal(new Set(urls).size, 3);
    const flow = f.jar.get("__Host-inkstrip-email-flow")!;
    assert.equal(
      (await f.req(`email-callback?flow=${flow}&code=example`)).headers.get("location"),
      "https://inkstrip.test/account?notice=email_verified",
    );
  });
test("email link recovery requires a recovery PKCE exchange and a session-bound single-use grant", async () => {
  const f = fixture({ INKSTRIP_EMAIL_MODE: "link" });
  await f.req("session");
  f.setSigned(true);
  assert.equal(
    (await f.req("reset-password", { password: "Warrior 2026!", verified: true })).status,
    403,
  );
  f.setSigned(false);
  await f.req("forgot", { email: user.email });
  const flow = f.jar.get("__Host-inkstrip-email-flow")!;
  assert.equal(
    f.calls.find((c) => c[0] === "forgot")[2].redirectTo,
    `https://inkstrip.test/api/account/email-callback?flow=${flow}`,
  );
  f.recoveryExchange();
  assert.equal(
    (await f.req(`email-callback?flow=${flow}&code=example`)).headers.get("location"),
    "https://inkstrip.test/account?notice=recovery_verified",
  );
  assert.equal((await (await f.req("session")).json()).recovery, true);
  const recovery = f.jar.get("__Host-inkstrip-recovery")!;
  assert.equal((await f.req("reset-password", { password: "Warrior 2026!" })).status, 200);
  f.setSigned(true);
  f.jar.set("__Host-inkstrip-recovery", recovery);
  assert.equal((await f.req("reset-password", { password: "Anotherwarrior 2026!" })).status, 403);
  assert.equal(f.calls.filter((c) => c[0] === "password").length, 1);
});
test("a signup PKCE code cannot mint a password-recovery grant", async () => {
  const f = fixture({ INKSTRIP_EMAIL_MODE: "link" });
  await f.req("session");
  await f.req("forgot", { email: user.email });
  const flow = f.jar.get("__Host-inkstrip-email-flow")!;
  assert.match(
    (await f.req(`email-callback?flow=${flow}&code=signup-code`)).headers.get("location")!,
    /email_failed/,
  );
  assert.ok(!f.actions.some((a) => a.kind === "recovery"));
  assert.equal((await (await f.req("session")).json()).user, null);
});
test("email link expiry, wrong-account exchange and provider cancellation never grant reset rights", async () => {
  for (const failure of ["expired", "wrong-account", "cancelled"]) {
    const f = fixture({ INKSTRIP_EMAIL_MODE: "link" });
    await f.req("session");
    await f.req("forgot", { email: user.email });
    const flow = f.jar.get("__Host-inkstrip-email-flow")!;
    f.recoveryExchange();
    if (failure === "expired") f.expire();
    if (failure === "wrong-account") f.actions[0].email_hash = hash("someone-else@example.com");
    const query = failure === "cancelled" ? "error=access_denied" : "code=example";
    assert.match(
      (await f.req(`email-callback?flow=${flow}&${query}`)).headers.get("location")!,
      /email_failed/,
    );
    assert.ok(!f.actions.some((a) => a.kind === "recovery"));
    assert.equal(
      f.calls.filter((c) => c[0] === "exchange").length,
      failure === "wrong-account" ? 1 : 0,
    );
  }
});
test("email link resend invalidates the older browser intent and logout clears email intent cookies", async () => {
  const f = fixture({ INKSTRIP_EMAIL_MODE: "link" });
  await f.req("session");
  await f.req("resend", { email: user.email });
  const oldFlow = f.jar.get("__Host-inkstrip-email-flow")!;
  await f.req("resend", { email: user.email });
  const currentFlow = f.jar.get("__Host-inkstrip-email-flow")!;
  assert.notEqual(currentFlow, oldFlow);
  assert.equal(
    f.calls.filter((c) => c[0] === "resend")[1][1].options.emailRedirectTo,
    `https://inkstrip.test/api/account/email-callback?flow=${currentFlow}`,
  );
  await f.req(`email-callback?flow=${oldFlow}&code=example`);
  assert.equal(f.calls.filter((c) => c[0] === "exchange").length, 0);
  await f.req("logout", {});
  assert.equal(f.jar.get("__Host-inkstrip-email-flow"), "");
  assert.equal(f.jar.get("__Host-inkstrip-email-kind"), "");
});
test("email provider rate limits are reported honestly without leaking account state", async () => {
  for (const route of ["signup", "resend", "forgot"]) {
    const f = fixture();
    await f.req("session");
    f.emailLimited();
    const r = await f.req(route, {
      email: user.email,
      name: "Creator",
      password: "Warrior 2026!",
      accepted: true,
    });
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "3600");
    assert.equal((await r.json()).code, "rate_limited");
  }
});
test("verifier cookies expire in ten minutes while SDK deletion retains Max-Age zero", async () => {
  const f = fixture();
  f.verifierCookies();
  const headers = (await f.req("session")).headers.getSetCookie();
  assert.match(
    headers.find((h) => h.startsWith("__Host-inkstrip-session-code-verifier="))!,
    /Max-Age=0/,
  );
  const active = headers.find((h) =>
    h.startsWith("__Host-inkstrip-session-flow-pending-code-verifier="),
  )!;
  assert.match(active, /Max-Age=600/);
  assert.match(active, /HttpOnly/);
  assert.match(active, /Secure/);
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
