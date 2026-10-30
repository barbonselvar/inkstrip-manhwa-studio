# R11 deferred-feature review

Every item R10 left deferred, partial, prototype or design-only, classified against
measured evidence. Classes: **Required for R11**, **Valuable and safe for R11**,
**Prototype only**, **Design only**, **Defer**, **Unnecessary**. "Implemented"
items have verification evidence in [R11_TEST_REPORT.md](R11_TEST_REPORT.md).

## Summary

| #     | Item (R10 source)                                        | R11 class                  | Decision                                                                       |
| ----- | -------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| A     | Live production SHA + real AI verification (R10 F)       | Required                   | **Closed** on GitHub-hosted runners; new `r11-external.yml` workflow           |
| 14    | Reachability-based immutable asset cleanup (B3)          | Required (defect found)    | **Implemented** as open-time compaction; in-session deletion still deferred    |
| —     | Missing spaces in older limit messages (R10 known issue) | Valuable and safe          | **Implemented** (44 messages)                                                  |
| 11    | Searchable command access (remaining part)               | Valuable and safe          | **Implemented** (command palette)                                              |
| 3     | Full historical matrix in CI                             | Valuable and safe (subset) | **Partial**: external production/AI job added; full matrix stays local         |
| 5     | Halo-tiled filters, styles, tiled document compositor    | Defer (measured)           | Existing tiling quantified; no extension or cap change justified (see D below) |
| 18/C4 | Arabic/RTL text on path, portable fonts                  | Defer                      | Refusal retained; needs HarfBuzz + licensed fonts decision                     |
| 16    | Provider concurrency, rate and cost controls             | Design only                | Needs a durable store and owner policy; not mockable in a stateless function   |
| 17    | Workspace/canvas controller extraction                   | Design only                | L-size refactor with high regression risk; not a release-hardening item        |
| 19    | PSD/OpenRaster interchange                               | Design only                | Outline unchanged from R10                                                     |
| 20    | ICC-aware, 16-bit, wide-gamut pipeline                   | Design only                | New native version and memory model; XL                                        |
| 4     | Reduced-resolution compatible working copies             | Defer                      | Lossless split already covers long pages without quality loss                  |
| 7     | Cross-session Undo timeline                              | Unnecessary for R11        | Checkpoints + native export cover recovery; persisting history raises storage  |

## Details

### A — R10 production and AI verification (Required, closed)

- **Evidence of a problem.** R10's sandbox could not reach the Vercel domain or
  huggingface.co; `test:production:browser --ai` and `test:studio:browser` were
  recorded as blocked. This session's sandbox has the same restriction (proxy
  `connect_rejected` for both hosts).
- **Solution.** `.github/workflows/r11-external.yml` runs the unchanged scripts
  on GitHub-hosted runners, which are an authorized environment of this
  repository. The live job resolves the _current_ main SHA with `git ls-remote`
  (never a stored SHA) and asserts the page's `inkstrip-release` marker equals it.
- **Result.** Run [41045880260](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/41045880260)
  passed against main `aa7e1994…`: release marker matched, 1440/320/390 Chapter,
  Pathfinder, gradients, text on path, SVG, native reopen, Raster, 4096² masked
  export, 0 failed assets, 0 console errors, and **real Swin2SR inference on
  production** (16×24 → 32×48). The built-app Studio suite passed real model
  download, inference, comparison, apply/reload with byte-exact original recovery,
  cancellation, batch enhance/recovery and mobile overflow.
- No mocked AI result is reported as real. Provider-error and malformed
  input/output paths are covered by existing deterministic unit tests; quota/429,
  post-inference memory release and model-download failure have no dedicated test
  (see the test report §A).

### 14 — Immutable asset cleanup (Required: confirmed defect)

- **Current behavior.** `session.assets` holds every Blob ever added (imports,
  merges, flattens, transforms, repairs, AI apply, native imports, Clone Stamp
  samples). History snapshots are trimmed to 32MB, but their assets are never
  released, and the pool is stored as-is on every save, across reloads.
- **Evidence.** `validateAssets` caps a page at **64 assets / 48MB** and every
  asset-adding operation calls it. Reproduced in unit tests and in the real UI:
  63 Clone Stamp samples fill the pool, the 64th is refused with "A Pro document
  supports at most 64 raster assets.", and on R10 the refusal **persists after
  reload** because nothing ever compacts. 63 native imports reproduce the same.
  On long pages the 48MB budget is reached after far fewer full-page samples.
- **User impact.** A long-edited page permanently stops accepting merges,
  flattens, imports, clone samples, AI results etc. Only exporting a native file
  and importing it into a fresh page recovered.
