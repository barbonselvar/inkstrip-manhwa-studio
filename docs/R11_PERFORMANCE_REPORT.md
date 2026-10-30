# R11 performance report

**R11 makes no speed claim.** It changes no rendering, brush, filter, import or
export algorithm. This report (1) quantifies the memory effect of R10's filter
tiling, which R10 had not isolated, (2) re-measures long pages on unchanged main
and on R11 under identical conditions to show no regression, and (3) records the
storage effect of open-time asset compaction.

Environment: shared cloud sandbox (3–4 vCPUs), Node 22.22.0, Playwright 1.64.0,
headless Chromium 153.0.8010.12. Not a device guarantee; no physical phone.
p50/p95 use linear interpolation; with n = 5 the p95 is close to the maximum.

## 1. Smart Filter peak memory: whole-plane vs R10 tiles

`npm run bench:r11:filter-memory` — each case in its own child process; the peak
is `process.resourceUsage().maxRSS` above a baseline taken after the input plane is
allocated and page-faulted, so only the filter's own working memory counts. Three
runs per case; tiled and whole-plane outputs compared by SHA-256 over the full
RGBA buffer (identical in every case; tolerance 0). Raw:
[filter-memory.json](r11-evidence/filter-memory.json).

| Size (MP)       | Filter      | Whole-plane peak p50 / max | Tiled peak p50 / max | Reduction |
| --------------- | ----------- | -------------------------: | -------------------: | --------: |
| 1080×1920 (2.1) | Gaussian r1 |                49.8 / 49.9 |          29.9 / 30.0 |     −40 % |
| 1080×1920 (2.1) | Gaussian r2 |                49.8 / 49.9 |          28.5 / 31.1 |     −43 % |
| 1080×1920 (2.1) | Median r1   |                22.1 / 23.4 |          32.8 / 33.2 |     +48 % |
| 1080×3700 (4.0) | Gaussian r1 |                93.9 / 93.9 |          30.4 / 30.5 |     −68 % |
| 1080×3700 (4.0) | Gaussian r2 |                93.8 / 94.0 |          30.6 / 30.7 |     −67 % |
| 1080×3700 (4.0) | Median r1   |                45.0 / 45.1 |          41.9 / 41.9 |      −7 % |

Units: MiB above input. Explanation from the source: the whole-plane separable
blur allocates a `Float32Array` of 16 bytes per pixel plus the output; tiling keeps
only one 256 px tile (+halo) of that temp, so the peak stays ≈ output + one tile
regardless of image size. Median's whole-plane path allocates only the output, so
tiling adds per-tile buffers and garbage instead of removing a plane.

Wall time from these runs (not isolated; other work was running) is in the raw
JSON only and is not used for claims. R10's isolated latency table stands: tiling
is not faster at these sizes.

**Decision.** Keep R10's tiling (≈3× lower peak for the Gaussian family at the
4MP cap). Do not extend tiling to Median/Motion/Emboss (no memory benefit) and do
not raise any cap: the compositor's full-size canvases, not filter temps, bound
long pages.

## 2. Long pages: unchanged main vs R11

`r10-long-page-browser-check` (unchanged assertions; main's own copy of the
script for main) against the production build of each tree served the same way,
five sequential runs each, no other browser work and no dev server running.
Every run passed: zoom/fit, Hand pan, brush, native save/reopen, original source
bytes and full-resolution PNG hashes at tolerance 0. Raw:
[baseline-long-page-p50-p95.json](r11-evidence/baseline-long-page-p50-p95.json),
[r11-long-page-p50-p95.json](r11-evidence/r11-long-page-p50-p95.json).

