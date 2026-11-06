# Hosted Supabase setup — November 6, 2026

PR #35 remains a draft. The database is now provisioned and configured, but **live account signup/recovery, authenticated file transfers and OAuth are not yet verified**. No merge or Vercel production release is claimed.

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

Both statement batches in Supabase migration history match the corresponding local SQL files byte-for-byte by SHA-256. Local filenames were aligned to the actual hosted migration versions so subsequent CLI migration history is consistent. The first migration's reviewed SQL content is unchanged; its original filename at commit c5977ea was `202611060001_inkstrip_accounts.sql`. Do not reapply either migration to this configured project.

## Hosted issue found and fixed

Supabase's real hosted defaults explicitly granted `EXECUTE` to `anon` and `authenticated` for new public functions. The original local PostgreSQL test scaffold did not reproduce those defaults. The advisor caught policy helpers and the auth-profile trigger function as browser-callable definers; the schema-version function also lacked a fixed search path.

The new migration moves the four internal functions to the unexposed `inkstrip_private` schema, explicitly revokes inherited grants, restores only the helper execution needed by RLS, keeps the trigger non-callable by browser roles, fixes the service-only schema function search path and narrows overview-view privileges. Stored trigger/policy dependencies remain attached. Three FK indexes and statement-cached identity predicates address the reported performance findings. No existing row or image is deleted or rewritten.

Regression tests now simulate Supabase's explicit default grants. Positive ownership operations continue to pass, and exposed browser-callable privileged functions are rejected.

## Live verification performed

- Supabase migration history, project health, table RLS flags, policies, function grants and private bucket restrictions queried directly on the hosted project.
- Security advisor: **no WARN/ERROR findings after the fix**. The three INFO notices are deliberate default-deny server-only action/audit/rate tables, with no browser grants or policies. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Do not add permissive policies to silence them.
- Performance advisor: only unused-index INFO notices on the new empty database; required FK/init-plan findings resolved. Health advisor: no findings.
- Actual hosted Data API requests with the publishable key reject anonymous access to all seven private tables: HTTP 401 / PostgreSQL `42501`.
- Actual hosted HTTP probes prove the private schema is not exposed (`406/PGRST106`), the moved helper is absent from public RPC (`404/PGRST202`) and the service health RPC rejects anonymous callers (`401/42501`).
- Public hosted Auth settings: email enabled, signup enabled, **email autoconfirm false**; Google/Facebook disabled. This does not establish OTP expiry, SMTP, password recovery or actual delivery.
- Hosted counters verified: zero Auth users, zero cloud projects and zero stored object records. No email sent, primary identity created/deleted or private user project inspected.

## Local checks and explicit limits

Full local suite: **1,208 tests pass**, including the new hosted-default-grant and transactional-fixture regressions. Typecheck, lint, build and build configuration checks pass. The new SQL check is validated locally and rolls back every fixture. It lives in `supabase/checks` because it emits assertion/report SQL, not pgTAP output; it is not silently registered as a pg_prove test.

The account browser suite also passes signup/verification/recovery/logout with mocked providers, real local IndexedDB upload interruption/resume/conflict/source-hash restore, and touch/reduced-motion at 320/360/390/430 px with no errors. These continue to be explicitly mock-transport results, not hosted Auth sessions.

The hosted SQL tool returned `INVALID_ARGUMENT` for `supabase/checks/accounts_isolation.sql`; this was not counted as a live pass, and follow-up counters confirm no retained fixture rows. A read-only transaction probe succeeds, but the full transactional fixture operation was not accepted. No tool restriction was bypassed or permission weakened to make it run.

With the actual URL and publishable key supplied, `test:accounts:live` now reports **blocked solely by missing `SUPABASE_SERVICE_ROLE_KEY`**. That runner's actual Auth sessions, cross-user HTTP checks, upload/download/refresh/revocation and cleanup remain unexecuted. SQL configuration checks and local tests must not be presented as those end-to-end results.

## Remaining owner access and release gates

1. **Vercel:** no Vercel tools are available in this session; its connection check still reports unconnected. Complete that app authorization to the account owning the existing Inkstrip project. No duplicate Vercel project or environment changes were made.
2. **Server credential binding:** the connected Supabase tool exposes publishable keys but not the private project secret/service-role key. Supply that key through the managed environment's secret store for live QA and through Vercel's server-only encrypted variables for the app. Never send it in chat, commit it, or prefix it with `VITE_`. The exact server variable names remain in ACCOUNTS_SETUP.md. The server HMAC secret must likewise be generated securely and stored as a secret.
3. **Auth/SMTP configuration:** the available Supabase tools manage projects/SQL but do not expose Auth-provider configuration. Owner dashboard/authorized Management API access is still needed for OTP length **6**, expiry **600 seconds**, resend limits, canonical Site URL/redirect allow-list, sender settings and templates. Keep confirmation enabled. The existing app origin is `https://inkstrip-manhwa-studio.vercel.app`; configure a separate actual staging origin for pre-release tests.
4. **Free email limitation:** new Free projects on default Supabase SMTP cannot customize auth templates. [Official June 2026 change](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier). Custom SMTP on a free tier can unlock the prepared branded code templates; a verified owner sender/domain and provider account are required. No paid workaround, domain purchase or verification bypass was used.
5. **Authorized recipient:** the owner must provide the email authorized for real signup/recovery tests. No address has been guessed or harvested. Codes and provider approvals must be completed through a secure app/browser interaction, never chat. Existing personal accounts/projects must not be deleted for QA.
6. **Google / Meta:** OAuth client credentials/consent setup are still unavailable. The provider callback is `https://cjpsxidhklspzcqnpngx.supabase.co/auth/v1/callback`. Leave providers disabled until tested; Meta developer-role success is not public approval.

After those inputs are available, run real registration/recovery, isolated authenticated security checks, full-project migration/restore and desktop/mobile hosted-browser workflows. Only after all required tests and current-head GitHub checks pass may PR #35 be merged normally and Vercel production verified. **Merge SHA: none. Production remains on main's existing release.**
