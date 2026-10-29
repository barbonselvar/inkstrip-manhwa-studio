# R10 performance report

No new performance claim is made for unimplemented milestones. Measurements
below are observed wall time in this execution environment, not user-device SLAs.

| Recovered HEAD check                       | Seconds |
| ------------------------------------------ | ------: |
| Unit/security tests including audit probes |   24.26 |
| Production build                           |    7.06 |
| Typecheck                                  |   10.65 |
| Lint                                       |    9.18 |
| Audit browser, three viewport widths       |   21.04 |

Large-image loading, rendering, brush, Smart Filters, export, recovery and memory
benchmarks remain to be run. Existing resource caps remain in force. No artwork
is silently downscaled and no larger-image capability is claimed yet.

## Baseline observations before continuation

Node 24.19.0, Playwright 1.64.0, Chromium 156.0.8078.4; three logical CPUs.
These runs overlapped non-stress browser checks, so they are observations rather
than isolated speed comparisons. The R3 stress suite ran alone: 388.75 seconds.

R8 native/reopen benchmark remained pixel-exact and source-byte-exact at 512²,
1024², 2000² with spatial processing, and 4096² without spatial effects. First PNG
export times were 477.3, 1921.3, 4894.6 and 3241.8 ms respectively. Sampled
Node/browser-process-tree peak RSS was 773.8–962.8 MiB; this includes browser
infrastructure and is not an image-buffer allocation measurement. Raw results:
[a-r8-render-benchmark.json](r10-evidence/a-r8-render-benchmark.json).

R9 900-anchor simplification measured 101.774 ms; pointer snapping 0.009 ms,
ruler ticks on a 16,000px page 0.006 ms. The existing Raster brush planner processed
100 strokes x2000 points /171,200 dabs in 34.24 ms. No resource cap was raised.

## D measured continuation

Node24 Gaussian sigma1, one observed run (not isolated/warmed):

| Dimensions | Whole ms | Tiled ms | Tiles | Largest tile pixels |
| ---------- | -------: | -------: | ----: | ------------------: |
| 512×512    |    83.65 |    40.59 |     4 |               67081 |
| 1080×1920  |   262.82 |   282.71 |    40 |               68644 |
| 2000×2000  |   500.47 |   508.22 |    64 |               68644 |

Every output was byte-identical. This demonstrates bounded temporary planes, not an across-the-board speedup. Original/output buffers remain full-resolution. Node RSS/external-buffer samples are included in raw JSON; they retain both comparison outputs and are not isolated algorithm peaks. No cap was increased.

Long-page timings are Playwright-observed UI readiness, excluding unnecessary full-preview array transport; browser PNG bytes are decoded and compared by SHA256 over the complete RGBA buffer.

| Viewport | Native height | Raster         | Import ms | Open/refusal ms | Brush ms | PNG ms |
| -------- | ------------: | -------------- | --------: | --------------: | -------: | -----: |
| 1440     |          1920 | True           |     224.6 |          1589.6 |    384.4 |  812.5 |
| 1440     |          5000 | True           |     298.7 |          1118.4 |     99.9 |  288.0 |
| 1440     |         10000 | True           |     468.7 |          1192.3 |    101.2 |  494.0 |
| 1440     |         20000 | safely refused |    1442.0 |          1361.6 |      0.0 |    0.0 |
| 390      |          1920 | True           |     168.5 |          1124.3 |    382.9 |  624.2 |
| 390      |          5000 | safely refused |     288.0 |           824.0 |      0.0 |    0.0 |
| 390      |         10000 | safely refused |     884.5 |           899.7 |      0.0 |    0.0 |
| 390      |         20000 | safely refused |    1017.9 |           833.3 |      0.0 |    0.0 |

Zero entries mean that operation was safely refused, not a zero-duration benchmark. Chromium JS heap was sampled after operations; it is not browser/GPU/process peak memory. Raw native-plane bytes and heap samples are in d3-long-pages.json. Physical Android and cross-device performance were not measured.

## Repeated measurements (p50/p95)

