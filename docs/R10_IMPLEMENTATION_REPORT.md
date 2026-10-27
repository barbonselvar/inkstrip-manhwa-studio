# R10 implementation report

Development only. Draft PR [#23](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/23).
No merge or production deployment is authorized for this continuation.

## Recovered checkpoint

Codex recovered Claude Code's existing branch `codex/r10-stability-professional-raster`
at `b71d7b5e023472940508ea2a4344ea2218d03a75`. Main is the R9 merge
`401e9251775dcf4eb64f4447488f65f4e9ae2536`. All six audit fixes were published;
no R10 uncommitted work or completed browser-matrix evidence was available in this
workspace. The six commits are retained unchanged. No competing R10 branch or PR
was created. No Milestone B implementation or R10 reports were present remotely.
The persistence design in the user's handoff is being continued after source inspection.

## Milestones

| Milestone                                       | Status                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A: six audit defects                            | Verified: six recovered fixes plus completed device-area preflight; baseline matrix and post-fix native/mobile checks pass |
| B: checkpoints, save status, asset reachability | B1/B2 implemented and verified; B3 analysis verified, asset deletion deferred                                              |
| C: professional Raster improvements             | Pending                                                                                                                    |
| D: long-page capabilities and tiled processing  | Pending                                                                                                                    |
| E: mobile improvements                          | Pending                                                                                                                    |
| F: regression, security and performance         | Recovered full matrix passed; continuation verification ongoing                                                            |

See the architecture, audit remediation, test, performance and roadmap reports
beside this file. Statuses will be updated with actual execution results.

## Codex continuation: completing INK-AUD-005

A focused coarse-device probe found a missing case on both R9 main and Claude's
R10 HEAD: a 1080x5000 image passes Chapter import and global native validation, but
exceeds Raster's 4MP device budget. The workspace installed history and entered
ready before worker initialization refused it; autosave could then persist that
unrenderable draft. The new failure panel therefore did not handle this case.

`validateOpeningSession` reuses native validation and the renderer's resource
preflight, checking canvas/crop/output and retained source budgets before history
and autosave are installed. Both accepted-image opening and existing-draft
recovery use it. No limit, native schema or rendering algorithm changed.

The new five-width browser regression fails on the unchanged build and passes
on the fixed dev build. It verifies retry, absence of a partially opened draft,
byte-exact retention of an existing legacy draft and subsequent valid-image opening.
Claude's original audit assertions remain unchanged and pass.

## Milestone B continuation

- Confirmed primary-save snapshots use separate `inkstrip-pro-recovery` v1
  storage. Native schema3/envelope9 and Pro storage v5 remain unchanged.
- Self-contained native checkpoints preserve editable layers, masks, clipping,
  R6 settings and R8 definitions, with stable IDs and original image bytes. SHA-256
  covers native content and canonical identity/revision/timestamp metadata.
- Atomic header/Blob writes retain up to three versions per page within 144MB/64
  entries. Existing index metadata is verified before pruning; a concurrent index
  change aborts the new write. Late older workers cannot evict the latest page
  revisions by virtue of finishing later.
- Serialization, hashing and checkpoint I/O run in an independent worker. A bounded
  queue retains one active job and the latest request per page (up to eight queued
  pages). Primary durability does not depend on successful checkpoint storage.
- Recovery in History requires explicit confirmation, verifies the selected
  checkpoint and image budgets, and records one undoable native import. Active
  operations cannot redirect it. Prior source assets remain available for Undo.
- Save status distinguishes saving, unsaved, saved, failed and unavailable storage.
  Save and recovery actions are accessible at all five tested widths. Rendering
  progress stays separate in the footer. Mobile header controls have explicit
  grid positions and a zero-overlap browser assertion. Retry enters Loading
  atomically with its request.
- Native export and reachability analysis share the same asset traversal. Undo,
  Redo, pending/rendering/checkpoint roots have regression coverage. **No asset
  deletion is implemented:** UI clone sources and worker lifetimes need explicit
  leases before complete reachability can be proven.

If the primary draft itself is unreadable, recovery offers an integrity-verified
native download for import into a separate document. The damaged primary is
retained. Checkpoints share browser storage/eviction risk; portable backups remain
necessary. A failed checkpoint never turns an acknowledged primary save into a
false failure or silently overwrites another revision.
