# Phase E — Raster refinement implementation and release audit

Baseline: Phase D PR #3 normal merge
`a35e73ef90e71f79f711ce7830e8e8625e372aaa`. Development branch:
`codex/phase-e-raster-refinement`. Release status, exact tested SHA, Actions and live deployment evidence are recorded
in [PR #4](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/4); this
audit alone is not evidence of a merge or a production deployment.

The shared document, worker compositor, immutable source pool and Chapter revision
checks are retained. No replacement editor, AI model, paid API, database, auth or
production environment configuration was added.

## Implemented behavior

| System | Working implementation |
| --- | --- |
| Select and Mask | Native-resolution square dilation/erosion, smoothing, three-box Gaussian approximation, contrast and edge shifting; bounded local color-line matting in an unknown edge band; automatic local foreground/background statistics and explicit native-resolution canvas color samples |
| Selection workflow | Staged Apply/Cancel, debounced live updates after initial Preview, overlay/black-white/animated boundary views, selection-to-mask, named selection save/load/delete, existing add/subtract/intersect/invert, small-island cleanup and optional enclosed-hole filling |
| Brush dynamics | Arc-length dabs carrying spacing between pointer samples, soft/hard round and square tips, pen size/opacity, recorded velocity thinning, angle/roundness/direction rotation, scatter, deterministic seeded size/opacity jitter, smoothing and a source-pixel rope stabilizer |
| Presets | Eight additional Pencil/Ink Pen/Soft Brush/Hard Round/Airbrush/Line Art/Eraser/Texture recipes; existing three recipes preserved; custom save/rename/duplicate/delete with browser persistence; document brush settings and recorded stroke parameters persist natively |
| Masks | Editable native masks and painting, density, feather, inversion, enable/disable, linked/unlinked affine placement, same-world-position copy/paste with independent data, duplication through layer duplication, mask coverage thumbnails and explicit undoable raster/paint bake |
| Group/compositing | Group masks applied to the isolated child composite before group opacity/effects/clipping; linked group masks move once with group transforms; unlinked masks stay fixed; masked editable affine vector paints render in the document plane, including outside strokes |
| Large images | Consistent 16,777,216-pixel / 16,384-side Pro limits, retaining the 4-million-pixel mobile/low-memory cap; native-resolution tiled refinement with kernel halos; area-sampled coverage previews without native RGBA thumbnail allocation; conservative dirty rectangles for brush/eraser/mask preview presentation; existing bounded decoded-image LRU and worker previews retained |
| Recovery | Existing 50-step undo count plus conservative 32 MiB soft serialized-history accounting, always retaining the nearest Undo and Redo; separately bounded immutable source pool; existing per-region selection limits and device mask/frame checks; worker cancellation; failed operations preserve the current document/source |
| Persistence/export | Feature-bearing native envelope v5; versions 1–4 remain readable and continue to export their original version when no v5 feature is present; full editable data and original source references retained; PNG/JPEG/WebP exports use the shared compositor and native output frame |

## Algorithms and limits

- Matting is traditional local image processing, **not trained semantic selection or
  generative AI**. The unknown band is 0–64 source pixels. Color-line projection
  recovers fractional coverage when foreground/background colors differ enough;
  ambiguous low-contrast pixels retain the original matte. Hair outside the band,
  mixed backgrounds, translucent objects and colors shared by foreground/background
  can need manual mask painting. No universal hair-extraction accuracy is claimed.
- Morphology uses separable monotonic queues, O(pixels), with replicated document
  edges. Smooth/feather use actual floating-point pixel kernels. Refinement tiles
  include the complete radius/shift/filter halo; whole-image connected-component
  cleanup runs before tiling, so components are not cut at tile seams. Cleanup is
  optional and can remove small hair details; inspect the staged preview.
- Refinement does not replace source RGB or decontaminate matte fringe colors.
  Existing pixel selections retain anti-aliased alpha; source colors are untouched.
- Brush spacing is diameter-relative (0.01–2). Randomness is replayed from the
  stored seed. Real pen pressure is used only for pen events; mouse/touch use
  configured strength. Velocity uses recorded elapsed time. Stabilization is a
  0–200 source-pixel trailing rope, separate from smoothing. The Airbrush recipe
  accumulates flow along movement; it does not spray continually while stationary.
- Legacy strokes use their previous renderer. No old artwork is silently re-dabbed.
  New dynamics support at most 200,000 dabs/stroke, 10,000 recorded points/stroke,
  with the existing document command and layer limits. Texture is a stochastic dab
  recipe, not a sampled-image brush-tip library.
- Mask placement stores exact affine matrices (including inverses which exceed layer UI skew bounds); earlier development v5 Transform-form placements remain readable. Mask stroke selection clips capture the same exact matrix; linked Perspective/Warp masks compose the native mask frame before deformation when sampling document selections. Mask placement is affine. Relink before Perspective/Warp; copying/unlinking an
  already deformed mask is explicitly guarded. Group masks cannot be distributed
  losslessly across ungrouped children; remove/bake the group mask first. Bake is
  offered for raster/paint layers only and also commits their editable paint/tonal
  adjustments into a new PNG; undo retains the original layer/asset state.
- Affine vector masks own a document frame so small editing boxes do not crop
  exterior paints. Older finite mask frames remain finite. Source-frame limitations
  of nonlinear vector/text transforms and pixel adjustments remain the documented
  Phase D bounds; no exact unrestricted deformation is claimed.
- Mask feather is evaluated in the receiving coverage plane (raster source pixels,
  document pixels for direct vector/group planes); non-uniform transformed masks
  can therefore need a different numeric radius to match across layer kinds.
- This remains the existing Canvas compositor, not a new disk-backed tile engine.
  The worker still composites a bounded full preview; safe local stroke changes copy only their dirty presentation rectangle, while effects/filters/geometry changes fall back to a full copy. The preview is bounded to 1,400 pixels on its longest side; deep zoom can show a
  scaled preview until export. Native exports retain source resolution. Documents
  exceeding a device budget are rejected with recovery guidance, never silently
  downsampled. No unlimited layer/chapter-size or physical Android guarantee.
- Color uses browser Canvas sRGB/straight-alpha pixel processing with existing
  premultiplied-alpha-safe resampling. No CMYK, ICC soft-proofing, wide-gamut/16-bit
  editing, or arbitrary source profile round-trip is advertised. JPEG uses white
  behind transparent output; PNG preserves alpha; WebP quality is browser encoded.
- Up to 16 named selections, 200,000 row-bounded runs per pixel region; legacy multi-region coverage remains readable without a new aggregate cutoff. Native imports/exports have
  a 70 MB portable-file cap and 48 MB embedded source pool. History may have fewer
  than 50 undos for large documents; present work and the immediate Undo/Redo are never evicted by the soft budget.
- Masks, adjustments, raster artwork and other unsupported SVG features retain
  the explicit native/raster fallback; no silent lossy SVG flattening was added.

## Validation and measurements

Run all existing test commands plus `test:raster-refinement:browser`,
`bench:raster` and `bench:raster:browser`. The raster suite exercises real workers,
staged selection/history, native v5 reopening, mask density/feather/linkage,
outside vector strokes, isolated group alpha, seeded strokes, destructive bake
pixel equality and undo/redo, PNG/JPEG/WebP, and touch draw/mask/cancel at 320/390.
No physical Android device was used.

[Recorded measurements](benchmarks/phase-e-raster.json) include the method,
hardware/runtime/browser and memory-accounting caveats. Shared Linux AMD EPYC
9V74, Node 24.19.0, Chromium 156.0.8078.4. One generated line-art fixture/run per
size; no JIT warm-up or cross-device extrapolation. CPU refinement: 2048² 3,278.50
ms, 4096² 6,559.62 ms, 1024×8192 3,349.97 ms. CPU peak process RSS high-water:
193.8 MiB across the run. 100 strokes / 171,200 generated dabs: 37.25 ms.

Browser documents contain three layers, a density/feather mask and 50 strokes:

| Dimensions | Import/preview | Native PNG export |
| --- | ---: | ---: |
| 2048×2048 | 2,736.5 ms | 1,859.5 ms |
| 4096×4096 | 4,107.5 ms | 6,430.1 ms |
| 1024×8192 | 1,989.2 ms | 2,581.6 ms |

All exported dimensions were decoded and verified. Summed Chromium process-tree
RSS peaked at 1,479.9 MiB, sampled every 200 ms, potentially double-counting shared
pages and including browser/GPU/runtime processes and previously loaded documents.
The browser benchmark overlapped regression suites. Zoom-click timing includes UI
automation; it is not a frame-rate or gesture-latency claim.

Validation baseline: **677 passing automated tests**, TypeScript and production
build/config/auth checks, with one pre-existing button fast-refresh lint warning.
All **19 Chromium suites** passed on the integration build, including real
Swin2SR inference and Chapter recovery. The final revision also receives the
affected Raster/preset and release-verifier checks. Exact tested SHA, normal
merge, Vercel source SHA and live verification are recorded in PR #4 only after
those gates finish. Do not
release from benchmark/build success alone. Phase F remains unstarted until the
Phase E production release is fully verified.
