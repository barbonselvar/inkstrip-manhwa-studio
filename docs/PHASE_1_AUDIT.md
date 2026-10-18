# Phase 1 — Project audit and architecture

Date: 2026-10-18. Scope: audit, baseline validation, and an implementation plan
only. No Phase 2 or later functionality has been implemented in this phase.

## 1. Repository and baseline

The required initial commands were run: `git status`, `git branch --show-current`,
`git log -5 --oneline`, and `git remote -v`.

- Existing branch: `main`; initial working tree: clean.
- Local starting commit: `e459bc7c1367925c5cc1c6222ff44ce13e17c8b8`.
- Freshly fetched GitHub main: `a910e3db97c89150ebdcf5da28348cbeef5ad93b`.
- Common ancestor: `edf608c177bc29872da8e25f0f1624852347691f`.
- The remote already contains the earlier studio upgrade under different commit
  IDs (`14be19f` and `84843da`), plus the ONNX range adjustment, generated-output
  cleanup, an extra Webpack workflow, and a merge. `git log --cherry-mark` confirms
  the studio upgrade is patch-equivalent; do not apply the old upgrade again.
- All `src/`, `scripts/`, `server/`, Vite, TypeScript, and Vercel configuration
  source is identical between local HEAD and this remote baseline. Differences
  are the dependency range (`1.22.0` versus `^1.22.0`, both locked to 1.22.0),
  extra Webpack workflow, ignore entries, and tracked local log/marker files.
- No histories were rewritten or merged here. The current remote was reconstructed
  separately for validation, preserving local main and the user's remote changes.

The intended **Phase 1 documentation patch base** is the newly verified remote
commit `a910e3db97c89150ebdcf5da28348cbeef5ad93b`, not the old export base. A phone's
unpublished HEAD cannot be inferred from GitHub: verify it using the accompanying
Termux guide. This patch must contain only the new Phase 1 documents.

## 2. Architecture map

| Concern              | Existing implementation                                                                                                     | Extension point                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Routing / SSR        | TanStack Start; file routes at `/`, `/p/$projectId/`, `/p/$projectId/c/$chapterId`; named `getRouter()` in `src/router.tsx` | Keep routes; mount a dedicated image editor from the chapter                                          |
| UI                   | React 19, Tailwind v4 CSS tokens in `src/styles.css`, Lucide, Radix modal, shared button/chrome                             | Reuse tokens and accessible primitives; full-screen mobile editor and desktop properties panel        |
| Project library      | `library.tsx`, `project-view.tsx`; create/rename/delete/search projects and chapters                                        | Preserve identifiers, navigation and existing actions                                                 |
| Chapter workspace    | `chapter-studio.tsx`; upload, paste/drop, selection, settings, order, Display, download                                     | Extract panel actions and gesture handling rather than expanding the component indefinitely           |
| Client state         | Zustand `src/lib/studio/store.ts`; one import/stitch job; selection and object-URL caches in memory                         | Separate editor draft/history from persisted accepted media; operation-aware queues later             |
| Persistence          | IndexedDB `inkstrip`, version 1, in `studio/db.ts`; projects/chapters/panels/blobs                                          | Add optional, versioned metadata before considering additive store migrations                         |
| Geometry / export    | `studio/plan.ts`, `images.ts`, `store.display()`, `downloadStrip()`                                                         | Shared geometry and accepted-revision renderer; explicit limits and output resolution                 |
| AI enhancement       | `enhance-dialog.tsx`, `studio/enhance/{client,worker,types,filters}.ts`                                                     | Keep worker-backed local provider; add capability selection / queue abstractions in an approved phase |
| Template integration | Auth/provider, preview bridge, auth/connector/multiplayer helpers; PWA Vite plugin and Nitro middleware                     | Preserve platform infrastructure; do not confuse the template SQL database with artwork storage       |
| Build                | Vite 8, React/Tailwind/Start plugins; Nitro Vercel preset; app-env wrapper                                                  | Preserve plugin gating, `serverDir`, port contracts, and `noExternals: ["tslib"]`                     |

Inspection covered root manifests/configuration, routes and studio components,
storage/export/worker code, server middleware, template helper entry points,
scripts/tests/workflows, migrations, existing documentation and tracked-file
inventory. It did not read credential values or private browser artwork.

Resolved versions used for baseline checks: React 19.3.0, TanStack Start 1.168.60,
Vite 8.3.4, Nitro 3.0.260610-beta, TypeScript 5.9.3, ONNX Runtime Web 1.22.0.
Node 24.19.0 / npm 11.9.0. Project engines permit Node 22.12+ in the 22 line or
Node 24. No dependency upgrades or application configuration edits were made.

