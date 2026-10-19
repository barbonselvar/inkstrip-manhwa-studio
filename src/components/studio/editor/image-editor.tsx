import { PresetControls } from "./preset-controls";
import { RetouchDialog } from "../retouch/retouch-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  Brush,
  WandSparkles,
  Check,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Hand,
  Image,
  LockKeyhole,
  Maximize,
  Redo2,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  SlidersHorizontal,
  Undo2,
  UnlockKeyhole,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdjustmentControls } from "./adjustment-controls";
import { LayoutControls } from "./layout-controls";
import { MaskCanvas, type Brush as BrushSettings } from "./mask-canvas";
import { NEUTRAL } from "@/lib/studio/editor/adjustments";
import { NumberField } from "./number-field";
import { getBlob, saveEditorDraft, storageMessage } from "@/lib/studio/db";
import { deviceLimits } from "@/lib/studio/images";
import { ImageRenderer } from "@/lib/studio/editor/client";
import {
  aspectCrop,
  assertSize,
  clampCrop,
  cropFromPoints,
  defaultRecipe,
  rotatedBounds,
  validateRecipe,
  withGeometry,
  type CropRect,
  type EditRecipe,
} from "@/lib/studio/editor/geometry";
import { createHistory, record, redo, same, undo } from "@/lib/studio/editor/history";
import { mediaReference } from "@/lib/studio/editor/references";
import { useStudio } from "@/lib/studio/store";
import type { Panel, PanelMedia } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

