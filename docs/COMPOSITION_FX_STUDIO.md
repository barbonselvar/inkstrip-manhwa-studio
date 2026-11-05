# Composition & FX Studio

## Architecture audit (before implementation)

Baseline: `7069f840a29f5496c6f39b8882e3e06017e19ce8`, Node 24, React 19,
TypeScript, TanStack Start/Router, Zustand, Tailwind 4 and Radix. The existing
Vercel/Nitro build, Chapter routes, AI integrations and native editors are retained.

ChapterWorkspace is `chapter-studio.tsx`; its Images and Text & Bubbles tabs
share the chapter context. `Panel.order` determines reading order. IndexedDB
`inkstrip` v2 owns projects, chapters, panels and source/thumbnail blobs. A
separate revision-controlled `inkstrip-pro` database owns Raster/Pro and dialogue
documents. Existing record validation rejects unknown keys. Backup v1/v2 reads
Chapter records, referenced media and native sessions and restores atomically.

Existing gradients, blend modes, affine transforms, text shaping, image policy,
decode leases, immutable history and ZIP writer can be reused. ProDocument is
bounded by per-document raster/layer budgets; a complete chapter must not be
represented as one ProDocument or one giant canvas.

## Integration contract

- Add an optional, independently versioned composition field to Chapter, and
  reusable presets/favorites to Project. Existing images and panel order remain
  authoritative. Old chapters initialize lazily; merely opening never rewrites them.
- Chapter and Focus modes share a chapter controller/history. Coordinates are
  pixels at the initial chapter width. Export rescales uniformly. Panel-local
  objects follow their owner; global objects retain absolute chapter coordinates.
- Extensions and gaps add; explicit merging preserves their total. Pair-based
  transitions become inactive when their two panels cease to be adjacent.
- Accepted images are the default. An explicit saved-native-draft snapshot can
  override a composition source without changing the accepted chapter image.
- Region rendering is shared by canvas, simulator and segmented export. Random
  effects use stable seeds/absolute positions. Filter halos are rendered then
  cropped; output rows use contiguous integer intervals.
- Save only metadata and new overlay/snapshot assets, with revision checks.
  Blob retention and backup enumeration include composition references.
  Unknown/damaged composition remains recoverable without hiding source chapters.
- Preserve existing dark/mint design tokens. Mobile uses scrolling navigation,
  touch-sized controls and property sheets; canvas and UI gestures are separate.
- No new commercial APIs. AI outpainting and unverified advanced lettering tools
  remain explicitly unavailable. The existing paid image-edit endpoint is unchanged.

## Delivery contract

Implement core/modes/spacing/storage, fades/transitions, SFX/FX/layers, then
workflow/export/performance. Validate unit invariants, actual rendered pixels,
segmented parity, backup/reload, accepted-image preservation, mobile 360/390/430,
desktop and existing editor regressions. Use the existing typecheck/lint/test/
build/check:build commands. Evidence and the final capability inventory will be
recorded below with the verified capability inventory.

Branch: `codex/composition-fx-studio`. No main merge or production deployment.

## How to launch and use

Use Node 24, `npm ci`, then `npm run dev`. The existing app starts with its normal
configuration; composition requires no account, commercial API, server migration
or new environment variables. Open a project and chapter, then **Composition & FX**
beside Images and Text & Bubbles. All imported chapter panels appear in reading
order, including panels not checked for the older Images stitched preview.

1. Select a panel, then **Focus**, **Edit Panel**, double-click/double-tap, or use
   the long-press/context menu. Set **Top extension (px)** to 300 and **Bottom
   extension (px)** to 500. **Return to Chapter** immediately shows both regions.
2. **Spacing** selects opening, ending, top, bottom or after-panel regions. Click
   a gap directly or drag its handle. Change its fill, type a height, use presets,
   copy/paste, or apply to selected/all panels. The adjacent panel's bottom,
   after-gap and next top extension are all counted. **Merge shared gap** explicitly
   combines them while preserving the total; review its chosen fill first.
3. **Add bottom fade** starts a 350px fade to white. Use **Fades** for other types,
   target colors/transparency, stops and parameters. Drag the fade handle or enter
   exact values. Several fades can coexist on the source.
