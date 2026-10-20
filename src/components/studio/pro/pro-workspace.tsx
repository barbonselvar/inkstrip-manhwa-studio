import { appendSelection } from "@/lib/studio/pro/selection";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  MousePointer2,
  Hand,
  Brush,
  Pencil,
  Stamp,
  Eraser,
  Pipette,
  Square,
  Circle,
  Minus,
  Hexagon,
  PenTool,
  Type,
  MousePointer,
  ScanLine,
  Wand,
  Lasso,
  Undo2,
  Redo2,
  Layers3,
  Plus,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  Download,
  Save,
  Maximize2,
  Sparkles,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProCanvas, type ProTool } from "./pro-canvas";
import { ProProperties, ProNumber } from "./pro-properties";
import {
  EMPTY_SELECTION,
  fromPanel,
  sourceReference,
  layer,
  validateDocument,
  validateAssets,
  moveLayer,
  removeLayer,
  toLocalSelection,
  type ProDocument,
  type ProSession,
  type Layer,
  type Selection,
  type Stroke,
  type CloneSource,
} from "@/lib/studio/pro/model";
import { createHistory, record, undo, redo, type History } from "@/lib/studio/editor/history";
import { isLocked, reorderLayer, ungroupLayers } from "@/lib/studio/pro/operations";
import { ProRenderer } from "@/lib/studio/pro/client";
import { loadSession, saveSession } from "@/lib/studio/pro/storage";
import { nativeFile, readNative, vectorSvg, mergeNativeSession } from "@/lib/studio/pro/files";
import { importSvg } from "@/lib/studio/pro/svg-import";
import { getBlob, storageMessage } from "@/lib/studio/db";
import { useStudio } from "@/lib/studio/store";
import type { Panel } from "@/lib/studio/types";
import { decodeBlob } from "@/lib/studio/images";
import { ToolSection } from "../design/tool-section";
import {
  browserBrushStorage,
  loadBrushPresets,
  saveBrushPresets,
  upsertBrushPreset,
  type BrushPreset,
} from "@/lib/studio/pro/brush-presets";
type Entry = { doc: ProDocument; label: string };
const TOOLS: Array<{ id: ProTool; name: string; key: string; Icon: typeof Brush }> = [
  { id: "move", name: "Move", key: "V", Icon: MousePointer2 },
  { id: "hand", name: "Hand", key: "H", Icon: Hand },
  { id: "brush", name: "Brush", key: "B", Icon: Brush },
  { id: "pencil", name: "Pencil", key: "N", Icon: Pencil },
  { id: "clone", name: "Clone Stamp", key: "S", Icon: Stamp },
  { id: "heal", name: "Healing Brush", key: "J", Icon: Brush },
  { id: "eraser", name: "Eraser", key: "E", Icon: Eraser },
  { id: "eyedropper", name: "Eyedropper", key: "I", Icon: Pipette },
  { id: "select-rect", name: "Rectangle selection", key: "M", Icon: ScanLine },
  { id: "select-ellipse", name: "Ellipse selection", key: "", Icon: Circle },
  { id: "wand", name: "Magic Wand", key: "W", Icon: Wand },
  { id: "color-range", name: "Color Range", key: "", Icon: Pipette },
  { id: "lasso", name: "Freehand lasso", key: "L", Icon: Lasso },
  { id: "poly-lasso", name: "Polygonal lasso", key: "", Icon: PenTool },
  { id: "rectangle", name: "Rectangle", key: "R", Icon: Square },
  { id: "ellipse", name: "Ellipse", key: "O", Icon: Circle },
  { id: "line", name: "Line", key: "", Icon: Minus },
  { id: "polygon", name: "Polygon", key: "", Icon: Hexagon },
  { id: "pen", name: "Pen", key: "P", Icon: PenTool },
  { id: "direct", name: "Direct select", key: "A", Icon: MousePointer },
  { id: "text", name: "Text", key: "T", Icon: Type },
];
const RASTER_TOOL_IDS = new Set<ProTool>([
  "move",
  "hand",
  "brush",
  "pencil",
  "clone",
  "heal",
  "eraser",
  "eyedropper",
  "select-rect",
  "select-ellipse",
  "wand",
  "color-range",
  "lasso",
  "poly-lasso",
  "rectangle",
  "ellipse",
  "line",
  "polygon",
  "pen",
  "direct",
  "text",
]);
const VECTOR_TOOL_IDS = new Set<ProTool>([
  "move",
  "hand",
  "eyedropper",
  "rectangle",
  "ellipse",
  "line",
  "polygon",
  "pen",
  "direct",
  "text",
]);
function ReferenceImage({
  blob,
  name,
  onPlace,
}: {
  blob: Blob;
  name: string;
  onPlace: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <div className="pro-reference">
      <img src={url} alt={`${name} character reference`} />
      <div>
        <strong>{name}</strong>
        <Button variant="secondary" onClick={onPlace}>
          Place reference
        </Button>
      </div>
    </div>
  );
}
export default function ProWorkspace({
  panel,
  projectId,
  mode: initialMode,
  onModeChange,
  onClose,
  onContinue,
}: {
  panel: Panel;
  projectId: string;
  mode: "raster" | "vector";
  onModeChange: (mode: "raster" | "vector") => void;
  onClose: () => void;
  onContinue: (mode: "enhance" | "image" | "face") => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [history, setHistory] = useState<History<Entry> | null>(null),
    historyRef = useRef<History<Entry> | null>(null),
    [transient, setTransient] = useState<ProDocument | null>(null),
    [session, setSession] = useState<ProSession | null>(null),
    sessionRef = useRef<ProSession | null>(null),
    [selectedIds, setSelectedIds] = useState<string[]>([]),
    [tool, setTool] = useState<ProTool>(initialMode === "raster" ? "brush" : "pen"),
    [tolerance, setTolerance] = useState(32),
    [contiguous, setContiguous] = useState(true),
    [antiAlias, setAntiAlias] = useState(true),
    [operation, setOperation] = useState<"add" | "subtract" | "intersect">("add"),
    [brush, setBrush] = useState<Omit<Stroke, "points" | "erase">>({
      size: 24,
      hardness: 0.8,
      opacity: 1,
      flow: 1,
      color: "#a4efd6",
    }),
    [brushPresets, setBrushPresets] = useState<BrushPreset[]>(() =>
      loadBrushPresets(browserBrushStorage()),
    ),
    [cloneSource, setCloneSource] = useState<CloneSource | null>(null),
    [cloneSampleArmed, setCloneSampleArmed] = useState(false),
    [maskMode, setMaskMode] = useState(false),
    [grid, setGrid] = useState(false),
    [snapping, setSnapping] = useState(true),
    [before, setBefore] = useState(false),
    [tab, setTab] = useState<"properties" | "layers" | "history" | "assets" | "ai" | "export">(
      "layers",
    ),
    [panelOpen, setPanelOpen] = useState(true),
    [panelWidth, setPanelWidth] = useState(300),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Opening layered document…"),
    [saved, setSaved] = useState(false),
    [assetEpoch, setAssetEpoch] = useState(0),
    [ready, setReady] = useState(0),
    [rendering, setRendering] = useState(false),
    [busy, setBusy] = useState(false),
    [cancellable, setCancellable] = useState(false),
    [progress, setProgress] = useState(""),
    [version, setVersion] = useState(0),
    [mime, setMime] = useState("image/png"),
    [quality, setQuality] = useState(0.95),
    [widthDraft, setWidthDraft] = useState(0),
    [heightDraft, setHeightDraft] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<ProRenderer | null>(null),
    root = useRef<HTMLDivElement>(null),
    alive = useRef(true),
    closeInProgress = useRef(false),
    saveTail = useRef<Promise<unknown>>(Promise.resolve()),
    lastSaved = useRef(""),
    generation = useRef(0),
    busyRef = useRef(false),
    operationRun = useRef(0),
    draggedLayer = useRef("");
  const project = useStudio((s) => s.projects.find((p) => p.id === projectId)),
    livePanel = useStudio((s) => s.panels.find((p) => p.id === panel.id));
  const maxArea =
    (typeof navigator !== "undefined" &&
      ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4) ||
    (typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches)
      ? 4_000_000
      : 16_000_000;
  const doc = transient ?? history?.present.doc,
    selection = doc?.selection ?? EMPTY_SELECTION,
    active = doc?.layers.find((l) => l.id === selectedIds[0]);
  useEffect(() => {
    if (before && doc && !sourceReference(doc)) setBefore(false);
  }, [before, doc]);
  const install = (entry: ProSession, label: string) => {
    sessionRef.current = entry;
    setSession(entry);
    const h = createHistory({ doc: entry.document, label });
    historyRef.current = h;
    setHistory(h);
    setSelectedIds(entry.document.layers.length ? [entry.document.layers.at(-1)!.id] : []);
    setWidthDraft(entry.document.width);
    setHeightDraft(entry.document.height);
    setAssetEpoch((n) => n + 1);
  };
  useEffect(() => {
    alive.current = true;
    let active = true;
    void (async () => {
      const recovered = await loadSession(panel.id);
      if (recovered) {
        if (active) {
          install(recovered, "Recovered Pro draft");
          lastSaved.current = JSON.stringify(recovered.document);
          setSaved(true);
          setStatus("Recovered editable Pro document. Chapter unchanged.");
        }
        return;
      }
      const blob = await getBlob(panel.blobId);
      if (!blob) throw new Error("The accepted image is missing. Chapter data is unchanged.");
      if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type))
        throw new Error(
          "Pro raster sources currently require PNG, JPEG or WebP. Use the existing image editor to save a PNG copy first.",
        );
      const s: ProSession = {
        document: fromPanel(panel),
        assets: { source: blob },
        revision: 0,
        acceptedBlobId: panel.blobId,
        updatedAt: Date.now(),
      };
      validateAssets(s);
      if (active) {
        install(s, "Imported accepted image");
        setStatus("New layered document. Original artwork remains in your chapter.");
      }
    })().catch((e) => {
      if (active) setError(storageMessage(e));
    });
    return () => {
      active = false;
      alive.current = false;
      renderer.current?.dispose();
    };
  }, [panel]);
  const persist = useCallback((document: ProDocument) => {
    const task = saveTail.current
      .catch(() => {})
      .then(async () => {
        const current = sessionRef.current;
        if (!current) throw new Error("The document has not loaded.");
        const next = await saveSession({ ...current, document }, current.revision);
        // A file import can append immutable assets while this transaction is pending.
        // A save acknowledgement must never replace that newer in-memory asset pool.
        const live = sessionRef.current ?? next;
        const currentSession = {
          ...next,
          document: historyRef.current?.present.doc ?? document,
          assets: { ...next.assets, ...live.assets },
          acceptedBlobId: live.acceptedBlobId,
        };
        sessionRef.current = currentSession;
        if (alive.current) {
          setSession(currentSession);
          lastSaved.current = JSON.stringify(document);
          setSaved(JSON.stringify(historyRef.current?.present.doc) === lastSaved.current);
        }
        return next;
      });
    saveTail.current = task;
    return task;
  }, []);
  useEffect(() => {
    if (!history || !sessionRef.current || closeInProgress.current || busy) return;
    const signature = JSON.stringify(history.present.doc);
    setSaved(signature === lastSaved.current);
    if (signature === lastSaved.current) return;
    const timer = setTimeout(() => {
      if (closeInProgress.current || busyRef.current) return;
      void persist(history.present.doc).catch((e) => {
        if (alive.current) {
          setError(storageMessage(e));
          setStatus("Draft not saved. Export a native backup.");
        }
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [history, persist, busy]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (
        historyRef.current &&
        JSON.stringify(historyRef.current.present.doc) !== lastSaved.current
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    if (!assetEpoch || !sessionRef.current) return;
    let current = true;
    setReady(0);
    try {
      const worker = new ProRenderer();
      renderer.current?.dispose();
      renderer.current = worker;
      void worker
        .init(sessionRef.current)
        .then(() => {
          if (current) setReady((n) => n + 1);
        })
        .catch((e) => {
          if (current) setError(storageMessage(e));
        });
      return () => {
        current = false;
        worker.dispose();
      };
    } catch (e) {
      setError(storageMessage(e));
    }
  }, [assetEpoch, maxArea]);
  useEffect(() => {
    if (!doc || !ready || busy || !renderer.current) return;
    const id = ++generation.current;
    setRendering(true);
    const original = sourceReference(doc);
    const raw = original ? layer("raster", original.width, original.height) : undefined;
    if (raw && original) {
      raw.assetId = original.assetId;
      const fit = Math.min(doc.width / original.width, doc.height / original.height);
      raw.transform = {
        x: (doc.width - original.width * fit) / 2,
        y: (doc.height - original.height * fit) / 2,
        scaleX: fit,
        scaleY: fit,
        rotation: 0,
      };
    }
    const document = before ? { ...doc, layers: raw ? [raw] : [] } : doc;
    const timer = setTimeout(() => {
      void renderer.current
        ?.render(document, maxArea)
        .then((r) => {
          if (!r.bitmap) return;
          if (id !== generation.current || !alive.current) {
            r.bitmap.close();
            return;
          }
          const c = canvas.current;
          if (c) {
            c.width = r.bitmap.width;
            c.height = r.bitmap.height;
            c.getContext("2d")!.drawImage(r.bitmap, 0, 0);
            setVersion((v) => v + 1);
          }
          r.bitmap.close();
          setRendering(false);
        })
        .catch((e) => {
          if (id === generation.current && alive.current) {
            setRendering(false);
            if (e.name !== "AbortError") {
              const c = canvas.current;
              c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
              setError(storageMessage(e));
            }
          }
        });
    }, 70);
    return () => {
      clearTimeout(timer);
    };
  }, [doc, ready, before, busy, maxArea]);
  const setHist = useCallback((value: History<Entry>) => {
    historyRef.current = value;
    setHistory(value);
  }, []);
  const commit = useCallback(
    (next: ProDocument, label: string, group?: string) => {
      if (busyRef.current) return;
      try {
        validateDocument(next);
        const h = historyRef.current;
        if (h) setHist(record(h, { doc: next, label }, group));
        setError("");
      } catch (e) {
        setError(storageMessage(e));
      }
    },
    [setHist],
  );
  const setSelection = useCallback(
    (selection: Selection) => {
      const current = historyRef.current?.present.doc;
      if (current) commit({ ...current, selection }, "Change selection");
    },
    [commit],
  );
  const sampleSelection = async (point: { x: number; y: number }) => {
    const document = historyRef.current?.present.doc,
      worker = renderer.current;
    if (!document || !worker || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setProgress("Analyzing colors at document resolution…");
    try {
      const result = await worker.select(document, maxArea, point, {
        tolerance,
        contiguous: tool === "wand" && contiguous,
        antiAlias,
      });
      if (!result.region || !alive.current) return;
      const previous = document.selection ?? EMPTY_SELECTION;
      // Release the operation lock before recording its single undo transaction.
      busyRef.current = false;
      commit(
        { ...document, selection: appendSelection(previous, { ...result.region, operation }) },
        tool === "wand" ? "Magic Wand selection" : "Color Range selection",
      );
      setStatus(
        "Selection analyzed at full document resolution. Blue overlay shows selected coverage.",
      );
    } catch (e) {
      setError(storageMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress("");
    }
  };
  const patch = (p: Partial<Layer>, group?: string) => {
    const current = historyRef.current?.present.doc;
    if (!current || !active || isLocked(current, active.id)) return;
    commit(
      { ...current, layers: current.layers.map((l) => (l.id === active.id ? { ...l, ...p } : l)) },
      "Change layer properties",
      group ? `${active.id}:${group}` : undefined,
    );
  };
  const add = (kind: Layer["kind"], shape?: Layer["shape"]) => {
    const d = historyRef.current?.present.doc;
    if (!d) return;
    const object = layer(
      kind,
      kind === "paint" || kind === "group" ? d.width : Math.min(280, d.width * 0.7),
      kind === "paint" || kind === "group" ? d.height : Math.min(180, d.height * 0.4),
    );
    if (shape) {
      object.shape = shape;
      object.name = shape[0]!.toUpperCase() + shape.slice(1);
      object.tail = { x: object.width * 0.72, y: object.height * 0.95 };
      object.fill = "#f3efe6";
    }
    if (kind === "text") {
      object.fill = "#172420";
      object.strokeWidth = 0;
    }
    if (kind !== "paint" && kind !== "group")
      object.transform = { ...object.transform, x: d.width * 0.1, y: d.height * 0.1 };
    commit({ ...d, layers: [...d.layers, object] }, `Add ${shape ?? kind}`);
    setSelectedIds([object.id]);
    setMaskMode(false);
    setTool(kind === "paint" ? "brush" : "move");
    setTab("properties");
    setBefore(false);
  };
  const duplicate = () => {
    if (!doc || !active || active.locked || active.kind === "group") return;
    const object = {
      ...structuredClone(active),
      id: crypto.randomUUID(),
      name: active.name + " copy",
      transform: { ...active.transform, x: active.transform.x + 16, y: active.transform.y + 16 },
    };
    commit({ ...doc, layers: [...doc.layers, object] }, "Duplicate layer");
    setSelectedIds([object.id]);
  };
  const remove = () => {
    if (doc && active && !active.locked) {
      commit(removeLayer(doc, active.id), "Delete layer");
      setSelectedIds([]);
    }
  };
  const saveNow = useCallback(async () => {
    const current = historyRef.current?.present.doc;
    if (current) {
      await persist(current);
      if (alive.current) setStatus("Editable Pro draft saved on this device. Chapter unchanged.");
    }
  }, [persist]);
  const close = useCallback(async () => {
    if (busyRef.current || closeInProgress.current) return;
    closeInProgress.current = true;
    try {
      if (historyRef.current) await persist(historyRef.current.present.doc);
      onClose();
    } catch (e) {
      closeInProgress.current = false;
      setError(storageMessage(e));
    }
  }, [persist, onClose]);
  const apply = async () => {
    const d = historyRef.current?.present.doc,
      s = sessionRef.current;
    if (!d || !s || busyRef.current || !renderer.current) return false;
    const run = ++operationRun.current;
    busyRef.current = true;
    setBusy(true);
    ++generation.current;
    setProgress("Saving editable document…");
    try {
      await persist(d);
      if (run !== operationRun.current) throw new DOMException("Cancelled", "AbortError");
      const current = useStudio.getState().panels.find((p) => p.id === panel.id);
      if (!current || current.blobId !== s.acceptedBlobId)
        throw new Error(
          "The chapter image changed outside this Pro document. Export your native document; application is blocked to protect newer artwork.",
        );
      setCancellable(true);
      const result = await renderer.current.export(d, maxArea, "image/png", 1, (n, t) =>
        setProgress(`Rendering layer ${n} / ${t}`),
      );
      if (run !== operationRun.current) throw new DOMException("Cancelled", "AbortError");
      setCancellable(false);
      if (!result.blob) throw new Error("No rendered image returned.");
      setProgress("Saving chapter revision…");
      await useStudio
        .getState()
        .replacePanelImage(panel.id, result.blob, { expectedBlobId: s.acceptedBlobId });
      const updated = useStudio.getState().panels.find((p) => p.id === panel.id)!;
      sessionRef.current = { ...sessionRef.current!, acceptedBlobId: updated.blobId };
      await persist(d);
      setStatus("Applied composite to chapter. Layers and original artwork remain recoverable.");
      return true;
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(storageMessage(e));
      else
        setStatus(
          "Rendering cancelled. Chapter unchanged unless application had already finished.",
        );
      return false;
    } finally {
      busyRef.current = false;
      if (alive.current) {
        setBusy(false);
        setCancellable(false);
        setProgress("");
      }
    }
  };
  const adoptLatestImage = async () => {
    if (busyRef.current || !historyRef.current || !sessionRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setProgress("Saving latest chapter image as a new base…");
    try {
      await saveTail.current.catch(() => {});
      const current = useStudio.getState().panels.find((p) => p.id === panel.id),
        session = sessionRef.current!,
        h = historyRef.current!;
      if (!current)
        throw new Error("This chapter image is no longer available. Export a native backup.");
      if (current.width * current.height > maxArea)
        throw new Error(
          "The latest chapter image exceeds this device’s Pro memory budget. Existing layers remain unchanged.",
        );
      const blob = await getBlob(current.blobId);
      if (!blob) throw new Error("The latest chapter image is missing.");
      const assetId = crypto.randomUUID(),
        base = layer("raster", current.width, current.height);
      base.assetId = assetId;
      base.name = "Latest chapter image";
      const document: ProDocument = {
        ...h.present.doc,
        width: current.width,
        height: current.height,
        selection: EMPTY_SELECTION,
        layers: [
          ...h.present.doc.layers.map((l) => (l.parentId ? l : { ...l, visible: false })),
          base,
        ],
      };
      const next: ProSession = {
        ...session,
        document,
        assets: { ...session.assets, [assetId]: blob },
        acceptedBlobId: current.blobId,
      };
      validateAssets(next);
      const stored = await saveSession(next, session.revision);
      sessionRef.current = stored;
      setSession(stored);
      setHist(
        record(h, { doc: document, label: "Use latest chapter image; retain earlier layers" }),
      );
      lastSaved.current = JSON.stringify(document);
      setSaved(true);
      setSelectedIds([base.id]);
      setMaskMode(false);
      setBefore(false);
      setTool("move");
      setWidthDraft(document.width);
      setHeightDraft(document.height);
      setAssetEpoch((n) => n + 1);
      setError("");
      setStatus("Latest chapter image added. Earlier layers are hidden and recoverable in Layers.");
    } catch (e) {
      setError(storageMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress("");
    }
  };
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name.replace(/[\\/:*?"<>|]/g, "-");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const exportFile = async (kind: "raster" | "native" | "svg") => {
    if (!doc || !sessionRef.current || busyRef.current) return;
    setError("");
    try {
      if (kind === "native") {
        download(
          await nativeFile({ ...sessionRef.current, document: doc }),
          `${doc.name}.inkstrip`,
        );
        setStatus("Native editable document exported.");
        return;
      }
      if (kind === "svg") {
        download(new Blob([vectorSvg(doc)], { type: "image/svg+xml" }), `${doc.name}-vectors.svg`);
        setStatus("Supported vector/text layers exported. Raster and paint layers are excluded.");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      ++generation.current;
      setCancellable(true);
      const r = await renderer.current!.export(doc, maxArea, mime, quality, (n, t) =>
        setProgress(`Exporting layer ${n} / ${t}`),
      );
      if (r.blob) {
        download(r.blob, `${doc.name}-composite.${mime.split("/")[1]}`);
        setStatus("Full-resolution composite exported.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(storageMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setCancellable(false);
      setProgress("");
    }
  };
  const cancel = () => {
    ++operationRun.current;
    renderer.current?.dispose();
    setAssetEpoch((n) => n + 1);
    setStatus("Rendering cancelled. Document retained.");
  };
  const addAsset = async (blob: Blob, name: string) => {
    let d = historyRef.current?.present.doc,
      s = sessionRef.current;
    if (!d || !s || busyRef.current) return;
    const decoded = await decodeBlob(blob);
    try {
      if (!alive.current || busyRef.current || closeInProgress.current) return;
      d = historyRef.current?.present.doc;
      s = sessionRef.current;
      if (!d || !s) return;
      if (decoded.width * decoded.height > maxArea)
        throw new Error(
          "Image exceeds this device’s Pro memory budget. Use a smaller source or the existing chapter workflow.",
        );
      const id = crypto.randomUUID(),
        l = layer("raster", decoded.width, decoded.height);
      l.assetId = id;
      l.name = name.slice(0, 100);
      const scale = Math.min(1, d.width / l.width, d.height / l.height);
      l.transform.scaleX = l.transform.scaleY = scale;
      const next = {
        ...s,
        assets: { ...s.assets, [id]: blob },
        document: { ...d, layers: [...d.layers, l] },
      };
      validateAssets(next);
      sessionRef.current = next;
      setSession(next);
      commit(next.document, "Import raster asset");
      setSelectedIds([l.id]);
      setMaskMode(false);
      setBefore(false);
      setTool("move");
      setAssetEpoch((n) => n + 1);
    } finally {
      decoded.close();
    }
  };
  const importFile = async (file?: File) => {
    if (!file || !doc || !sessionRef.current || busyRef.current) return;
    setError("");
    try {
      if (file.name.toLowerCase().endsWith(".inkstrip")) {
        const imported = await readNative(file, panel.id, sessionRef.current.acceptedBlobId);
        if (!alive.current || busyRef.current || closeInProgress.current) return;
        const next = mergeNativeSession(sessionRef.current, imported);
        validateAssets(next);
        sessionRef.current = next;
        setSession(next);
        commit(next.document, "Import native document");
        setMaskMode(false);
        setSelectedIds(next.document.layers.length ? [next.document.layers.at(-1)!.id] : []);
        setWidthDraft(next.document.width);
        setHeightDraft(next.document.height);
        setAssetEpoch((n) => n + 1);
        setStatus("Native document imported into this Pro draft. Chapter unchanged.");
      } else if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
        if (file.size > 1_000_000) throw new Error("SVG import limit is 1MB.");
        const imported = importSvg(await file.text());
        commit({ ...doc, layers: [...doc.layers, ...imported.layers] }, "Import sanitized vectors");
        setSelectedIds([imported.layers.at(-1)!.id]);
      } else if (["image/png", "image/jpeg", "image/webp"].includes(file.type))
        await addAsset(file, file.name);
      else throw new Error("Choose PNG, JPEG, WebP, basic SVG or an .inkstrip document.");
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const groupSelected = () => {
    if (!doc) return;
    const chosen = doc.layers.filter((l) => selectedIds.includes(l.id) && !l.locked);
    if (chosen.length < 2 || chosen.some((l) => l.parentId || l.kind === "group")) {
      setError(
        "Select at least two unlocked top-level objects with Shift-click. Nested grouping is not available in this milestone.",
      );
      return;
    }
    const g = layer("group", doc.width, doc.height);
    g.name = "Layer group";
    const last = Math.max(...chosen.map((l) => doc.layers.indexOf(l))),
      layers = doc.layers.map((l) => (chosen.includes(l) ? { ...l, parentId: g.id } : l));
    layers.splice(last + 1, 0, g);
    commit({ ...doc, layers }, "Group layers");
    setSelectedIds([g.id]);
  };
  const ungroup = () => {
    if (doc && active?.kind === "group") {
      try {
        commit(ungroupLayers(doc, active.id), "Ungroup layers");
        setSelectedIds([]);
      } catch (e) {
        setError(storageMessage(e));
      }
    }
  };
  const chooseTool = (id: ProTool) => {
    if (
      (id === "brush" || id === "pencil" || id === "eraser" || id === "clone" || id === "heal") &&
      !maskMode &&
      active?.kind !== "paint"
    )
      add("paint");
    if (id === "clone" || id === "heal") setMaskMode(false);
    setTool(id);
    setBefore(false);
  };
  const captureCloneSource = async (point: { x: number; y: number }) => {
    const document = historyRef.current?.present.doc,
      session = sessionRef.current,
      worker = renderer.current;
    if (!document || !session || !worker || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setProgress("Sampling merged artwork at full resolution…");
    try {
      await saveTail.current.catch(() => {});
      const currentSession = sessionRef.current;
      if (!currentSession) throw new Error("The document session is unavailable.");
      const result = await worker.export(document, maxArea, "image/png", 1, () => {});
      if (!result.blob) throw new Error("Could not capture the clone source.");
      const assetId = crypto.randomUUID(),
        next = { ...currentSession, assets: { ...currentSession.assets, [assetId]: result.blob } };
      validateAssets(next);
      const stored = await saveSession(next, currentSession.revision);
      sessionRef.current = stored;
      setSession(stored);
      setCloneSource({
        assetId,
        width: document.width,
        height: document.height,
        point,
        aligned: true,
      });
      setCloneSampleArmed(false);
      setAssetEpoch((n) => n + 1);
      setStatus("Clone source captured from the visible composite at full document resolution.");
    } catch (e) {
      setError(storageMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress("");
    }
  };
  const actions = useRef({
    save: saveNow,
    undo: () => {},
    redo: () => {},
    remove,
    selectTool: chooseTool,
  });
  actions.current = {
    save: saveNow,
    undo: () => {
      if (historyRef.current) setHist(undo(historyRef.current));
    },
    redo: () => {
      if (historyRef.current) setHist(redo(historyRef.current));
    },
    remove,
    selectTool: chooseTool,
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (busyRef.current) return;
      const input = (e.target as HTMLElement).closest("input,textarea,select");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void actions.current.save().catch((err) => setError(storageMessage(err)));
        return;
      }
      if (input) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) actions.current.redo();
        else actions.current.undo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        actions.current.remove();
      } else if (!e.ctrlKey && !e.metaKey) {
        const allowedTools = mode === "raster" ? RASTER_TOOL_IDS : VECTOR_TOOL_IDS;
        const t = TOOLS.find(
          (t) => allowedTools.has(t.id) && t.key.toLowerCase() === e.key.toLowerCase(),
        );
        if (t) {
          e.preventDefault();
          actions.current.selectTool(t.id);
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [mode]);
  const stale = !!session && livePanel?.blobId !== session.acceptedBlobId;
  const branch = (parent?: string, depth = 0): React.ReactNode =>
    doc?.layers
      .filter((l) => l.parentId === parent)
      .slice()
      .reverse()
      .map((l) => (
        <div key={l.id}>
          <div
            className="pro-layer-row"
            data-active={selectedIds.includes(l.id)}
            style={{ paddingLeft: 8 + depth * 12 }}
            draggable={!l.locked && !busy}
            onDragStart={() => {
              draggedLayer.current = l.id;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = draggedLayer.current,
                from = doc.layers.find((x) => x.id === id);
              if (from && from.parentId === l.parentId) {
                commit(reorderLayer(doc, id, l.id), "Reorder layers");
              }
              draggedLayer.current = "";
            }}
          >
            <button
              type="button"
              aria-label={`${l.visible ? "Hide" : "Show"} layer ${l.name}`}
              onClick={() =>
                commit(
                  {
                    ...doc,
                    layers: doc.layers.map((x) =>
                      x.id === l.id ? { ...x, visible: !x.visible } : x,
                    ),
                  },
                  "Toggle visibility",
                )
              }
            >
              {l.visible ? <Eye /> : <EyeOff />}
            </button>
            <button
              className="pro-layer-select"
              type="button"
              aria-pressed={selectedIds.includes(l.id)}
              onClick={(e) => {
                setSelectedIds(
                  e.shiftKey
                    ? (ids) =>
                        ids.includes(l.id) ? ids.filter((id) => id !== l.id) : [...ids, l.id]
                    : [l.id],
                );
                setMaskMode(false);
              }}
            >
              <Layers3 />
              <span>
                {l.name}
                <small>
                  {l.kind}
                  {l.mask ? " · masked" : ""}
                </small>
              </span>
            </button>
            <button
              type="button"
              aria-label={`${l.locked ? "Unlock" : "Lock"} layer ${l.name}`}
              onClick={() =>
                commit(
                  {
                    ...doc,
                    layers: doc.layers.map((x) =>
                      x.id === l.id ? { ...x, locked: !x.locked } : x,
                    ),
                  },
                  "Toggle layer lock",
                )
              }
            >
              {l.locked ? <Lock /> : <Unlock />}
            </button>
          </div>
          {l.kind === "group" ? branch(l.id, depth + 1) : null}
        </div>
      ));
  return (
    <Dialog.Root
      open
      onOpenChange={(v) => {
        if (!v) void close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="image-editor-overlay" />
        <Dialog.Content
          className="pro-studio"
          ref={root}
          style={{ "--pro-panel-width": `${panelWidth}px` } as React.CSSProperties}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            if (!busyRef.current) void close();
          }}
          onBlurCapture={() => {
            const h = historyRef.current;
            if (h?.group) setHist({ ...h, group: undefined });
          }}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <header className="pro-header">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back to chapter from Pro Studio"
              disabled={busy}
              onClick={() => void close()}
            >
              <ArrowLeft />
            </Button>
            <div className="pro-brand">
              <Dialog.Title>
                Inkstrip <span>{mode === "raster" ? "Raster Studio" : "Vector Studio"}</span>
              </Dialog.Title>
              <Dialog.Description>
                {panel.name} · {mode === "raster" ? "raster and layered" : "vector and reference"} ·
                local workspace
              </Dialog.Description>
            </div>
            <div className="pro-mode-switch" role="group" aria-label="Switch editing mode">
              <Button
                type="button"
                variant={mode === "raster" ? "secondary" : "ghost"}
                aria-pressed={mode === "raster"}
                disabled={busy}
                onClick={() => {
                  setMode("raster");
                  onModeChange("raster");
                  setTool("brush");
                  setBefore(false);
                }}
              >
                <Brush /> Raster
              </Button>
              <Button
                type="button"
                variant={mode === "vector" ? "secondary" : "ghost"}
                aria-pressed={mode === "vector"}
                disabled={busy}
                onClick={() => {
                  setMode("vector");
                  onModeChange("vector");
                  setTool("pen");
                  setBefore(false);
                }}
              >
                <PenTool /> Vector
              </Button>
            </div>
            <span className="pro-save-state" role="status">
              {busy
                ? progress
                : rendering
                  ? "Rendering preview…"
                  : saved
                    ? "Draft saved"
                    : "Unsaved draft"}
            </span>
            <div className="pro-history-buttons">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Pro undo"
                disabled={!history?.past.length || busy}
                onClick={() => actions.current.undo()}
              >
                <Undo2 />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Pro redo"
                disabled={!history?.future.length || busy}
                onClick={() => actions.current.redo()}
              >
                <Redo2 />
              </Button>
            </div>
            <Button
              variant="secondary"
              className="pro-save-button"
              disabled={!doc || busy}
              onClick={() => void saveNow().catch((e) => setError(storageMessage(e)))}
            >
              <Save />
              Save draft
            </Button>
            <Button
              intent="save"
              disabled={!doc || busy || stale || !ready}
              onClick={() => void apply()}
            >
              <Layers3 />
              Apply to chapter
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle Pro panels"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((v) => !v)}
            >
              {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </Button>
          </header>
          {(error || stale) && (
            <div className="pro-alert" role="alert">
              {error ||
                "Chapter image changed externally. Pro draft retained; export a native backup before reconciling."}
              <button type="button" aria-label="Dismiss Pro error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {stale && doc ? (
            <div className="pro-recovery-actions">
              <Button variant="secondary" disabled={busy} onClick={() => void exportFile("native")}>
                Export existing layered document
              </Button>
              <Button disabled={busy} onClick={() => void adoptLatestImage()}>
                Use latest chapter image · keep layers
              </Button>
            </div>
          ) : null}
          {error && doc ? (
            <div className="pro-recovery-actions">
              <Button variant="secondary" onClick={() => void exportFile("native")}>
                Export recovery document
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (
                    window.confirm(
                      "Leave without saving this Pro draft? Export a native recovery document first if you need these unsaved changes. Your chapter and the last saved draft remain unchanged.",
                    )
                  ) {
                    closeInProgress.current = true;
                    onClose();
                  }
                }}
              >
                Leave without saving
              </Button>
            </div>
          ) : null}
          <div className="pro-context-bar">
            <span>{TOOLS.find((t) => t.id === tool)?.name ?? "Move"}</span>
            <label className="pro-check">
              <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
              Grid
            </label>
            <label className="pro-check">
              <input
                type="checkbox"
                checked={snapping}
                onChange={(e) => setSnapping(e.target.checked)}
              />
              Snap
            </label>
            <label className="pro-check">
              <input
                type="checkbox"
                disabled={!doc || !sourceReference(doc)}
                aria-label="Compare imported source"
                checked={before}
                onChange={(e) => setBefore(e.target.checked)}
              />
              Imported source
            </label>
            <select
              className="field pro-selection-mode"
              aria-label="Selection operation"
              value={operation}
              onChange={(e) => setOperation(e.target.value as typeof operation)}
            >
              <option value="add">Add selection</option>
              <option value="subtract">Subtract</option>
              <option value="intersect">Intersect</option>
            </select>
            {(tool === "wand" || tool === "color-range") && (
              <>
                <ProNumber
                  label="Color tolerance"
                  value={tolerance}
                  min={0}
                  max={255}
                  onChange={setTolerance}
                />
                {tool === "wand" && (
                  <label className="pro-check">
                    <input
                      type="checkbox"
                      checked={contiguous}
                      onChange={(e) => setContiguous(e.target.checked)}
                    />
                    Contiguous
                  </label>
                )}
                <label className="pro-check">
                  <input
                    type="checkbox"
                    checked={antiAlias}
                    onChange={(e) => setAntiAlias(e.target.checked)}
                  />
                  Anti-alias
                </label>
                <span className="pro-help">
                  Tap artwork to sample visible colors · tolerance 0–255
                </span>
              </>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                if (doc)
                  setSelection({
                    regions: [
                      {
                        kind: "rectangle",
                        operation: "add",
                        points: [
                          { x: 0, y: 0 },
                          { x: doc.width, y: doc.height },
                        ],
                      },
                    ],
                    inverted: false,
                    feather: 0,
                  });
              }}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Fullscreen Pro workspace"
              onClick={() => {
                void (
                  document.fullscreenElement
                    ? document.exitFullscreen()
                    : root.current?.requestFullscreen()
                )?.catch(() =>
                  setError("Fullscreen is unavailable in this browser. The editor remains usable."),
                );
              }}
            >
              <Maximize2 />
            </Button>
          </div>
          <div className={`pro-body ${panelOpen ? "" : "pro-panel-hidden"}`}>
            <nav className="pro-tool-palette" aria-label="Pro tools">
              {TOOLS.filter(({ id }) =>
                (mode === "raster" ? RASTER_TOOL_IDS : VECTOR_TOOL_IDS).has(id),
              ).map(({ id, name, key, Icon }) => (
                <Button
                  key={id}
                  variant="ghost"
                  size="icon"
                  aria-label={`${name} tool`}
                  title={`${name}${key ? ` (${key})` : ""}`}
                  aria-pressed={tool === id}
                  disabled={busy}
                  onClick={() => {
                    chooseTool(id);
                  }}
                >
                  <Icon />
                </Button>
              ))}
            </nav>
            {doc ? (
              <ProCanvas
                doc={doc}
                activeId={selectedIds[0] ?? ""}
                tool={tool}
                selection={selection}
                onSelection={setSelection}
                brush={brush}
                operation={operation}
                maskMode={maskMode}
                snapping={snapping}
                grid={grid}
                before={before}
                canvasRef={canvas}
                renderVersion={version}
                onTransient={setTransient}
                onCommit={commit}
                onSelect={(id) => {
                  setSelectedIds(id ? [id] : []);
                  setMaskMode(false);
                }}
                onColor={(color) => setBrush((b) => ({ ...b, color }))}
                disabled={busy}
                rendering={rendering}
                cloneSource={cloneSource}
                cloneSampleArmed={cloneSampleArmed}
                onColorSelect={(point) => void sampleSelection(point)}
                onCloneSample={(point) => void captureCloneSource(point)}
                onCloneAdvance={(delta) =>
                  setCloneSource((source) =>
                    source && source.aligned
                      ? {
                          ...source,
                          point: { x: source.point.x + delta.x, y: source.point.y + delta.y },
                        }
                      : source,
                  )
                }
              />
            ) : (
              <div className="pro-loading">
                <Layers3 />
                <p>{status}</p>
                {error && <Button onClick={onClose}>Return to chapter</Button>}
              </div>
            )}
            {panelOpen && (
              <aside className="pro-inspector" aria-label="Pro inspector">
                <nav className="pro-panel-tabs" aria-label="Pro panels">
                  {(["properties", "layers", "history", "assets", "ai", "export"] as const).map(
                    (t) => (
                      <button
                        type="button"
                        key={t}
                        aria-pressed={tab === t}
                        onClick={() => setTab(t)}
                      >
                        {t === "ai" ? "AI tools" : t[0]!.toUpperCase() + t.slice(1)}
                      </button>
                    ),
                  )}
                </nav>
                <div className="pro-panel-content">
                  {tab === "properties" && (
                    <ProProperties
                      selected={
                        active && doc ? { ...active, locked: isLocked(doc, active.id) } : active
                      }
                      onPatch={patch}
                      selection={selection}
                      onSelection={setSelection}
                      onMask={() => {
                        if (active && doc) {
                          patch({
                            mask: {
                              selection:
                                selection.regions.length || selection.inverted
                                  ? toLocalSelection(selection, active, {
                                      width: doc.width,
                                      height: doc.height,
                                    })
                                  : { regions: [], inverted: true, feather: 0 },
                              strokes: [],
                              enabled: true,
                            },
                          });
                          setMaskMode(true);
                          setTool("brush");
                        }
                      }}
                      brush={brush}
                      onBrush={(p) => setBrush((b) => ({ ...b, ...p }))}
                      cloneSource={cloneSource}
                      cloneSampleArmed={cloneSampleArmed}
                      onArmCloneSample={() => {
                        setCloneSampleArmed((armed) => !armed);
                        setStatus("Tap the artwork to sample a Clone Stamp source.");
                      }}
                      onCloneAlignment={(aligned) =>
                        setCloneSource((source) => (source ? { ...source, aligned } : source))
                      }
                      brushPresets={brushPresets}
                      onApplyBrushPreset={(preset) => setBrush((b) => ({ ...b, ...preset }))}
                      onSaveBrushPreset={(name) => {
                        try {
                          const next = upsertBrushPreset(brushPresets, {
                            name,
                            settings: {
                              size: brush.size,
                              hardness: brush.hardness,
                              opacity: brush.opacity,
                              flow: brush.flow,
                              color: brush.color === "transparent" ? "#172420" : brush.color,
                              ...(brush.tip ? { tip: brush.tip } : {}),
                            },
                          });
                          if (!saveBrushPresets(browserBrushStorage(), next))
                            throw new Error("Browser storage is unavailable.");
                          setBrushPresets(next);
                        } catch (e) {
                          setError(storageMessage(e));
                        }
                      }}
                      onDeleteBrushPreset={(name) => {
                        const defaults = new Set(["Ink · round", "Soft shade", "Pencil · square"]);
                        if (defaults.has(name)) return;
                        const next = brushPresets.filter((preset) => preset.name !== name);
                        if (saveBrushPresets(browserBrushStorage(), next)) setBrushPresets(next);
                      }}
                      maskMode={maskMode}
                      setMaskMode={setMaskMode}
                    />
                  )}
                  {tab === "layers" && doc && (
                    <>
                      <div className="pro-section-heading">
                        <h3>Document layers</h3>
                        <span>{doc.layers.length} / 48</span>
                      </div>
                      <p className="pro-help">
                        Top row is in front. Drag desktop rows or use layer arrows. Shift-click to
                        group objects.
                      </p>
                      <div className="pro-layer-tree" role="group" aria-label="Layer stack">
                        {branch()}
                      </div>
                      <div className="pro-actions">
                        <Button variant="secondary" disabled={busy} onClick={() => add("paint")}>
                          <Plus />
                          Paint layer
                        </Button>
                        <Button variant="secondary" onClick={() => add("text")}>
                          <Type />
                          Text layer
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label="Bring layer forward"
                          disabled={!active || active.locked}
                          onClick={() =>
                            active && commit(moveLayer(doc, active.id, 1), "Bring forward")
                          }
                        >
                          <ChevronUp />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label="Send layer backward"
                          disabled={!active || active.locked}
                          onClick={() =>
                            active && commit(moveLayer(doc, active.id, -1), "Send backward")
                          }
                        >
                          <ChevronDown />
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={!active || active.kind === "group" || active.locked}
                          onClick={duplicate}
                        >
                          <Copy />
                          Duplicate
                        </Button>
                        <Button
                          variant="danger"
                          disabled={!active || active.locked}
                          onClick={remove}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </div>
                      <div className="pro-actions">
                        <Button variant="secondary" onClick={groupSelected}>
                          Group selected
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={active?.kind !== "group"}
                          onClick={ungroup}
                        >
                          Ungroup
                        </Button>
                      </div>
                      <ToolSection title="Editable speech bubbles">
                        <p className="pro-help">
                          Add a vector bubble and a separate text layer; group them to keep them
                          together in the hierarchy.
                        </p>
                        {(["bubble", "thought", "shout", "caption"] as const).map((shape) => (
                          <Button
                            key={shape}
                            variant="secondary"
                            onClick={() => add("shape", shape)}
                          >
                            <MessageCircle />
                            {shape}
                          </Button>
                        ))}
                      </ToolSection>
                      <ToolSection title="Align selected object">
                        <div className="pro-actions">
                          <Button
                            variant="secondary"
                            disabled={!active || active.kind === "group"}
                            onClick={() =>
                              active && patch({ transform: { ...active.transform, x: 0 } })
                            }
                          >
                            Left
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={
                              !active || active.kind === "group" || !!active.transform.rotation
                            }
                            onClick={() =>
                              active &&
                              patch({
                                transform: {
                                  ...active.transform,
                                  x: (doc.width - active.width * active.transform.scaleX) / 2,
                                },
                              })
                            }
                          >
                            Center
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={
                              !active || active.kind === "group" || !!active.transform.rotation
                            }
                            onClick={() =>
                              active &&
                              patch({
                                transform: {
                                  ...active.transform,
                                  x: doc.width - active.width * active.transform.scaleX,
                                },
                              })
                            }
                          >
                            Right
                          </Button>
                        </div>
                      </ToolSection>
                    </>
                  )}
                  {tab === "history" && history && (
                    <>
                      <h3>Document history</h3>
                      <p className="pro-help">
                        Up to 50 metadata states. Brush gestures form one step. Pan and zoom never
                        alter artwork.
                      </p>
                      <div className="pro-actions">
                        <Button
                          disabled={!history.past.length}
                          onClick={() => actions.current.undo()}
                        >
                          <Undo2 />
                          Undo
                        </Button>
                        <Button
                          disabled={!history.future.length}
                          onClick={() => actions.current.redo()}
                        >
                          <Redo2 />
                          Redo
                        </Button>
                      </div>
                      <ol className="pro-history-list">
                        {[...history.past, history.present].map((entry, i) => (
                          <li key={i} data-current={i === history.past.length}>
                            <span>{String(i + 1).padStart(2, "0")}</span>
                            {entry.label}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  {tab === "assets" && (
                    <>
                      <h3>Assets & characters</h3>
                      <p className="pro-help">
                        References belong to this project. Placing one creates a separate raster
                        layer; no identity matching or upload occurs.
                      </p>
                      <label className="pro-import field">
                        <Folder />
                        Import image / SVG / native
                        <input
                          aria-label="Import Pro asset"
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml,.inkstrip"
                          onChange={(e) => {
                            void importFile(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <p className="pro-help">
                        SVG supports basic paths, shapes and simple text only. Unsafe or unsupported
                        markup is rejected. Native import replaces the editable draft, not the
                        chapter.
                      </p>
                      {project?.characters?.length ? (
                        project.characters.map((c) => (
                          <div key={c.id}>
                            <h4>{c.name}</h4>
                            <p className="pro-help">{c.notes}</p>
                            {c.references.map((r) => (
                              <ReferenceImage
                                key={r.id}
                                blob={r.blob}
                                name={`${c.name} · ${r.angle}`}
                                onPlace={() =>
                                  void addAsset(r.blob, c.name).catch((e) =>
                                    setError(storageMessage(e)),
                                  )
                                }
                              />
                            ))}
                          </div>
                        ))
                      ) : (
                        <div className="pro-empty">
                          <Folder />
                          <p>No saved character references yet.</p>
                          <span>
                            Use the existing image tools to select and save a reference face.
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {tab === "ai" && (
                    <>
                      <div className="pro-section-heading">
                        <h3>Artwork intelligence</h3>
                        <Sparkles />
                      </div>
                      <p className="pro-help">
                        Apply the current composite, then continue in the existing tested image
                        workflow. Layered Pro drafts remain editable here. These actions change the
                        chapter only after the composite succeeds.
                      </p>
                      <Button
                        intent="ai"
                        disabled={busy || stale}
                        onClick={() =>
                          void apply().then((ok) => {
                            if (ok) onContinue("enhance");
                          })
                        }
                      >
                        Apply + Swin2SR Enhance
                      </Button>
                      <p className="pro-help">
                        Genuine local ONNX/WASM inference. First use downloads model assets; no
                        artwork upload.
                      </p>
                      <Button
                        variant="secondary"
                        disabled={busy || stale}
                        onClick={() =>
                          void apply().then((ok) => {
                            if (ok) onContinue("image");
                          })
                        }
                      >
                        Apply + Image tools
                      </Button>
                      <p className="pro-help">
                        Crop, adjustments, object masks, traditional local texture repair and
                        trained anime-face detection. Cloud generative editing requires the existing
                        server configuration and explicit upload consent.
                      </p>
                      <Button
                        variant="secondary"
                        disabled={busy || stale}
                        onClick={() =>
                          void apply().then((ok) => {
                            if (ok) onContinue("face");
                          })
                        }
                      >
                        Apply + AI Face Fix
                      </Button>
                      <p className="pro-help">
                        Optional reference-guided cloud generation. No local face generator or
                        guaranteed identity preservation. Upload consent is requested in that
                        workflow.
                      </p>
                    </>
                  )}
                  {tab === "export" && doc && (
                    <>
                      <h3>Save & export</h3>
                      <p className="pro-help">
                        Native documents keep layers and source bytes. Raster exports flatten the
                        current document at its exact dimensions. JPEG uses a white background for
                        transparency.
                      </p>
                      <Button onClick={() => void exportFile("native")}>
                        <Save />
                        Export editable .inkstrip
                      </Button>
                      <Button variant="secondary" onClick={() => void exportFile("svg")}>
                        Export SVG · vectors only
                      </Button>
                      <label className="pro-field">
                        Raster format
                        <select
                          className="field"
                          aria-label="Pro export format"
                          value={mime}
                          onChange={(e) => setMime(e.target.value)}
                        >
                          {["image/png", "image/jpeg", "image/webp"].map((m) => (
                            <option value={m} key={m}>
                              {m.split("/")[1]!.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </label>
                      {mime !== "image/png" && (
                        <ProNumber
                          label="Export quality"
                          value={quality * 100}
                          min={10}
                          max={100}
                          onChange={(n) => setQuality(n / 100)}
                        />
                      )}
                      <Button
                        intent="export"
                        disabled={busy || !ready}
                        onClick={() => void exportFile("raster")}
                      >
                        <Download />
                        Export composite · {doc.width} × {doc.height}
                      </Button>
                      <ToolSection title="Canvas dimensions">
                        <p className="pro-help">
                          Changing the canvas changes output dimensions; it does not resample source
                          layers. Use object transforms to scale content.
                        </p>
                        <ProNumber
                          label="Document width"
                          value={widthDraft}
                          min={1}
                          max={16384}
                          onChange={setWidthDraft}
                        />
                        <ProNumber
                          label="Document height"
                          value={heightDraft}
                          min={1}
                          max={16384}
                          onChange={setHeightDraft}
                        />
                        <Button
                          variant="secondary"
                          onClick={() =>
                            commit(
                              {
                                ...doc,
                                width: Math.round(widthDraft),
                                height: Math.round(heightDraft),
                              },
                              "Resize canvas",
                            )
                          }
                        >
                          Resize canvas
                        </Button>
                        <label className="pro-field">
                          Background
                          <select
                            className="field"
                            aria-label="Document background"
                            value={doc.background}
                            onChange={(e) =>
                              commit({ ...doc, background: e.target.value }, "Change background")
                            }
                          >
                            <option value="transparent">Transparent</option>
                            <option value="#ffffff">White</option>
                            <option value="#172420">Ink</option>
                          </select>
                        </label>
                      </ToolSection>
                    </>
                  )}
                </div>
                <div className="pro-panel-resizer">
                  <label>
                    Panel width
                    <input
                      type="range"
                      aria-label="Pro panel width"
                      min={260}
                      max={420}
                      value={panelWidth}
                      onChange={(e) => setPanelWidth(+e.target.value)}
                    />
                  </label>
                </div>
              </aside>
            )}
          </div>
          <footer className="pro-footer">
            <span role="status">{status}</span>
            {busy ? (
              <Button variant="danger" disabled={!cancellable} onClick={cancel}>
                Cancel rendering
              </Button>
            ) : (
              <span className="pro-private-label">On this device · original-safe</span>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
