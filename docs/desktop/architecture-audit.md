# Architecture audit (pre-conversion)

Audited commit: `140ac65` (main, "Merge pull request #40: Freeform fade editor"), on
Windows 11 Pro 26200, Node 26.13 / npm 11.20. Everything below was read from the code,
not from the docs.

## Stack

| Area | Implementation |
|---|---|
| UI | React 19, TypeScript 5.7, Tailwind 4, Radix UI primitives, lucide icons |
| App framework | TanStack Start 1.168 + TanStack Router (file routes in `src/routes`) |
| Build | Vite 8 (Rolldown), Nitro 3 `vercel` preset for the website |
| State | zustand store `src/lib/studio/store.ts` (library, chapters, panels, import jobs) plus per-editor controllers (composition controller, Raster history) |
| Persistence | IndexedDB only, in the browser profile (details below) |
| Graphics | Canvas 2D / OffscreenCanvas, Web Workers (enhance, faces, color, page split, OCR), WebAssembly (onnxruntime-web, tesseract.js, libheif-js, @jsquash/jxl, utif2), WebGL via three.js for 3D references |
| Server | One server route: `POST /api/studio/ai-edit` (optional cloud AI erase/face correction through OpenAI with an owner access code). Auth/cloud accounts were removed in PR #37; their modules remain but are not mounted. |

Routes: `/` (Library), `/p/$projectId` (project and chapter list),
`/p/$projectId/c/$chapterId` (chapter workspace: Images, Text & Bubbles,
Composition & FX, Raster/Pro Studio, image editor).

## Persistence model (the most important finding)

| Database / store | Contents |
|---|---|
| `inkstrip` v2: `projects`, `chapters`, `panels`, `blobs`, `nativeRestores` | Project and chapter metadata; panel records with original/edited media references and image-editor drafts; every image as a Blob; chapter `composition` documents (spacing, extensions, fades, transitions, SFX, objects, presets) stored on the chapter record with their own revision counter; stitched strips; staged native restores. |
| `inkstrip-pro` v5: `sessions` | One native Raster/Pro document per panel (layers, masks, adjustment layers, smart filters, vector paths, text, assets as Blobs), saved with optimistic revisions. |
| Raster checkpoint DB (`pro/recovery.ts`) | Crash-recovery checkpoints of open Raster documents. |
| Cache Storage | Downloaded AI models (Swin2SR, Real-ESRGAN) and OCR language data, SHA-256 verified. |
| localStorage | UI preferences, brush presets, color lab state (not project content). |

Every write path is transactional (`commitPanelMedia`, `commitChapterStrip`,
`commitPanelOrder`, `commitChapterImages`, composition revisions), and malformed records
are quarantined, not deleted. All editors autosave into IndexedDB within ~0.5 s and guard
`beforeunload` while a write is pending.

The existing single-file project backup (`src/lib/studio/backup.ts`,
`.inkstrip-project`) already serializes *everything a project owns* — records, every
referenced blob, composition documents, character references and native Raster sessions —
with strict validation on decode and an atomic, non-overwriting restore. This made it the
right foundation for the desktop `.inkstrip` format and for web → desktop migration.

## Feature inventory

Status legend: ✅ fully functional · ◐ partial · ✖ broken · — not implemented ·
🌐 internet-dependent · 🖥 desktop-incompatible (before this work).

| Feature | Status (website) | Notes |
|---|---|---|
| Project library, create/rename/delete projects | ✅ | |
| Chapters: create/rename/delete, ordering | ✅ | Delete left Raster documents behind (fixed, see compatibility report) |
| Image import (JPEG/PNG/WebP/AVIF/GIF/HEIC/JXL/TIFF), import report, retry, cancel | ✅ | Bounded decode policy, staged transactional import |
| Panel ordering, drag/move, reorder undo | ✅ | |
| Display/stitch vertical strip, page split | ✅ | |
| Image editor (crop, rotate, adjustments) with drafts | ✅ | |
| Raster/Pro Studio: layers, masks, brushes, selections, transforms, filters, adjustment layers, smart filters, gradients, layer effects, vector paths, text, artboards, history | ✅ | Large engine (~30k lines + 18k UI) |
| Text & Bubbles chapter editor, dialogue OCR | ✅ / 🌐 | OCR language data downloads on first use |
| Composition & FX: spacing, extensions, fades (freeform editor), transitions, Manhwa SFX, presets, preview, export | ✅ | |
| Retouch: local texture repair | ✅ | |
| Retouch: cloud AI erase / face correction | 🌐 / 🖥 | Server route + owner access code; cannot run from static files |
| AI enhance (Swin2SR, Real-ESRGAN anime) | ✅ / 🌐 | Models download on demand, then cached |
| Faces / characters references | ✅ | Local cascade detector |
| Exports (images, ZIP, native documents, backups) | ✅ | `<a download>` of blobs |
| Project backup / restore | ✅ | `.inkstrip-project` |
| Offline use | ◐ | Loads from Vercel; offline only after a visit |
| Native files, autosave to disk, recent projects | — | Browser storage only |
| Windows app | 🖥 | `apps/desktop` was a Tauri shell that loaded the live website and failed offline |

## Network dependencies

- Required at runtime of the website: the Vercel deployment itself.
- Optional: Hugging Face (AI models), raw.githubusercontent.com (OCR data),
  api.openai.com via the server route (cloud AI), GitHub API (Download App dialog).
- No analytics or other third-party calls were found.

## Tests found

1,212 Node unit/integration tests (`npm test`: script tests, app-data, studio, Pro,
composition), ~60 Playwright browser suites under `scripts/*-browser-check.mjs`
(require a dev server), CI on ubuntu (typecheck, lint, test, build, check:build) and the
native-apps workflow. See [pre-conversion-tests.md](pre-conversion-tests.md).
