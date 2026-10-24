# Dialogue Studio — Release2 integration audit

Verified baseline: main2931fdb0ef688d3fc59ce14d1c2414977fb082f5, after the
homepage release's live desktop/mobile, editor/native/export and genuine Swin2SR
checks. Branch: codex/dialogue-studio. F1 PR#6 remains Draft and unmerged.

## Reuse and gaps

Reuse ProDocument/ProSession, immutable raster assets, ProCanvas pointer/zoom/pan,
ProRenderer worker, selection/repair, vector path/anchor utilities, layers, masks,
transforms, revision checks, history/autosave, Chapter application and export.
Existing four bubble shapes and basic text are extended rather than replaced.

Missing: parametric bubble library/multiple tails, full lettering layout, OCR review
queue/translation, quick Chapter tab/dedicated presentation, and complete editable
Pro-session coverage in project backups. Source-resolution coordinates remain the
single editing space. Cleaning proposals require explicit approval and retained
source pixels. Traditional cleanup is labeled non-generative.

## Dependency-aware sequence

1. Shared validated dialogue metadata, bubble geometry and multilingual lettering.
2. Extend Canvas/SVG output and native guards; retain legacy rendering defaults.
3. Dedicated/quick Dialogue UI using the existing Pro controller and canvas;
   Chapter Text & Bubbles entry and unchanged Raster/Vector access.
4. Genuine local OCR using audited Apache-licensed Tesseract.js and pinned language
   data, editable detection/review queue and human-approved cleanup/placement.
5. Backup/recovery, individual/layered/clean/chapter exports, bounded memory and
   cancellation, then unit/browser/native/export and full editor regression gates.
6. Separate PR; merge/deploy only when the full release passes. No placeholder
   inference, automatic translation, external image upload or paid service.

Current status: shared foundation implemented; editor integration and release validation remain in progress. Dialogue features are not released.

Foundation validation:735 unit tests pass. Genuine local Tesseract7 inference ran on English, Arabic, Korean, Japanese and vertical Japanese fixtures, using pinned SHA-256-verified Apache-licensed tessdata_fast weights. Arabic omitted a word space and requires correction. These synthetic fixtures do not establish complex manga OCR quality. Canvas/SVG lettering comparisons pass unchanged pixel tolerances for all five cases; source-region extraction matches native export byte-for-byte, including effects. No artwork is uploaded for OCR.

Native envelope v7 preserves dialogue metadata; legacy v1–v5 remain readable. Reserved unmerged AI v6 is explicitly rejected. Shared-origin AI sessions prevent an unsafe database upgrade. Full project backups and UI round-trips still require integration validation. Rich Dialogue SVG is an export format; reimport is explicitly rejected rather than silently dropping layout. Native projects preserve complete editability.
Native v6 belongs to the unmerged F1 branch; any new native envelope must avoid
reusing that version or silently discarding unsupported AI provenance.


## Implemented integration checkpoint

- Chapter Text & Bubbles tab, selected-page Quick Edit and full Dialogue presentation use the existing ProWorkspace/ProCanvas controller and native source coordinates.
- Sixteen cubic bubble presets, editable contours, multiple pointed/dotted tails, numeric tail settings, touch and keyboard tip handles. Direct anchor edits preserve actual geometry and intentionally convert parametric outlines to custom paths.
- Independent/attached editable text: native browser shaping, RTL Arabic, English/Korean/Japanese, basic vertical Japanese, wrapping, fitting, size/weight/italic/spacing/outline/shadow and opacity. Existing layer/transform/mask/history tools remain available.
- Native document presets and a shared, transactionally updated project preset library. Sources are retained as immutable raster assets.
- Real local Tesseract7 OCR with pinned, SHA-256-verified tessdata_fast language data; native-region extraction, editable review boundaries, corrected originals and manual replacement/translation fields. No automatic translation or semantic bubble detection is claimed.
- Human-approved solid-background cleanup and replacement lettering. Cancellation and leaving the panel discard previews; stale source revisions are rejected. Regional jobs use an independent instance of the existing renderer to prevent live previews superseding them.
- Native v7 saving/reopening; existing v1–v5 files retain compatibility. Reserved F1 v6/provenance is rejected explicitly. Project backup v2 includes editable sessions and binary assets; an atomic recovery journal stages those sessions with the Chapter import. Revision/token conflicts retain both copies and block overwrite.
- Composite PNG/JPEG/WebP, clean/without-dialogue export, compatible vector-only SVG, layered assets ZIP, and ordered Chapter page/range ZIP with visible dialogue, cleanup-only, source view or editable native pages. Independent layer PNGs exclude backdrop-dependent cases with explicit manifest notes.

Checkpoint validation:742 automated tests pass (200 script,59 shared,49 Studio,434 Pro). TypeScript, ESLint, production build, build configuration and auth invariant pass. Genuine development and built Chromium workflows cover OCR, correction, cancellation/approval, undo/redo, native and image exports, ZIP CRC validation with Python's independent zipfile implementation, Chapter application with byte-exact original recovery, and project restoration in a fresh mobile profile. Desktop/320px/390px Quick/Full switching, tail touch/keyboard edits and native reopening pass. Full legacy regression run remains in progress at this checkpoint; no Dialogue merge or deployment is authorized by a passing build alone.

