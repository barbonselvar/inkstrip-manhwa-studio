# Server-side Preview account verification

The existing real Supabase checker can run inside Vercel's build worker without exporting the private server key. This is opt-in and must never run against a production deployment or an unreviewed branch/commit.

`scripts/accounts-preview-build-check.mjs` runs after the normal build/migration commands. Ordinary local/CI/production builds do not request it, make no live requests and claim no live-test pass. When requested, it requires:

- `VERCEL_ENV=preview` and `VERCEL_GIT_COMMIT_REF=codex/cloud-accounts-cinematic-auth`.
- `INKSTRIP_LIVE_QA_ENABLED=true`, and `INKSTRIP_LIVE_QA_COMMIT` equal to the exact platform-provided `VERCEL_GIT_COMMIT_SHA`.
- The intended Supabase URL, publishable key and **server-only** `SUPABASE_SERVICE_ROLE_KEY`.

These variables and the private key must be scoped to the reviewed Preview branch, not all previews. Keep production account flags unchanged. A missing credential, wrong target/commit, failed security assertion or failed fixture cleanup fails the build and prevents that deployment from becoming ready.

The checker creates fresh server-marked synthetic identities and tiny private objects. It verifies real Auth sessions, own/other/anonymous RLS, ownership/grants, private Storage reads/writes and refresh/revocation; it cleans only its own tracked fixtures. It sends no email. It does not establish email delivery, browser callback/reset, OAuth or natural token expiry.

For browser/cloud recovery tests, optional `INKSTRIP_PREVIEW_QA_FIXTURE=true` provisions a separate, explicitly admin-confirmed synthetic identity. It requires a fresh UUID `INKSTRIP_QA_FIXTURE_RUN`, a random Secret `INKSTRIP_QA_FIXTURE_PASSWORD`, and `INKSTRIP_QA_FIXTURE_EXPIRES_AT` within the next two hours. The marker and expiry are stored in server-owned app metadata. This is a test-fixture lifetime plan, not automatic provider account expiration. Delete the fixture through its own authenticated reauthentication/deletion flow after testing. Never delete or unconfirm the owner's existing email account.

The optional `INKSTRIP_QA_FIXTURE_ID` permits narrowly scoped reuse after a rebuild only when ID, exact email, verified status and server-owned run/expiry markers match. There is no arbitrary-user reset, account listing or unconditional cleanup. Failed ownership checks stop without modifying/deleting an identity.

The protected Preview artifact `/__inkstrip-preview-security.json` contains only the tested commit, check outcomes, cleanup status and synthetic fixture identifiers. It contains no key, password, OTP or session token, and explicitly marks email/browser verification false. Fixture passwords stay in Secret bindings and the controlled browser runner's memory; they must not enter logs, traces, screenshots or source. Ordinary builds remove the generated artifact rather than publishing stale results to production.

After fixture testing, remove/clear the temporary fixture password and turn both QA opt-in flags off before subsequent unrelated builds. A new QA run requires another explicitly reviewed commit and fresh fixture settings. The core application never exposes a privileged QA HTTP endpoint.

The stable protected test origin is `https://inkstrip-manhwa-studio-git-codex-cloud-accounts-538f02-ss-ac00.vercel.app`. Production Site URL remains `https://inkstrip-manhwa-studio.vercel.app`. Both preview email callback types have been checked against Supabase's allow-list. Fresh real email requests remain on hold until the deployed app's configured session/health and safe callback behavior are verified. Full email and browser/security gates must pass before merging PR #35.
