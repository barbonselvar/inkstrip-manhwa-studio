# R10 architecture

## Existing contracts

Pro drafts remain in `inkstrip-pro` IndexedDB v5, store `sessions`, with inline
immutable raster Blobs. `saveSession` validates native data and checks the prior
revision and recovery identity inside a read/write transaction. Acknowledgement
occurs at transaction completion. The workspace serializes saves and compares the
acknowledged document with current history before reporting durability. Native
document schema 3/envelope 9, legacy readers/migrations, R6/R8 rendering, R3 brush
gestures and R5 transform transactions remain the baseline.

## Milestone B plan retained from the handoff

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
