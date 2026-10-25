# Chapter Workspace fixes — single-image Display and universal image import

Branch `ccr-0263a389-9x1gkr` ·
[Draft PR #18](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/18) · Base `main` @
`740720c` (R5, including R1–R3). R7 (#17) was not merged when this branch was created. R6 (#16) and
PR #6 are untouched. Final SHAs and CI links are in the PR.

## 1. Root cause — single image not displayed

The planner and renderer (`planStrip`, `stitchChapter`) handle one image correctly. The problem was
an explicit two-photo rule in two places:

- `store.display()` returned `false` with "Check at least two photos, then press Display." when
  fewer than two photos were checked (and "Add another photo before stitching." in append mode).
- The **Display** button was disabled while `checked.length < 2`. The empty state repeated the rule.

So "1 of 1 checked" could never produce a page. Display now:

- Builds a page from **one or more** checked photos. One photo is shown on its own; two or more are
  stitched in reading order.
- Shows a specific empty state for each case: no images, nothing checked, or ready to display.
- Notes when the checked photos differ from the page shown. Changes to order, images or settings
  still mark the page stale, as before.
- Clears the page when every photo on it is deleted, instead of keeping removed artwork on screen.
- Validates saved page parts with the standard header policy when reloading, so a page stitched on
  a computer still appears on a phone with a smaller import budget.

Display also had a **resolution defect** with long images. A panel taller than one device canvas
was shrunk to fit, and the whole page was narrowed (down to 320 px) to avoid parts. On touch
devices (8192 px canvas side) a 1080 × 20000 strip was drawn about 350 px wide. Tall panels now
continue seamlessly into the next part at the full page width. The suite checks that pixel rows
are continuous across the break.

A page that is exactly one JPEG at its native size keeps the **original bytes** instead of being
re-encoded.

## 2. Root causes — failed imports (reproduced in Chromium before fixing)

| Input                               | Before (desktop / Android-like emulation)                       | Cause                                                                              |
| ----------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| HEIC/HEIF                           | "This browser could not decode the validated image" (both)      | The header passed, but Chromium, including Android Chrome, has no HEIC decoder     |
| TIFF (LZW, Deflate, alpha)          | same                                                            | Chromium has no TIFF decoder                                                       |
| JPEG XL                             | "This encoded image format is not supported"                    | Format not recognised                                                              |
| 1080 × 20000 PNG/JPEG (21.6 MP)     | imported / **rejected: exceeds the 16 megapixel device budget** | Any touch screen forced the constrained tier, even on high-memory phones           |
| Over-budget batch (e.g. 9 × 16 MP)  | **whole batch rejected**                                        | The aggregate budget aborted the import instead of splitting it                    |
| HEIC with a crop box (real cameras) | "decoded image dimensions disagree"                             | `image-size` mis-applies `clap` (32 × 24 reported as 63 × 64) or picks a thumbnail |
| Corrupted TIFF strips               | (after adding a decoder) garbage pixels without error           | utif2 does not detect corrupt LZW, PackBits or raw strips                          |

Truncated and non-image files were already rejected with specific reasons; that is unchanged.

## 3. Supported formats after the fix

| Format                                   | Handling                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| JPEG/JPG, PNG, WebP, AVIF, BMP, ICO, GIF | **Original file stored byte-for-byte.** Decoded by the browser.                                                                   |
| Safe SVG                                 | Unchanged: sanitized, original stored.                                                                                            |
| Animated GIF, animated WebP, APNG        | Original file stored. The **first frame** is used for thumbnails, Display, editing and export (documented policy).                |
| HEIC/HEIF                                | Decoded in a worker with libheif-js (primary image, rotation/mirroring applied), stored as **lossless PNG** of the decoded pixels |
| TIFF/TIF                                 | Decoded with utif2: first full-resolution page, EXIF orientation applied, alpha kept, data validated. Stored as **lossless PNG**  |
| JPEG XL                                  | Decoded with @jsquash/jxl (first frame), stored as **lossless PNG**                                                               |

The decoders load on demand in one worker chunk (about 2.2 MB, including libheif's WebAssembly),
only when such a file is imported. They are not part of the main bundle.

## 4. Remaining format limitations

- **Bit depth**: 16-bit TIFF and 10/12-bit HEIC samples are stored at 8 bits per channel. The
  import report says so for each affected file.
- **Metadata**: converted files do not carry EXIF/XMP/ICC metadata. Pixels are converted as
  decoded (sRGB assumed). Browser-native formats keep their original file, so their metadata
  remains in the stored bytes.
- **Multiple images**: multi-page TIFF and multi-image HEIC keep only the first page or primary
  image (reported). Animated JPEG XL keeps the first frame.
- **CCITT fax TIFF**: accepted only for 1-bit images (the only valid case). Old-style
  (pre-TIFF 6.0) LZW streams fail validation and are rejected with a clear reason rather than
  risking garbage.
- **Not supported**: RAW camera formats, PSD, PDF and EPS. They are rejected with "This encoded
  image format is not supported".
- **Licence**: `libheif-js` is LGPL-3.0. It is shipped unmodified as a separately loaded chunk.
  The project owner should confirm this suits the project's licensing.

## 5. File-size and pixel-dimension limits

The budgets themselves are **unchanged**; only the choice of tier changed. The tier now follows
the device memory the browser reports: below 4 GiB is constrained. If memory is not reported,
touch devices are constrained (Safari, Firefox).

| Limit                        | Standard (desktop; Android Chrome with ≥4 GiB) | Constrained     |
| ---------------------------- | ---------------------------------------------- | --------------- |
| Pixels per image             | 32 MP                                          | 16 MP           |
| Side length                  | 65,535 px                                      | 65,535 px       |
| Encoded file size            | 80 MiB                                         | 40 MiB          |
| Estimated decoded memory     | 512 MiB                                        | 256 MiB         |
| HEIC/TIFF/JPEG XL conversion | ≤ 32 MP (decoder estimate 16 B/px)             | ≤ 16 MP         |
| Files per import             | 250                                            | 250             |
| Atomic commit chunk          | 256 MiB / 128 MP                               | 128 MiB / 64 MP |
| Frames (animation)           | 64                                             | 64              |

What was verified in Chromium (emulation, not physical hardware):

- 21.6 MP strips import with touch emulation and high reported memory.
- With reported memory forced to 2 GiB, the same strip is refused: "exceeds the 16 megapixel device
  budget (21.6 MP). Split very long pages into shorter images and import them in order."
- A 36 MP strip is refused on the standard tier with the same guidance.
- A 9 × 16 MP (144 MP) batch imports in two chunks, in order, with one decode per file.

The 32 MP ceiling is locked by an existing policy test ("retains 32MP desktop and 16MP
constrained"), so it was not raised. Larger strips must be split before import.

## 6. Original-quality guarantees and exceptions

**Guarantees:**

- No downscaling or lossy recompression on import.
- Browser-native formats are stored byte-for-byte (tested for JPEG and WebP).
- Converted formats are stored as PNG with the **exact decoded samples**. Tested: lossless JPEG XL
  and LZW TIFF reproduce the reference pixels exactly; TIFF alpha is kept exactly.
- Thumbnails (240 px JPEG) are UI-only.
- Display parts are rendered at the chapter's page-width setting. Long panels are no longer
  narrowed.
- A single same-width JPEG page reuses its original bytes.

**Exceptions** (all disclosed in the import report or the UI):

- Bit-depth reduction and metadata loss for converted files.
- First frame only for animations.
- Page export uses the chapter's chosen width and format (an explicit user setting, unchanged).

The original file always remains on the user's device; import never modifies it.

## 7. Import pipeline and batch behaviour

For each file, in the order selected:

1. Validate the header and resource budgets.
2. Choose a native decode or worker conversion.
3. Decode, or convert then decode the result.
4. Generate a thumbnail.
5. Stage the image.

Staged files are published in budget-sized **atomic** IndexedDB transactions. A cancelled or failed
chunk adds nothing, and earlier chunks stay intact. A storage failure reports every unpublished
file. Every file ends up either imported or listed with a specific reason:

- unsupported, corrupted, too large, dimensions;
- storage, decode, conversion;
- access (for example an Android file moved or revoked), deferred.

**Retry** re-imports the failed files in their original order. The failed `File` objects are kept
in memory only.

## 8. Tests

**Unit:** `chapter-import.test.ts`, 13 tests:

- exact TIFF and JPEG XL pixels; HEIC fidelity against an independent decoder;
- lossless, exact-length PNG output that passes the app's own strict PNG validator;
- all 8 EXIF orientations; TIFF alpha, 16-bit and multi-page handling;
- TIFF corruption rejection (LZW structure, fax misuse, truncation);
- HEIF crop size and AVIF size; memory tiers;
- zero, one, several and tall stitch plans; seam across part breaks;
- import reason classification.

**Browser:** `npm run test:chapter-display:browser` at 1440 px, plus 390 and 360 px with touch
emulation, plus a 360 px low-memory run:

- empty state;
- the reported single-image case (Display 1, original JPEG bytes reused);
- multi-image order verified by pixel colour; reorder and selection notices;
- a mixed batch of WebP, HEIC, TIFF, JPEG XL, AVIF, GIF, BMP and alpha TIFF, with a corrupted JPEG
  and a fake PNG: order kept, two specific failures, Retry;
- injected quota failure, then a successful Retry;
- a 1080 × 20000 strip at full width, split across parts on touch devices;
- a 144 MP batch committed in chunks;
- a converted HEIC opened in Raster Studio at its real size;
- reload persistence; page cleared after deletion; no horizontal overflow; zero console errors.

**Updated existing suite:** `chapter-import-safety`, with two assertions changed to the new
required behaviour:

1. An over-budget batch imports in order with exactly one decode per file. It used to be
   rejected as a whole.
2. The "valid header, undecodable pixels" check uses a genuinely corrupt TIFF, because TIFF now
   converts.

The preflight API's aggregate rejection and the zero-decode guarantee are still asserted.

Regression results are in the PR description.

## Compatibility

- **No document or storage format change.** Converted images are ordinary `image/png` panels, so
  Raster Studio, Vector Studio, export, backup/restore, R3 brushes, R5 transforms and the future R6
  adjustments see normal PNG assets.
- Shared raster document schemas are untouched.
- The only file shared with R7 (`claude/r7-advanced-selection-masks`) or R6
  (`codex/r6-color-adjustments-filters`) is `package.json`, where each branch adds scripts or
  dependencies (additive conflicts).
