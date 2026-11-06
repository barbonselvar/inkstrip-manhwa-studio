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

## Hosted verification — 6 November 2026

Preview commit `5aca39710b3591dfe7a014ea97660bf1042cb3aa` completed all 75 real Supabase SDK security checks and isolation-fixture cleanup. All five GitHub workflows passed. The deployed session endpoint reports configured authentication. The server-role Secret was verified as sensitive, Preview-only, and restricted to the exact authentication branch; its value was never exported.

An independently seeded synthetic browser account passed actual deployed password login and session restoration. A 4.7 MB synthetic editable project was imported through the application. Its second upload chunk was deliberately interrupted after the first real chunk succeeded; no revision was committed. Refresh/resume completed revision 1, and a repeated upload retained one revision and three stored chunks. Restoring over an existing native draft was refused safely.

The real downloaded cloud package and a backup exported after restoration in a fresh 390 px browser matched the original project's metadata, chapter composition, panels/dialogue, native Raster document, original artwork and every referenced asset hash. The restored chapter opened Images, Text & Bubbles, Raster and Composition & FX. Composition rendered its wave fade, 300/500 px extensions and cross-panel lettering; 360/390/430 px layouts had no document overflow or reported browser errors. Native import intentionally rebases revision/recovery identifiers; document and asset contents were compared instead.

This pass discovered an inaccurate cloud storage display: the project-list endpoint omitted the published package's byte count. The follow-up reads the existing owner-scoped, security-invoker overview (which joins the head revision), with a regression test for the returned size, ownership filter and unverified-user denial. No schema or stored project mutation is needed.

These are live security and browser/cloud tests, **not** successful real email callback or OAuth tests. The existing authorized Gmail account must complete recovery in the same Android browser that requests the email, preserving its PKCE/nonce binding. A fresh signup confirmation requires an explicitly authorized new eligible recipient; never delete or unconfirm the owner's existing account. Built-in SMTP remains restricted to project-team recipients and two emails/hour, and does not support public production signup. Google/Facebook remain disabled pending credentials. Production has not been enabled or released; PR #35 remains draft until mandatory live email and release gates pass.