4. **SFX Library**: choose text, then a style thumbnail. Move it on canvas or edit
   X/Y/rotation in properties. A panel-local object's Y is relative to the original
   image top, so negative Y places lettering in its upper extension. Clipping is
   off by default. Choose **Chapter global** to keep absolute chapter coordinates.
5. **Transitions** creates a connection to the next panel. **Effects Library** adds
   static FX; **Layers** controls stacking, visibility, locking and groups. The
   panel list offers multiselect, reordering and default gaps for newly imported
   panels. Compatible batch changes form one undo entry.
6. **Preview** opens the reader from the chapter opening at 320/360/390/430px or
   full width. Before/After is temporary. Save status acknowledges IndexedDB writes.
   **Export** selects format, width, segment height, panel range, matte and layer
   exclusions. Multiple images download in a numbered ZIP.
7. **Export editable project** contains original media, native drafts, composition
   and presets. **Import editable project** restores into a browser where that project
   is absent; it refuses duplicate project IDs and never overwrites existing work. Export this package for device transfer
   or as recovery when browser storage is full.

On mobile, scroll the chapter tool navigation horizontally, open **Tools** for
libraries and **Properties** for the bottom sheet. Use one finger to move a selected
object or scroll empty canvas, pinch to zoom and two fingers to pan. Controls and
drag handles have at least 44px touch targets. Keyboard: Ctrl/Command+S save,
Z/Shift+Z or Y undo/redo, D duplicate, C/V copy/paste creative layers, Delete remove,
Escape exit focus/preview/sheets. Text inputs retain their normal editing keys.

## Implemented scope

| Area        | Delivered behavior                                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Integration | Lazy third tab, existing chapter context, existing dark/mint design; Images, Text & Bubbles, Raster, Pro and AI remain available.                                                                                                                                                                                  |
| Canvas      | Aspect-preserving vertical layout, stable logical pixels, bounded viewport rendering, fit/zoom, multiselect, reorder, guides and snapping; one chapter controller/history for Chapter and Focus.                                                                                                                   |
| Spacing     | Opening/ending/top/bottom/between regions; white, black, custom color, transparent, gradient, blurred edge, mirrored edge; exact pixels, drag handles, reset, double-height duplication, copy/paste, saved presets and batch apply.                                                                                |
| Fades       | All 13 named families: four edges, linear, multi-edge, radial, elliptical, soft feather, blur, fog, directional and custom gradient. Multiple editable masks per source with color/alpha target, curve, blur, feather, opacity, blend and stops.                                                                   |
| Transitions | All 10 named families; adjacent-image references, height/angle/softness/opacity/blend, deterministic dissolve/fog and custom gradient stops. Invalid adjacency retains editable settings, disables output and shows a notice.                                                                                      |
| SFX         | 31 starting phrases in five categories, arbitrary Unicode text, 12 enabled styles with thumbnails; multilingual full-run shaping, script font selection/RTL, affine move/rotate/stretch/skew, letter/line spacing, multiple strokes, gradient, texture, shadow, glow and blend.                                    |
| FX          | 38 named static procedural effects with previews and relevant editable parameters. Includes actual sampled motion/radial/directional blur and bright-pass bloom, strokes/arcs, atmospheric particles, lighting and dramatic overlays. These are procedural interpretations, not a stock illustration library.      |
| Layers      | Sources, extensions/gaps, attached gradient masks, transitions, SFX, FX, image overlays and nested creative groups. Shared render order; relevant naming, visibility, locking, opacity/blend, duplicate/delete and history. Creative objects support affine transforms; structural regions follow layout geometry. |
| Workflow    | Batch spacing/fades, default import gaps, project presets and favorites, cross-chapter creative clipboard, before/after, mobile reading widths, explicit saved-native-draft snapshots.                                                                                                                             |
| Persistence | Versioned composition envelope, lazy old-chapter initialization, 650ms debounced autosave, atomic order+scene revision checks, quota/conflict recovery, complete editable packages.                                                                                                                                |
| Export      | PNG lossless; JPEG/WebP quality; complete chapter, selected panels or focus panel with extensions; custom width, matte and object/fade/transition exclusions; contiguous integer-row segmentation, padded effects and cancellation/progress.                                                                       |

