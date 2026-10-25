import {
  previewTarget,
  samePreviewTarget,
  type PreviewTarget,
} from "@/lib/studio/pro/preview-target";
import { ProAdjustmentLab } from "./pro-adjustment-lab";
import {
  adjustmentDocument,
  createAdjustmentDraft,
  commitAdjustmentDocument,
  type AdjustmentDraft,
} from "@/lib/studio/pro/adjustment-layer";
import type { AdjustmentLayerSettings } from "@/lib/studio/pro/adjustment-schema";
import { ProColorLab } from "./pro-color-lab";
import { colorTarget, prepareColorCommit } from "@/lib/studio/pro/color-transaction";
import { previewTransform } from "@/lib/studio/pro/transform-session";
import { maskFrame, nudgeDocument } from "@/lib/studio/pro/geometry-operations";
import { selectionTransformTarget } from "@/lib/studio/pro/selection-transform";
import { browserDialogueBudget } from "@/lib/studio/dialogue/budget";
import { saveProjectPresets } from "@/lib/studio/dialogue/presets";
import { ProDialogueExport } from "./pro-dialogue-export";
import { ProDialogue } from "./pro-dialogue";
import { cleanView } from "@/lib/studio/dialogue/operations";
import { reconcileDialogue } from "@/lib/studio/dialogue/operations";
import { validateNativeImages, validateRasterInput } from "@/lib/studio/pro/native-images";
import { previewDirtyRect } from "@/lib/studio/pro/preview-dirty";
import { budgetHistory } from "@/lib/studio/pro/history-budget";
import { copyLayerMask, maskFromSelection } from "@/lib/studio/pro/masks";
import type { Mask } from "@/lib/studio/pro/model";
import { ProRefine, type SelectionView } from "./pro-refine";
import type { RefineOptions } from "@/lib/studio/pro/refine-selection";
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
import {
  combineSelection,
  SELECTION_REGION_LIMIT,
  type ColorMetric,
  type ModifyOperation,
  type SelectionMode,
} from "@/lib/studio/pro/selection-tools";
import { coverageRegion } from "@/lib/studio/pro/refine-selection";
import { thumbnailDocument } from "@/lib/studio/pro/thumbnails";
import { ProSelectionTools } from "./pro-selection-tools";
import { hasLegacyVectorContent, useLegacyVector } from "@/lib/studio/legacy-vector";
import { bucketStroke, hasActiveSelection, intersectRegion } from "@/lib/studio/pro/fill";
import { selectionCanvas } from "@/lib/studio/pro/render";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Brush,
  PenTool,
  Undo2,
  Redo2,
  Layers3,
  Save,
  Maximize2,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProCanvas, type ProTool } from "./pro-canvas";
import { RASTER_TOOL_IDS, TOOLS, VECTOR_TOOL_IDS } from "./pro-tools";
import { ProAiTab, ProAssetsTab, ProExportTab, ProHistoryTab } from "./pro-inspector-tabs";
import { ProAnchors } from "./pro-anchors";
import { ProPathfinder } from "./pro-pathfinder";
import { ProPaths, type PathMaskOptions } from "./pro-paths";
import {
  coverageContours,
  pathLayerFromContours,
  pathSelectionRegion,
  releaseVectorClip,
  vectorClipFromPath,
} from "@/lib/studio/pro/path-selection";
import { gradientToolPresets, reverseStops } from "@/lib/studio/pro/raster-gradient";
import type { Gradient } from "@/lib/studio/pro/gradient";
import { PathfinderJob } from "@/lib/studio/pro/pathfinder-client";
import type { PathfinderOperation, PathfinderOptions } from "@/lib/studio/pro/pathfinder";
import { editAnchor } from "@/lib/studio/pro/anchor-edit";
import { createCompound, releaseCompound } from "@/lib/studio/pro/compound";
import { documentSources } from "@/lib/studio/pro/raster-budget";
import { contourAt } from "@/lib/studio/pro/model";
import { forestFrame } from "@/lib/studio/pro/transform-transaction";
import { ProTransform, type TransformDraft } from "./pro-transform";
import { validateTransform, withPivot, bounds } from "@/lib/studio/pro/transform";
import { ProGeometry } from "./pro-geometry";
import { fullCrop, type Crop } from "@/lib/studio/pro/geometry";
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
  type Region,
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
  loadPressureGamma,
  savePressureGamma,
  saveBrushPresets,
  upsertBrushPreset,
  type BrushPreset,
} from "@/lib/studio/pro/brush-presets";
type Entry = { doc: ProDocument; label: string };
type Rgb = [number, number, number];
type ColorRangeDraft = { include: Rgb[]; exclude: Rgb[]; region?: Region };
const EMPTY_RANGE: ColorRangeDraft = { include: [], exclude: [] };
/** Session-only pixel clipboard (browser clipboard permission is not required). */
type PixelClipboard = {
  blob: Blob;
  width: number;
  height: number;
  x: number;
  y: number;
  name: string;
};
/** Quick Mask is a temporary paint layer, so it reuses the R3 brush engine and history.
 * Its presence in the document is the state: undo/redo and reopened drafts stay consistent. */
export const QUICK_MASK_NAME = "Quick Mask (temporary)";
const QUICK_MASK_TINT = "#ff2a55";
const quickMaskLayer = (d: ProDocument | undefined) =>
  d?.layers.find((l) => l.kind === "paint" && l.name === QUICK_MASK_NAME);
/** Past the native region limit, rasterize the unfeathered selection into one
 * document-resolution pixel region (feather stays a live setting), so the next
 * add/subtract never fails to commit. */
