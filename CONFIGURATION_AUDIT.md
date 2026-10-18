# Configuration audit

Audited `main` at `edf608c177bc29872da8e25f0f1624852347691f` on 2026-10-18.

## Verified problems and fixes

- **Nitro / tslib:** installed Nitro `3.0.260610-beta` does not accept
  `externals.inline`. The baseline build succeeded but emitted bare `tslib`
  imports in its server bundle. Use Nitro v3's `noExternals: ["tslib"]` to
  preserve the intended fix. Keep the direct `tslib` dependency and `nf3`
  override. `check:build` rejects bare tslib imports in generated server files.
- **TypeScript:** the previous check omitted `vite.config.ts`, hiding the invalid
  Nitro option and unused `@ts-expect-error` directives. Add a separate config
  check, retaining strict application checking and the existing checked JS
  migration helper. The config project imports the legacy JS plugins without
  expanding this audit into a rewrite of those plugins.
- **Node:** dependencies require Node >=22.12; no project engine was declared.
  Declare supported Node 22 and 24 lines, select Node 24 in `.nvmrc`, and use it
  in CI. No dependency versions were changed; the lockfile only gains engines.
- **Generated files:** `.vercel/output`, `.node_modules.lock`, and a preview log
  were already tracked despite ignore rules. Stop tracking them, leaving local
  output intact. Ignore Nitro scratch output and the installation lock marker.
  Vercel regenerates its output during the existing build.
- **Test fixtures:** PWA template assertions read Inkstrip's real title/card from
  the working directory, causing 8 existing tests to fail. Give generic
  injection assertions an empty temporary root; explicit fixture roots still
  take precedence. No runtime PWA behavior or branding changed.
- **Lint:** document the intentional JWT-decode fallback in an empty catch block;
  this resolves `no-empty` without changing execution.
- **Startup:** resolve the project directory from the script location instead
  of assuming every checkout lives directly at `/workspace`.
- **GitHub Actions:** add read-only CI for pushes/PRs targeting main and manual
  runs: clean locked install, app/config TypeScript, lint, existing tests,
  production build, and Vercel output validation. No deployment job or secrets.

## Preserved settings

Keep `vercel.json`'s working install command, Nitro's Vercel preset, build/preview
plugin gating, server middleware directory, PWA plugin, auth environment wrapper,
port contracts, and build-time migration behavior. The current dependency tree
installs cleanly; no speculative upgrades, removals, or override changes were
needed. Website design, features, and business logic are unchanged. No secret
or environment-variable values were edited.

## Validation

- Node 24.19.0 / npm 11.9.0: `npm ci --no-audit --no-fund` passes.
- `npm run typecheck`: application and Vite config pass.
- `npm run lint`: passes with one pre-existing React Fast Refresh warning in
  `src/components/ui/button.tsx`.
- `npm test`: 197 script tests and 59 TypeScript tests pass (256 total).
- `npm run build`: passes and generates Vercel Build Output API v3. No database
  connection was made: the migrator skipped because no database URL was set.
- `npm run check:build`: verifies the server entry, Node runtime, browser JS/CSS,
  PWA icon, and absence of bare tslib imports.
- Build warnings from upstream `use client` directives remain; no warnings were
  suppressed. Only Node 24 was executed locally; Node 22 is not locally verified.

- Desktop (1280×800) and mobile (390×844) browser smoke checks pass for
  development and production preview: visible content, no console/page errors,
  no horizontal overflow, and no content divergence. Both screenshots were
  visually reviewed. The smoke helper emits a branding note because its default
  filesystem root is `/workspace`, while this checkout is nested; the real
  `public/og.jpg` exists and remains unchanged.
- `git diff --check` and shell syntax validation for `startup.sh` pass.

## Publication

Changes are prepared on the existing local `main` branch. No new branch or PR,
remote push, merge, deployment, or Vercel project-setting changes were performed.
Pushing main may trigger Vercel Git integration, so publishing requires the
owner's confirmation. GitHub-hosted CI itself has not run until publication.
