# R8 implementation report

R8.1–R8.5 are implemented and validated within the explicit limits below. **GO for review; keep Draft.** No confirmed release-blocking defect remains against the tested current main. No merge or production deployment was performed by this task. PR21 requires the separate integration work below.

## Recovery and exact revisions

- Recovered branch: `codex/r8-layer-effects-smart-filters-gradients`, clean at `244a1d6fbdf355aefa266501ad7cf4734a6f1b11`. Existing milestones, commits and source assets were preserved; nothing was restarted or recreated.
- Final R8 application commit: `130410b97f65827861a84c520a93a31d2212f202`. QA startup fix: `a2c4cd7d53ecac5092b9a5fae41bb486e065a0c3`.
- Tested branch/report anchor: `2b3c30a8f3f24b67106047648edc97f2c323fb38`. Final documentation-only publishing SHA is recorded on [Draft PR19](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/19).
- Current main: `bfcbdf99248e75bfe10d8d1df6d71bb5acd6a596`, including PR20 merged externally during validation. Original R7 base was `02eb697450a7eeeadbd53d73cea5931905c5b2f2`; earlier R6 merge was `6478fc106d97fbad478c618ab88a4afc8624ce20`.
- Full final local/CI test-merge candidate: `1f43b387dc96466e5c68b60f4dc779e496e74adf`. Its parents were verified independently. This is GitHub's isolated test commit, not an R8 merge into main or a development-branch merge. Final publication must preserve its combined application-tree IDs in [validation.json](r8-evidence/validation.json).

No homepage/navigation/Vector entry-point code, unrelated branch or production configuration was changed by R8. Existing repository pushes may automatically create Vercel PR previews; no production promotion/deployment was invoked.

## Reuse and completed milestones

R8 extends the existing seven alpha-derived styles, two gradient types, R6 CPU filters, R2 immutable layers/history, R3 strokes, R5 transforms and R7 coverage/Quick Mask. It preserves the graphics engine, source assets and legacy algorithms rather than replacing them.

| Milestone | Implemented and verified                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R8.1      | Typed style/filter/gradient records; renderer integration; native migration/writer fence; foundational security and resource tests.                                      |
| R8.2      | Nine alpha-derived styles; live preview; enable/disable, supported ordering, shared light; Apply/Cancel/Reset; copy/paste/remove; reusable presets.                      |
| R8.3      | Ten real Smart Filter families; persistent enable/edit/reorder/remove; captured-selection masks with enable/inversion/density; bounded worker preview.                   |
| R8.4      | Five mathematical gradients; 2–128 stops, opacity/midpoint, RGB/OKLab, smoothness/reverse; touch stop editing; Raster endpoint tool; editable fill layers.               |
| R8.5      | Full current-main regression, recovery/export/old-reader verification, queue/memory/security guards, performance measurements, mobile and parallel integration analysis. |

## Layer effects

Drop Shadow uses actual alpha blur/morphology with color, opacity, angle, distance, spread, blend and optional document light. Inner Shadow adds choke and clips to fill coverage. Outer/Inner Glow support alpha-aware spread/size, color/gradient and edge/center sources. Stroke supports inside/center/outside, solid/gradient, width/opacity/blend. Color/Gradient Overlays preserve coverage; advanced overlays share the gradient engine. Pattern Overlay repeats portable checker/stripe/dot recipes with scale/offset/colors. Bevel/Emboss derives normals from softened alpha and applies depth/direction/lighting/elevation/highlight/shadow controls. No CSS effect substitutes for document pixels.

The existing exterior-behind/interior-on-fill planes define supported effect order. The properties panel uses actual composite previews, one committed Apply, lossless Cancel, before/after, Reset, copy/paste/remove and validated factory/custom presets. Source painting updates effects automatically.

## Smart Filters and alpha

Gaussian/Motion reuse R6 kernels with an explicit premultiplied RGBA coverage-blur mode; original destructive R6 defaults remain unchanged. Radial Blur supports spin/zoom/center and bilinear premultiplied sampling. Unsharp/High Pass reuse R6 algorithms. Seeded Noise supports uniform/Gaussian and monochrome modes. Median, bilateral Surface Blur, directional Emboss and Sobel/Laplacian process real pixels. Clamp borders and bounded sample budgets apply. Other kernels preserve coverage. Filters operate within their source frame; they do not expand it.

Stacks retain stable filter IDs, order, settings and source-local captured selection masks. Masks mix each stage in premultiplied alpha, with density/inversion/enable controls. R6 destructive color processing reads pre-stack source and retains the stack once. Filtered painting invalidates the whole preview, including blur halos beyond brush bounds.

## Compositing and history contract

Original editable artwork/gradient/strokes → existing tone/color → ordered Smart Filters/stage masks → layer mask → projection → styles from masked alpha → existing clipping → opacity/blend → existing isolated hierarchy/R6 backdrop semantics. Groups, backdrop adjustments and extended unbounded appearance/path-text planes are not Smart Filter targets. Quick Mask never receives R8 properties.

Draft metadata and previews do not enter autosave/history. Creation Cancel adds no layer/history; Apply commits one existing transaction. Undo/Redo restores exact metadata/pixels. Document identity checks prevent stale commits. One active/one latest waiting render bounds rapid edits, rejects stale work and closes stale bitmaps. Canvas gradient pointers commit on release; Escape/touch cancellation restores original settings. Existing R3/R5 transaction engines remain.

Whole-layer transforms and ordinary masks/source painting work. Enabled filters must be disabled before selected-pixel lifting or destructive mask baking. Boolean/compound geometry requires explicitly removing retained filter stacks, including disabled ones, before changing source planes; it never silently discards them.

## Gradients and color model

