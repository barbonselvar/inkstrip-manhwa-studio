# Cloud accounts — architecture audit and implementation contract

Baseline: PR #34 production merge `55bc1f1ba183a0bc9f7a14c8ebac9f4adb8cc33d`.
React 19, TypeScript, TanStack Start/Router, Vite/Nitro/Vercel, Zustand and IndexedDB.
The Better Auth/Grok platform scaffolding is inactive; it is retained, not repurposed
as a Supabase identity. No Supabase project, keys or OAuth/email credentials are
configured in the execution environment. No live-provider success can be claimed.

## Decisions made before implementation

- Keep the existing local studio accessible. Add a separate account area and
  same-origin `/api/account/*` backend using official Supabase libraries. Retain
  the platform bridge, inactive broker flow and local chapter schema. The final
  security audit also upgrades Better Auth to its patched release, with the
  minimal official social-sign-in API adapters required by 1.7.
- Supabase server clients hold provider-managed sessions in HttpOnly cookies.
  The browser receives a safe user summary and CSRF token, never access/refresh
  tokens or service-role credentials. Validate the provider user on each protected
  operation, require confirmed email, and fail closed when setup is incomplete.
- Provider-managed signup and recovery OTPs (six digits / ten minutes configured
  in Supabase), PKCE OAuth, distributed application throttles, strict origin/CSRF
  checks, short-lived server action grants for password reset/reauthentication,
  and no password/OTP/token logging. No custom OTP database or password table.
- PostgreSQL profiles/projects/revisions/chunk receipts use auth.users UUIDs,
  ownership constraints, RLS and private Storage. Service-only atomic revision CAS
  and rate/action functions remain inaccessible to browser roles. Never trust a
  browser-supplied owner ID. SQL lives under `supabase/migrations`, not the unrelated
  Neon/PGLite migration runner; applying it is an explicit Supabase setup step.
- Existing `inkstrip` IndexedDB owns projects/chapters/media; `inkstrip-pro` owns
  native Raster/dialogue documents. Existing v3 editable packages include all
  referenced images, masks, native assets, Composition & FX and presets. Reuse
  these packages as immutable cloud revisions instead of creating another editor
  model. Chunk packages into bounded, SHA-256-addressed parts, verify uploads and
  downloads, and compare revisions before publishing. Local data is never removed.
- Account-scoped upload journals contain only transfer metadata. Each account
  must explicitly select local projects and confirm ownership before an upload.
  Resume content-addressed chunks; do not silently overwrite newer revisions.
  Restoring into a device with the same project ID must refuse overwrite and offer
  the package as recovery instead. No implicit background sync or shared-device
  account attachment.
- CSS depth/parallax, original app gallery panels and reduced-motion support make
  the account UI cinematic without adding a graphics engine. Narrow screens keep
  forms primary and animations minimal. OAuth/email/database setup states are real.

Implementation, setup instructions, tests and verified/unverified capabilities are
recorded in the final account report. Feature branch only; no merge or deployment
until authorization, identity and local-data safety have been verified.
