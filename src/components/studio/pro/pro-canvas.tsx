import { cloneTransformDraft } from "@/lib/studio/pro/transform-session";
import { maskFrame, nudgeDocument } from "@/lib/studio/pro/geometry-operations";
import { bubbleFor, updateBubble } from "@/lib/studio/dialogue/operations";
import { DEFAULT_LETTERING } from "@/lib/studio/dialogue/types";
import { maskPaintPoint, maskWorld, maskLocal } from "@/lib/studio/pro/masks";
import { brushCursor } from "@/lib/studio/pro/brush-cursor";
import { clipPath } from "@/lib/studio/pro/vector-clip";
import { gradientHandles, moveGradientHandle } from "@/lib/studio/pro/vector-appearance";
import { measureTextPath } from "@/lib/studio/pro/text-path";
import {
  artboards,
  changeArtboard,
  layout,
  type Frame,
  type Artboard,
} from "@/lib/studio/pro/artboards";
import {
  buildSnapIndex,
  snapGeometry,
  snapHandle,
  selectionBounds,
  type SnapIndex,
  type SnapGuide,
} from "@/lib/studio/pro/precision";
import type { TransformDraft } from "./pro-transform";
import {
  affine,
  applyMatrix,
  bounds,
  dragTransform,
  mapping,
  transformHandles,
} from "@/lib/studio/pro/transform";
import {
  CROP_HANDLES,
  cropHandlePoint,
  cropLocal,
  cropPoint,
  dragCrop,
  outputSize,
  type Crop,
  type CropHandle,
} from "@/lib/studio/pro/geometry";
import { brushPoint, appendBrushSample, finishBrushStroke } from "@/lib/studio/pro/brush-dynamics";
import { patchSelection, type RepairRequest, type RepairKind } from "@/lib/studio/pro/repair";
import {
  appendLassoPoint,
  combineSelection,
  marqueeCorners,
  type SelectionMode,
} from "@/lib/studio/pro/selection-tools";
import { editedAnchor } from "@/lib/studio/pro/anchor-edit";
import {
  viewFit,
  rotatePoint,
  rotateCanvasView,
  canvasPoint,
  centerViewOn,
  frameHandleAt,
  type CanvasView,
} from "@/lib/studio/pro/viewport";
import { anchorCurve, cubicPoint, splitAnchorSegment } from "@/lib/studio/pro/bezier";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointer } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Scan, Hand, RotateCcw, RotateCw, RefreshCw } from "lucide-react";
import {
  layer,
  validateDocument,
  localPoint,
  toLocalSelection,
  worldPoint,
  contourAt,
  contours,
  withContour,
  type ProDocument,
  type Layer,
  type Point,
  type Selection,
  type Stroke,
  type Region,
  type CloneSource,
} from "@/lib/studio/pro/model";
import { translationIds, visibleLayerIds } from "@/lib/studio/pro/layers";
import { isLocked } from "@/lib/studio/pro/operations";
import { selectionCanvas } from "@/lib/studio/pro/render";
import { shapePath } from "@/lib/studio/pro/paths";
import { RULER_SIZE, type RulerUnit } from "@/lib/studio/pro/rulers";
import { ProRulers } from "./pro-rulers";
export type ProTool =
  | "gradient"
  | "text-path"
  | "artboard"
  | "transform"
  | "crop"
  | "move"
  | "hand"
  | "brush"
  | "pencil"
  | "clone"
  | "heal"
  | "spot"
  | "patch"
  | "eraser"
  | "eyedropper"
  | "rectangle"
  | "ellipse"
  | "line"
  | "polygon"
  | "star"
  | "pen"
  | "direct"
  | "text"
  | "select-rect"
  | "select-ellipse"
  | "wand"
  | "color-range"
  | "fill"
  | "lasso"
  | "poly-lasso";
