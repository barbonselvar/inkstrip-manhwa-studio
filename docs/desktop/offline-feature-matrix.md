# Offline feature matrix (desktop app)

✅ works offline · 🌐 needs internet (optional) · Tested = exercised in the automated
offline E2E run with the network disabled (`enableNetworkEmulation({offline:true})`) or
by hand in the installed app.

| Capability | Offline | Tested offline | Notes |
|---|---|---|---|
| Application startup | ✅ | Yes | Bundled renderer, no website |
| New project / chapters | ✅ | Yes | |
| Open existing `.inkstrip` / website backup | ✅ | Yes | Command line, dialog, recent, drag-and-drop |
| Image import | ✅ | Yes | |
| Raster/Pro editing, layers, masks, filters, transforms | ✅ | Partly | Studio opens; deep tool coverage relies on the existing unit suites |
| Text & speech bubbles | ✅ | Partly | Lettering works; **OCR** needs its language data once 🌐 |
| Chapter management, ordering | ✅ | Yes | |
| Composition & FX, fades, extensions | ✅ | Yes | Persists across workspaces, saves and reopen |
| Save / Save As / autosave / recovery | ✅ | Yes | |
| Undo / redo | ✅ | Partly | Editor histories unchanged; not separately scripted |
| Image and chapter export | ✅ | Yes | Composition export to disk |
| Local backups | ✅ | Yes | Previous version kept on re-save |
| Settings | ✅ | Yes | |
| Local texture repair (retouch) | ✅ | Not scripted | |
| AI enhance (Swin2SR / Real-ESRGAN) | 🌐 first use | No | Model downloaded once (2.5–54 MB, SHA-256 verified), then cached offline |
| Dialogue OCR | 🌐 first use | No | Tesseract language data, then cached |
| Cloud AI erase / face correction | 🌐 always | No | Off by default; user's own OpenAI key; sends the selected region only when the user runs it |
| Update checks | 🌐 | Offline behaviour yes | Offline → quiet "check later" state, never blocks work |

No feature blocks access to local projects when a service is unavailable.
