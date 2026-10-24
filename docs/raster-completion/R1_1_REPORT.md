# R1.1 — Chapter import safety and resource protection

Date: 2026-10-24. Scope: H02 from the R1 audit only. Branch `codex/raster-studio-completion`, existing Draft PR [#13](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/13). Starting development HEAD `612f3bab6be29e6ce5358e2322335e67e98e8a66`; verified main/merge base `a90c656c8b68cb2016a7a1cd09e720ef3ed145ab`. Current execution evidence is in [r1.1/EVIDENCE.json](r1.1/EVIDENCE.json); the earlier R1 baseline remains historical evidence.

## Root cause and correction

H02 was a **High resource-exhaustion / document-integrity risk**, not a demonstrated browser exploit or server SSRF. Chapter `addImages` called `decodeBlob` before source dimensions/resource checks. That helper tried unrestricted `createImageBitmap` followed by `Image` fallback, with no encoded-size, signature, predecode pixel, animation-frame or aggregate budget. Assets were stored before Chapter metadata in separate transactions, leaving orphan bytes if cancellation, a stale destination or quota failure intervened. Replacement, recovered sources, references and direct worker consumers also needed guards.

R1.1 centralizes admission in `image-policy.ts`, with bounded header reads and explicit device/batch/recovery limits. Source signatures determine the format and canonical MIME; filenames and MIME claims do not authorize decoding. The whole batch is checked before **any** native decode or storage write. Valid members are decoded/closed sequentially and staged; one revision-checked IndexedDB transaction publishes metadata and bytes. Invalid members are skipped with reasons and valid members retain their input order. An aggregate breach rejects the whole batch without decoding. Source encoded bytes remain unchanged: MIME normalization uses Blob slices, never resizing or recompression.

This closes the missing predecode boundary without replacing the graphics engine, changing native formats, adding AI inference or claiming that headers constitute a complete compressed-bitstream validator.

## Affected entry points and boundaries

| Path                                                                                                   | Correction / evidence                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chapter file picker, drag/drop, clipboard paste, multi-file batch                                      | All converge on `store.addImages` → all-file preflight → sequential `decodeBlob` → atomic `commitChapterImages`. Actual UI, drop and paste tests. Chapter creation itself adds metadata only; its subsequent image input uses this same path.                                                                            |
| Image edit, batch edit, Raster/Vector/Dialogue accepted composite, AI Enhance / Face Fix acceptance    | Existing callers retain their context and use `replacePanelImage`; it now preflights, serializes temporary decode surfaces, stages the thumbnail and atomically compares the original blob revision. A newer replacement cancels the previous one; optional external cancellation is supported.                          |
| Original-image restore                                                                                 | Checks original bytes, header/metadata dimensions and thumbnail policy before `commitPanelMedia`; failure preserves the current version and source references.                                                                                                                                                           |
| Project backup / recovery / re-import                                                                  | `writeProjectData` preflights sources, thumbnails, strip parts, original/edit/draft media, embedded character references and native session assets before publication. Source metadata must agree with encoded dimensions (orientation transposition allowed). Existing atomic restore and native journal remain intact. |
| Stored Chapter previews, strips, project-cover thumbnails, face queue and character-reference previews | `getImageBlob` / `useImageUrl` validate before exposing a Blob URL to an `<img>` decoder. Raw `getBlob` stays available for byte-exact downloads and recovery.                                                                                                                                                           |
| Editor worker, enhancement worker, face detection, retouch, character-reference extraction             | `safeBitmap` checks bytes, header, pixels and estimated resources before actual bitmap decoding; operation-specific stricter existing limits remain. Existing Swin2SR model/inference code is unchanged.                                                                                                                 |
| Pro worker/native images                                                                               | Source assets are checked before the existing resized bitmap/cache path; native import retains its existing stricter pool and geometry limits. Internally generated compositor outputs already have document/render budgets and are not arbitrary uploaded files.                                                        |

No new route, document version, rendering engine, GPU job submission, homepage redesign or production setting was introduced. F1/native-v6 integration remains separate; existing v1–v5 and Dialogue-v7 behavior is retained, rather than asserting unsupported v6 compatibility.

## Central resource policy

MiB means 1,048,576 bytes. A coarse pointer or `navigator.deviceMemory <= 4` selects the constrained policy. Workers without those browser hints use explicit operation limits where available; their existing native pool limits still apply.

| Limit                                                   |        Desktop | Constrained device |
| ------------------------------------------------------- | -------------: | -----------------: |
| Source side                                             |      65,535 px |          65,535 px |
| Total decoded pixels, including accounted frames/planes |     32,000,000 |         16,000,000 |
| Encoded bytes per file                                  |         80 MiB |             40 MiB |
| Estimated resident budget                               |        512 MiB |            256 MiB |
| Batch encoded bytes                                     |        256 MiB |            128 MiB |
| Batch cumulative pixels                                 |    128,000,000 |         64,000,000 |
| Files per import batch                                  |            250 |                250 |
| Frames / image representations                          |             64 |                 64 |
| Header bytes per file / batch                           | 2 MiB / 32 MiB |     2 MiB / 32 MiB |

Estimated per-file resident work is `12 * accountedPixels + 2 * encodedBytes + 4 MiB`. Batch admission also requires encoded bytes plus the largest per-file estimate to fit the resident budget. Sides and policy values are positive safe integers checked before multiplication; offsets, chunk lengths, 64-bit box lengths and cumulative work are bounded. Header reads use small Blob slices/cache pages, not whole-file pixel decoding. Container depth, directory/chunk counts and read steps are capped.

The desktop pixel/side ceilings retain existing `SOURCE_LIMITS`; constrained pixels match the existing Chapter output ceiling. The formerly unrestricted import path now has intentional byte/work budgets because it stages a complete batch and uses browser full-image decoders. **No source is silently downscaled to fit.** Long narrow artwork retains source-side support (a 1 × 50,000 fixture is verified). Render canvas/editor-specific limits can still be stricter than source storage limits. Smaller batches are the explicit remedy for aggregate rejection.

Backups are lazy Blob storage, not a simultaneous decode batch: up to 4,000 image references, 512/256 MiB aggregate encoded data and 32 MiB aggregate header reads. Only assets actually decoded by native restore consume its 128M/64M cumulative decode-work budget. A regression accepts 600 ordinary 512² Chapter pages, while rejecting equivalent excessive native-decode work. Recovered thumbnails are capped at 512² pixels, 512 px per side and 2 MiB, above the generated 240 × <=360 previews. Existing native envelope/pool limits remain unchanged.

## Format and compatibility contract

The pinned browser-only header reader is **`image-size@2.0.4`**, MIT, zero runtime dependencies. Its pure `Uint8Array` entry is used; the filesystem `fromFile` entry is not. License evidence is in `public/licenses/image-size-MIT.txt`; the lockfile pins its integrity. Additional application container checks handle cases a size reader alone does not validate.

- PNG: signature, IHDR format/dimensions/checksum, bounded chunks, image data/termination and APNG frame/canvas work. Compressed colour-profile/text chunks (`iCCP`, `zTXt`) are inflated by the preflight itself under the 2 MiB per-file metadata expansion budget (compressed bytes also count toward the header-read budget); malformed, corrupt, truncated, non-zlib or over-budget streams are rejected before any decoder runs. Compressed `iTXt` remains rejected. (Release audit: the original blanket `iCCP` rejection also blocked export/editing of profiled PNGs already stored by production — e.g. macOS/iPhone screenshots and Photoshop exports — and was replaced by this bounded check.)
- JPEG: bounded library scan plus marker/segment checks through the first scan, one supported frame with matching dimensions/components, and an EOI marker: either the final two bytes or (release audit) the first `FF D9` after the scan header, found by a bounded 1 MiB-chunk scan so phone motion-photo/vendor trailers after EOI keep importing as on production while scans without any EOI stay rejected. Progressive JPEG remains supported. This is not a full entropy/scan validator or ICC-profile fidelity guarantee.
- WebP: exact RIFF bounds, chunk ranges, VP8/VP8L coded dimensions matching canvas/frame dimensions, and bounded animation frame accounting. A forged small VP8X canvas with a larger inner frame is rejected before decoding.
- GIF: logical/frame bounds, bounded subblocks/frame work and termination. Animation is imported as the browser's current decoded frame; this does not add an animation editor.
- BMP/DIB-in-ICO: bounded layout/depth/channel/palette checks; embedded JPEG/PNG BMP codecs are rejected. Bare unsupported DIB variants require conversion.
- ICO: bounded directory, payload ranges and nested PNG/DIB dimensions; every representation consumes the policy budget.
- Classic TIFF: bounded directories, tags/offsets, sample depths/channels, pages and decoded work. BigTIFF, nested/embedded-image variants and unsupported codecs are rejected. Chromium in this environment lacks TIFF decoding; an actual valid TIFF exercises the decoder-failure rollback path.
- Still AVIF/HEIF/HEIC: bounded boxes, all declared `ispe` planes, channel/depth and item-location ranges; timed/external/protected or unverifiable structures are rejected. AVIF is tested through actual Chromium decoding. A real HEIC decoder/device was unavailable; HEIC fidelity is not asserted. Header checks do not implement AV1/HEVC entropy/SPS validation.
- Safe SVG: <=1 MiB markup, existing editor whitelist parser, active content/external URLs/entities/unsafe resource constructs rejected before browser decode. Main-window Chapter SVG import is verified. Worker paths without DOMParser safely reject SVG and request PNG conversion; they do not skip validation. Unsupported SVG effects/layouts may be rejected, including mismatched browser/header dimensions.
- Unknown, unsupported or unverifiable signatures fail with a conversion message, even if named `.png` or labeled `image/png`. Conversely, valid signatures with `text/plain` are admitted and canonicalized without changing bytes.

## Cancellation, stale results and storage integrity

- Visible **Cancel image import** control and cancellation on Chapter switch/unmount/delete; import token prevents old cleanup from overwriting a newer job.
- Main-window temporary decoded images have a lease until closed. Bitmap decode has a 30-second timeout, Image fallback 15 seconds, signal handling, exact/transposed dimension checks, URL cleanup and late-result closure. A pending native bitmap retains its per-context busy flag after cancellation/timeout until it actually settles, preventing overlapping retries in that context.
- Thumbnail and stitching canvases clear dimensions in `finally`; imported source pixels are not duplicated into full-size canvases solely to store the original. Staging retains Blob references plus small encoded thumbnails.
- Import commit checks the live Chapter/project and exact ordered `(panelId, blobId, order)` snapshot inside one transaction. Another tab changing images/order causes refusal, not stale publication. It preserves latest Chapter/project fields.
- A storage estimate is advisory; the transaction is the quota authority. Injecting quota failure on the **second** blob write proves prior queued writes roll back. Replacement uses the existing atomic media transaction with cancellation and blob-revision comparison.
- Removal/deletion releases cached object URLs after state references are removed. Repeated import/remove browser tests assert real thumbnail URL revocation.

## Tests and evidence

Source is frozen during final build/browser validation. Evidence distinguishes genuine decoding/IndexedDB/UI work from injected failure controls. No mocked model inference is presented as AI verification.

- **791 automated tests passed**, zero failures/skips/cancellations: 200 script tests + 59 shared application tests + 87 Studio tests + 445 Pro tests. The 38 new policy/decode tests cover valid signatures, malformed/truncated containers, overflow, dimensions, compressed metadata, multiple frames, MIME spoofing, aggregate budgets, memory estimates, header work on rejected files, cancellation, recovery limits, late closure, timeout and busy/lease behavior.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:build`, `npm run check:auth`: passed. The existing optional `DATABASE_URL` migration is skipped locally when unset; actual IndexedDB mutations/recovery are tested. Build output is local validation, not a deployment.
- `npm audit --json`: zero known advisories at execution time. This is a snapshot, not proof of absence of supply-chain vulnerabilities.
- `npm run test:chapter-import:browser`: passed on desktop 1440px and touch-emulated 320/390px. Rejected huge/truncated/spoofed assets and **real valid-image aggregate overflow** produce zero `createImageBitmap`/`Image` calls and unchanged database records/blob keys. Mixed order, canonical MIME, drop/paste, native cancellation/late-close, transaction rollback, rapid Chapter switching, stale second-tab import, replacement failure/cancellation/quota, original recovery, backup thumbnail/metadata/character-reference rejection and repeated URL cleanup are verified. PNG/JPEG/WebP/GIF/BMP/ICO/AVIF and safe SVG actually decode in Chromium; accepted encoded source bytes compare equal.
- **26 completed Chromium suites passed** (25 existing plus the new Chapter suite). Existing regression ledger, final statuses and exact commands: see `r1.1/EVIDENCE.json` and logs. It includes Chapter/Raster/Vector/Dialogue/history/native/export, real existing Swin2SR inference, real local Tesseract and homepage regressions. Built and dev desktop/mobile smoke checks pass with no console/page errors, horizontal overflow or baseline divergence; screenshots were visually inspected.
- No physical Android, stylus, Safari, Firefox, real HEIC codec or exhausted-device hardware validation was available. Browser touch emulation is not physical Android testing.

### Disclosed test development failures

Initial test-harness attempts used an async polling predicate and imported a separate Vite HMR instance of the store, allowing premature observations; fixed to identify the actual loaded store and poll synchronously. An initial Pro back-button label was incorrect. An early typecheck caught a missing retained `useEffect` import in CharacterControls; it was restored before final validation. ESLint also caught an obsolete `putBlobs` import, which was removed. A damaged PNG compressed payload was accepted by Chromium's tolerant native decoder; that assertion correctly failed. Decoder-failure coverage now uses a valid TIFF that the actual browser codec cannot decode. These failures are retained in the execution logs, not counted as passes or claimed to prove complete bitstream rejection. A unit memory-boundary threshold was corrected arithmetically; no production budget was weakened. The first final OCR regression attempt lost its execution context during navigation before inference. The exact unchanged suite rerun passed all five languages and cache/cancellation checks; both logs are retained, and the precise navigation trigger is not conclusively identified. The environment briefly disconnected; work survived, and no push was claimed during the outage.

## Remaining security and memory limits

Headers and budgets substantially reduce admission risk, but do not prove every compressed bitstream is semantically valid or eliminate bugs in browser codecs. A decoder may tolerate damaged pixels/ancillary CRCs; accepted bounded inputs can still fail during actual decoding, which must not publish partial document state. WebCodecs/native internal allocations, color transforms, driver/GPU memory and process sharing cannot be hard-capped from JavaScript. The estimate is conservative admission accounting, **not measured peak RAM** or a universal crash guarantee. Native decoding cannot be forcibly interrupted; cancellation prevents publication, closes late results and blocks overlapping retries in that context. Separate workers/tabs have independent contexts and can increase total process memory; this change is not a global cross-tab GPU allocator. Browser storage quota estimates may be stale; atomic transactions are the last line of defense. Animation/metadata variants and native editor pool constraints are intentionally bounded, with explicit errors rather than silent conversion. Color-profile preservation remains subject to existing browser/editor/export limitations.

No architectural redesign was needed. The broader R1 capability/performance/device limitations remain for future separately approved work.

## Files changed

- New central boundary: `src/lib/studio/{image-policy,image-decode,use-image-url}.ts`, policy/decode tests and internally created format fixtures.
- Chapter publication and recovery: `store.ts`, `db.ts`, `images.ts`, `backup-store.ts`, and the existing Chapter import progress/cancel control.
- Shared decode consumers: editor/enhance/faces/retouch/Pro workers, Pro native-image validation, character-reference extraction and the existing reference/thumbnail UI loaders. No unrelated UI redesign.
- Validation/supply chain: new Chapter import browser suite, package scripts, pinned lockfile entry, MIT notice and R1 audit/evidence updates. Complete file list: [r1.1/CHANGED_FILES.txt](r1.1/CHANGED_FILES.txt).

## Git / review checkpoint

R1.1 commits, tested source-tree identity, final remote SHA and GitHub Actions URLs are recorded in `r1.1/EVIDENCE.json` and Draft PR #13. Main and production are unchanged. No merge, Ready conversion, production deployment, production configuration modification, R2, F2 or unrelated homepage work is authorized/performed.

**RESOLVED — H02 is fixed and verified by predecode instrumentation, resource-policy tests and real browser/storage regressions.** Final remote HEAD and GitHub Actions results are reported on PR #13 and in the delivery report; they must be verified after pushing, not inferred from local builds. Stop after R1.1 and await explicit user approval.
