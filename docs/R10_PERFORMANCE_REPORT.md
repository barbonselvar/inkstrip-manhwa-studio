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
