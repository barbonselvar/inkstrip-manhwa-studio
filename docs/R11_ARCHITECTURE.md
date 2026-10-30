# R11 architecture

R11 is a hardening release. It changes no native schema (schema 3 / envelope 9),
no IndexedDB version (Pro storage 5, recovery 1), no rendering algorithm and no
resource limit. No AI loading, inference or application code changed.

## 1. Open-time asset compaction

```
loadSession(panelId)            stored record: document + full Blob pool
  └─ compactOpenedSession()     keep = documentAssetIds(document)   (pure, in memory)
       └─ validateOpeningSession()   same validation as R10 (fails closed)
            └─ install()        fresh history; clone source cleared unless its asset is in the pool
                 …first ordinary edit → saveSession(compacted, revision)   (atomic, optimistic)
```

- `compactOpenedSession` (`src/lib/studio/pro/asset-references.ts`) reuses the
  **same traversal as native export**: current layers (hidden included), the
  retained original source, Clone Stamp strokes on layers and masks, and bitmap
  Pattern Overlay assets. A document that survives a native export/import round
  trip therefore survives compaction; unit tests assert byte-identical native files.
- **Why only at open.** It is the one moment the stored document is provably the
  only root. Undo/Redo is not persisted; the new session has no transaction,
  pending pixel stage, worker job or sampled clone source; recovery checkpoints
  are self-contained native copies in a separate database; native exports are
  files. During a session those roots exist and are not lease-tracked, so
  in-session deletion remains deferred (R10 B3 boundary unchanged).
- **Persistence.** Opening never writes. The compacted pool reaches IndexedDB
  through the next normal `saveSession`, which keeps R10's revision and recovery
  lineage checks: a concurrent tab still gets the existing conflict error, and an
  interrupted save leaves the previous complete record. A conflicting tab keeps
  its own in-memory pool, so nothing it references can be lost.
- **Fail closed.** Missing references are not hidden: compaction keeps every
  referenced ID, and `validateOpeningSession` then rejects the draft exactly as in
  R10. A refused draft is not installed and its stored record is untouched.
- **Clone source (defensive).** `ProWorkspace` is not keyed by panel, so its
  sampled clone source is React state that can outlive a session install (for
  example a retried or re-run open effect). `install()` now clears a clone source
  whose asset is not in the installed pool, so a compacted-away sample can never
  be painted. No user-reachable path that switches pages under a live workspace
  was demonstrated; this is hardening, not a reproduced defect.

## 2. Command palette

```
commands.ts (pure)     INSPECTOR_PANELS, inspectorPanels(mode, dialogue), panelLabel,
                       searchCommands(commands, query)
pro-workspace.tsx      offeredTools / toolDisabled / openToolSettings (extracted from inline JSX)
                       commands[] → ProCommandPalette → runCommand(id) → existing handlers
pro-command-palette    Modal (Radix focus trap, Escape) + ARIA combobox/listbox
```

- The tab bar and the palette share `inspectorPanels()`; the tool rail and the
  palette share `offeredTools` and `toolDisabled()`. A command cannot be offered
  in a mode where its button is hidden, or enabled where its button is disabled.
- `runCommand` dispatches to `chooseTool`, `setTab`, `actions.current.undo/redo`,
  `saveNow`, `changeRulers` and `openToolSettings` — the same functions the visible
  controls call. No new document operation exists.
- Search is deterministic: every query word must prefix a word of the label or
  keywords (NFKD, diacritics folded, Unicode letters), ranked label-prefix,
  label-word, keyword, then original order.
- `Ctrl/⌘+K` is handled in the existing workspace key handler, so it inherits
  its guards (busy, pending dialogue, menus and alert dialogs).

## 3. Verification infrastructure

- `.github/workflows/r11-external.yml` — live production check against the
  current main SHA and the built Studio suite with real Hugging Face model
  download, on GitHub-hosted runners. Push to main re-verifies production.
- `scripts/r11-filter-memory-benchmark.mjs` — one child process per case,
  `resourceUsage().maxRSS` above the pre-faulted input, SHA-256 output equality.
- `scripts/r11-browser-check.mjs` — compaction through the real Clone Stamp UI
  and the palette at 1440/768/390/360/320 with real touch.
- `scripts/qa-offline-branding.mjs` — opt-in `--import` preload for sandboxes
  that deny `grok.com`; fulfils only that origin (the platform's branding pill)
  with an empty script inside Playwright browsers. CI does not use it.

## 4. Unchanged boundaries

- Compositor: full-plane OffscreenCanvas pipeline. Smart Filter halo tiling for
  local integer kernels as in R10; measured benefit is for the Gaussian family only.
- Budgets: Raster 16.8MP desktop / 4MP touch, 16384 px per side; Smart Filters
  4MP and 128M taps; styles 4MP; asset pool 64 assets / 48MB.
- Arabic/RTL text on path: refused (`checkPathText`), prototype only.
