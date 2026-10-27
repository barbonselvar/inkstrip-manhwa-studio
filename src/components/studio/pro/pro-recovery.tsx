import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { listCheckpoints, readCheckpoint, type CheckpointHeader } from "@/lib/studio/pro/recovery";
import type { RecoveryStatus } from "@/lib/studio/pro/recovery-client";

export function ProRecovery({
  panelId,
  revision,
  epoch,
  status,
  disabled,
  onRestore,
  onDownload,
}: {
  panelId: string;
  revision: number | undefined;
  epoch: number;
  status: RecoveryStatus;
  disabled: boolean;
  onRestore?: (header: CheckpointHeader) => Promise<void>;
  onDownload: (blob: Blob, name: string) => void;
}) {
  const [entries, setEntries] = useState<CheckpointHeader[]>([]),
    [invalid, setInvalid] = useState(0),
    [error, setError] = useState(""),
    [readError, setReadError] = useState(""),
    [processing, setProcessing] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void listCheckpoints(panelId).then(
      (result) => {
        if (active) {
          setEntries(result.entries);
          setInvalid(result.invalid);
          setReadError("");
        }
      },
      (e) => {
        if (active) setReadError((e as Error).message);
      },
    );
    return () => {
      active = false;
    };
  }, [panelId, epoch, status, refresh]);
  const operateCheckpoint = async (h: CheckpointHeader, restore: boolean) => {
    if (disabled || processing) return;
    if (
      restore &&
      !window.confirm(
        `Restore checkpoint revision ${h.revision} from ${new Date(h.createdAt).toLocaleString()}? The current draft${revision !== undefined ? ` is revision ${revision}` : ""} may be newer. This replaces the open document's settings as one undoable action; original artwork is retained.`,
      )
    )
      return;
    setProcessing(true);
    setError("");
    try {
      if (restore && onRestore) await onRestore(h);
      else {
        const checkpoint = await readCheckpoint(h.id, panelId);
        if (checkpoint.header.integritySha256 !== h.integritySha256)
          throw Error(
            "The selected checkpoint changed. Refresh recovery checkpoints before downloading.",
          );
        onDownload(
          checkpoint.native,
          `${h.name || "Recovered artwork"}-revision-${h.revision}.inkstrip`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  };
  return (
    <section
      className="pro-recovery-panel"
      aria-label="Recovery checkpoints"
      aria-busy={processing}
    >
      <h3>Recovery checkpoints</h3>
      <p className="pro-help">
        Checkpoints keep editable layers and original images from confirmed saves. Up to three per
        page, within a shared 144MB budget. Export a native backup to protect against browser data
        removal.
      </p>
      <p className="pro-help" role="status" aria-live="polite">
        {status.state === "writing"
          ? "Saving a recovery checkpoint…"
          : status.state === "failed"
            ? `Draft save is independent. Recovery checkpoint unavailable: ${status.error}`
            : entries.length
              ? `Recovery available · ${entries.length} checkpoint${entries.length === 1 ? "" : "s"}`
              : "No recovery checkpoints yet. Save an editable draft to create one."}
      </p>
      {!onRestore && (
        <p className="pro-help">
          This document could not be opened. Download an integrity-verified native checkpoint and
          import it into a separate document on a compatible device. The existing saved draft stays
          intact.
        </p>
      )}
      {invalid > 0 && (
        <p className="pro-help" role="alert">
          {invalid} damaged checkpoint record{invalid === 1 ? " was" : "s were"} refused and
          retained unchanged.
        </p>
      )}
      {(error || readError) && (
        <p className="pro-help" role="alert">
          {error || readError}
        </p>
      )}
      <Button variant="ghost" disabled={processing} onClick={() => setRefresh((n) => n + 1)}>
        Refresh recovery checkpoints
      </Button>
      <ol className="pro-checkpoint-list">
        {entries.map((h) => (
          <li key={h.id}>
            <strong>
              {h.name || "Untitled artwork"} · revision {h.revision}
            </strong>
            <time dateTime={new Date(h.createdAt).toISOString()}>
              {new Date(h.createdAt).toLocaleString()}
            </time>
            <span className="pro-help">
              {(h.nativeBytes / 1_000_000).toFixed(2)} MB · saved{" "}
              {new Date(h.savedAt).toLocaleString()}
            </span>
            <div className="pro-actions">
              {onRestore && (
                <Button
                  variant="secondary"
                  disabled={disabled || processing}
                  onClick={() => void operateCheckpoint(h, true)}
                  aria-label={`Restore checkpoint revision ${h.revision}`}
                >
                  Restore checkpoint
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={disabled || processing}
                onClick={() => void operateCheckpoint(h, false)}
                aria-label={`Download checkpoint revision ${h.revision}`}
              >
                Download native checkpoint
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
