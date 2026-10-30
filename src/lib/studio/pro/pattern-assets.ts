import { imageLease, safeBitmap } from "../image-decode.ts";
import { imagePolicy, preflightImage } from "../image-policy.ts";
export const PATTERN_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const PATTERN_TYPE_ERROR = "Bitmap patterns accept PNG, JPEG and WebP images.";
/** Bitmap pattern budget: up to 512px per side, 2MB, one frame. */
export function patternPolicy() {
  return {
    ...imagePolicy(true),
    maxPixels: 512 * 512,
    maxSide: 512,
    maxBytes: 2_000_000,
    maxFrames: 1,
  };
}
/** Preserve the imported bytes. Header budgets apply before any pixel allocation. */
export async function importPatternBitmap(file: Blob, signal?: AbortSignal) {
  if (!PATTERN_TYPES.includes(file.type)) throw Error(PATTERN_TYPE_ERROR);
  const policy = patternPolicy();
  const info = await preflightImage(file, policy, signal),
    release = await imageLease(signal);
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await safeBitmap(file, { policy, signal });
    if (bitmap.width !== info.width || bitmap.height !== info.height)
      throw Error(
        "This pattern has rotated EXIF axes. Export an orientation-normalized PNG copy before importing; nothing was resized.",
      );
    return { blob: file, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap?.close();
    release();
  }
}