type View = CanvasView;
type Gesture = {
  origin: ProDocument;
  maskMode: boolean;
  appearanceIndex?: number;
  snap?: SnapIndex;
  moveFrame?: Frame;
  board?: Artboard;
  preview?: ProDocument;
  guideId?: string;
  transform?: TransformDraft;
  transformHandle?: string;
  crop?: Crop;
  cropHandle?: CropHandle;
  type: string;
  start: Point;
  screen: Point;
  doc: ProDocument;
  id?: string;
  ids?: string[];
  stroke?: Stroke;
  /** Latest smoothed sample; stored points are a bounded subset of these. */
  filtered?: Stroke["points"][number];
  /** Stored path length, tracked so recording stays inside the dab budget. */
  length?: number;
  full?: boolean;
  repairKind?: RepairKind;
  region?: Region;
  index?: number;
  contour?: number;
  part?: string;
  corner?: string;
  view: View;
  selection: Selection;
};
export function ProCanvas({
  dialogueOverlays = false,
  doc,
  documentBase,
  pressureGamma = 1,
  onStatus,
  viewportFrame,
  appearanceId,
  onFitCanvas,
  fitRequest,
  artboardId,
  onArtboard,
  moveArtwork,
  transformDraft,
  onTransformDraft,
  onApplyTransform,
  onCancelTransform,
  cropDraft,
  cropRatio,
  onCropDraft,
  onCancelCrop,
  onApplyCrop,
  activeId,
  selectedIds,
  activeAnchor,
  activeContour,
  onSelectAnchor,
  onError,
  tool,
  selection,
  selectionView = "overlay",
  onSelection,
  brush,
  operation,
  marqueeRatio = 0,
  maskMode,
  snapping,
  grid,
  rulers = false,
  rulerUnit = "px",
  before,
  canvasRef,
  renderVersion,
  onTransient,
  onCommit,
  onSelect,
  onColor,
  disabled,
  rendering,
  cloneSource,
  cloneSampleArmed,
  onColorSelect,
  onCloneSample,
  onCloneAdvance,
  onRepair,
}: {
  dialogueOverlays?: boolean;
  doc: ProDocument;
  documentBase: ProDocument;
  /** Per-device pen pressure response (p^gamma), applied as samples are recorded. */
  pressureGamma?: number;
  /** Persistent notice; errors are cleared by the next successful commit. */
  onStatus?: (message: string) => void;
  viewportFrame: Frame;
  appearanceId: string;
  onFitCanvas: () => void;
  fitRequest: { frame: Frame; serial: number } | null;
  artboardId: string;
  onArtboard: (id: string) => void;
  moveArtwork: boolean;
  transformDraft: TransformDraft | null;
  onTransformDraft: (d: TransformDraft) => void;
  onApplyTransform: () => void;
  onCancelTransform: () => void;
  cropDraft: Crop | null;
  cropRatio: number;
  onCropDraft: (c: Crop) => void;
  onCancelCrop: () => void;
  onApplyCrop: () => void;
  activeId: string;
  selectedIds: string[];
  activeAnchor: number;
  activeContour: number;
  onSelectAnchor: (index: number, contour?: number) => void;
  onError: (message: string) => void;
  tool: ProTool;
  selection: Selection;
  selectionView?: "overlay" | "mask" | "ants";
  onSelection: (s: Selection, expected?: ProDocument) => void;
  brush: Omit<Stroke, "points" | "erase">;
  operation: SelectionMode;
  /** Fixed marquee width:height ratio (0 = free). Shift squares, Alt draws from centre. */
  marqueeRatio?: number;
  maskMode: boolean;
  snapping: boolean;
  grid: boolean;
  /** R9: show rulers; drag from them to create guides. */
  rulers?: boolean;
  rulerUnit?: RulerUnit;
  before: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  renderVersion: number;
  onTransient: (d: ProDocument | null) => void;
  onCommit: (d: ProDocument, label: string, expected?: ProDocument) => void;
  onSelect: (id: string) => void;
  onColor: (c: string) => void;
  disabled: boolean;
  rendering: boolean;
  cloneSource: CloneSource | null;
  cloneSampleArmed: boolean;
  onColorSelect: (p: Point) => void;
  onCloneSample: (p: Point) => void;
  onCloneAdvance: (delta: Point) => void;
  onRepair: (request: RepairRequest) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    board = useRef<HTMLDivElement>(null),
    mini = useRef<HTMLCanvasElement>(null),
    selectionPreview = useRef<HTMLCanvasElement>(null),
    [size, setSize] = useState({ width: 600, height: 500 }),
    observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLDivElement | null) => {
    viewport.current = node;
    observer.current?.disconnect();
    if (node) {
      observer.current = new ResizeObserver(([e]) => {
        if (e) setSize({ width: e.contentRect.width, height: e.contentRect.height });
      });
      observer.current.observe(node);
    }
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [patchDestination, setPatchDestination] = useState<Region | null>(null);
  const [patchPreview, setPatchPreview] = useState<Region | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<Selection | null>(null);
  const visibleSelection = selectionDraft ?? selection;
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0, rotation: 0 }),
    gesture = useRef<Gesture | null>(null),
    pointers = useRef(new Map<number, Point>()),
    pinch = useRef<{ distance: number; view: View; center: Point } | null>(null),
    space = useRef(false),
    [polygon, setPolygon] = useState<Point[]>([]),
    [cursor, setCursor] = useState<Point | null>(null),
    pathId = useRef(""),
    [context, setContext] = useState(false);
  const transformActions = useRef({ onApplyTransform, onCancelTransform });
  transformActions.current = { onApplyTransform, onCancelTransform };
  const cropActions = useRef({ onCancelCrop, onApplyCrop });
  cropActions.current = { onCancelCrop, onApplyCrop };
  const shownCrop = cropDraft ?? doc.crop;
  const fit = viewFit(size, viewportFrame, view.rotation),
    selected = doc.layers.find((l) => l.id === activeId),
    dialogueBody = dialogueOverlays ? bubbleFor(doc, activeId) : undefined,
    transformTarget =
      selected && transformDraft?.frame ? { ...selected, ...transformDraft.frame } : selected;
  const changeRotation = useCallback(
    (angle: number | "left" | "right") => {
      if (gesture.current || pointers.current.size) return;
      setCursor(null);
      setSnapGuides([]);
      setView((v) =>
        rotateCanvasView(
          v,
          typeof angle === "number" ? angle : v.rotation + (angle === "left" ? -90 : 90),
          size,
          viewportFrame,
        ),
      );
    },
    [size, viewportFrame],
  );
  const focusFrame = useRef({ viewportFrame, fit, size, rotation: view.rotation });
  focusFrame.current = { viewportFrame, fit, size, rotation: view.rotation };
  useEffect(() => {
    if (!fitRequest) return;
    const { frame } = fitRequest,
      { viewportFrame: f, fit, size, rotation } = focusFrame.current;
    const zoom = Math.max(0.1, Math.min(12, viewFit(size, frame, rotation) / fit));
    const pan = rotatePoint(
      {
        x: f.x + f.width / 2 - frame.x - frame.width / 2,
        y: f.y + f.height / 2 - frame.y - frame.height / 2,
      },
      rotation,
    );
    setView({
      zoom,
      rotation,
      x: pan.x * fit * zoom,
      y: pan.y * fit * zoom,
    });
  }, [fitRequest]);
  const selectedPath = selected ? contourAt(selected, activeContour) : undefined;
  const splitSegment =
    selectedPath && selectedPath.anchors.length >= 2
      ? Math.min(activeAnchor, selectedPath.anchors.length - (selectedPath.closed ? 1 : 2))
      : -1;
  const splitPoint =
    selected && splitSegment >= 0 && !selected.pathData
      ? worldPoint(
          cubicPoint(
            anchorCurve(
              selectedPath!.anchors[splitSegment]!,
              selectedPath!.anchors[(splitSegment + 1) % selectedPath!.anchors.length]!,
            ),
            0.5,
          ),
          selected,
        )
      : null;
  useEffect(() => {
    // A gesture owns one immutable history revision. Undo, import or another
    // edit invalidates it; transient previews must never become the new base.
    if (gesture.current && gesture.current.origin !== documentBase) {
      gesture.current = null;
      pointers.current.clear();
      pinch.current = null;
      setSelectionDraft(null);
      setSnapGuides([]);
      setPatchPreview(null);
      onTransient(null);
    }
  }, [documentBase, onTransient]);
  useEffect(() => {
    pathId.current = "";
    setSnapGuides([]);
    gesture.current = null;
    onTransient(null);
    setPolygon([]);
    setPatchDestination(null);
    setPatchPreview(null);
  }, [tool, onTransient]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest('[role="menu"],[role="alertdialog"]')) return;
      const input = target?.closest('input,textarea,select,[contenteditable="true"]');
      if (
        !input &&
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        ["BracketLeft", "BracketRight", "Backslash"].includes(e.code)
      ) {
        e.preventDefault();
        changeRotation(e.code === "Backslash" ? 0 : e.code === "BracketLeft" ? "left" : "right");
        return;
      }
      if (tool === "transform" && e.key === "Escape") {
        e.preventDefault();
        transformActions.current.onCancelTransform();
      }
      if (tool === "transform" && e.key === "Enter") {
        e.preventDefault();
        transformActions.current.onApplyTransform();
      }
      if (tool === "crop" && e.key === "Escape") {
        e.preventDefault();
        cropActions.current.onCancelCrop();
      }
      if (tool === "crop" && e.key === "Enter") {
        e.preventDefault();
        cropActions.current.onApplyCrop();
      }
      // Preserve existing Enter/Escape Apply/Cancel from transform fields;
      // ordinary typing must not activate view rotation, panning or tools.
      if (input) return;
      if (e.code === "Space") {
        e.preventDefault();
        space.current = true;
      }
      if (e.key === "Enter" && tool === "artboard" && gesture.current?.preview) {
        onCommit(gesture.current.preview, "Edit artboard / guide", gesture.current.origin);
        gesture.current = null;
        onTransient(null);
        setSnapGuides([]);
      }
      if (e.key === "Escape") {
        setSnapGuides([]);
        setPatchDestination(null);
        setPatchPreview(null);
        setSelectionDraft(null);
        gesture.current = null;
        onTransient(null);
        setPolygon([]);
      }
      if (e.key === "Enter" && polygon.length >= 3) {
        onSelection(
          combineSelection(
            selection,
            { kind: "lasso", operation: "add", points: polygon },
            operation,
          ),
        );
        setPolygon([]);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    const blur = () => {
      space.current = false;
      setSnapGuides([]);
      setSelectionDraft(null);
      gesture.current = null;
      pointers.current.clear();
      pinch.current = null;
      onTransient(null);
    };
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [polygon, selection, operation, onSelection, onTransient, onCommit, tool, changeRotation]);
  // Every close path (Enter, double-click, Finish) combines through one function.
  const closePolygon = () => {
    if (polygon.length < 3) return;
    onSelection(
      combineSelection(selection, { kind: "lasso", operation: "add", points: polygon }, operation),
    );
    setPolygon([]);
  };
  useEffect(() => {
    if (!polygon.length) return;
    // Claim Backspace before the workspace's delete-layer shortcut (capture phase).
    const backspace = (e: KeyboardEvent) => {
      if (e.key !== "Backspace") return;
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPolygon((a) => a.slice(0, -1));
    };
    window.addEventListener("keydown", backspace, true);
    return () => window.removeEventListener("keydown", backspace, true);
  }, [polygon.length]);
  const docPoint = (p: Point): Point => {
    return canvasPoint(p, board.current!.getBoundingClientRect(), viewportFrame, view.rotation);
  };
  const zoomAt = (zoom: number, client?: Point) => {
    const r = viewport.current!.getBoundingClientRect(),
      p = client
        ? { x: client.x - r.left - r.width / 2, y: client.y - r.top - r.height / 2 }
        : { x: 0, y: 0 };
    setView((v) => {
      const next = Math.max(0.1, Math.min(12, zoom)),
        ratio = next / v.zoom;
      return { ...v, zoom: next, x: p.x - (p.x - v.x) * ratio, y: p.y - (p.y - v.y) * ratio };
    });
  };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.002);
      setView((v) => {
        const r = el.getBoundingClientRect(),
          x = e.clientX - r.left - r.width / 2,
          y = e.clientY - r.top - r.height / 2,
          z = Math.max(0.1, Math.min(12, v.zoom * factor)),
          q = z / v.zoom;
        return { ...v, zoom: z, x: x - (x - v.x) * q, y: y - (y - v.y) * q };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (mini.current && canvasRef.current) {
      const ctx = mini.current.getContext("2d")!;
      ctx.clearRect(0, 0, 160, 110);
      const s = Math.min(160 / viewportFrame.width, 110 / viewportFrame.height);
      ctx.drawImage(
        canvasRef.current,
        (160 - viewportFrame.width * s) / 2,
        (110 - viewportFrame.height * s) / 2,
        viewportFrame.width * s,
        viewportFrame.height * s,
      );
    }
  }, [canvasRef, renderVersion, doc.width, doc.height, viewportFrame]);
  useEffect(() => {
    const target = selectionPreview.current;
    if (!target) return;
    const scale = Math.min(1, 1400 / Math.max(doc.width, doc.height));
    const mask = selectionCanvas(visibleSelection, doc.width, doc.height, scale);
    target.width = mask.width;
    target.height = mask.height;
    const ctx = target.getContext("2d")!;
    let animation = 0;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(mask, 0, 0);
    if (selectionView === "mask") {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, target.width, target.height);
    } else if (selectionView === "ants") {
      const image = ctx.getImageData(0, 0, target.width, target.height),
        original = image.data.slice();
      for (let y = 0; y < target.height; y++)
        for (let x = 0; x < target.width; x++) {
          const i = (y * target.width + x) * 4,
            inside = original[i + 3]! >= 128;
          const edge =
            inside &&
            (x === 0 ||
              y === 0 ||
              x === target.width - 1 ||
              y === target.height - 1 ||
              [-1, 1, -target.width, target.width].some((d) => original[i + d * 4 + 3]! < 128));
          image.data[i] = image.data[i + 1] = image.data[i + 2] = (x + y) % 8 < 4 ? 255 : 0;
          image.data[i + 3] = edge ? 255 : 0;
        }
      const edges: number[] = [];
      for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3]) edges.push(i);
      let previous = 0,
        phase = 0;
      const animate = (time: number) => {
        if (time - previous >= 100) {
          previous = time;
          phase++;
          for (const i of edges) {
            const x = (i / 4) % target.width,
              y = Math.floor(i / 4 / target.width),
              value = (x + y + phase) % 8 < 4 ? 255 : 0;
            image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
          }
          ctx.putImageData(image, 0, 0);
        }
        animation = requestAnimationFrame(animate);
      };
      ctx.putImageData(image, 0, 0);
      animation = requestAnimationFrame(animate);
    } else {
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = "rgba(30, 140, 255, 0.35)";
      ctx.fillRect(0, 0, target.width, target.height);
    }
    ctx.globalCompositeOperation = "source-over";
    mask.width = mask.height = 1;
    return () => cancelAnimationFrame(animation);
  }, [visibleSelection, doc.width, doc.height, before, selectionView]);
  const hit = (p: Point) => {
    const ctx = canvasRef.current?.getContext("2d");
    const visible = visibleLayerIds(doc);
    return [...doc.layers].reverse().find((l) => {
      if (!visible.has(l.id) || l.locked || l.kind === "group" || l.kind === "adjustment")
        return false;
      let parent = l.parentId;
      while (parent) {
        const g = doc.layers.find((x) => x.id === parent);
        if (!g || !g.visible || g.locked) return false;
        parent = g.parentId;
      }
      const q = localPoint(p, l);
      if (
        ctx &&
        l.vectorClips?.some((c) => c.enabled && !ctx.isPointInPath(clipPath(c), q.x, q.y, c.rule))
      )
        return false;
      if (l.textPath) {
        const m = measureTextPath(l);
        for (let i = 1; i < m.points.length; i++) {
          const a = m.points[i - 1]!,
            b = m.points[i]!,
            dx = b.x - a.x,
            dy = b.y - a.y,
            t = Math.max(
              0,
              Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
            );
          if (
            Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy) <=
            l.fontSize + Math.abs(l.textPath.baseline)
          )
            return true;
        }
        return false;
      }
      if (l.kind === "shape" && ctx && l.appearance) {
        const path = new Path2D(shapePath(l));
        return l.appearance.some((a) => {
          if (!a.visible || !a.opacity || (!a.paint.gradient && a.paint.color === "transparent"))
            return false;
          if (a.kind === "fill") return ctx.isPointInPath(path, q.x, q.y, a.fillRule);
          ctx.save();
          ctx.lineWidth = a.width * (a.alignment === "center" ? 1 : 2);
          ctx.lineCap = a.cap;
          ctx.lineJoin = a.join;
          ctx.miterLimit = a.miterLimit;
          ctx.setLineDash(a.dash);
          ctx.lineDashOffset = a.dashOffset;
          const yes =
            a.width > 0 &&
            ctx.isPointInStroke(path, q.x, q.y) &&
            (a.alignment === "center" ||
              ctx.isPointInPath(path, q.x, q.y, a.fillRule) === (a.alignment === "inside"));
          ctx.restore();
          return yes;
        });
      }
      if (l.kind === "shape" && ctx) {
        const path = new Path2D(shapePath(l));
        ctx.save();
        ctx.lineWidth = Math.max(l.strokeWidth, 10 / (fit * view.zoom));
        ctx.lineCap = l.lineCap ?? "butt";
        ctx.lineJoin = l.lineJoin ?? "round";
        ctx.miterLimit = l.miterLimit ?? 10;
        ctx.setLineDash(l.dash ?? []);
        ctx.lineDashOffset = l.dashOffset ?? 0;
        const yes =
          (l.fill !== "transparent" &&
            (l.fillOpacity ?? 1) > 0 &&
            ctx.isPointInPath(path, q.x, q.y, l.fillRule ?? "nonzero")) ||
          (l.stroke !== "transparent" &&
            l.strokeWidth > 0 &&
            (l.strokeOpacity ?? 1) > 0 &&
            ctx.isPointInStroke(path, q.x, q.y));
        ctx.restore();
        return yes;
      }
      return q.x >= 0 && q.y >= 0 && q.x <= l.width && q.y <= l.height;
    });
  };
  const begin = (e: ReactPointer<HTMLDivElement>) => {
    if (disabled || before || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const screen = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, screen);
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        view,
        center: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
      };
      if (gesture.current?.crop) onCropDraft(gesture.current.crop);
      if (gesture.current?.transform) onTransformDraft(gesture.current.transform);
      gesture.current = null;
      setSnapGuides([]);
      setSelectionDraft(null);
      onTransient(null);
      return;
    }
    setSnapGuides([]);
    const p = docPoint(screen),
      base: Gesture = {
        type: tool,
        start: p,
        screen,
        doc,
        origin: documentBase,
        maskMode,
        view,
        selection,
      };
    // Legacy Direct Select never snapped. Enabling precision settings (or adding
    // an artboard) explicitly opts the document into anchor/grid acquisition.
    if (tool === "direct" && doc.layout) base.snap = buildSnapIndex(doc, [activeId]);
    setCursor(p);
    if (tool === "hand" || space.current) {
      gesture.current = { ...base, type: "pan" };
      return;
    }
    const tailHit = dialogueOverlays && (e.target as Element).closest("[data-dialogue-tail]");
    if (
      tailHit &&
      dialogueBody?.bubble &&
      !dialogueBody.transform.deform &&
      !isLocked(doc, dialogueBody.id)
    ) {
      gesture.current = {
        ...base,
        type: "bubble-tail",
        id: dialogueBody.id,
        part: tailHit.getAttribute("data-dialogue-tail")!,
      };
      return;
    }
    const guideHit = (e.target as Element).closest("[data-guide-id]");
    if (guideHit && (tool === "artboard" || tool === "move")) {
      const id = guideHit.getAttribute("data-guide-id")!,
        guide = layout(doc).guides.find((g) => g.id === id);
      if (guide && !guide.locked) gesture.current = { ...base, type: "guide", guideId: id };
      return;
    }
    if (tool === "artboard") {
      const target = (e.target as Element).closest("[data-artboard-id]"),
        id =
          target?.getAttribute("data-artboard-id") ??
          artboards(doc)
            .slice()
            .reverse()
            .find((b) => p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height)
            ?.id;
      const b = artboards(doc).find((b) => b.id === id);
      if (b) {
        onArtboard(b.id);
        gesture.current = {
          ...base,
          type: "artboard",
          board: b,
          corner: target?.hasAttribute("data-board-handle")
            ? frameHandleAt(b, p, fit * view.zoom)
            : "move",
          snap: buildSnapIndex(doc, [], b.id),
        };
      }
      return;
    }
    if (tool === "gradient" && selected && !isLocked(doc, selected.id)) {
      const index =
          selected.appearance?.findIndex((a) => a.id === appearanceId && a.paint.gradient) ?? -1,
        chosen =
          index >= 0 ? index : (selected.appearance?.findIndex((a) => a.paint.gradient) ?? -1);
      const g = selected.appearance?.[chosen]?.paint.gradient;
      if (!g) return;
      const handles = gradientHandles(g, selected),
        entries =
          g.kind === "linear"
            ? ([
                ["from", handles.from],
                ["to", handles.to],
              ] as const)
            : ([
                ["center", handles.center],
                ["radius", handles.to],
                ["from", handles.from],
              ] as const);
      const stopHandles = handles.stops.slice(1, -1).map((p, i) => [`stop:${i + 1}`, p] as const);
      const nearest = [...entries, ...stopHandles]
        .map(([part, q]) => ({ part, q: worldPoint(q, selected) }))
        .map((h) => ({ ...h, distance: Math.hypot(h.q.x - p.x, h.q.y - p.y) * fit * view.zoom }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest && nearest.distance <= 22)
        gesture.current = {
          ...base,
          type: "gradient",
          id: selected.id,
          part: nearest.part,
          appearanceIndex: chosen,
        };
      return;
    }
    if (tool === "transform" && transformDraft && selected) {
      const handles = transformHandles(transformDraft, transformTarget!, fit * view.zoom).handles,
        nearest = handles
          .map((h) => ({ ...h, distance: Math.hypot(p.x - h.p.x, p.y - h.p.y) * fit * view.zoom }))
          .sort((a, b) => a.distance - b.distance)[0],
        handle = nearest && nearest.distance <= 22 ? nearest.id : "move";
      gesture.current = {
        ...base,
        type: "free-transform",
        snap: buildSnapIndex(doc, transformDraft.ids ?? [selected.id]),
        transform: cloneTransformDraft(transformDraft),
        transformHandle: handle,
        id: selected.id,
      };
      return;
    }
    if (tool === "crop" && cropDraft) {
      const local = cropLocal(cropDraft, p),
        inside =
          local.x >= 0 && local.y >= 0 && local.x <= cropDraft.width && local.y <= cropDraft.height,
        core =
          inside &&
          local.x > cropDraft.width / 4 &&
          local.x < (cropDraft.width * 3) / 4 &&
          local.y > cropDraft.height / 4 &&
          local.y < (cropDraft.height * 3) / 4,
        nearest = CROP_HANDLES.map((h) => ({ h, p: cropHandlePoint(cropDraft, h) }))
          .map(({ h, p: q }) => ({
            h,
            distance: Math.hypot(q.x - p.x, q.y - p.y) * fit * view.zoom,
          }))
          .sort((a, b) => a.distance - b.distance)[0]!,
        handle: CropHandle = !core && nearest.distance <= 22 ? nearest.h : inside ? "move" : "draw";
      gesture.current = {
        ...base,
        type: "crop",
        crop: { ...cropDraft },
        cropHandle: handle,
      };
      return;
    }
    if (tool === "wand" || tool === "color-range" || tool === "fill") {
      onColorSelect(p);
      return;
    }
    if (tool === "eyedropper") {
      const c = canvasRef.current;
      if (c) {
        const rgba = c
          .getContext("2d")!
          .getImageData(
            Math.max(
              0,
              Math.min(
                c.width - 1,
                Math.floor(((p.x - viewportFrame.x) / viewportFrame.width) * c.width),
              ),
            ),
            Math.max(
              0,
              Math.min(
                c.height - 1,
                Math.floor(((p.y - viewportFrame.y) / viewportFrame.height) * c.height),
              ),
            ),
            1,
            1,
          ).data;
        onColor("#" + [...rgba.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join(""));
      }
      return;
    }
    if ((tool === "clone" || tool === "heal") && (e.altKey || cloneSampleArmed)) {
      onCloneSample(p);
      return;
    }
    if (tool === "patch") {
      if (!selected || selected.kind !== "paint" || isLocked(doc, selected.id)) {
        onError("Select an unlocked paint layer for Patch Repair.");
        return;
      }
      gesture.current = {
        ...base,
        type: patchDestination ? "patch-source" : "patch-destination",
        id: selected.id,
        region: patchDestination ?? { kind: "rectangle", operation: "add", points: [p, p] },
      };
      return;
    }
    if (tool === "spot" || tool === "heal") {
      if (!selected || selected.kind !== "paint" || isLocked(doc, selected.id) || maskMode) return;
      if (tool === "heal" && !cloneSource) {
        onError("Set a sample source before using Healing Brush.");
        return;
      }
      gesture.current = {
        ...base,
        type: "repair",
        repairKind: tool,
        id: selected.id,
        stroke: {
          ...brush,
          erase: false,
          points: [
            brushPoint(
              undefined,
              { ...localPoint(p, selected), ...(brush.dynamics ? { time: e.timeStamp } : {}) },
              e.pointerType,
              e.pressure,
              (brush.sizePressure || brush.dynamics?.opacityPressure) ?? false,
              0,
              0,
              pressureGamma,
            ),
          ],
          clip:
            selection.regions.length || selection.inverted
              ? toLocalSelection(selection, selected, { width: doc.width, height: doc.height })
              : undefined,
          ...(tool === "heal" && cloneSource
            ? {
                clone: {
                  assetId: cloneSource.assetId,
                  width: cloneSource.width,
                  height: cloneSource.height,
                  source: cloneSource.point,
                  destination: p,
                  mode: "heal" as const,
                },
              }
            : {}),
        },
      };
      return;
    }
    if (tool === "poly-lasso") {
      setPolygon((a) => [...a, p]);
      return;
    }
    if (tool.startsWith("select-") || tool === "lasso") {
      gesture.current = {
        ...base,
        type: "selection",
        region: {
          kind:
            tool === "select-rect" ? "rectangle" : tool === "select-ellipse" ? "ellipse" : "lasso",
          operation: "add",
          points: [p, p],
        },
      };
      return;
    }
    if (tool === "brush" || tool === "pencil" || tool === "eraser") {
      if (
        !selected ||
        isLocked(doc, selected.id) ||
        (selected.kind === "group" && !maskMode) ||
        (!maskMode && selected.kind !== "paint")
      )
        return;
      const clip =
        selection.regions.length || selection.inverted
          ? maskMode && selected.mask?.placement
            ? {
                ...selection,
                frame: {
                  width: doc.width,
                  height: doc.height,
                  transform: selected.transform.deform
                    ? structuredClone(selected.transform)
                    : { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
                  matrix: selected.transform.deform ? maskLocal(selected) : maskWorld(selected),
                },
              }
            : toLocalSelection(selection, selected, { width: doc.width, height: doc.height })
          : undefined;
      gesture.current = {
        ...base,
        type: "paint",
        id: selected.id,
        stroke: {
          ...brush,
          ...(brush.dynamics ? { seed: crypto.getRandomValues(new Uint32Array(1))[0]! || 1 } : {}),
          ...(tool === "pencil" ? { hardness: 1, tip: "square" as const } : {}),
          clip,
          erase: maskMode && selected.mask?.inverted ? tool !== "eraser" : tool === "eraser",
          points: [
            brushPoint(
              undefined,
              {
                ...(maskMode
                  ? maskPaintPoint(selected, localPoint(p, selected))
                  : localPoint(p, selected)),
                ...(brush.dynamics ? { time: e.timeStamp } : {}),
              },
              e.pointerType,
              e.pressure,
              (brush.sizePressure || brush.dynamics?.opacityPressure) ?? false,
              0,
              0,
              pressureGamma,
            ),
          ],
        },
      };
      return;
    }
    if (tool === "clone") {
      if (
        !cloneSource ||
        !selected ||
        isLocked(doc, selected.id) ||
        selected.kind !== "paint" ||
        maskMode
      )
        return;
      const clone = {
        assetId: cloneSource.assetId,
        width: cloneSource.width,
        height: cloneSource.height,
        source: cloneSource.point,
        destination: p,
        targetTransform: { ...selected.transform },
      };
      gesture.current = {
        ...base,
        type: "paint",
        id: selected.id,
        stroke: {
          ...brush,
          erase: false,
          clone: { ...clone, mode: "clone" },
          clip:
            selection.regions.length || selection.inverted
              ? toLocalSelection(selection, selected, { width: doc.width, height: doc.height })
              : undefined,
          points: [
            brushPoint(
              undefined,
              { ...localPoint(p, selected), ...(brush.dynamics ? { time: e.timeStamp } : {}) },
              e.pointerType,
              e.pressure,
              (brush.sizePressure || brush.dynamics?.opacityPressure) ?? false,
              0,
              0,
              pressureGamma,
            ),
          ],
        },
      };
      return;
    }
    const target = e.target as HTMLElement,
      anchor = target.closest("[data-anchor]"),
      corner = target.closest("[data-corner]");
    if (tool === "direct" && selected && !isLocked(doc, selected.id) && !selected.pathData) {
      // Use a screen-space touch target without drawing oversized, overlapping handles.
      const nearest = contours(selected)
        .flatMap((c, contour) =>
          c.anchors.flatMap((a, index) =>
            (["point", "incoming", "outgoing"] as const).flatMap((part) => {
              const q = part === "point" ? a : a[part];
              if (!q) return [];
              const world = worldPoint(q, selected);
              return [
                {
                  index,
                  part,
                  contour,
                  distance: Math.hypot(world.x - p.x, world.y - p.y) * fit * view.zoom,
                },
              ];
            }),
          ),
        )
        .sort((a, b) => a.distance - b.distance)[0];
      if (
        target.closest("[data-split-segment]") &&
        splitSegment >= 0 &&
        splitPoint &&
        (!nearest ||
          Math.hypot(splitPoint.x - p.x, splitPoint.y - p.y) * fit * view.zoom < nearest.distance)
      ) {
        try {
          onCommit(
            splitAnchorSegment(doc, selected.id, splitSegment, 0.5, activeContour),
            "Insert Bézier anchor",
          );
          onSelectAnchor(splitSegment + 1);
        } catch (error) {
          onError((error as Error).message);
        }
        return;
      }
      const index = anchor ? Number(anchor.getAttribute("data-anchor")) : nearest?.index,
        contour = anchor
          ? Number(anchor.getAttribute("data-contour") ?? activeContour)
          : (nearest?.contour ?? activeContour),
        part = anchor ? (anchor.getAttribute("data-part") ?? "point") : nearest?.part;
      if (
        index !== undefined &&
        (anchor || (nearest && nearest.distance <= (e.pointerType === "touch" ? 22 : 10)))
      ) {
        onSelectAnchor(index, contour);
        gesture.current = {
          ...base,
          type: "anchor",
          id: selected.id,
          index,
          contour,
          part,
        };
        return;
      }
    }
    if (tool === "pen") {
      let existing = doc.layers.find((l) => l.id === pathId.current && !l.closed && !l.locked);
      let next = doc;
      if (!existing) {
        existing = layer("shape", doc.width, doc.height);
        existing.name = "Bézier path";
        if (dialogueOverlays) existing.dialogueRole = "bubble";
        existing.shape = "path";
        existing.vectorOverflow = true;
        existing.fill = "transparent";
        existing.stroke = brush.color;
        next = { ...doc, layers: [...doc.layers, existing] };
        pathId.current = existing.id;
      }
      const a = localPoint(p, existing),
        id = existing.id;
      next = {
        ...next,
        layers: next.layers.map((l) => (l.id === id ? { ...l, anchors: [...l.anchors, a] } : l)),
      };
      onSelect(id);
      gesture.current = { ...base, doc: next, type: "pen", id, index: existing.anchors.length };
      onTransient(next);
      return;
    }
    if (["rectangle", "ellipse", "line", "polygon", "star", "text"].includes(tool)) {
      const object = layer(
        tool === "text" ? "text" : "shape",
        Math.max(1, Math.min(280, doc.width * 0.6)),
        Math.max(1, Math.min(140, doc.height * 0.3)),
      );
      if (dialogueOverlays) {
        object.dialogueRole = tool === "text" ? "text" : "bubble";
        if (tool === "text") object.lettering = { ...DEFAULT_LETTERING };
      }
      object.name = tool === "text" ? "Text" : tool[0]!.toUpperCase() + tool.slice(1);
      object.shape = tool as Layer["shape"];
      if (tool === "text") {
        object.shape = "rectangle";
        object.fill = brush.color;
        object.strokeWidth = 0;
      } else object.fill = tool === "line" ? "transparent" : brush.color;
      object.transform.x = p.x;
      object.transform.y = p.y;
      onSelect(object.id);
      const next = { ...doc, layers: [...doc.layers, object] };
      gesture.current = { ...base, type: "shape", id: object.id, doc: next };
      onTransient(next);
      return;
    }
    if (tool === "move" && maskMode && selected?.mask) {
      try {
        const frame = maskFrame(doc, selected.id);
        gesture.current = {
          ...base,
          type: "move",
          id: selected.id,
          ids: [selected.id],
          moveFrame: bounds(frame.transform, frame.width, frame.height),
        };
      } catch (e) {
        onError((e as Error).message);
      }
      return;
    }
    if (corner && selected && !isLocked(doc, selected.id)) {
      gesture.current = {
        ...base,
        type: "resize",
        snap: buildSnapIndex(doc, [selected.id]),
        id: selected.id,
        corner: corner.getAttribute("data-corner")!,
      };
      return;
    }
    let chosen = hit(p);
    if (chosen?.dialogueRole === "bubble" && chosen.parentId && !selectedIds.includes(chosen.id)) {
      const group = doc.layers.find((l) => l.id === chosen!.parentId && l.dialogueRole === "group");
      if (group) chosen = group;
    }
    if (chosen) {
      let selectedAncestor = chosen.parentId;
      while (selectedAncestor && !selectedIds.includes(selectedAncestor))
        selectedAncestor = doc.layers.find((l) => l.id === selectedAncestor)?.parentId;
      const ids = selectedIds.includes(chosen.id) || selectedAncestor ? selectedIds : [chosen.id];
      if (
        ids.some((id) => [...translationIds(doc, [id])].some((target) => isLocked(doc, target)))
      ) {
        onError("Unlock linked or selected layers before moving them.");
        return;
      }
      if (!selectedIds.includes(chosen.id) && !selectedAncestor) onSelect(chosen.id);
      gesture.current = {
        ...base,
        type: "move",
        id: chosen.id,
        ids,
        snap: buildSnapIndex(doc, ids),
        moveFrame: selectionBounds(doc, ids),
      };
    } else onSelect("");
  };
  const update = (
    screen: Point,
    input?: {
      pointerType: string;
      pressure: number;
      time?: number;
      shiftKey?: boolean;
      altKey?: boolean;
      /** Pointer release: end the stroke exactly at this position. */
      final?: boolean;
    },
  ): ProDocument | null => {
    const g = gesture.current;
    if (!g || g.origin !== documentBase) return null;
    const maskMode = g.maskMode;
    const p = docPoint(screen);
    if (g.type === "bubble-tail" && g.id && g.part) {
      const body = g.doc.layers.find((l) => l.id === g.id)!;
      try {
        return updateBubble(
          g.doc,
          g.id,
          {},
          {
            tails: body.bubble!.tails.map((t) =>
              t.id === g.part ? { ...t, tip: localPoint(p, body) } : t,
            ),
          },
        );
      } catch (e) {
        onError((e as Error).message);
        return null;
      }
    }
    if (g.type === "pan") {
      setView({
        ...g.view,
        x: g.view.x + screen.x - g.screen.x,
        y: g.view.y + screen.y - g.screen.y,
      });
      return null;
    }
    const acquire = (frame: Frame, pointOnly = false, axes: ("x" | "y")[] = ["x", "y"]) => {
      if (!snapping || input?.altKey || !g.snap) {
        setSnapGuides([]);
        return { x: 0, y: 0 };
      }
      const result = snapGeometry(g.doc, g.snap, frame, fit * view.zoom, pointOnly, axes);
      setSnapGuides(result.guides);
      return result.delta;
    };
    if (g.type === "guide" && g.guideId) {
      const s = layout(g.doc),
        old = s.guides.find((n) => n.id === g.guideId)!;
      return {
        ...g.doc,
        layout: {
          ...s,
          guides: s.guides.map((n) =>
            n.id === old.id
              ? { ...n, position: old.position + p[old.axis] - g.start[old.axis] }
              : n,
          ),
        },
      };
    }
    if (g.type === "artboard" && g.board) {
      try {
        const b = g.board;
        let next = dragCrop({ ...b, rotation: 0 }, g.corner as CropHandle, g.start, p);
        const axes: ("x" | "y")[] =
          g.corner === "move"
            ? ["x", "y"]
            : [
                ...(g.corner?.includes("w") || g.corner?.includes("e") ? ["x" as const] : []),
                ...(g.corner?.includes("n") || g.corner?.includes("s") ? ["y" as const] : []),
              ];
        if (g.corner === "move") {
          const delta = acquire(next);
          next = { ...next, x: next.x + delta.x, y: next.y + delta.y };
        } else {
          const endpoint = cropHandlePoint(next, g.corner!),
            delta = acquire({ ...endpoint, width: 0, height: 0 }, true, axes);
          next = dragCrop({ ...b, rotation: 0 }, g.corner as CropHandle, g.start, {
            x: p.x + delta.x,
            y: p.y + delta.y,
          });
        }
        return changeArtboard(
          g.doc,
          b.id,
          { x: next.x, y: next.y, width: next.width, height: next.height },
          moveArtwork,
        );
      } catch (e) {
        onError((e as Error).message);
        return null;
      }
    }
    if (g.type === "free-transform" && g.transform && g.id) {
      const l = g.transform.frame ?? g.doc.layers.find((l) => l.id === g.id)!;
      let point = p;
      if (g.transformHandle === "move" && input?.shiftKey) {
        point =
          Math.abs(p.x - g.start.x) > Math.abs(p.y - g.start.y)
            ? { x: p.x, y: g.start.y }
            : { x: g.start.x, y: p.y };
      }
      if (
        snapping &&
        !input?.altKey &&
        g.snap &&
        /^[nsew]{1,2}$/.test(g.transformHandle ?? "") &&
        g.transform.mode === "affine"
      ) {
        const positionAt = (p: Point) => {
          const value = dragTransform(
            g.transform!.value,
            l.width,
            l.height,
            g.transformHandle!,
            g.start,
            p,
            input?.shiftKey ? !g.transform!.lock : g.transform!.lock,
            input?.altKey,
            input?.shiftKey,
          );
          return transformHandles({ value, mode: "affine" }, l, fit * view.zoom).handles.find(
            (h) => h.id === g.transformHandle,
          )!.p;
        };
        try {
          const snapped = snapHandle(g.doc, g.snap, point, fit * view.zoom, positionAt);
          point = snapped.pointer;
          setSnapGuides(snapped.guides);
        } catch (e) {
          onError((e as Error).message);
          return null;
        }
      }
      try {
        let value = dragTransform(
          g.transform.value,
          l.width,
          l.height,
          g.transformHandle!,
          g.start,
          point,
          input?.shiftKey ? !g.transform.lock : g.transform.lock,
          input?.altKey,
          input?.shiftKey,
        );
        if (g.transformHandle === "move") {
          const delta = acquire(bounds(value, l.width, l.height));
          value = { ...value, x: value.x + delta.x, y: value.y + delta.y };
        }
        onTransformDraft({
          ...g.transform,
          value,
          translation:
            g.transformHandle === "move"
              ? {
                  x: g.transform.translation.x + value.x - g.transform.value.x,
                  y: g.transform.translation.y + value.y - g.transform.value.y,
                }
              : g.transform.translation,
        });
      } catch (error) {
        onError((error as Error).message);
      }
      return null;
    }
    if (g.type === "crop" && g.crop) {
      onCropDraft(dragCrop(g.crop, g.cropHandle!, g.start, p, cropRatio));
      return null;
    }
    if (g.type === "patch-destination") {
      g.region = { ...g.region!, points: [g.start, p] };
      setPatchPreview(g.region);
      return null;
    }
    if (g.type === "patch-source") return null;
    if (g.type === "selection") {
      const r = g.region!;
      if (r.kind === "lasso") {
        // Spacing is screen-relative (2 CSS px at the current zoom); the point budget is fixed.
        const recorded = appendLassoPoint(r.points, p, 2 / (fit * view.zoom));
        g.region = { ...r, points: recorded.points };
        if (recorded.full && !g.full) {
          g.full = true;
          // A status (not an error) so the notice survives the commit on release.
          (onStatus ?? onError)(
            "This lasso reached its point limit; release to apply the outline drawn so far.",
          );
        }
      } else
        g.region = {
          ...r,
          points: marqueeCorners(g.start, p, {
            ratio: marqueeRatio,
            square: input?.shiftKey,
            center: input?.altKey,
          }),
        };
      setSelectionDraft(combineSelection(g.selection, g.region, operation));
      return null;
    }
    const l = g.doc.layers.find((x) => x.id === g.id);
    if (!l) return null;
    let next = l;
    if (g.type === "gradient") {
      const a = l.appearance![g.appearanceIndex!]!,
        gradient = a.paint.gradient!,
        handles = gradientHandles(gradient, l),
        start = g.part?.startsWith("stop:")
          ? handles.stops[Number(g.part.slice(5))]!
          : g.part === "radius"
            ? handles.to
            : g.part === "center"
              ? handles.center
              : g.part === "from"
                ? handles.from
                : handles.to;
      const world = worldPoint(start, l),
        target = localPoint({ x: world.x + p.x - g.start.x, y: world.y + p.y - g.start.y }, l);
      const candidate = {
        ...g.doc,
        layers: g.doc.layers.map((n) =>
          n.id === l.id
            ? {
                ...l,
                appearance: l.appearance!.map((a, i) =>
                  i === g.appearanceIndex
                    ? {
                        ...a,
                        paint: {
                          ...a.paint,
                          gradient: moveGradientHandle(gradient, l, g.part!, target),
                        },
                      }
                    : a,
                ),
              }
            : n,
        ),
      };
      try {
        validateDocument(candidate);
        return candidate;
      } catch (e) {
        onError((e as Error).message);
        return null;
      }
    }
    if (g.type === "move") {
      let x = l.transform.x + p.x - g.start.x,
        y = l.transform.y + p.y - g.start.y;
      const b = g.moveFrame!,
        delta = acquire({ ...b, x: b.x + p.x - g.start.x, y: b.y + p.y - g.start.y });
      x += delta.x;
      y += delta.y;
      try {
        return nudgeDocument(
          g.doc,
          g.ids ?? [l.id],
          {
            x: x - l.transform.x,
            y: y - l.transform.y,
          },
          g.maskMode,
        );
      } catch (e) {
        onError((e as Error).message);
        return null;
      }
    }
    if (g.type === "shape") {
      const w = Math.abs(p.x - g.start.x),
        h = Math.abs(p.y - g.start.y);
      if (Math.hypot(w, h) > 3)
        next = {
          ...l,
          width: Math.max(1, w),
          height: Math.max(1, h),
          transform: { ...l.transform, x: Math.min(p.x, g.start.x), y: Math.min(p.y, g.start.y) },
        };
    }
    if (g.type === "resize") {
      try {
        let point = p;
        if (snapping && !input?.altKey && g.snap) {
          const positionAt = (p: Point) =>
            worldPoint(
              { x: l.width, y: l.height },
              { transform: dragTransform(l.transform, l.width, l.height, "se", g.start, p) },
            );
          const snapped = snapHandle(g.doc, g.snap, p, fit * view.zoom, positionAt);
          point = snapped.pointer;
          setSnapGuides(snapped.guides);
        }
        next = {
          ...l,
          transform: dragTransform(l.transform, l.width, l.height, "se", g.start, point),
        };
      } catch (error) {
        onError((error as Error).message);
        return null;
      }
    }
    if (g.type === "pen" || g.type === "anchor") {
      const subpath = contourAt(l, g.contour ?? 0),
        anchors = [...subpath.anchors],
        old = anchors[g.index!]!;
      let target = p;
      if (g.type === "anchor") {
        const source = g.part === "incoming" || g.part === "outgoing" ? (old[g.part] ?? old) : old,
          world = worldPoint(source, l);
        target = { x: world.x + p.x - g.start.x, y: world.y + p.y - g.start.y };
      }
      const delta =
        g.type === "anchor" && !["incoming", "outgoing"].includes(g.part ?? "")
          ? acquire({ ...target, width: 0, height: 0 }, true)
          : { x: 0, y: 0 };
      const a = localPoint({ x: target.x + delta.x, y: target.y + delta.y }, l);
      if (g.type === "pen") {
        const dx = a.x - old.x,
          dy = a.y - old.y;
        anchors[g.index!] = {
          ...old,
          mode: "symmetric",
          outgoing: a,
          incoming: { x: old.x - dx, y: old.y - dy },
        };
      } else if (g.part === "incoming" || g.part === "outgoing")
        anchors[g.index!] = editedAnchor(old, {
          kind: "handle",
          part: g.part,
          point: a,
          independent: input?.altKey,
        });
      else {
        anchors[g.index!] = editedAnchor(old, { kind: "move", point: a });
      }
      next = withContour(l, g.contour ?? 0, { anchors, closed: subpath.closed });
    }
    if (g.type === "paint" || g.type === "repair") {
      const s = g.stroke!,
        q = maskMode && g.type === "paint" ? maskPaintPoint(l, localPoint(p, l)) : localPoint(p, l),
        raw = { ...q, ...(s.dynamics ? { time: input?.time ?? performance.now() } : {}) };
      if (input?.final) finishBrushStroke(s, g.filtered, raw, g.length);
      else if (!g.full) {
        const recorded = appendBrushSample(
          s,
          g.filtered,
          raw,
          {
            pointerType: input?.pointerType ?? "mouse",
            pressure: input?.pressure ?? 1,
            pressureGamma,
          },
          g.length ?? 0,
        );
        g.filtered = recorded.filtered;
        g.length = recorded.length;
        if (recorded.full) {
          g.full = true;
          (onStatus ?? onError)(
            "This stroke reached the maximum stroke length and ends here. Lift and start a new stroke to continue.",
          );
        }
      }
      if (g.type === "repair") return null;
      next = maskMode
        ? {
            ...l,
            mask: {
              ...l.mask,
              selection: l.mask?.selection ?? { regions: [], inverted: true, feather: 0 },
              enabled: true,
              strokes: [...(l.mask?.strokes ?? []), { ...s, points: [...s.points] }],
            },
          }
        : { ...l, strokes: [...l.strokes, { ...s, points: [...s.points] }] };
    }
    return { ...g.doc, layers: g.doc.layers.map((x) => (x.id === l.id ? next : x)) };
  };
  const move = (e: ReactPointer<HTMLDivElement>) => {
    const screen = { x: e.clientX, y: e.clientY };
    setCursor(docPoint(screen));
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, screen);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()],
        g = pinch.current,
        d = Math.hypot(a!.x - b!.x, a!.y - b!.y),
        center = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
        r = viewport.current!.getBoundingClientRect(),
        initial = { x: g.center.x - r.left - r.width / 2, y: g.center.y - r.top - r.height / 2 },
        now = { x: center.x - r.left - r.width / 2, y: center.y - r.top - r.height / 2 },
        z = Math.max(0.1, Math.min(12, (g.view.zoom * d) / g.distance)),
        q = z / g.view.zoom;
      setView({
        ...g.view,
        zoom: z,
        x: now.x - (initial.x - g.view.x) * q,
        y: now.y - (initial.y - g.view.y) * q,
      });
      return;
    }
    const samples =
      gesture.current?.type === "paint" || gesture.current?.type === "repair"
        ? (e.nativeEvent.getCoalescedEvents?.() ?? [])
        : [];
    let next: ProDocument | null = null;
    for (const sample of samples.length ? samples : [e])
      next = update(
        { x: sample.clientX, y: sample.clientY },
        {
          pointerType: sample.pointerType,
          pressure: sample.pressure,
          time: sample.timeStamp,
          shiftKey: sample.shiftKey,
          altKey: sample.altKey,
        },
      );
    if (next) {
      if (gesture.current) gesture.current.preview = next;
      onTransient(next);
    }
  };
  const viewportRect = (e: { clientX: number; clientY: number }) => {
    const r = viewport.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
  };
  const addGuide = (axis: "x" | "y", position: number) => {
    const s = layout(doc);
    if (s.guides.length >= 128) {
      onError("A document supports at most 128 guides.");
      return;
    }
    onCommit(
      {
        ...doc,
        layout: {
          ...s,
          guidesVisible: true,
          guides: [...s.guides, { id: crypto.randomUUID(), axis, position, locked: false }],
        },
      },
      axis === "x" ? "Add vertical guide" : "Add horizontal guide",
      documentBase,
    );
  };
  const end = (e: ReactPointer<HTMLDivElement>, cancel = false) => {
    pointers.current.delete(e.pointerId);
    setSnapGuides([]);
    if (pinch.current) {
      if (!pointers.current.size) pinch.current = null;
      return;
    }
    const g = gesture.current;
    if (!g) return;
    if (cancel && g.transform) onTransformDraft(g.transform);
    if (cancel && g.crop) onCropDraft(g.crop);
    if (!cancel && g.origin === documentBase) {
      const next = update(
        { x: e.clientX, y: e.clientY },
        {
          pointerType: e.pointerType,
          time: e.timeStamp,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          final: g.type === "paint" || g.type === "repair",
          pressure:
            e.pointerType === "pen"
              ? (g.stroke?.points.at(-1)?.pressure ?? e.pressure)
              : e.pressure,
        },
      );
      if (g.type === "repair" && g.stroke && g.id)
        onRepair({ kind: g.repairKind!, layerId: g.id, stroke: g.stroke });
      if (g.type === "patch-destination" && g.region) {
        const [a, b] = g.region.points;
        if (Math.abs(a!.x - b!.x) >= 2 && Math.abs(a!.y - b!.y) >= 2) setPatchDestination(g.region);
        else onError("Draw a destination at least two pixels wide and high.");
        setPatchPreview(null);
      }
      if (g.type === "patch-source" && g.region && g.id) {
        const target = g.doc.layers.find((l) => l.id === g.id)!,
          a = g.region.points[0]!,
          b = g.region.points[1]!,
          corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }],
          feather =
            (1 - brush.hardness) * Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 0.25;
        onRepair({
          kind: "patch",
          layerId: g.id,
          source: docPoint({ x: e.clientX, y: e.clientY }),
          stroke: {
            ...brush,
            erase: false,
            points: corners.map((p) => localPoint(p, target)),
            patch: toLocalSelection(patchSelection(a, b, Math.min(100, feather)), target, {
              width: doc.width,
              height: doc.height,
            }),
            clip:
              selection.regions.length || selection.inverted
                ? toLocalSelection(selection, target, { width: doc.width, height: doc.height })
                : undefined,
            clone: {
              assetId: "pending-repair",
              width: 1,
              height: 1,
              source: { x: 0, y: 0 },
              destination: a,
              mode: "clone",
            },
          },
        });
        setPatchDestination(null);
      }
      const ruler = rulers && g.type === "guide" && g.guideId && viewportRect(e);
      if (ruler && next) {
        // Dropping a guide back onto a ruler deletes it (Photoshop behaviour).
        const s = layout(next),
          guide = s.guides.find((n) => n.id === g.guideId);
        if (guide && (guide.axis === "y" ? ruler.y : ruler.x) <= RULER_SIZE) {
          onCommit(
            { ...next, layout: { ...s, guides: s.guides.filter((n) => n.id !== guide.id) } },
            "Delete guide",
            g.origin,
          );
          setSelectionDraft(null);
          gesture.current = null;
          onTransient(null);
          return;
        }
      }
      if (next)
        onCommit(
          next,
          g.type === "paint"
            ? g.maskMode
              ? "Paint mask"
              : g.stroke?.clone
                ? g.stroke.clone.mode === "heal"
                  ? "Healing Brush"
                  : "Clone Stamp"
                : g.stroke?.tip === "square"
                  ? "Pencil stroke"
                  : "Brush stroke"
            : g.type === "pen"
              ? "Add Bézier anchor"
              : `Edit ${g.type}`,
          g.origin,
        );
      if (g.type === "paint" && g.stroke?.clone && cloneSource?.aligned) {
        const layer = g.doc.layers.find((l) => l.id === g.id);
        if (layer) {
          const first = worldPoint(g.stroke.points[0]!, layer),
            last = worldPoint(g.stroke.points.at(-1)!, layer);
          onCloneAdvance({ x: last.x - first.x, y: last.y - first.y });
        }
      }
      if (g.type === "selection" && g.region)
        onSelection(combineSelection(g.selection, g.region, operation), g.origin);
    }
    setSelectionDraft(null);
    setSnapGuides([]);
    setPatchPreview(null);
    gesture.current = null;
    onTransient(null);
  };
  const poly = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <section className="pro-canvas-area" aria-label="Pro canvas workspace">
      <div className="pro-viewport-bar">
        <div className="pro-view-controls">
          <div className="pro-zoom-controls">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Pro zoom out"
              onClick={() => zoomAt(view.zoom / 1.25)}
            >
              <ZoomOut />
            </Button>
            <output aria-label="Pro zoom">{Math.round(view.zoom * 100)}%</output>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Pro zoom in"
              onClick={() => zoomAt(view.zoom * 1.25)}
            >
              <ZoomIn />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Fit Pro canvas"
              onClick={() => {
                onFitCanvas();
                setView((v) => ({ ...v, zoom: 1, x: 0, y: 0 }));
              }}
            >
              <Scan />
            </Button>
          </div>
          <div className="pro-view-rotation" role="group" aria-label="Canvas view rotation">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Rotate canvas view left"
              title="Rotate canvas view left 90° (Alt+[). Artwork unchanged."
              onClick={() => changeRotation("left")}
            >
              <RotateCcw />
            </Button>
            <output aria-label="Canvas view angle">{view.rotation}°</output>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Rotate canvas view right"
              title="Rotate canvas view right 90° (Alt+]). Artwork unchanged."
              onClick={() => changeRotation("right")}
            >
              <RotateCw />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Reset canvas view rotation"
              title="Reset canvas view rotation (Alt + backslash). Export orientation is unchanged."
              onClick={() => changeRotation(0)}
            >
              <RefreshCw />
            </Button>
          </div>
        </div>
        <span role="status">
          {tool === "patch"
            ? patchDestination
              ? "Tap the source region center · Esc cancels"
              : "Draw the destination rectangle"
            : rendering
              ? "Rendering preview…"
              : `${doc.width} × ${doc.height} canvas · ${outputSize(doc).width} × ${outputSize(doc).height} output`}
        </span>
      </div>
      <div
        ref={measure}
        className={`pro-viewport ${tool === "hand" ? "pro-hand" : ""}`}
        aria-label="Pro editing viewport"
        tabIndex={0}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={(e) => end(e)}
        onPointerCancel={(e) => end(e, true)}
        onPointerLeave={() => setCursor(null)}
        onLostPointerCapture={(e) => {
          if (gesture.current) end(e, true);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContext(true);
        }}
        onDoubleClick={closePolygon}
      >
        <div
          ref={board}
          className="pro-artboard"
          data-grid={grid}
          data-view-rotation={view.rotation}
          style={
            {
              "--pro-grid-size": `${layout(doc).spacing * fit}px`,
              "--pro-grid-x": `${-viewportFrame.x * fit}px`,
              "--pro-grid-y": `${-viewportFrame.y * fit}px`,
              backgroundPosition: `${-viewportFrame.x * fit}px ${-viewportFrame.y * fit}px`,
              width: viewportFrame.width * fit,
              height: viewportFrame.height * fit,
              transform: `translate(-50%,-50%) translate(${view.x}px,${view.y}px) rotate(${view.rotation}deg) scale(${view.zoom})`,
            } as React.CSSProperties
          }
        >
          <canvas
            ref={canvasRef}
            aria-label="Pro composite preview"
            aria-busy={rendering || disabled}
          />
          {!before && (
            <canvas
              ref={selectionPreview}
              className="pro-selection-preview"
              style={{
                left: `${(-viewportFrame.x / viewportFrame.width) * 100}%`,
                top: `${(-viewportFrame.y / viewportFrame.height) * 100}%`,
                width: `${(doc.width / viewportFrame.width) * 100}%`,
                height: `${(doc.height / viewportFrame.height) * 100}%`,
              }}
              aria-label="Selected coverage preview"
            />
          )}
          {!before && (
            <svg
              className="pro-overlays"
              preserveAspectRatio="none"
              viewBox={`${viewportFrame.x} ${viewportFrame.y} ${viewportFrame.width} ${viewportFrame.height}`}
              aria-label="Pro selection overlays"
            >
              {dialogueBody?.bubble &&
                !dialogueBody.transform.deform &&
                tool === "move" &&
                !isLocked(doc, dialogueBody.id) &&
                dialogueBody.bubble.tails.map((tail, i) => {
                  const p = worldPoint(tail.tip, dialogueBody),
                    unit = 1 / (fit * view.zoom);
                  return (
                    <g key={tail.id}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={22 * unit}
                        fill="transparent"
                        data-dialogue-tail={tail.id}
                      />
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={5 * unit}
                        fill="#a4efd6"
                        stroke="#12221e"
                        strokeWidth={unit}
                        pointerEvents="none"
                      />
                      <circle
                        tabIndex={0}
                        role="slider"
                        aria-label={`Tail ${i + 1} tip handle`}
                        aria-valuetext={`${Math.round(tail.tip.x)}, ${Math.round(tail.tip.y)}`}
                        aria-valuemin={-100000}
                        aria-valuemax={100000}
                        aria-valuenow={tail.tip.x}
                        data-dialogue-tail={tail.id}
                        cx={p.x}
                        cy={p.y}
                        r={12 * unit}
                        fill="transparent"
                        onKeyDown={(e) => {
                          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
                            return;
                          e.preventDefault();
                          e.stopPropagation();
                          const n = e.shiftKey ? 10 : 1;
                          try {
                            onCommit(
                              updateBubble(
                                doc,
                                dialogueBody.id,
                                {},
                                {
                                  tails: dialogueBody.bubble!.tails.map((t) =>
                                    t.id === tail.id
                                      ? {
                                          ...t,
                                          tip: {
                                            x:
                                              t.tip.x +
                                              (e.key === "ArrowRight"
                                                ? n
                                                : e.key === "ArrowLeft"
                                                  ? -n
                                                  : 0),
                                            y:
                                              t.tip.y +
                                              (e.key === "ArrowDown"
                                                ? n
                                                : e.key === "ArrowUp"
                                                  ? -n
                                                  : 0),
                                          },
                                        }
                                      : t,
                                  ),
                                },
                              ),
                              "Move bubble tail",
                            );
                          } catch (error) {
                            onError((error as Error).message);
                          }
                        }}
                      />
                    </g>
                  );
                })}
              {dialogueOverlays &&
                doc.dialogue?.regions.map((r, i) => (
                  <g key={r.id} className="dialogue-region-overlay" pointerEvents="none">
                    <rect
                      x={r.x}
                      y={r.y}
                      width={r.width}
                      height={r.height}
                      fill="none"
                      stroke={r.status === "approved" ? "#a4efd6" : "#f7c773"}
                      strokeWidth={1 / (fit * view.zoom)}
                      strokeDasharray={`${5 / (fit * view.zoom)} ${3 / (fit * view.zoom)}`}
                    />
                    <text
                      x={r.x}
                      y={r.y - 4 / (fit * view.zoom)}
                      fontSize={12 / (fit * view.zoom)}
                      fill="#f7c773"
                    >
                      {i + 1} · {r.status}
                    </text>
                  </g>
                ))}
              {layout(doc).boundaries &&
                artboards(doc).map((b) => {
                  const selected = b.id === artboardId,
                    unit = 1 / (fit * view.zoom);
                  return (
                    <g key={b.id} className={`pro-board-boundary ${selected ? "is-active" : ""}`}>
                      <rect
                        x={b.x}
                        y={b.y}
                        width={b.width}
                        height={b.height}
                        data-artboard-id={b.id}
                        className={tool === "artboard" ? "pro-board-hit" : ""}
                      />
                      <text
                        x={b.x}
                        y={b.y - 8 * unit}
                        fontSize={12 * unit}
                        data-artboard-id={b.id}
                        className={tool === "artboard" ? "pro-board-label" : ""}
                      >
                        {b.name}
                      </text>
                      {selected &&
                        tool === "artboard" &&
                        CROP_HANDLES.map((h) => {
                          const p = cropHandlePoint({ ...b, rotation: 0 }, h);
                          return (
                            <g
                              key={h}
                              data-artboard-id={b.id}
                              data-board-handle={h}
                              className="pro-board-handle"
                            >
                              <rect
                                x={p.x - 22 * unit}
                                y={p.y - 22 * unit}
                                width={44 * unit}
                                height={44 * unit}
                                fill="transparent"
                                stroke="none"
                              />
                              <rect
                                x={p.x - 4 * unit}
                                y={p.y - 4 * unit}
                                width={8 * unit}
                                height={8 * unit}
                              />
                            </g>
                          );
                        })}
                    </g>
                  );
                })}
              {layout(doc).guidesVisible &&
                layout(doc).guides.map((g) => (
                  <g key={g.id} className="pro-document-guide">
                    <line
                      x1={g.axis === "x" ? g.position : viewportFrame.x}
                      y1={g.axis === "y" ? g.position : viewportFrame.y}
                      x2={g.axis === "x" ? g.position : viewportFrame.x + viewportFrame.width}
                      y2={g.axis === "y" ? g.position : viewportFrame.y + viewportFrame.height}
                    />
                    {(tool === "artboard" || tool === "move") && !g.locked && (
                      <line
                        data-guide-id={g.id}
                        className="pro-guide-hit"
                        x1={g.axis === "x" ? g.position : viewportFrame.x}
                        y1={g.axis === "y" ? g.position : viewportFrame.y}
                        x2={g.axis === "x" ? g.position : viewportFrame.x + viewportFrame.width}
                        y2={g.axis === "y" ? g.position : viewportFrame.y + viewportFrame.height}
                        strokeWidth={22 / (fit * view.zoom)}
                      />
                    )}
                  </g>
                ))}
              {snapGuides.length > 0 && (
                <g className="pro-smart-guides" aria-label="Acquired smart guides">
                  {snapGuides.map((g, i) => (
                    <line
                      key={i}
                      data-snap-kind={g.kind}
                      x1={g.axis === "x" ? g.position : viewportFrame.x}
                      y1={g.axis === "y" ? g.position : viewportFrame.y}
                      x2={g.axis === "x" ? g.position : viewportFrame.x + viewportFrame.width}
                      y2={g.axis === "y" ? g.position : viewportFrame.y + viewportFrame.height}
                    />
                  ))}
                </g>
              )}

              {tool === "gradient" &&
                selected &&
                (() => {
                  const a =
                      selected.appearance?.find((a) => a.id === appearanceId && a.paint.gradient) ??
                      selected.appearance?.find((a) => a.paint.gradient),
                    gradient = a?.paint.gradient;
                  if (!gradient) return null;
                  const h = gradientHandles(gradient, selected),
                    points =
                      gradient.kind === "linear"
                        ? ([
                            ["from", h.from],
                            ["to", h.to],
                          ] as const)
                        : ([
                            ["center", h.center],
                            ["radius", h.to],
                            ["from", h.from],
                          ] as const);
                  const world = [
                    ...points,
                    ...h.stops.slice(1, -1).map((p, i) => [`stop:${i + 1}`, p] as const),
                  ].map(([name, p]) => ({ name, p: worldPoint(p, selected) }));
                  return (
                    <g className="pro-vector-gradient-handles" aria-label="Vector gradient handles">
                      <line
                        x1={world[0]!.p.x}
                        y1={world[0]!.p.y}
                        x2={world[1]!.p.x}
                        y2={world[1]!.p.y}
                      />
                      {world
                        .filter(
                          (h) =>
                            h.name !== "from" ||
                            gradient.kind === "linear" ||
                            Math.hypot(h.p.x - world[0]!.p.x, h.p.y - world[0]!.p.y) *
                              fit *
                              view.zoom >
                              14,
                        )
                        .map((h, i) => (
                          <g key={h.name}>
                            <circle
                              cx={h.p.x}
                              cy={h.p.y}
                              r={22 / (fit * view.zoom)}
                              className="pro-gradient-hit"
                            />
                            <circle cx={h.p.x} cy={h.p.y} r={5 / (fit * view.zoom)} />
                            <text
                              x={h.p.x + 8 / (fit * view.zoom)}
                              y={h.p.y + (i % 2 ? 16 : -8) / (fit * view.zoom)}
                              fontSize={11 / (fit * view.zoom)}
                            >
                              {h.name.startsWith("stop:") ? `stop ${h.name.slice(5)}` : h.name}
                            </text>
                          </g>
                        ))}
                    </g>
                  );
                })()}
              {cursor && ["brush", "pencil", "eraser", "clone", "heal", "spot"].includes(tool)
                ? (() => {
                    const c = brushCursor(selected, maskMode, cursor, brush, tool);
                    if (!c)
                      return (
                        <circle
                          cx={cursor.x}
                          cy={cursor.y}
                          r={Math.max(0.5, brush.size / 2)}
                          className="pro-brush-cursor"
                        />
                      );
                    return (
                      <g
                        transform={`matrix(${c.matrix.join(" ")})`}
                        data-brush-cursor={c.square ? "square" : "round"}
                      >
                        <g transform={`translate(${c.center.x} ${c.center.y}) rotate(${c.angle})`}>
                          {c.square ? (
                            <rect
                              x={-c.rx}
                              y={-c.ry}
                              width={c.rx * 2}
                              height={c.ry * 2}
                              className="pro-brush-cursor"
                            />
                          ) : (
                            <ellipse rx={c.rx} ry={c.ry} className="pro-brush-cursor" />
                          )}
                          {c.hardness !== undefined && (
                            <ellipse
                              rx={c.rx * c.hardness}
                              ry={c.ry * c.hardness}
                              className="pro-brush-cursor pro-brush-cursor-core"
                            />
                          )}
                        </g>
                      </g>
                    );
                  })()
                : null}
              {tool === "patch" &&
                (patchPreview ?? patchDestination) &&
                (() => {
                  const r = (patchPreview ?? patchDestination)!,
                    a = r.points[0]!,
                    b = r.points[1]!,
                    w = Math.abs(b.x - a.x),
                    h = Math.abs(b.y - a.y);
                  return (
                    <g className="pro-patch-preview">
                      <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={w} height={h} />
                      {patchDestination && cursor && (
                        <rect
                          className="pro-patch-source"
                          x={cursor.x - w / 2}
                          y={cursor.y - h / 2}
                          width={w}
                          height={h}
                        />
                      )}
                    </g>
                  );
                })()}
              {gesture.current?.type === "repair" && selected && gesture.current.stroke && (
                <polyline
                  className="pro-repair-preview"
                  points={poly(gesture.current.stroke.points.map((p) => worldPoint(p, selected)))}
                  strokeWidth={
                    brush.size * Math.max(selected.transform.scaleX, selected.transform.scaleY)
                  }
                />
              )}
              {(tool === "clone" || tool === "heal") && cloneSource ? (
                <g className="pro-clone-source-marker" aria-label="Clone Stamp source point">
                  <circle
                    cx={cloneSource.point.x}
                    cy={cloneSource.point.y}
                    r={6 / (fit * view.zoom)}
                  />
                  <path
                    d={`M${cloneSource.point.x - 10 / (fit * view.zoom)} ${cloneSource.point.y} H${cloneSource.point.x + 10 / (fit * view.zoom)} M${cloneSource.point.x} ${cloneSource.point.y - 10 / (fit * view.zoom)} V${cloneSource.point.y + 10 / (fit * view.zoom)}`}
                  />
                </g>
              ) : null}
              {polygon.length > 0 && (
                <polyline points={poly(polygon)} className="pro-selection-outline" />
              )}
              {tool === "move" &&
                [...translationIds(doc, selectedIds)]
                  .filter((id) => id !== activeId)
                  .map((id) => {
                    const l = doc.layers.find((l) => l.id === id);
                    return l && l.kind !== "group" ? (
                      <polygon
                        key={id}
                        className="pro-linked-outline"
                        points={[
                          { x: 0, y: 0 },
                          { x: l.width, y: 0 },
                          { x: l.width, y: l.height },
                          { x: 0, y: l.height },
                        ]
                          .map((p) => worldPoint(p, l))
                          .map((p) => `${p.x},${p.y}`)
                          .join(" ")}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1 / (fit * view.zoom)}
                        strokeDasharray="4 4"
                      />
                    ) : null;
                  })}
              {transformDraft &&
                selected &&
                (() => {
                  const t = transformDraft.value,
                    h = transformHandles(transformDraft, transformTarget!, fit * view.zoom),
                    r = 5 / (fit * view.zoom),
                    m = mapping(t),
                    curve = (axis: number, v: number) =>
                      poly(
                        Array.from({ length: 33 }, (_, i) =>
                          m.forward({
                            x: (axis ? v : i / 32) * transformTarget!.width,
                            y: (axis ? i / 32 : v) * transformTarget!.height,
                          }),
                        ),
                      ),
                    cage = t.deform?.points.map((p) =>
                      applyMatrix(affine(t), {
                        x: p.x * transformTarget!.width,
                        y: p.y * transformTarget!.height,
                      }),
                    );
                  return (
                    <g className="pro-transform-overlay" aria-label="Free Transform handles">
                      <polygon
                        className="pro-object-outline"
                        points={poly([h.points[0]!, h.points[2]!, h.points[4]!, h.points[6]!])}
                      />
                      {transformDraft.mode === "warp" &&
                        [0, 0.5, 1].flatMap((v) =>
                          [0, 1].map((axis) => (
                            <polyline
                              className="pro-transform-mesh"
                              key={`${axis}:${v}`}
                              points={curve(axis, v)}
                            />
                          )),
                        )}
                      {transformDraft.mode === "perspective" && cage && (
                        <polygon className="pro-transform-mesh" points={poly(cage)} />
                      )}
                      <line
                        className="pro-handle-line"
                        x1={h.points[1]!.x}
                        y1={h.points[1]!.y}
                        x2={h.rotation.x}
                        y2={h.rotation.y}
                      />
                      {h.handles.map(({ id, p }) => (
                        <g key={id}>
                          {id === "pivot" ? (
                            <g className="pro-transform-pivot">
                              <circle cx={p.x} cy={p.y} r={r * 1.4} />
                              <path
                                d={`M${p.x - r * 2} ${p.y}H${p.x + r * 2}M${p.x} ${p.y - r * 2}V${p.y + r * 2}`}
                              />
                            </g>
                          ) : id === "rotate" ? (
                            <circle className="pro-anchor" cx={p.x} cy={p.y} r={r} />
                          ) : (
                            <rect
                              className="pro-anchor"
                              x={p.x - r}
                              y={p.y - r}
                              width={r * 2}
                              height={r * 2}
                            />
                          )}
                          <circle
                            data-transform-handle={id}
                            aria-label={`Transform ${id} handle`}
                            className="pro-transform-hit"
                            cx={p.x}
                            cy={p.y}
                            r={22 / (fit * view.zoom)}
                          />
                        </g>
                      ))}
                    </g>
                  );
                })()}
              {shownCrop &&
                (() => {
                  const c = shownCrop,
                    corners = ["nw", "ne", "se", "sw"].map((h) => cropHandlePoint(c, h)),
                    points = poly(corners),
                    hitSize = 44 / (fit * view.zoom),
                    line = 1 / (fit * view.zoom);
                  return (
                    <g className="pro-crop-overlay" aria-label="Crop boundaries">
                      <path
                        className="pro-crop-shade"
                        fillRule="evenodd"
                        d={`M0 0H${doc.width}V${doc.height}H0Z M${corners.map((p) => `${p.x} ${p.y}`).join("L")}Z`}
                      />
                      <polygon className="pro-crop-outline" points={points} strokeWidth={line} />
                      {tool === "crop" && (
                        <>
                          {[1, 2].map((n) => {
                            const a = cropPoint(c, { x: (c.width * n) / 3, y: 0 }),
                              b = cropPoint(c, { x: (c.width * n) / 3, y: c.height }),
                              e = cropPoint(c, { x: 0, y: (c.height * n) / 3 }),
                              f = cropPoint(c, { x: c.width, y: (c.height * n) / 3 });
                            return (
                              <g className="pro-crop-thirds" key={n} strokeWidth={line}>
                                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                                <line x1={e.x} y1={e.y} x2={f.x} y2={f.y} />
                              </g>
                            );
                          })}
                          {CROP_HANDLES.map((h) => {
                            const p = cropHandlePoint(c, h);
                            return (
                              <g key={h}>
                                <rect
                                  className="pro-crop-handle-mark"
                                  x={p.x - hitSize / 11}
                                  y={p.y - hitSize / 11}
                                  width={(hitSize * 2) / 11}
                                  height={(hitSize * 2) / 11}
                                  strokeWidth={line}
                                />
                                <rect
                                  className="pro-crop-handle-hit"
                                  data-crop-handle={h}
                                  aria-label={`Crop ${h} handle`}
                                  x={p.x - hitSize / 2}
                                  y={p.y - hitSize / 2}
                                  width={hitSize}
                                  height={hitSize}
                                />
                              </g>
                            );
                          })}
                        </>
                      )}
                    </g>
                  );
                })()}
              {selected && selected.kind !== "group" && ["move", "direct"].includes(tool) && (
                <>
                  <polygon
                    points={poly(
                      [
                        { x: 0, y: 0 },
                        { x: selected.width, y: 0 },
                        { x: selected.width, y: selected.height },
                        { x: 0, y: selected.height },
                      ].map((p) => worldPoint(p, selected)),
                    )}
                    className="pro-object-outline"
                  />
                  {tool === "move" && (
                    <rect
                      data-corner="se"
                      x={
                        worldPoint({ x: selected.width, y: selected.height }, selected).x -
                        5 / (fit * view.zoom)
                      }
                      y={
                        worldPoint({ x: selected.width, y: selected.height }, selected).y -
                        5 / (fit * view.zoom)
                      }
                      width={10 / (fit * view.zoom)}
                      height={10 / (fit * view.zoom)}
                      className="pro-anchor"
                    />
                  )}
                  {tool === "direct" &&
                    selectedPath!.anchors.map((a, i) => {
                      const p = worldPoint(a, selected);
                      return (
                        <g key={i}>
                          {(["incoming", "outgoing"] as const).map((part) => {
                            const handle = a[part];
                            if (!handle) return null;
                            const q = worldPoint(handle, selected);
                            return (
                              <g key={part}>
                                <line
                                  x1={p.x}
                                  y1={p.y}
                                  x2={q.x}
                                  y2={q.y}
                                  className="pro-handle-line"
                                />
                                <circle
                                  data-anchor={i}
                                  data-contour={activeContour}
                                  data-part={part}
                                  cx={q.x}
                                  cy={q.y}
                                  r={5 / (fit * view.zoom)}
                                  className="pro-anchor-control"
                                />
                              </g>
                            );
                          })}
                          <circle
                            data-anchor={i}
                            data-contour={activeContour}
                            data-part="point"
                            cx={p.x}
                            cy={p.y}
                            r={6 / (fit * view.zoom)}
                            className={`pro-anchor${i === activeAnchor ? " pro-anchor-selected" : ""}`}
                          />
                        </g>
                      );
                    })}
                  {tool === "direct" &&
                    splitPoint &&
                    (selected.kind === "shape" || !!selected.textPath) &&
                    selected.shape === "path" &&
                    contours(selected).reduce((n, c) => n + c.anchors.length, 0) < 1000 &&
                    !isLocked(doc, selected.id) && (
                      <g data-split-segment={splitSegment} className="pro-anchor-insert">
                        <title>Insert an exact midpoint anchor</title>
                        <rect
                          x={splitPoint.x - 22 / (fit * view.zoom)}
                          y={splitPoint.y - 22 / (fit * view.zoom)}
                          width={44 / (fit * view.zoom)}
                          height={44 / (fit * view.zoom)}
                          fill="transparent"
                          stroke="none"
                        />
                        <path
                          d={`M${splitPoint.x} ${splitPoint.y - 5 / (fit * view.zoom)} l${5 / (fit * view.zoom)} ${5 / (fit * view.zoom)} l${-5 / (fit * view.zoom)} ${5 / (fit * view.zoom)} l${-5 / (fit * view.zoom)} ${-5 / (fit * view.zoom)} Z`}
                        />
                      </g>
                    )}
                </>
              )}
            </svg>
          )}
        </div>
        {rulers && (
          <ProRulers
            viewport={size}
            frame={viewportFrame}
            fit={fit}
            view={view}
            doc={doc}
            unit={rulerUnit}
            cursor={cursor}
            onGuide={addGuide}
          />
        )}
      </div>
      <div className="pro-canvas-foot">
        <span>
          <Hand /> Scroll to zoom · Space to pan · pinch with two fingers
        </span>
        <button
          type="button"
          aria-label="Navigator: click to center canvas"
          className="pro-navigator"
          onPointerDown={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect(),
              s = Math.min(r.width / viewportFrame.width, r.height / viewportFrame.height),
              x = (e.clientX - r.left - (r.width - viewportFrame.width * s) / 2) / s,
              y = (e.clientY - r.top - (r.height - viewportFrame.height * s) / 2) / s;
            setView((v) =>
              centerViewOn(
                v,
                { x: viewportFrame.x + x, y: viewportFrame.y + y },
                viewportFrame,
                fit,
              ),
            );
          }}
        >
          <canvas ref={mini} width={160} height={110} />
        </button>
      </div>
      {polygon.length > 0 && (
        <div className="pro-actions pro-polygon-actions" role="group" aria-label="Polygon lasso">
          <Button variant="secondary" disabled={polygon.length < 3} onClick={closePolygon}>
            Finish polygon selection
          </Button>
          <Button variant="ghost" onClick={() => setPolygon((a) => a.slice(0, -1))}>
            Remove last point
          </Button>
          <Button variant="ghost" onClick={() => setPolygon([])}>
            Cancel polygon
          </Button>
        </div>
      )}
      {context && (
        <div className="pro-context" role="group" aria-label="Canvas context actions">
          <Button
            onClick={() => {
              onFitCanvas();
              setView((v) => ({ ...v, zoom: 1, x: 0, y: 0 }));
              setContext(false);
            }}
          >
            Fit canvas
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onSelection({ regions: [], inverted: false, feather: 0 });
              setContext(false);
            }}
          >
            Deselect
          </Button>
          <Button variant="ghost" onClick={() => setContext(false)}>
            Close menu
          </Button>
        </div>
      )}
    </section>
  );
}
