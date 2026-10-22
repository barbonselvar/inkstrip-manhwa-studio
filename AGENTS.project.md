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

Current sequence: Phase C and Phase D are released. Phase D PR #3 merged normally
as `a35e73ef90e71f79f711ce7830e8e8625e372aaa` and was verified on the existing
Vercel Production domain. The baseline is 642 automated tests and 18 Chromium
suites, including real AI and desktop/320px/390px workflows. See the final Phase D
audit and `docs/PHASE_E_RASTER_REFINEMENT.md` before implementing anything.

Next: audit and complete remaining professional Raster capabilities, starting
with missing selection refinement, brush dynamics and mask/source-frame fidelity.
Reuse the existing selection/repair/transform/color/effect/vector engines and
native v4 persistence; do not duplicate completed tools. Future AI Studio is a
separate later phase. Keep incomplete phase work on its development branch/draft
PR and apply the release workflow above only when the entire phase is complete.
