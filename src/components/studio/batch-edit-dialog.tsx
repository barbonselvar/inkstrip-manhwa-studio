import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { AdjustmentControls } from "./editor/adjustment-controls";
import { ImageRenderer } from "@/lib/studio/editor/client";
import { NEUTRAL } from "@/lib/studio/editor/adjustments";
import { mediaReference } from "@/lib/studio/editor/references";
import { batchRecipe } from "@/lib/studio/workflow";
import { getBlob, storageMessage } from "@/lib/studio/db";
import { deviceLimits } from "@/lib/studio/images";
import { useStudio } from "@/lib/studio/store";
import type { Panel } from "@/lib/studio/types";
type Result = { id: string; state: "done" | "failed" | "cancelled"; message: string };
export function BatchEditDialog({
  panels,
  projectId,
  onClose,
}: {
  panels: Panel[];
  projectId: string;
  onClose: () => void;
}) {
  const [values, setValues] = useState({ ...NEUTRAL }),
    [scale, setScale] = useState(100),
    [busy, setBusy] = useState(false),
    [committing, setCommitting] = useState(false),
    [results, setResults] = useState<Result[]>([]),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [before, setBefore] = useState(false),
    [previewReady, setPreviewReady] = useState(false);
  const presets = useStudio((s) => s.projects.find((p) => p.id === projectId)?.presets),
    canvas = useRef<HTMLCanvasElement>(null),
    engine = useRef<ImageRenderer | null>(null),
    abort = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
      engine.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (busy || !panels[0]) return;
    setPreviewReady(false);
    let active = true;
    const r = new ImageRenderer(deviceLimits());
    engine.current = r;
    const timer = setTimeout(() => {
      void (async () => {
        const panel = panels[0]!,
          blob = await getBlob(panel.blobId);
        if (!blob) throw new Error("Preview image unavailable.");
        const source = await r.source(blob);
        source.bitmap?.close();
        const reply = await r.preview(
          batchRecipe(panel.width, panel.height, values, scale, deviceLimits()),
          before,
        );
        if (!active) {
          reply.bitmap?.close();
          return;
        }
        if (reply.bitmap && canvas.current) {
          canvas.current.width = reply.bitmap.width;
          canvas.current.height = reply.bitmap.height;
          canvas.current.getContext("2d")?.drawImage(reply.bitmap, 0, 0);
          reply.bitmap.close();
          setPreviewReady(true);
        }
      })().catch((e) => {
        if (active && (e as Error).name !== "AbortError") setError(storageMessage(e));
      });
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
      r.dispose();
    };
  }, [panels, values, scale, before, busy]);
  async function run(retry = false) {
    setBusy(true);
    setError("");
    setPreviewReady(false);
    const control = new AbortController();
    abort.current = control;
    engine.current?.dispose();
    const work = retry
      ? panels.filter((p) => results.find((r) => r.id === p.id)?.state === "failed")
      : panels;
    const saved: Result[] = retry ? results.filter((r) => r.state !== "failed") : [];
    try {
      for (let i = 0; i < work.length; i++) {
        const p = work[i]!;
        if (control.signal.aborted) break;
        const r = new ImageRenderer(deviceLimits());
        engine.current = r;
        try {
          setStatus(`${i + 1}/${work.length} · ${p.name} · reading`);
          const blob = await getBlob(p.blobId);
          if (!blob) throw new Error("Image unavailable.");
          const source = await r.source(blob);
          source.bitmap?.close();
          const recipe = batchRecipe(p.width, p.height, values, scale, deviceLimits()),
            rendered = await r.save(recipe, (done, total) => {
              if (alive.current)
                setStatus(
                  `${i + 1}/${work.length} · ${p.name} · rendering ${Math.round((done / total) * 100)}%`,
                );
            });
          control.signal.throwIfAborted();
          if (!rendered.blob) throw new Error("Renderer produced no output.");
          setCommitting(true);
          setStatus(`${i + 1}/${work.length} · ${p.name} · saving`);
          await useStudio
            .getState()
            .replacePanelImage(p.id, rendered.blob, {
              expectedBlobId: p.blobId,
              edit: { version: 1, source: mediaReference(p), recipe },
            });
          saved.push({ id: p.id, state: "done", message: "Saved PNG; original retained" });
        } catch (e) {
          saved.push({
            id: p.id,
            state: control.signal.aborted ? "cancelled" : "failed",
            message: storageMessage(e),
          });
        } finally {
          r.dispose();
          if (alive.current) {
            setCommitting(false);
            setResults([...saved]);
          }
        }
      }
    } finally {
      if (alive.current) {
        setBusy(false);
        setStatus(
          control.signal.aborted
            ? "Cancelled; completed images remain saved."
            : "Queue finished. Inspect results; failed images remain unchanged.",
        );
      }
    }
  }
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title="Batch edit selected images"
      description={`${panels.length} images · local worker processing · originals retained`}
    >
      <fieldset
        disabled={busy || results.some((r) => r.state === "done")}
        className="image-property-fields"
      >
        <label className="editor-field-label">
          Saved preset
          <select
            className="field"
            aria-label="Batch saved preset"
            defaultValue=""
            onChange={(e) => {
              const p = presets?.find((p) => p.id === e.target.value);
              if (p) setValues({ ...p.adjustments });
            }}
          >
            <option value="">Choose a project preset</option>
            {presets?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="editor-field-label">
          Output scale % (100 preserves native resolution)
          <input
            className="field"
            aria-label="Batch scale percent"
            type="number"
            min="10"
            max="200"
            value={scale}
            onChange={(e) => setScale(+e.target.value)}
          />
        </label>
        <AdjustmentControls value={values} onChange={setValues} onEnd={() => {}} />
      </fieldset>
      <div className="batch-preview">
        <canvas ref={canvas} role="img" aria-label="Batch first-image preview" />
      </div>
      <Button
        variant="secondary"
        disabled={busy}
        aria-pressed={before}
        onClick={() => setBefore(!before)}
      >
        {before ? "Before" : "After"} · first image preview
      </Button>
      <p className="text-xs text-muted">
        Apply saves each result as PNG. Completed images remain if you cancel. Failed images are
        unchanged and can be retried. Originals remain recoverable; no cloud upload.
      </p>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      <p role="status" className="text-sm">
        {status}
      </p>
      {results.map((r) => (
        <p key={r.id} className="text-xs">
          {panels.find((p) => p.id === r.id)?.name}: {r.state} · {r.message}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !previewReady || results.some((r) => r.state === "done")}
          onClick={() => void run()}
        >
          Apply to {panels.length} selected images
        </Button>
        {results.some((r) => r.state === "failed") ? (
          <Button disabled={busy} variant="secondary" onClick={() => void run(true)}>
            Retry failed images
          </Button>
        ) : null}
        {busy ? (
          <Button
            variant="secondary"
            disabled={committing}
            onClick={() => {
              abort.current?.abort();
              engine.current?.dispose();
            }}
          >
            Cancel batch
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close batch
          </Button>
        )}
      </div>
    </Modal>
  );
}