## 3. Existing data and editing behavior

Projects and chapters are records, panels reference imported image blobs and
JPEG thumbnails, and stitched chapters reference separately encoded image parts.
All artwork is local to the browser origin/profile. Git, Termux source backups,
and Vercel do not back up that IndexedDB database. Changing domain/profile or
clearing site data can make a library inaccessible; no such action is proposed.

Panel fields `original` and `mediaUpdatedAt` are optional. AI application stores
current image/thumbnail plus the first imported original, and recovery restores
original bytes and dimensions. `commitPanelMedia()` checks the expected current
blob and writes media, metadata, and timestamps transactionally. There is no
persistent general editing recipe, revision log, named snapshot system, or
project archive export today. Selection is session-only. Undo/redo is absent.

Import accepts `image/*` and a broad extension list, including SVG, HEIC/TIFF and
other browser-dependent formats; decoding determines actual support. Thumbnails
are intentionally top-cropped; full source blobs remain intact. Image imports
and stitching currently perform canvas work on the UI thread, with yields.

Desktop HTML drag/drop is enabled for fine pointers. Move up/down buttons persist
order through `commitOrder()` and IndexedDB. Touch drag handles, drag auto-scroll,
reordering undo, image long-press/context menus, double-click editing, transforms,
manual crop, layers and general adjustment controls do not exist yet.

Display stitches at least two checked panels. Width presets are 640/800/1080;
spacing presets are 0/8/24; output is JPEG or PNG. Append merges the selection
with previously included panel IDs in current chapter order. Actual accepted
panel blobs feed stitching. The renderer fills a fixed paper background and
JPEG quality is 0.92; it can create multiple parts for canvas limits. Save
currently downloads existing parts individually, not a ZIP.

Reader metadata is in normal flow, with passive scroll observation and opacity
hysteresis. It does not cover the artwork. Upward scrolling restores its opacity,
but does not summon an off-screen metadata block to the viewport. Mobile tabs
and the panel action footer have their own sticky behavior.

## 4. Verified findings and development risks

These are existing conditions, not Phase 1 feature implementations. No baseline
install/type/build failure requires a source-code blocker fix before Phase 2.

| Priority                               | Evidence                                                                                                                                                                                                              | Required follow-up                                                                                                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High — unrelated failing CI            | Remote `.github/workflows/webpack.yml` calls `npx webpack`, but neither webpack nor webpack-cli is installed; it includes Node 18/20, outside the app's engines. Remote run failed, while Configuration checks passed | Consolidate around the working Vite workflow in a separately approved configuration change; do not install webpack to satisfy the wrong template                                                                                                                        |
| High — export commit ordering          | `store.display()` removes old strip blobs before committing replacement chapter metadata; `clearStrip()` similarly deletes before updating the chapter                                                                | Reuse a transaction spanning chapter/blob metadata and defer revocation/deletion until commit. A metadata-write failure could leave broken old strip references; originals are separately stored. This failure ordering was inspected, not fault-injected in this phase |
| High — compound edit semantics         | Enhancement explicitly starts from `panel.original?.blobId ?? panel.blobId`; later replacements remove the previous accepted non-original blobs                                                                       | Phase 2 must define edit provenance and retain any referenced revision. Re-enhancing from the imported original must not silently discard an accepted crop or transform                                                                                                 |
| High — mobile peak memory              | AI tiles inference, but still allocates full source/output/final/alpha canvases, image data and filter copies                                                                                                         | Budget the entire operation, not just tiles. At 4 MP input / 2× output, five 16 MP RGBA buffers alone are roughly 320 MB, excluding the model/runtime. This is a code-derived estimate, not a measured device peak                                                      |
| Medium — resolution reduction          | `planStrip()` reduces requested width toward 320 before splitting, and scales an individually tall panel to fit. A completion banner reports the resulting width                                                      | Offer explicit resolution-preserving multipart export with approval before downscaling; never label today's behavior lossless or fixed-resolution                                                                                                                       |
| Medium — stale export metadata         | Stale strips remain downloadable; filename extension uses current `chapter.format`, although stored strip bytes can use the previous format                                                                           | Use the stored strip format and require refresh/explicit acknowledgement before exporting stale results                                                                                                                                                                 |
| Medium — import safety                 | MIME/extension filtering and decoder checks, without a source-byte limit or pre-decode pixel budget                                                                                                                   | Add bounded validation without breaking access to already stored originals; avoid claiming every listed format works on Android                                                                                                                                         |
| Medium — session/resource management   | URLs are globally cached; `loadMedia()` has no generation token; UI library timestamps are not refreshed by media replacement although DB timestamps are written                                                      | Add bounded/revocable media ownership, race protection and consistent in-memory timestamp updates while extending storage                                                                                                                                               |
| Medium — batch failures                | Current enhancement stops the remaining batch on first processing error, retains completed previews and reports partial saves; retry regenerates the batch                                                            | Add item states, retry-failed and continue-on-error in the AI infrastructure/workflow phases                                                                                                                                                                            |
| Medium — model cache / failure cleanup | Cache open/write failures are handled, but match/delete failures are not uniformly optional; a failed worker resets its model promise without explicitly releasing that session                                       | Add cache-status/clear/retry controls, predictable session disposal and resource tests in the infrastructure work                                                                                                                                                       |
| Medium — runtime compatibility         | WebAssembly only, fixed 64px tile cores plus 8px overlap, one thread; no capability panel or WebGPU path. Runtime imports internal loader filenames while the remote manifest allows a version range                  | Keep the lockfile, validate asset packaging, and add capability-tested providers; do not promise GPU acceleration from an NVIDIA card or `navigator.gpu` alone                                                                                                          |
| Medium — incomplete coverage           | Core math/planner/order/export and gesture/history behavior lack focused tests. Browser integration uses tiny synthetic AI images                                                                                     | Add pure geometry/storage tests and meaningful fixture-based mobile/desktop editor checks before each feature phase                                                                                                                                                     |
| Low — test portability                 | Several wrapper tests depend on the tracked `.grok/app-env.json` preview flag; smoke scripts assume `/workspace` for outputs/branding                                                                                 | Preserve real flags during baseline tests, document tooling assumptions, and avoid false branding failures in nested checkouts                                                                                                                                          |

