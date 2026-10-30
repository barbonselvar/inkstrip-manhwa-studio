# Image picker

A single gallery-style picker (`src/components/studio/picker/image-picker.tsx`) is used for
every user image import. It sits **in front of** the existing pipelines and doesn't replace them.

| Entry point                                                    | Mode     | Hands files to                                                              |
| -------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| Chapter workspace › Add images                                 | multiple | `useStudio().addImages` (unchanged import pipeline)                         |
| Raster Studio › Assets › Import image / SVG / native           | single   | `importFile` (layer import, undo/redo)                                      |
| Face Fix › Upload cropped reference                            | single   | `saveReference`                                                             |
| Raster › Layer styles › Pattern Overlay › Choose pattern image | single   | `importPatternBitmap` (512px / 2MB / one frame, same policy shown on tiles) |

Drag-and-drop and paste on the Chapter workspace still import directly, as before.

## Behaviour

- **Phones (< 48rem):** a bottom sheet with a drag handle (drag down to dismiss), a 3-column grid
  (4 from 30rem), a sticky footer and 44px touch targets. **Desktop:** a centred dialog
  with an auto-fill grid. You can drop or paste files anywhere in the picker.
- **Sources:** _Photo library_ uses `accept="image/*"`, so Android Chrome opens the system
  Photo Picker and iOS opens the Photos sheet. _Browse files_ uses the full format list
  (TIFF, JPEG XL, HEIC…). On desktop, multiple-selection pickers also offer _Open folder_
  (`webkitdirectory`): every image in the chosen folder appears in the grid in natural page
  order. No device album is enumerated, and no extra permission is requested. See
  `docs/NATIVE_GALLERY.md` for exactly what browsers allow and the native-app plan.
- **Views:** Photos (everything you chose this session), Collections (one per pick, drop or
  paste), Recent (files chosen earlier in this tab, kept only in memory, clearable) and
  Selected (import order, with move up/down, _Sort by name_ and remove).
- **Validation:** each file runs through the shared header-only `preflightImage` policy (type,
  encoded size, dimensions, frames, memory). Invalid files show the reason and can't be
  selected. The import pipeline re-validates as before. A file chosen twice (same name, size
  and type) is skipped. Chapter images over the Raster budget are marked _Large page_, which
  offers the existing lossless split after import. Nothing is resized or re-encoded.
- **Thumbnails:** only tiles near the viewport are rendered (IntersectionObserver plus
  `content-visibility`), at most two at a time. Each is made with
  `createImageBitmap(…, { resizeWidth, resizeHeight })` and kept as a small WebP blob URL.
  All URLs are revoked on removal, cancel and close. HEIC/TIFF/JXL show a format
  placeholder because they are converted only on import.
- **Host isolation:** keys pressed inside the picker stop at the sheet, so host shortcuts
  (Raster Studio's Delete-layer, tool letters, arrow nudges) can't act on the document
  underneath.
- **Accessibility:** Radix dialog focus trap, Escape (it closes the preview first), and focus
  returns to the button that opened the picker. Tabs use arrow keys. In the grid, arrows, Home
  and End move focus, Enter or Space toggles, P previews and Delete removes. Every tile has a
  label stating whether it is selected, its position and any error. Animations follow
  reduced-motion settings.

## Tests

- `src/lib/studio/picker/picker.test.ts` (in `npm run test:studio`) covers selection, order,
  duplicates, rejection, limits, recent files, keyboard grid moves, URL cleanup and policy reuse.
- `npm run test:picker:browser [base]` runs the real Chapter and Raster flows in Chromium:
  open/close, multi/single selection, preview, cancel (imports nothing, leaks no URLs), ordered
  import, key isolation over Raster Studio, the pattern-swatch budget, desktop folder import
  in natural order, plus layouts at 320/360/390/768/1440px, drag-to-dismiss and reduced motion.
  CI runs this suite in the _Raster continuity browser checks_ workflow.

## Platform notes

- Browsers don't let web apps browse device albums. The "Collections" and "Recent" views
  only reflect files the user has chosen.
- Whether `image/*` opens the native photo picker depends on the OS and browser. Others fall
  back to the standard file chooser.
- `createImageBitmap` resize options decode at reduced size in Chromium. Some engines decode
  in full internally before downscaling. In either case only the small thumbnail is kept.
