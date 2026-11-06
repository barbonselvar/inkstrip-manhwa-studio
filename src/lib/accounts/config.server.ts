import { safeOrigin } from "./policy.ts";
export type AccountEnv = Record<string, string | undefined>;
export function accountConfig(env: AccountEnv) {
  const production = env.NODE_ENV === "production";
  const values = [
    env.INKSTRIP_ACCOUNT_ORIGIN,
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.INKSTRIP_ACCOUNT_RATE_SECRET,
  ];
  if (values.some((v) => !v?.trim()) || env.INKSTRIP_ACCOUNTS_ENABLED !== "true")
    return {
      ready: false as const,
      reason: "Cloud accounts are not configured. Your local studio remains available.",
    };
  try {
    const emailMode = env.INKSTRIP_EMAIL_MODE ?? "otp";
    if (emailMode !== "otp" && emailMode !== "link") throw Error();
    const origin = safeOrigin(values[0]!, production),
      url = new URL(values[1]!);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        (production ||
          url.protocol !== "http:" ||
          !["localhost", "127.0.0.1"].includes(url.hostname))) ||
      values[4]!.length < 32
    )
      throw Error();
    return {
      ready: true as const,
      origin,
      url: url.origin,
      anon: values[2]!,
      service: values[3]!,
      rateSecret: values[4]!,
      emailMode,
      secure: new URL(origin).protocol === "https:",
      google: env.INKSTRIP_GOOGLE_ENABLED === "true",
      // Public email/password registration needs a working custom SMTP sender. Set
      // INKSTRIP_EMAIL_SIGNUP_ENABLED=false for Google-only registration; existing
      // email accounts keep signing in and recovering their passwords.
      emailSignup: env.INKSTRIP_EMAIL_SIGNUP_ENABLED !== "false",
      facebook: env.INKSTRIP_FACEBOOK_ENABLED === "true",
    };
  } catch {
    return {
      ready: false as const,
      reason:
        "Cloud account security configuration is incomplete. The local studio remains available.",
    };
  }
}