- **Solution (conservative).** `compactOpenedSession` runs only when a stored
  draft is opened. At that point the stored document is provably the only live
  root: Undo/Redo is not persisted, no transaction, worker job or clone source
  exists for the new session, and recovery checkpoints own independent native
  copies. It keeps exactly `documentAssetIds` — the traversal native export
  already uses, so the retained set is the one every native round trip proves
  sufficient. Removal is in memory; the stored record changes only through the
  next ordinary optimistic `saveSession` (atomic, revision-checked), so an
  interrupted cleanup leaves the previous complete record. As hardening, a
  sampled clone source whose asset is not in the installed pool is cleared.
- **Not done (still deferred).** Deleting assets _during_ a session (superseded
  clone samples, assets of evicted history entries). That needs explicit leases
  for UI clone sources, in-flight preview/export workers and staged pixel
  transactions, which R10 already identified.
- **Acceptance.** Byte-identical native files before/after compaction, the same
  Blob objects retained, missing references still fail closed, no change to the
  stored record on open, pixel-identical reopen, referenced clone sources retained.

### Message spacing (Valuable and safe)

R10 fixed three messages and left the rest ("up to4MP", "exceeds128M kernel
taps", "Dialogue7 … version8"). 44 literals in 21 files were corrected by a
whitelist rule (space only after an English word such as "to", "at most",
"schema", inside sentence strings), so identifiers like `Swin2SR`, `R8` and
`sha256` are untouched. Four unit-test regexes and one browser-script string that
matched the old text were updated to the corrected text; no assertion was removed.

### 11 — Command palette (Valuable and safe)

Implemented from the R10 design: `Ctrl/⌘+K` or a visible **Commands** button
in the context bar (touch users have no keyboard). It lists only what the tool
rail, inspector tabs and top bar already expose in the current mode, uses the
same handlers and the same disabled rules (extracted, not duplicated), keeps
disabled entries visible as "Unavailable now", and never edits artwork or adds
history. The inspector tab filter moved into `inspectorPanels()` so the palette
and the tab bar cannot disagree. No new actions, no data impact.

### 5 / D — Tiled processing and long pages (Defer, with measurements)

- **Architecture.** The compositor (`render.ts` `composite`/`surface`) is an
  OffscreenCanvas full-plane pipeline: each layer surface, projected layer and
  the output are full-size canvases. R10 tiled only the temporary neighbourhood
  planes of local Smart Filters.
- **New measurement** (`bench:r11:filter-memory`, one child process per case,
  peak RSS above the already-allocated input, outputs compared by SHA-256): at
  1080×3700 (the 4MP Smart Filter cap) Gaussian whole-plane peaks at ~94 MiB versus
  ~30 MiB tiled (≈3×), byte-identical. Median shows no memory benefit (45 vs 42 MiB
  at 4MP, 22 vs 33 MiB at 2MP): its whole-plane path allocates only the output.
  See [R11_PERFORMANCE_REPORT.md](R11_PERFORMANCE_REPORT.md).
- **Decision.** The existing tiling is justified for the Gaussian family and is
  kept. Extending tiling to Motion/Emboss/Median would not reduce memory, and
  Emboss/Radial depend on global coordinates. Raising the 4MP Smart Filter or
  16.8MP/4MP document budgets is **not** justified: the dominant costs are the
  compositor's full-size canvases, which a tiled compositor would have to replace —
  a new graphics engine, out of scope. Long pages beyond the device budget
  continue to use the R10 lossless split.
- **Remaining work (design).** A tiled compositor would render each output band
  through the layer stack with per-layer halo (effects padding, filter halos,
  deform bounds), cache bands by layer revision, and stream bands to the PNG
  encoder. Blend modes and clipping are per-pixel and band-safe; layer styles and
  nonlocal filters need whole-layer inputs or exact halos. Acceptance would need
  zero-tolerance equality with the current renderer over the existing fixtures.

### 18 / C4 — Arabic/RTL text on path (Defer)

The R10 prototype shows browser SVG `textPath` shapes Arabic correctly, but mixed
bidi path advances differ from ordinary runs (0.14 px), `createImageBitmap(SVG)`
fails in the worker, and fonts are system-dependent. Production support needs a
pinned HarfBuzz WASM shaper, UAX #9 bidi, licensed embeddable fonts, a versioned
text-path record and glyph-outline export. None of these can be validated or
licensed inside R11; the safe refusal is kept and existing Arabic support in
Dialogue Studio and ordinary text is unchanged.

### 16 — Provider rate and cost controls (Design only)

On-device Swin2SR already bounds batches (12 images, 8MP). The cloud edit
endpoint is owner-code protected but has no durable per-principal accounting.
An in-memory limiter would be wrong on stateless functions (each instance has its
own counter). Needs an owner decision on store (e.g. Upstash/Vercel KV) and limits;
the R10 design stands. R11 does not touch AI code.

### 17, 19, 20 — Controller extraction, PSD/OpenRaster, ICC/16-bit (Design only)

Unchanged from R10_ROADMAP.md. Each is L/XL, changes architecture or the native
format, and is outside a validation-and-hardening release.
