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

Current sequence: finish Phase C gradient/effect/independent adjustment layers,
then Phase D vector geometry/Boolean/compound paths/artboards/snapping/appearance/
text-on-path/SVG. Extend existing cubic Pen/direct-anchor tools; do not recreate them.
