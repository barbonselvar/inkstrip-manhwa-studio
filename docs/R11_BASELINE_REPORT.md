# R11 baseline report

Read-only verification of main, R10 and production before any R11 change, plus
measured baselines. All numbers are from this session; none are copied from R10
without being labelled as such.

## 1. Repository and production state (verified 2026-10-30)

| Item                        | Observed                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main HEAD                   | `aa7e1994bba2c447e3faed25d23b62c6cadef7c7` — the R10 merge of PR #23; no newer commits                                                                                                                                                |
| GitHub Actions on main      | Configuration checks [40968013787](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40968013787) and build [40968013719](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40968013719): success |
| Open PRs                    | #6 (draft, 2026-10-23, `codex/phase-f-ai-studio`) — unrelated, left untouched                                                                                                                                                         |
| Open issues                 | none                                                                                                                                                                                                                                  |
| This sandbox's egress       | `inkstrip-manhwa-studio.vercel.app`, `huggingface.co` and `grok.com` refused by the proxy (`connect_rejected`), as in R10                                                                                                             |
| Live production (CI runner) | release marker `aa7e1994…` = main; full live check incl. real AI passed (run [41045880260](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/41045880260))                                                          |
| Built app with real AI (CI) | `test:studio:browser` passed: model download, inference, compare, apply/reload, byte-exact original recovery, cancel, batch, mobile                                                                                                   |

**R10 verification gaps closed.** The two items R10 recorded as blocked
(`test:production:browser … --ai` and `test:studio:browser`) were run unchanged
on GitHub-hosted runners, an authorized environment of this repository. Nothing
was mocked; see [R11_TEST_REPORT.md](R11_TEST_REPORT.md) §A.

## 2. Static gates on unchanged main

| Gate                  | Result                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| `npm ci`              | PASS                                                                     |
| `npm run typecheck`   | PASS                                                                     |
| `npm run lint`        | PASS                                                                     |
| `npm test`            | PASS — 1,078 tests (200 scripts + 59 app/auth + 121 Studio + 698 Pro)    |
| `npm run build`       | PASS                                                                     |
| `npm run check:build` | PASS                                                                     |
| `npm run check:auth`  | needs the dev server's resolved env; run with the server (§ test report) |

Environment: Node 22.22.0, Playwright 1.64.0, headless Chromium 153.0.8010.12
(the sandbox's preinstalled build; Playwright's expected build directory was
aliased to it locally — no repository change). Three to four shared vCPUs; not
a device guarantee.

## 3. Architecture inspected

- **Compositor** (`render.ts`): OffscreenCanvas full-plane pipeline. Each layer
  surface, each projected layer and the output are full-size canvases;
  adjustments/filters use `getImageData` copies of the layer plane.
- **Smart Filters** (`smart-filters.ts`, `smart-tiles.ts`): local integer kernels
  (Gaussian family, Median, Surface, Edges) run in 256 px tiles with exact halos;
  Motion, Radial, Emboss and Noise keep whole-plane processors.
- **Brush** (`brush-engine`, `clippedStroke`): stroke dabs drawn on the layer
  surface; R3 planner benchmarks unchanged.
- **Selection masks**: row-RLE coverage rendered via `selectionCanvas`.
- **Export**: worker `composite` at native resolution → PNG/JPEG/WebP blob.
- **Workers**: render worker per workspace, recovery worker, pathfinder,
  selection transform, repair, color workers; cancellation via superseded
  generation and between-tile checkpoints.
- **Storage**: Pro sessions (`inkstrip-pro` v5) store the document **and the
  whole immutable Blob pool** per page; recovery checkpoints (`inkstrip-pro-recovery`
  v1) store self-contained native copies of referenced assets only.
- **Limits**: Raster 16.8MP desktop / 4MP touch / 16384 px; Smart Filters 4MP and
  128M taps; styles 4MP; pool 64 assets / 48MB per page.

## 4. Baseline measurements

### 4.1 Smart Filter peak memory (new, isolated)

`bench:r11:filter-memory`, three child-process runs per case; peak RSS above the
already-allocated, pre-faulted input; outputs compared by SHA-256.

| Size (MP)       | Filter      | Whole-plane peak p50 | Tiled peak p50 | Output |
| --------------- | ----------- | -------------------: | -------------: | ------ |
| 1080×1920 (2.1) | Gaussian r1 |             49.8 MiB |       29.9 MiB | equal  |
| 1080×1920 (2.1) | Gaussian r2 |             49.8 MiB |       28.5 MiB | equal  |
| 1080×1920 (2.1) | Median r1   |             22.1 MiB |       32.8 MiB | equal  |
| 1080×3700 (4.0) | Gaussian r1 |             93.9 MiB |       30.4 MiB | equal  |
| 1080×3700 (4.0) | Gaussian r2 |             93.8 MiB |       30.6 MiB | equal  |
| 1080×3700 (4.0) | Median r1   |             45.0 MiB |       41.9 MiB | equal  |

