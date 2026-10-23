# Raster Studio completion — R1 audit, gap analysis and baseline

Date: 2026-10-23 · Baseline: `main` @ `71a29e2f01869a82a4b6a81818fb56441cb93c3f` · Scope: Phase R1 only.

R1 changes no application code. It records what Raster Studio actually does today, from the
source, tests and runnable checks, so that R2–R10 start from evidence rather than from earlier
phase documents.

## 1. Product scope

Inkstrip is a general creative editor, not a manhwa-only tool: a raster editor (Photoshop-class
workflows), a vector editor (Illustrator-class workflows) and a chapter workspace that share one
Pro document. Feature priorities below therefore target general illustration, photo retouching
and compositing first, with comics-specific workflows as a strength rather than the boundary.
All parity work is clean-room: reimplement documented behaviour and workflows, never copy
proprietary code, assets, icons or trademarked feature names.

## 2. Git and repository state

| Item | State |
| --- | --- |
| `main` HEAD | `71a29e2` (merge of #5) |
| PR #6 `codex/phase-f-ai-studio` | Open, **Draft**, AI Studio F1, 6 commits, 61 files. Not merged; R1 does not depend on it. Adds native envelope v6 and Pro IndexedDB v2. |
| PR #7 `claude/project-backups-and-stability` | Open. Project backup/restore, persistent storage. Overlaps #6 only in `package.json` (test list). |
| PR #8 `claude/split-pro-workspace` | Open. Splits `pro-workspace.tsx`. **Conflicts with #6** (both edit `pro-workspace.tsx`). Recommend merging #6 first and re-doing #8 on top. |
| CI (`ci.yml`, `build.yml`) | `npm ci`, typecheck, lint, unit tests, build, `check:build`. **None of the 24 `scripts/*browser*` suites run in CI.** |
| Deployment | `vercel.json` sets only the install command. Production deploys are assumed to come from Vercel's Git integration on `main` (not visible from the repository; not verified). |

## 3. Baseline (exact commands and results)

Environment: Linux container, 2 vCPU Intel Xeon @ 2.10 GHz, 8 GB RAM, Node v22.22.0, npm 10.9.4.
CI uses Node 24 / npm 11 (`.nvmrc`).

| Command | Result | Time |
| --- | --- | --- |
| `npm run typecheck` | pass | 23 s |
| `npx eslint .` | 0 errors, 1 warning (`react-refresh/only-export-components`, `src/components/ui/button.tsx`; fixed in #7) | 8 s |
| `npm test` | **677 passed, 0 failed, 0 skipped** | 15 s |
| `vite build` (via `scripts/with-app-env.mjs`) | pass | 9 s |
| `npm run bench:raster` | see §3.1 | — |
| `npm run bench:vector` | ran; text-path layout median 0.19 ms (cached), cold 5.8 ms | — |
| 24 browser suites (`test:*:browser`) | **BLOCKED** — Chromium download (`cdn.playwright.dev`) refused by this environment's network policy | — |
| Physical Android / iPad / stylus | **NOT RUN** — no hardware | — |

`npm ci` with npm 10 (Node 22) fails on a lock-file mismatch (`lru-cache@11.5.3`); with npm 11
(the CI toolchain) it succeeds. Node 22 is allowed by `engines`, so local Node 22 users hit this.

### 3.1 Raster benchmark (CPU, single cold run per size, Node — not browser timings)

Raw output: [`r1-raster-benchmark.json`](r1-raster-benchmark.json).

| Workload | Refine edge | Expand 8 px | Peak process RSS |
| --- | --- | --- | --- |
| 2048 × 2048 | 2,395 ms | 193 ms | 132 MiB |
| 4096 × 4096 | 8,501 ms | 892 ms | 245 MiB |
| 1024 × 8192 (tall chapter) | 4,043 ms | 449 ms | 246 MiB |
| Brush dab generation, 100 strokes × 2,000 points (171,200 dabs) | 41 ms | — | — |

Edge refinement at 4K takes over 8 s on this CPU. It is the clearest current performance target
(R4/R8). These numbers exclude browser canvas, GPU and compositing cost.

## 4. Architecture and dependency map

```
Chapter Workspace (chapter-studio.tsx) ── opens ──▶ ProWorkspace (pro-workspace.tsx, state + commands)
        │                                               │  history (editor/history + history-budget, 32 MB soft budget)
        │                                               │  commit() validates → validateDocument / documentSources / maxArea
        │                                               ├─▶ ProCanvas (pro-canvas.tsx): pointer → gesture → onCommit/onTransient
        │                                               ├─▶ Inspector tabs (properties, layers, refine, transform, geometry, color …)
        │                                               └─▶ ProRenderer (client.ts) ⇄ worker.ts (OffscreenCanvas)
        │                                                        └─ render.ts · pixels.ts · effects.ts · clipping.ts · repair-worker.ts
        │                                                           resample.ts · transform-pixels.ts · refine-selection.ts
        └─ Chapter DB (IndexedDB "inkstrip")            Pro session DB (IndexedDB "inkstrip-pro" v1; v2 in #6)
                                                        Native file: JSON envelope v1–v5 + base64 assets (files.ts)
```

Key invariants already present and worth keeping: immutable source assets addressed by id; every
document change passes `validateDocument`; device memory budgets (`maxArea` 16.7 MP desktop,
4 MP on coarse-pointer or ≤4 GB devices) reject work instead of silently downscaling; apply-to-chapter
uses compare-and-swap on `acceptedBlobId`.

## 5. Capability matrix

Status meanings: **IMPL** = real algorithm wired to UI and covered by unit tests, but not
re-verified interactively in R1 (browser suites blocked); **PARTIAL** = works with notable gaps;
**MISSING**; **DEFERRED** = intentionally out of current scope; **BROKEN** = confirmed defect.
Nothing is marked IMPLEMENTED+VERIFIED in R1 because interactive browser verification could not
run. Every toolbar tool was traced to real canvas handling; no stub, placeholder or
"coming soon" control was found.

### Document, layers, compositing (R2)

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Layer kinds: raster, paint, shape, text, group, gradient, adjustment | IMPL | `model.ts` `Layer.kind` |
| Create / duplicate / delete / reorder / multi-select / group / nested groups | IMPL | `layers.ts`, `pro-layers.tsx`, `layers.test.ts` |
| Lock, visibility, opacity, links, clipping, merge selected/visible, flatten | IMPL | `layers.ts`, `operations.ts`, `clipping.ts` |
| Blend modes | **PARTIAL** | Only 6: Normal, Multiply, Screen, Overlay, Darken, Lighten. Missing Soft/Hard Light, Color Dodge/Burn, Difference, Exclusion, Hue, Saturation, Color, Luminosity (all available natively in Canvas 2D) |
| Layer count | PARTIAL | Hard cap `MAX_LAYERS = 48` — low for compositing work |
| Undo/redo | IMPL | Bounded by 32 MB soft budget; nearest undo/redo always kept; history is not persisted across sessions (documented) |
| Native file | IMPL | Envelopes v1–v5 on main (v6 in #6); 70 MB file / 48 MB asset limits; JSON + base64 (~33 % size overhead, whole-file parse) |

### Painting (R3)

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Brush, pencil (square tip), eraser | IMPL | `render.ts` `stroke`, `brush-dynamics.ts` |
| Pressure → size, opacity-pressure, smoothing, stabilization, spacing, scatter, roundness, angle, follow-direction, size/opacity jitter, velocity, seeded randomness | IMPL | `DabDynamics`; the feature-inventory doc still lists several of these as missing (stale) |
| Presets with import/export | PARTIAL | Presets exist incl. "Airbrush" preset; no true airbrush build-up mode |
| Tilt, image/texture brush tips, dual brush | MISSING | No `tiltX`/image-tip code |
| Smudge, blur/sharpen brush, dodge/burn, sponge, mixer brush | MISSING |  |
| Paint bucket / flood fill | MISSING | Flood fill exists only inside Magic Wand selection (`selection.ts`) |

### Selections and masks (R4)

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Rect, ellipse, lasso, polygonal lasso, Magic Wand, Color Range | IMPL | `selection.ts`, canvas tools |
| Add / subtract / intersect / invert, saved named selections | IMPL | `Selection`, `savedSelections` |
| Refine edge: shift (expand/contract), smoothing, sampled foreground/background | IMPL | `refine-selection.ts`, `pro-refine.tsx` (slow at 4K, §3.1) |
| **Feathered selections, layer masks from selections, clipped strokes on Safari** | **BROKEN (High)** | `render.ts` `selectionCanvas` feathers with `OffscreenCanvasRenderingContext2D.filter = blur()`; no released Safari/iOS version supports `filter` on OffscreenCanvas, so feather silently becomes 0 and exports differ between browsers. `refine-selection.ts` already avoids this with a box-blur; `effects.ts` has `blurAlpha` to reuse. |
| Magnetic lasso, quick/object selection, border selection | MISSING | Object selection needs a model (deferred to AI phases) |
| Layer masks: paint, invert, density, feather, copy/paste, bake | IMPL | `masks.ts`, `Mask` |

### Retouching (R5)

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Clone Stamp (aligned/non-aligned), Healing Brush, Spot Healing, Patch | IMPL | `repair.ts`, `repair-worker.ts`, `repair.test.ts`; traditional, non-generative |
| Pattern stamp, dust & scratches, red-eye | MISSING |  |

### Transform, crop, resampling, precision (R6)

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Move, scale, rotate, flip, skew, pivot, numeric transform | IMPL | `transform.ts`, `pro-transform.tsx` |
| Perspective and 3×3 warp (single layer) | IMPL | `Deformation`; group perspective/warp missing |
| Non-destructive crop, straighten, image size, canvas size | IMPL / PARTIAL | Canvas size has top-left anchor only |
| Nearest / bilinear / bicubic / Lanczos-3, premultiplied alpha | IMPL | `resample.ts`, `resample.test.ts` |
| Grid, snapping, artboard guides, align/distribute | IMPL | `precision.ts`, `artboards.ts` |
| Rulers, draggable ruler guides, trim transparency, liquify | MISSING |  |

### Color, adjustments, filters, effects (R7)

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Brightness, contrast, exposure, saturation, temperature, hue, levels (black/white/gamma), 5-point composite curve | IMPL | `Adjustments`, `pixels.ts` |
| Color Balance, Vibrance, Channel Mixer, Shadows/Highlights, Gradient Map, Threshold, Posterize | IMPL | `color.ts` |
| Adjustment layers (masked / clipped) | IMPL |  |
| Per-channel curves, Selective Color, Replace Color, Black & White mixer, Photo Filter | MISSING | Selective color exists only in the older chapter image editor |
| Layer effects: drop/inner shadow, outer/inner glow, stroke, color/gradient overlay | IMPL | `effects.ts` (7 effects); bevel/emboss and pattern overlay missing |
| Destructive/smart filters: Gaussian/motion/radial blur, unsharp/high-pass, median, noise reduction, emboss, pixelate | MISSING | Only per-layer blur/sharpen/noise sliders |
| ICC profiles, 16-bit, CMYK | MISSING | Browser canvas is 8-bit sRGB; must not be simulated |

### Large artwork and performance (R8)

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Worker rendering, dirty-rect preview updates | IMPL | `worker.ts`, `preview-dirty.ts` |
| Memory budgets with honest rejection | IMPL | `raster-budget.ts` |
| Tiled processing beyond 16.7 MP, recovery journal | MISSING | Tall webtoon pages above budget cannot be opened in Pro |

### Workspace, files, accessibility (R9–R10)

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Labelled tools, keyboard shortcuts, touch gestures | IMPL |  |
| Command palette, configurable shortcuts | MISSING | `cmdk` is already a dependency but unused |
| Clipboard paste / drag-drop into Pro | MISSING | Present in Chapter Workspace only |
| Rulers panel, docking, multi-document tabs | MISSING |  |
| Fonts | PARTIAL | Only Arial, Georgia, monospace; no Arabic/CJK-specific families, no user fonts |
| Import formats | PARTIAL | Import UI advertises TIFF and HEIC, but decoding uses the browser: Chrome/Firefox/Android cannot decode them, so these fail outside Safari |
| PSD / OpenRaster / TIFF export | MISSING |  |

## 6. Findings

| ID | Severity | Finding | Recommendation |
| --- | --- | --- | --- |
| R1-01 | **High** | Feather of selections, selection-derived masks and stroke clips is lost on Safari/iOS because `OffscreenCanvasRenderingContext2D.filter` is unsupported there; preview and export differ by browser. | First R2 item: replace the CSS blur with the existing separable box-blur (`blurAlpha`) and add a pixel test proving identical output with `filter` unavailable. Not fixed in R1 (not data loss; R1 rules limit fixes to data-loss/security). |
| R1-02 | Medium | No browser suite runs in CI; the 24 Playwright suites are local-only, so UI regressions can merge unnoticed. | Add a CI job for the fastest core browser suites (studio, pro, layers) with cached Chromium. |
| R1-03 | Medium | PR #8 and PR #6 both edit `pro-workspace.tsx`. | Merge #6 first, then rebase or redo #8. |
| R1-04 | Medium | `MAX_LAYERS = 48` limits compositing work. | Review against memory budgets in R2/R8; raise with a measured budget instead of a fixed small cap. |
| R1-05 | Low | Import advertises TIFF/HEIC, which only Safari decodes. | Show formats per browser capability, or add a WASM TIFF decoder (license check required). |
| R1-06 | Low | `npm ci` fails on npm 10 / Node 22 although `engines` allows Node 22. | Regenerate the lock with a version both accept, or narrow `engines` to Node 24. |
| R1-07 | Low | `docs/creative-platform-feature-inventory.md` is partly stale (e.g. brush dynamics now implemented). | Treat this R1 matrix as current; update the inventory at R10. |

No Critical issue and no data-loss or security defect was found in the Raster path during R1.

## 7. Prioritised plan for R2–R10

Ordered by user value per unit of risk. Each phase stops for approval.

- **R2 — Document & compositor.** Fix R1-01 first. Add the 10 missing Canvas-native blend modes (6 separable + 4 non-separable) with pixel fixtures. Revisit the 48-layer cap. Compositing round-trip tests.
- **R3 — Painting.** Paint bucket (tolerance, contiguous, sample all layers); smudge, blur/sharpen and dodge/burn brushes; tilt where Pointer Events report it; image brush tips.
- **R4 — Selections.** Border/smooth selection; magnetic lasso (edge-snapping, no model needed); speed up refine edge at 4K (tiles or worker pool).
- **R5 — Retouching.** Pattern stamp, dust & scratches; manga clean-up presets (line-art cleanup, text removal in flat bubbles).
- **R6 — Transforms.** Rulers with draggable guides; canvas-size anchors; trim transparency; group perspective/warp; liquify as a later, separate item.
- **R7 — Color & filters.** Per-channel curves, Selective Color in Pro, Black & White mixer; a non-destructive filter stack (Gaussian/motion blur, unsharp mask, high-pass, median, noise, pixelate, emboss); bevel/emboss and pattern overlay effects.
- **R8 — Large artwork.** Tiled rendering so tall webtoon pages beyond 16.7 MP open in Pro without downscaling; crash-recovery checkpoints.
- **R9 — Workspace.** Command palette (reuse `cmdk`), configurable shortcuts, paste/drag-drop into Pro, rulers panel, user fonts (local font upload) with Arabic/CJK coverage; Android/iPad passes.
- **R10 — Interop & release.** PSD **import** of layers via a permissively licensed reader (candidate: `ag-psd`, MIT — license and fidelity to be verified), OpenRaster export, honest unsupported-feature reporting; full regression and security pass.

### Free, open-source AI assists (separate AI track, after PR #6 review)

Kept out of R-phases so traditional tools stay deterministic. Every candidate needs code **and**
weight licence verification and real inference before being enabled (the registry in #6 already
enforces this):

- **Object removal:** LaMa (Apache-2.0 code; weight terms to verify) via ONNX in the browser.
- **Quick/object selection:** a SAM-family segmenter that runs in the browser (licence and size to verify).
- **Upscaling:** existing Swin2SR; Real-ESRGAN anime models (BSD-3 code; checkpoint to verify).
- **Excluded:** CodeFormer (S-Lab licence restricts commercial use).

## 8. Limitations of this audit

- No interactive browser, physical Android, iPad or stylus verification was possible; statuses are
  from source tracing and unit tests.
- Benchmarks are single cold CPU runs in Node on a shared 2-vCPU host; do not extrapolate to phones.
- Production deployment configuration on Vercel was not inspected.

Phase complete. Awaiting explicit user approval before proceeding to the next phase, merging into main, or deploying to production.
