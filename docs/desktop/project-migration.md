# Project format and migration

## `.inkstrip` project files

A `.inkstrip` file is the studio's existing validated single-file container
(`src/lib/studio/backup.ts`): `INKSTRIP-BACKUP\n` · header length · JSON header · every
referenced blob in header order. It contains everything a project owns:

- project (title, dialogue/editing presets, composition presets, character profiles with
  reference images)
- chapters (settings, panel order history, stitched strips, **composition documents**:
  spacing, panel extensions, fades, transitions, SFX/objects, layer flags)
- panels (current image, preserved original, edit recipe and source, image-editor drafts)
- native Raster/Pro documents (layers, masks, adjustment layers, smart filters, vector and
  text layers, assets)
- every image, byte for byte

On open, every record is schema-validated, every image is decoded under the image policy,
dimensions are checked against their headers, and the project is written in one
IndexedDB transaction or not at all. The desktop main process additionally rejects a file
whose blob sizes do not add up exactly to its length (truncation/padding) before the
renderer reads it.

App-level preferences (UI appearance, brush presets, color lab) live in the app profile,
not in project files.

## Moving projects from the website (or the old Tauri app)

Automatic transfer is not possible: the website's IndexedDB belongs to the
`inkstrip-manhwa-studio.vercel.app` origin inside your browser profile, which a desktop
app cannot (and should not) read.

1. On the website, open the project → **Backup** (top right). This downloads
   `<title>-<date>.inkstrip-project` — the same container.
2. In the desktop app: **File → Import Website Backup…** (or drag the file onto the
   window, or double-click it — `.inkstrip-project` is associated with the app).
3. The project appears in the library. Press **Ctrl+S** to save it as an `.inkstrip`
   project file wherever you like.

Verified: website-format backups and `.inkstrip` files share the decoder; the E2E suite
reopens a saved file in a brand-new profile and compares every record and every image
hash (identical). A backup exported from the live website was **not** tested in this
session (no access to a real user's website data); the format and code path are the same.

## Opening a project that is already in the workspace

| Situation | Behaviour |
|---|---|
| Same file, no unsaved changes, file unchanged | Opens the workspace copy |
| Same file, no unsaved changes, file changed elsewhere | Reloads from the file |
| Workspace copy has unsaved changes / belongs to another file / was never saved | Asks: **Keep workspace version** or **Open the file**. Opening the file first writes the workspace copy to *Recover Autosaved Work*, and rolls back if the replacement fails |

**Revert to Saved File** works the same way (the current workspace copy is kept in
recovery first).
