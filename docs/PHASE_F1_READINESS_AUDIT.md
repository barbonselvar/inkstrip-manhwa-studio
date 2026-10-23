# Phase F1 independent readiness audit — 2026-10-23

Scope: existing Draft PR [#6](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/6),
`codex/phase-f-ai-studio`. Starting HEAD `d1e82c2aabc80d141111f6cd0aee8516d1277fc6`;
main and merge base `71a29e2f01869a82a4b6a81818fb56441cb93c3f`.
The complete 31-file F1 diff, shared editor architecture, native asset reachability,
model manifests, worker, connector, tests and both workflows were reviewed.
No dependencies or lockfile changes were introduced by F1 or this audit.

## Findings and corrections

| ID | Severity | Evidence and root cause | Correction / remaining risk |
|---|---|---|---|
| F1-01 | High | Native import validates metadata/MIME/references, then swaps session/history before a worker decodes embedded bytes. Reproduction: replace exported PNG bytes with `AQID`; the UI reports import success and exports the corrupt replacement document. Undo is available, but the draft can autosave the unusable replacement. | `native-images.ts` reads bounded PNG/JPEG/WebP headers, enforces actual pixel budgets, sequentially decodes/closes every asset before the workspace commits. Browser checks cover malformed headers, truncated payloads, missing references, invalid opacity and future envelopes, asserting exact unchanged document metadata. JPEG headers beyond 1 MiB fail explicitly. |
| F1-02 | High | Pro IndexedDB remains version1 despite changed AI compositing and asset references. Main's pre-F1 `nativeFile` accepts the loaded document, keeps `layer.ai` but omits its captured source asset and emits envelope1. Reopening fails: “The AI result's immutable input is missing.” Cached pre-F1 tabs could corrupt exports of upgraded drafts. | Raise the Pro database version to2, retaining the existing store and records. Pre-F1 clients explicitly opening version1 receive `VersionError`. Versionchange closes current connections; a blocked upgrade reports close-other-tab guidance and closes a late open. Browser migration tests seed a real v1 record, verify retention and old-client refusal. Native envelopes remain v1–v6; no Chapter DB changes. Old tabs must export unsaved legacy work and reload; do not delete browser storage. |
| F1-03 | Medium | GPU origin/auth/consent edits did not invalidate the pending request. Its late `.then(setGpu)` could label an old server as the new connection. | Abort/invalidate on connection-setting changes, revocation, cancellation and disconnect; only the current request may update state. Browser transport test delays the old response, edits the origin, and verifies it never appears. No artwork/job support added. |
| F1-04 | Medium | Every completed UI preview terminates its worker, discarding ORT/model session. Baseline real 36×36 run: 28.57s cold, 3.63s same-session warm; roughly22.5s lies between engine-preparation and inference progress. | Retain one worker for up to60s idle, reset idle deadline on Generate, terminate on Cancel/unmount, reject reentrant Generate. Add optional worker stage timings without changing pixels or persisted receipts. No quality reduction, threading change, new model or GPU execution. |
| F1-05 | High | JPEG export changes the document background to white before layer compositing. For an original half-alpha solid plus a half-alpha AI overlay, PNG flattens to `[197,162,177]`, but the old JPEG is `[182,108,133]` (maximum channel error54). White changes the preserve-alpha operation itself. | Keep the editable composite background unchanged; apply the JPEG matte after composition (including artboard/full-canvas paths). A real worker/codec pixel test now compares JPEG against flattened PNG, plus WebP alpha. This also preserves backdrop-dependent layer colors at transparent edges. |

An additional acceptance guard refuses results after the workspace unmounts. Existing
snapshot/document/Chapter/revision guards, immutable assets and single history commit
are retained. No confirmed Critical issue was found. None of these corrections
replace an engine, add a proxy, or implement F2.

## Native persistence and result integrity

Generated representative feature fixtures exercise envelopes1–6: legacy raster;
compound holes; artboards; appearance stacks; v5 masks; and v6 AI receipts/sources.
Tests compare restored metadata and asset bytes, verify eight AI import/save cycles,
source-ID remapping and deduplication, and reject missing sources, secret/invalid
receipt metadata, malformed JSON, unsupported future versions and oversized files.
Existing file tests retain original/hidden/clone/mask assets across25 legacy cycles.
Native files intentionally store the current editable state, not the Undo timeline.
Undo/Redo is session-local; acceptance/import each create one history entry.

Real browser inference checks stage a preview without mutation; edit/Undo stale
rejection; explicitly accept; compare original layers, masks, selection and Chapter;
Undo/Redo; save, close, reopen the draft; import the actual exported v6 file; compare
PNG pixels and remapped source bytes/provenance; and decode JPEG/WebP exports.
The new preflight runs before any current-session mutation, so corrupt partial imports
cannot overwrite the open draft. Existing IndexedDB revision/CAS conflict and chapter
failure tests remain in the full browser regression suite. Power failure at the OS or
physical storage level is not simulated; IndexedDB transaction guarantees still apply.

## Inference, licenses and security

Only existing Swin2SR neural restoration is executable; there is no generative
inpainting/face/hands/background implementation. Pinned revision
`93dfc9089abda257351d3a58d5771e2c1ff69442`, 54,428,699-byte ONNX checkpoint,
SHA-256 `6dde3fe2440543ccae7c40d175609f83c18aeaa3d8456745c4329ef97ae744bd`.
The actual worker verifies both size and SHA-256 before ONNX Runtime Web1.22.0
WASM inference, including cached weights. Tests may route exact hash-verified weights
from a local download; no inferred output is mocked. ORT is MIT; upstream Swin2SR
code/base model card is Apache-2.0. The ONNX derivative has no separate LICENSE;
its upstream-base attribution and limitations remain documented in
[model qualification](AI_MODEL_QUALIFICATION.md). No new model is enabled.

GPU discovery is browser-direct HTTPS GET, public-origin syntax checks, port443,
no redirects/cookies/referrer/body, bounded credential/response/schema, ten-second
fetch/body deadline and explicit consent. Tokens are volatile component state and
are cleared on disconnect/unmount, never persisted into a document or browser storage.
React renders capability strings as text and drops server-supplied executable/URL
fields. There is no backend SSRF proxy or privileged credential. Browser DNS cannot
be pinned: a public hostname can resolve to private space; CORS/private-network
browser policy and endpoint trust remain necessary. This is a documented browser
boundary, not a guarantee of IP-level isolation. Discovery tests use mocked HTTP
responses only; no external GPU inference, artwork upload or retention claim.

`npm audit --json` reported zero known advisories (493 dependency entries, including
optional/dev entries) on the audit date. This is advisory coverage, not a guarantee
of absence of vulnerabilities. Both CI workflows use their existing checkout/setup
versions and run type/build/config gates; Configuration checks also run lint/unit.
Chromium/model quality checks are local evidence, not falsely counted as CI jobs.

## Performance methodology

Baseline: actual pre-fix worker at36×36, one cold and one same-session warm run;
[raw baseline](benchmarks/phase-f1-audit-baseline-profile.json). Final profiling uses
built worker code sequentially at64×64 on five original procedural illustration
categories, including a repeated identical input in the same session. Optional
telemetry separates model retrieval, integrity hashing, bundled WASM retrieval,
session creation, input conversion, actual `session.run`, reconstruction and PNG
encoding. ORT WASM startup and graph initialization both happen inside
`InferenceSession.create`; they cannot be independently separated by the public API
used here and are explicitly reported together. UI snapshot/mask/compositing/render
latency is included in the separate real-UI Generate→preview wall measurement.

Host: Linux x86_64 / AMD EPYC9V74;3 visible virtual CPUs but current cgroup quota
**2 CPU equivalents** (`200000/100000`),8GiB memory limit;Node24.19.0;
Chromium156.0.8078.4;ORT1.22.0,single-thread WASM SIMD. No provided usable GPU.
Local checkpoint transport excludes Internet download performance. JS heap snapshots
exclude WASM/native/GPU/process memory and are not peak memory. Shared-host timing
is observational; do not extrapolate to Android or larger regions. Full4MP context
inference is not benchmarked and can remain very slow. Smaller selected regions
retain native coordinates; unsupported contexts fail without reducing resolution.

## Validation and limitations

Final commands, exact counts and measured results are recorded below after the audit
runs finish. Synthetic illustration fixtures are original, rights-cleared QA drawings;
they do not constitute character identity or aesthetic quality approval. Physical
Android, external GPU, large-region throughput and manual representative production
art review remain unverified. No paid model/service, secret/environment change,
merge, undrafting, production deployment or F2 start is permitted by this audit.

## Final measurements and validation record

The controlled compute run excludes local dynamic compression: identity-encoded
bundled runtime on loopback, exact pinned model transport, no competing browser QA,
and an isolated document rather than the animated homepage. This is a compute/cache
benchmark, **not** an Internet first-download or production CDN benchmark.

|64×64 same-input worker phase|Cold session|Reused session|
|---|---:|---:|
|Model retrieval from QA transport|1191.1ms|0ms|
|Checkpoint integrity|56.2ms|0ms|
|Bundled WASM retrieval|81.3ms|0ms|
|ORT/WASM startup + graph/session initialization|8877.8ms|0ms|
|Input conversion/preprocessing|2.4ms|1.5ms|
|Actual neural inference|6472.8ms|6303.1ms|
|Reconstruction/alpha/finishing|4.1ms|1.6ms|
|PNG encoding|0.9ms|0.7ms|
|Worker result wall time|16.71s|6.31s|

The repeated output PNG is byte-identical. Other warm64×64 fixtures take6.57–6.82s;
each preserves alpha and output dimensions. Recorded changed RGB pixel counts are
1940,1292,2196,1292,2651, not subjective quality scores. Portrait/hatching before/after
images were visually inspected; these simple synthetic drawings do not validate
production character identity or hair/anatomy quality. Full source-resolution UI
snapshot, mask compositing and React commit are included in UI wall times, not
individually instrumented. Do not infer their separate durations by subtracting
measurements from different runs.

The corresponding36×36 UI test with normal QA compression recorded38.19s cold and
2.90s warm; identity transport recorded18.68s cold and2.93s warm while other
non-inference QA ran. Both confirm actual worker reuse. The final390px UI case uses
a **non-zero**48×48 processing context at(28,16) to test reconstruction alignment,
in addition to the two36×36 boundary/partial-alpha cases. Raw final UI metrics are
stored separately from the earlier isolated UI observation.

Memory: controlled worker profile sampled the **entire shared cgroup** every500ms
(101 observations): first2,770,497,536 bytes, maximum observed2,782,212,096 bytes,
last2,595,160,064 bytes. This includes browsers, Node model cache, preview/dev servers
and page cache; it is neither model memory nor a guaranteed peak. Window JS heap
observation10MB excludes worker/WASM/native allocations. No VRAM or Android peak
memory was measured.

### Investigated failures, not hidden

1. Parallel cold neural checks timed out loading the bundled WASM. Direct HTTP
   testing isolated local Nitro preview's on-demand Brotli:11.2MB takes0.05s with
   identity encoding but29.43s with Brotli (1.84MB transferred). Concurrent cold
   transfers can exceed the existing60s loader deadline. The raw Brotli/animated
   and identity profiles and transport evidence are retained. The two neural QA
   scripts accept explicit `INKSTRIP_QA_IDENTITY_ENCODING=1`; it changes test
   transport only. No loader deadline, image quality or assertion was relaxed.
2. The enhanced reopen test previously clicked Close then immediately reloaded,
   interrupting the asynchronous close-save. It now waits for actual dismissal
   and asserts the saved IndexedDB document **before** navigation, then retains the
   exact native reopen comparison. IndexedDB preserves IEEE negative zero while
   JSON serializes it as zero; the additional cross-medium assertion compares
   canonical JSON, preserving every field. This strengthens the lifecycle test;
   it does not discard geometry or relax pixel comparisons.
3. Real EXIF orientation6 JPEG decoding revealed Chromium honors orientation even
   when `imageOrientation:none` is requested. Preflight accepts the safe axis swap
   for JPEG only, with unchanged side/area budgets. Unit and five-viewport browser
   codec imports cover this; other dimension disagreement still fails atomically.

### Commands and outcomes

- `npm run typecheck` — passed, both app and config TypeScript projects.
- `npm run lint` — passed, zero errors; one existing fast-refresh warning at
  `src/components/ui/button.tsx:25` remains unchanged.
- `npm test` — **699 passed**,0failed/0skipped/0cancelled:200scripts+59shared+
  40Studio+400Pro. Baseline F1 was691; eight regression tests were added.
- `npm run build` — passed, Vercel preset. Database migration reports skipped
  because DATABASE_URL is absent; this app's existing local/PGlite fallback applies.
- `npm run check:build`, `npm run check:auth` — passed; runtime/server/config assets
  verified and dev/build sign-in setting agrees.
- `npm audit --json` —0known advisories at audit time; no new dependencies.
- All19existing Chromium command suites passed on the final app build: `studio`,
  `editor`, `adjustments`, `retouch`, `workflow`, `ui`, `pro`, `layers`, `repair`,
  `geometry`, `transform`, `color`, `appearance`, `raster-refinement`, `vector`,
  `compound`, `pathfinder`, `artboards`, `vector-final` via
  `npm run test:<name>:browser -- http://127.0.0.1:8081`. The repeated `studio`
  run used the explicit identity-encoding flag after the disclosed host timeout.
- `npm run test:ai-studio:audit -- http://127.0.0.1:8081` — passed at320,360,390,
  768,1440px: storage migration/old-reader refusal; five atomic bad-import cases;
  actual JPEG/WebP/EXIF codec imports; late discovery invalidation; orientation,
  mode switching and cancellation. A correctly sized, deliberately corrupted
  checkpoint is rejected, evicted and its worker immediately released.
- `npm run test:ai-studio:exports -- http://127.0.0.1:8081` — passed: actual
  PNG/JPEG/WebP codecs; JPEG error≤1channel level versus correctly flattened PNG;
  alpha128 retained by WebP; AI visibility/opacity/Multiply/masks/translations.
- `INKSTRIP_QA_IDENTITY_ENCODING=1 INKSTRIP_QA_MODEL_CACHE=/workspace/f1-model.onnx
  npm run test:ai-studio:browser -- http://127.0.0.1:8081` — final result recorded
  in the final validation summary below. This runs actual neural inference, not
  a model mock; GPU discovery alone uses HTTP doubles.
- `INKSTRIP_QA_MODEL_CACHE=/workspace/f1-model.onnx npm run bench:ai-studio --
  http://127.0.0.1:8081` — six actual inference runs (five original categories,
  repeated same input), all alpha/dimension/identical-warm assertions passed.
- Dev/built `node scripts/browser-smoke.mjs ... --ready-selector
  'body:has(button:has-text("New project")):has(canvas)'` — visible desktop/mobile
  render and clean error arrays; built uses `--baseline` with the dev JSON. Existing
  generic game-brand classifier warnings are unrelated to this canvas editor;
  branding/3D implementation was not modified. Playwright was used because
  `agent-browser` is unavailable.

Desktop and browser-emulated mobile coverage is real Chromium156.0.8078.4. Existing
suites exercise native CDP touch at320/390px; the new audit adds responsive controls
and orientation checks across five widths. No physical Android, external GPU job,
manual production-art identity approval,4MP inference throughput or OS power-loss
test is claimed. Restoration layers preserve existing alpha coverage; moving them
over empty canvas does not create new coverage. Native files preserve editable
state/assets/provenance, not the session's Undo timeline. Phase F2 remains absent.

## Final disposition

**READY FOR USER REVIEW** — no known unresolved Critical or High findings after the
fixes and final regression runs. Product fixes/regressions are committed as
`d858b0615993f83b5fadae662137a2ec9372d9e3`; the following evidence commit changes
documentation/fixtures only. Exact final HEAD and GitHub checks are visible on Draft
PR #6; GitHub confirmed the fixes were pushed to the existing branch.

All **22 Chromium command suites** pass (19 existing + AI Studio + audit + AI export).
The final AI run passes at1440/320/390px, including the actual close transaction,
saved-record comparison, reload, native v6 file import and non-zero context. Each
case protects12,032 pixels with maximum error0 and alpha changes0; changed selected
pixels32/32/53. Final UI measurements:13.87s cold /2.38s warm desktop36×36,
16.89s cold320px36×36,14.23s cold390px48×48 at(28,16). These shared CPU/WASM
observations exclude local preview's Brotli cost and do not predict phone/WAN speed.
There are0page/console errors and0external artwork uploads. GPU responses alone
are mocked; every neural result was produced by the actual verified checkpoint.
See `benchmarks/phase-f1-audit-validation.json`, `phase-f1-audit-ai-browser.json`
and the raw profile/transport evidence for commands, cases and disclosed retries.

Main remains `71a29e2f01869a82a4b6a81818fb56441cb93c3f`. No main write, merge,
undrafting, production deployment, production environment change or F2 work was
performed. The repository's existing branch-preview integration may run on push;
no Vercel deployment action was invoked. CLI GitHub API authentication expired
(HTTP401), while Git push and the connected GitHub app remained available; the
connected app is used for PR/CI reporting rather than exposing or replacing tokens.

Release ready for review. Awaiting explicit user approval before merge, production
deployment, or starting the next release.
