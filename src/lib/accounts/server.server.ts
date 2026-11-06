import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
  type CookieOptions,
} from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { accountConfig, type AccountEnv } from "./config.server.ts";
import {
  CHUNK_BYTES,
  CONSENT_VERSION,
  DIGEST,
  UUID,
  avatarUrl,
  canonicalManifest,
  displayName,
  emailAddress,
  storagePath,
  strongPassword,
  validateManifest,
  type AccountUser,
} from "./policy.ts";
const BUCKET = "inkstrip-private";
class Failure extends Error {
  status: number;
  code: string;
  retry: number;
  constructor(status: number, message: string, code = "request_failed", retry = 0) {
    super(message);
    this.status = status;
    this.code = code;
    this.retry = retry;
  }
}
const digest = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
async function bytes(request: Request, limit: number) {
  const declared = Number(request.headers.get("content-length"));
  if (declared > limit) throw new Failure(413, "The request is too large.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new Failure(413, "The request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
export type ClientFactory = (
  request: Request,
  cookies: {
    getAll: () => { name: string; value: string }[];
    setAll: (items: { name: string; value: string; options: CookieOptions }[]) => void;
  },
  config: Extract<ReturnType<typeof accountConfig>, { ready: true }>,
) => { user: SupabaseClient; admin: SupabaseClient };
const realClients: ClientFactory = (_request, cookies, c) => ({
  user: createServerClient(c.url, c.anon, {
    cookieOptions: { name: c.secure ? "__Host-inkstrip-session" : "inkstrip-session" },
    cookies,
    auth: { flowType: "pkce", debug: false },
  }),
  admin: createClient(c.url, c.service, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      debug: false,
    },
  }),
});
/** No runtime mock switch. Tests inject a provider transport; deployments use official clients. */
export async function handleAccount(
  request: Request,
  env: AccountEnv = process.env,
  factory: ClientFactory = realClients,
): Promise<Response> {
  const headers = new Headers({
      "Cache-Control": "private, no-store, no-cache, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      Vary: "Cookie, Origin",
    }),
    config = accountConfig(env),
    url = new URL(request.url),
    route = url.pathname.split("/api/account/")[1] ?? "",
    requestId = randomUUID();
  const jar = new Map(
    parseCookieHeader(request.headers.get("cookie") ?? "").map((c) => [c.name, c.value ?? ""]),
  );
  const secure = config.ready ? config.secure : url.protocol === "https:",
    prefix = secure ? "__Host-inkstrip-" : "inkstrip-";
  const set = (name: string, value: string, options: CookieOptions = {}) => {
    jar.set(name, value);
    headers.append(
      "Set-Cookie",
      serializeCookieHeader(name, value, {
        ...options,
        domain: undefined,
        path: "/",
        httpOnly: true,
        secure,
        sameSite: options.sameSite ?? "lax",
      }),
    );
  };
  const json = (value: unknown, status = 200) => {
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(value), { status, headers });
  };
  const redirect = (path: string) => {
    headers.set("Location", config.ready ? config.origin + path : "/account");
    return new Response(null, { status: 303, headers });
  };
  let csrf = jar.get(prefix + "csrf");
  if (!csrf || !/^[a-f0-9]{64}$/.test(csrf)) {
    csrf = randomBytes(32).toString("hex");
    set(prefix + "csrf", csrf, { sameSite: "strict" });
  }
  let clients: ReturnType<ClientFactory> | undefined;
  try {
    if (request.method !== "GET" && request.method !== "POST")
      throw new Failure(405, "Method not allowed.");
    if (request.method === "GET" && route === "session" && !config.ready)
      return json({
        configured: false,
        reason: config.reason,
        google: false,
        facebook: false,
        user: null,
        csrf,
        fresh: false,
      });
    if (!config.ready) throw new Failure(503, config.reason, "setup_required");
    if (request.method === "POST") {
      if (
        request.headers.get("origin") !== config.origin ||
        request.headers.get("sec-fetch-site") === "cross-site" ||
        !equal(request.headers.get("x-inkstrip-csrf") ?? "", csrf)
      )
        throw new Failure(
          403,
          "This request could not be verified. Refresh the account page.",
          "csrf",
        );
    }
    clients = factory(
      request,
      {
        getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
        setAll: (items) => {
          for (const item of items) {
            const remember = jar.get(prefix + "remember") !== "0",
              options = { ...item.options };
            if (item.name.includes("code-verifier")) options.maxAge = 600;
            else if (options.maxAge !== 0) {
              delete options.expires;
              if (!remember) delete options.maxAge;
              else options.maxAge = Math.min(options.maxAge ?? 2592000, 2592000);
            }
            set(item.name, item.value, options);
          }
        },
      },
      config,
    );
    const { user: client, admin } = clients;
    const health = await admin.rpc("inkstrip_schema_version");
    if (health.error || health.data !== 1)
      throw new Failure(
        503,
        "Cloud database setup is incomplete. Local projects are safe.",
        "setup_required",
      );
    const audit = async (event: string, outcome: "ok" | "denied" | "error", id?: string) => {
      const r = await admin
        .from("inkstrip_account_audit")
        .insert({ user_id: id ?? null, event, outcome, request_id: requestId });
      if (r.error) console.error("account-audit-unavailable", requestId, event);
    };
    const rate = async (action: string, subject: string, limit: number, seconds: number) => {
      const key = createHmac("sha256", config.rateSecret)
          .update(action + "\0" + subject)
          .digest("hex"),
        r = await admin.rpc("inkstrip_consume_rate", {
          p_key: key,
          p_limit: limit,
          p_seconds: seconds,
        });
      if (r.error) throw new Failure(503, "Account protection is temporarily unavailable.");
      if (!r.data?.allowed)
        throw new Failure(
          429,
          "Too many attempts. Wait before trying again.",
          "rate_limited",
          r.data?.retry ?? 60,
        );
    };
    const ip = env.VERCEL
      ? (request.headers.get("x-vercel-forwarded-for") ??
        request.headers.get("x-forwarded-for") ??
        "unknown")
      : "development";
    const authUser = async (optional = false) => {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) {
        if (optional) return null;
        throw new Failure(401, "Sign in to continue.", "signed_out");
      }
      return data.user;
    };
    const confirmed = async () => {
      const u = (await authUser())!;
      if (!u.email_confirmed_at)
        throw new Failure(
          403,
          "Verify your email before using account features.",
          "email_unverified",
        );
      return u;
    };
    const profile = async (u: User) => {
      const r = await client.from("inkstrip_profiles").select("*").eq("id", u.id).single();
      if (r.error || !r.data) throw new Failure(503, "Your account profile could not be loaded.");
      return r.data;
    };
    const active = async () => {
      const u = await confirmed(),
        p = await profile(u);
      if (p.deleting_at)
        throw new Failure(
          409,
          "Account deletion is pending. Complete deletion or contact support.",
          "deletion_pending",
        );
      return u;
    };
    const sessionId = async () => {
      const r = await client.auth.getClaims();
      const id = r.data?.claims?.session_id;
      if (r.error || typeof id !== "string")
        throw new Failure(401, "Sign in again to confirm this action.");
      return id;
    };
    const grant = async (kind: "fresh" | "recovery", u: User) => {
      const token = randomBytes(32).toString("hex"),
        r = await admin.from("inkstrip_account_actions").insert({
          id_hash: digest(token),
          kind,
          user_id: u.id,
          session_id: await sessionId(),
          expires_at: new Date(Date.now() + (kind === "fresh" ? 120 : 600) * 1000).toISOString(),
        });
      if (r.error) throw new Failure(503, "Account confirmation is unavailable.");
      set(prefix + kind, token, { maxAge: kind === "fresh" ? 120 : 600, sameSite: "strict" });
    };
    const consume = async (kind: "fresh" | "recovery", u: User) => {
      const token = jar.get(prefix + kind) ?? "",
        r = await admin.rpc("inkstrip_consume_action", {
          p_hash: digest(token),
          p_kind: kind,
          p_user: u.id,
          p_session: await sessionId(),
        });
      set(prefix + kind, "", { maxAge: 0 });
      if (r.error)
        throw new Failure(
          403,
          "Confirm your identity again; the confirmation expired or was used.",
          "reauth_required",
        );
    };
    const safeUser = async (u: User): Promise<AccountUser> => {
      const p = await profile(u);
      return {
        id: u.id,
        email: u.email ?? "",
        name: p.display_name,
        avatar: p.avatar_url ?? null,
        verified: !!u.email_confirmed_at,
        providers: (u.identities ?? []).map((i) => i.provider),
        createdAt: u.created_at,
        preferences: p.preferences ?? {},
        deleting: !!p.deleting_at,
      };
    };
    if (request.method === "GET" && route === "session") {
      const u = await authUser(true);
      return json({
        configured: true,
        reason: null,
        google: config.google,
        facebook: config.facebook,
        user: u?.email_confirmed_at ? await safeUser(u) : null,
        csrf,
        fresh: !!jar.get(prefix + "fresh"),
      });
    }
    if (request.method === "GET" && route === "callback") {
      const flow = url.searchParams.get("flow") ?? "",
        cookie = jar.get(prefix + "flow") ?? "";
      if (!flow || !equal(flow, cookie))
        throw new Failure(400, "The sign-in flow could not be verified.");
      const intent = await admin.rpc("inkstrip_consume_action", {
        p_hash: digest(flow),
        p_kind: jar.get(prefix + "flow-kind") ?? "",
        p_user: null,
        p_session: null,
      });
      set(prefix + "flow", "", { maxAge: 0 });
      set(prefix + "flow-kind", "", { maxAge: 0 });
      if (intent.error || url.searchParams.has("error") || !url.searchParams.get("code"))
        return redirect("/account?notice=oauth_cancelled");
      const exchange = await client.auth.exchangeCodeForSession(url.searchParams.get("code")!);
      if (exchange.error) return redirect("/account?notice=oauth_failed");
      const u = await confirmed();
      if (intent.data.kind !== "oauth_signin" && intent.data.user_id !== u.id) {
        await client.auth.signOut({ scope: "local" });
        return redirect("/account?notice=identity_mismatch");
      }
      if (intent.data.kind === "oauth_reauth") await grant("fresh", u);
      await audit("oauth_callback", "ok", u.id);
      return redirect("/account");
    }
    if (request.method === "GET" && route === "projects") {
      const u = await active(),
        r = await client
          .from("inkstrip_cloud_projects")
          .select("id,local_id,title,head_revision,updated_at")
          .eq("owner_id", u.id)
          .order("updated_at", { ascending: false });
      if (r.error) throw new Failure(503, "Cloud projects could not be loaded.");
      return json({ projects: r.data });
    }
    if (request.method === "GET" && route === "revision") {
      const u = await active(),
        id = url.searchParams.get("project") ?? "";
      if (!UUID.test(id)) throw new Failure(400, "Invalid project.");
      const p = await client
        .from("inkstrip_cloud_projects")
        .select("*")
        .eq("owner_id", u.id)
        .eq("id", id)
        .single();
      if (p.error || !p.data) throw new Failure(404, "Cloud project not found.");
      const revision = Number(url.searchParams.get("revision") ?? p.data.head_revision);
      if (!Number.isSafeInteger(revision) || revision < 1)
        throw new Failure(404, "No published revision exists.");
      const r = await client
        .from("inkstrip_cloud_revisions")
        .select("revision,manifest,manifest_hash,created_at")
        .eq("owner_id", u.id)
        .eq("project_id", id)
        .eq("revision", revision)
        .single();
      if (r.error || !r.data) throw new Failure(404, "Cloud revision not found.");
      return json(r.data);
    }
    if (route === "chunk") {
      const u = await active(),
        id = url.searchParams.get("project") ?? "",
        sha = url.searchParams.get("digest") ?? "";
      if (!UUID.test(id) || !DIGEST.test(sha)) throw new Failure(400, "Invalid project chunk.");
      const project = await client
        .from("inkstrip_cloud_projects")
        .select("id")
        .eq("owner_id", u.id)
        .eq("id", id)
        .single();
      if (project.error || !project.data) throw new Failure(404, "Cloud project not found.");
      const path = storagePath(u.id, id, sha);
      await rate("chunk", u.id, 5000, 3600);
      if (request.method === "GET") {
        const r = await client.storage.from(BUCKET).download(path);
        if (r.error || !r.data) throw new Failure(404, "Cloud asset not found.");
        if (r.data.size > CHUNK_BYTES) throw new Failure(422, "Cloud asset size is invalid.");
        const data = new Uint8Array(await r.data.arrayBuffer());
        if (digest(data) !== sha) throw new Failure(422, "Cloud asset integrity check failed.");
        headers.set("Content-Type", "application/octet-stream");
        headers.set("Content-Disposition", 'attachment; filename="project.part"');
        return new Response(data, { headers });
      }
      const data = await bytes(request, CHUNK_BYTES);
      if (!data.length || digest(data) !== sha)
        throw new Failure(422, "The upload did not pass its integrity check.");
      const receipt = await admin
        .from("inkstrip_cloud_chunks")
        .select("bytes")
        .eq("owner_id", u.id)
        .eq("project_id", id)
        .eq("digest", sha)
        .maybeSingle();
      if (receipt.error) throw new Failure(503, "Upload verification is unavailable.");
      if (receipt.data?.bytes === data.length) return json({ verified: true, duplicate: true });
      const upload = await client.storage
        .from(BUCKET)
        .upload(path, data, { contentType: "application/octet-stream", upsert: false });
      if (upload.error) {
        const existing = await client.storage.from(BUCKET).download(path);
        if (
          existing.error ||
          !existing.data ||
          existing.data.size !== data.length ||
          digest(new Uint8Array(await existing.data.arrayBuffer())) !== sha
        )
          throw new Failure(
            409,
            "A cloud chunk could not be verified. Keep the local copy and retry.",
            "chunk_conflict",
          );
      }
      const stored = await admin
        .from("inkstrip_cloud_chunks")
        .upsert(
          { owner_id: u.id, project_id: id, digest: sha, bytes: data.length, path },
          { onConflict: "project_id,digest" },
        );
      if (stored.error) throw new Failure(503, "Upload receipt could not be saved. Retry safely.");
      return json({ verified: true, duplicate: !!upload.error });
    }
    if (request.method !== "POST") throw new Failure(404, "Account endpoint not found.");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new Failure(415, "Use a JSON request.");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(
        new TextDecoder().decode(await bytes(request, route === "commit" ? 160000 : 32768)),
      );
      if (!body || Array.isArray(body) || typeof body !== "object") throw Error();
    } catch (e) {
      if (e instanceof Failure) throw e;
      throw new Failure(400, "Invalid request.");
    }
    const generic = {
      message:
        "If this address is eligible, an email will arrive. Check your inbox and spam folder.",
    };
    if (["signup", "login", "resend", "forgot", "verify"].includes(route)) {
      const email = emailAddress(body.email);
      await rate("auth-ip", ip, 60, 600);
      if (route === "signup") {
        const password = strongPassword(body.password),
          name = displayName(body.name);
        if (body.accepted !== true)
          throw new Failure(400, "Accept the Terms and Privacy Policy to create an account.");
        await rate("signup", ip, 5, 3600);
        await rate("resend-email", email, 1, 60);
        const r = await client.auth.signUp({
          email,
          password,
          options: { data: { display_name: name, terms_version: CONSENT_VERSION } },
        });
        if (r.data.session) {
          await client.auth.signOut({ scope: "local" });
          throw new Failure(
            503,
            "Email confirmation must be enabled by the account administrator.",
            "setup_required",
          );
        }
        if (r.error && r.error.status && r.error.status >= 500)
          throw new Failure(503, "Account registration is temporarily unavailable.");
        await audit("signup_requested", "ok");
        return json(generic);
      }
      if (route === "login") {
        if (typeof body.password !== "string" || body.password.length > 128)
          throw new Failure(400, "Enter your password.");
        await rate("login-email", email, 10, 900);
        set(prefix + "remember", body.remember === true ? "1" : "0", { maxAge: 31536000 });
        const r = await client.auth.signInWithPassword({ email, password: body.password });
        if (r.error) {
          await audit("login", "denied");
          throw new Failure(
            401,
            "Sign-in failed. Check your email, password and email verification.",
            "invalid_credentials",
          );
        }
        const u = await confirmed();
        await audit("login", "ok", u.id);
        return json({ user: await safeUser(u) });
      }
      if (route === "forgot" || route === "resend") {
        await rate("resend-email", email, 1, 60);
        await rate("send-email", email, 3, 600);
        const r =
          route === "forgot"
            ? await client.auth.resetPasswordForEmail(email)
            : await client.auth.resend({ type: "signup", email });
        if (r.error && r.error.status && r.error.status >= 500)
          throw new Failure(503, "Email service is temporarily unavailable.");
        await audit(route, "ok");
        return json(generic);
      }
      if (route === "verify") {
        if (
          typeof body.code !== "string" ||
          !/^\d{6}$/.test(body.code) ||
          !["signup", "recovery"].includes(String(body.type))
        )
          throw new Failure(400, "Enter the six-digit email code.");
        await rate("verify-email", email, 6, 600);
        const r = await client.auth.verifyOtp({
          email,
          token: body.code,
          type: body.type as "signup" | "recovery",
        });
        if (r.error)
          throw new Failure(
            400,
            "The code is invalid or expired. Request a new code.",
            "invalid_code",
          );
        const u = await confirmed();
        if (body.type === "recovery") await grant("recovery", u);
        await audit("email_verified", "ok", u.id);
        return json({ verified: true });
      }
    }
    if (route === "oauth") {
      const provider = body.provider;
      if (
        (provider !== "google" && provider !== "facebook") ||
        !(provider === "google" ? config.google : config.facebook)
      )
        throw new Failure(
          503,
          "This login provider has not been configured.",
          "provider_unavailable",
        );
      const purpose =
          body.purpose === "reauth"
            ? "oauth_reauth"
            : body.purpose === "link"
              ? "oauth_link"
              : "oauth_signin",
        prior = purpose === "oauth_signin" ? null : await confirmed();
      await rate("oauth", ip, 20, 600);
      const flow = randomBytes(32).toString("hex"),
        r = await admin.from("inkstrip_account_actions").insert({
          id_hash: digest(flow),
          kind: purpose,
          user_id: prior?.id ?? null,
          expires_at: new Date(Date.now() + 600000).toISOString(),
        });
      if (r.error) throw new Failure(503, "Sign-in could not be started.");
      set(prefix + "flow", flow, { maxAge: 600 });
      set(prefix + "flow-kind", purpose, { maxAge: 600 });
      set(prefix + "remember", body.remember === false ? "0" : "1", { maxAge: 31536000 });
      const options: {
        redirectTo: string;
        skipBrowserRedirect: boolean;
        queryParams?: Record<string, string>;
      } = {
        redirectTo: `${config.origin}/api/account/callback?flow=${flow}`,
        skipBrowserRedirect: true,
        queryParams:
          provider === "google"
            ? purpose === "oauth_reauth"
              ? { prompt: "select_account", max_age: "0" }
              : { prompt: "select_account" }
            : purpose === "oauth_reauth"
              ? { auth_type: "reauthorize" }
              : undefined,
      };
      const sign =
        purpose === "oauth_link"
          ? await client.auth.linkIdentity({ provider, options })
          : await client.auth.signInWithOAuth({ provider, options });
      if (sign.error || !sign.data.url)
        throw new Failure(503, "The provider sign-in could not be started.");
      const destination = new URL(sign.data.url);
      if (destination.origin !== config.url)
        throw new Failure(503, "The provider redirect could not be verified.");
      return json({ url: destination.href });
    }
    if (route === "logout") {
      await rate("logout", ip, 60, 600);
      const r = await client.auth.signOut({ scope: "local" });
      if (r.error && r.error.status && r.error.status >= 500)
        throw new Failure(503, "Logout could not be confirmed. Retry.");
      for (const name of ["fresh", "recovery", "flow", "flow-kind"])
        set(prefix + name, "", { maxAge: 0 });
      return json({ signedOut: true });
    }
    if (route === "reset-password") {
      const u = await confirmed();
      await rate("password", u.id, 6, 600);
      const password = strongPassword(body.password);
      await consume("recovery", u);
      const r = await client.auth.updateUser({ password });
      if (r.error)
        throw new Failure(400, "Password could not be updated. Request a new recovery code.");
      await audit("password_recovered", "ok", u.id);
      const revoked = await client.auth.signOut({ scope: "global" });
      if (revoked.error)
        throw new Failure(
          503,
          "Your password was updated, but session revocation could not be confirmed. Sign out and contact support.",
        );
      return json({ updated: true });
    }
    if (route === "reauth") {
      const u = await confirmed();
      await rate("reauth", u.id, 6, 600);
      if (!u.email || typeof body.password !== "string" || body.password.length > 128)
        throw new Failure(400, "Enter the current password.");
      const r = await client.auth.signInWithPassword({ email: u.email, password: body.password });
      if (r.error || r.data.user?.id !== u.id)
        throw new Failure(401, "Your identity could not be confirmed.");
      await grant("fresh", r.data.user);
      await audit("reauth", "ok", u.id);
      return json({ fresh: true });
    }
    if (route === "change-password") {
      const u = await active(),
        password = strongPassword(body.password);
      await rate("password", u.id, 6, 600);
      await consume("fresh", u);
      const r = await client.auth.updateUser({ password });
      if (r.error)
        throw new Failure(400, "Password could not be updated. Confirm your identity and retry.");
      const revoked = await client.auth.signOut({ scope: "others" });
      if (revoked.error)
        throw new Failure(
          503,
          "Your password was updated, but other sessions could not be revoked. Sign out and contact support.",
        );
      await audit("password_changed", "ok", u.id);
      return json({ updated: true });
    }
    if (route === "profile") {
      const u = await active(),
        name = displayName(body.name),
        avatar = avatarUrl(body.avatar);
      const preferences = body.preferences ?? {};
      if (
        !preferences ||
        Array.isArray(preferences) ||
        typeof preferences !== "object" ||
        JSON.stringify(preferences).length > 8000
      )
        throw new Failure(400, "Invalid account preferences.");
      await rate("profile", u.id, 60, 600);
      const r = await client
        .from("inkstrip_profiles")
        .update({
          display_name: name,
          avatar_url: avatar,
          preferences,
          updated_at: new Date().toISOString(),
        })
        .eq("id", u.id)
        .select("id")
        .single();
      if (r.error || !r.data) throw new Failure(503, "Profile could not be saved.");
      return json({ saved: true });
    }
    if (route === "open-project") {
      const u = await active();
      await rate("project-write", u.id, 300, 3600);
      if (
        typeof body.localId !== "string" ||
        body.localId.length < 1 ||
        body.localId.length > 200 ||
        typeof body.title !== "string" ||
        !body.title.trim() ||
        body.title.length > 300
      )
        throw new Failure(400, "Invalid project metadata.");
      const r = await admin.rpc("inkstrip_open_project", {
        p_owner: u.id,
        p_local: body.localId,
        p_title: body.title,
      });
      if (r.error) throw new Failure(503, "The cloud project could not be opened.");
      return json({ project: r.data });
    }
    if (route === "commit") {
      const u = await active();
      await rate("project-write", u.id, 300, 3600);
      if (
        !UUID.test(String(body.project)) ||
        !Number.isInteger(body.base) ||
        Number(body.base) < 0 ||
        typeof body.title !== "string" ||
        !body.title.trim() ||
        body.title.length > 300
      )
        throw new Failure(400, "Invalid project revision.");
      const manifest = validateManifest(body.manifest),
        hash = digest(canonicalManifest(manifest));
      const r = await admin.rpc("inkstrip_commit_revision", {
        p_owner: u.id,
        p_project: body.project,
        p_base: body.base,
        p_manifest: manifest,
        p_hash: hash,
        p_title: body.title,
      });
      if (r.error) {
        if (r.error.message.includes("REVISION_CONFLICT"))
          throw new Failure(
            409,
            "A newer cloud revision exists. Download it or upload as a separate copy.",
            "revision_conflict",
          );
        throw new Failure(503, "The cloud revision could not be published. Keep your local copy.");
      }
      await audit("project_published", "ok", u.id);
      return json({ ...r.data, hash });
    }
    if (route === "delete-account") {
      const u = await confirmed();
      if (body.confirm !== "DELETE")
        throw new Failure(400, "Type DELETE to confirm permanent cloud account deletion.");
      await rate("delete", u.id, 6, 600);
      await consume("fresh", u);
      const mark = await admin
        .from("inkstrip_profiles")
        .update({ deleting_at: new Date().toISOString() })
        .eq("id", u.id);
      if (mark.error) throw new Failure(503, "Account deletion could not start.");
      while (true) {
        const r = await admin
          .from("inkstrip_cloud_chunks")
          .select("path")
          .eq("owner_id", u.id)
          .limit(100);
        if (r.error)
          throw new Failure(503, "Deletion is incomplete. Confirm your identity and retry.");
        if (!r.data?.length) break;
        const paths = r.data.map((x) => String(x.path));
        if (paths.some((p) => !p.startsWith(u.id + "/")))
          throw new Failure(500, "Account deletion was stopped.");
        const removed = await admin.storage.from(BUCKET).remove(paths);
        if (removed.error)
          throw new Failure(
            503,
            "Cloud files could not be removed. Confirm your identity and retry.",
          );
        const done = await admin
          .from("inkstrip_cloud_chunks")
          .delete()
          .eq("owner_id", u.id)
          .in("path", paths);
        if (done.error) throw new Failure(503, "Deletion is incomplete. Retry safely.");
      }
      // Include uncommitted/direct-upload objects, recursively under this owner only.
      const erase = async (prefixPath: string, depth = 0): Promise<void> => {
        if (depth > 3) throw new Failure(503, "Cloud file cleanup requires support.");
        while (true) {
          const r = await admin.storage.from(BUCKET).list(prefixPath, { limit: 100 });
          if (r.error) throw new Failure(503, "Cloud file cleanup is incomplete. Retry.");
          if (!r.data?.length) return;
          for (const item of r.data) {
            const path = prefixPath + "/" + item.name;
            if (!item.id) await erase(path, depth + 1);
            else {
              const removed = await admin.storage.from(BUCKET).remove([path]);
              if (removed.error) throw new Failure(503, "Cloud file cleanup is incomplete. Retry.");
            }
          }
        }
      };
      await erase(u.id);
      await audit("account_deleted", "ok", u.id);
      const result = await admin.auth.admin.deleteUser(u.id);
      if (result.error)
        throw new Failure(
          503,
          "File cleanup completed; account deletion needs a retry. Confirm your identity again.",
        );
      await client.auth.signOut({ scope: "local" });
      return json({ deleted: true, localCopiesPreserved: true });
    }
    throw new Failure(404, "Account endpoint not found.");
  } catch (error) {
    if (route === "callback") return redirect("/account?notice=oauth_failed");
    if (error instanceof Failure) {
      if (error.retry) headers.set("Retry-After", String(error.retry));
      return json({ error: error.message, code: error.code, requestId }, error.status);
    }
    if (
      error instanceof Error &&
      /^(Enter |Use |Accept |Invalid |Project package|Avatar URLs|Configure )/.test(error.message)
    )
      return json({ error: error.message, code: "invalid_input", requestId }, 400);
    return json(
      {
        error: "The account service could not complete this request. Local projects are safe.",
        code: "service_unavailable",
        requestId,
      },
      503,
    );
  }
}
