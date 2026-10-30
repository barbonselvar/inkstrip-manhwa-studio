# R11 implementation report

Branch `codex/r11-final-validation-performance`, Draft PR
[#24](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/24), based on main
`aa7e1994bba2c447e3faed25d23b62c6cadef7c7` (R10 merge). Reports beside this file:
[baseline](R11_BASELINE_REPORT.md), [deferred-feature review](R11_DEFERRED_FEATURE_REVIEW.md),
[architecture](R11_ARCHITECTURE.md), [tests](R11_TEST_REPORT.md),
[performance](R11_PERFORMANCE_REPORT.md), [release notes](R11_RELEASE_NOTES.md).

## Phase status

| Phase                                  | Status                                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A — R10 production and AI verification | **Closed** on GitHub-hosted runners (live marker = main, live real AI, built-app real AI suite)                                                 |
| B — Baseline audit                     | Done: static gates, architecture review, isolated filter memory, long pages n = 5 on unchanged main, asset-growth reproduction                  |
| C — Deferred features                  | Every R10 item classified with evidence ([review](R11_DEFERRED_FEATURE_REVIEW.md))                                                              |
| D — Large images / tiling              | Investigated and measured; R10 tiling kept (≈3× lower Gaussian peak at 4MP); no extension or cap change justified; tiled compositor design only |
| E — Asset cleanup                      | **Implemented** as provably safe open-time compaction; in-session deletion still deferred                                                       |
| F — Arabic/RTL text on path            | Deferred; refusal retained (needs HarfBuzz, licensed fonts, versioned record)                                                                   |
| G — Performance                        | Measured; no optimisation met the "measured bottleneck + safe" bar; no speed claim                                                              |
| H — Mobile/UX                          | Command palette (touch entry point), 44 message fixes; five-width emulation                                                                     |
| I — Roadmap items                      | #11 implemented; #16/#17/#19/#20 design only; #18 deferred                                                                                      |
| J — Validation                         | See [test report](R11_TEST_REPORT.md)                                                                                                           |
| K — Documentation                      | This set                                                                                                                                        |
| L — PR                                 | Draft PR #24                                                                                                                                    |

## Changes

| Commit area                | Files                                                                                                                                                                             | Purpose                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| External verification CI   | `.github/workflows/r11-external.yml`                                                                                                                                              | Live production check vs current main SHA and real-AI Studio suite on GitHub runners        |
| Open-time asset compaction | `asset-references.ts` (`compactOpenedSession`), `pro-workspace.tsx` (open path, `install`)                                                                                        | Release unreferenced Blobs that otherwise permanently exhaust the 64-asset / 48MB page pool |
| Message spacing            | 21 source files; 4 unit-test regexes and 1 browser-script string updated to the new text                                                                                          | "up to4MP" → "up to 4MP" etc. (44 literals)                                                 |
| Command palette            | `commands.ts`, `pro-command-palette.tsx`, `pro-workspace.tsx`, `modal.tsx`, `pro-studio.css`                                                                                      | Searchable access to existing tools/panels/actions; shared rules with the rail and tab bar  |
| Tests and benchmarks       | `asset-compaction.test.ts`, `commands.test.ts`, `r11-browser-check.mjs`, `r11-native-compat.mjs`, `r11-filter-memory-benchmark.mjs`, `qa-offline-branding.mjs`, `r10-browser.yml` | Evidence for every change; cross-release compatibility; CI coverage                         |

No native schema, storage version, image limit, renderer, brush, filter, AI or
authentication code changed. No dependency was added.

## Defects found and fixed during R11

1. **Unbounded asset pool (pre-existing since the pool cap existed).** Reproduced
   in the UI on R10 main: after 63 Clone Stamp samples the next sample is refused
   and, after reload, still refused. Fixed by open-time compaction; the same
   browser test passes on R11 and fails on main at exactly that step.
2. **Palette hidden behind the Studio (found by R11's own QA, never shipped).**
   The shared `Modal` uses z-index 40/50; Pro Studio sits at 110. A screenshot
   showed the open palette invisible although keyboard checks passed. Fixed with
   a layer class at the Pro confirm-dialog level (130/131) and an occlusion
   assertion (`elementFromPoint`) in the browser test.
3. **Palette focus.** Radix focused the Close button first; `Modal` gained an
   optional `onOpenAutoFocus` so the palette starts in its search field.

## Test-tooling corrections (no application change)

- Browser test pixel comparisons hash the preview (a failing `deepEqual` on large
  arrays exhausted 13.6GB in the Node process) and wait for asynchronous renders
  to settle; an early mismatch was a mid-render sample, not a pixel change.
- Choosing Eraser from the existing rail records "Add paint" in Raster; the palette
  test now asserts history equals the rail's instead of assuming none.
- Long-page baselines use main's own copy of the script against main's build (the
  R11 copy expects corrected message text).
- The offline-branding preload first wrapped only `chromium.launch`; suites using
  `launchServer` + `connect` still failed on the refused `grok.com` request. It now
  wraps every launch path (`3dd952a`).
- CI on `3dd952a` failed the palette occlusion check once: Radix toggles
  `pointer-events` on nested dialog layers during open, and hit-testing honours it.
  The check now polls for up to 5 s (`7d39231`); a palette behind the Studio still
  fails it.

## Known limitations

- In-session asset deletion (superseded clone samples, assets of evicted history
  snapshots) is still deferred: UI clone sources, staged pixel transactions and
  in-flight workers have no leases. Reopening the page releases them.
- No tiled document compositor; pages above the device budget use lossless split.
- Arabic/RTL text on path refused; Arabic elsewhere unchanged.
- All UI testing is Chromium emulation (1440/768/390/360/320); no physical device.
- Real-AI and live-production checks run on GitHub-hosted runners, not in the
  development sandbox, whose egress policy denies vercel.app, huggingface.co and
  grok.com.
