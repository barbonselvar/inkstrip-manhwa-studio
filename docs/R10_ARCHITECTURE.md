# R10 architecture

## Existing contracts

Pro drafts remain in `inkstrip-pro` IndexedDB v5, store `sessions`, with inline
immutable raster Blobs. `saveSession` validates native data and checks the prior
revision and recovery identity inside a read/write transaction. Acknowledgement
occurs at transaction completion. The workspace serializes saves and compares the
acknowledged document with current history before reporting durability. Native
document schema 3/envelope 9, legacy readers/migrations, R6/R8 rendering, R3 brush
gestures and R5 transform transactions remain the baseline.

## Milestone B implementation (continuing the handoff design)

- Separate, versioned checkpoint database; no unnecessary Pro database upgrade.
- Snapshots originate only from confirmed saves. Reuse `nativeFile`/`readNative`
  rather than introducing a second native serializer or flattened PNG recovery.
- Record document/page identity, revision, source identity and timestamps. Verify
  bounded metadata, native content digest, source assets and image preflight before
  restoration. Commit checkpoint data atomically and retain bounded history.
- Checkpoint write failure cannot retroactively invalidate a successful primary
  save. Surface quota/unavailability and distinguish primary save status from
  checkpoint availability.
- Restoring into an open document requires explicit confirmation and is an
  undoable native import, with current immutable sources preserved and normal
  optimistic save protection. Corrupt recovery data must never replace artwork.
- Extend existing save acknowledgement state for Saving, Unsaved, Saved, Failed,
  Unavailable and recovery actions, including mobile and accessible announcements.
- Extract native export's asset traversal for current/history/transaction/render
  roots. Do not delete immutable assets until all live roots can be proven.

## Later investigations

Paintable Smart Filter masks and bitmap patterns must extend the existing R8
models and renderer. Any persistent extension must fence unsupported older readers.
Arabic text on a path requires shaped glyph runs and bidi ordering; the current
per-grapheme layout guard must remain until a faithful replacement is demonstrated.
Tiled processing must preserve existing limits until halo/border correctness,
bounded memory and cancellation have measured validation.

### Checkpoint trust and ordering

Checkpoint headers have schema1, UUID/identity fields, primary revision, accepted
source identity, optional restore lineage, saved/created timestamps, native byte
length, native SHA-256 and canonical-header SHA-256. Structural limits precede
asset serialization. Digests detect corruption; they are not authentication.
Native parsing remains the existing strict trust boundary, followed by real image
preflight/decoding before restoring into the open workspace.

Header and native Blob stores commit/prune in one recovery transaction. Digest
work runs outside the transaction. A metadata snapshot is verified, then compared
again under the write transaction; changes fail closed. Per-page candidate
selection uses primary revisions, independent of delayed worker completion.
Checkpoints are immutable by ID. The queue receives exactly `saveSession`'s
transaction-complete snapshot, preserving the existing optimistic primary revision
and recovery-lineage checks. A late acknowledgement cannot cross page/lineage.

A working-document restore freezes active edits, verifies identity and resource
budgets, namespaces immutable assets using `mergeNativeSession`, and adds one
existing history step. The normal autosave then performs optimistic persistence.
No competing save/Undo engine, primary-store migration or flattened recovery PNG
was introduced. Unreadable-primary recovery is portable export/import rather than
automatic replacement of a damaged record.

### Reachability boundary

`documentAssetIds` is shared with native export. The analysis API accepts current,
Undo/Redo, transaction, render and checkpoint document roots, including hidden
layers and Clone Stamp/mask sources. Checkpoints own separate native asset copies.
The immutable primary pool is retained because all UI clone-source and worker
leases cannot yet be enumerated. Only bounded checkpoint versions are pruned.

## C1 continuation checkpoint

C1 reuses R3 clippedStroke and R7 selectionCanvas/coverageRegion. Draft strokes use the existing generic History; native masks use existing FilterMask.selection row-RLE. Source assets and document schema3/envelope9 are unchanged. Selection capture includes the source layer transform. Composite preview updates on stroke completion; grayscale draft preview updates during input. Native plane4MP, local50 strokes and64M estimated work caps fail closed.

## C2 continuation checkpoint

Bitmap Pattern Overlay extends only the strict effect record to version3. Document schema3/envelope9 and existing DB versions stay unchanged. The old reader rejects the unsupported effect version. Immutable asset references are included by the shared export/reachability traversal and remapped on native import. Imports are staged and bounded; texture interpolation is bilinear in premultiplied alpha. Procedural effects retain their version2 record and algorithm. Document-owned bitmap assets are prohibited in global presets/clipboard.

## Milestone D continuation

D2 immutable input/output planes remain full-resolution. Temporary neighborhood planes are bounded by256px tiles plus the exact kernel halo, clamped at true image edges. Gaussian-family uses ceil(3×sigma), Median/Surface use radius, and edge filters use1px. Fractional/global-coordinate/seeded algorithms use unchanged whole-plane processing. The scaled filter stack accounts for halo work inside128M taps, reverting to the existing path when overhead would exceed it. No native/schema change and no silently reduced resolution. General tiled compositing remains outside this safe extension.
