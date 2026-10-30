import { browserImagePolicy, preflightImage, type ImagePolicy } from "../image-policy.ts";
import type { PickerItem } from "./selection.ts";

export type PickerValidation =
  | { ok: true; width?: number; height?: number; note?: string; kind?: PickerItem["kind"] }
  | { ok: false; reason: string };

/** Policy messages end with a generic suffix that is noise inside a small tile. */
export function shortReason(message: string) {
  return (
    message.replace(/\s*Image was not decoded or imported\.\s*$/, "").trim() || "Unsupported image."
  );
}

/**
 * The shared header preflight (type, encoded size, dimensions, frames, memory).
 * Reads headers only; no pixels are decoded. The import pipeline re-validates.
 */
export async function defaultValidate(
  file: File,
  signal: AbortSignal,
  policy: ImagePolicy = browserImagePolicy(),
): Promise<PickerValidation> {
  try {
    const info = await preflightImage(file, policy, signal);
    return { ok: true, width: info.width, height: info.height };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return { ok: false, reason: shortReason((error as Error).message) };
  }
}
