# Inkstrip Manhwa Studio for Windows — release notes

Each release has a `## <version>` section. The release workflow publishes exactly that
section as the GitHub Release notes, which installed apps show before updating.

## 1.0.0 — 2026-11-07

First Windows desktop release.

- The complete studio runs offline from the installed app: project library, chapters,
  image import, Raster Studio, layers and masks, filters, text and speech bubbles,
  Composition & FX (spacing, fades, transitions, SFX), ordering, undo/redo and exports.
  No website, internet connection or development server is needed.
- `.inkstrip` project files: Save (Ctrl+S), Save As (Ctrl+Shift+S), Open (Ctrl+O), recent
  projects, drag-and-drop and double-click to open. Saves are verified on disk and replace
  the file atomically; the previous version is kept as a backup.
- Autosave recovery snapshots, a recovery notice after an unexpected exit, and a prompt
  before closing with work that is not saved to a file. Nothing is discarded silently.
- Website backups (`.inkstrip-project`) open directly in the app.
- Optional, owner-approved automatic updates from GitHub Releases (signed builds only).
- Optional cloud AI edits with your own OpenAI key (off by default; stored encrypted).
