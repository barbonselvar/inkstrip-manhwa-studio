import { useEffect, useState } from "react";
import { RetouchDialog } from "./retouch-dialog";
import { getImageBlob as getBlob, storageMessage } from "@/lib/studio/db";
import { useStudio } from "@/lib/studio/store";
import type { Panel } from "@/lib/studio/types";
import { Button } from "@/components/ui/button";
export function FaceQueue({
  panels,
  projectId,
  onClose,
}: {
  panels: Panel[];
  projectId: string;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [index, setIndex] = useState(0),
    [blob, setBlob] = useState<Blob | null>(null),
    [error, setError] = useState(""),
    [completed, setCompleted] = useState(0);
  const panel = panels[index];
  useEffect(() => {
    let active = true;
    setBlob(null);
    setError("");
    if (panel)
      void getBlob(panel.blobId)
        .then((b) => {
          if (active) {
            if (b) setBlob(b);
            else setError("Image is missing. Skip this target.");
          }
        })
        .catch((e) => {
          if (active) setError(storageMessage(e));
        });
    return () => {
      active = false;
    };
  }, [panel]);
  const next = () => {
    setSaving(false);
    setBlob(null);
    setIndex((i) => i + 1);
  };
  return (
    <>
      {!blob ? (
        <div className="face-queue-status" role="status">
          <span>
            Face Fix target {Math.min(index + 1, panels.length)} / {panels.length} · {completed}{" "}
            saved
          </span>
          {panel ? (
            <Button variant="secondary" disabled={saving} onClick={next}>
              Skip target
            </Button>
          ) : null}
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Stop queue
          </Button>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
      {panel && blob ? (
        <RetouchDialog
          key={panel.id}
          projectId={projectId}
          defaultOperation="face"
          onSavingChange={setSaving}
          onSkip={next}
          queueLabel={`${index + 1}/${panels.length} · ${completed} saved`}
          blob={blob}
          width={panel.width}
          height={panel.height}
          onClose={onClose}
          onSave={async (output) => {
            await useStudio
              .getState()
              .replacePanelImage(panel.id, output, { expectedBlobId: panel.blobId });
            setCompleted((n) => n + 1);
            next();
          }}
        />
      ) : null}
    </>
  );
}