Remote CI evidence at this baseline:

- [Configuration checks: success](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/39159637848)
- [NodeJS with Webpack: failure](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/39159637814)

## 5. Existing AI: what is real and what is not

| Item                | Verified architecture / limitation                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Super-resolution    | Real FP32 Swin2SR ONNX inference, `Xenova/swin2SR-classical-sr-x2-64`, revision `93dfc9089abda257351d3a58d5771e2c1ff69442`                                                                                                                                                                             |
| Execution           | Browser worker, ONNX Runtime Web 1.22.0, WASM SIMD with one thread; original-size or 2× result; no cloud upload/API key                                                                                                                                                                                |
| Supporting controls | Edge-aware smoothing for noise/artifacts, bounded sharpening and optional saturation boost are traditional pixel filters, not separate learned models                                                                                                                                                  |
| Download/cache      | Approximately 54.4 MB model (51.9 MiB) and 11.2 MB runtime; model Cache API storage is optional; weights reused within one worker/batch, which is terminated after the run                                                                                                                             |
| Limits              | 4 MP input, max source side 4096px, 12 images / 8 MP input per batch; several minutes on slower phones; extremely tall originals are rejected rather than cropped by AI                                                                                                                                |
| Preservation        | Source geometry and transparency are retained, but reconstructed fine lettering/faces are not guaranteed identical. Review and recover-original controls are necessary                                                                                                                                 |
| Licenses            | ONNX Runtime Web package is MIT. Upstream Swin2SR repository and the caidas source model card specify Apache-2.0. The pinned Xenova conversion card points to that source but declares no separate license; retain attribution and confirm derivative/distribution obligations before bundling weights |
| Not implemented     | Inpainting/object removal, segmentation, illustrated face detection, identity embeddings, reference-conditioned Face Fix, character library, WebGPU modes                                                                                                                                              |

