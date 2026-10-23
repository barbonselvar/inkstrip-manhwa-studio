# Phase F1 — AI Studio foundation and integration

Status: implementation under validation; **not merged or deployed**. User approval
is required before merge, production deployment, or F2. Generative editing is not
implemented or claimed by F1.

## Audit and dependency-aware plan

Verified base main: `71a29e2f01869a82a4b6a81818fb56441cb93c3f` (PR #5 cleanup).
The existing Phase F scaffold `b918ea271de595f3137d0fdc308d13ad24524d4c` contained
four documentation changes and no executable AI Studio. It was synchronized with
main by a normal merge, retaining both histories and PR #5's removed entry points.

Reuse:
- `ProWorkspace`, the same session, layer IDs, selection/mask frames, source pool,
  render worker, history, Chapter expected-image checks and native import/export.
- Existing Swin2SR `EnhancementEngine` worker and ONNX Runtime Web WASM backend.
  Existing Chapter 2× enhancement, image tools and optional paid Face Fix remain
  unchanged entry points. F1 never calls the paid adapter.
- Native envelopes 1–5 remain readable. F1 needs an additive envelope 6 because
  older readers must reject unsupported AI compositing/provenance safely.
- Existing responsive inspector, theme, controls, canvas selection, touch zoom/pan.

Missing before F1: a dedicated AI editing view, staging/approval, result provenance,
model capability registry, connector contracts/security tests and benchmark process.
Missing after F1: qualified generative inpainting, face/hands repair, background
editing, GPU job execution, new upscalers and complete illustrated-art qualification.

Implementation order and measurable gates:
1. Registry/license evidence + bounded contracts/region planner. Unqualified models
   cannot execute; no model code or artifact URL is accepted from documents/servers.
2. Immutable source/provenance and atomic result insertion. Preserve every existing
   layer and mask; one Undo removes an accepted result and Redo restores it.
3. AI Studio in the shared editor, Chapter and per-image entry points, Simple and
   Advanced settings, real local preview, cancellation, explicit Accept/Discard.
4. Native v6 round trips/import ID remapping. Read legacy v1–v5 without flattening.
5. GPU discovery/security and repeatable real-model/pixel/browser benchmarks.
6. Full existing regression gates; review report and explicit approval checkpoint.

## Implemented behavior

AI Studio is a dedicated shared-workspace view, not a second graphics engine.
Chapter entry recovers the same layered project as Raster/Vector. Switching views
keeps its session and document. The AI panel remains mounted while switching tabs
or collapsing the inspector, so settings/previews survive. Closing the workspace
cancels active AI/network jobs and clears ephemeral credentials; accepted layers
persist independently in normal native projects.

F1's executable task is **Gentle detail restoration**, using the existing pinned
Swin2SR graph. It runs the existing 2× network and returns a 1× restoration at the
current source resolution. Chapter Enhance remains available for 2× output.
Advanced settings expose only supported denoise/sharpen and optional traditional
artifact/color finishing. Default settings disable these traditional filters.
Prompts, seeds, diffusion steps, reference images and anatomy controls are absent
because this checkpoint does not support them. Simple/Advanced share one engine.

A selection's real native coverage determines its bounding region, with a clipped
16px context halo. Whole-image operation uses the full native frame. Layer masks,
groups and adjustments are included by the existing renderer. Crop/output resize
are not baked into AI source coordinates. The result is placed back at the exact
region X/Y with an editable copy of the source selection as its layer mask.

The source snapshot and generated PNG are immutable pool assets. Source snapshots
use SHA-256-derived IDs and are referenced once in portable documents; history-only
assets are not exported. No model weights, tensor caches, endpoint credentials or
GPU endpoint settings enter native files. Receipts record model/revision/checksum,
backend, supported settings, source dimensions/snapshot/hash, selection, region,
creation time and measured latency. PNG/JPEG/WebP exports contain rendered pixels,
not receipt metadata. Native exports intentionally retain editability/provenance.

Restoration layers are color overlays: source-atop color blending preserves the
underlying composite alpha, including transparent and partially transparent edges.
Visibility, opacity, blend, transforms, masks, ordering, duplication, deletion and
history reuse normal raster layer controls. They cannot create new alpha coverage;
that would require a distinct qualified generative result representation. Moving
one over empty space therefore does not introduce new opaque pixels. This behavior
is intentional and persisted by the AI receipt, not an unlabelled source-over layer.

Preview shows the same masked/alpha-preserving color operation before Accept.
Failed, cancelled or rejected jobs leave the document/Chapter unchanged. Acceptance
checks the complete immutable document snapshot, current Chapter blob and stored
session revision; changed documents or concurrent saves require regenerating/reopening.
Source/output bytes, image dimensions, native/source budgets and metadata are
validated before insertion. Accepted results can be reopened with no network/model
connection. Receipt settings support future replay; a same-source replay UI is not
implemented in F1, and byte-identical cross-runtime replay is not promised.

## Resource and security boundaries

- One inference job per workspace. Downloads have pinned size/hash checks; the
  optional model cache is untrusted and reverified. Worker termination cancels
  download/inference. Temporary canvases/bitmaps and preview URLs are released.
- Model context ≤4 MP /4096px side; existing document ≤16.8 MP/16384px side,
  coarse/mobile device budget ≤4 MP. Native/source/48-layer/48 MB asset/70 MB
  portable limits remain enforced. No source resolution is silently reduced.
- Existing non-generative Swin2SR overlapping contextual tiles are reused.
  Generic scene-consistent generative tiling is **not** implemented in F1.
- Selection context supports a smaller local inference region, but creating its
  snapshot still composites the full document. This is bounded foundation work,
  not a tiled 100-megapixel editor. Large-document/GPU planning remains F2/F5 work.
- No new backend proxy or GPU server is provisioned. The browser can explicitly
  request capabilities from a public HTTPS origin. Consent precedes a GET and
  optional bearer credential; no artwork/mask/prompt is sent. Tokens live only
  in workspace memory. Redirects, credentials in URLs, private IP literals,
  localhost/LAN suffixes, oversized/HTML/invalid responses are rejected.
- Browser CORS/PNA still governs DNS-resolved destinations. Browser-only origin
  checks are not DNS pinning. No privileged server performs these fetches, so this
  is not a backend SSRF surface. Private/LAN connectors require separate review.
- Discovery is not execution authorization or license/quality qualification.
  Server-supplied model URLs and unknown response fields are ignored. There is no
  F1 image upload/job submission path. See `AI_GPU_PROTOCOL.md` for future jobs.

## Benchmark and quality policy

`scripts/ai-studio-browser-check.mjs` runs genuine ONNX inference. An optional
`INKSTRIP_QA_MODEL_CACHE` points to a hash-verified copy of the official artifact;
this changes only download transport, never model outputs. GPU capability HTTP
responses in this suite are mocks and are **not** proof of GPU/model execution.

The internally generated RGBA geometry/color/alpha fixture exercises low-resolution
restoration, semi-transparent edges, exact protected pixels, masks and coordinates.
It is not evidence of face identity, anatomical correctness or manga aesthetics.
`integrityMetrics` reports measured channel change, changed/alpha pixels and maximum
protected-pixel error; these are integrity measurements, not subjective quality scores.
Browser reports record environment, exact graph, dimensions, wall time and JS heap
(where available). JS heap is not ONNX WASM/GPU/process peak memory.

Before F2 model qualification, add rights-cleared held-out colored manhwa, B/W manga,
murim/fantasy scenes, faces, hands, text/bubbles, repeating backgrounds and long
webtoons. Archive input/mask/output and settings; manually review line/style/identity,
anatomy and context continuity. A human reviewer must approve representative output;
no synthetic integrity metric substitutes for that decision. GPU latency/VRAM and
physical Android results are currently unmeasured.

## Validation and review

An initial F1 browser run passed real inference/history/native/pixel assertions but
failed on a QA selector treating an HTML disclosure as a button. That selector was
corrected. The next run exposed an existing built-preview WASM MIME mismatch
(`application/octet-stream`); production serves the same asset as `application/wasm`.
A loader compatibility fix is validated below; console assertions are not weakened.

See the final validation report appended after executing the supported checks.
No merge, production deployment, secret/environment change, paid provider or F2
implementation is authorized by this development branch.
