# Inkstrip Manhwa Studio — R11 release notes

R11 is a validation and hardening release. Native documents, storage versions,
image limits, rendering and AI behaviour are unchanged.

## Fixed

- **Pages no longer fill up with unused images.** Every merge, flatten, import,
  AI result, repair and Clone Stamp sample adds an image to a page's private
  storage, which holds at most 64 images / 48MB. Images that nothing used any
  more were kept forever, so a long-edited page could permanently refuse new
  work with "A Pro document supports at most 64 raster assets." — even after
  reloading. Now, when a saved page is opened, images that the document no
  longer references are released on the next save. Open pages keep everything
  their Undo history needs; the document, its pixels and its native export are
  unchanged. The status line says how many images will be released.
- **Error and limit messages read correctly.** 44 messages such as "up to4MP" or
  "exceeds128M kernel taps" now have their missing spaces.

## New

- **Command palette.** Press **Ctrl/⌘+K** or tap **Commands** in the context
  bar to search tools, inspector panels and document actions (Undo, Redo, Save
  draft, rulers, panels, Tool settings) by name. It offers exactly what the
  current mode's toolbar and panels offer, runs the same actions, and shows
  unavailable actions instead of hiding them. Works with touch at phone widths.

## Verified

- Live production was verified for the first time from an environment that can
  reach it (GitHub-hosted runners): the release marker matches main, the Chapter,
  Raster, export and real on-device AI Enhance (Swin2SR) workflows pass at
  desktop and phone widths.
- Documents written by R6, R7, R8, PR #21, R9 and R10 open, save, reopen and
  Undo/Redo unchanged; what R11 saves is byte-identical to what R10 saves and
  stays readable by the release that wrote the original.

## Not in this release

Arabic/RTL text on a path (still refused safely), a tiled document renderer for
pages above the device budget (use **Split into editable pages**), provider rate
and cost controls, PSD/OpenRaster, and 16-bit/wide-gamut colour. See
[R11_DEFERRED_FEATURE_REVIEW.md](R11_DEFERRED_FEATURE_REVIEW.md).