function compactSelection(s: Selection, d: { width: number; height: number }): Selection {
  if (s.regions.length <= SELECTION_REGION_LIMIT) return s;
  const c = selectionCanvas({ ...s, feather: 0 }, d.width, d.height);
  try {
    const data = c.getContext("2d")!.getImageData(0, 0, d.width, d.height).data,
      alpha = new Uint8Array(d.width * d.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
    return {
      regions: [coverageRegion(alpha, d.width, d.height)],
      inverted: false,
      feather: s.feather,
    };
  } finally {
    c.width = c.height = 1;
  }
}
/** A fully covered paint layer carrying `target`'s mask: its composite alpha is the
 * mask coverage in document space (layer transform, placement, inversion included). */
function maskCoverageDocument(d: ProDocument, target: Layer): ProDocument {
  const probe = layer("paint", target.width, target.height);
  probe.transform = structuredClone(target.transform);
  probe.mask = { ...structuredClone(target.mask!), enabled: true };
  probe.strokes = [bucketStroke(probe, { regions: [], inverted: true, feather: 0 }, "#ffffff", 1)];
  return { ...d, background: "transparent", layers: [probe] };
}
const decodeCoverage = (r: Region) => {
  const { width, height, runs } = r.pixels!,
    out = new Uint8Array(width * height);
  for (let i = 0; i < runs.length; i += 3)
    out.fill(runs[i + 2]!, runs[i]!, runs[i]! + runs[i + 1]!);
  return out;
};

export default function ProWorkspace({
  panel,
  projectId,
  mode: initialMode,
  onModeChange,
  onClose,
  onContinue,
  dialogue = false,
  quick = false,
  onDialogue,
  onPresentation,
}: {
  dialogue?: boolean;
  quick?: boolean;
  onDialogue?: () => void;
  onPresentation?: () => void;
  panel: Panel;
  projectId: string;
  mode: "raster" | "vector";
  onModeChange: (mode: "raster" | "vector") => void;
  onClose: () => void;
  onContinue: (mode: "enhance" | "image" | "face") => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const legacyVector = useLegacyVector();
  const [colorDraft, setColorDraft] = useState<{ origin: ProDocument; layerId: string } | null>(
    null,
  );
  const [adjustmentDraft, setAdjustmentDraft] = useState<AdjustmentDraft | null>(null);
  const [dialoguePending, setDialoguePending] = useState(false);
  const dialoguePendingRef = useRef(false);
  dialoguePendingRef.current = dialoguePending;
  const [history, setHistory] = useState<History<Entry> | null>(null),
    historyRef = useRef<History<Entry> | null>(null),
    [transient, setTransient] = useState<ProDocument | null>(null),
    [session, setSession] = useState<ProSession | null>(null),
    sessionRef = useRef<ProSession | null>(null),
    [selectedIds, setSelectedIds] = useState<string[]>([]),
    [anchorSelection, setAnchorSelection] = useState({ id: "", index: 0, contour: 0 }),
    [tool, setTool] = useState<ProTool>(
      dialogue ? "move" : initialMode === "raster" ? "brush" : "pen",
    ),
    [transformDraft, setTransformDraft] = useState<TransformDraft | null>(null),
    transformRef = useRef<TransformDraft | null>(null),
    pixelStage = useRef<{
      origin: ProDocument;
      document: ProDocument;
      assets: Record<string, Blob>;
      layerId: string;
      previousIds: string[];
    } | null>(null),
    [nudgeStep, setNudgeStep] = useState(10),
    [cropDraft, setCropDraft] = useState<Crop | null>(null),
    [cropRatio, setCropRatio] = useState(0),
    [tolerance, setTolerance] = useState(32),
    [gradientKind, setGradientKind] = useState<Gradient["kind"]>("linear"),
    [gradientPreset, setGradientPreset] = useState("Foreground to transparent"),
    [gradientReverse, setGradientReverse] = useState(false),
    [contiguous, setContiguous] = useState(true),
    [antiAlias, setAntiAlias] = useState(true),
    [operation, setOperation] = useState<SelectionMode>("add"),
    [marqueeRatio, setMarqueeRatio] = useState(0),
    [wandSource, setWandSource] = useState<"visible" | "layer">("visible"),
    [colorMetric, setColorMetric] = useState<ColorMetric>("rgb"),
    [colorRange, setColorRange] = useState<ColorRangeDraft>(EMPTY_RANGE),
    [rangeFuzziness, setRangeFuzziness] = useState(0),
    [rangeRemove, setRangeRemove] = useState(false),
    [rangeInvert, setRangeInvert] = useState(false),
    [quickMaskOpacity, setQuickMaskOpacity] = useState(0.5),
    [clipboard, setClipboard] = useState<PixelClipboard | null>(null),
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
    [pressureGamma, setPressureGamma] = useState(() => loadPressureGamma(browserBrushStorage())),
    [cloneSource, setCloneSource] = useState<CloneSource | null>(null),
    [cloneSampleArmed, setCloneSampleArmed] = useState(false),
    [maskMode, setMaskMode] = useState(false),
    [maskClipboard, setMaskClipboard] = useState<Mask | null>(null),
    [refineSampleKey, setRefineSampleKey] = useState<"foreground" | "background" | null>(null),
    [refineSample, setRefineSample] = useState<{
      key: "foreground" | "background";
      color: [number, number, number];
    } | null>(null),
    [refinePreview, setRefinePreview] = useState<Selection | null>(null),
    [selectionView, setSelectionView] = useState<SelectionView>("overlay"),
    [appearanceId, setAppearanceId] = useState(""),
    [appearanceClipboard, setAppearanceClipboard] = useState<AppearanceItem[] | null>(null),
    [activeBoardId, setActiveBoardId] = useState(""),
    [viewScope, setViewScope] = useState(""),
    [moveArtwork, setMoveArtwork] = useState(false),
    [fitRequest, setFitRequest] = useState<{ frame: Frame; serial: number } | null>(null),
    [before, setBefore] = useState(false),
    [tab, setTab] = useState<
      | "dialogue"
      | "refine"
      | "properties"
      | "transform"
      | "geometry"
      | "layers"
      | "paths"
      | "pathfinder"
      | "artboards"
      | "precision"
      | "appearance"
      | "typography"
      | "history"
      | "assets"
      | "ai"
      | "export"
    >(dialogue ? "dialogue" : "layers"),
    [panelOpen, setPanelOpen] = useState(true),
    [panelWidth, setPanelWidth] = useState(300),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Opening layered document…"),
    [saved, setSaved] = useState(false),
    [saveAcknowledgment, setSaveAcknowledgment] = useState(0),
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
    displayedBefore = useRef(false),
    displayedTarget = useRef<PreviewTarget | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<ProRenderer | null>(null),
    root = useRef<HTMLDivElement>(null),
    alive = useRef(true),
    closeInProgress = useRef(false),
    saveTail = useRef<Promise<unknown>>(Promise.resolve()),
    pendingSaves = useRef(0),
    lastSaved = useRef(""),
    generation = useRef(0),
    busyRef = useRef(false),
    operationRun = useRef(0);
  const project = useStudio((s) => s.projects.find((p) => p.id === projectId)),
    livePanel = useStudio((s) => s.panels.find((p) => p.id === panel.id));
  const maxArea = browserDialogueBudget().maxArea;
  const doc = useMemo(() => {
      const current = history?.present.doc;
      if (!current || !transformDraft || transformDraft.origin !== current) return current;
      return previewTransform(current, transformDraft, pixelStage.current?.document);
    }, [history?.present.doc, transformDraft]),
    // Panels edit the committed revision; only the canvas consumes an ongoing
    // pointer preview. Otherwise a concurrent property edit can publish it.
    previewDoc = transient ?? doc,
    selection = doc?.selection ?? EMPTY_SELECTION,
    gradientPresets = gradientToolPresets(brush.color),
    gradientStops = gradientPresets[gradientPreset] ?? gradientPresets["Black to white"]!,
    gradientBase: Gradient = {
      kind: gradientKind,
      angle: 0,
      scale: 1,
      center: { x: 0.5, y: 0.5 },
      stops: gradientReverse ? reverseStops(gradientStops) : gradientStops,
      ...(gradientKind === "radial" ? { radialShape: "circle" as const } : {}),
    },
    active = doc?.layers.find((l) => l.id === selectedIds[0]);
  useEffect(() => {
    // Mask targeting is UI state, not part of document history. Undo/import can
    // remove its target; never let the next brush silently recreate that mask.
    if (!active?.mask) setMaskMode(false);
  }, [active?.id, active?.mask]);
  const activeBoard = doc
    ? (artboards(doc).find((b) => b.id === activeBoardId) ?? artboards(doc)[0])
    : undefined;
  const viewportFrame = useMemo(() => {
    const d = history?.present.doc;
    if (!d) return undefined;
    if (mode === "raster" || dialogue) return { x: 0, y: 0, width: d.width, height: d.height };
    const boards = artboards(d);
    if (viewScope === "all" && boards.length) return unionFrames(boards);
    return boards.find((b) => b.id === viewScope) ?? workspaceFrame(d);
  }, [history?.present.doc, mode, viewScope, dialogue]);
  const requestedPreview = useMemo(
    () =>
      previewTarget(previewDoc, {
        mode,
        before,
        frame: viewportFrame,
        maxArea,
        assetEpoch,
        ready,
        quick,
      }),
    [previewDoc, mode, before, viewportFrame, maxArea, assetEpoch, ready, quick],
  );
  const currentPreviewTarget = useRef(requestedPreview);
  useLayoutEffect(() => {
    // Commit the target before asynchronous replies/passive effects can run.
    currentPreviewTarget.current = requestedPreview;
  }, [requestedPreview]);
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
    if (entry.document.brushSettings) setBrush(entry.document.brushSettings);
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
    pendingSaves.current++;
    if (alive.current) setSaved(false);
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
        }
        return next;
      })
      .then(
        (next) => {
          pendingSaves.current--;
          if (alive.current) {
            setSaved(
              pendingSaves.current === 0 &&
                JSON.stringify(historyRef.current?.present.doc) === lastSaved.current,
            );
            // An older acknowledgement may have persisted a state we already undid/redid.
            // Re-evaluate autosave even when history itself has not changed since that request.
            setSaveAcknowledgment((n) => n + 1);
          }
          return next;
        },
        (error) => {
          pendingSaves.current--;
          throw error;
        },
      );
    saveTail.current = task;
    return task;
  }, []);
  useEffect(() => {
    if (!history || !sessionRef.current || closeInProgress.current || busy) return;
    const signature = JSON.stringify(history.present.doc);
    const durable = signature === lastSaved.current && pendingSaves.current === 0;
    setSaved(durable);
    if (durable || pendingSaves.current > 0) return;
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
  }, [history, persist, busy, saveAcknowledgment]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (
        historyRef.current &&
        (pendingSaves.current > 0 ||
          JSON.stringify(historyRef.current.present.doc) !== lastSaved.current)
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
        .init(
          pixelStage.current
            ? {
                ...sessionRef.current,
                document: pixelStage.current.document,
                assets: { ...sessionRef.current.assets, ...pixelStage.current.assets },
              }
            : sessionRef.current,
          maxArea,
        )
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
    if (!previewDoc || !ready || busy || !renderer.current) return;
    const id = ++generation.current,
      target = requestedPreview;
    setRendering(true);
    const original = sourceReference(previewDoc);
    const raw = original ? layer("raster", original.width, original.height) : undefined;
    if (raw && original) {
      raw.assetId = original.assetId;
      const fit = Math.min(previewDoc.width / original.width, previewDoc.height / original.height);
      raw.transform = {
        x: (previewDoc.width - original.width * fit) / 2,
        y: (previewDoc.height - original.height * fit) / 2,
        scaleX: fit,
        scaleY: fit,
        rotation: 0,
      };
    }
    const document = before ? { ...previewDoc, layers: raw ? [raw] : [] } : previewDoc;
    const timer = setTimeout(() => {
      void renderer.current
        ?.render(document, maxArea, mode === "vector" ? viewportFrame : undefined)
        .then((r) => {
          if (!r.bitmap) return;
          if (
            id !== generation.current ||
            !alive.current ||
            !samePreviewTarget(currentPreviewTarget.current, target)
          ) {
            r.bitmap.close();
            return;
          }
          const c = canvas.current;
          if (c) {
            const dirty =
              mode === "raster" &&
              !before &&
              !displayedBefore.current &&
              c.width === r.bitmap.width &&
              c.height === r.bitmap.height
                ? previewDirtyRect(
                    displayedDocument.current,
                    previewDoc,
                    r.bitmap.width,
                    r.bitmap.height,
                  )
                : null;
            const ctx = c.getContext("2d")!;
            if (dirty) {
              const { x, y, width, height } = dirty;
              ctx.clearRect(x, y, width, height);
              ctx.drawImage(r.bitmap, x, y, width, height, x, y, width, height);
            } else {
              c.width = r.bitmap.width;
              c.height = r.bitmap.height;
              ctx.drawImage(r.bitmap, 0, 0);
            }
            displayedDocument.current = previewDoc;
            displayedBefore.current = before;
            displayedTarget.current = target;
            setVersion((v) => v + 1);
          }
          r.bitmap.close();
          setRendering(false);
        })
        .catch((e) => {
          if (
            id === generation.current &&
            alive.current &&
            samePreviewTarget(currentPreviewTarget.current, target)
          ) {
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
  }, [previewDoc, ready, before, busy, maxArea, mode, viewportFrame, quick, requestedPreview]);
  useEffect(() => {
    const current = history?.present.doc;
    if (!current || pixelStage.current) return;
    setSelectedIds((ids) => {
      const valid = ids.filter((id) => current.layers.some((l) => l.id === id));
      return valid.length ? valid : current.layers.length ? [current.layers.at(-1)!.id] : [];
    });
  }, [history?.present.doc]);
  const setHist = useCallback((state: History<Entry>) => {
    const value = budgetHistory(state);
    historyRef.current = value;
    setHistory(value);
    setBrush(
      value.present.doc.brushSettings ?? {
        size: 24,
        hardness: 0.8,
        opacity: 1,
        flow: 1,
        color: "#a4efd6",
        sizePressure: true,
        smoothing: 0,
      },
    );
  }, []);
  const commit = useCallback(
    (next: ProDocument, label: string, group?: string) => {
      if (busyRef.current || transformRef.current) return false;
      try {
        const previous = historyRef.current?.present.doc;
        if (previous) next = reconcileDialogue(previous, next);
        validateDocument(next);
        documentSources(next, maxArea);
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
        return true;
      } catch (e) {
        setError(storageMessage(e));
        return false;
      }
    },
    [setHist, maxArea],
  );
  const applyPersistentAdjustment = (settings: AdjustmentLayerSettings): true | string => {
    const current = historyRef.current?.present.doc;
    if (!current || !adjustmentDraft || busyRef.current || transformRef.current)
      return "The adjustment target is busy or unavailable.";
    try {
      const next = commitAdjustmentDocument(current, adjustmentDraft, settings, maxArea);
      if (
        next !== current &&
        !commit(next, adjustmentDraft.created ? "Create color adjustment" : "Edit color adjustment")
      )
        return "The document rejected these adjustment settings. Original settings are unchanged.";
      setSelectedIds([adjustmentDraft.layerId]);
      setMaskMode(false);
      setStatus("Editable color adjustment saved. Original artwork is unchanged.");
      return true;
    } catch (e) {
      return storageMessage(e);
    }
  };
  useEffect(() => {
    if (
      adjustmentDraft &&
      (history?.present.doc !== adjustmentDraft.origin ||
        (!adjustmentDraft.created && selectedIds[0] !== adjustmentDraft.layerId))
    )
      setAdjustmentDraft(null);
  }, [history?.present.doc, selectedIds, adjustmentDraft]);
  const applyColor = (blob: Blob) => {
    const current = historyRef.current?.present.doc,
      live = sessionRef.current;
    if (!current || !live || !colorDraft || busyRef.current || transformRef.current)
      return "The document is busy or the color target is no longer available.";
    try {
      const next = prepareColorCommit(
        live,
        current,
        colorDraft.origin,
        colorDraft.layerId,
        blob,
        crypto.randomUUID(),
        crypto.randomUUID(),
        maxArea,
      );
      // Install assets only after acceptance. No await can expose a half-committed entry.
      if (!commit(next.document, "Apply color / filter"))
        return "The document rejected this color transaction. Original pixels are unchanged.";
      sessionRef.current = next;
      setSession(next);
      setAssetEpoch((n) => n + 1);
      setStatus(
        "Color applied in one undo step. Editable original retained hidden; masks and geometry unchanged.",
      );
      return true as const;
    } catch (e) {
      const message = storageMessage(e);
      setError(message);
      return message;
    }
  };
  useEffect(() => {
    if (
      colorDraft &&
      (history?.present.doc !== colorDraft.origin || selectedIds[0] !== colorDraft.layerId)
    )
      setColorDraft(null);
  }, [history?.present.doc, selectedIds, colorDraft]);
  const commitCanvas = useCallback(
    (next: ProDocument, label: string, expected?: ProDocument) => {
      // Check the live history ref as well as the canvas effect. A key/pointer
      // interleaving can otherwise commit before React flushes cancellation.
      if (expected && historyRef.current?.present.doc !== expected) {
        setTransient(null);
        setStatus("Pending canvas edit canceled because the document changed.");
        return;
      }
      commit(next, label);
    },
    [commit],
  );
  const setSelection = useCallback(
    (selection: Selection, expected?: ProDocument) => {
      const current = historyRef.current?.present.doc;
      if (current)
        commitCanvas(
          { ...current, selection: compactSelection(selection, current) },
          "Change selection",
          expected,
        );
    },
    [commitCanvas],
  );
  /** Wand and Color Range sample the visible composite or only the active layer
   * (isolated with its children, at its real position, unaffected by layers above). */
  // An R6 adjustment layer has no pixels of its own: isolating it would sample an empty
  // bitmap, so "Active layer" falls back to the visible composite for it.
  const adjustmentActive = active?.kind === "adjustment";
  const samplingDocument = (d: ProDocument) =>
    wandSource === "layer" &&
    active &&
    !adjustmentActive &&
    d.layers.some((l) => l.id === active.id)
      ? thumbnailDocument(d, active.id)
      : d;
  const rangeRun = useRef(0);
  useEffect(() => {
    // Color Range is a pending dialog: leaving the tool cancels it, never commits it.
    if (tool !== "color-range") {
      ++rangeRun.current;
      setColorRange(EMPTY_RANGE);
    }
  }, [tool]);
  const rangeInclude = colorRange.include,
    rangeExclude = colorRange.exclude;
  useEffect(() => {
    const worker = renderer.current;
    if (tool !== "color-range" || !rangeInclude.length || !doc || !worker) return;
    const run = ++rangeRun.current,
      document = samplingDocument(doc),
      timer = setTimeout(() => {
        void worker
          .colorRange(document, maxArea, {
            include: rangeInclude,
            exclude: rangeExclude,
            tolerance,
            fuzziness: rangeFuzziness,
            metric: colorMetric,
          })
          .then((result) => {
            if (run === rangeRun.current && result.region)
              setColorRange((c) => ({ ...c, region: result.region }));
          })
          .catch((e) => {
            if (run === rangeRun.current && (e as Error).name !== "AbortError")
              setError(storageMessage(e));
          });
      }, 120);
    return () => clearTimeout(timer);
    // samplingDocument depends on wandSource/active, listed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tool,
    rangeInclude,
    rangeExclude,
    tolerance,
    rangeFuzziness,
    colorMetric,
    wandSource,
    active?.id,
    doc,
    maxArea,
  ]);
  const colorRangeSelection =
    tool === "color-range" && colorRange.region && colorRange.include.length && doc
      ? combineSelection(
          doc.selection ?? EMPTY_SELECTION,
          { ...colorRange.region, inverted: rangeInvert },
          operation,
        )
      : null;
  const applyColorRange = () => {
    const current = historyRef.current?.present.doc;
    if (!current || !colorRange.region || busyRef.current) return;
    const next = compactSelection(
      combineSelection(
        current.selection ?? EMPTY_SELECTION,
        { ...colorRange.region, inverted: rangeInvert },
        operation,
      ),
      current,
    );
    if (commit({ ...current, selection: next }, "Color Range selection")) {
      ++rangeRun.current;
      setColorRange(EMPTY_RANGE);
      setStatus("Color Range applied at document resolution.");
    }
  };
  const cancelColorRange = () => {
    ++rangeRun.current;
    setColorRange(EMPTY_RANGE);
    setStatus("Color Range cancelled. The selection is unchanged.");
  };
  /** Worker-computed selection change, committed as one undo step only if the document
   * did not change meanwhile (stale results are discarded, never applied). */
  const selectionJob = async (
    progress: string,
    label: string,
    job: (worker: ProRenderer, document: ProDocument) => Promise<ProDocument | null | undefined>,
  ) => {
    const document = historyRef.current?.present.doc,
      worker = renderer.current;
    if (!document || !worker || busyRef.current || transformRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setProgress(progress);
    try {
      const next = await job(worker, document);
      if (!next || !alive.current) return false;
      if (historyRef.current?.present.doc !== document)
        throw Error("The document changed while the selection was computed. Nothing was applied.");
      busyRef.current = false;
      return commit(next, label);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(storageMessage(e));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress("");
    }
  };
  const modifySelection = (operation: ModifyOperation, amount: number) =>
    void selectionJob(
      "Modifying the selection at document resolution…",
      `${operation[0]!.toUpperCase()}${operation.slice(1)} selection`,
      async (worker, d) => {
        if (!hasActiveSelection(d.selection)) throw Error("Make a selection first.");
        const result = await worker.modifySelection(d, maxArea, operation, amount);
        if (!result.region) return null;
        return {
          ...d,
          selection: {
            regions: result.region.pixels?.runs.length ? [result.region] : [],
            inverted: false,
            feather: d.selection!.feather,
          },
        };
      },
    );
  const selectionFromMask = () =>
    void selectionJob(
      "Loading the mask as a selection…",
      "Selection from mask",
      async (worker, d) => {
        const target = d.layers.find((l) => l.id === selectedIds[0]);
        if (!target?.mask) throw Error("Select a layer with a mask.");
        const result = await worker.alphaSelection(maskCoverageDocument(d, target), maxArea);
        if (!result.region) return null;
        return {
          ...d,
          selection: compactSelection(
            combineSelection(d.selection ?? EMPTY_SELECTION, result.region, operation),
            d,
          ),
        };
      },
    );
  /** Union of the current mask and the selection, baked into a document-frame pixel mask
   * (painted mask strokes become part of that coverage). The enabled state is kept. */
  const addSelectionToMask = () =>
    void selectionJob(
      "Adding the selection to the mask…",
      "Add selection to mask",
      async (worker, d) => {
        const target = d.layers.find((l) => l.id === selectedIds[0]);
        if (!target?.mask || isLocked(d, target.id))
          throw Error("Select an unlocked layer with a mask.");
        if (!hasActiveSelection(d.selection)) throw Error("Make a selection first.");
        const result = await worker.alphaSelection(maskCoverageDocument(d, target), maxArea);
        if (!result.region) return null;
        const mask = decodeCoverage(result.region),
          canvas = selectionCanvas(d.selection!, d.width, d.height);
        try {
          const data = canvas.getContext("2d")!.getImageData(0, 0, d.width, d.height).data;
          for (let i = 0; i < mask.length; i++) mask[i] = Math.max(mask[i]!, data[i * 4 + 3]!);
        } finally {
          canvas.width = canvas.height = 1;
        }
        const union = {
          regions: [coverageRegion(mask, d.width, d.height)],
          inverted: false,
          feather: 0,
        };
        return {
          ...d,
          layers: d.layers.map((l) =>
            l.id === target.id
              ? { ...l, mask: { ...maskFromSelection(union, l, d), enabled: target.mask!.enabled } }
              : l,
          ),
        };
      },
    );
  /** Copy/cut reuse R5's native-resolution split (same eligibility and budgets). */
  const liftPixels = async (kind: "copy" | "cut" | "layer-copy" | "layer-cut") => {
    const current = historyRef.current?.present.doc,
      worker = renderer.current;
    if (!current || !worker || !sessionRef.current || busyRef.current || transformRef.current)
      return;
    if (selectedIds.length !== 1) {
      setError("Select one raster or paint layer.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setProgress("Reading selected pixels at native resolution…");
    try {
      const target = selectionTransformTarget(current, selectedIds[0]!, maxArea),
        result = await worker.stageSelection(current, maxArea, target.id);
      if (!alive.current) return;
      if (historyRef.current?.present.doc !== current)
        throw Error("The document changed while pixels were read. Nothing was changed.");
      if (!result.document || !result.assets || !result.layerId)
        throw Error("No selected pixels were returned.");
      const floating = result.document.layers.find((l) => l.id === result.layerId)!,
        lifted = result.assets[floating.assetId!]!,
        clip: PixelClipboard = {
          blob: lifted,
          width: floating.width,
          height: floating.height,
          x: floating.transform.x,
          y: floating.transform.y,
          name: target.name,
        };
      if (kind === "copy") {
        setClipboard(clip);
        setStatus(`Copied ${clip.width} × ${clip.height} px from ${target.name}.`);
        return;
      }
      let next: ProDocument, assets: Record<string, Blob>, focus: string;
      if (kind === "layer-copy") {
        const id = crypto.randomUUID(),
          l = layer("raster", clip.width, clip.height),
          index = current.layers.findIndex((x) => x.id === target.id);
        l.assetId = id;
        l.name = `${target.name.slice(0, 90)} copy`;
        l.transform = { ...floating.transform };
        l.parentId = target.parentId;
        next = {
          ...current,
          layers: [...current.layers.slice(0, index + 1), l, ...current.layers.slice(index + 1)],
        };
        assets = { [id]: lifted };
        focus = l.id;
      } else {
        const groupId = floating.parentId!;
        next = {
          ...result.document,
          layers: result.document.layers
            .filter((l) => kind === "layer-cut" || l.id !== floating.id)
            .map((l) =>
              l.id === groupId
                ? { ...l, name: `${target.name.slice(0, 80)} · cut` }
                : l.id === floating.id
                  ? { ...l, name: `${target.name.slice(0, 90)} cut` }
                  : l,
            ),
        };
        assets = Object.fromEntries(
          Object.entries(result.assets).filter(
            ([id]) => kind === "layer-cut" || id !== floating.assetId,
          ),
        );
        focus = kind === "layer-cut" ? floating.id : groupId;
      }
      const nextSession = {
        ...sessionRef.current,
        document: next,
        assets: { ...sessionRef.current.assets, ...assets },
      };
      validateAssets(nextSession);
      busyRef.current = false;
      const label = {
        "layer-copy": "Layer via copy",
        "layer-cut": "Layer via cut",
        cut: "Cut selected pixels",
      }[kind];
      if (!commit(next, label)) return;
      sessionRef.current = nextSession;
      setSession(nextSession);
      setAssetEpoch((n) => n + 1);
      setSelectedIds([focus]);
      if (kind === "cut") setClipboard(clip);
      setStatus(
        kind === "layer-copy"
          ? "Selected pixels copied to a new layer above the original."
          : "Selected pixels cut. The original stays hidden and editable inside the group; Undo restores it.",
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(storageMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress("");
    }
  };
  const pastePixels = () => {
    const current = historyRef.current?.present.doc;
    if (!clipboard || !current || !sessionRef.current || busyRef.current || transformRef.current)
      return;
    try {
      const id = crypto.randomUUID(),
        l = layer("raster", clipboard.width, clipboard.height);
      l.assetId = id;
      l.name = `Pasted · ${clipboard.name.slice(0, 80)}`;
      // Same canvas position; clamp so pasted pixels stay inside a smaller document.
      l.transform.x = Math.max(0, Math.min(clipboard.x, current.width - clipboard.width));
      l.transform.y = Math.max(0, Math.min(clipboard.y, current.height - clipboard.height));
      const next = { ...current, layers: [...current.layers, l] },
        nextSession = {
          ...sessionRef.current,
          document: next,
          assets: { ...sessionRef.current.assets, [id]: clipboard.blob },
        };
      validateAssets(nextSession);
      if (!commit(next, "Paste pixels")) return;
      sessionRef.current = nextSession;
      setSession(nextSession);
      setAssetEpoch((n) => n + 1);
      setSelectedIds([l.id]);
      setStatus("Pasted as a new layer at the copied position.");
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const quickMask = quickMaskLayer(doc);
  useEffect(() => {
    // While Quick Mask is active, painting must target only its coverage layer.
    if (quickMask && selectedIds[0] !== quickMask.id) setSelectedIds([quickMask.id]);
  }, [quickMask, selectedIds]);
  const toggleQuickMask = () => {
    const current = historyRef.current?.present.doc;
    if (!current || busyRef.current || transformRef.current) return;
    const existing = quickMaskLayer(current);
    if (!existing) {
      // Seed with the exact selection coverage (feather included), then clear the live
      // selection so it no longer clips the Quick Mask brush.
      const l = layer("paint", current.width, current.height);
      l.name = QUICK_MASK_NAME;
      l.opacity = quickMaskOpacity;
      if (hasActiveSelection(current.selection))
        l.strokes = [bucketStroke(l, current.selection!, QUICK_MASK_TINT, 1)];
      if (
        commit(
          { ...current, selection: { ...EMPTY_SELECTION }, layers: [...current.layers, l] },
          "Enter Quick Mask",
        )
      ) {
        setSelectedIds([l.id]);
        setMaskMode(false);
        if (!["brush", "pencil", "eraser"].includes(tool)) setTool("brush");
        setStatus(
          "Quick Mask: paint to select, erase to deselect. Press Q or Exit Quick Mask to finish.",
        );
      }
      return;
    }
    void selectionJob(
      "Converting Quick Mask to a selection…",
      "Exit Quick Mask",
      async (worker, d) => {
        const probe = {
          ...d,
          background: "transparent",
          layers: [
            {
              ...existing,
              opacity: 1,
              visible: true,
              blend: "source-over" as const,
              parentId: undefined,
            },
          ],
        };
        const result = await worker.alphaSelection(probe, maxArea);
        if (!result.region) return null;
        return {
          ...d,
          layers: d.layers.filter((l) => l.id !== existing.id),
          selection: {
            regions: result.region.pixels?.runs.length ? [result.region] : [],
            inverted: false,
            feather: 0,
          },
        };
      },
    ).then((done) => {
      if (done) {
        setSelectedIds((ids) => ids.filter((id) => id !== existing.id));
        setStatus("Quick Mask converted to a selection at document resolution.");
      }
    });
  };
  /** R6 color tools must never target the temporary Quick Mask coverage layer. */
  const blockedByQuickMaskColor = (d: ProDocument) => {
    if (!quickMaskLayer(d)) return false;
    setError("Exit Quick Mask before using color adjustments or Color & Filters.");
    return true;
  };
  const blockedByQuickMask = () => {
    if (!quickMaskLayer(historyRef.current?.present.doc)) return false;
    setError("Exit Quick Mask before exporting or applying to the chapter.");
    return true;
  };
  const armRefineSample = useCallback((key: "foreground" | "background" | null) => {
    setRefineSampleKey(key);
    if (key) {
      setRefinePreview(null);
      setTool("color-range");
      setStatus(`Tap a visible ${key} pixel. Sampling uses native source resolution.`);
    }
  }, []);
  const sampleSelection = async (point: { x: number; y: number }) => {
    const document = historyRef.current?.present.doc,
      worker = renderer.current;
    if (!document || !worker || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setProgress("Analyzing colors at document resolution…");
    try {
      if (refineSampleKey) {
        const result = await worker.sample(document, maxArea, point);
        if (result.sample && alive.current) {
          setRefineSample({ key: refineSampleKey, color: result.sample });
          setRefineSampleKey(null);
          setTool("move");
          setStatus("Reference color sampled at native resolution.");
        }
        return;
      }
      if (tool === "color-range") {
        // Each tap adds (or removes) a reference colour; Apply commits the preview.
        const sampled = await worker.sample(samplingDocument(document), maxArea, point);
        if (!sampled.sample || !alive.current) return;
        const color = sampled.sample.map(Math.round) as Rgb;
        setColorRange((c) =>
          rangeRemove
            ? { ...c, exclude: [...c.exclude, color].slice(-16) }
            : { ...c, include: [...c.include, color].slice(-16) },
        );
        setStatus(
          `${rangeRemove ? "Removed" : "Added"} rgb(${color.join(", ")}). Adjust tolerance and fuzziness, then Apply or Cancel.`,
        );
        return;
      }
      const result = await worker.select(
        tool === "wand" ? samplingDocument(document) : document,
        maxArea,
        point,
        {
          tolerance,
          contiguous: (tool === "wand" || tool === "fill") && contiguous,
          antiAlias,
          ...(tool === "wand" ? { metric: colorMetric } : {}),
        },
      );
      if (!result.region || !alive.current) return;
      if (tool === "fill") {
        const target = document.layers.find((l) => l.id === selectedIds[0]);
        if (!target || target.kind !== "paint" || isLocked(document, target.id))
          throw new Error("Select an unlocked paint layer for Paint Bucket.");
        let region = result.region;
        // An active selection limits the fill; feathered edges fill partially.
        if (hasActiveSelection(document.selection)) {
          const coverage = selectionCanvas(document.selection!, document.width, document.height),
            data = coverage
              .getContext("2d")!
              .getImageData(0, 0, coverage.width, coverage.height).data,
            alpha = new Uint8ClampedArray(document.width * document.height);
          for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
          coverage.width = coverage.height = 1;
          region = intersectRegion(region, alpha);
        }
        if (!region.pixels?.runs.length) {
          setStatus("Nothing to fill there inside the current selection.");
          return;
        }
        const stroke = bucketStroke(
          target,
          toLocalSelection({ regions: [region], inverted: false, feather: 0 }, target, {
            width: document.width,
            height: document.height,
          }),
          brush.color,
          brush.opacity,
        );
        busyRef.current = false;
        commit(
          {
            ...document,
            layers: document.layers.map((l) =>
              l.id === target.id ? { ...l, strokes: [...l.strokes, stroke] } : l,
            ),
          },
          "Paint Bucket",
        );
        setStatus(
          "Filled at full document resolution as an editable stroke. Undo removes it; the artwork below is unchanged.",
        );
        return;
      }
      const previous = document.selection ?? EMPTY_SELECTION;
      // Release the operation lock before recording its single undo transaction.
      busyRef.current = false;
      commit(
        {
          ...document,
          selection: compactSelection(
            combineSelection(previous, result.region, operation),
            document,
          ),
        },
        "Magic Wand selection",
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
    if (p.fontFamily && active.lettering)
      p = { ...p, lettering: { ...active.lettering, font: p.fontFamily } };
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
    if (blockedByQuickMask()) return;
    if (dialoguePendingRef.current) return false;
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
    if (blockedByQuickMask()) return;
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
    if (!doc || !sessionRef.current || busyRef.current || dialoguePendingRef.current) return;
    if (blockedByQuickMask()) return;
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
    busyRef.current = false;
    setBusy(false);
    setCancellable(false);
    setProgress("");
    setStatus("Rendering cancelled. Document retained.");
  };
  const addAsset = async (blob: Blob, name: string) => {
    let d = historyRef.current?.present.doc,
      s = sessionRef.current;
    if (!d || !s || busyRef.current || transformRef.current) return;
    await validateRasterInput(blob, maxArea);
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
        await validateNativeImages(imported, maxArea);
        if (!alive.current || busyRef.current || closeInProgress.current || transformRef.current)
          return;
        const next = mergeNativeSession(sessionRef.current, imported);
        validateAssets(next);
        documentSources(next.document, maxArea);
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
        if (next.document.brushSettings) setBrush(next.document.brushSettings);
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
    if (!d || !s || busyRef.current || transformRef.current) return;
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
  /** Raster Paths tab: synchronous path ↔ selection ↔ mask edits, one undo step each. */
  const pathEdit = (
    label: string,
    edit: (d: ProDocument) => ProDocument,
    created?: () => { id: string; status?: string } | undefined,
  ) => {
    const d = historyRef.current?.present.doc;
    if (!d || busyRef.current || transformRef.current) return;
    setError("");
    try {
      if (!commit(edit(d), label)) return;
      const made = created?.();
      if (made) {
        setSelectedIds([made.id]);
        setTool("direct");
      }
      setStatus(made?.status ?? `${label}. Undo restores the previous state.`);
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const pathSources = (d: ProDocument) =>
    selectedIds.filter((id) => d.layers.find((l) => l.id === id)?.kind === "shape");
  const loadPathSelection = (mode: SelectionMode, feather: number) =>
    pathEdit("Load path as selection", (d) => {
      const region = pathSelectionRegion(d, pathSources(d)),
        next = combineSelection(d.selection ?? EMPTY_SELECTION, region, mode);
      return { ...d, selection: compactSelection({ ...next, feather }, d) };
    });
  const makePathFromSelection = (tolerance: number) => {
    let made: { id: string; status?: string } | undefined;
    pathEdit(
      "Make path from selection",
      (d) => {
        if (!hasActiveSelection(d.selection)) throw Error("Make a selection first.");
        const c = selectionCanvas({ ...d.selection!, feather: 0 }, d.width, d.height);
        let alpha: Uint8Array;
        try {
          const data = c.getContext("2d")!.getImageData(0, 0, d.width, d.height).data;
          alpha = new Uint8Array(d.width * d.height);
          for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
        } finally {
          c.width = c.height = 1;
        }
        const traced = coverageContours(alpha, d.width, d.height, tolerance),
          path = pathLayerFromContours(traced.contours, {
            name: "Path from selection",
            stroke: brush.color === "transparent" ? "#172420" : brush.color,
          });
        made = {
          id: path.id,
          status:
            traced.dropped || traced.tolerance > tolerance
              ? `Path from selection: tolerance ${traced.tolerance.toFixed(2)} px${traced.dropped ? `, ${traced.dropped} tiny island(s) omitted` : ""} to stay editable.`
              : "Path from selection created. Direct select edits its anchors.",
        };
        return { ...d, layers: [...d.layers, path] };
      },
      () => made,
    );
  };
  const hideSources = (layers: Layer[], ids: string[], hide: boolean) =>
    hide ? layers.map((l) => (ids.includes(l.id) ? { ...l, visible: false } : l)) : layers;
  const layerMaskFromPath = ({ targetId, feather, hideSource }: PathMaskOptions) =>
    pathEdit("Layer mask from path", (d) => {
      const target = d.layers.find((l) => l.id === targetId),
        ids = pathSources(d);
      if (!target || isLocked(d, target.id)) throw Error("Choose an unlocked layer to mask.");
      if (target.mask) throw Error("That layer already has a mask. Delete it first.");
      const region = pathSelectionRegion(d, ids),
        mask = maskFromSelection({ regions: [region], inverted: false, feather: 0 }, target, d);
      return {
        ...d,
        layers: hideSources(
          d.layers.map((l) => (l.id === target.id ? { ...l, mask: { ...mask, feather } } : l)),
          ids,
          hideSource,
        ),
      };
    });
  const vectorMaskFromPath = ({ targetId, hideSource }: PathMaskOptions) =>
    pathEdit("Vector mask from path", (d) => {
      const ids = pathSources(d);
      if (ids.length !== 1) throw Error("Select exactly one path for a vector mask.");
      const target = d.layers.find((l) => l.id === targetId);
      if (!target || isLocked(d, target.id)) throw Error("Choose an unlocked layer to mask.");
      const clip = vectorClipFromPath(d, target.id, ids[0]!);
      return {
        ...d,
        layers: hideSources(
          d.layers.map((l) =>
            l.id === target.id ? { ...l, vectorClips: [...(l.vectorClips ?? []), clip] } : l,
          ),
          ids,
          hideSource,
        ),
      };
    });
  const editVectorClip = (index: number, action: "toggle" | "remove" | "release") => {
    let made: { id: string } | undefined;
    pathEdit(
      action === "release"
        ? "Edit vector mask as path"
        : action === "remove"
          ? "Remove vector mask"
          : "Toggle vector mask",
      (d) => {
        const target = d.layers.find((l) => l.id === selectedIds[0]);
        if (!target?.vectorClips?.[index] || isLocked(d, target.id))
          throw Error("Select an unlocked layer with that vector mask.");
        if (action === "release") {
          const result = releaseVectorClip(
            d,
            target.id,
            index,
            brush.color === "transparent" ? "#172420" : brush.color,
          );
          made = { id: result.id };
          return result.document;
        }
        const clips =
          action === "remove"
            ? target.vectorClips.filter((_, i) => i !== index)
            : target.vectorClips.map((c, i) => (i === index ? { ...c, enabled: !c.enabled } : c));
        return {
          ...d,
          layers: d.layers.map((l) => {
            if (l.id !== target.id) return l;
            const { vectorClips: _previous, ...rest } = l;
            return clips.length ? { ...rest, vectorClips: clips } : rest;
          }),
        };
      },
      () => made,
    );
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
    const stage = pixelStage.current;
    pixelStage.current = null;
    if (stage) {
      setSelectedIds(stage.previousIds);
      setAssetEpoch((n) => n + 1);
    }
    transformRef.current = null;
    setTransformDraft(null);
    setTool("move");
  };
  const changeTransform = (value: TransformDraft) => {
    try {
      validateTransform(value.value);
      const current = historyRef.current?.present.doc;
      if (!current) throw Error("The document is unavailable.");
      previewTransform(current, value, pixelStage.current?.document);
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
      const next = previewTransform(current, draft, pixelStage.current?.document),
        stage = pixelStage.current;
      validateDocument(next);
      documentSources(next, maxArea);
      const nextSession =
        stage && sessionRef.current
          ? {
              ...sessionRef.current,
              document: next,
              assets: { ...sessionRef.current.assets, ...stage.assets },
            }
          : null;
      if (nextSession) validateAssets(nextSession);
      transformRef.current = null;
      const accepted = commit(
        next,
        draft.target === "pixels"
          ? "Transform selected pixels"
          : draft.target === "mask"
            ? "Apply mask transform"
            : "Apply layer transform",
      );
      if (!accepted) {
        transformRef.current = draft;
        return;
      }
      cancelTransform();
      if (nextSession) {
        sessionRef.current = nextSession;
        setSession(nextSession);
      }
      if (stage) setSelectedIds([stage.layerId]);
      setStatus("Transform applied. Source artwork, masks and editable objects retained.");
    } catch (e) {
      setError(storageMessage(e));
    }
  };
  const startSelectedPixels = async () => {
    const current = historyRef.current?.present.doc,
      worker = renderer.current;
    if (!current || !worker || busyRef.current || transformRef.current || selectedIds.length !== 1)
      return;
    const run = ++operationRun.current;
    try {
      selectionTransformTarget(current, selectedIds[0]!, maxArea);
      busyRef.current = true;
      setBusy(true);
      setCancellable(true);
      ++generation.current;
      setProgress("Lifting selected pixels at native resolution…");
      setError("");
      const result = await worker.stageSelection(current, maxArea, selectedIds[0]!);
      if (!alive.current || run !== operationRun.current) return;
      if (historyRef.current?.present.doc !== current)
        throw Error("The document changed during selection staging. Retry the transform.");
      if (!result.document || !result.assets || !result.layerId || !sessionRef.current)
        throw Error("No selected-pixel stage was returned.");
      validateAssets({
        ...sessionRef.current,
        document: result.document,
        assets: { ...sessionRef.current.assets, ...result.assets },
      });
      pixelStage.current = {
        origin: current,
        document: result.document,
        assets: result.assets,
        layerId: result.layerId,
        previousIds: [...selectedIds],
      };
      const floating = result.document.layers.find((l) => l.id === result.layerId)!,
        initial = withPivot(floating.transform, { x: floating.width / 2, y: floating.height / 2 });
      if (
        !changeTransform({
          origin: current,
          target: "pixels",
          layerId: floating.id,
          value: initial,
          base: structuredClone(initial),
          mode: "affine",
          lock: true,
          translation: { x: 0, y: 0 },
        })
      ) {
        cancelTransform();
        return;
      }
      setSelectedIds([floating.id]);
      setAssetEpoch((n) => n + 1);
      setTool("transform");
      setCropDraft(null);
      setBefore(false);
      setMaskMode(false);
      setTab("transform");
      setPanelOpen(true);
      setStatus(
        "Selected pixels staged. Apply commits one undo step; Cancel discards the lift. Original layer retained hidden after Apply.",
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(storageMessage(e));
    } finally {
      if (run === operationRun.current) {
        busyRef.current = false;
        setBusy(false);
        setCancellable(false);
        setProgress("");
      }
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
        multiple = !maskMode && (selectedIds.length > 1 || active.kind === "group");
      let frame: ReturnType<typeof forestFrame> | undefined;
      try {
        if (maskMode) frame = maskFrame(current, active.id);
        else if (multiple) frame = forestFrame(current, selectedIds);
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
          origin: current,
          target: maskMode ? "mask" : undefined,
          layerId: original.id,
          ...(frame
            ? {
                ...(multiple ? { ids: [...selectedIds] } : {}),
                frame: { width: frame.width, height: frame.height },
              }
            : {}),
          value,
          base: structuredClone(value),
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
      ["brush", "pencil", "eraser", "clone", "heal", "spot", "patch", "fill"].includes(id) &&
      (!maskMode || ["clone", "heal", "spot", "patch", "fill"].includes(id)) &&
      active?.kind !== "paint"
    )
      add("paint");
    if (["clone", "heal", "spot", "patch", "fill"].includes(id)) setMaskMode(false);
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
    nudge: (_key: string, _large: boolean) => {},
    selectionKey: (_e: KeyboardEvent): boolean => false,
  });
  actions.current = {
    save: saveNow,
    /** Selection and clipboard shortcuts (raster mode). Returns true when handled. */
    selectionKey: (e: KeyboardEvent) => {
      // R6 adjustment / Color & Filters editors own the keyboard while open.
      if (mode !== "raster" || transformRef.current || cropDraft || colorDraft || adjustmentDraft)
        return false;
      const k = e.key.toLowerCase(),
        mod = e.ctrlKey || e.metaKey,
        d = historyRef.current?.present.doc;
      if (!d) return false;
      if (!mod && !e.altKey && !e.shiftKey && k === "q") {
        toggleQuickMask();
        return true;
      }
      if (!mod || e.altKey) return false;
      if (k === "a" && !e.shiftKey) {
        setSelection({
          regions: [
            {
              kind: "rectangle",
              operation: "add",
              points: [
                { x: 0, y: 0 },
                { x: d.width, y: d.height },
              ],
            },
          ],
          inverted: false,
          feather: 0,
        });
      } else if (k === "d" && !e.shiftKey) setSelection({ ...EMPTY_SELECTION });
      else if (k === "i" && e.shiftKey)
        setSelection({ ...(d.selection ?? EMPTY_SELECTION), inverted: !d.selection?.inverted });
      else if (k === "c" && !e.shiftKey) void liftPixels("copy");
      else if (k === "x" && !e.shiftKey) void liftPixels("cut");
      else if (k === "v" && !e.shiftKey && clipboard) pastePixels();
      else if (k === "j") void liftPixels(e.shiftKey ? "layer-cut" : "layer-copy");
      else return false;
      return true;
    },
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
    nudge: (key: string, large: boolean) => {
      if (tool !== "move" && tool !== "transform") return;
      const step = large ? nudgeStep : 1,
        delta = {
          x: key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0,
          y: key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0,
        },
        draft = transformRef.current;
      if (draft) {
        changeTransform({
          ...draft,
          value: { ...draft.value, x: draft.value.x + delta.x, y: draft.value.y + delta.y },
          translation: { x: draft.translation.x + delta.x, y: draft.translation.y + delta.y },
        });
        return;
      }
      const current = historyRef.current?.present.doc;
      if (current && selectedIds.length) {
        try {
          commit(
            nudgeDocument(current, selectedIds, delta, maskMode),
            maskMode ? "Nudge mask" : "Nudge layers",
            `nudge:${selectedIds.join(":")}:${maskMode}`,
          );
        } catch (e) {
          setError(storageMessage(e));
        }
      }
    },
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (dialoguePendingRef.current) return;
      if (
        busyRef.current ||
        (e.target as HTMLElement).closest('[role="menu"],[role="alertdialog"]')
      )
        return;
      const input = (e.target as HTMLElement).closest(
        "input,textarea,select,[contenteditable=true],[role=textbox]",
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void actions.current.save().catch((err) => setError(storageMessage(err)));
        return;
      }
      if (input) return;
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        /^Arrow(Left|Right|Up|Down)$/.test(e.key) &&
        (tool === "move" || tool === "transform")
      ) {
        e.preventDefault();
        actions.current.nudge(e.key, e.shiftKey);
        return;
      }
      if (actions.current.selectionKey(e)) {
        e.preventDefault();
        return;
      }
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
            : e.shiftKey && e.key.toLowerCase() === "g" && mode === "raster"
              ? TOOLS.find((t) => t.id === "layer-gradient")
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
  const Portal = quick ? Fragment : Dialog.Portal;
  const dialogueTools = new Set<ProTool>([
    "move",
    "transform",
    "hand",
    "direct",
    "pen",
    "text",
    "rectangle",
    "ellipse",
    "select-rect",
    "select-ellipse",
    "lasso",
    "poly-lasso",
  ]);
  const stale = !!session && livePanel?.blobId !== session.acceptedBlobId;
  return (
    <Dialog.Root
      modal={!quick}
      open
      onOpenChange={(v) => {
        if (!v) void close();
      }}
    >
      <Portal>
        {!quick && <Dialog.Overlay className="image-editor-overlay" />}
        <Dialog.Content
          className={`pro-studio ${quick ? "pro-dialogue-quick" : ""}`}
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
              disabled={busy || dialoguePending}
              onClick={() => void close()}
            >
              <ArrowLeft />
            </Button>
            <div className="pro-brand">
              <Dialog.Title>
                Inkstrip{" "}
                <span>
                  {dialogue
                    ? "Dialogue Studio"
                    : mode === "raster"
                      ? "Raster Studio"
                      : "Vector Studio"}
                </span>
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
                disabled={busy || dialoguePending || !!refinePreview}
                onClick={() => {
                  setMode("raster");
                  if (
                    [
                      "dialogue",
                      "pathfinder",
                      "artboards",
                      "precision",
                      "appearance",
                      "typography",
                    ].includes(tab)
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
              {/* Vector Studio is hidden; legacy access remains for vector-only content. */}
              {(legacyVector ||
                (mode === "vector" && !dialogue) ||
                (doc && hasLegacyVectorContent(doc))) && (
                <Button
                  type="button"
                  variant={mode === "vector" ? "secondary" : "ghost"}
                  aria-pressed={mode === "vector"}
                  disabled={busy || dialoguePending}
                  onClick={() => {
                    setMode("vector");
                    if (tab === "dialogue") setTab("layers");
                    onModeChange("vector");
                    if (transformRef.current) cancelTransform();
                    setCropDraft(null);
                    setTool("pen");
                    setBefore(false);
                  }}
                >
                  <PenTool /> Vector
                </Button>
              )}
              {onDialogue && (
                <Button
                  variant={dialogue ? "secondary" : "ghost"}
                  disabled={busy || dialoguePending || !!transient}
                  onClick={() => {
                    onDialogue();
                    setMode("vector");
                    setTab("dialogue");
                    setTool("move");
                  }}
                >
                  {" "}
                  <MessageCircle /> Dialogue
                </Button>
              )}
              {dialogue && onPresentation && (
                <Button
                  variant="ghost"
                  disabled={busy || dialoguePending || !!transient}
                  onClick={onPresentation}
                >
                  {quick ? "Full editor" : "Quick edit"}
                </Button>
              )}
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
                disabled={!history?.past.length || busy || dialoguePending}
                onClick={() => actions.current.undo()}
              >
                <Undo2 />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Pro redo"
                disabled={!history?.future.length || busy || dialoguePending}
                onClick={() => actions.current.redo()}
              >
                <Redo2 />
              </Button>
            </div>
            <Button
              variant="secondary"
              className="pro-save-button"
              disabled={!doc || busy || dialoguePending || !!transformDraft}
              onClick={() => void saveNow().catch((e) => setError(storageMessage(e)))}
            >
              <Save />
              Save draft
            </Button>
            <Button
              intent="save"
              disabled={
                !doc ||
                busy ||
                dialoguePending ||
                stale ||
                !ready ||
                !!cropDraft ||
                !!transformDraft
              }
              onClick={() => void apply()}
            >
              <Layers3 />
              {dialogue ? "Save dialogue to chapter" : "Apply to chapter"}
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
              <Button
                variant="secondary"
                disabled={busy || dialoguePending}
                onClick={() => void exportFile("native")}
              >
                Export existing layered document
              </Button>
              <Button disabled={busy || dialoguePending} onClick={() => void adoptLatestImage()}>
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
                <Button disabled={busy || dialoguePending} onClick={applyTransform}>
                  Apply transform
                </Button>
                <Button variant="secondary" onClick={cancelTransform}>
                  Cancel transform
                </Button>
              </div>
            )}
            {cropDraft && (
              <div className="pro-crop-actions">
                <Button onClick={applyCrop} disabled={busy || dialoguePending}>
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
              <option value="replace">New selection</option>
              <option value="add">Add selection</option>
              <option value="subtract">Subtract</option>
              <option value="intersect">Intersect</option>
            </select>
            {(tool === "select-rect" || tool === "select-ellipse") && (
              <select
                className="field pro-selection-mode"
                aria-label="Marquee aspect ratio"
                value={marqueeRatio}
                onChange={(e) => setMarqueeRatio(Number(e.target.value))}
              >
                <option value={0}>Free ratio</option>
                <option value={1}>1:1</option>
                <option value={4 / 3}>4:3</option>
                <option value={3 / 2}>3:2</option>
                <option value={16 / 9}>16:9</option>
                <option value={2 / 3}>2:3 (portrait)</option>
                <option value={9 / 16}>9:16 (portrait)</option>
              </select>
            )}
            {tool === "layer-gradient" && (
              <>
                <select
                  className="field pro-selection-mode"
                  aria-label="Gradient type"
                  value={gradientKind}
                  onChange={(e) => setGradientKind(e.target.value as Gradient["kind"])}
                >
                  <option value="linear">Linear</option>
                  <option value="radial">Radial</option>
                </select>
                <select
                  className="field pro-selection-mode"
                  aria-label="Gradient tool preset"
                  value={gradientPreset}
                  onChange={(e) => setGradientPreset(e.target.value)}
                >
                  {Object.keys(gradientPresets).map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                <label className="pro-check">
                  <input
                    type="checkbox"
                    aria-label="Reverse gradient"
                    checked={gradientReverse}
                    onChange={(e) => setGradientReverse(e.target.checked)}
                  />
                  Reverse
                </label>
              </>
            )}
            {(tool === "wand" || tool === "color-range" || tool === "fill") && (
              <>
                <ProNumber
                  label="Color tolerance"
                  value={tolerance}
                  min={0}
                  max={255}
                  onChange={setTolerance}
                />
                {(tool === "wand" || tool === "fill") && (
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
                {(tool === "wand" || tool === "color-range") && (
                  <>
                    <select
                      className="field pro-selection-mode"
                      aria-label="Sample source"
                      value={wandSource}
                      onChange={(e) => setWandSource(e.target.value as typeof wandSource)}
                    >
                      <option value="visible">Visible composite</option>
                      <option value="layer">Active layer</option>
                    </select>
                    <select
                      className="field pro-selection-mode"
                      aria-label="Color distance"
                      value={colorMetric}
                      onChange={(e) => setColorMetric(e.target.value as ColorMetric)}
                    >
                      <option value="rgb">RGB distance</option>
                      <option value="perceptual">Perceptual (OKLab)</option>
                    </select>
                  </>
                )}
                {wandSource === "layer" &&
                  adjustmentActive &&
                  (tool === "wand" || tool === "color-range") && (
                    <span className="pro-help" role="status">
                      The active layer is a color adjustment, so the visible image is sampled.
                    </span>
                  )}
                {tool === "color-range" && (
                  <>
                    <label className="pro-check">
                      <input
                        type="checkbox"
                        aria-label="Remove sample"
                        checked={rangeRemove}
                        onChange={(e) => setRangeRemove(e.target.checked)}
                      />
                      Remove sample
                    </label>
                    <ProNumber
                      label="Fuzziness"
                      value={rangeFuzziness}
                      min={0}
                      max={255}
                      onChange={setRangeFuzziness}
                    />
                    <label className="pro-check">
                      <input
                        type="checkbox"
                        aria-label="Invert color range"
                        checked={rangeInvert}
                        onChange={(e) => setRangeInvert(e.target.checked)}
                      />
                      Invert
                    </label>
                    <span className="pro-help" aria-live="polite">
                      {colorRange.include.length} added · {colorRange.exclude.length} removed
                    </span>
                    <Button
                      variant="secondary"
                      disabled={busy || !colorRange.region || !colorRange.include.length}
                      onClick={applyColorRange}
                    >
                      Apply color range
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!colorRange.include.length && !colorRange.exclude.length}
                      onClick={cancelColorRange}
                    >
                      Cancel color range
                    </Button>
                  </>
                )}
                <span className="pro-help">
                  {tool === "color-range"
                    ? "Tap artwork to add reference colors; the preview updates live"
                    : `Tap artwork to sample ${wandSource === "layer" && tool === "wand" && !adjustmentActive ? "the active layer" : "visible colors"} · tolerance 0–255`}
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
                (dialogue
                  ? dialogueTools
                  : mode === "raster"
                    ? RASTER_TOOL_IDS
                    : VECTOR_TOOL_IDS
                ).has(id),
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
                dialogueOverlays={dialogue}
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
                doc={previewDoc ?? doc}
                documentBase={history?.present.doc ?? doc}
                pressureGamma={pressureGamma}
                onStatus={setStatus}
                activeId={selectedIds[0] ?? ""}
                selectedIds={selectedIds}
                activeAnchor={activeAnchor}
                activeContour={activeContour}
                onSelectAnchor={selectAnchor}
                onError={setError}
                tool={tool}
                gradientTool={gradientBase}
                selection={refinePreview ?? colorRangeSelection ?? selection}
                selectionView={selectionView}
                onSelection={setSelection}
                brush={quickMask ? { ...brush, color: QUICK_MASK_TINT } : brush}
                operation={operation}
                marqueeRatio={marqueeRatio}
                maskMode={maskMode}
                snapping={snapping}
                grid={grid}
                before={before}
                canvasRef={canvas}
                renderVersion={version}
                onTransient={setTransient}
                onCommit={commitCanvas}
                onSelect={(id) => {
                  if (transformRef.current) return;
                  setSelectedIds(id ? [id] : []);
                  setMaskMode(false);
                }}
                onColor={(color) => {
                  const next = { ...brush, color };
                  setBrush(next);
                  if (doc) commit({ ...doc, brushSettings: next }, "Sample brush color");
                }}
                disabled={busy || dialoguePending || (!!transient && tab === "dialogue")}
                rendering={
                  rendering ||
                  !ready ||
                  displayedDocument.current !== doc ||
                  displayedBefore.current !== before ||
                  !samePreviewTarget(displayedTarget.current, requestedPreview)
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
                      "dialogue",
                      "refine",
                      "properties",
                      "transform",
                      "geometry",
                      "layers",
                      "paths",
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
                        (t !== "dialogue" || dialogue) &&
                        (!dialogue ||
                          [
                            "dialogue",
                            "properties",
                            "transform",
                            "layers",
                            "history",
                            "assets",
                            "export",
                          ].includes(t)) &&
                        // Pathfinder, masks from paths and path ↔ selection live in Raster's
                        // Paths tab; Appearance is shared by both modes.
                        (t !== "paths" || mode === "raster") &&
                        (!["pathfinder", "artboards", "precision", "typography"].includes(t) ||
                          mode === "vector"),
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
                  {tab === "dialogue" && history && (
                    <ProDialogue
                      document={history.present.doc}
                      selectedId={selectedIds[0] ?? ""}
                      onDocument={commit}
                      onSelect={(id) => setSelectedIds([id])}
                      onTool={chooseTool}
                      onPreview={setTransient}
                      onError={setError}
                      disabled={busy || !!transformDraft}
                      onPending={setDialoguePending}
                      sharedPresets={project?.dialoguePresets ?? []}
                      onSharedPresets={(update) => saveProjectPresets(projectId, update)}
                      quick={quick}
                      onPresentation={onPresentation}
                      onRegion={async (source, frame, signal) => {
                        const current = sessionRef.current;
                        if (!current) throw Error("The document is not ready.");
                        // A preview can supersede jobs on its worker. Isolate bounded region jobs
                        // using the same renderer, immutable assets and compositing engine.
                        const worker = new ProRenderer();
                        const abort = () =>
                          worker.dispose(
                            new DOMException("Region processing cancelled", "AbortError"),
                          );
                        signal?.addEventListener("abort", abort, { once: true });
                        try {
                          signal?.throwIfAborted();
                          await worker.init({ ...current, document: source }, maxArea);
                          const result = await worker.region(
                            cleanView(source, true),
                            maxArea,
                            frame,
                          );
                          signal?.throwIfAborted();
                          if (!result.blob) throw Error("Region extraction failed.");
                          const bitmap = await createImageBitmap(result.blob);
                          try {
                            const output = new OffscreenCanvas(bitmap.width, bitmap.height),
                              ctx = output.getContext("2d")!;
                            ctx.drawImage(bitmap, 0, 0);
                            return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
                          } finally {
                            bitmap.close();
                          }
                        } finally {
                          signal?.removeEventListener("abort", abort);
                          worker.dispose();
                        }
                      }}
                    />
                  )}
                  {tab === "refine" && doc && (
                    <ProRefine
                      document={doc}
                      sample={refineSample}
                      onArmSample={armRefineSample}
                      disabled={busy || dialoguePending || !!transformDraft}
                      canMask={!!active && !isLocked(doc, active.id)}
                      onGenerate={async (options: RefineOptions) => {
                        if (!renderer.current || busyRef.current) return;
                        busyRef.current = true;
                        setBusy(true);
                        setCancellable(true);
                        setProgress("Refining selection at source resolution…");
                        setError("");
                        try {
                          const result = await renderer.current.refine(
                            doc,
                            maxArea,
                            options,
                            (done, total) =>
                              setProgress(`Refining selection · tile ${done} of ${total}`),
                          );
                          if (
                            result.region &&
                            alive.current &&
                            historyRef.current?.present.doc === doc
                          )
                            return { regions: [result.region], inverted: false, feather: 0 };
                        } catch (e) {
                          if ((e as Error).name !== "AbortError") setError(storageMessage(e));
                        } finally {
                          busyRef.current = false;
                          setBusy(false);
                          setCancellable(false);
                          setProgress("");
                        }
                      }}
                      onPreview={setRefinePreview}
                      onView={setSelectionView}
                      onDocument={commit}
                      onApply={(next, mask) => {
                        if (mask && active) patch({ mask: maskFromSelection(next, active, doc) });
                        else setSelection(next);
                      }}
                    />
                  )}
                  {tab === "appearance" && (
                    <ProVectorAppearance
                      layer={
                        active
                          ? {
                              ...active,
                              locked:
                                isLocked(doc!, active.id) ||
                                busy ||
                                dialoguePending ||
                                !!transformDraft,
                            }
                          : undefined
                      }
                      selectedId={appearanceId}
                      onSelect={setAppearanceId}
                      onPatch={patch}
                      clipboard={appearanceClipboard}
                      onCopy={setAppearanceClipboard}
                      onGradient={() =>
                        chooseTool(mode === "raster" ? "layer-gradient" : "gradient")
                      }
                    />
                  )}
                  {tab === "typography" && (
                    <ProTextPath
                      layer={
                        active
                          ? {
                              ...active,
                              locked:
                                isLocked(doc!, active.id) ||
                                busy ||
                                dialoguePending ||
                                !!transformDraft,
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
                      disabled={busy || dialoguePending || !!transformDraft || !!cropDraft}
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
                      disabled={busy || dialoguePending || !!transformDraft || !!cropDraft}
                    />
                  )}
                  {tab === "paths" && mode === "raster" && doc && (
                    <ProPaths
                      doc={doc}
                      ids={selectedIds}
                      disabled={busy || dialoguePending || !!transformDraft || !!cropDraft}
                      onPathfinder={(operation, options) => void runPathfinder(operation, options)}
                      onLoadSelection={loadPathSelection}
                      onMakePath={makePathFromSelection}
                      onLayerMask={layerMaskFromPath}
                      onVectorMask={vectorMaskFromPath}
                      onClip={editVectorClip}
                    />
                  )}
                  {tab === "pathfinder" && mode === "vector" && doc && (
                    <ProPathfinder
                      doc={doc}
                      ids={selectedIds}
                      disabled={busy || dialoguePending || !!transformDraft}
                      onRun={(operation, options) => void runPathfinder(operation, options)}
                    />
                  )}

                  {tab === "properties" && (
                    <>
                      {mode === "raster" && !dialogue && (
                        <>
                          <Button
                            variant="secondary"
                            disabled={
                              busy || !!transformDraft || !!cropDraft || maskMode || !!quickMask
                            }
                            onClick={() => {
                              const current = historyRef.current?.present.doc;
                              if (!current || busyRef.current || transient) return;
                              if (blockedByQuickMaskColor(current)) return;
                              try {
                                const draft = createAdjustmentDraft(current, active?.id);
                                adjustmentDocument(
                                  draft,
                                  {
                                    version: 1,
                                    operation: {
                                      kind: "brightnessContrast",
                                      brightness: 0,
                                      contrast: 0,
                                    },
                                  },
                                  maxArea,
                                );
                                setAdjustmentDraft(draft);
                              } catch (e) {
                                setError(storageMessage(e));
                              }
                            }}
                          >
                            New color adjustment
                          </Button>
                          {active?.adjustmentLayer && (
                            <>
                              <p className="pro-help">
                                Persistent color settings · masks, opacity and order stay editable.
                              </p>
                              <Button
                                variant="secondary"
                                disabled={
                                  busy ||
                                  !!transformDraft ||
                                  !!cropDraft ||
                                  maskMode ||
                                  isLocked(doc!, active.id)
                                }
                                onClick={() => {
                                  const current = historyRef.current?.present.doc;
                                  if (current && active)
                                    setAdjustmentDraft({ origin: current, layerId: active.id });
                                }}
                              >
                                Edit adjustment settings
                              </Button>
                            </>
                          )}
                        </>
                      )}
                      {mode === "raster" && !dialogue && (
                        <Button
                          variant="secondary"
                          disabled={
                            !active ||
                            busy ||
                            dialoguePending ||
                            !!transformDraft ||
                            !!cropDraft ||
                            maskMode ||
                            !!quickMask ||
                            selectedIds.length !== 1 ||
                            !["raster", "paint"].includes(active.kind) ||
                            isLocked(doc!, active.id)
                          }
                          onClick={() => {
                            const current = historyRef.current?.present.doc;
                            if (!current || !active || transient) return;
                            if (blockedByQuickMaskColor(current)) return;
                            try {
                              colorTarget(current, active.id, maxArea);
                              setColorDraft({ origin: current, layerId: active.id });
                            } catch (e) {
                              setError(storageMessage(e));
                            }
                          }}
                        >
                          Color &amp; Filters…
                        </Button>
                      )}
                      {mode === "raster" && maskMode && (
                        <p className="pro-help">
                          Select the artwork thumbnail in Layers to process colors. Mask-only color
                          processing is unavailable.
                        </p>
                      )}
                      {mode === "raster" && !dialogue && quickMask && (
                        <p className="pro-help" role="status">
                          Exit Quick Mask to use color adjustments and Color &amp; Filters.
                        </p>
                      )}
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
                            const replaced = !!active.mask;
                            patch({ mask: maskFromSelection(selection, active, doc) });
                            setMaskMode(true);
                            setTool("brush");
                            if (replaced)
                              setStatus(
                                "Replaced the existing mask with the selection. Undo restores the previous mask.",
                              );
                          }
                        }}
                        brush={brush}
                        onBrush={(p) => {
                          const next = { ...brush, ...p };
                          setBrush(next);
                          if (doc)
                            commit(
                              { ...doc, brushSettings: next },
                              "Brush settings",
                              "brush-settings",
                            );
                        }}
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
                        onPresets={(next) => {
                          if (saveBrushPresets(browserBrushStorage(), next)) setBrushPresets(next);
                          else
                            setError(
                              "Could not save brush presets. Existing preferences are unchanged.",
                            );
                        }}
                        onApplyBrushPreset={(preset, presetTool) => {
                          if (presetTool) chooseTool(presetTool);
                          const next = { ...brush, ...preset };
                          setBrush(next);
                          const current = historyRef.current?.present.doc;
                          if (current)
                            commit({ ...current, brushSettings: next }, "Apply brush preset");
                        }}
                        onSaveBrushPreset={(name) => {
                          try {
                            const next = upsertBrushPreset(brushPresets, {
                              name,
                              tool:
                                tool === "eraser"
                                  ? "eraser"
                                  : tool === "pencil"
                                    ? "pencil"
                                    : "brush",
                              settings: {
                                size: brush.size,
                                hardness: brush.hardness,
                                opacity: brush.opacity,
                                flow: brush.flow,
                                color: brush.color === "transparent" ? "#172420" : brush.color,
                                ...(brush.tip ? { tip: brush.tip } : {}),
                                ...(brush.dynamics
                                  ? { dynamics: structuredClone(brush.dynamics) }
                                  : {}),
                                sizePressure: brush.sizePressure,
                                smoothing: brush.smoothing,
                              },
                            });
                            if (!saveBrushPresets(browserBrushStorage(), next))
                              throw new Error("Browser storage is unavailable.");
                            setBrushPresets(next);
                            return true;
                          } catch (e) {
                            setError(storageMessage(e));
                            return false;
                          }
                        }}
                        pressureGamma={pressureGamma}
                        onPressureGamma={(gamma) => {
                          setPressureGamma(gamma);
                          savePressureGamma(browserBrushStorage(), gamma);
                        }}
                        maskMode={maskMode}
                        setMaskMode={setMaskMode}
                        maskClipboard={!!maskClipboard}
                        onCopyMask={() => {
                          try {
                            if (active) setMaskClipboard(copyLayerMask(active));
                          } catch (e) {
                            setError(storageMessage(e));
                          }
                        }}
                        onPasteMask={() => {
                          if (maskClipboard) patch({ mask: structuredClone(maskClipboard) });
                        }}
                        onApplyMask={async () => {
                          if (
                            !doc ||
                            !active ||
                            !renderer.current ||
                            !sessionRef.current ||
                            busyRef.current
                          )
                            return;
                          busyRef.current = true;
                          setBusy(true);
                          setCancellable(true);
                          setProgress("Baking layer and mask…");
                          const current = sessionRef.current;
                          try {
                            const result = await renderer.current.applyMask(
                              doc,
                              maxArea,
                              active.id,
                            );
                            if (
                              !result.document ||
                              !result.blob ||
                              !result.assetId ||
                              !alive.current
                            )
                              return;
                            const next = {
                              ...current,
                              document: result.document,
                              assets: { ...current.assets, [result.assetId]: result.blob },
                            };
                            validateAssets(next);
                            sessionRef.current = next;
                            setSession(next);
                            busyRef.current = false;
                            commit(next.document, "Bake layer and mask (destructive)");
                            setMaskMode(false);
                            setAssetEpoch((n) => n + 1);
                            setStatus(
                              "Layer and mask baked. Undo and the retained original artwork are available.",
                            );
                          } catch (e) {
                            if ((e as Error).name !== "AbortError") setError(storageMessage(e));
                          } finally {
                            busyRef.current = false;
                            setBusy(false);
                            setCancellable(false);
                            setProgress("");
                          }
                        }}
                      />
                      {doc && mode === "raster" && (
                        <ProSelectionTools
                          hasSelection={hasActiveSelection(selection)}
                          canMask={!!active && !isLocked(doc, active.id)}
                          hasMask={!!active?.mask}
                          canLift={(() => {
                            if (selectedIds.length !== 1) return false;
                            try {
                              selectionTransformTarget(doc, selectedIds[0]!, maxArea);
                              return true;
                            } catch {
                              return false;
                            }
                          })()}
                          clipboard={
                            clipboard
                              ? `${clipboard.width} × ${clipboard.height} px from ${clipboard.name}`
                              : null
                          }
                          quickMask={!!quickMask}
                          quickMaskOpacity={quickMask?.opacity ?? quickMaskOpacity}
                          disabled={busy || dialoguePending || !!transformDraft || !!cropDraft}
                          onModify={modifySelection}
                          onAddToMask={addSelectionToMask}
                          onSelectionFromMask={selectionFromMask}
                          onCopy={() => void liftPixels("copy")}
                          onCut={() => void liftPixels("cut")}
                          onPaste={pastePixels}
                          onLayerViaCopy={() => void liftPixels("layer-copy")}
                          onLayerViaCut={() => void liftPixels("layer-cut")}
                          onQuickMask={toggleQuickMask}
                          onQuickMaskOpacity={(opacity) => {
                            setQuickMaskOpacity(opacity);
                            const current = historyRef.current?.present.doc,
                              qm = quickMaskLayer(current);
                            if (current && qm)
                              commit(
                                {
                                  ...current,
                                  layers: current.layers.map((l) =>
                                    l.id === qm.id ? { ...l, opacity } : l,
                                  ),
                                },
                                "Quick Mask overlay opacity",
                                "quick-mask-opacity",
                              );
                          }}
                        />
                      )}
                    </>
                  )}
                  {tab === "layers" && doc && (
                    <>
                      {session && (
                        <ProLayers
                          doc={doc}
                          session={session}
                          selectedIds={selectedIds}
                          maskMode={maskMode}
                          onSelectMask={(id) => {
                            if (
                              transformRef.current ||
                              !doc.layers.find((l) => l.id === id)?.mask ||
                              isLocked(doc, id)
                            )
                              return;
                            setSelectedIds([id]);
                            setMaskMode(true);
                            setTool("brush");
                          }}
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
                          disabled={busy || dialoguePending || !!transformDraft}
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
                      onSelectedPixels={() => void startSelectedPixels()}
                      nudgeStep={nudgeStep}
                      onNudgeStep={setNudgeStep}
                      onDraft={changeTransform}
                      onApply={applyTransform}
                      onCancel={cancelTransform}
                      disabled={busy || dialoguePending}
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
                      onCommit={(next, label) => {
                        try {
                          commit(typeof next === "function" ? next() : next, label);
                        } catch (e) {
                          setError(storageMessage(e));
                        }
                      }}
                      canvasRef={canvas}
                      renderVersion={version}
                      disabled={busy || dialoguePending}
                    />
                  )}
                  {tab === "history" && history && (
                    <ProHistoryTab
                      history={history}
                      onUndo={() => actions.current.undo()}
                      onRedo={() => actions.current.redo()}
                    />
                  )}
                  {tab === "assets" && (
                    <ProAssetsTab
                      disabled={busy || dialoguePending || !!transformDraft}
                      characters={project?.characters}
                      onImport={(file) => void importFile(file)}
                      onPlace={(blob, name) =>
                        void addAsset(blob, name).catch((e) => setError(storageMessage(e)))
                      }
                    />
                  )}
                  {tab === "ai" && (
                    <ProAiTab
                      disabled={busy || dialoguePending || stale || !!transformDraft}
                      onContinue={(next) =>
                        void apply().then((ok) => {
                          if (ok) onContinue(next);
                        })
                      }
                    />
                  )}
                  {tab === "export" && dialogue && doc && session && (
                    <ProDialogueExport
                      document={history!.present.doc}
                      session={session}
                      maxArea={maxArea}
                      mime={mime}
                      quality={quality}
                      disabled={busy || !!transformDraft || !!cropDraft}
                      onError={setError}
                      onPending={setDialoguePending}
                    />
                  )}
                  {tab === "export" && doc && (
                    <ProExportTab
                      doc={doc}
                      cropPending={!!cropDraft}
                      busy={busy || dialoguePending}
                      ready={!!ready}
                      mime={mime}
                      quality={quality}
                      onMime={setMime}
                      onQuality={setQuality}
                      onExport={(kind) => void exportFile(kind)}
                      onOpenGeometry={() => {
                        setTab("geometry");
                        setPanelOpen(true);
                      }}
                      onBackground={(background) =>
                        commit({ ...doc, background }, "Change background")
                      }
                    />
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
          {adjustmentDraft && session && (
            <ProAdjustmentLab
              key={adjustmentDraft.layerId}
              draft={adjustmentDraft}
              session={session}
              maxArea={maxArea}
              onCancel={() => setAdjustmentDraft(null)}
              onApply={applyPersistentAdjustment}
            />
          )}
          {colorDraft && session && (
            <ProColorLab
              origin={colorDraft.origin}
              layerId={colorDraft.layerId}
              session={session}
              maxArea={maxArea}
              onCancel={() => setColorDraft(null)}
              onApply={applyColor}
            />
          )}
        </Dialog.Content>
      </Portal>
    </Dialog.Root>
  );
}