The 12 enabled SFX styles are Sharp Slash, White Impact, Black Impact, Heavy
Explosion, Brush Stroke, Speed Motion, Energy Burst, Metallic, Horror, Whisper,
Glowing Aura and Hand-drawn. Jagged Comic and Distorted Lettering are visible with
an explicit unavailable explanation. No control claims perspective or per-letter
outline deformation.

## Storage, ownership and rendering decisions

`Chapter.composition` is optional and opaque to legacy record loading. The editor
validates `{version: 1, revision, document}` at its own boundary. Opening an old
chapter creates an in-memory default; the first edit saves composition. Existing
`Panel.order` is authoritative. No IndexedDB version upgrade is required.
`Project.compositionPreferences` holds reusable presets/favorites. Ordinary chapter
metadata writers preserve the latest composition instead of overwriting it from
a stale Zustand record; they return the actually acknowledged stored record.

Saving compares both the scene revision and the expected panel order in one
transaction. Concurrent edits block stale writes and expose recovery instead of
silently replacing newer data. Pending saves drain after an in-flight save. Global
visibility/unload guards include controllers from chapters whose tab was closed.
Future/damaged composition can block this editor without quarantining the original
chapter. Package v3 adds composition, preferences and referenced media; old v1/v2
packages remain readable. Restore validates before its existing atomic write and
retains project identities while refusing any existing project. Native Raster/dialogue data keeps its own schema.

Panel-local creative coordinates originate at the owner's image top and move with
that panel. Chapter-global coordinates stay absolute when panels move. Source
aspect ratios are never changed. Deleting a panel prunes its local objects, group
references and pair transitions; global artwork remains. Reparenting between
scopes/groups preserves the world transform. A source's mask follows that source
when its root layer moves. Creative groups isolate opacity/blending, and hidden
or locked ancestors also hide/lock descendants and their hit targets. Sources,
spaces and transitions have a unified root stack; masks remain attached to source.

Preview, reader and export call the same Canvas 2D region renderer. Full shaped
text runs preserve Arabic joining; self-hosted OFL Noto Sans/KR/JP/Arabic and Bangers
provide predictable core fonts. Browser/OS fallback covers other Unicode when a
glyph is available. Fonts load before rendering. No second graphics framework was
introduced: existing Pro transforms, blend modes, history, image decode policy,
decode leases, native renderer and ZIP writer are reused.

The canvas allocates one visible region plus overscan, with source decoding
serialized and an 8MiB coarse-pointer / 32MiB desktop processed-plane cache. Source
decode leases are closed; replaced temporary surfaces are released. Pointer moves
update metadata without allocating a whole-chapter image or regenerating library
thumbnails. Preview adapts its resolution to DPR and the existing device policy;
export always uses the requested logical scale and original accepted source.

Export plans contiguous half-open output-row intervals. Every padded render aligns
to the same global output pixel grid, including intermediate source and transition
planes, before cropping. Seeded effects use absolute scene positions. Filter/glow
halos include neighboring content. The planner reserves at least six simultaneous
planes plus group depth against existing device area limits and lowers segment
height rather than stretching artwork or silently lowering output width.

## Validation performed

Validated on 2026-11-05 with Node 24.22.1, npm 11.9 and Chromium/Playwright. The
production output was served locally; the production website was not changed.

