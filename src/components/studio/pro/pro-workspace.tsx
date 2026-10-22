import { ProVectorAppearance } from "./pro-vector-appearance";
import { ProTextPath } from "./pro-text-path";
import { attachText } from "@/lib/studio/pro/text-path";
import type { AppearanceItem } from "@/lib/studio/pro/vector-appearance";
import { ProArtboards } from "./pro-artboards";
import { ProPrecision } from "./pro-precision";
import {
  artboards,
  layout,
  workspaceFrame,
  unionFrames,
  artboardFilename,
  type Artboard,
  type Frame,
} from "@/lib/studio/pro/artboards";
import type { RepairRequest } from "@/lib/studio/pro/repair";
import { appendSelection } from "@/lib/studio/pro/selection";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Crop as CropIcon,
  Scan,
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
  Download,
  Save,
  Maximize2,
  Sparkles,
  Bandage,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProCanvas, type ProTool } from "./pro-canvas";
import { ProAnchors } from "./pro-anchors";
import { ProPathfinder } from "./pro-pathfinder";
import { PathfinderJob } from "@/lib/studio/pro/pathfinder-client";
import type { PathfinderOperation, PathfinderOptions } from "@/lib/studio/pro/pathfinder";
import { editAnchor } from "@/lib/studio/pro/anchor-edit";
import { createCompound, releaseCompound } from "@/lib/studio/pro/compound";
import { documentSources } from "@/lib/studio/pro/raster-budget";
import { contourAt } from "@/lib/studio/pro/model";
import {
  transformDocument,
  transformForest,
  forestFrame,
} from "@/lib/studio/pro/transform-transaction";
import { ProTransform, type TransformDraft } from "./pro-transform";
import { validateTransform, withPivot, bounds } from "@/lib/studio/pro/transform";
import { ProGeometry } from "./pro-geometry";
import { fullCrop, outputSize, type Crop } from "@/lib/studio/pro/geometry";
import { ProProperties, ProNumber } from "./pro-properties";
import {
  EMPTY_SELECTION,
  fromPanel,
  sourceReference,
  layer,
  validateDocument,
  validateAssets,
  toLocalSelection,
  type ProDocument,
  type ProSession,
  type Layer,
  type Selection,
  type Stroke,
  type CloneSource,
} from "@/lib/studio/pro/model";
import { createHistory, record, undo, redo, type History } from "@/lib/studio/editor/history";
import { isLocked, ungroupLayers } from "@/lib/studio/pro/operations";
import { ProLayers } from "./pro-layers";
import {
  duplicateLayers,
  deleteLayers,
  groupLayers,
  translateLayers,
  type MergeMode,
} from "@/lib/studio/pro/layers";
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
  { id: "gradient", name: "Vector Gradient", key: "G", Icon: ScanLine },
  { id: "text-path", name: "Text on Path", key: "Shift+T", Icon: Type },
  { id: "artboard", name: "Artboard Tool", key: "Q", Icon: Scan },
  { id: "move", name: "Move", key: "V", Icon: MousePointer2 },
  { id: "transform", name: "Free Transform", key: "F", Icon: Scan },
  { id: "crop", name: "Crop", key: "C", Icon: CropIcon },
  { id: "hand", name: "Hand", key: "H", Icon: Hand },
  { id: "brush", name: "Brush", key: "B", Icon: Brush },
  { id: "pencil", name: "Pencil", key: "N", Icon: Pencil },
  { id: "clone", name: "Clone Stamp", key: "S", Icon: Stamp },
  { id: "heal", name: "Healing Brush", key: "J", Icon: Brush },
  { id: "spot", name: "Spot Healing Brush", key: "", Icon: Bandage },
  { id: "patch", name: "Patch Repair", key: "", Icon: ScanLine },
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
  "transform",
  "crop",
  "move",
  "hand",
  "brush",
  "pencil",
  "clone",
  "heal",
  "spot",
  "patch",
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
  "gradient",
  "text-path",
  "artboard",
  "transform",
  "crop",
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
    [anchorSelection, setAnchorSelection] = useState({ id: "", index: 0, contour: 0 }),
    [tool, setTool] = useState<ProTool>(initialMode === "raster" ? "brush" : "pen"),
    [transformDraft, setTransformDraft] = useState<TransformDraft | null>(null),
    transformRef = useRef<TransformDraft | null>(null),
    [cropDraft, setCropDraft] = useState<Crop | null>(null),
    [cropRatio, setCropRatio] = useState(0),
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
      sizePressure: true,
      smoothing: 0,
    }),
    [brushPresets, setBrushPresets] = useState<BrushPreset[]>(() =>
      loadBrushPresets(browserBrushStorage()),
    ),
    [cloneSource, setCloneSource] = useState<CloneSource | null>(null),
    [cloneSampleArmed, setCloneSampleArmed] = useState(false),
    [maskMode, setMaskMode] = useState(false),
    [appearanceId, setAppearanceId] = useState(""),
    [appearanceClipboard, setAppearanceClipboard] = useState<AppearanceItem[] | null>(null),
    [activeBoardId, setActiveBoardId] = useState(""),
    [viewScope, setViewScope] = useState(""),
    [moveArtwork, setMoveArtwork] = useState(false),
    [fitRequest, setFitRequest] = useState<{ frame: Frame; serial: number } | null>(null),
    [before, setBefore] = useState(false),
    [tab, setTab] = useState<
      | "properties"
      | "transform"
      | "geometry"
      | "layers"
      | "pathfinder"
      | "artboards"
      | "precision"
      | "appearance"
      | "typography"
      | "history"
      | "assets"
      | "ai"
      | "export"
    >("layers"),
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
    [geometryRevision, setGeometryRevision] = useState(0);
  const pathfinderJob = useRef<PathfinderJob | null>(null);
  useEffect(() => () => pathfinderJob.current?.cancel(), []);
  const displayedDocument = useRef<ProDocument | null>(null),
    displayedBefore = useRef(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<ProRenderer | null>(null),
    root = useRef<HTMLDivElement>(null),
    alive = useRef(true),
    closeInProgress = useRef(false),
    saveTail = useRef<Promise<unknown>>(Promise.resolve()),
    lastSaved = useRef(""),
    generation = useRef(0),
    busyRef = useRef(false),
    operationRun = useRef(0);
  const project = useStudio((s) => s.projects.find((p) => p.id === projectId)),
    livePanel = useStudio((s) => s.panels.find((p) => p.id === panel.id));
  const maxArea =
    (typeof navigator !== "undefined" &&
      ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4) ||
    (typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches)
      ? 4_000_000
      : 16_000_000;
  const doc = useMemo(() => {
      const current = transient ?? history?.present.doc;
      if (!current || !transformDraft) return current;
      return transformDraft.ids
        ? transformForest(current, transformDraft.ids, transformDraft.base, transformDraft.value)
        : transformDocument(
            current,
            transformDraft.layerId,
            transformDraft.value,
            transformDraft.translation,
          );
    }, [transient, history?.present.doc, transformDraft]),
    selection = doc?.selection ?? EMPTY_SELECTION,
    active = doc?.layers.find((l) => l.id === selectedIds[0]);
  const activeBoard = doc
    ? (artboards(doc).find((b) => b.id === activeBoardId) ?? artboards(doc)[0])
    : undefined;
  const viewportFrame = useMemo(() => {
    const d = history?.present.doc;
    if (!d) return undefined;
    if (mode === "raster") return { x: 0, y: 0, width: d.width, height: d.height };
    const boards = artboards(d);
    if (viewScope === "all" && boards.length) return unionFrames(boards);
    return boards.find((b) => b.id === viewScope) ?? workspaceFrame(d);
  }, [history?.present.doc, mode, viewScope]);
  const grid = !!doc && layout(doc).grid,
    snapping = !doc || layout(doc).snapping;
  const activeContour =
    active && anchorSelection.id === active.id
      ? Math.min(anchorSelection.contour, active.subpaths?.length ?? 0)
      : 0;
  const activeAnchor =
    active && anchorSelection.id === active.id
      ? Math.max(
          0,
          Math.min(contourAt(active, activeContour).anchors.length - 1, anchorSelection.index),
        )
      : 0;
  const selectAnchor = (index: number, contour = activeContour) =>
    setAnchorSelection({ id: active?.id ?? "", index, contour });
  useEffect(() => {
    if (before && doc && !sourceReference(doc)) setBefore(false);
  }, [before, doc]);
  useEffect(() => {
    if (tool !== "crop") setCropDraft(null);
  }, [tool]);
  const install = (entry: ProSession, label: string) => {
    sessionRef.current = entry;
    setSession(entry);
    const h = createHistory({ doc: entry.document, label });
    historyRef.current = h;
    setHistory(h);
    setSelectedIds(entry.document.layers.length ? [entry.document.layers.at(-1)!.id] : []);
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
        ?.render(document, maxArea, mode === "vector" ? viewportFrame : undefined)
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
            displayedDocument.current = doc;
            displayedBefore.current = before;
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
  }, [doc, ready, before, busy, maxArea, mode, viewportFrame]);
  useEffect(() => {
    const current = history?.present.doc;
    if (!current) return;
    setSelectedIds((ids) => {
      const valid = ids.filter((id) => current.layers.some((l) => l.id === id));
      return valid.length ? valid : current.layers.length ? [current.layers.at(-1)!.id] : [];
    });
  }, [history?.present.doc]);
  const setHist = useCallback((value: History<Entry>) => {
    historyRef.current = value;
    setHistory(value);
  }, []);
  const commit = useCallback(
    (next: ProDocument, label: string, group?: string) => {
      if (busyRef.current || transformRef.current) return;
      try {
        validateDocument(next);
        if (
          [next, next.crop, next.imageSize].some(
            (size) => size && size.width * size.height > maxArea,
          )
        )
          throw new Error(
            "Canvas, crop or output exceeds this device’s memory budget. Nothing was changed.",
          );
        const h = historyRef.current;
        if (h) setHist(record(h, { doc: next, label }, group));
        setError("");
      } catch (e) {
        setError(storageMessage(e));
      }
    },
    [setHist, maxArea],
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
    try {
      const next = p.transform
        ? translateLayers(current, selectedIds, {
            x: p.transform.x - active.transform.x,
            y: p.transform.y - active.transform.y,
          })
        : current;
      commit(
        { ...next, layers: next.layers.map((l) => (l.id === active.id ? { ...l, ...p } : l)) },
        "Change layer properties",
        group ? `${active.id}:${group}` : undefined,
      );
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const add = (kind: Layer["kind"], shape?: Layer["shape"]) => {
    const d = historyRef.current?.present.doc;
    if (!d || transformRef.current) return;
    const object = layer(
      kind,
      ["paint", "group", "gradient", "adjustment"].includes(kind)
        ? d.width
        : Math.min(280, d.width * 0.7),
      ["paint", "group", "gradient", "adjustment"].includes(kind)
        ? d.height
        : Math.min(180, d.height * 0.4),
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
    if (!["paint", "group", "gradient", "adjustment"].includes(kind))
      object.transform = { ...object.transform, x: d.width * 0.1, y: d.height * 0.1 };
    commit({ ...d, layers: [...d.layers, object] }, `Add ${shape ?? kind}`);
    setSelectedIds([object.id]);
    setMaskMode(false);
    setTool(kind === "paint" ? "brush" : "move");
    setTab("properties");
    setBefore(false);
  };
  const duplicate = () => {
    if (!doc || busyRef.current || transformRef.current) return;
    try {
      const result = duplicateLayers(doc, selectedIds);
      commit(result.document, "Duplicate layers");
      setSelectedIds(result.ids);
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const remove = () => {
    if (!doc || busyRef.current || transformRef.current) return;
    try {
      commit(deleteLayers(doc, selectedIds), "Delete layers");
      setSelectedIds([]);
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const merge = async (mode: MergeMode) => {
    const d = historyRef.current?.present.doc,
      s = sessionRef.current;
    if (!d || !s || busyRef.current || !renderer.current) return;
    const run = ++operationRun.current;
    busyRef.current = true;
    setBusy(true);
    ++generation.current;
    setCancellable(true);
    setError("");
    setProgress("Preparing native-resolution merge…");
    setStatus(
      "Rendering native-resolution merge. Existing layers are retained until validation completes.",
    );
    try {
      const result = await renderer.current.merge(d, maxArea, mode, selectedIds, (n, total) =>
        setProgress(`Merging layer ${n} / ${total}`),
      );
      if (!alive.current || run !== operationRun.current) return;
      if (!result.blob || !result.document || !result.assetId || !result.layerId)
        throw new Error("The merge returned no image. Existing layers are unchanged.");
      if (historyRef.current?.present.doc !== d)
        throw new Error("The document changed. Retry the merge; no layers were replaced.");
      const next = {
        ...sessionRef.current!,
        document: result.document,
        assets: { ...sessionRef.current!.assets, [result.assetId]: result.blob },
      };
      validateAssets(next);
      sessionRef.current = next;
      setSession(next);
      busyRef.current = false;
      commit(
        result.document,
        mode === "flatten"
          ? "Flatten image"
          : mode === "visible"
            ? "Merge visible layers"
            : "Merge selected layers",
      );
      setSelectedIds([result.layerId]);
      setMaskMode(false);
      setBefore(false);
      setAssetEpoch((n) => n + 1);
      setStatus("Layers merged at native resolution. Undo restores the editable layer stack.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(storageMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setCancellable(false);
      setProgress("");
    }
  };
  const saveNow = useCallback(async () => {
    if (transformRef.current) {
      setStatus("Apply or cancel the transform before saving.");
      return;
    }
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
    if (!d || !s || busyRef.current || transformRef.current || !renderer.current) return false;
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
    if (busyRef.current || transformRef.current || !historyRef.current || !sessionRef.current)
      return;
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
        crop: undefined,
        imageSize: undefined,
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
  const exportBoards = async (boards: Artboard[], format: string, scale: number) => {
    if (!doc || busyRef.current || !boards.length || !renderer.current) return;
    setError("");
    try {
      if (cropDraft || transformRef.current)
        throw Error("Apply or cancel the active draft before exporting artboards.");
      if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(format))
        throw Error("Unsupported artboard export format.");
      for (const b of boards)
        if (
          format !== "image/svg+xml" &&
          Math.ceil(b.width * scale) * Math.ceil(b.height * scale) > maxArea
        )
          throw Error(
            "An artboard export exceeds this device’s memory budget. Reduce the raster export scale.",
          );
      const firstSvg = format === "image/svg+xml" ? vectorSvg(doc, boards[0]!) : undefined;
      if (firstSvg && firstSvg.length * boards.length > 24_000_000)
        throw Error("SVG batch exceeds the text memory budget. Export fewer artboards at a time.");
      busyRef.current = true;
      setBusy(true);
      setCancellable(true);
      ++generation.current;
      const run = ++operationRun.current;
      for (let i = 0; i < boards.length; i++) {
        if (run !== operationRun.current || !alive.current)
          throw new DOMException("Export cancelled", "AbortError");
        const b = boards[i]!;
        setProgress(`Exporting artboard ${i + 1} / ${boards.length}`);
        const blob =
          firstSvg !== undefined
            ? new Blob([i === 0 ? firstSvg : vectorSvg(doc, b)], { type: format })
            : (await renderer.current.exportArtboard(doc, maxArea, b, scale, format, quality)).blob;
        if (run !== operationRun.current || !alive.current)
          throw new DOMException("Export cancelled", "AbortError");
        if (blob)
          download(
            blob,
            artboardFilename(
              b,
              artboards(doc).findIndex((n) => n.id === b.id),
              format === "image/svg+xml" ? "svg" : format.split("/")[1]!,
            ),
          );
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      setStatus(
        `Exported ${boards.length} artboard${boards.length === 1 ? "" : "s"} at native bounds. Original artwork retained.`,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(storageMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setCancellable(false);
      setProgress("");
    }
  };
  const exportFile = async (kind: "raster" | "native" | "svg") => {
    if (!doc || !sessionRef.current || busyRef.current) return;
    setError("");
    try {
      if (cropDraft || transformRef.current)
        throw new Error("Apply or cancel the crop/transform draft before exporting.");
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
    pathfinderJob.current?.cancel();
    renderer.current?.dispose();
    setAssetEpoch((n) => n + 1);
    setStatus("Rendering cancelled. Document retained.");
  };
  const addAsset = async (blob: Blob, name: string) => {
    let d = historyRef.current?.present.doc,
      s = sessionRef.current;
    if (!d || !s || busyRef.current || transformRef.current) return;
    const decoded = await decodeBlob(blob);
    try {
      if (!alive.current || busyRef.current || closeInProgress.current || transformRef.current)
        return;
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
    if (!file || !doc || !sessionRef.current || busyRef.current || transformRef.current) return;
    setError("");
    try {
      if (file.name.toLowerCase().endsWith(".inkstrip")) {
        setStatus("Importing editable native document…");
        const imported = await readNative(file, panel.id, sessionRef.current.acceptedBlobId);
        if (!alive.current || busyRef.current || closeInProgress.current || transformRef.current)
          return;
        const next = mergeNativeSession(sessionRef.current, imported);
        validateAssets(next);
        if (
          [next.document, next.document.crop, next.document.imageSize].some(
            (size) => size && size.width * size.height > maxArea,
          )
        )
          throw new Error("Imported canvas, crop or output exceeds this device’s memory budget.");
        sessionRef.current = next;
        setSession(next);
        setCropDraft(null);
        if (tool === "crop") setTool("move");
        commit(next.document, "Import native document");
        setMaskMode(false);
        setSelectedIds(next.document.layers.length ? [next.document.layers.at(-1)!.id] : []);
        setAssetEpoch((n) => n + 1);
        setStatus("Native document imported into this Pro draft. Chapter unchanged.");
      } else if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
        if (file.size > 1_000_000) throw new Error("SVG import limit is 1MB.");
        setStatus("Importing SVG vectors…");
        const imported = importSvg(await file.text());
        if (imported.width * imported.height > maxArea)
          throw new Error("SVG viewport exceeds this device’s memory budget.");
        // Keep the source viewport when placing an SVG into a differently sized Chapter.
        // Each leaf retains a recoverable source mask; group affine motion carries it too.
        if (imported.width !== doc.width || imported.height !== doc.height) {
          for (const l of imported.layers)
            if (l.kind !== "group")
              l.mask = {
                enabled: true,
                strokes: [],
                selection: toLocalSelection(
                  {
                    regions: [
                      {
                        kind: "rectangle",
                        operation: "add",
                        points: [
                          { x: 0, y: 0 },
                          { x: imported.width, y: imported.height },
                        ],
                      },
                    ],
                    inverted: false,
                    feather: 0,
                  },
                  l,
                  { width: imported.width, height: imported.height },
                ),
              };
        }
        const candidate = { ...doc, layers: [...doc.layers, ...imported.layers] };
        documentSources(candidate, maxArea);
        commit(candidate, "Import sanitized vectors");
        setSelectedIds([imported.layers.at(-1)!.id]);
        setStatus(
          imported.warnings.length
            ? `SVG vectors imported with compatibility notes: ${imported.warnings.join(" ")} Chapter unchanged.`
            : "SVG vectors imported. Chapter unchanged.",
        );
      } else if (["image/png", "image/jpeg", "image/webp"].includes(file.type))
        await addAsset(file, file.name);
      else throw new Error("Choose PNG, JPEG, WebP, basic SVG or an .inkstrip document.");
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const groupSelected = () => {
    if (!doc || busyRef.current || transformRef.current) return;
    try {
      const result = groupLayers(doc, selectedIds);
      commit(result.document, "Group layers");
      setSelectedIds([result.id]);
    } catch (e) {
      setError(storageMessage(e));
    }
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
  const runPathfinder = async (operation: PathfinderOperation, options: PathfinderOptions) => {
    const d = historyRef.current?.present.doc,
      s = sessionRef.current;
    if (!d || !s || busyRef.current || transformRef.current || mode !== "vector") return;
    const run = ++operationRun.current;
    busyRef.current = true;
    setBusy(true);
    ++generation.current;
    setCancellable(true);
    setError("");
    setProgress(`Computing Pathfinder ${operation}…`);
    setStatus(
      "Computing editable vector geometry. Source objects remain unchanged until validation completes.",
    );
    try {
      const job = new PathfinderJob(d, selectedIds, operation, options);
      pathfinderJob.current = job;
      const result = await job.result;
      if (!alive.current || run !== operationRun.current) return;
      if (historyRef.current?.present.doc !== d)
        throw new Error("Document changed during Pathfinder. Source objects retained.");
      documentSources(result.document, maxArea);
      validateAssets({ ...s, document: result.document });
      busyRef.current = false;
      commit(result.document, `Pathfinder ${operation}`);
      setSelectedIds(result.ids);
      setTool("move");
      setMaskMode(false);
      setBefore(false);
      setStatus(
        `Pathfinder ${operation}: ${result.ids.length} editable object(s). Undo restores all source objects. Chapter unchanged.`,
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setError(storageMessage(error));
        setStatus("Pathfinder failed. Source objects and Chapter unchanged.");
      }
    } finally {
      pathfinderJob.current = null;
      busyRef.current = false;
      setBusy(false);
      setCancellable(false);
      setProgress("");
    }
  };
  const compound = (operation: "create" | "release") => {
    if (!doc || busyRef.current || transformRef.current) return;
    try {
      if (operation === "create") {
        const result = createCompound(doc, selectedIds);
        documentSources(result.document, maxArea);
        commit(result.document, "Create compound path");
        setSelectedIds([result.id]);
      } else {
        const result = releaseCompound(doc, active?.id ?? "");
        documentSources(result.document, maxArea);
        commit(result.document, "Release compound path");
        setSelectedIds(result.ids);
      }
      setMaskMode(false);
      setTab("properties");
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const cancelTransform = () => {
    transformRef.current = null;
    setTransformDraft(null);
    setTool("move");
  };
  const changeTransform = (value: TransformDraft) => {
    try {
      validateTransform(value.value);
      if (historyRef.current) {
        if (value.ids)
          transformForest(historyRef.current.present.doc, value.ids, value.base, value.value);
        else
          transformDocument(
            historyRef.current.present.doc,
            value.layerId,
            value.value,
            value.translation,
          );
      }
      transformRef.current = value;
      setTransformDraft(value);
      setError("");
      return true;
    } catch (e) {
      setError(storageMessage(e));
      return false;
    }
  };
  const applyTransform = () => {
    const draft = transformRef.current,
      current = historyRef.current?.present.doc;
    if (!draft || !current || busyRef.current) return;
    try {
      const next = draft.ids
        ? transformForest(current, draft.ids, draft.base, draft.value)
        : transformDocument(current, draft.layerId, draft.value, draft.translation);
      validateDocument(next);
      cancelTransform();
      commit(next, "Apply layer transform");
      setStatus("Transform applied. Source artwork, masks and editable objects retained.");
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const createPathText = () => {
    if (!doc || !active) return;
    try {
      const result = attachText(doc, active.id, activeContour);
      commit(result.document, "Create editable text on contour");
      setSelectedIds([result.id]);
      setTool("move");
      setTab("typography");
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const chooseTool = (id: ProTool) => {
    if (id === "text-path") {
      setTab("typography");
      setPanelOpen(true);
      if (active?.kind === "shape") createPathText();
      return;
    }
    if (id === "gradient") {
      setTab("appearance");
      setPanelOpen(true);
      if (!active?.appearance?.some((a) => a.paint.gradient)) {
        setError("Add a linear or radial paint in Appearance before editing gradient handles.");
        return;
      }
    }

    if (id === "artboard") {
      setTab("artboards");
      setPanelOpen(true);
    }
    if (id === "transform" && transformRef.current) {
      setTab("transform");
      setPanelOpen(true);
      return;
    }
    if (id === "transform") {
      if (!doc || !active || isLocked(doc, active.id)) {
        setError("Select unlocked layers or a group for Free Transform.");
        return;
      }
      const current = historyRef.current!.present.doc,
        multiple = selectedIds.length > 1 || active.kind === "group";
      let frame: ReturnType<typeof forestFrame> | undefined;
      try {
        if (multiple) frame = forestFrame(current, selectedIds);
      } catch (e) {
        setError(storageMessage(e));
        return;
      }
      const original = frame
        ? { ...active, ...frame }
        : current.layers.find((l) => l.id === active.id)!;
      let value = original.transform.pivot
        ? structuredClone(original.transform)
        : withPivot(original.transform, { x: original.width / 2, y: original.height / 2 });
      try {
        validateTransform(value);
      } catch {
        value = structuredClone(original.transform);
      }
      if (
        !changeTransform({
          layerId: original.id,
          ...(frame
            ? { ids: [...selectedIds], frame: { width: frame.width, height: frame.height } }
            : {}),
          value,
          base: structuredClone(original.transform),
          mode: value.deform?.kind ?? "affine",
          lock: true,
          translation: { x: 0, y: 0 },
        })
      )
        return;
      setCropDraft(null);
      setTool("transform");
      setBefore(false);
      setTab("transform");
      setPanelOpen(true);
      return;
    }
    if (transformRef.current) cancelTransform();
    setCropDraft(id === "crop" && doc ? { ...(doc.crop ?? fullCrop(doc)) } : null);
    if (id === "crop") {
      setTab("geometry");
      setPanelOpen(true);
    }
    if (
      ["brush", "pencil", "eraser", "clone", "heal", "spot", "patch"].includes(id) &&
      (!maskMode || ["clone", "heal", "spot", "patch"].includes(id)) &&
      active?.kind !== "paint"
    )
      add("paint");
    if (["clone", "heal", "spot", "patch"].includes(id)) setMaskMode(false);
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
      const result = await worker.export(document, maxArea, "image/png", 1, () => {}, true);
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
  const repair = async (request: RepairRequest) => {
    const document = historyRef.current?.present.doc,
      worker = renderer.current;
    if (!document || !worker || busyRef.current || !sessionRef.current) return;
    const run = ++operationRun.current;
    busyRef.current = true;
    setBusy(true);
    ++generation.current;
    setCancellable(true);
    setError("");
    setProgress("Analyzing local texture at native resolution…");
    try {
      const result = await worker.repair(document, maxArea, request);
      if (!alive.current || run !== operationRun.current) return;
      if (!result.blob || !result.document || !result.assetId)
        throw new Error("Repair returned no texture. Nothing was changed.");
      if (historyRef.current?.present.doc !== document)
        throw new Error("Document changed during repair. Retry the stroke.");
      const next = {
        ...sessionRef.current,
        document: result.document,
        assets: { ...sessionRef.current.assets, [result.assetId]: result.blob },
      };
      validateAssets(next);
      sessionRef.current = next;
      setSession(next);
      busyRef.current = false;
      commit(
        result.document,
        request.kind === "spot"
          ? "Spot Healing Brush"
          : request.kind === "patch"
            ? "Patch Repair"
            : "Spatial Healing Brush",
      );
      setAssetEpoch((n) => n + 1);
      setStatus("Repair complete at native resolution. Undo restores the previous artwork.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(storageMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setCancellable(false);
      setProgress("");
    }
  };
  const cancelCrop = () => {
    setCropDraft(null);
    setTool("move");
    setGeometryRevision((n) => n + 1);
  };
  const applyCrop = () => {
    if (!doc || !cropDraft || busyRef.current) return;
    try {
      const next = { ...doc, crop: cropDraft };
      validateDocument(next);
      if (
        [next, next.crop, next.imageSize].some((size) => size && size.width * size.height > maxArea)
      )
        throw new Error("Canvas, crop or output exceeds this device’s memory budget.");
      commit(next, "Apply non-destructive crop");
      cancelCrop();
      setStatus("Crop applied to output. Full canvas, masks and original artwork retained.");
    } catch (e) {
      setError(storageMessage(e));
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
      if (transformRef.current) cancelTransform();
      if (cropDraft) cancelCrop();
      if (historyRef.current) setHist(undo(historyRef.current));
    },
    redo: () => {
      if (transformRef.current) cancelTransform();
      if (cropDraft) cancelCrop();
      if (historyRef.current) setHist(redo(historyRef.current));
    },
    remove: () => {
      const d = historyRef.current?.present.doc;
      if (
        tool === "direct" &&
        (active?.kind === "shape" || !!active?.textPath) &&
        active.shape === "path" &&
        d &&
        !transformRef.current
      ) {
        try {
          commit(
            editAnchor(d, active.id, activeAnchor, { kind: "delete" }, activeContour),
            "Delete Bézier anchor",
          );
          selectAnchor(Math.max(0, activeAnchor - 1));
        } catch (e) {
          setError(storageMessage(e));
        }
      } else remove();
    },
    selectTool: chooseTool,
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        busyRef.current ||
        (e.target as HTMLElement).closest('[role="menu"],[role="alertdialog"]')
      )
        return;
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
        if (tool === "artboard") {
          const d = historyRef.current?.present.doc;
          if (d && activeBoard)
            commit(
              { ...d, artboards: artboards(d).filter((b) => b.id !== activeBoard.id) },
              "Delete artboard boundary",
            );
        } else actions.current.remove();
      } else if (!e.ctrlKey && !e.metaKey) {
        const allowedTools = mode === "raster" ? RASTER_TOOL_IDS : VECTOR_TOOL_IDS;
        const t =
          e.shiftKey && e.key.toLowerCase() === "t" && mode === "vector"
            ? TOOLS.find((t) => t.id === "text-path")
            : TOOLS.find(
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
  }, [mode, tool, activeBoard, commit]);
  const stale = !!session && livePanel?.blobId !== session.acceptedBlobId;
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
            if (
              !busyRef.current &&
              tool !== "patch" &&
              tool !== "crop" &&
              tool !== "transform" &&
              tool !== "artboard" &&
              !transient
            )
              void close();
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
                  if (
                    ["pathfinder", "artboards", "precision", "appearance", "typography"].includes(
                      tab,
                    )
                  )
                    setTab("layers");
                  onModeChange("raster");
                  if (transformRef.current) cancelTransform();
                  setCropDraft(null);
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
                  if (transformRef.current) cancelTransform();
                  setCropDraft(null);
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
              disabled={!doc || busy || !!transformDraft}
              onClick={() => void saveNow().catch((e) => setError(storageMessage(e)))}
            >
              <Save />
              Save draft
            </Button>
            <Button
              intent="save"
              disabled={!doc || busy || stale || !ready || !!cropDraft || !!transformDraft}
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
            {transformDraft && (
              <div className="pro-crop-actions">
                <Button disabled={busy} onClick={applyTransform}>
                  Apply transform
                </Button>
                <Button variant="secondary" onClick={cancelTransform}>
                  Cancel transform
                </Button>
              </div>
            )}
            {cropDraft && (
              <div className="pro-crop-actions">
                <Button onClick={applyCrop} disabled={busy}>
                  Apply crop
                </Button>
                <Button variant="secondary" onClick={cancelCrop}>
                  Cancel crop
                </Button>
              </div>
            )}
            <span>{TOOLS.find((t) => t.id === tool)?.name ?? "Move"}</span>
            <label className="pro-check">
              <input
                type="checkbox"
                checked={grid}
                onChange={(e) =>
                  doc &&
                  commit(
                    { ...doc, layout: { ...layout(doc), grid: e.target.checked } },
                    "Show grid",
                  )
                }
              />
              Grid
            </label>
            <label className="pro-check">
              <input
                type="checkbox"
                checked={snapping}
                onChange={(e) =>
                  doc &&
                  commit(
                    { ...doc, layout: { ...layout(doc), snapping: e.target.checked } },
                    "Toggle snapping",
                  )
                }
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
                  disabled={
                    busy ||
                    (id === "text-path" &&
                      (active?.kind !== "shape" || isLocked(doc!, active.id))) ||
                    (id === "gradient" && !active?.appearance?.some((a) => a.paint.gradient))
                  }
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
                appearanceId={appearanceId}
                viewportFrame={viewportFrame!}
                onFitCanvas={() => setViewScope("")}
                fitRequest={fitRequest}
                artboardId={activeBoard?.id ?? ""}
                onArtboard={setActiveBoardId}
                moveArtwork={moveArtwork}
                transformDraft={transformDraft}
                onTransformDraft={changeTransform}
                onApplyTransform={applyTransform}
                onCancelTransform={cancelTransform}
                cropDraft={cropDraft}
                cropRatio={cropRatio}
                onCropDraft={setCropDraft}
                onCancelCrop={cancelCrop}
                onApplyCrop={applyCrop}
                doc={doc}
                activeId={selectedIds[0] ?? ""}
                selectedIds={selectedIds}
                activeAnchor={activeAnchor}
                activeContour={activeContour}
                onSelectAnchor={selectAnchor}
                onError={setError}
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
                  if (transformRef.current) return;
                  setSelectedIds(id ? [id] : []);
                  setMaskMode(false);
                }}
                onColor={(color) => setBrush((b) => ({ ...b, color }))}
                disabled={busy}
                rendering={
                  rendering ||
                  !ready ||
                  displayedDocument.current !== doc ||
                  displayedBefore.current !== before
                }
                cloneSource={cloneSource}
                cloneSampleArmed={cloneSampleArmed}
                onColorSelect={(point) => void sampleSelection(point)}
                onCloneSample={(point) => void captureCloneSource(point)}
                onRepair={(request) => void repair(request)}
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
                  {(
                    [
                      "properties",
                      "transform",
                      "geometry",
                      "layers",
                      "pathfinder",
                      "artboards",
                      "precision",
                      "appearance",
                      "typography",
                      "history",
                      "assets",
                      "ai",
                      "export",
                    ] as const
                  )
                    .filter(
                      (t) =>
                        ![
                          "pathfinder",
                          "artboards",
                          "precision",
                          "appearance",
                          "typography",
                        ].includes(t) || mode === "vector",
                    )
                    .map((t) => (
                      <button
                        type="button"
                        key={t}
                        aria-pressed={tab === t}
                        onClick={() => setTab(t)}
                      >
                        {t === "ai" ? "AI tools" : t[0]!.toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                </nav>
                <div className="pro-panel-content">
                  {tab === "appearance" && (
                    <ProVectorAppearance
                      layer={
                        active
                          ? {
                              ...active,
                              locked: isLocked(doc!, active.id) || busy || !!transformDraft,
                            }
                          : undefined
                      }
                      selectedId={appearanceId}
                      onSelect={setAppearanceId}
                      onPatch={patch}
                      clipboard={appearanceClipboard}
                      onCopy={setAppearanceClipboard}
                      onGradient={() => chooseTool("gradient")}
                    />
                  )}
                  {tab === "typography" && (
                    <ProTextPath
                      layer={
                        active
                          ? {
                              ...active,
                              locked: isLocked(doc!, active.id) || busy || !!transformDraft,
                            }
                          : undefined
                      }
                      onCreate={createPathText}
                      onPatch={patch}
                      onDirect={() => chooseTool("direct")}
                    />
                  )}
                  {tab === "artboards" && mode === "vector" && doc && (
                    <ProArtboards
                      doc={doc}
                      activeId={activeBoard?.id ?? ""}
                      onActive={setActiveBoardId}
                      onCommit={commit}
                      onError={setError}
                      onTool={() => chooseTool("artboard")}
                      onFit={(frame, id) => {
                        setViewScope(id ?? "all");
                        setFitRequest({ frame, serial: Date.now() });
                      }}
                      moveArtwork={moveArtwork}
                      onMoveArtwork={setMoveArtwork}
                      disabled={busy || !!transformDraft || !!cropDraft}
                      onExport={(boards, format, scale) => void exportBoards(boards, format, scale)}
                    />
                  )}
                  {tab === "precision" && mode === "vector" && doc && (
                    <ProPrecision
                      doc={doc}
                      ids={selectedIds}
                      boardId={activeBoard?.id ?? ""}
                      onCommit={commit}
                      onError={setError}
                      disabled={busy || !!transformDraft || !!cropDraft}
                    />
                  )}
                  {tab === "pathfinder" && mode === "vector" && doc && (
                    <ProPathfinder
                      doc={doc}
                      ids={selectedIds}
                      disabled={busy || !!transformDraft}
                      onRun={(operation, options) => void runPathfinder(operation, options)}
                    />
                  )}

                  {tab === "properties" && (
                    <ProProperties
                      anchorControls={
                        active && doc && active.shape === "path" ? (
                          <ProAnchors
                            key={active.id}
                            doc={doc}
                            layer={active}
                            index={activeAnchor}
                            contour={activeContour}
                            onSelectContour={(contour) => selectAnchor(0, contour)}
                            onSelect={selectAnchor}
                            onChange={(next, label, group) => {
                              documentSources(next, maxArea);
                              commit(next, label, group);
                            }}
                            onError={setError}
                          />
                        ) : undefined
                      }
                      documentSize={doc ? { width: doc.width, height: doc.height } : undefined}
                      selected={
                        active && doc
                          ? { ...active, locked: isLocked(doc, active.id) || !!transformDraft }
                          : active
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
                      {session && (
                        <ProLayers
                          doc={doc}
                          session={session}
                          selectedIds={selectedIds}
                          onSelect={(ids) => {
                            if (transformRef.current) return;
                            setSelectedIds(ids);
                            setMaskMode(false);
                          }}
                          onChange={commit}
                          onError={setError}
                          onDuplicate={duplicate}
                          onDelete={remove}
                          onGroup={groupSelected}
                          onUngroup={ungroup}
                          onCompound={compound}
                          onMerge={(mode) => void merge(mode)}
                          onAdd={add}
                          disabled={busy || !!transformDraft}
                          maxArea={maxArea}
                        />
                      )}
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
                              active &&
                              patch({
                                transform: {
                                  ...active.transform,
                                  x:
                                    active.transform.x -
                                    bounds(active.transform, active.width, active.height).x,
                                },
                              })
                            }
                          >
                            Left
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={!active || active.kind === "group"}
                            onClick={() =>
                              active &&
                              patch({
                                transform: {
                                  ...active.transform,
                                  x:
                                    active.transform.x +
                                    (doc.width -
                                      bounds(active.transform, active.width, active.height).width) /
                                      2 -
                                    bounds(active.transform, active.width, active.height).x,
                                },
                              })
                            }
                          >
                            Center
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={!active || active.kind === "group"}
                            onClick={() =>
                              active &&
                              patch({
                                transform: {
                                  ...active.transform,
                                  x:
                                    active.transform.x +
                                    doc.width -
                                    bounds(active.transform, active.width, active.height).width -
                                    bounds(active.transform, active.width, active.height).x,
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
                  {tab === "transform" && (
                    <ProTransform
                      layer={
                        active && transformDraft?.frame
                          ? { ...active, ...transformDraft.frame }
                          : active
                      }
                      draft={transformDraft}
                      onDraft={changeTransform}
                      onApply={applyTransform}
                      onCancel={cancelTransform}
                      disabled={busy}
                    />
                  )}
                  {tab === "geometry" && doc && (
                    <ProGeometry
                      key={geometryRevision}
                      doc={doc}
                      draft={cropDraft}
                      ratio={cropRatio}
                      onRatio={setCropRatio}
                      onDraft={setCropDraft}
                      onStart={() => chooseTool("crop")}
                      onApply={applyCrop}
                      onCancel={cancelCrop}
                      onReset={() => {
                        commit({ ...doc, crop: undefined }, "Reset non-destructive crop");
                        if (transformRef.current) cancelTransform();
                        if (cropDraft) cancelCrop();
                      }}
                      onCommit={commit}
                      canvasRef={canvas}
                      renderVersion={version}
                      disabled={busy}
                    />
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
                          disabled={busy || !!transformDraft}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml,.inkstrip"
                          onChange={(e) => {
                            void importFile(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <p className="pro-help">
                        SVG imports editable paths, compound contours, affine transforms, nested
                        groups and basic text. Gradients, clipping paths, masks and other unsafe or
                        unsupported markup are rejected. Native import replaces this draft; Chapter
                        artwork is retained.
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
                        disabled={busy || stale || !!transformDraft}
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
                        disabled={busy || stale || !!transformDraft}
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
                        disabled={busy || stale || !!transformDraft}
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
                      {cropDraft && (
                        <p className="pro-help">
                          Apply or cancel your crop draft before exporting. Exports use committed
                          boundaries.
                        </p>
                      )}
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
                        Export composite · {outputSize(doc).width} × {outputSize(doc).height}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setTab("geometry");
                          setPanelOpen(true);
                        }}
                      >
                        Crop, canvas & image size
                      </Button>
                      <ToolSection title="Document background">
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