type Draft = { source: PanelMedia; recipe: EditRecipe };
type Point = { x: number; y: number };
type Gesture = {
  pointer: number;
  kind: "pan" | "draw" | "move" | "resize";
  start: Point;
  pan: Point;
  crop: CropRect;
  anchor?: Point;
};
function makeInitial(panel: Panel) {
  const source = panel.edit?.version === 1 ? panel.edit.source : mediaReference(panel);
  try {
    const recipe =
      panel.edit?.version === 1 ? panel.edit.recipe : defaultRecipe(source.width, source.height);
    validateRecipe(recipe, source.width, source.height);
    return { draft: { source, recipe }, error: "" };
  } catch (error) {
    return {
      draft: {
        source,
        recipe: {
          crop: { x: 0, y: 0, width: source.width, height: source.height },
          width: source.width,
          height: source.height,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
      },
      error: storageMessage(error),
    };
  }
}

export function ImageEditor({
  panel,
  chapterWidth,
  onClose,
}: {
  panel: Panel;
  chapterWidth: number;
  onClose: () => void;
}) {
  const initial = useMemo(() => makeInitial(panel), [panel]);
  const [history, setHistory] = useState(() => {
    const recovered = panel.draft;
    if (recovered?.expectedBlobId === panel.blobId)
      try {
        validateRecipe(recovered.recipe, recovered.source.width, recovered.source.height);
        return createHistory<Draft>({ source: recovered.source, recipe: recovered.recipe });
      } catch {
        /* ignore invalid recovery metadata */
      }
    return createHistory<Draft>(initial.draft);
  });
  const [draftStatus, setDraftStatus] = useState(
    panel.draft ? "Recovered an interrupted draft. Save to accept, or cancel and discard." : "",
  );
  const draft = history.present;
  const [temporary, setTemporary] = useState<EditRecipe | null>(null);
  const recipe = temporary ?? draft.recipe;
  const [tool, setTool] = useState<"transform" | "crop" | "adjust" | "select">("transform");
  const [brush, setBrush] = useState<BrushSettings>({
    mode: "add",
    size: Math.max(1, Math.min(256, Math.round(Math.min(panel.width, panel.height) / 8))),
    hardness: 0.8,
    opacity: 1,
  });
  const [maskPan, setMaskPan] = useState(false);
  const [showMask, setShowMask] = useState(true);
  const [saveProgress, setSaveProgress] = useState(0);
  const [cropMode, setCropMode] = useState<"draw" | "move">("draw");
  const [ratio, setRatio] = useState(0);
  const [locked, setLocked] = useState(true);
  const [before, setBefore] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 400, height: 400 });
  const [loaded, setLoaded] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [error, setError] = useState(initial.error);
  const [phase, setPhase] = useState<"idle" | "rendering" | "saving">("idle");
  const [retouchBase, setRetouchBase] = useState<Blob | null>(null);
  const [discard, setDiscard] = useState(false);
  const phaseRef = useRef(phase);
  const renderer = useRef<ImageRenderer | null>(null);
  const sourceCanvas = useRef<HTMLCanvasElement>(null),
    outputCanvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null),
    plane = useRef<HTMLDivElement>(null);
  const stageObserver = useRef<ResizeObserver | null>(null);
  const measureStage = useCallback((node: HTMLDivElement | null) => {
    stage.current = node;
    stageObserver.current?.disconnect();
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    stageObserver.current = observer;
  }, []);
  const gesture = useRef<Gesture | null>(null);
  const temporaryRef = useRef<EditRecipe | null>(null);
  const mounted = useRef(true),
    space = useRef(false);
  const generation = useRef(0);
  const replace = useStudio((state) => state.replacePanelImage);
  const restore = useStudio((state) => state.restorePanel);
  const dirty = !same(initial.draft, draft);
  const isRaw = tool === "crop" || before;
  const sourceView = tool === "select" || isRaw;
  const viewWidth = sourceView ? draft.source.width : recipe.width,
    viewHeight = sourceView ? draft.source.height : recipe.height;
  const fit = Math.min(
    Math.max(1, viewport.width - 36) / viewWidth,
    Math.max(1, viewport.height - 36) / viewHeight,
  );
  const bounds = rotatedBounds(recipe.crop.width, recipe.crop.height, recipe.rotation);
  let sizeError = "";
  try {
    assertSize(recipe.width, recipe.height, deviceLimits());
  } catch (problem) {
    sizeError = storageMessage(problem);
  }
  const busy = phase !== "idle";
  const original = panel.original ?? mediaReference(panel);
  const originalRecipe = useMemo(() => {
    try {
      return defaultRecipe(original.width, original.height);
    } catch {
      return null;
    }
  }, [original.width, original.height]);

  const projectId =
    useStudio.getState().chapters.find((c) => c.id === panel.chapterId)?.projectId ?? "";
  const draftClosing = useRef(false);
  const pendingAutosave = useRef<Promise<void> | null>(null);
  const persistDraft = useCallback(
    async (next: Panel["draft"] | null) => {
      if (next && draftClosing.current) return;
      const saved = await saveEditorDraft(panel.id, panel.blobId, next);
      useStudio.setState((s) => ({ panels: s.panels.map((p) => (p.id === saved.id ? saved : p)) }));
    },
    [panel.id, panel.blobId],
  );
  useEffect(() => {
    if (busy || retouchBase || draftClosing.current) return;
    const timer = setTimeout(() => {
      if (draftClosing.current) return;
      pendingAutosave.current = persistDraft(
        dirty
          ? {
              expectedBlobId: panel.blobId,
              source: draft.source,
              recipe: draft.recipe,
              updatedAt: Date.now(),
            }
          : null,
      )
        .then(() => {
          if (mounted.current)
            setDraftStatus(dirty ? "Draft saved locally · accepted image unchanged" : "");
        })
        .catch((e) => {
          if (mounted.current) setDraftStatus(`Draft recovery unavailable: ${storageMessage(e)}`);
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, dirty, busy, retouchBase, persistDraft, panel.blobId]);

  const clearDraftAndClose = useCallback(() => {
    draftClosing.current = true;
    void Promise.resolve(pendingAutosave.current)
      .catch(() => {})
      .then(() => persistDraft(null))
      .then(() => {
        renderer.current?.dispose();
        onClose();
      })
      .catch((e) => {
        draftClosing.current = false;
        setError(storageMessage(e));
      });
  }, [persistDraft, onClose]);
  const endGroup = () => setHistory((value) => ({ ...value, group: undefined }));
  const change = (next: EditRecipe, group?: string) => {
    setHistory((value) => record(value, { ...value.present, recipe: next }, group));
    setError("");
    setDiscard(false);
  };
  const changeGeometry = (
    patch: Partial<Pick<EditRecipe, "crop" | "rotation" | "flipX" | "flipY">>,
    group?: string,
  ) => change(withGeometry(draft.recipe, patch), group);
  const drawBitmap = (canvas: HTMLCanvasElement | null, bitmap?: ImageBitmap) => {
    if (!bitmap) return;
    if (canvas) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    }
    bitmap.close();
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stageObserver.current?.disconnect();
      renderer.current?.dispose();
    };
  }, []);
  useEffect(() => {
    let active = true;
    const engine = new ImageRenderer(deviceLimits());
    renderer.current = engine;
    setLoaded(false);
    setRendering(false);
    setError(initial.error);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    void (async () => {
      assertSize(draft.source.width, draft.source.height, {
        maxSide: 65535,
        maxArea: deviceLimits().maxArea,
      });
      const blob = await getBlob(draft.source.blobId);
      if (!blob) throw new Error("The editing source is missing. The accepted image is unchanged.");
      if (!active) return;
      const result = await engine.source(blob);
      if (!active) {
        result.bitmap?.close();
        return;
      }
      if (result.width !== draft.source.width || result.height !== draft.source.height) {
        result.bitmap?.close();
        throw new Error("Stored source dimensions do not match this image.");
      }
      drawBitmap(sourceCanvas.current, result.bitmap);
      setLoaded(true);
    })().catch((problem) => {
      if (active && problem.name !== "AbortError") setError(storageMessage(problem));
    });
    return () => {
      active = false;
      engine.dispose();
    };
  }, [draft.source.blobId, draft.source.width, draft.source.height, initial.error]);
  useEffect(() => {
    if (!loaded) return;
    const id = ++generation.current;
    let active = true;
    setRendering(true);
    const timer = setTimeout(() => {
      void renderer
        .current!.preview(recipe, tool === "select")
        .then((result) => {
          if (!active || id !== generation.current) {
            result.bitmap?.close();
            return;
          }
          drawBitmap(outputCanvas.current, result.bitmap);
          setRendering(false);
        })
        .catch((problem) => {
          if (active && problem.name !== "AbortError") {
            setRendering(false);
            setError(storageMessage(problem));
          }
        });
    }, 40);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [recipe, loaded, tool, previewVersion]);

  const close = useCallback(() => {
    if (phaseRef.current === "saving") return;
    if (phaseRef.current === "rendering") {
      renderer.current?.dispose();
      onClose();
      return;
    }
    if (dirty) setDiscard(true);
    else clearDraftAndClose();
  }, [dirty, onClose, clearDraftAndClose]);
  async function save() {
    if (retouchBase || !loaded || phaseRef.current !== "idle" || !dirty || sizeError) return;
    setError("");
    setSaveProgress(0);
    phaseRef.current = "rendering";
    setPhase("rendering");
    try {
      validateRecipe(draft.recipe, draft.source.width, draft.source.height);
      const recover =
        panel.original &&
        draft.source.blobId === original.blobId &&
        same(draft.recipe, originalRecipe);
      if (recover) {
        phaseRef.current = "saving";
        setPhase("saving");
        await restore(panel.id, panel.blobId);
      } else {
        const result = await renderer.current!.save(draft.recipe, (done, total) => {
          if (mounted.current) setSaveProgress(Math.round((done / total) * 100));
        });
        if (!mounted.current) return;
        if (!result.blob) throw new Error("The renderer did not return an image.");
        phaseRef.current = "saving";
        setPhase("saving");
        await replace(panel.id, result.blob, {
          expectedBlobId: panel.blobId,
          edit: { version: 1, source: draft.source, recipe: draft.recipe },
        });
      }
      if (mounted.current) onClose();
    } catch (problem) {
      if (mounted.current && (problem as Error).name !== "AbortError")
        setError(storageMessage(problem));
    } finally {
      if (mounted.current) {
        // A full render supersedes previews; resume them after a failed save too.
        setPreviewVersion((value) => value + 1);
        phaseRef.current = "idle";
        setPhase("idle");
      }
    }
  }
  const actions = useRef({ save, close, undo: () => {}, redo: () => {} });
  actions.current = {
    save,
    close,
    undo: () => {
      if (!busy) {
        setTemporary(null);
        setHistory(undo);
      }
    },
    redo: () => {
      if (!busy) {
        setTemporary(null);
        setHistory(redo);
      }
    },
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const input = (event.target as HTMLElement)?.closest(
        "input,textarea,select,[contenteditable=true]",
      );
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void actions.current.save();
      }
      if (!input && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) actions.current.redo();
        else actions.current.undo();
      }
      if (!input && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        actions.current.redo();
      }
      if (!input && event.code === "Space") {
        event.preventDefault();
        space.current = true;
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") space.current = false;
    };
    const blur = () => {
      space.current = false;
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const point = (event: ReactPointerEvent): Point => {
    const rect = plane.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          draft.source.width,
          ((event.clientX - rect.left) / rect.width) * draft.source.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          draft.source.height,
          ((event.clientY - rect.top) / rect.height) * draft.source.height,
        ),
      ),
    };
  };
  function startGesture(event: ReactPointerEvent, corner?: string) {
    if (busy || !loaded || event.button > 1) return;
    if (gesture.current) {
      temporaryRef.current = null;
      setTemporary(null);
      gesture.current = null;
      return;
    }
    event.preventDefault();
    const sourcePoint = point(event);
    const kind =
      tool !== "crop" || space.current || event.button === 1 ? "pan" : corner ? "resize" : cropMode;
    const c = draft.recipe.crop;
    const anchor = corner
      ? {
          x: corner.includes("w") ? c.x + c.width : c.x,
          y: corner.includes("n") ? c.y + c.height : c.y,
        }
      : undefined;
    gesture.current = {
      pointer: event.pointerId,
      kind,
      start: kind === "pan" ? { x: event.clientX, y: event.clientY } : sourcePoint,
      pan,
      crop: c,
      anchor,
    };
    stage.current?.setPointerCapture(event.pointerId);
  }
  function moveGesture(event: ReactPointerEvent) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.kind === "pan") {
      setPan({
        x: current.pan.x + event.clientX - current.start.x,
        y: current.pan.y + event.clientY - current.start.y,
      });
      return;
    }
    const now = point(event);
    let crop: CropRect;
    if (current.kind === "move") {
      crop = {
        ...current.crop,
        x: Math.max(
          0,
          Math.min(
            draft.source.width - current.crop.width,
            Math.round(current.crop.x + now.x - current.start.x),
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            draft.source.height - current.crop.height,
            Math.round(current.crop.y + now.y - current.start.y),
          ),
        ),
      };
    } else
      crop = cropFromPoints(
        current.anchor ?? current.start,
        now,
        draft.source.width,
        draft.source.height,
        ratio || undefined,
      );
    const next = withGeometry(draft.recipe, { crop });
    temporaryRef.current = next;
    setTemporary(next);
  }
  function endGesture(event: ReactPointerEvent, cancelled = false) {
    if (gesture.current?.pointer !== event.pointerId) return;
    if (!cancelled && temporaryRef.current) change(temporaryRef.current);
    temporaryRef.current = null;
    setTemporary(null);
    gesture.current = null;
    if (stage.current?.hasPointerCapture(event.pointerId))
      stage.current.releasePointerCapture(event.pointerId);
  }
  const resize = (axis: "width" | "height", value: number) => {
    const next = { ...draft.recipe, [axis]: value };
    if (locked) {
      if (axis === "width")
        next.height = Math.max(
          1,
          Math.min(65535, Math.round((value * bounds.height) / bounds.width)),
        );
      else
        next.width = Math.max(
          1,
          Math.min(65535, Math.round((value * bounds.width) / bounds.height)),
        );
    }
    change(next, `size-${axis}`);
  };
  const cropField = (axis: keyof CropRect, value: number) => {
    const current = draft.recipe.crop;
    const bounded =
      axis === "x"
        ? Math.min(value, draft.source.width - current.width)
        : axis === "y"
          ? Math.min(value, draft.source.height - current.height)
          : value;
    let crop = clampCrop({ ...current, [axis]: bounded }, draft.source.width, draft.source.height);
    if (ratio && (axis === "width" || axis === "height"))
      crop = aspectCrop(
        clampCrop(
          {
            ...crop,
            ...(axis === "width"
              ? { height: Math.round(crop.width / ratio) }
              : { width: Math.round(crop.height * ratio) }),
          },
          draft.source.width,
          draft.source.height,
        ),
        ratio,
      );
    changeGeometry({ crop }, `crop-${axis}`);
  };

  return (
    <>
      <Dialog.Root
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="image-editor-overlay" />
          <Dialog.Content
            className="image-editor"
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              close();
            }}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <header className="image-editor-header">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Cancel image editing"
                disabled={phase === "saving"}
                onClick={close}
              >
                <ArrowLeft className="size-5" />
              </Button>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="font-display text-lg">Edit Image</Dialog.Title>
                <Dialog.Description className="truncate text-xs text-muted">
                  {panel.name} · local, non-destructive workspace
                </Dialog.Description>
              </div>
              <div className="editor-header-history">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Undo edit"
                  disabled={!history.past.length || busy}
                  onClick={actions.current.undo}
                >
                  <Undo2 className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Redo edit"
                  disabled={!history.future.length || busy}
                  onClick={actions.current.redo}
                >
                  <Redo2 className="size-4" />
                </Button>
              </div>
            </header>
            {discard ? (
              <div className="editor-discard" role="alert">
                <p>Discard unsaved edits? Your accepted image will stay unchanged.</p>
                <Button variant="secondary" onClick={() => setDiscard(false)}>
                  Keep editing
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    clearDraftAndClose();
                  }}
                >
                  Discard edits
                </Button>
              </div>
            ) : null}
            <div className="image-editor-body">
              <section className="image-editor-main" aria-label="Image canvas workspace">
                <div className="image-viewport-tools">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Zoom out"
                      onClick={() => setZoom((v) => Math.max(0.25, v / 1.25))}
                    >
                      <ZoomOut className="size-4" />
                    </Button>
                    <output aria-label="Preview zoom" className="text-xs text-muted tabular-nums">
                      {Math.round(zoom * 100)}%
                    </output>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Zoom in"
                      onClick={() => setZoom((v) => Math.min(64, v * 1.25))}
                    >
                      <ZoomIn className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Fit image to viewport"
                      onClick={() => {
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                      }}
                    >
                      <Maximize className="size-4" />
                    </Button>
                  </div>
                  <Button
                    variant={before ? "secondary" : "ghost"}
                    disabled={tool === "crop"}
                    aria-pressed={before}
                    onClick={() => setBefore(!before)}
                  >
                    <Image className="size-4" />
                    {before ? "Before" : "After"}
                  </Button>
                </div>
                <div
                  ref={measureStage}
                  className={cn("image-stage", tool === "crop" ? "crop-active" : "pan-active")}
                  aria-label="Image editing viewport"
                  data-pan={`${pan.x},${pan.y}`}
                  onPointerMove={moveGesture}
                  onPointerUp={(e) => endGesture(e)}
                  onPointerCancel={(e) => endGesture(e, true)}
                  onLostPointerCapture={(e) => endGesture(e, true)}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) startGesture(e);
                  }}
                >
                  <div
                    ref={plane}
                    className="image-plane"
                    style={{
                      width: viewWidth * fit,
                      height: viewHeight * fit,
                      transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    }}
                    onPointerDown={(e) => startGesture(e)}
                  >
                    <canvas
                      ref={sourceCanvas}
                      className={isRaw ? "" : "canvas-hidden"}
                      role="img"
                      aria-label="Before editing source"
                    />
                    <canvas
                      ref={outputCanvas}
                      className={isRaw ? "canvas-hidden" : ""}
                      role="img"
                      aria-label="Edited preview"
                    />
                    {tool === "transform" && !before && (recipe.layout?.scale ?? 100) < 100 ? (
                      <div className="editor-frame-guides" aria-hidden="true" />
                    ) : null}
                    {tool === "select" && loaded && !before && showMask ? (
                      <MaskCanvas
                        width={draft.source.width}
                        height={draft.source.height}
                        strokes={recipe.selective?.strokes ?? []}
                        brush={brush}
                        disabled={busy}
                        pan={maskPan}
                        shouldPan={() => space.current}
                        onError={setError}
                        onCommit={(strokes) =>
                          change({
                            ...recipe,
                            selective: {
                              adjustments: recipe.selective?.adjustments ?? { ...NEUTRAL },
                              strokes,
                            },
                          })
                        }
                      />
                    ) : null}
                    {tool === "crop" && loaded ? (
                      <div
                        className="image-crop-overlay"
                        data-testid="crop-box"
                        style={{
                          left: (recipe.crop.x / draft.source.width) * 100 + "%",
                          top: (recipe.crop.y / draft.source.height) * 100 + "%",
                          width: (recipe.crop.width / draft.source.width) * 100 + "%",
                          height: (recipe.crop.height / draft.source.height) * 100 + "%",
                        }}
                      >
                        <span className="crop-crosshair" />
                        {["nw", "ne", "sw", "se"].map((corner) => (
                          <button
                            type="button"
                            key={corner}
                            className={`crop-handle crop-${corner}`}
                            aria-label={`Resize crop ${corner}`}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              startGesture(event, corner);
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {!loaded ? (
                    <p className="image-stage-status" role="status">
                      {error ? "Image unavailable for editing" : "Preparing source image…"}
                    </p>
                  ) : rendering ? (
                    <p className="image-stage-status image-stage-rendering" role="status">
                      Rendering preview…
                    </p>
                  ) : null}
                </div>
                <div className="image-canvas-caption">
                  <span className="flex items-center gap-2">
                    <Hand className="size-3" />
                    {tool === "crop"
                      ? "Draw a crop or drag its corners. Hold Space to pan."
                      : tool === "select"
                        ? "Paint in source view. Choose Pan view or hold Space to move."
                        : "Drag to pan. Zoom changes the view, never the output."}
                  </span>
                  <span>
                    {recipe.width} × {recipe.height} px
                  </span>
                </div>
              </section>
              <aside className="image-properties" data-tool={tool} aria-label="Image properties">
                <div className="editor-tool-picker">
                  <div className="image-tool-tabs">
                    <button
                      type="button"
                      aria-pressed={tool === "transform"}
                      onClick={() => {
                        setTool("transform");
                        setBefore(false);
                      }}
                    >
                      <SlidersHorizontal className="size-4" />
                      Transform
                    </button>
                    <button
                      type="button"
                      aria-pressed={tool === "crop"}
                      onClick={() => {
                        setTool("crop");
                        setBefore(false);
                      }}
                    >
                      <Crop className="size-4" />
                      Crop
                    </button>
                  </div>
                  <div className="image-tool-tabs">
                    <button
                      type="button"
                      aria-pressed={tool === "adjust"}
                      onClick={() => {
                        setTool("adjust");
                        setBefore(false);
                      }}
                    >
                      <WandSparkles className="size-4" />
                      Adjust
                    </button>
                    <button
                      type="button"
                      aria-pressed={tool === "select"}
                      onClick={() => {
                        setTool("select");
                        setBefore(false);
                      }}
                    >
                      <Brush className="size-4" />
                      Selective
                    </button>
                  </div>
                </div>
                <Button
                  className="retouch-launch"
                  intent="ai"
                  variant="secondary"
                  disabled={busy || !loaded || !!sizeError}
                  onClick={async () => {
                    phaseRef.current = "rendering";
                    setPhase("rendering");
                    try {
                      const rendered = await renderer.current!.save(draft.recipe);
                      if (rendered.blob && mounted.current) setRetouchBase(rendered.blob);
                    } catch (e) {
                      setError(storageMessage(e));
                    } finally {
                      phaseRef.current = "idle";
                      setPhase("idle");
                      setPreviewVersion((v) => v + 1);
                    }
                  }}
                >
                  Object Eraser & Retouch
                </Button>
                <fieldset
                  key={tool}
                  disabled={busy || !loaded}
                  className="image-property-fields precision-tool-fields"
                >
                  {tool === "adjust" ? (
                    <PresetControls
                      projectId={projectId}
                      value={recipe.adjustments ?? { ...NEUTRAL }}
                      onApply={(adjustments) => change({ ...recipe, adjustments })}
                    />
                  ) : null}
                  {tool === "transform" ? (
                    <>
                      <div className="editor-section-heading">
                        <h3>Output size</h3>
                        <button
                          type="button"
                          className="focus-ring"
                          aria-label="Lock aspect ratio"
                          aria-pressed={locked}
                          onClick={() => setLocked(!locked)}
                        >
                          {locked ? (
                            <LockKeyhole className="size-4" />
                          ) : (
                            <UnlockKeyhole className="size-4" />
                          )}
                        </button>
                      </div>
                      <div className="editor-number-grid">
                        <NumberField
                          label="Output width"
                          min={1}
                          value={recipe.width}
                          onChange={(v) => resize("width", v)}
                          onEnd={endGroup}
                        />
                        <NumberField
                          label="Output height"
                          min={1}
                          value={recipe.height}
                          onChange={(v) => resize("height", v)}
                          onEnd={endGroup}
                        />
                      </div>
                      <NumberField
                        label="Scale percent"
                        min={1}
                        max={800}
                        step={0.1}
                        value={Math.round((recipe.width / bounds.width) * 1000) / 10}
                        onChange={(v) =>
                          change(
                            {
                              ...recipe,
                              width: Math.max(
                                1,
                                Math.min(65535, Math.round((bounds.width * v) / 100)),
                              ),
                              height: Math.max(
                                1,
                                Math.min(65535, Math.round((bounds.height * v) / 100)),
                              ),
                            },
                            "scale",
                          )
                        }
                        onEnd={endGroup}
                      />
                      <label className="editor-field-label">
                        Scale slider
                        <input
                          aria-label="Scale slider"
                          type="range"
                          min="10"
                          max="300"
                          value={Math.min(300, Math.max(10, (recipe.width / bounds.width) * 100))}
                          onChange={(e) =>
                            change(
                              {
                                ...recipe,
                                width: Math.max(
                                  1,
                                  Math.round((bounds.width * +e.target.value) / 100),
                                ),
                                height: Math.max(
                                  1,
                                  Math.round((bounds.height * +e.target.value) / 100),
                                ),
                              },
                              "scale-slider",
                            )
                          }
                          onPointerUp={endGroup}
                          onKeyUp={endGroup}
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            change({
                              ...recipe,
                              width: chapterWidth,
                              height: Math.max(
                                1,
                                Math.round((chapterWidth * bounds.height) / bounds.width),
                              ),
                            })
                          }
                        >
                          Fit chapter width
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => change({ ...recipe, ...bounds })}
                        >
                          Reset size
                        </Button>
                      </div>
                      <div className="editor-section-heading">
                        <h3>Rotate & flip</h3>
                      </div>
                      <div className="image-transform-buttons">
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label="Rotate left"
                          onClick={() => changeGeometry({ rotation: recipe.rotation - 90 })}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label="Rotate right"
                          onClick={() => changeGeometry({ rotation: recipe.rotation + 90 })}
                        >
                          <RotateCw className="size-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label="Flip horizontally"
                          aria-pressed={recipe.flipX}
                          onClick={() => changeGeometry({ flipX: !recipe.flipX })}
                        >
                          <FlipHorizontal2 className="size-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label="Flip vertically"
                          aria-pressed={recipe.flipY}
                          onClick={() => changeGeometry({ flipY: !recipe.flipY })}
                        >
                          <FlipVertical2 className="size-4" />
                        </Button>
                      </div>
                      <NumberField
                        label="Rotation degrees"
                        min={-180}
                        max={180}
                        step={0.1}
                        value={recipe.rotation}
                        onChange={(v) => changeGeometry({ rotation: v }, "rotation")}
                        onEnd={endGroup}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          change(withGeometry(recipe, { rotation: 0, flipX: false, flipY: false }))
                        }
                      >
                        Reset rotation & flips
                      </Button>
                    </>
                  ) : tool === "crop" ? (
                    <>
                      <p className="text-xs text-muted">
                        Crop is measured in source pixels, before rotation. Outside pixels stay in
                        the retained source.
                      </p>
                      <label className="editor-field-label">
                        Crop aspect ratio
                        <select
                          aria-label="Crop aspect ratio"
                          className="field"
                          value={ratio}
                          onChange={(e) => {
                            const value = +e.target.value;
                            setRatio(value);
                            if (value) changeGeometry({ crop: aspectCrop(recipe.crop, value) });
                          }}
                        >
                          <option value={0}>Free crop</option>
                          <option value={1}>1:1 square</option>
                          <option value={3 / 4}>3:4 portrait</option>
                          <option value={4 / 3}>4:3 landscape</option>
                          <option value={9 / 16}>9:16 vertical</option>
                          <option value={16 / 9}>16:9 wide</option>
                        </select>
                      </label>
                      <div className="image-tool-tabs">
                        <button
                          type="button"
                          aria-pressed={cropMode === "draw"}
                          onClick={() => setCropMode("draw")}
                        >
                          Draw crop
                        </button>
                        <button
                          type="button"
                          aria-pressed={cropMode === "move"}
                          onClick={() => setCropMode("move")}
                        >
                          Move crop
                        </button>
                      </div>
                      <div className="editor-number-grid">
                        <NumberField
                          label="Crop X"
                          max={draft.source.width - recipe.crop.width}
                          value={recipe.crop.x}
                          onChange={(v) => cropField("x", v)}
                          onEnd={endGroup}
                        />
                        <NumberField
                          label="Crop Y"
                          max={draft.source.height - recipe.crop.height}
                          value={recipe.crop.y}
                          onChange={(v) => cropField("y", v)}
                          onEnd={endGroup}
                        />
                        <NumberField
                          label="Crop width"
                          min={1}
                          max={draft.source.width}
                          value={recipe.crop.width}
                          onChange={(v) => cropField("width", v)}
                          onEnd={endGroup}
                        />
                        <NumberField
                          label="Crop height"
                          min={1}
                          max={draft.source.height}
                          value={recipe.crop.height}
                          onChange={(v) => cropField("height", v)}
                          onEnd={endGroup}
                        />
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setRatio(0);
                          changeGeometry({
                            crop: {
                              x: 0,
                              y: 0,
                              width: draft.source.width,
                              height: draft.source.height,
                            },
                          });
                        }}
                      >
                        Reset crop
                      </Button>
                    </>
                  ) : tool === "adjust" ? (
                    <AdjustmentControls
                      value={recipe.adjustments ?? { ...NEUTRAL }}
                      onEnd={endGroup}
                      onChange={(adjustments, group) => change({ ...recipe, adjustments }, group)}
                    />
                  ) : (
                    <>
                      <p className="text-xs text-muted">
                        Paint where adjustments should apply. Erase mask removes selection, not
                        artwork. The source view keeps selection aligned through crop, rotation and
                        resizing.
                      </p>
                      <div className="editor-brush-modes">
                        <Button
                          variant={brush.mode === "add" && !maskPan ? "secondary" : "ghost"}
                          aria-pressed={brush.mode === "add" && !maskPan}
                          onClick={() => {
                            setBrush({ ...brush, mode: "add" });
                            setMaskPan(false);
                            setShowMask(true);
                          }}
                        >
                          Paint mask
                        </Button>
                        <Button
                          variant={brush.mode === "subtract" && !maskPan ? "secondary" : "ghost"}
                          aria-pressed={brush.mode === "subtract" && !maskPan}
                          onClick={() => {
                            setBrush({ ...brush, mode: "subtract" });
                            setMaskPan(false);
                            setShowMask(true);
                          }}
                        >
                          Erase mask
                        </Button>
                        <Button
                          variant={maskPan ? "secondary" : "ghost"}
                          aria-pressed={maskPan}
                          onClick={() => setMaskPan(!maskPan)}
                        >
                          Pan view
                        </Button>
                      </div>
                      <NumberField
                        label="Brush size"
                        min={1}
                        max={2048}
                        value={brush.size}
                        onChange={(size) => setBrush({ ...brush, size })}
                      />
                      <NumberField
                        label="Brush hardness percent"
                        min={0}
                        max={100}
                        value={Math.round(brush.hardness * 100)}
                        onChange={(v) => setBrush({ ...brush, hardness: v / 100 })}
                      />
                      <NumberField
                        label="Brush opacity percent"
                        min={1}
                        max={100}
                        value={Math.round(brush.opacity * 100)}
                        onChange={(v) => setBrush({ ...brush, opacity: v / 100 })}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          aria-pressed={showMask}
                          onClick={() => setShowMask(!showMask)}
                        >
                          {showMask ? "Hide mask" : "Show mask"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={!recipe.selective?.strokes.length}
                          onClick={() =>
                            change({
                              ...recipe,
                              selective: {
                                adjustments: recipe.selective?.adjustments ?? { ...NEUTRAL },
                                strokes: [],
                              },
                            })
                          }
                        >
                          Clear mask
                        </Button>
                      </div>
                      <p className="text-xs text-subtle" role="status">
                        {recipe.selective?.strokes.length ?? 0} mask strokes ·{" "}
                        {showMask ? "overlay visible" : "overlay hidden; changes still apply"}
                      </p>
                      <AdjustmentControls
                        selective
                        value={recipe.selective?.adjustments ?? { ...NEUTRAL }}
                        onEnd={endGroup}
                        onChange={(adjustments, group) =>
                          change(
                            {
                              ...recipe,
                              selective: { adjustments, strokes: recipe.selective?.strokes ?? [] },
                            },
                            group,
                          )
                        }
                      />
                    </>
                  )}
                  {tool === "transform" ? (
                    <LayoutControls
                      recipe={recipe}
                      onEnd={endGroup}
                      onChange={(layout, group) => change({ ...recipe, layout }, group)}
                    />
                  ) : null}
                  <div className="editor-section-heading">
                    <h3>Source & recovery</h3>
                    <ShieldCheck className="size-4 text-accent" />
                  </div>
                  <p className="text-xs text-muted">
                    {draft.source.width} × {draft.source.height} px source · PNG on Save. Previews
                    are capped at 1400px; saving uses the chosen output size.
                  </p>
                  <Button
                    variant="ghost"
                    onClick={() => change(defaultRecipe(draft.source.width, draft.source.height))}
                  >
                    Reset all edits
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={
                      !originalRecipe ||
                      (draft.source.blobId === original.blobId &&
                        same(draft.recipe, originalRecipe))
                    }
                    onClick={() => {
                      if (!originalRecipe) return;
                      setHistory((v) => record(v, { source: original, recipe: originalRecipe }));
                      setTemporary(null);
                      setRatio(0);
                      setBefore(false);
                    }}
                  >
                    Restore original
                  </Button>
                  <p className="text-xs text-subtle">
                    Restore is a draft until Save. Undo/redo lasts for this editing session. E opens
                    the editor; Ctrl/⌘ Z, Shift Z, and S control history and Save.
                  </p>
                </fieldset>
              </aside>
            </div>
            <footer className="image-editor-footer">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted" role="status">
                  {phase === "rendering"
                    ? `Rendering full-resolution PNG… ${saveProgress}% · Cancel to stop.`
                    : phase === "saving"
                      ? "Saving transaction…"
                      : dirty
                        ? "Unsaved draft · imported original retained"
                        : "No unsaved changes"}
                </p>
                {draftStatus ? (
                  <p className="text-xs text-muted" role="status">
                    {draftStatus}
                  </p>
                ) : null}
                {error || sizeError ? (
                  <p className="mt-1 text-xs text-danger" role="alert">
                    {error || sizeError}
                  </p>
                ) : null}
              </div>
              <Button variant="secondary" disabled={phase === "saving"} onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={!dirty || !loaded || busy || !!sizeError || !!initial.error}
                onClick={() => void save()}
              >
                <Check className="size-4" />
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {retouchBase ? (
        <RetouchDialog
          projectId={
            useStudio.getState().chapters.find((c) => c.id === panel.chapterId)?.projectId ?? ""
          }
          blob={retouchBase}
          width={recipe.width}
          height={recipe.height}
          onClose={() => setRetouchBase(null)}
          onSave={async (blob) => {
            await replace(panel.id, blob, { expectedBlobId: panel.blobId });
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