Interpretation: whole-plane Gaussian allocates a 16 B/px `Float32Array` temp;
tiling bounds it to one tile. Median allocates only its output, so tiling buys
cancellation/progress granularity, not memory. Timing from these runs is not used
(they overlapped other work); R10's isolated Gaussian latency table stands.

### 4.2 Long pages on the unchanged main build

`r10-long-page-browser-check` (main's own copy) against the production build of
unchanged main, five sequential runs, nothing else running. Every run passed all
assertions (zoom/fit, pan, brush, save/reopen, source bytes, PNG hashes at
tolerance 0). Raw: [baseline-long-page-p50-p95.json](r11-evidence/baseline-long-page-p50-p95.json).

| Viewport | Height | Raster         |   n | Import p50/p95 ms | Open (or refusal) p50/p95 ms | Brush p50/p95 ms | PNG export p50/p95 ms | JS heap p50 MiB |
| -------: | -----: | -------------- | --: | ----------------: | ---------------------------: | ---------------: | --------------------: | --------------: |
|     1440 |   1920 | editable       |   5 |     207.0 / 232.6 |              1536.8 / 1631.9 |    516.4 / 548.0 |        872.3 / 1044.7 |            21.2 |
|     1440 |   5000 | editable       |   5 |     426.8 / 592.4 |              1755.8 / 1786.6 |    100.7 / 101.2 |         331.3 / 364.0 |            48.1 |
|     1440 |  10000 | editable       |   5 |     790.0 / 814.3 |              1697.7 / 1863.9 |    100.0 / 101.3 |         579.7 / 629.7 |            57.3 |
|     1440 |  20000 | safely refused |   5 |   1460.0 / 1540.5 |              1403.1 / 1415.3 |          refused |               refused |            98.3 |
|      390 |   1920 | editable       |   5 |     199.3 / 245.3 |              1633.7 / 1692.5 |    550.4 / 564.2 |        941.4 / 1075.0 |            24.5 |
|      390 |   5000 | safely refused |   5 |     516.4 / 573.2 |              1342.9 / 1348.9 |          refused |               refused |            12.5 |
|      390 |  10000 | safely refused |   5 |     826.4 / 836.2 |              1346.7 / 1350.5 |          refused |               refused |            14.5 |
|      390 |  20000 | safely refused |   5 |   1328.6 / 1742.8 |              1355.0 / 1368.1 |          refused |               refused |            96.0 |

Same shape as R10's published table: desktop edits through 10000 px, touch
through 1920 px; larger pages are refused explicitly (lossless split offered).
Absolute times differ from R10's table (a different sandbox and browser state),
so R11 is compared only against these numbers, measured the same way, in the
performance report.

### 4.3 Asset-pool growth (new reproduction)

| Scenario (R10 main)                                 | Pool after | Next asset-adding action            | After reload  |
| --------------------------------------------------- | ---------: | ----------------------------------- | ------------- |
| 63 Clone Stamp samples, none painted (UI)           |  64 assets | refused: "at most 64 raster assets" | still refused |
| 63 native import cycles (unit)                      |  64 assets | refused                             | still refused |
| one 46MB unreferenced composite + 3MB sample (unit) |       46MB | refused: "48MB document limit"      | still refused |

The referenced set in each case is the original source only.

## 5. Proposed improvements (evidence-based)

Full classification of every R10 deferred item: [R11_DEFERRED_FEATURE_REVIEW.md](R11_DEFERRED_FEATURE_REVIEW.md).

| Improvement                       | Current behaviour / evidence                                                       | User impact                                       | Perf impact                    | Complexity | Compat risk                          | Acceptance criteria                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------ | ---------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Open-time asset compaction        | Unreferenced Blobs persist forever and count toward 64/48MB (§4.3)                 | Pages permanently refuse merges, imports, samples | Smaller stored records/backups | S          | Low: same traversal as native export | Byte-identical native files; pixel-identical reopen; refused action works after reopen; no open-time write |
| Message spacing                   | 44 messages read "up to4MP", "exceeds128M"                                         | Unprofessional error text on every limit          | none                           | XS         | Tests pinning old text               | All unit/browser suites pass with corrected text                                                           |
| Command palette (#11)             | Tools only via icon rail; 16 inspector tabs scroll on phones                       | Discoverability, especially at 320–390 px         | none (pure, small list)        | S          | None (no data path)                  | Same handlers/disabled rules; 5 widths; touch; no artwork/history change                                   |
| External verification workflow    | R10 production/AI checks blocked by sandbox egress                                 | Release confidence                                | none                           | XS         | None                                 | Live marker = current main; real inference passes                                                          |
| Extend filter tiling / raise caps | Rejected: no memory benefit beyond Gaussian; compositor planes dominate (§4.1, §3) | —                                                 | —                              | —          | —                                    | —                                                                                                          |
| Tiled document compositor         | Deferred: replaces the compositor (new engine)                                     | Would enable >budget pages without split          | Bounded memory                 | XL         | High                                 | Design only                                                                                                |
