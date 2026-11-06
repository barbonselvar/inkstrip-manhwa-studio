# Authentication redirect incident — November 6, 2026

The owner confirmed both signup and password-recovery emails arrived. Opening them on Android led to `http://localhost:3000` / connection refused. Delivery is verified; application authentication and reset are not.

## Live findings

The Vercel Production `INKSTRIP_ACCOUNT_ORIGIN` value is verified as `https://inkstrip-manhwa-studio.vercel.app`. No production app setting contains a localhost fallback. Supabase's actual redirect resolution is wrong:

| Non-mutating provider diagnostic | HTTP | Observed destination     |
| -------------------------------- | ---- | ------------------------ |
| Default Site URL                 | 303  | `http://localhost:3000/` |
| Explicit signup callback         | 303  | `http://localhost:3000/` |
| Explicit recovery callback       | 303  | `http://localhost:3000/` |

These requests use a deliberately invalid token not associated with an account, follow no redirect, send no email and change no identity. They test redirect resolution, not successful authentication. Exit 1 is the expected **failing live gate**, not a passing result.

The default Site URL remains the development origin and the requested production callbacks are not accepted. Supabase documents this fallback in [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls). The earlier standalone delivery requests could not prove callback readiness: their explicit production root was not accepted either.

Production currently returns **404** for `/account` and `/api/account/session`, because PR #35 is unreleased. The private server credential remains missing. Changing the provider Site URL alone cannot publish or enable the app's authentication handlers.

## Required provider configuration

The connected Supabase tools manage SQL/projects but do not expose Auth URL configuration, and no authorized Management API credential or authenticated dashboard browser is available. The owner must save these non-secret fields in [URL Configuration](https://supabase.com/dashboard/project/cjpsxidhklspzcqnpngx/auth/url-configuration):

- Site URL: `https://inkstrip-manhwa-studio.vercel.app`
- Email callback allow-list: `https://inkstrip-manhwa-studio.vercel.app/api/account/email-callback?flow=*`
- OAuth callback allow-list: `https://inkstrip-manhwa-studio.vercel.app/api/account/callback?flow=*`

The reset form is `/account?notice=recovery_verified`, reached only after the email callback exchanges the PKCE code and creates a server-side recovery grant. It is not a replacement provider callback. Adding its URL to an allow-list does not authorize a password change. A fake notice without a valid grant cannot reset a password.

Local development retains an explicit `http://localhost:8080` app origin outside production. If needed, allow its two exact callback paths on the development/test backend; never use it as the production Site URL. Do not add unrestricted host wildcards.

After the owner saves settings, rerun `test:accounts:redirects` with `INKSTRIP_LIVE_REDIRECT_QA_ENABLED=true`, the real `SUPABASE_URL` and canonical `INKSTRIP_ACCOUNT_ORIGIN`. It verifies the default and both email callback types without sending email or accessing a real token. Correct URL configuration is necessary but does not establish a session/security pass.

## Application fixes

- Every signup, confirmation resend and recovery request now supplies the trusted origin's explicit PKCE callback, in both numeric-code and link UI modes. No flow relies on the provider's default redirect.
- Production origin validation rejects HTTP and HTTPS loopback/unspecified addresses, including localhost subdomains, normalized IPv4 and IPv6 loopbacks. Normal local development remains supported.
- Both delivery modes accept securely bound links. The callback checks the same-browser nonce, expiring single-use intent and intended email, uses official code exchange, and requires the provider recovery event before issuing a session-bound reset grant.
- Prepared custom templates retain six-digit codes and offer provider-generated `{{ .ConfirmationURL }}` links. They do not concatenate tokens or use localhost/`.SiteURL` links. They are source assets, **not applied** to the restricted default sender; its built-in templates should remain unchanged.
- No existing account is unconfirmed/deleted or project overwritten. No password, session token or real email link is logged.

## Verification and open gates

All **1,223 local tests** pass, including 41 account/PostgreSQL/SDK tests and three redirect-checker tests. Typecheck, lint, build and Vercel build-configuration checks pass. Browser verification covers code and link modes and local project persistence/recovery with explicitly mocked provider transport. Live redirect diagnostics still fail until provider settings are saved; this is not live Android authentication success.

Fresh emails must be requested from a working app/browser session after redirect configuration and callback readiness are verified, and within the built-in sender's two-messages/hour limit. Old links may be expired/used or retain their earlier destination. Open a new link in the same Android browser that requested it; a different email-app browser cannot supply that browser's PKCE cookie. Never share the URL/token in chat.

The existing test email is already verified. Do not delete or unconfirm that account to resend a signup message. A new registration-confirmation test requires an explicitly authorized fresh recipient already eligible for the restricted sender; recovery can use the existing authorized account.

`SUPABASE_SERVICE_ROLE_KEY` still needs secure server-only bindings in Vercel Production and the managed QA environment. Full browser callbacks/reset, cross-user RLS/Storage and cloud recovery must pass before merge/release. PR #35 remains draft/unmerged. Local follow-ups are not pushed because that normally triggers automatic Vercel preview deployment, which is held under the current no-deployment-before-live-verification instruction. No production release is claimed.
