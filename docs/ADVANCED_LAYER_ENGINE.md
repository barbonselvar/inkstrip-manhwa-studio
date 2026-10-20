# Advanced layer engine milestone

Starting branch: `codex/raster-vector-studio-entrypoints`, verified head
`72cb64c3d4e035ee6894eb55332002cb4676e695` (PR #1). This extends the shared
Raster/Vector/Pro document engine. It does not replace the selection, Pencil,
Clone Stamp, traditional Healing Brush, AI, character or chapter pipelines.

## Clipping semantics

Document siblings are ordered bottom-to-top; the panel shows the front row first.
Optional `Layer.clipped` means the layer belongs to the nearest **unclipped sibling
below**, together with subsequent clipped siblings. Chains reset at group boundaries.
A missing or hidden base hides its entire chain. A hidden clip affects only itself.

A clipping stack is isolated. Its base includes source/paint/vector/text content,
adjustments, editable masks and object transforms. Clipped content changes RGB
inside that alpha via source-atop blending; it cannot increase the silhouette's
alpha. This matters for antialiased edges, feathering and multiple translucent clips.
Each clip has its own opacity and Normal/Multiply/Screen/Overlay/Darken/Lighten blend.
The base's opacity is applied **once** to the complete stack; its blend then combines
the complete stack with the surrounding backdrop. Groups may be bases or clips,
and child groups retain their own independent stacks and isolation.

The compositor is shared by preview, merged-visible sampling for advanced selection
and repair tools, native-resolution merges, chapter application and PNG/JPEG/WebP
exports. Selections constrain editing gestures; they do not crop merges or exports.

Clipping and link metadata round-trip through existing version-1 native files and
IndexedDB sessions. Absent optional fields preserve legacy behavior; no database
migration/reset is required. SVG export explicitly refuses clipping stacks instead
of silently dropping their alpha or excluding a raster clipping base.

## Layer operations and panel

- Checkboxes, Ctrl/Command-click, Shift-click ranges and a mobile Multi-select toggle.
- Duplicate selected layers or complete group subtrees. New IDs and duplicate-only
  link IDs prevent accidental relationships to originals. Masks, text, vector
  paths, styles and transforms remain editable; immutable source/clone assets are
  shared safely rather than copied or overwritten. Copies are inserted above the
  original stack, without an arbitrary position offset.
- Link/unlink layers. Canvas drags and numeric X/Y movement translate selected and
  linked layers, including group descendants, exactly once. Any inherited lock
  blocks the whole movement. Scale/rotation and appearance edits remain per active
  object; links are movement relationships, not shared styling or a group transform.
- Drag a dedicated grip to insert a selected range on desktop or touch. A clear
  insertion line and continuous edge scrolling operate only during a drag.
  Pointer cancellation discards the move; arrows provide touch/keyboard alternatives.
  A base moves with its clipping chain, and another base cannot be dropped inside
  that chain. Individual clips can be reordered to change their base by position.
- Collapsible groups, nested creation and a Move selected to group control; group
  cycles, inherited locks, incomplete clipping stacks and existing nesting limits
  are checked. Grouping requires a consecutive sibling range. Isolated groups with
  an outside blend dependency are refused rather than changing appearance silently.
- Visibility, locks, link/clipping indicators, actual worker-rendered thumbnails,
  right-click and keyboard-accessible action menus. Thumbnail work is debounced,
  uses a separate cancellable worker and bounded bitmap scale, and owns/revokes
  its URLs. The artwork plane receives no decorative animation.
- Delete applies to selected roots and descendants. Deleting a clipping base also
  deletes its dependent clips as one undoable operation, avoiding accidental release
  of previously hidden paint across the canvas. Unlink cleanup removes singleton
  links. Original assets are never deleted by these commands.

## Genuine merge behavior

**Merge selected** requires consecutive sibling roots and complete clipping stacks.
Group descendants are included automatically. The new native-size raster occupies
the selected range's original position; unrelated layers retain their order.
A single clipping stack/group can retain the root's opacity and blend on its raster
replacement. Ordinary Normal-mode spans merge against transparency.

A range with multiple backdrop-dependent root blends cannot in general be replaced
by one independent raster without changing its relationship to outside layers.
Such partial merges are refused with an actionable message: include the full stack
or use Merge visible. Nonconsecutive/cross-group selections are likewise refused.
These are explicit correctness guards, not approximate compositing or fake merge UI.

**Merge visible** bakes the real visible composite and document background at native
resolution. Hidden content is retained in its relative order; a visible ancestor
needed by hidden descendants becomes a hidden retained group. The merged raster is
placed above that retained hidden content. Revealing a retained layer later places
it behind the merged raster; Undo restores its original full stack and visibility.

**Flatten image** requires an accessible confirmation. It replaces all layers,
including hidden content, with the native-resolution visible result. The retained
original source stays available; locked layers are included only by this explicit
flatten action. Other editing/merge commands respect locks.

Every merge is a real worker-rendered PNG plus an atomic metadata/history action,
not a screenshot of the bounded preview. Before returning a result the worker renders
the old and proposed documents at native size and checks RGBA appearance. Greater
than one 8-bit channel step of difference is refused; a single step accounts for
Canvas/PNG premultiplication/unpremultiplication rounding. Transparent RGB is ignored
only where both pixels have zero alpha. Unsupported combinations never publish a
partially modified document. Cancellation terminates processing; validation/storage
budget failures leave all original layers/assets unchanged.

Each successful structural/destructive operation is one Undo/Redo entry. Immutable
assets are retained for history, original recovery and native export. History is still
bounded to 50 metadata states and is session-only: export an editable backup before
flattening if you need the previous layers after closing/reopening.

## Compatibility, limits and validation

No dependency versions, Vite/Nitro/Vercel settings, tslib fix, environment variables,
cloud credentials or legacy storage schemas change. The existing 48-layer,
64-asset/48MB, 16 MP desktop / conservative 4 MP device and 16384px-side limits remain.
This is a bounded Canvas 2D worker compositor, not a tiled/unlimited-resolution or
GPU layer engine. Clipping and merge verification need additional bounded temporary
surfaces; low-memory phones can still require smaller documents. Native export and
existing chapter strip workflows remain available as alternatives.

Run:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run check:build
npm run preview:restart
npm run test:layers:browser -- http://127.0.0.1:8081
npm run test:pro:browser -- http://127.0.0.1:8081
```

The new pure tests cover chain ordering, alpha/blends, visibility/groups, native
round-trip, deep duplication, locks, linked translation, group cycles, insertion,
merge planning, hidden retention and history. The real browser suite exercises
worker pixels, clipping with raster/paint/text/transformed group bases, an independent
Canvas blend reference, exports, merge/flatten confirmation, Undo/Redo, native reopen,
links/locks, context menus, desktop insertion and native CDP touch reordering/recovery
at 320/390px. Existing Pro tests continue to cover source-resolution selections,
Clone Stamp/Healing Brush and all existing painting, masks, exports, cancellation,
quota failure, draft conflicts and safe chapter/AI handoffs. Run the existing editor,
adjustment, workflow, retouch, UI, studio inference and dev/production smoke suites too.

Chromium touch emulation is not physical Android testing. Other browser engines,
physical-device memory stress and paid cloud model output require separate validation.
No cloud inference or artwork upload is needed by this milestone.

## Delivery validation (2026-10-20)

- `npm ci`, application/config TypeScript, direct `npx tsc --noEmit`, ESLint,
  production build, Vercel output/tslib checks and `git diff --check`: passed.
- Full `npm test`: 353 passed (200 scripts, 59 shared, 40 existing studio,
  54 Pro). ESLint reports only the existing shared Button Fast Refresh warning.
- New layer and existing Pro production browser suites: passed, including real
  clipping controls, keyboard activation, merge cancellation, native persistence,
  image formats and native touch. Existing editor, adjustments, workflow, retouch,
  UI/reduced-motion and real Swin2SR inference browser suites also passed.
- Development/production desktop/mobile smoke: visible content, clean consoles,
  no horizontal overflow and no final baseline divergence. The lazy optional 3D
  companion required an explicit readiness selector for stable comparison. The
  existing generic canvas/game-card branding warnings remain; no application
  branding or unrelated homepage behavior was changed. An initial UI navigation
  timeout passed on an unmodified rerun.
- Chromium was used through the existing Playwright fallback because agent-browser
  was unavailable. No physical Android, alternate browser engine, paid cloud
  output or sustained-device performance result is claimed.