License/source evidence inspected: [pinned conversion card](https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64/blob/93dfc9089abda257351d3a58d5771e2c1ff69442/README.md),
[upstream source model](https://huggingface.co/caidas/swin2SR-classical-sr-x2-64),
[upstream license](https://github.com/mv-lab/swin2sr/blob/main/LICENSE).

Future inpainting and identity editing must use a validated, legally suitable
model/provider. None is selected or represented as working here. A CPU browser
is not assumed capable of efficient generative editing. Face-recognition quality
on photographs does not establish character matching quality on manhwa.

## 6. Architecture decisions for the next approved phases

1. **Keep existing state and storage.** Use `useStudio` for accepted project
   state, and an isolated editor session for drafts. Keep original blob IDs
   immutable, with optimistic revision checks during writes.
2. **Use serializable edit recipes.** Plan a versioned optional panel edit
   descriptor: source/revision ID, crop in source coordinates, flips, rotation,
   output dimensions, adjustment parameters and accepted generated-layer IDs.
   Geometry remains separate from viewport zoom/pan and chapter layout offsets.
   No types, migration, or editor code are added in Phase 1.
3. **Avoid destructive migrations.** Start with optional fields in existing v1
   records when feasible. If later revisions/masks/characters require stores,
   design an additive upgrade and explicit old-client compatibility policy;
   today's fixed `indexedDB.open(..., 1)` would reject a newer database version.
   Never reset the database. Test seeded old projects and quota-aborted upgrades.
4. **One rendering contract.** Share transform geometry between reduced preview
   and full-resolution commit/export. Draft sliders must not repeatedly encode
   JPEGs. Keep an original/accepted base, render a bounded preview, encode only
   on acceptance. Use lossless PNG internally where appropriate, with explicit
   format/quality selection at export.
5. **Operation history, not full bitmap history.** Bounded undo/redo over draft
   recipes, latest-request-wins rendering, reset-tool/reset-all, and explicit
   save/cancel/recover-original actions. Referenced accepted revisions cannot
   be deleted by generic replacement cleanup.
6. **A shared mask coordinate system.** Reuse source-normalized brush/lasso/
   circle masks across future eraser and Face Fix tools; invert viewport/crop
   transforms correctly. Never label an ellipse or rectangle automatic
   segmentation. Keep masks as lossless blobs when persisted.
7. **Explicit local/cloud providers.** Future provider operations should expose
   capabilities, supported dimensions, create/run/status/cancel and typed
   progress/results/errors. Default local. Cloud requires an explicit artwork
   upload choice, server-only credentials, access/cost controls, validated
   image/mask/reference inputs and asynchronous GPU-job polling. Never add an
   unprotected paid endpoint or perform long GPU work inside Vercel requests.
8. **Mask-bounded compositing.** Inpainting/face-provider results must be blended
   only into the confirmed target mask; pixels outside the allowed area come
   from the accepted source. Reference characters remain project-scoped and
   user-confirmed; similarity must never silently merge identities.
9. **Adaptive performance.** Probe usable adapters/providers and treat memory/
   core counts as hints. Add GPU support with the appropriate ORT bundle,
   loader and validated kernels, then WASM fallback. Budget decoded pixels,
   canvases, mask layers, queues and retained previews together.
10. **Preserve deployment boundaries.** Browser editor code must not import
    server credentials, SQL clients or Node APIs. Keep the existing Nitro
    preset, server directory, PWA/preview hooks, `tslib` setting and app-env
    wrapper. No server persistence is required for local editing.

## 7. Approval-gated implementation roadmap

The later incremental roadmap in the user's instructions controls the phase
numbers below; it supersedes the earlier all-at-once phase list.

| Phase          | Focused deliverable                                                                                                                                                                                             | Completion gates before asking for approval                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (this phase) | Architecture audit, baseline tests, dependency/data risks and practical plan                                                                                                                                    | Documentation only; validated patch; stop                                                                                                                                                                                                                         |
| 2              | Individual image editor, explicit edit action, mobile long-press, desktop context/double-click/keyboard, zoom/pan, resize, crop presets, rotate/flip, session undo/redo, compare, save/cancel/original recovery | Gesture motion threshold/pointercancel tests; pure crop/rotation/scale math; preview/export parity; reload and quota rollback; no accidental reorder or scroll blocking; existing enhancement still works                                                         |
| 3              | Brightness/contrast/saturation/exposure/temperature and further tested adjustments, brush/eraser/selective tools, alignment and manhwa presets                                                                  | Color/alpha edge fixtures, preview cancellation, reset-tool and history tests, small preview renders, no per-slider JPEG recompression                                                                                                                            |
| 4              | Genuine AI Object Eraser with brush/lasso/circle masks, correction, preview/retry/accept                                                                                                                        | First research/license/quality/performance review; explain cost/privacy/deployment and get approval before a credentialed provider integration. Test mask transforms, cancel, unsupported state and preservation outside mask; no blur/fill claimed as inpainting |
| 5              | Automatic/manual illustrated face selection and multiple selectable regions                                                                                                                                     | Validate a licensed detector/segmenter against licensed or user-approved illustrated examples, profiles and occlusions; manual corrections always available; unsupported detection honest                                                                         |
| 6              | AI Face Fix: reference/targets, manual identity confirmation, reference-conditioned correction, compare/reject/retry, controlled multi-target jobs                                                              | Provider-specific quality/cost approval; preserve pose/expression/composition by confirmed masks; distinguish characters; no claim of perfect identity or generic embedding suitability                                                                           |
| 7              | Desktop/touch handle reorder, insertion feedback, auto-scroll, accessibility moves, persistence and undo                                                                                                        | Move 1→3 test, refresh/reopen, export-order verification, long-press editing conflict tests; transactional order updates                                                                                                                                          |
| 8              | Character library, reusable presets, batch/retry queue, recovery, shortcuts, navigation, cache/performance controls; then prioritized split/merge, spacing and advanced export                                  | Project isolation; additive storage compatibility; batch partial-failure/retry/cancel; lossless split/merge; explicit tall-export limits; ZIP/individual/WebP/quality tests when implemented                                                                      |

Each phase ends with install/TypeScript/lint/relevant tests/build and a focused
commit/patch. The next phase starts only after an explicit YES. Speech-bubble
cleanup must reuse real inpainting; higher upscales require a suitable model,
not relabelled interpolation. Extra advanced features are not automatically
included in Phase 2.

## 8. Baseline test record

Checks executed on an isolated snapshot of remote main `a910e3d`, using its
manifest, lockfile and tracked preview flag carrier. Local application source
was not changed.

| Check                                                  | Actual outcome                                                                                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm install --no-audit --no-fund`                     | Pass; 441 packages; existing Recharts 2 / ESLint 9 deprecation notices                                                                                                                                             |
| `npm run typecheck`                                    | Pass for app/server and Vite config                                                                                                                                                                                |
| `npm run lint`                                         | Pass; zero errors; one pre-existing Fast Refresh warning in `src/components/ui/button.tsx:25`                                                                                                                      |
| `npm test`                                             | Pass: 198 script + 59 TypeScript + 6 studio tests = 263                                                                                                                                                            |
| `npm run build`                                        | Pass; Vercel output generated; migrator skipped with no configured database URL; existing third-party `use client` warnings                                                                                        |
| `npm run check:build`                                  | Pass: Vercel server/runtime, browser assets, worker/WASM/loader, PWA icon and bundled tslib                                                                                                                        |
| `npm ls webpack webpack-cli --depth=0`                 | Empty, exit 1; confirms Webpack workflow does not match declared tooling                                                                                                                                           |
| `node scripts/brand-check.mjs --root <snapshot>`       | Pass, zero warnings                                                                                                                                                                                                |
| Production website read                                | HTTP 200; not a deployment verification or physical-device test                                                                                                                                                    |
| `npm run test:studio:browser -- http://127.0.0.1:8081` | Pass on the current remote production build: import/stitch, scroll behavior, actual ONNX inference, comparison, quota rollback, apply/reload/byte-exact recovery, cancellation, batch recovery and mobile overflow |
| Desktop/mobile browser smoke                           | Pass at 1280×800 and 390×844 in dev and built preview: HTTP 200, visible content, no console/page errors, no horizontal overflow, no baseline divergence; screenshots inspected                                    |
| Documentation patch                                    | Export only this phase; validate with `git am --3way` in a clean isolated checkout of a910e3d; final response reports the result                                                                                   |

The first deliberately filtered snapshot omitted the tracked app-env flag
carrier, causing four wrapper/invariant tests to fail. Restoring the exact
tracked file in that isolated copy (without printing its values) made all tests
pass. This was snapshot fidelity, not an application-source fix. No original
environment file was changed and no environment file belongs in the patch.

The smoke helper emits a branding note because its default filesystem root is
`/workspace`, whereas this checkout is nested. The explicit-root brand check
passes and the actual custom OG asset remains present. No branding was changed.

Fresh browser tests use isolated profiles/synthetic artwork, not existing user
libraries. Desktop/mobile emulation is not physical Android validation. The
browser CLI is absent in this environment, so the existing Playwright checks
are used. A successful small-image inference does not prove quality on real
manhwa lettering/faces or memory safety at maximum resolution.

## 9. Phase boundary and manual review

No source, dependency, deployment, environment or database changes were needed
for this audit. Modified files for Phase 1 are only this document and
`docs/TERMUX_PHASE_1.md`. There are no new secrets, providers or environment
variables. No push, PR, deployment, force operation or existing history rewrite.

To manually review Phase 1: read the architecture map and prioritized risks,
verify your local Git base against the Termux guide, and choose whether the
Phase 2 scope and storage safeguards are correct. Existing behavior can be
checked in a separate browser profile with a disposable project: import two
images, reorder with arrows, Display/export, and compare/recover AI enhancement.
Do not clear your usual browser's site data to run an audit.

Approval question to be asked after this phase only:

“Phase 1 is complete. Would you like me to continue to Phase 2? Reply YES to continue, or tell me what you want changed.”
