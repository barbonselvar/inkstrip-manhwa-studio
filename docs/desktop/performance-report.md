# Performance report

Measured on 2026-11-07 with `apps/desktop/test/perf-desktop.mjs` (real Electron app,
production renderer bundle, isolated profiles, network disabled).

**Machine:** Intel Core i7-12700H, 31.6 GB RAM, NVIDIA RTX 4050 Laptop GPU + Intel Iris
Xe, Windows 11 Pro 26200, Electron 45.2.3 (Chromium 156).

**Input:** synthetic 1080 × 1600 JPEG panels (gradients, ink strokes, noise, text;
≈ 0.6 MB each), imported from files on disk through the chapter's file input — the same
path as a user's import.

| Panels | Input (MB) | Startup (ms) | Idle RAM (MB) | Import | Composition & FX first render | Save `.inkstrip` | File (MB) | Chapter export (800 px) | Reopen file in a new profile | RAM after work (MB) |
|---|---|---|---|---|---|---|---|---|---|---|
| 20 | 11.8 | 530 | 397 | 1.0 s · peak 707 MB | 0.5 s | 0.5 s | 12.3 | 3.6 s · peak 896 MB | 0.5 s | 887 |
| 50 | 29.6 | 523 | 477 | 1.5 s · peak 883 MB | 1.0 s | 0.5 s | 30.9 | 8.1 s · peak 1,123 MB | 1.0 s | 1,098 |
| 100 | 59.2 | 526 | 428 | 3.0 s · peak 772 MB | 0.5 s | 1.0 s | 61.6 | 15.2 s · peak 1,154 MB | 1.0 s | 1,139 |
| 200 | 118.3 | 631 | 565 | 7.1 s · peak 927 MB | 1.0 s | 1.5 s · peak 1,175 MB | 123.2 | not run | 2.0 s | 1,176 |

How to read it:

- RAM is the sum of all app processes' working sets (`app.getAppMetrics()`), sampled
  every 500 ms; "peak" is the highest sample during that step.
- Times come from waiting on UI states (the Playwright waits poll), so values are accurate
  to roughly ±0.25 s; sub-second results mean "under a second".
- "Reopen" covers reading the file, validating every record and image, writing the
  workspace, and showing the project as saved.
- A 30-step wheel scroll through the composition was run at each size; the app stayed
  responsive (the step's 3–3.5 s duration is dominated by the script's own pacing, so it
  is not reported as a metric).
- Average CPU across all processes during import/save was 1–7 % of the machine.
- GPU utilization was **not measured** (Electron exposes no per-process GPU usage);
  hardware acceleration is on (Chromium default).
- The 200-panel chapter export was **not run** by the suite (the export renders the full
  chapter at once and was limited to ≤ 100 panels to keep the run bounded).

Memory stays roughly flat from 50 to 200 panels (peaks ~0.9–1.2 GB), because the studio
already decodes thumbnails and composition tiles lazily instead of holding every
full-resolution image.

## Before / after

There was no Windows desktop app that could open projects offline before this work (the
Tauri shell loaded the website), so there is no desktop "before" to compare. No editor
rendering code was changed for performance; the desktop app runs the same editor code as
the website. Desktop-specific work was kept off the hot paths: saving streams the project
in 8 MiB chunks (bounded memory), integrity checks run in the main process, and
unsaved-change detection reads records and revision numbers, never pixels.

Not done (candidates for later work, not claimed here): enabling cross-origin isolation
for multi-threaded WebAssembly in AI enhancement, and a dedicated benchmark of individual
Raster tools on very large canvases (the repository's existing `bench:*` scripts cover
those engines in Node).
