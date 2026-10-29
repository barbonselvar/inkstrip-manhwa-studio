import type { ProDocument, ProSession } from "./model.ts";
export type SaveFailure = { kind: "failed" | "unavailable"; message: string };
export function saveFailure(error: unknown): SaveFailure {
  const e = error instanceof Error ? error : Error("The draft could not be stored.");
  const unavailable = [
    "SecurityError",
    "InvalidStateError",
    "NotSupportedError",
    "VersionError",
    "ReferenceError",
  ].includes(e.name);
  const quota = ["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(e.name);
  return {
    kind: unavailable ? "unavailable" : "failed",
    message: quota
      ? "Device storage is full. Keep this workspace open and export a native backup before closing."
      : e.message,
  };
}
export function draftSaveStatus(
  ready: boolean,
  pending: number,
  durable: boolean,
  failure: SaveFailure | null,
) {
  if (!ready) return { state: "opening", label: "Opening…" };
  if (pending > 0) return { state: "saving", label: "Saving draft…" };
  if (failure)
    return {
      state: failure.kind,
      label: failure.kind === "unavailable" ? "Storage unavailable" : "Save failed",
    };
  return durable
    ? { state: "saved", label: "Draft saved" }
    : { state: "unsaved", label: "Unsaved draft" };
}
/** A late save reply may advance a revision only within its original page.
 * Same-page edits retain all newer immutable assets and current history. */
export function acknowledgeDraft(
  next: ProSession,
  live: ProSession,
  document: ProDocument,
): ProSession {
  if (
    live.document.panelId !== next.document.panelId ||
    live.recoveryId !== next.recoveryId ||
    document.panelId !== next.document.panelId
  )
    return live;
  return {
    ...next,
    document,
    assets: { ...next.assets, ...live.assets },
    acceptedBlobId: live.acceptedBlobId,
  };
}
