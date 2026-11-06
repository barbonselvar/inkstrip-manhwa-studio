# Hosted Supabase setup — November 6, 2026

PR #35 remains a draft. **Restricted provider signup/confirmation/password login/profile read/logout have now passed with the owner-authorized test identity. Full application recovery, cross-user file transfers and OAuth are not yet verified.** No merge or Vercel deployment is claimed. The latest local follow-up adds PKCE email links because the owner has no custom domain or SMTP account and selected Supabase's restricted built-in sender.

## Vercel and email continuation

Team authorization now works for the existing `ss-ac00/inkstrip-manhwa-studio` project (`prj_PU0gVRI1bIsRjPCUDeYgkS5H19FQ`). There were no existing or hidden Production variables before setup. Eight Production-only entries are now prepared and verified by metadata: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INKSTRIP_ACCOUNT_ORIGIN`, `INKSTRIP_ACCOUNT_RATE_SECRET`, `INKSTRIP_ACCOUNTS_ENABLED`, `INKSTRIP_GOOGLE_ENABLED`, `INKSTRIP_FACEBOOK_ENABLED`, `INKSTRIP_EMAIL_MODE`. The 48-byte random rate secret is stored as a Vercel Secret/sensitive variable; no value was displayed or committed. Accounts and OAuth flags remain false; email mode is link. No preview credentials, paid plan, replacement project or deployment was created.

The missing `SUPABASE_SERVICE_ROLE_KEY` is genuinely needed by the existing server-only ledgers, revision publication and account cleanup. The connected Supabase tools expose publishable keys only. The owner must bind the project private key through Vercel's Production Secret interface and the managed live-QA Secret interface, never chat or browser-public variables. Do not enable accounts merely because the public settings are present.

The owner explicitly supplied a test recipient; its address is omitted from this report. An existence check confirmed no prior account for that address. One actual SDK signup used a random temporary application password held only in an isolated process's memory. Signup returned no session before confirmation. Hosted records subsequently show confirmation and profile creation. Actual user-session password login, own-profile read, logout, second login/read and second logout passed. The temporary diagnostic process was then terminated; no existing account or chapter was deleted. One password-recovery email request was accepted and its send timestamp exists. Message receipt and a complete password change are not yet verified. No OTP, email link, access token, refresh token or password was logged or snapshotted.

The new optional `INKSTRIP_EMAIL_MODE=link` flow uses official SSR PKCE, browser/email-bound hashed single-use intents, a supported `PASSWORD_RECOVERY` event and a session-bound reset grant. OTP mode is preserved. Desktop/mobile guidance matches the selected delivery mode. The app now surfaces provider sending limits and preserves SDK verifier-cookie deletion Max-Age zero. New callback/nonce/expiry/replay/identity/type-confusion, official SDK protocol, SQL grant and touch browser tests pass locally. Real application callbacks/reset remain blocked; the mode does not make the built-in sender suitable for public production mail.

## Resources actually configured

- Existing organization: `inkstrip-manhwa-studio`, ID `zgsvqttbchpxeduhtidf`; verified **Free** plan. No duplicate organization created.
- Project created: `inkstrip-manhwa-studio`, ref `cjpsxidhklspzcqnpngx`, **Paris / eu-west-3**, `ACTIVE_HEALTHY`, PostgreSQL `17.11.0.018` / GA. Supabase quoted **$0/month** before creation. No paid subscription or billing change was made.
- [Project dashboard](https://supabase.com/dashboard/project/cjpsxidhklspzcqnpngx)
- API origin: `https://cjpsxidhklspzcqnpngx.supabase.co`. Active publishable key discovered and used only for non-sensitive live API probes; no key values are recorded here.
- Seven application tables and ownership/relationship/index constraints installed. RLS is enabled on every table.
- `inkstrip-private`: private, 2,097,152-byte part limit, `application/octet-stream` only. The existing editable project package holds original images, native Raster documents, dialogue, Composition/SFX and associated assets. No separate incompatible chapter model or public image bucket was added.

## Migrations applied and matched to Git

| Hosted version   | Migration                       | Source SHA-256                                                     |
| ---------------- | ------------------------------- | ------------------------------------------------------------------ |
| `20261106101354` | `inkstrip_accounts`             | `b5ea2b33c09c25dffa389a4200828c656276e1bf80b10ae387486fbdc39d3ac3` |
| `20261106101958` | `harden_account_policy_helpers` | `4b7c1f511a3cfbe12d3969e74b7421e663cb7ba7f7b2c7c8fddd26da381f8e71` |
| `20261106134024` | `email_link_flows`              | `69b41e06a350e3cdb630de0228a8c2e648ceb3501d6dae04e7d2f72ff107f5a3` |

All three statement batches match their corresponding local SQL files by SHA-256. Local filenames match actual hosted versions for consistent CLI history. The first migration's reviewed SQL is unchanged; its original filename at c5977ea was `202611060001_inkstrip_accounts.sql`. The email-link migration adds a nullable hashed target and constrained intent kinds to the server-only ledger, preserving existing records. Do not reapply these migrations to this project.

## Hosted issue found and fixed

Supabase's real hosted defaults explicitly granted `EXECUTE` to `anon` and `authenticated` for new public functions. The original local PostgreSQL test scaffold did not reproduce those defaults. The advisor caught policy helpers and the auth-profile trigger function as browser-callable definers; the schema-version function also lacked a fixed search path.

