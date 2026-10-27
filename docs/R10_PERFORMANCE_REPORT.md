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