## Limits and release gates

- OCR fixtures are internally rendered text, not a claim of reliable complex manga recognition. Arabic dropped a word space in the fixture. Confidence is an estimate; all results require human review. Automatic language detection, machine translation and complex generative restoration are unavailable. No artwork is uploaded and no paid provider is used.
- Installed fonts/fallbacks govern rendering. Matching recipient fonts are required for SVG; advanced Japanese font-specific vertical shaping, ruby and tate-chu-yoko are not fully implemented. Native/PNG preserve the tested rendered appearance. Rich Dialogue SVG reimport is explicitly rejected rather than silently losing layout; native retains editability. Existing supported generic SVG import remains available.
- SVG is vector-only and rejects unsupported layer effects, clipping stacks and projective deformation. Raster/native exports preserve supported engine effects.
- Existing engine limits remain:48 layers,48MB embedded assets,16.8MP/16384px desktop documents,4MP coarse-pointer budget and4MP OCR/cleanup regions. No silent resolution reduction. Chapter exports are sequential and limited to250 pages/512MB; archives have a2GB upper bound. Backdrop-dependent isolated PNGs require the native project rather than an inaccurate flattening.
- Backup restore refuses existing page/native IDs rather than overwriting unrelated drafts. Native undo history follows existing session behavior; the complete undo timeline is not serialized into native files.
- Desktop Chromium and touch emulation are tested; physical Android remains outstanding. Optional advanced inference requires a separately secured backend and genuine model validation; none is configured or advertised as operational.
- Full regression, exact-HEAD CI, final inventory/security review and actual production verification must pass before release.


## Release-audit fixes after the implementation checkpoint

- **Legacy F1 reader compatibility:** the Chapter DB upgrade now checks for unreleased same-origin AI drafts first and leaves the older Chapter DB version readable. A seeded v1 Chapter/v2 AI profile remains readable from the homepage, while unsafe Pro migration is rejected. F1 source/PR remains separate.
- **OCR model cache:** verified weights now seed Tesseract's documented namespaced cache path through its existing Apache-licensed idb-keyval dependency (explicitly pinned6.3.0). Real cached inference succeeds with all model-network requests blocked:0 requests. The actual in-engine traineddata SHA-256 is still checked. Corrupt cached language files are removed and rejected, allowing a safe retry. Cache failure falls back to disclosed network retrieval, never an image upload.
- **JPEG compositing:** reproduced a translucent Screen-blended bubble exporting as white (expected RGB99/121/144, actual255/255/255; maximum error156). Moving the white matte after editable compositing yields99/121/144, error0. This is a narrow shared-engine correction; PNG/native geometry is unchanged.
- **Preset fidelity:** saved basic designs retain native dimensions, opacity, fill/stroke alpha, dash styles, effects and typography styling. Native/project copies remain independent. Advanced multi-appearance stacks are rejected explicitly by the preset saver; they remain fully editable in the native document.
- **Unicode/export safety:** valid multilingual/combined/emoji text is escaped losslessly for SVG; invalid XML characters are rejected without modifying the source. ZIP filenames reject traversal, drive paths and hidden direction controls. No untrusted remote inference/proxy endpoint was added.

Current unit total:744 (200 script +59 shared +49 Studio +436 Pro), all passing. TypeScript/lint/build/config/auth checks pass. Final built regression rerun, exact-HEAD CI and release verification remain gates. No Dialogue production deployment has occurred at this checkpoint.


## Final integration checks

Locked bubbles/text now respect own and inherited layer locks in the operations layer and UI. Replacing reviewed lettering edits its existing text layer rather than stacking duplicates. Explicit rasterization removes obsolete parametric controls while retaining dialogue classification. An isolated bubble PNG strips only its omitted text association from the temporary render view; the archived native document retains that association. Actual ZIP/PNG browser checks cover this case.

Chapter and layered ZIP accumulation now share the editor's device limits:4MP raster /128MB archives for touch or low-memory devices,16.8MP /512MB on desktop. Native backups remain available without rendering oversized pages. No final artwork is silently reduced. Final automated count is747; the final production-build regression run and exact-HEAD CI are still required before merge.


Tablet review at768px found the expanded studio switcher covering the title/panel toggle. A tablet-only wrapped header now preserves both controls. Browser checks assert every essential header control remains within the viewport at1440/768/320/390px; touch checks remain separate from physical Android validation.


Approval-state audit: a review can only be approved when the actual editable text layer matches the replacement and language. Changing review text invalidates approval; manual lettering edits synchronize the queue and return it to review. Re-preview updates the existing layer, retaining formatting and avoiding duplicate lettering. Actual browser correction/re-approval/native/Chapter/backup round-trips pass. Automated count:748.