The new migration moves the four internal functions to the unexposed `inkstrip_private` schema, explicitly revokes inherited grants, restores only the helper execution needed by RLS, keeps the trigger non-callable by browser roles, fixes the service-only schema function search path and narrows overview-view privileges. Stored trigger/policy dependencies remain attached. Three FK indexes and statement-cached identity predicates address the reported performance findings. No existing row or image is deleted or rewritten.

Regression tests now simulate Supabase's explicit default grants. Positive ownership operations continue to pass, and exposed browser-callable privileged functions are rejected.

## Live verification performed

- Supabase migration history, project health, table RLS flags, policies, function grants and private bucket restrictions queried directly on the hosted project.
- Database security findings remain resolved. The three INFO notices are deliberate default-deny server-only ledgers. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). The latest advisor additionally reports Auth WARN `auth_leaked_password_protection`; Supabase's check requires Pro or above, so no paid upgrade was enabled. [Provider limitation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Strong-password and application throttling rules remain intact. Do not weaken policies to silence notices.
- Performance advisor: only unused-index INFO notices on the new empty database; required FK/init-plan findings resolved. Health advisor: no findings.
- Actual hosted Data API requests with the publishable key reject anonymous access to all seven private tables: HTTP 401 / PostgreSQL `42501`.
- Actual hosted HTTP probes prove the private schema is not exposed (`406/PGRST106`), the moved helper is absent from public RPC (`404/PGRST202`) and the service health RPC rejects anonymous callers (`401/42501`).
- Public hosted Auth settings: email enabled, signup enabled, **email autoconfirm false**; Google/Facebook disabled. This does not establish OTP expiry, SMTP, password recovery or actual delivery.
- Before owner-authorized email testing, counters were zero users/projects/objects. The new authorized test identity is now confirmed, with a profile and no cloud projects; original projects were not inspected, changed or deleted.

## Local checks and explicit limits

Latest full local suite: **1,217 tests pass**, including 38 account/policy/PostgreSQL/official-SDK tests. Typecheck, lint, build and build configuration checks pass. The standalone transactional SQL check rolls back every local fixture; it is under `supabase/checks` because it emits assertion/report SQL rather than pgTAP output. Desktop/mobile link mode tests at 1440/360/390/430 px pass alongside the existing OTP, local migration, interruption/conflict and exact-image recovery checks. Transport is mocked in those browser checks.

The account browser suite also passes signup/verification/recovery/logout with mocked providers, real local IndexedDB upload interruption/resume/conflict/source-hash restore, and touch/reduced-motion at 320/360/390/430 px with no errors. These continue to be explicitly mock-transport results, not hosted Auth sessions.

The hosted SQL tool returned `INVALID_ARGUMENT` for `supabase/checks/accounts_isolation.sql`; this was not counted as a live pass, and follow-up counters confirm no retained fixture rows. A read-only transaction probe succeeds, but the full transactional fixture operation was not accepted. No tool restriction was bypassed or permission weakened to make it run.

With the actual URL/publishable key supplied, `test:accounts:live` remains **blocked by missing `SUPABASE_SERVICE_ROLE_KEY`**. Its isolated multi-account HTTP, upload/download/refresh/revocation and cleanup checks remain unexecuted. The separate authorized provider login/profile test above does not establish those cross-user or cloud-recovery gates.

## Remaining owner access and release gates

1. **Vercel:** authorization and eight scoped settings are complete. The private server key remains missing. Accounts are disabled. Production remains on `55bc1f1ba183a0bc9f7a14c8ebac9f4adb8cc33d`; no deployment was triggered.
2. **Server credential binding:** the connected Supabase tool exposes publishable keys but not the private project secret/service-role key. Supply that key through the managed environment's secret store for live QA and through Vercel's server-only encrypted variables for the app. Never send it in chat, commit it, or prefix it with `VITE_`. The exact server variable names remain in ACCOUNTS_SETUP.md. The server HMAC secret must likewise be generated securely and stored as a secret.
3. **Auth settings:** the connected tools do not manage Auth URLs/email settings. Owner dashboard access is needed for the canonical Site URL, the narrow `/api/account/email-callback?flow=*` allow-list on the actual app/test origin, and provider expiration/rate settings. Keep confirmation enabled. For future OTP mode configure six digits / 600 seconds with an eligible sender. Link mode's server intent expires after ten minutes regardless of provider token lifetime. See ACCOUNTS_SETUP.md.
4. **Free email limitation:** new Free projects on default Supabase SMTP cannot customize auth templates. [Official June 2026 change](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier). Custom SMTP on a free tier can unlock the prepared branded code templates; a verified owner sender/domain and provider account are required. No paid workaround, domain purchase or verification bypass was used.
5. **Authorized recipient:** now supplied and used for one signup and one recovery request, within the built-in allowance. Receipt/secure link interactions require the owner; never request a code or token in chat. No existing personal account/project may be deleted for QA. The built-in sender is for restricted initial testing, not public production registration.
6. **Google / Meta:** OAuth client credentials/consent setup are still unavailable. The provider callback is `https://cjpsxidhklspzcqnpngx.supabase.co/auth/v1/callback`. Leave providers disabled until tested; Meta developer-role success is not public approval.

After those inputs are available, run real registration/recovery, isolated authenticated security checks, full-project migration/restore and desktop/mobile hosted-browser workflows. Only after all required tests and current-head GitHub checks pass may PR #35 be merged normally and Vercel production verified. **Merge SHA: none. Production remains on main's existing release.**
