import { useSyncExternalStore } from "react";
import type { ProDocument } from "./pro/model";

/** Vector Studio is hidden from navigation while its features move into Raster Studio
 * (docs/VECTOR_TO_RASTER_MIGRATION_PLAN.md). Its code, its editing mode (which Dialogue
 * Studio also uses) and all saved documents are unchanged. Legacy access stays available:
 *  - automatically, inside Raster Studio, for documents that contain vector-only content;
 *  - on request, with `?vector=legacy` on a chapter link (remembered on this device). */
export const LEGACY_VECTOR_KEY = "inkstrip-legacy-vector-v1";
export const LEGACY_VECTOR_EVENT = "inkstrip-legacy-vector";

/** Content that only Vector Studio's tools and panels can edit (gradient paints in Appearance
 * stacks, vector clips, artboards). Raster Studio already edits paths, shapes, text, text
 * on a path (Typography tab), gradient layers and guides/snapping/alignment (Precision tab);
 * Dialogue layers belong to Dialogue Studio. None of those count. */
export function hasLegacyVectorContent(doc: Pick<ProDocument, "layers" | "artboards">) {
  if (doc.artboards?.length) return true;
  return doc.layers.some(
    (l) => !l.dialogueRole && (!!l.appearance?.length || !!l.vectorClips?.length),
  );
}

export function legacyVectorRequested(search: string) {
  return new URLSearchParams(search).get("vector") === "legacy";
}

function storedFlag() {
  try {
    return localStorage.getItem(LEGACY_VECTOR_KEY) === "1";
  } catch {
    return false;
  }
}

/** Enables legacy entry points on this device (also used by the `?vector=legacy` link). */
export function enableLegacyVector() {
  try {
    localStorage.setItem(LEGACY_VECTOR_KEY, "1");
  } catch {
    /* Private mode: the URL parameter still works for this page. */
  }
  window.dispatchEvent(new Event(LEGACY_VECTOR_EVENT));
}

function subscribe(change: () => void) {
  window.addEventListener(LEGACY_VECTOR_EVENT, change);
  window.addEventListener("storage", change);
  return () => {
    window.removeEventListener(LEGACY_VECTOR_EVENT, change);
    window.removeEventListener("storage", change);
  };
}
const snapshot = () => legacyVectorRequested(window.location.search) || storedFlag();

/** True when Vector Studio's legacy entry points were requested on this device. */
export function useLegacyVector() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
