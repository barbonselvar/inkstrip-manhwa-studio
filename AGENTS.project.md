# Inkstrip project release workflow

The user authorized automatic normal-merge releases for **completed phases**.
This authorization supersedes earlier conversation instructions requiring routine
merge/deployment approval. It does not authorize bypassing safety or validation.

- Continue the existing graphics/document engines; preserve source artwork,
  native backward compatibility, Chapter data, AI and 3D functionality.
- Finish the entire planned phase with working tools, changelog and truthful
  implemented/partial/missing inventory before releasing it.
- Run full unit/integration, type, lint, production build/configuration and browser
  regressions, including native/history/exports, AI/3D, and touch 320px/390px.
  Investigate failures; never silently skip them. Document timing flakes/retries.
- Push tested development commits and create/update the phase PR. Review the exact
  tested HEAD, mergeability, all required GitHub checks and accidental secrets.
- Once every gate passes, merge that exact PR HEAD into main with a **normal merge
  commit**, without routine approval. Never force-push, reset or rewrite main.
- Let the existing Vercel integration deploy main. During webhook delays, inspect
  the intended main SHA and use existing authorized Vercel access only. Missing
  credentials/permissions are blockers to a manual deployment. Never create a
  duplicate project, expose secrets, change secrets/environment variables without
  authorization, or promote an outdated preview.
- Verify the live release/commit/domain, Chapter/Raster/Vector, mobile/touch, AI/3D,
  errors and assets before claiming deployment or beginning the next phase.
- If production verification fails, stop progression and apply a minimal tested
  recovery without deleting production data or deployment history.
- After verified production, branch from freshly verified main for the next phase.
  An incomplete next phase may use a draft PR, but must not merge prematurely.
- Report completed features, tests, PR, merge SHA, production/live verification,
  limitations and next phase. Do not claim Adobe feature parity without evidence.

Current sequence: Phases C, D and E are released. Phase E PR #4 merged normally
as `ced5907f5e0bfc49e72588fe76d3cbf652d39b7f` from tested development HEAD
`17ba1134ec011cc50b4455b60ae410b41e2742aa`. Both main Actions pass and the existing
Vercel Production domain was live-verified at that exact source SHA, including
Raster/Vector/Chapter, native v5, 4K masked export, mobile 320/390px, actual WebGL
and real Swin2SR. Baseline: 677 automated tests / 19 Chromium suites. See
`docs/PHASE_E_RELEASE_VERIFICATION.md` and PR #4 for evidence and limitations.

Current branch: `codex/phase-f-ai-studio`, created from that verified main release.
`docs/PHASE_F_AI_STUDIO_ARCHITECTURE.md` is preparation only. No new AI model,
server, paid API or subscription is enabled. Implement future AI work only through
real qualified inference and non-destructive result layers, reusing the existing
engines and native source pool. Do not duplicate Phase E selection/brush/mask/
high-resolution capabilities or treat traditional filters as generative AI.
Preserve native v1–v5 compatibility, all original artwork and the release policy
above. Model code and weights licenses require separate review; CodeFormer's
upstream license restricts commercial use without permission. Do not provision
billable GPU services or enable paid providers without explicit authorization.