| Viewport | Height | Raster         | Import p50/p95 ms main → R11  | Open p50/p95 ms main → R11    | Brush p50/p95 ms main → R11 | PNG export p50/p95 ms main → R11 | JS heap p50 MiB |
| -------: | -----: | -------------- | ----------------------------- | ----------------------------- | --------------------------- | -------------------------------- | --------------- |
|     1440 |   1920 | editable       | 207.0/232.6 → 205.0/231.4     | 1536.8/1631.9 → 1638.9/1783.4 | 516.4/548.0 → 499.3/608.7   | 872.3/1044.7 → 1005.1/1123.6     | 21.2 → 21.6     |
|     1440 |   5000 | editable       | 426.8/592.4 → 406.4/590.0     | 1755.8/1786.6 → 1731.7/1916.3 | 100.7/101.2 → 99.9/112.8    | 331.3/364.0 → 304.7/332.9        | 48.1 → 22.6     |
|     1440 |  10000 | editable       | 790.0/814.3 → 861.7/928.7     | 1697.7/1863.9 → 1719.3/1872.7 | 100.0/101.3 → 100.2/103.0   | 579.7/629.7 → 598.5/701.5        | 57.3 → 58.3     |
|     1440 |  20000 | safely refused | 1460.0/1540.5 → 1563.4/1680.1 | 1403.1/1415.3 → 1391.6/1413.3 | refused                     | refused                          | 98.3 → 52.3     |
|      390 |   1920 | editable       | 199.3/245.3 → 210.4/242.2     | 1633.7/1692.5 → 1706.7/1750.4 | 550.4/564.2 → 567.3/669.3   | 941.4/1075.0 → 1026.7/1067.5     | 24.5 → 19.0     |
|      390 |   5000 | safely refused | 516.4/573.2 → 540.5/612.5     | 1342.9/1348.9 → 1343.5/1347.3 | refused                     | refused                          | 12.5 → 12.7     |
|      390 |  10000 | safely refused | 826.4/836.2 → 860.3/970.5     | 1346.7/1350.5 → 1357.9/1367.6 | refused                     | refused                          | 14.5 → 14.6     |
|      390 |  20000 | safely refused | 1328.6/1742.8 → 1716.9/1815.3 | 1355.0/1368.1 → 1354.7/1374.5 | refused                     | refused                          | 96.0 → 99.2     |

**Reading.** No regression and no improvement is claimed. None of these code
paths changed in R11 (a new import never reaches open-time compaction), yet p50
moved by up to +29 % (390 px / 20000 Chapter import, code untouched) between the
two sets; that is the run-to-run noise of this shared sandbox, and every R11 delta
is inside it. JS heap is sampled after each case and depends on GC timing; it is
not peak memory. Refused rows are explicit device-budget refusals, never zeros.
The ~500 ms brush at 1920 px vs ~100 ms on taller pages, noted but unexplained in
R10, reproduces on main and R11 alike. The 1920 px case is the first editable page
in each viewport's fresh browser context, so a first-use cost is plausible, but the
order was not varied and the cause remains unconfirmed.

## 3. Asset compaction (storage)

Measured through the real UI (`test:r11:browser`) on a 128×96 test page:

| State                                        | Stored assets | Stored bytes | Notes                                            |
| -------------------------------------------- | ------------: | -----------: | ------------------------------------------------ |
| After 63 Clone Stamp samples                 |            64 |    2,161,664 | 64th sample refused (R10 and R11)                |
| Reopened, before any save                    |            64 |    2,161,664 | opening never writes                             |
| After the next save (R11)                    |             2 |       67,552 | source + new sample; R10 stays at 64 and refuses |
| After painting with the sample and reopening |             2 |       67,552 | referenced sample retained, pixels identical     |

Bytes from the CI run of `test:r11:browser` on `ed1dfdd`
([continuity job](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/41051344975/job/124048003388));
the local run produced the same asset counts.

Each sample stores a full-document composite PNG, so on a 1080×10000 page the
same accumulation reaches the 48MB budget after far fewer samples. Compaction
cost is one traversal of the document's layer list at open (no pixel work).

## 4. Command palette

Built per render from the existing tool table (≤31 tools), ≤16 panels and 7
actions; search is a linear scan of those entries. No rendering, worker or
storage work. Not separately benchmarked; its cost is below anything the long-page
timings can resolve.