| Command / check                                                            | Result                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                 | 1,166 tests passed: 204 script, 63 app, 151 Studio, 707 Pro, 41 Composition; audit probes also passed.                                                                                                                                                                          |
| `npm run typecheck`                                                        | Passed both application and config TypeScript checks.                                                                                                                                                                                                                           |
| `npm run lint`                                                             | Passed without warnings.                                                                                                                                                                                                                                                        |
| `npm run build` + `npm run check:build`                                    | Passed; Vercel server/runtime assets and bundling verified.                                                                                                                                                                                                                     |
| `npm run test:composition:browser`                                         | Passed real Chapter/Focus/spacing/fade/SFX/save/export/refresh, desktop 1440px and touch 360/390/430px; 430px uses DPR 3.                                                                                                                                                       |
| `node scripts/composition-browser-check.mjs http://127.0.0.1:8081 --built` | Passed built-output UI workflows, mobile dimensions and genuine CDP touch gestures; no browser errors. Source-module-only pixel/stress hooks are separately covered on dev.                                                                                                     |
| `npm run test:composition:integrity`                                       | Passed all 38 FX and 12 SFX styles producing pixels, multilingual output, five extension fills, PNG/JPEG/WebP decode, quota failure/retry, stale-write conflict, metadata preservation, explicit native snapshot, byte-exact accepted images and fresh-profile package restore. |
| `npm run test:chapter-display:browser`                                     | Passed existing image imports/display/reorder/native source retention, storage failure and mobile/low-memory cases.                                                                                                                                                             |
| `npm run test:raster-refinement:browser`                                   | Passed existing layers, masks, native v5, history, touch and exports.                                                                                                                                                                                                           |
| `npm run test:dialogue:render`                                             | Passed native/PNG/SVG dialogue rendering comparisons; measured max error 0 in the existing suite.                                                                                                                                                                               |
| `npm run test:dialogue:workflow`                                           | Passed real OCR, cleanup, editable text/history/native, PNG/JPEG/WebP, chapter/layer ZIP and fresh-profile recovery after using the environment's required browser proxy.                                                                                                       |
| `npm run test:r14:browser`                                                 | Passed existing real free Fast Anime 4x inference/apply/recover/Raster at desktop/tablet and 390/360/320px, byte-exact original recovery; no paid image-edit endpoint called.                                                                                                   |
| Existing `scripts/browser-smoke.mjs`                                       | Dev and built desktop/mobile render checks passed with no console/page errors, overflow, brand/auth warnings or baseline divergence. Explicit New project readiness was used on built output.                                                                                   |

The Composition unit tests cover exact layout/merge math, schemas/references,
Unicode, affine geometry/group scope, history, backup roundtrip, deterministic
masks, stacking/locks/hit testing, segmentation, and layout of 500 tall panels
without raster allocation. The browser 40-panel workflow applies 200px gaps,
150px top extensions, three fades and three crossing SFX, saves/reloads, verifies
all metadata and scrolls deep into the chapter with one bounded viewport canvas.
This is not a benchmark of hundreds of simultaneously decoded high-resolution
sources or a physical mobile-device memory guarantee.

Pixel evidence: a black source fading to white over 350px samples 0, 128 and 254
at the tested start/middle/edge. Six sequential PNG segments cover exactly 2,827
output rows at width 640. Comparison against a complete reference render has a
maximum channel difference of 1 and **zero values differing by more than 2**.
3,695 dark pixels remain visible in the gap above a source from cross-panel SFX.
See [pixel measurements](composition/evidence/rendering-parity.json),
[development browser results](composition/evidence/browser-development.json),
[built browser results](composition/evidence/browser-built.json) and
[integrity results](composition/evidence/storage-rendering-integrity.json).

Issues investigated during validation: reading preview retained editor scroll
pixels after fitting to phone width and could open in an empty extension; it now
resets to the chapter opening and has an artwork-presence regression assertion.
Strict-effect replay originally disposed the preview resource manager; effect-owned
resources fixed that. Segment pixel-grid misalignment was corrected before parity
passed. A tools-sheet assertion raced the intended automatic close and now waits
for that close. The older OCR regression initially lacked the inherited network
proxy; it passed through that proxy without disabling TLS. An older AI test first
lacked its expected evidence directory; it passed after directory creation. A
generic smoke run captured the initial loading shell; explicit UI readiness
resolved it and both final screenshots were visually reviewed.
The integrity rerun also exposed a test assumption that IndexedDB returns panels
in reading order. Snapshot restoration now checks the stable panel ID rather than
an arbitrary array position and verifies duplicate-project import is refused.

## Screenshots from the running application

These use the repository's existing gallery artwork. No supplied reference
screenshots or handwritten annotations were available in this session.

- [Focus editor: extensions, bottom fade and rotated cross-boundary SWISH](composition/screenshots/focus-sfx-fade.png)
- [Desktop chapter canvas](composition/screenshots/chapter-desktop.png)
- [300px top / 500px bottom workflow](composition/screenshots/extensions-300-500.png)
- [Reading simulator](composition/screenshots/reading-preview.png)
- [360px touch layout](composition/screenshots/mobile-360.png)
- [390px touch layout](composition/screenshots/mobile-390.png)
- [430px / DPR 3 touch layout](composition/screenshots/mobile-430-dpr3.png)

