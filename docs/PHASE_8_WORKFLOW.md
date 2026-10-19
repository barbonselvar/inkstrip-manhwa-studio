# Phase 8 — Presets, batch editing and recovery

Save current tone preset in Edit Image → Adjust. Presets store validated global
filter values only, within the current project (up to 40). Applying a preset is an
undoable draft action; geometry/masks are unchanged. Remove only explicitly chosen
presets. Character profiles and presets use read/update/write transactions so edits
to either field preserve the other.

Batch edit selected opens a real first-image before/after preview. Choose a saved
preset or set brightness, contrast, exposure, saturation, temperature, blur,
sharpening and noise values. 100% scale preserves native dimensions; 10–200% is
bounded by device rendering limits. Apply explicitly saves sequential PNG results
through the existing tiled worker and atomic media transaction. The queue shows
per-image rendering/save stages, completed/failed items, cancellation and failed-
only retry. A bad image does not destroy successful work. Cancel terminates the
current renderer, preserving completed saves; saving an atomic result cannot be
interrupted. Originals remain recoverable. Already-completed batches cannot be
accidentally run twice from the same dialog. Cancelled/skipped work can be selected
again in a new dialog; retry uses the same settings and original snapshot revision.

The core editor autosaves **recipe metadata only**, after 600ms of inactivity.
Reload/reopen recovers a valid interrupted draft tied to the same accepted blob.
Save accepts it; Cancel and explicit Discard clear it. Autosave never replaces
accepted artwork. Media commits clear old drafts. Quota/missing-source errors are
visible; storage failure does not accept or corrupt an image. In-session undo/redo
continues to work; undo stacks and retouch/AI preview candidates are not persisted.
Use one editor per image: multiple tabs editing the same draft have last-writer
metadata semantics, while accepted media writes enforce blob revision checks.
Browser IndexedDB/site storage remains origin-specific and is not cloud sync or a
substitute for artwork backups. Closing before the debounce finishes can lose the
last unsaved movement; the UI shows when a draft is stored.

Blob removal now computes all surviving panel, original, recipe, draft and strip
references inside the same deletion/media/strip transaction. Shared blobs are not
deleted when another panel changes. Character crops are stored independently.
Image ordering reads latest panel records; autosave similarly preserves latest
order/media. No schema version increase or user-data migration/reset is needed.
New strip metadata records exact accepted blob revisions, avoiding timestamp ties
when detecting stale output. Old strips retain compatible timestamp checks.

Export accepted/original images · native downloads existing blobs without resizing
or recompression, explicitly labeled and numbered in current chapter order. The
browser may ask permission for multiple downloads. Chapter export continues to use
accepted edits and rejects stale previews until Display rebuilds them. PNG offers
lossless stitched output; existing JPEG uses quality .92. Very tall chapters still
use existing device limits/parts and width notices; native individual files are the
alternative when a full chapter cannot fit. Stitching decodes/releases one source
bitmap at a time instead of retaining every source in a part. The full output canvas
still must fit the device. ZIP/WebP chapter export and panel split/merge are outside
this phase's requested core workflow and are not claimed.

Chapter navigation now includes a direct chapter selector; width (320–4096px) and
spacing (0–512px) have precise controls alongside existing presets. Existing E,
Ctrl/Command+S/Z/Shift+Z and accessible reorder arrows remain; Escape cancels a grip
drag. Existing dark tokens, responsive properties panels and mobile controls remain.

Validation: desktop/mobile browser tests verify persistent presets, recovery without
accepting pixels, batch native PNG + original retention, shared-blob survival,
chapter order/undo/export and downloads. Baseline editor/adjustment regression suites
continue to pass. Cancellation stops the worker or network request; optional cloud
billing/processing may continue remotely. No physical Android, external GPU or paid
AI inference quality test was available. Automation uses explicit polling for async
IndexedDB results, avoiding the installed Playwright async waitForFunction quirk.