Seven sequential runs per case of the unchanged repository scripts, nothing else
running: `r10-long-page-browser-check` against the production build and
`r10-recovery-benchmark` against the dev server. p50/p95 use linear interpolation;
with n = 7 the p95 is close to the maximum. Refused operations have no timing and
are shown as refused, never as zero. Memory is the Chromium JS heap after each case
(CDP metrics), not GPU or process peak. 4-vCPU cloud sandbox, headless Chromium 153;
not a device guarantee. Raw data: [f-performance-p50-p95.json](r10-evidence/f-performance-p50-p95.json).

| Viewport | Height | Raster         |   n | Import p50/p95 ms | Open (or refusal) p50/p95 ms | Brush p50/p95 ms | PNG export p50/p95 ms | JS heap p50 MiB |
| -------: | -----: | -------------- | --: | ----------------: | ---------------------------: | ---------------: | --------------------: | --------------: |
|     1440 |   1920 | editable       |   7 |     169.6 / 171.6 |              1064.2 / 1092.5 |    384.0 / 416.0 |         672.1 / 707.7 |            11.1 |
|     1440 |   5000 | editable       |   7 |     290.2 / 301.1 |              1138.7 / 1164.9 |     99.6 / 100.1 |         224.4 / 240.5 |            18.1 |
|     1440 |  10000 | editable       |   7 |     582.5 / 623.3 |              1135.1 / 1185.7 |    100.2 / 100.4 |         385.7 / 401.0 |            57.7 |
|     1440 |  20000 | safely refused |   7 |    996.5 / 1042.9 |                855.2 / 896.4 |          refused |               refused |            19.2 |
|      390 |   1920 | editable       |   7 |     166.5 / 172.6 |              1070.7 / 1101.7 |    401.0 / 401.4 |         600.2 / 663.5 |            11.1 |
|      390 |   5000 | safely refused |   7 |     295.7 / 342.2 |                825.9 / 831.5 |          refused |               refused |            12.4 |
|      390 |  10000 | safely refused |   7 |     584.7 / 588.8 |                827.5 / 854.3 |          refused |               refused |            14.5 |
|      390 |  20000 | safely refused |   7 |    984.8 / 1010.5 |                826.9 / 835.5 |          refused |               refused |            19.2 |

| Document  |   n | Primary save p50/p95 ms | Checkpoint written p50/p95 ms | Verified read p50/p95 ms | Exact every run |
| --------- | --: | ----------------------: | ----------------------------: | -----------------------: | --------------- |
| 256×256   |   7 |               6.6 / 6.8 |                   135 / 181.7 |              18.7 / 23.3 | yes             |
| 1024×1024 |   7 |               2.4 / 2.7 |                 218.7 / 272.8 |            147.4 / 184.2 | yes             |
| 1080×1920 |   7 |               2.9 / 3.4 |                 321.6 / 334.8 |            260.7 / 274.3 | yes             |

Open time is UI readiness (or the explicit refusal). Brush is one stroke to settled
preview; the 1920 px case is the first editable case in each run and measures
higher (≈390 ms) than the taller pages (≈100 ms); the cause was not isolated. Every
recovery run restored the document and source bytes exactly. Filter latency and
processing time are covered by the single-run tile benchmark above; the 4MP and
128M-tap Smart Filter caps were not changed.

Smart Filter latency (Gaussian, `bench:r10:tiles`, Node 22, seven runs; the script compared tiled and whole-plane output at pixel tolerance 0 in every run). Tiling bounds temporary planes; it is not faster at these sizes:

| Dimensions |   n | Whole-plane p50/p95 ms | Tiled p50/p95 ms | Tiles | Pixel tolerance |
| ---------- | --: | ---------------------: | ---------------: | ----: | --------------: |
| 512×512    |   7 |            52.9 / 53.7 |      41.8 / 42.6 |     4 |               0 |
| 1080×1920  |   7 |          313.6 / 316.8 |    327.9 / 353.5 |    40 |               0 |
| 2000×2000  |   7 |          610.6 / 617.7 |    618.2 / 682.7 |    64 |               0 |
