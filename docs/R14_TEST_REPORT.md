# R14 validation report

Final application source: `30ac825a891754fb1ec5e094131f0f8e91b69d4c`.
Initial broad regression source: `981f4065445db525eb7d6579ec7a9547f4f04b71`.
[Draft PR #28](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/28).
No merge, production deployment or paid inference was performed.

## Completed evidence

- `npm ci`: 472 packages, no added dependency/lockfile change.
- Full unit suite passed, including security/provider validation. The initial run
  invoked the four prototype tests twice; their redundant command was removed
  because the existing recursive script glob already discovers them.
  **1121 unique tests passed**, 0 failed (204 script, 59 app/auth, 151 Studio, 707 Pro).
- Typecheck, lint, production build, build configuration, auth configuration and
  the R6/R7/R8/PR21/R9/R10 native cross-version compatibility script passed.
- Real Swin2SR legacy 1×/2× pixels equal unchanged main exactly, including soft alpha.
  Real 1×/2×/4× dimensions, source bytes, alpha, cache-corruption recovery, cancellation
  and scale budgets pass. No intercepted inference output is used.
- Real Fast Anime UI/Apply/exact original recovery/Raster opening passed at
  1440/768/390/360/320, including native-pixel comparison geometry and stale-setting
  Apply prevention. Character reference labels/IDs/Blobs/primary choice/reload pass
  at the same five widths. These are emulations, not physical Android tests.
- Whole-model versus native/resampled Fast Anime halo pixels match with zero tolerance.
- Retouch unselected pixels: 1,485 changed before native mask ownership fix; 0 after.
  Non-square brush/reference bounds have a separate fail-before/pass-after test.
- Nine-artwork real inference, actual 720×960→2880×3840 processing, active cancellation,
  LaMa real research inference and French OCR prototype are recorded in the model report.

## Final regression run

The initial broad source was frozen for its run. Its orchestration includes static/unit/build/config,
native compatibility, 21 browser/worker/smoke commands covering new AI/reference UI,
original Studio AI, editor, Chapter safety, R11, R6 layers, R8 recovery, R9 integration,
R10 masks/patterns, real OCR/render/workflow, R13 lifecycle, production-equivalent
local Raster/AI, unchanged-main inference parity and desktop/mobile smoke.
The original run finished 28/29 commands passing; the source-only retouch harness
navigated before processing and remains recorded as failed. Its corrected stable-origin
rerun passed, giving passing latest outcomes for all 29 planned commands, including
all 21 browser/worker/smoke checks. The unique 1121-test final run and additional real tile
parity/French/LaMa/large-panel tests passed separately. Assertions were retained.

## Failures and test setup corrections

1. Comparison server: npm's default port overrode the external QA config. Explicit
   port selection fixed initialization; unchanged main remains read-only.
2. A newly added safety fixture tried PNG encoding before obtaining a 2D context.
   The fixture now creates that context; assertions remain unchanged.
3. The new output-size selector needed an explicit accessible name. The UI now has
   that label; strict five-width interactions pass.
4. One broader benchmark could not fetch weights. Its failure log is retained; the
   successful rerun uses the project's supported browser proxy configuration.
5. A development benchmark was interrupted by navigation while files were changing.
   Pure pixel/model checks now start on a stable same-origin JSON document and
   import the same actual workers, avoiding unrelated app bootstrap/HMR. UI tests
   still exercise the full app. No delay, tolerance change or skipped assertion.
6. One final retouch worker-only check hit the same context-loss initialization.
   The stable-origin rerun passes all native pixels unchanged. The initial result
   remains in the raw matrix; it is not silently rewritten.

Controlled provider transports test security only; they are not AI-quality evidence.
No external model restriction blocked the successful real-inference runs. There is
no automatic translation, free identity conditioning, validated reference-guided
background engine or production LaMa claim. Those limitations are explicit.

## Repository / CI / Preview boundary

Main remains `2ff54b2fd6297e63b225a11187c7cc5a1995669f`.
After the broad run, final compatibility review retained the original device-specific
import byte/frame/memory tiers (`52fde20`), and normalized equivalent preview
settings so reverting to the default recipe restores Apply (`30ac825`). Neither
change alters model weights, kernels, serialized documents or original artwork.

The final frozen candidate passed all **13** focused commands: 1121 unique tests,
typecheck, lint, production build, preview startup, build/auth checks, five-width
real AI UI, original built Studio AI, unchanged-main exact inference parity,
production-equivalent local Raster/AI and paired desktop/mobile dev/built smoke.
The final src tree is `0089445feb3515e38750007c9121b151b1b6c0b3`; subsequent
publication commits contain test formatting/docs/evidence only. The final PR HEAD
and immutable GitHub check links are recorded in the PR/final delivery. Current
checks are visible at [PR #28 checks](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/28/checks).

Native document/Pro renderer/format modules are unchanged from main. Cross-version
reader tests and real R6/R8/R9/R10 save/history/export browser checks passed during
the broad run. Screenshots of both final smoke viewports were inspected.

The Vercel integration reports Preview Ready. The preview URL redirects this
unauthenticated environment to a Vercel login page, so its functional UI could not
be tested here. This is an access limitation, not a passing functional Preview test.
Production and branch protections were unchanged. PR #28 remains Draft.
