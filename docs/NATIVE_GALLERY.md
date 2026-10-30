# Device gallery access: what is possible, what is not

## Current architecture

Inkstrip is a **web application**. It is a TanStack Start SSR app deployed on Vercel, with
server functions for cloud AI and an installable PWA manifest (`display: standalone`). There is
no native Android/iOS shell: no Capacitor, Cordova or TWA project, and nothing in
`package.json` provides one. All gallery behaviour is therefore limited by what browsers
allow.

## What the web release supports (shipped)

| Capability                                               | Chrome Android                                                                                                                                      | Safari iOS / iPadOS                                                                           | Desktop browsers                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Browse the device photo library in the **system** picker | Yes. _Photo library_ uses `accept="image/*"`, which recent Chrome on recent Android opens as the system Photo Picker (albums, search, multi-select) | Yes. `image/*` offers _Photo Library_ (system PHPicker sheet), _Take Photo_ and _Choose File_ | OS file dialog                                                                                         |
| Multiple selection                                       | Yes (Chapter)                                                                                                                                       | Yes (Chapter)                                                                                 | Yes                                                                                                    |
| Single selection                                         | Raster import, Face Fix reference, pattern swatch                                                                                                   | same                                                                                          | same                                                                                                   |
| Other formats (TIFF, HEIC, JPEG XL…)                     | _Browse files_ opens the file chooser with the full format list                                                                                     | _Choose File_                                                                                 | _Browse files_                                                                                         |
| A whole folder in the in-app grid                        | Not offered (no folder chooser on phones)                                                                                                           | Not offered                                                                                   | **Open folder** (`webkitdirectory`: Chromium, Firefox, Safari). Files are sorted in natural page order |
| Drag-and-drop, paste                                     | —                                                                                                                                                   | —                                                                                             | Yes                                                                                                    |
| Extra permission prompts                                 | None                                                                                                                                                | None                                                                                          | None (the folder chooser is itself the consent)                                                        |

After the user picks, every chosen image appears in Inkstrip's own grid (Photos, Collections,
Recent, Selected). There you get previews, validation, reordering and import.

## Can every device photo appear inside Inkstrip's own grid?

**Not from a website or PWA.** No browser API lists the device photo library:

- `<input type=file>` and the Android/iOS photo pickers return only the files the user selects.
  The page never sees the library itself.
- The File System Access API (`showOpenFilePicker` / `showDirectoryPicker`) is desktop-Chromium
  only. Even there it exposes only a folder the user picks, never the OS photo library.
- Installing the PWA does not grant media-library permissions on Android or iOS.

The picker therefore never pretends otherwise. "Collections" are the user's own pick, drop,
paste and folder batches, and "Recent" holds only files picked earlier in this tab (in memory,
never stored). Showing _all_ device photos in a custom grid needs a native app.

## If a full in-app gallery is wanted: native plan (not implemented)

**Recommendation: don't build it now.** The system pickers already give users a native way to
browse albums with no permission prompt. Full enumeration would add an app-store product, a
second release pipeline and, on Android, a policy review. Revisit this only if user research
shows the system picker is the bottleneck.

If it is approved, the lowest-risk route reuses this codebase:

1. **Wrapper.** Add a Capacitor 7 project (`android/`, `ios/`) in a separate package or folder.
   - Point `server.url` at the production origin, so SSR, server functions and AI keep working
     unchanged, _or_ ship a static client build with the AI endpoints called over HTTPS.
   - Keep the web release independent: the native shell must not change Vercel builds.
2. **Native media plugin** (a small custom Capacitor plugin, or a vetted community media plugin
   after a security review):
   - **Android 14+:** request `READ_MEDIA_IMAGES` together with
     `READ_MEDIA_VISUAL_USER_SELECTED`, so users can grant _selected photos only_. Query
     `MediaStore.Images` page by page (newest first, 100 per page) and return `content://` ids.
     Thumbnails come from `ContentResolver.loadThumbnail(uri, Size(320, 320))`.
   - **Android 13:** `READ_MEDIA_IMAGES`. **Android ≤12:** `READ_EXTERNAL_STORAGE` with
     `maxSdkVersion="32"`.
   - **Google Play:** under the Photo and Video Permissions policy, apps with only occasional
     photo needs must use the Photo Picker. A broad-access declaration must justify editing
     as the app's core purpose. Expect review; keep the Photo Picker path as the fallback when
     the request is denied.
   - **iOS 14+:** `PHPhotoLibrary.requestAuthorization(for: .readWrite)` with
     `NSPhotoLibraryUsageDescription`, respecting `.limited` (show
     `presentLimitedLibraryPicker` to let users add more). Fetch with `PHAsset.fetchAssets`
     sorted by creation date. Thumbnails come from `PHCachingImageManager` (target size about
     320pt, `.opportunistic`).
3. **Bridge to the existing picker.** Add a `nativeGallery` source that fills the same grid:
   - Tiles get native thumbnail URLs (`Capacitor.convertFileSrc`).
   - Full-resolution bytes are read **only on confirm**, then wrapped as `File` objects and
     passed to the unchanged `onConfirm`, so `addImages`, Raster `importFile`, validation,
     ordering, splitting and undo/redo behave exactly as on the web.
   - Paging uses the grid's existing lazy loading.
4. **Privacy.**
   - No background scanning, no uploads, and no caching of library metadata beyond the
     session.
   - "Manage access" links to the OS settings.
   - The partial/limited grant is a first-class state, and the web build keeps the
     current behaviour.
5. **Testing.** Physical Android 13 and 14 devices (full and partial grant), iOS 17+ (full and
   limited), denial and revocation while open, 5k+ photo libraries, and memory under paging.

Effort estimate: about 2–3 weeks of native work plus store setup and policy review.

## Testing note

The web picker was verified in Chromium with desktop and Pixel-7 touch emulation at
320/360/390/768/1440px. **No physical Android or iOS device was available in this
environment**, so the system Photo Picker and PHPicker sheets themselves were not
exercised. Those paths use the standard `<input type=file accept="image/*">` contract and
need a quick check on real phones after release.
