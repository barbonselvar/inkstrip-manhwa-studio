import { ToolSection } from "../design/tool-section";
import { CharacterControls } from "./character-controls";
import { NumberField } from "../editor/number-field";
import { overlap } from "@/lib/studio/faces/detect";
import { detectFaces } from "@/lib/studio/faces/client";
import type { FaceBox } from "@/lib/studio/faces/detect";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectionCanvas } from "./selection-canvas";
import type { Selection, SelectionTool } from "@/lib/studio/retouch/selection";
import { retouchImage } from "@/lib/studio/retouch/client";
import { storageMessage } from "@/lib/studio/db";
export function RetouchDialog({
  projectId,
  defaultOperation = "erase",
  onSavingChange,
  onSkip,
  queueLabel,
  blob,
  width,
  height,
  onSave,
  onClose,
}: {
  projectId: string;
  defaultOperation?: "erase" | "face";
  onSavingChange?: (saving: boolean) => void;
  onSkip?: () => void;
  queueLabel?: string;
  blob: Blob;
  width: number;
  height: number;
  onSave: (blob: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const [operation, setOperation] = useState<"erase" | "face">(defaultOperation);
  const [reference, setReference] = useState<Blob | undefined>(),
    [characterNotes, setCharacterNotes] = useState(""),
    [characterName, setCharacterName] = useState("");
  const chooseReference = useCallback((ref: Blob | undefined, notes: string, name: string) => {
    setReference(ref);
    setCharacterNotes(notes);
    setCharacterName(name);
    setConsent(false);
  }, []);
  const [faces, setFaces] = useState<FaceBox[]>([]);
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
  const [engine, setEngine] = useState<"local" | "cloud">(
      defaultOperation === "face" ? "cloud" : "local",
    ),
    [consent, setConsent] = useState(false),
    [access, setAccess] = useState("");
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);
  const controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const scroll = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null);
  const [fitWidth, setFitWidth] = useState(320);
  const viewportObserver = useRef<ResizeObserver | null>(null);
  const measureViewport = useCallback(
    (viewport: HTMLDivElement | null) => {
      scroll.current = viewport;
      viewportObserver.current?.disconnect();
      if (!viewport) return;
      const measure = () => {
        const availableWidth = Math.max(1, viewport.clientWidth - 32);
        const availableHeight = Math.max(1, viewport.clientHeight - 32);
        setFitWidth(Math.min(availableWidth, availableHeight * (width / height)));
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(viewport);
      viewportObserver.current = observer;
    },
    [width, height],
  );
  useEffect(() => () => viewportObserver.current?.disconnect(), []);

  async function run() {
    setBusy(true);
    setError("");
    setCandidate(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await retouchImage(current, strokes, {
        mode: engine,
        operation,
        reference,
        notes: characterNotes,
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
  async function detect() {
    setBusy(true);
    setError("");
    setFaces([]);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const found = await detectFaces(current, abort.signal, setStatus);
      if (alive.current) {
        setFaces(found);
        setStatus(
          found.length
            ? `${found.length} possible faces. Confirm a region; identities are never assigned automatically.`
            : "No confident faces found. Use ellipse or lasso manually.",
        );
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(storageMessage(e));
    } finally {
      if (alive.current) setBusy(false);
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
            {queueLabel ? <span className="text-xs text-muted">{queueLabel}</span> : null}
            {onSkip ? (
              <Button variant="secondary" disabled={saving} onClick={onSkip}>
                Skip target
              </Button>
            ) : null}
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
                ref={measureViewport}
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
                  style={{ width: fitWidth * zoom, aspectRatio: `${width}/${height}` }}
                >
                  <img src={url} alt="Retouch image preview" draggable={false} />
                  {!candidate && !before
                    ? faces.map((face, i) => (
                        <button
                          type="button"
                          key={i}
                          className="face-boundary"
                          aria-label={`Select detected face ${i + 1}`}
                          style={{
                            left: `${face.x * 100}%`,
                            top: `${face.y * 100}%`,
                            width: `${face.width * 100}%`,
                            height: `${face.height * 100}%`,
                          }}
                          onClick={() => {
                            setStrokes([
                              {
                                tool: "ellipse",
                                mode: "add",
                                size: 1,
                                feather,
                                points: [
                                  { x: face.x, y: face.y },
                                  {
                                    x: Math.min(1, face.x + face.width),
                                    y: Math.min(1, face.y + face.height),
                                  },
                                ],
                              },
                            ]);
                            setRedo([]);
                          }}
                        >
                          {i + 1}
                        </button>
                      ))
                    : null}
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
              <fieldset disabled={busy || saving} className="image-property-fields retouch-fields">
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
                <ToolSection title="Face selection" defaultOpen={defaultOperation === "face"}>
                  {" "}
                  <h3 className="font-display">Face detection & selection</h3>
                  <Button variant="secondary" onClick={() => void detect()} disabled={!!candidate}>
                    Detect possible anime faces
                  </Button>
                  <p className="text-xs text-muted">
                    Local trained LBP cascade, strongest on frontal anime faces. Profiles, occlusion
                    and very small faces may be missed. Select manually with ellipse or lasso;
                    brush/subtract correct the mask.
                  </p>
                  {faces.map((face, i) => (
                    <div key={i} className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setStrokes([
                            {
                              tool: "ellipse",
                              mode: "add",
                              size: 1,
                              feather,
                              points: [
                                { x: face.x, y: face.y },
                                {
                                  x: Math.min(1, face.x + face.width),
                                  y: Math.min(1, face.y + face.height),
                                },
                              ],
                            },
                          ]);
                          setRedo([]);
                        }}
                      >
                        Select face {i + 1}
                      </Button>
                      <span className="text-xs text-muted">{face.neighbors} agreeing windows</span>
                    </div>
                  ))}
                  {status && !busy ? (
                    <p role="status" className="text-xs text-muted">
                      {status}
                    </p>
                  ) : null}
                  {strokes.length === 1 && ["ellipse", "rectangle"].includes(strokes[0]!.tool) ? (
                    <>
                      <p className="text-xs text-muted">
                        Adjust selected face bounds (% of full-resolution image)
                      </p>
                      <div className="editor-number-grid">
                        {["x", "y", "width", "height"].map((axis) => {
                          const a = strokes[0]!.points[0]!,
                            b = strokes[0]!.points.at(-1)!,
                            box = {
                              x: Math.min(a.x, b.x),
                              y: Math.min(a.y, b.y),
                              width: Math.abs(a.x - b.x),
                              height: Math.abs(a.y - b.y),
                            };
                          return (
                            <NumberField
                              key={axis}
                              label={`Face ${axis} percent`}
                              min={axis === "width" || axis === "height" ? 1 : 0}
                              max={100}
                              value={Math.round(box[axis as keyof typeof box] * 100)}
                              onEnd={() => {}}
                              onChange={(v) => {
                                const n = { ...box, [axis]: v / 100 };
                                n.x = Math.min(n.x, 0.99);
                                n.y = Math.min(n.y, 0.99);
                                n.width = Math.max(0.01, Math.min(n.width, 1 - n.x));
                                n.height = Math.max(0.01, Math.min(n.height, 1 - n.y));
                                setStrokes([
                                  {
                                    ...strokes[0]!,
                                    points: [
                                      { x: n.x, y: n.y },
                                      { x: n.x + n.width, y: n.y + n.height },
                                    ],
                                  },
                                ]);
                              }}
                            />
                          );
                        })}
                      </div>
                      <Button
                        variant="ghost"
                        disabled={!faces.length}
                        onClick={() => {
                          const a = strokes[0]!.points[0]!,
                            b = strokes[0]!.points.at(-1)!;
                          const box = {
                            x: Math.min(a.x, b.x),
                            y: Math.min(a.y, b.y),
                            width: Math.abs(a.x - b.x),
                            height: Math.abs(a.y - b.y),
                            neighbors: 1,
                          };
                          const best = faces
                            .map((f) => ({ f, score: overlap(box, f) }))
                            .sort((a, b) => b.score - a.score)[0];
                          if (!best || best.score < 0.1) {
                            setError(
                              "No detected face overlaps this selection. Keep manual bounds.",
                            );
                            return;
                          }
                          const f = best.f;
                          setStrokes([
                            {
                              ...strokes[0]!,
                              tool: "ellipse",
                              points: [
                                { x: f.x, y: f.y },
                                { x: Math.min(1, f.x + f.width), y: Math.min(1, f.y + f.height) },
                              ],
                            },
                          ]);
                        }}
                      >
                        Refine to overlapping detected face
                      </Button>
                    </>
                  ) : null}
                </ToolSection>
                <ToolSection title="Character library" defaultOpen={defaultOperation === "face"}>
                  <CharacterControls
                    projectId={projectId}
                    blob={current}
                    strokes={strokes}
                    disabled={busy || saving}
                    onReference={chooseReference}
                  />
                </ToolSection>
                <h3 className="font-display">Processing</h3>
                <label className="editor-field-label">
                  Operation
                  <select
                    className="field"
                    aria-label="Retouch operation"
                    value={operation}
                    onChange={(e) => {
                      const op = e.target.value as "erase" | "face";
                      setOperation(op);
                      setConsent(false);
                      if (op === "face") setEngine("cloud");
                    }}
                  >
                    <option value="erase">Object Eraser</option>
                    <option value="face">AI Face Fix · reference guided</option>
                  </select>
                </label>
                {operation === "face" ? (
                  <p className="text-xs text-muted">
                    Choose a saved reference and manually confirm this target belongs to{" "}
                    {characterName || "the selected character"}. Optional OpenAI identity-guided
                    editing may change expression or details; inspect every result. There is no
                    local face-generation model or guaranteed identity preservation.
                  </p>
                ) : null}
                <select
                  disabled={operation === "face"}
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
                      {operation === "face"
                        ? `I confirm this selected target is ${characterName || "the chosen character"} and choose to upload context, mask and reference for paid Face Fix.`
                        : "I choose to upload this context for paid cloud processing."}
                    </label>
                  </>
                ) : null}
                <Button
                  intent={engine === "cloud" ? "ai" : undefined}
                  disabled={
                    !strokes.length ||
                    !!candidate ||
                    (engine === "cloud" &&
                      (!consent || !access || (operation === "face" && !reference)))
                  }
                  onClick={() => void run()}
                >
                  {operation === "face" ? "Preview AI Face Fix" : "Preview removal"}
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
              intent="save"
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
