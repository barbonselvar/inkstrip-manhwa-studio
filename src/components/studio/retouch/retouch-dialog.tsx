import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectionCanvas } from "./selection-canvas";
import type { Selection, SelectionTool } from "@/lib/studio/retouch/selection";
import { retouchImage } from "@/lib/studio/retouch/client";
import { storageMessage } from "@/lib/studio/db";
export function RetouchDialog({
  blob,
  width,
  height,
  onSave,
  onClose,
}: {
  blob: Blob;
  width: number;
  height: number;
  onSave: (blob: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<Blob[]>([blob]),
    [index, setIndex] = useState(0),
    [candidate, setCandidate] = useState<Blob | null>(null),
    [before, setBefore] = useState(false);
  const current = versions[index]!;
  const display = before ? blob : (candidate ?? current);
  const [url, setUrl] = useState("");
  useEffect(() => {
    const value = URL.createObjectURL(display);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [display]);
  const [strokes, setStrokes] = useState<Selection[]>([]),
    [redo, setRedo] = useState<Selection[]>([]),
    [tool, setTool] = useState<SelectionTool>("brush"),
    [mode, setMode] = useState<"add" | "subtract">("add"),
    [size, setSize] = useState(60),
    [feather, setFeather] = useState(3),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState(false);
  const [engine, setEngine] = useState<"local" | "cloud">("local"),
    [consent, setConsent] = useState(false),
    [access, setAccess] = useState("");
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      controller.current?.abort();
    },
    [],
  );
  const scroll = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null);
  async function run() {
    setBusy(true);
    setError("");
    setCandidate(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await retouchImage(current, strokes, {
        mode: engine,
        access,
        signal: abort.signal,
        progress: (label, n) =>
          setStatus(`${label}${engine === "local" ? ` · ${Math.round(n * 100)}%` : ""}`),
      });
      if (alive.current && !abort.signal.aborted) setCandidate(result);
    } catch (e) {
      if (alive.current && (e as Error).name !== "AbortError") setError(storageMessage(e));
    } finally {
      if (alive.current) {
        setBusy(false);
        setStatus("");
      }
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(v) => {
        if (!v && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="image-editor-overlay" />
        <Dialog.Content
          className="image-editor retouch-dialog"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            if (saving) e.preventDefault();
          }}
        >
          <header className="image-editor-header">
            <div className="flex-1">
              <Dialog.Title className="font-display text-lg">Object Eraser & Retouch</Dialog.Title>
              <Dialog.Description className="text-xs text-muted">
                Select, preview, accept, then save. Original artwork stays recoverable.
              </Dialog.Description>
            </div>
            <Button variant="ghost" disabled={saving} onClick={onClose}>
              Close
            </Button>
          </header>
          <div className="image-editor-body">
            <section className="image-editor-main">
              <div className="image-viewport-tools">
                <label className="text-xs">
                  Zoom{" "}
                  <input
                    aria-label="Retouch zoom"
                    type="range"
                    min="1"
                    max="4"
                    step=".25"
                    value={zoom}
                    onChange={(e) => setZoom(+e.target.value)}
                  />
                </label>
                <Button variant="ghost" aria-pressed={pan} onClick={() => setPan(!pan)}>
                  Pan
                </Button>
                <Button
                  variant="secondary"
                  aria-pressed={before}
                  onClick={() => setBefore(!before)}
                >
                  {before ? "Before" : "After"}
                </Button>
              </div>
              <div
                className="retouch-viewport"
                ref={scroll}
                onPointerDown={(e) => {
                  if (!pan) return;
                  const s = scroll.current!;
                  drag.current = {
                    x: e.clientX,
                    y: e.clientY,
                    left: s.scrollLeft,
                    top: s.scrollTop,
                    id: e.pointerId,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (d && d.id === e.pointerId) {
                    scroll.current!.scrollLeft = d.left + d.x - e.clientX;
                    scroll.current!.scrollTop = d.top + d.y - e.clientY;
                  }
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
              >
                <div
                  className="retouch-plane"
                  style={{ width: `${zoom * 100}%`, aspectRatio: `${width}/${height}` }}
                >
                  <img src={url} alt="Retouch image preview" draggable={false} />
                  {!candidate && !before ? (
                    <SelectionCanvas
                      width={width}
                      height={height}
                      strokes={strokes}
                      settings={{ tool, mode, size, feather }}
                      disabled={busy || pan}
                      onError={setError}
                      onChange={(s) => {
                        setStrokes(s);
                        setRedo([]);
                      }}
                    />
                  ) : null}
                </div>
              </div>
            </section>
            <aside className="image-properties">
              <fieldset disabled={busy || saving} className="image-property-fields">
                <h3 className="font-display">Selection</h3>
                <label className="editor-field-label">
                  Shape
                  <select
                    className="field"
                    aria-label="Selection shape"
                    value={tool}
                    onChange={(e) => setTool(e.target.value as SelectionTool)}
                  >
                    <option value="brush">Brush</option>
                    <option value="lasso">Lasso / freehand</option>
                    <option value="ellipse">Circle / ellipse</option>
                    <option value="rectangle">Rectangle</option>
                  </select>
                </label>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    aria-pressed={mode === "add"}
                    onClick={() => setMode("add")}
                  >
                    Add
                  </Button>
                  <Button
                    variant="secondary"
                    aria-pressed={mode === "subtract"}
                    onClick={() => setMode("subtract")}
                  >
                    Subtract
                  </Button>
                </div>
                <label className="editor-field-label">
                  Brush size
                  <input
                    aria-label="Retouch brush size"
                    type="range"
                    min="4"
                    max="300"
                    value={size}
                    onChange={(e) => setSize(+e.target.value)}
                  />
                </label>
                <label className="editor-field-label">
                  Feather
                  <input
                    aria-label="Selection feather"
                    type="range"
                    min="0"
                    max="32"
                    value={feather}
                    onChange={(e) => setFeather(+e.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    disabled={!strokes.length}
                    onClick={() => {
                      setRedo([...redo, strokes.at(-1)!]);
                      setStrokes(strokes.slice(0, -1));
                    }}
                  >
                    Undo selection
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!redo.length}
                    onClick={() => {
                      setStrokes([...strokes, redo.at(-1)!]);
                      setRedo(redo.slice(0, -1));
                    }}
                  >
                    Redo selection
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setStrokes([]);
                      setRedo([]);
                    }}
                  >
                    Clear selection
                  </Button>
                </div>
                <h3 className="font-display">Processing</h3>
                <select
                  aria-label="Retouch processing mode"
                  className="field"
                  value={engine}
                  onChange={(e) => {
                    setEngine(e.target.value as "local" | "cloud");
                    setConsent(false);
                  }}
                >
                  <option value="local">Local texture repair · non-AI</option>
                  <option value="cloud">AI Object Eraser · OpenAI cloud</option>
                </select>
                <p className="text-xs text-muted">
                  Local repair synthesizes surrounding texture at a 256px context. It works best on
                  simple backgrounds; complex geometry requires generative inpainting.
                </p>
                {engine === "cloud" ? (
                  <>
                    <p className="text-xs text-muted">
                      Optional paid gpt-image-1 inpainting. Uploads the selected context and mask to
                      OpenAI via this server. Configure the server first. Cancel stops waiting;
                      provider billing may still occur.
                    </p>
                    <label className="editor-field-label">
                      Owner access code
                      <input
                        className="field"
                        type="password"
                        autoComplete="off"
                        value={access}
                        onChange={(e) => setAccess(e.target.value)}
                      />
                    </label>
                    <label className="flex gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      I choose to upload this context for paid cloud processing.
                    </label>
                  </>
                ) : null}
                <Button
                  disabled={
                    !strokes.length || !!candidate || (engine === "cloud" && (!consent || !access))
                  }
                  onClick={() => void run()}
                >
                  Preview removal
                </Button>
                {candidate ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        setVersions([...versions.slice(0, index + 1), candidate].slice(-4));
                        setIndex(Math.min(index + 1, 3));
                        setCandidate(null);
                        setStrokes([]);
                        setRedo([]);
                      }}
                    >
                      Accept preview
                    </Button>
                    <Button variant="secondary" onClick={() => setCandidate(null)}>
                      Reject / retry
                    </Button>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={index === 0 || !!candidate}
                    onClick={() => setIndex(index - 1)}
                  >
                    Undo result
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={index >= versions.length - 1 || !!candidate}
                    onClick={() => setIndex(index + 1)}
                  >
                    Redo result
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  Four in-session image versions are retained. Before always shows the image used to
                  open this workspace.
                </p>
              </fieldset>
            </aside>
          </div>
          <footer className="image-editor-footer">
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            {busy ? (
              <>
                <p role="status" className="text-sm">
                  {status}
                </p>
                <Button variant="secondary" onClick={() => controller.current?.abort()}>
                  Cancel processing
                </Button>
              </>
            ) : null}
            <Button
              disabled={busy || saving || !!candidate || current === blob}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(current);
                } catch (e) {
                  setError(storageMessage(e));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save accepted image"}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