## Deferred features and known limits

- True perspective, glyph-outline/per-letter distortion, editable freehand masks
  and full custom-font importing are deferred. Jagged Comic/Distorted Lettering
  remain disabled. Brush styles use font/texture treatment, not bespoke hand-drawn
  glyph outlines. Radial/elliptical fades use the source center; custom masks are
  gradient stops. No unlimited custom-shape mask editor is claimed.
- AI extension has a small capability-probed, cancellable provider contract and
  tests. No provider/backend is installed; content-aware extension is explicitly
  unavailable. Traditional fills work entirely offline. Existing AI tools and
  commercial API configuration are untouched.
- PNG is 8-bit lossless. Canvas JPEG/WebP are quality-controlled; lossless WebP,
  wide-gamut/HDR, ICC management and a 16-bit print pipeline are not implemented.
  Browser text/filter rasterization can vary slightly between engines.
- Export width is 320–4096px, requested segment height 128–16384px, at most 1,000
  segments and the existing ZIP writer's 2GB limit. Large halos or deep groups can
  require smaller width/radius. Segments are encoded sequentially but encoded blobs
  remain in memory until ZIP download; this is not a streaming-to-disk ZIP engine.
- Individual spaces are limited to 100,000 logical pixels. Very extreme scenes can
  reach browser scroll-height/zoom limits. Fit Screen has a minimum relative zoom
  of 0.01. The accepted source/decode safety limits still apply.
- Undo/redo retains 50 history entries in the current browser session. Artwork and
  composition restore after refresh; history, camera and selection do not. Cross-tab
  conflicts require recovery/reload instead of automatic conflict merging.
- Saved Raster/dialogue drafts enter composition only as explicit revision snapshots.
  Repeat snapshot/overlay edits may leave unreferenced derived blobs for recovery;
  global blob compaction is deferred. The same accepted source is referenced rather
  than duplicated for every composition layer. Native snapshots require the existing
  Pro renderer's browser capabilities.
- Chromium touch emulation passed; physical Android/iOS, Safari, Firefox and WebKit
  are not verified. WebKit launch was blocked by missing GTK/Graphene/Harfbuzz/manette/
  hyphen/GLES system libraries; installing those requires unavailable root access.
  This remains a release-verification gap, not a passing Safari claim.
- Existing tests exercised selected critical regressions, not every legacy browser
  suite in the repository. Production load/performance and user projects were not
  used as test fixtures or modified.

## File inventory

| Files                                                                                                   | Responsibility                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/studio/composition/{workspace,canvas,properties,library,layers}.tsx`, `composition.css` | Integrated editor, interaction, inspectors/libraries/layers, reader, mobile sheets and export/package UI.                            |
| `src/lib/studio/composition/{model,geometry,masks,library,render}.ts`                                   | Versioned schema/layout, geometry/picking, precise masks, presets and shared region renderer.                                        |
| `src/lib/studio/composition/{controller,storage,export,segments,ai}.ts`                                 | Shared history/autosave/CAS, IndexedDB ownership, segmented image/package output and optional AI provider contract.                  |
| `src/lib/studio/composition/{model,ai}.test.ts`                                                         | 41 new unit/integration tests.                                                                                                       |
| `scripts/composition-{browser,deep}-check.mjs`                                                          | Actual UI/mobile/40-panel/pixel parity and rendering/storage/recovery browser checks.                                                |
| `src/components/studio/chapter-studio.tsx`, `src/styles.css`                                            | Third lazy navigation tab and readable horizontal mobile navigation.                                                                 |
| `src/lib/studio/{types,records,db,store,backup,backup-store}.ts`                                        | Optional metadata, legacy-safe validation, stale metadata protection, blob retention, deletion cleanup and package v3 compatibility. |
| `package.json`, `package-lock.json`, `public/licenses/*`                                                | Five self-hosted OFL font packages/notices and Composition test commands. No new paid/graphics library.                              |
| `README.md`, `docs/CHANGELOG.md`, this report and `docs/composition/`                                   | Usage, truthful capability/release inventory, measurements and screenshots.                                                          |

The feature is reviewable on its dedicated branch. Deployment configuration and
the existing production website remain unchanged. Merge and production deployment
require the user's explicit approval.
