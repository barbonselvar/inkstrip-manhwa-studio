# Inkstrip Pro architecture and implementation plan

Verified base: `0551f0dfbddc32977b7160d77d6dd53c9da545bb`, GitHub main.

## Existing system audit

React 19 / TanStack Start and file routes (`/`, `/p/$projectId`, chapter route)
run on Vite 8, TypeScript strict and Nitro's Vercel preset. Outfit/Fraunces and
Ink & Light CSS provide the existing design language. Shared Radix dialogs,
buttons and appearance preferences remain authoritative. No auth or server DB is
needed for browser-local artwork.

`src/lib/studio/store.ts` is the Zustand chapter/library state. IndexedDB
`inkstrip` v1 stores projects, chapters, panels and blobs. Panels retain original,
accepted image, edit recipe and interrupted draft references. `db.ts` commits
media and chapter revisions atomically with expected-blob checks and protects
referenced blobs from garbage collection. Chapter order has independent undo.

The image editor's geometry/history/adjustments and worker support crop, rotation,
layout, masked filters, source recovery and bounded metadata history. Workers use
OffscreenCanvas and transfer image bitmaps. `images.ts` stitches tall chapters
into bounded strips. Accepted media revisions invalidate chapter previews;
workflow export supports original/native accepted images, PNG and ZIP.

Enhancement is genuine Swin2SR ONNX WASM in a worker. Retouch has selection masks,
traditional local texture synthesis and an explicit-consent optional server-side
OpenAI editing path. The trained anime cascade proposes faces; character identity
is manually confirmed. Character profiles/references and reusable presets belong
to projects. Batch editing is controlled and cancellable. None of these engines
need replacement for a layered document editor.

Existing checks: TypeScript for app and configs, ESLint, Node unit suites,
editor/adjustment/workflow/retouch/studio/UI Chromium tests, dev/production smoke,
Vercel Build Output API checks and bundled tslib verification. Keep Nitro's
`noExternals: ["tslib"]`, server middleware, PWA and deployment configuration.

## Milestone boundary and architecture

Deliver one independently useful layered-document milestone: foundation (A),
workspace (B), core raster/masks/adjustments (C), core vectors/text/paths (D),
editable bubbles and safe chapter integration (E), links to existing AI tools
(F), and bounded worker/mobile/persistence/export QA (G). This is not Photoshop
or Illustrator parity. Detailed implemented/deferred capabilities are recorded
in the final report, with no decorative controls for missing engines.

- New `pro/` modules isolate document validation, geometry, file formats,
  transactional storage and compositing from legacy engines.
- Version 1 document metadata references immutable raster assets owned by the Pro
  session. History stores metadata, not repeated full-resolution pixel buffers.
- Separate IndexedDB `inkstrip-pro` v1 stores self-contained sessions. This avoids
  migrating legacy records or introducing references that old chapter GC cannot
  understand. It also means Pro assets remain safe if accepted media is replaced.
- Creating a Pro document from a legacy panel copies its current accepted Blob;
  it never changes the old record. Existing original recovery stays intact.
- Pro draft saves use a transaction and revision compare. An external tab conflict
  reports an error; no last-writer overwrite. Closing waits for pending writes.
- Applying a composite first saves the editable document, then calls the existing
  `replacePanelImage` with an expected media revision. A changed chapter image
  blocks application; the Pro document can still be exported/recovered.
- Native `.inkstrip` JSON includes validated metadata and embedded PNG/JPEG/WebP
  assets. It does not run scripts or fetch remote image URLs. It is not PSD/AI.
- A lazily loaded, original Pro dialog uses the existing design tokens. Canvas
  navigation/selection use explicit coordinate transforms; zoom is UI state.
- The worker reuses decoded assets and transfers bounded preview bitmaps. Raster
  exports render at document dimensions, subject to honest memory/side limits.
  Cancellation terminates the worker and releases its resources.

No existing schema, environment variables, provider settings, deployment config
or dependency versions should change. The native document is an additional backup;
Git patches do not back up browser IndexedDB. Existing AI stays explicitly local,
traditional, or optional cloud with consent; no paid inference is run silently.
