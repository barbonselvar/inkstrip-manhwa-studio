# R1 / R1.1 / R2 release audit (PR #13)

Date: 2026-10-24 · Branch: `codex/raster-studio-completion` · Base: `main` @ `a90c656`.
Audited head before fixes: `1695f1e`. Independent review; earlier completion reports were not
taken as evidence.

## Findings

| #   | Severity | Area               | Finding                                                                                                                                                                                                                                                                                                                                                                                                                | Status                                                                                                                              |
| --- | -------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1       | R1.1 import policy | PNGs with an `iCCP` colour profile (macOS/iPhone screenshots, Photoshop exports) were always rejected. The same preflight gates **already-stored** Chapter art (export/stitch, editors, retouch, faces, AI enhance, Raster worker), so profiled PNGs that production `main` imported could no longer be exported or edited. Reproduced in Chromium: `main` decodes and stitches the fixture; the branch rejected both. | Fixed: bounded inflate (2 MiB/file) in the preflight; bombs/corrupt/truncated/non-zlib still rejected.                              |
| 2   | P1       | R1.1 import policy | JPEGs with data after EOI (Pixel motion photos, Samsung trailers) were rejected as "truncated" because EOI had to be the last two bytes. Same stored-art impact. Reproduced in Chromium against `main`.                                                                                                                                                                                                                | Fixed: first `FF D9` after the scan header, bounded 1 MiB-chunk scan; scans without EOI stay rejected (79 MiB worst case ≈ 143 ms). |
| 3   | P2       | Canvas rotation    | Navigator (minimap) click ignored view rotation and centred the wrong point at 90°/180°/270°. View-only; no document data affected.                                                                                                                                                                                                                                                                                    | Fixed: shared `centerViewOn`; unit + 5-viewport browser regression.                                                                 |

No P0 defects were found. Each fix has a regression test that fails on the audited head and passes
after the fix (unit and Chromium).

## Verified without change

- Policy limits match the documented table exactly (32/16 MP, 80/40 MiB, 512/256 MiB estimate,
  128/64 MP and 256/128 MiB batch, 65,535 px side, 250 files, 64 frames, 2 MiB header budget).
  Resource budgets were not changed.
- Every decode consumer routes through `preflightImage`/`safeBitmap`/`decodeBlob`; only
  app-generated worker output is decoded directly.
- Import transaction: whole-batch preflight before decode, staged single IndexedDB transaction
  with expected-order check, abort on cancel/chapter switch, late bitmaps closed.
- Fuzzing: 22,500 mutated/truncated/trailer variants of all fixtures; no hang (max 14 ms), no
  non-Error throw, no accepted file over any budget.
- R2: clipping-reorder guard, stale mask mode reset, gesture `origin` revision guard and
  `commitCanvas` expected-revision check, per-gesture mask target, thumbnail cache keyed by
  exact isolated content with URL revocation, rotation via CSS only (no recomposition, export
  unchanged; covered by `test:r2:browser`).
- No production configuration change (`vercel.json`, `vite.config.ts`, workflows, `server/`).

## Known limitations (non-blocking)

- Compressed `iTXt`, trailing bytes after PNG `IEND`/GIF trailer/WebP `RIFF`, animated images
  over 64 frames and stored images above the constrained-device budget remain rejected by design;
  such stored art stays byte-exact in IndexedDB and can be exported on a desktop budget.
- TIFF/HEIF decoding depends on browser codecs.
- No physical Android device was used; touch was emulated in Chromium (see checklist below).
- The sandbox cannot reach `grok.com`; the platform branding script was answered with an empty
  script by a test-harness-only Playwright route. No test assertion was changed.

## Manual Android acceptance checklist

1. Import an iPhone/macOS screenshot PNG and a Pixel motion photo into a Chapter; both appear.
2. Open Raster Studio; Rotate left/right/reset are visible without hover; angle reads 90°/−180°/0°.
3. At 90°, draw a brush stroke and a rectangle selection; both land under the finger.
4. Pinch-zoom and two-finger pan while rotated; tap the navigator; the tapped area centres.
5. Undo/redo the stroke; export PNG; the export is upright (not rotated).
6. Drag a layer by its grip, then use the arrow buttons; edit a mask from its thumbnail.
7. Save, close and reopen the native document; layers, masks and rotation-free geometry persist.

## Validation (fix head, local sandbox, Node 22 / npm 11 lockfile install as in CI)

- `npm test`: 813/813 (200 + 59 + 90 + 464); `typecheck`, `lint`, `build`, `check:build`,
  `check:auth` (dev and build agree: sign-in off) pass.
- Chromium suites, dev server, no edits in flight: chapter-import, r2 (1440/768/390/360/320,
  touch below 800px), r2 gesture, homepage, dialogue, dialogue render/security/ocr, editor,
  adjustments, retouch, workflow, ui, pro, layers, repair, geometry, transform, color,
  appearance, vector, compound, pathfinder, artboards, vector-final, raster-refinement: pass.
- `production-vector-check --raster` against the built output (`vite preview`) at the release
  SHA: pass, no console errors or failed critical assets.
- `test:dialogue:workflow` timed out once (180 s) waiting for the cold OCR model download from
  `raw.githubusercontent.com`; it passed on rerun on this branch and on `main`.
- `test:studio:browser` (real Swin2SR inference) cannot run here: `huggingface.co` is
  unreachable from the sandbox browser (fails on `main` too). The branch run passed image
  decode before the model download failed; AI unit tests pass.
- GitHub Actions results for the final head are recorded on PR #13.