Linear, radial, angular, reflected and diamond use mathematical interpolation. Up to 128 ordered color/opacity stops support segment midpoints, RGB or Ottosson OKLab interpolation, smoothness and reverse. Midpoints use power remapping with the midpoint at 50% mix; smoothness mixes with smoothstep. Interpolation is premultiplied encoded RGB or OKLab, reusing R7 conversion. Inverse OKLab clips gamut before deterministic 8-bit quantization. No ICC/wide-gamut/16-bit claim is made.

Canvas endpoints use source-local coordinates through existing R5/view transforms. New fill layers capture R7 selections as normal layer masks. Presets are validated global preferences (20 custom presets/1MB), not hidden native assets. UI/touch workflows pass at 1440/768/390/360/320px.

## Persistence, migrations and export

Actual versions: document **schema3**, portable **envelope9**, Pro IndexedDB **5**. Schema1/2 and envelopes1–5/7/8 remain readable. AI envelope6 remains reserved/unsupported. First R8 Apply performs metadata-only opt-in, preserving every original layer/ID/order/asset/mask and R6/R7 record. Undo can restore the prior version. R6 creation does not downgrade schema3.

Serialization sorts object keys and retains array order. Strict validation rejects unknown/mismatched versions, types, unsafe keys, invalid numbers/stops/masks/references and excessive work before embedded image decoding. The actual pre-R8 main reader rejects9/3; an old IDB4 writer fails with VersionError after5. Unsupported records are never silently dropped.

Native round trips, autosave reload, blocked-write close and fresh-context Chapter backup recovery preserve the latest editable settings and original asset bytes. PNG preview/native/recovery comparisons use tolerance0. JPEG/WebP decoded output compares exactly before/after recovery per format; lossy output is not equated with PNG. SVG rejects unsupported content explicitly. See [native schema](R8_NATIVE_SCHEMA.md).

## Confirmed fixes

- **OCR test initialization:** The unchanged OCR test failed identically on original main because its nested worker introduced Tesseract/idb-keyval during inference. Vite's dependency reload destroyed the pending execution context. A facade import is insufficient, and import-only warming can race the scheduled reload. The test-only startup config eagerly pre-bundles both packages. Empty-cache original-test and final-candidate runs pass all five language fixtures, verified cache/corruption and cancellation with zero optimizer reloads. Production OCR and assertions are unchanged. [Reproduction/commands](R8_BROWSER_QA.md).
- **Legacy controls:** R8's launcher initially replaced direct Raster appearance controls. Schema1/2 now retain those controls; schema3 uses the transactional editor. The unchanged Appearance suite and focused legacy-to-R8 UI assertions pass, without duplicate controls or Quick Mask access.
- **Smart Filter data loss:** Boolean/compound operations could remove a filtered operand and return zero filter records. New eligibility guards reject retained stacks before geometry work. Two tests fail before/fix after, and 38 focused geometry tests plus existing browser suites pass; original metadata remains exact.
- **Blur fidelity:** Shared explicit premultiplied coverage blur and full dirty-preview invalidation fix actual Smart Filter halos without changing R6 defaults or relaxing exact pixel assertions.

Initial fixture/typing/server-setup experiments were diagnosed, retained and not counted as passes. No original assertion, tolerance or required suite was weakened/skipped.

## Measured performance and retained limits

| Native frame | Synthetic worker workload          | First PNG | Reopened PNG | Sampled Node/browser peak RSS |
| ------------ | ---------------------------------- | --------- | ------------ | ----------------------------- |
| 512×512      | Gaussian/noise, mask, bevel/shadow | 384.4ms   | 337.3ms      | 781.6MiB                      |
| 1024×1024    | Gaussian/noise, mask, bevel/shadow | 1064.3ms  | 1241.7ms     | 789.5MiB                      |
| 2000×2000    | Gaussian/noise, mask, bevel        | 3328.4ms  | 3449.8ms     | 876.6MiB                      |
| 4096×4096    | 128-stop gradient only             | 2616.2ms  | 2878.6ms     | 922.2MiB                      |

Every benchmark retains exact RGBA/source hashes. All 12-request bursts send two physical jobs, fulfill one latest result and reject 11 stale requests. RSS samples include Node/browser descendants every250ms on this shared executor; they are not a per-device guarantee or upper bound.

Spatial filters/native advanced style planes remain at4MP, 128M filter samples per layer/visible document and128M visible style-pixel work;12 filters/9 unique styles/128 stops. Native style padding/dimensions are checked even for small previews. Ordinary gradients retain the16.8MP budget;4096² was tested without spatial effects. No limit was raised or source silently downscaled. Larger halo-aware tiling/GPU processing and intermediate composite caches are deferred; existing immutable asset caching is reused.

## Parallel development and remaining limits

PR20 was merged externally and is included in the final full test candidate. R8 did not merge/change its branch. PR21 at `516267f1b24b397b5094f9178a62fe5facd3aa82` remains separate. Its three actual conflicts are Appearance, Canvas and gradient.ts. Circle/ellipse native semantics, alternate tool routing, midpoint reverse, Raster appearance eligibility and path/mask/selection semantics need explicit reconciliation before combining releases. [Integration analysis](R8_PARALLEL_INTEGRATION.md).

Other explicit limits: one instance/type within supported compositing planes; built-in procedural patterns rather than custom texture asset import; selection-captured filter masks rather than an independent filter-mask brush; source-bounded CPU spatial work; guarded Boolean/selected-pixel/mask-bake operations;8-bit RGB/OKLab without ICC/GPU. Mobile tests are Chromium emulation, not physical Android/stylus testing. These limits are visible rather than represented as implemented optional capabilities.

See [test report](R8_TEST_REPORT.md) for every executed command and revision. Keep PR19 Draft and wait for explicit merge/deployment authorization.
