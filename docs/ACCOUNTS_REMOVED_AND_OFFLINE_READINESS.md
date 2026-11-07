# Accounts removed; offline desktop readiness

Cloud accounts (Supabase Auth, Google/Facebook sign-in, email flows, profiles, cloud project sync, `/account`, `/legal/*`) were removed. Inkstrip is again a fully local studio: projects, chapters, panels, Raster/Text/Composition data and backups live in this browser's IndexedDB and need no sign-in or network for core editing.

- **Kept:** Better Auth 1.7.18 (the template's separate sign-in-with-Grok gate, patched for a critical advisory), the local `.inkstrip` backup format and every editor.
- **Hosted resources untouched:** the Supabase project `cjpsxidhklspzcqnpngx`, its tables and the private bucket were not deleted or changed. The removed code is in git history (PRs #35 and #36, merge `e29a29f`/`5875dc4`) if it is ever needed again. The old `SUPABASE_*`, `INKSTRIP_ACCOUNT*` and QA environment variables in Vercel are unused and can be deleted there.
- **Server routes left:** only `/api/studio/ai-edit` (optional cloud AI). Everything else is client-side.

## Before a future offline Windows app
The current Tauri shell (`apps/desktop`) opens the hosted site. For a truly offline `.exe` still to do:
1. Produce a static/SPA build of the studio (the app is a TanStack Start SSR build today) and point `frontendDist` at it instead of the launcher page.
2. Bundle the on-device AI model/runtime assets (they currently load from the site) and keep cloud AI as an opt-in online feature.
3. Drop the production-origin navigation allow-list in `apps/desktop/src-tauri/src/lib.rs` in favour of the local origin, and add a save-to-disk path for backups.
