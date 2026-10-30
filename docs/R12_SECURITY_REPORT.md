# R12 security maintenance report

Baseline: main `437e0b726d986266d9249253ff4f119f23ba6aa3` (R11). Scope: the
`npm audit` findings only. No feature, UI, engine, schema or auth-configuration
change.

## Audit

| Package (installed)             | Advisory                                                                   | Severity | Before | After               |
| ------------------------------- | -------------------------------------------------------------------------- | -------- | ------ | ------------------- |
| `seroval` 1.6.9 (via TanStack)  | GHSA-f86p-h4j2-7qgj — code injection via a typed array's own `constructor` | moderate | open   | **fixed**           |
| `seroval` 1.6.9 (via TanStack)  | GHSA-9wx9-5pv9-3349 — script injection via RegExp source                   | moderate | open   | **fixed**           |
| `better-auth` 1.6.33            | GHSA-965c-763c-88jm — OAuth state usable as a Magic Link                   | critical | open   | open, not reachable |
| `better-auth` 1.6.33            | GHSA-r4xp-prcw-77qf — OAuth Proxy sign-in as another user                  | high     | open   | open, not reachable |
| `better-auth` 1.6.33            | GHSA-q84f-53jg-9ppm — device login approval lacks client details           | high     | open   | open, not reachable |
| `@better-auth/*-adapter` 1.6.33 | GHSA-44jh-23m7-hpcf — DB rate limits exceeded on PostgreSQL                | low      | open   | open, not reachable |

`npm audit`: 4 findings (1 critical, 1 moderate, 2 low) → 3 findings (1 critical,
2 low), all better-auth.

## Fixed: seroval 1.6.9 → 1.6.12

- Reachability: seroval is in the production SSR bundle (TanStack Router/Start
  serialise loader and server-function data into the page). Exploitation needs the
  app to serialise an attacker-shaped typed array or an attacker-supplied RegExp;
  unlikely here, but the code sits on every SSR response.
- Fix: patch release on the same minor (fixes landed in 1.6.10 and 1.6.11). Every
  consumer declares `seroval ^1.6.7`, so only `package-lock.json` changes
  (`seroval`, `seroval-plugins`: version, resolved, integrity). No direct
  dependency, override or `package.json` change; 1.7.x was not taken.

## Not fixed: better-auth (documented, not reachable)

- **No compatible fix.** Every fix is in 1.7.x (critical/high: < 1.7.7; no 1.6.x
  patch). Trying 1.7.14 passed `npm audit` but failed typecheck: 1.7 removed
  `genericOAuthClient` and the `signInWithOAuth2` endpoint (generic providers move
  to `signIn.social`). Adopting it means rewriting the pre-wired sign-in client and
  popup handler, which this release must not change and which cannot be tested
  end to end here (it needs the identity broker). The attempt was reverted.
- **Not reachable in production.** The production build (`.vercel/output`) contains
  no better-auth code: no route mounts `auth.handler` (`src/routes/api` has only
  `studio`), sign-in is off (`VITE_AUTH_ENABLED=false`, `check:auth` passes), and the
  only caller (`/auth/popup`) is a Vite **dev-server** plugin.
- **Preconditions absent even where the code runs (dev preview).** Per the
  advisories: GHSA-965c needs the Magic Link plugin; GHSA-r4xp needs the OAuth Proxy
  plugin; GHSA-q84f needs the `deviceAuthorization()` plugin; GHSA-44jh needs
  database-backed rate limiting. The config uses only `genericOAuth`, `bearer`,
  `tanstackStartCookies` and the gate-session plugin, with default (in-memory) rate
  limiting; none of the required plugins or settings appear anywhere in `src`.
- **Recommended action.** Upgrade to better-auth ≥ 1.7.7 (1.7.14 current) together
  with the platform's auth template migration to `signIn.social`, before sign-in is
  ever enabled for this app; verify with a real broker sign-in.

## Verification

- Typecheck, ESLint, `npm test` (1,087: 200 + 59 + 121 + 707, incl. auth unit
  tests), production build, `check:build`, `check:auth` ("dev and build agree:
  sign-in off").
- `test:r11:native-compat`: R6, R7, R8, PR #21, R9 and R10 documents unchanged.
- Browser (sandbox, grok.com stubbed by `qa-offline-branding.mjs`): production
  check with Raster on the local build, `test:r11:browser`, homepage, R10 mobile,
  audit, recovery, Chapter import and workflow — all pass.
- GitHub Actions (incl. real AI and live production) and Vercel Preview: see PR.
