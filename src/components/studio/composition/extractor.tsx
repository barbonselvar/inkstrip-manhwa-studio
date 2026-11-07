import "./extractor.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Brush,
  Eraser,
  Hand,
  Lasso,
  Pentagon,
  Redo2,
  RotateCcw,
  Scissors,
  Square,
  Undo2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";
import { getImageBlob } from "@/lib/studio/db";
import { decodeBlob, deviceLimits } from "@/lib/studio/images";
import { preflightImage } from "@/lib/studio/image-policy";
import type { Panel } from "@/lib/studio/types";
import {
  DEFAULT_MATTE,
  buildAsset,
  estimateBackground,
  fitArea,
  generateMatte,
  maskBounds,
  polygonSelection,
  previewRegion,
  rectSelection,
  resolveKey,
  strokeBrush,
  type AssetOptions,
  type BrushMode,
  type Key,
  type MatteOptions,
  type Point,
  type RGB,
  type Rect,
} from "@/lib/studio/composition/extract";
import { NumberField } from "../editor/number-field";

type Source = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  name: string;
  scale: number;
  originalWidth: number;
  originalHeight: number;
};
type Tool = "rect" | "polygon" | "lasso" | BrushMode | "pan";
type Snapshot = {
  alpha: Uint8Array;
  selection: Uint8Array | null;
  preliminary: Uint8Array;
  path: Point[] | null;
  backgrounds: RGB[];
  key: Key;
  generated: boolean;
};

/** Work surfaces keep several full-size masks and history snapshots; bound them. */
function workArea() {
  return Math.min(deviceLimits().maxArea * 0.375, 12_000_000);
}

async function loadSource(blob: Blob, name: string): Promise<Source> {
  const decoded = await decodeBlob(blob);
  try {
    const fit = fitArea(decoded.width, decoded.height, workArea(), deviceLimits().maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = fit.width;
    canvas.height = fit.height;
    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw Error("This browser cannot open an extraction surface.");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(decoded.source, 0, 0, fit.width, fit.height);
      const data = ctx.getImageData(0, 0, fit.width, fit.height).data;
      return {
        rgba: new Uint8ClampedArray(data),
        width: fit.width,
        height: fit.height,
        name,
        scale: fit.scale,
        originalWidth: decoded.width,
        originalHeight: decoded.height,
      };
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    decoded.close();
  }
}

const TOOLS: { id: Tool; label: string; icon: typeof Square; hint: string }[] = [
  { id: "rect", label: "Rectangle", icon: Square, hint: "Drag a box around the effect." },
  {
    id: "polygon",
    label: "Polygon",
    icon: Pentagon,
    hint: "Click corner points. Click the first point, double-click or press Enter to close.",
  },
  { id: "lasso", label: "Lasso", icon: Lasso, hint: "Draw freehand around the effect." },
  { id: "foreground", label: "Keep brush", icon: Brush, hint: "Paint to keep pixels fully." },
  {
    id: "background",
    label: "Remove background",
    icon: Wand2,
    hint: "Paint over leftover background; strokes that differ from it are kept.",
  },
  {
    id: "erase",
    label: "Eraser",
    icon: Eraser,
    hint: "Paint to remove everything under the brush.",
  },
  {
    id: "restore",
    label: "Restore",
    icon: RotateCcw,
    hint: "Paint to return to the generated mask.",
  },
  { id: "pan", label: "Pan", icon: Hand, hint: "Drag or scroll to move around the image." },
];

export function SfxExtractor({
  panels,
  onSave,
}: {
  panels: Panel[];
  onSave: (
    blob: Blob,
    name: string,
    collection: string,
    width: number,
    height: number,
    place: boolean,
  ) => Promise<void>;
}) {
  const thumbs = useStudio((s) => s.thumbs);
  const [source, setSource] = useState<Source | null>(null),
    [loading, setLoading] = useState(""),
    [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const open = async (load: () => Promise<Blob | undefined | null>, name: string) => {
    setError("");
    setLoading(name);
    try {
      const blob = await load();
      if (!blob) throw Error("This image is not available in browser storage.");
      setSource(await loadSource(blob, name));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The image could not be opened.");
    } finally {
      setLoading("");
    }
  };
  return (
    <div className="extractor-launcher">
      <p className="composition-hint">
        Isolate lettering or an effect from a panel or a reference image and save it as a
        transparent reusable asset. The original image is never changed. Everything runs on this
        device.
      </p>
      <Button variant="secondary" disabled={!!loading} onClick={() => fileRef.current?.click()}>
        <Scissors />
        Extract from an image file
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label="Image to extract from"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void open(
              async () => {
                const info = await preflightImage(file);
                return file.type === info.mime ? file : file.slice(0, file.size, info.mime);
              },
              file.name.replace(/\.[^.]+$/, ""),
            );
        }}
      />
      {panels.length > 0 && <h4>Or choose a chapter panel</h4>}
      <div className="extractor-panel-grid">
        {panels.map((panel, index) => (
          <button
            key={panel.id}
            className="composition-shape-card"
            disabled={!!loading}
            aria-label={`Extract from panel ${index + 1}`}
            onClick={() => void open(() => getImageBlob(panel.blobId), panel.name)}
          >
            {thumbs[panel.id] ? (
              <img src={thumbs[panel.id]} alt="" loading="lazy" />
            ) : (
              <span className="composition-thumbnail-loading" />
            )}
            <strong>
              {index + 1} · {panel.name}
            </strong>
          </button>
        ))}
      </div>
      {loading && <p role="status">Opening {loading}…</p>}
      {error && <p role="alert">{error}</p>}
      {source &&
        createPortal(
          <ExtractorWorkspace source={source} onClose={() => setSource(null)} onSave={onSave} />,
          document.body,
        )}
    </div>
  );
}

function ExtractorWorkspace({
  source,
  onClose,
  onSave,
}: {
  source: Source;
  onClose: () => void;
  onSave: (
    blob: Blob,
    name: string,
    collection: string,
    width: number,
    height: number,
    place: boolean,
  ) => Promise<void>;
}) {
  const { width: w, height: h, rgba } = source;
  const canvasRef = useRef<HTMLCanvasElement>(null),
    viewportRef = useRef<HTMLDivElement>(null),
    stageRef = useRef<HTMLDivElement>(null),
    outputRef = useRef<HTMLCanvasElement>(null);
  const full = useMemo(() => new Uint8Array(w * h).fill(255), [w, h]);
  const state = useRef<Snapshot>({
    alpha: new Uint8Array(full),
    selection: null,
    preliminary: full,
    path: null,
    backgrounds: [],
    key: { tolerance: DEFAULT_MATTE.tolerance, full: 441 },
    generated: false,
  });
  const past = useRef<Snapshot[]>([]),
    future = useRef<Snapshot[]>([]);
  const historyLimit = Math.max(3, Math.min(20, Math.floor(200_000_000 / (w * h))));
  const [version, setVersion] = useState(0);
  const [tool, setTool] = useState<Tool>("rect"),
    [radius, setRadius] = useState(Math.max(4, Math.round(Math.min(w, h) / 50))),
    [hardness, setHardness] = useState(0.6),
    [matte, setMatte] = useState<MatteOptions>(DEFAULT_MATTE),
    [clean, setClean] = useState(true),
    [original, setOriginal] = useState(false),
    [zoom, setZoom] = useState(1),
    [draft, setDraft] = useState<Point[]>([]),
    [cursor, setCursor] = useState<Point | null>(null),
    [name, setName] = useState(`${source.name} extract`.slice(0, 200)),
    [collection, setCollection] = useState("Extracted"),
    [format, setFormat] = useState<"image/png" | "image/webp">("image/png"),
    [recolorOn, setRecolorOn] = useState(false),
    [recolor, setRecolor] = useState({ color: "#ffffff", strength: 1, shading: 0 }),
    [outline, setOutline] = useState({ color: "#000000", width: 0 }),
    [shadowOn, setShadowOn] = useState(false),
    [shadow, setShadow] = useState({ color: "#000000", x: 6, y: 6, blur: 6, opacity: 0.6 }),
    [opacity, setOpacity] = useState(1),
    [output, setOutput] = useState<{ width: number; height: number } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const pointer = useRef<{ id: number; start: Point; last: Point; moved: boolean } | null>(null);
  const bump = () => setVersion((v) => v + 1);

  const snapshot = (): Snapshot => ({
    ...state.current,
    alpha: new Uint8Array(state.current.alpha),
  });
  const push = () => {
    past.current.push(snapshot());
    if (past.current.length > historyLimit) past.current.shift();
    future.current = [];
  };
  const restore = (s: Snapshot) => {
    state.current = { ...s, alpha: new Uint8Array(s.alpha) };
    paint();
    bump();
  };
  const undo = () => {
    const s = past.current.pop();
    if (!s) return;
    future.current.push(snapshot());
    restore(s);
  };
  const redo = () => {
    const s = future.current.pop();
    if (!s) return;
    past.current.push(snapshot());
    restore(s);
  };

  const paint = useCallback(
    (rect?: Rect | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const r = rect
        ? {
            x: Math.max(0, rect.x),
            y: Math.max(0, rect.y),
            width: Math.min(w, rect.x + rect.width) - Math.max(0, rect.x),
            height: Math.min(h, rect.y + rect.height) - Math.max(0, rect.y),
          }
        : { x: 0, y: 0, width: w, height: h };
      if (r.width <= 0 || r.height <= 0) return;
      const s = state.current;
      const data = original
        ? previewRegion(rgba, full, w, r, [], false)
        : previewRegion(rgba, s.alpha, w, r, s.backgrounds, clean);
      ctx.putImageData(new ImageData(data, r.width, r.height), r.x, r.y);
    },
    [rgba, w, h, full, original, clean],
  );
  useEffect(() => paint(), [paint]);

  // Fit the image into the viewport once.
  useEffect(() => {
    const v = viewportRef.current;
    if (!v) return;
    setZoom(
      Math.min(4, Math.max(0.02, Math.min((v.clientWidth - 24) / w, (v.clientHeight - 24) / h))),
    );
  }, [w, h]);
  const fit = () => {
    const v = viewportRef.current;
    if (v) setZoom(Math.max(0.02, Math.min((v.clientWidth - 24) / w, (v.clientHeight - 24) / h)));
  };

  const applySelection = (selection: Uint8Array, path: Point[], generate = true) => {
    if (!maskBounds(selection, w, h)) {
      setError("The selection is empty. Draw around the effect again.");
      return;
    }
    push();
    const backgrounds = estimateBackground(rgba, w, h, selection);
    if (generate) {
      const result = generateMatte(rgba, w, h, selection, matte, backgrounds);
      state.current = {
        selection,
        path,
        backgrounds,
        key: result.key,
        alpha: new Uint8Array(result.alpha),
        preliminary: result.alpha,
        generated: true,
      };
    } else
      state.current = {
        selection,
        path,
        backgrounds,
        key: resolveKey(rgba, selection, backgrounds, matte),
        alpha: new Uint8Array(selection),
        preliminary: selection,
        generated: false,
      };
    setError("");
    paint();
    bump();
  };

  const regenerate = (options: MatteOptions, useKey = true) => {
    const s = state.current,
      selection = s.selection ?? full;
    push();
    const backgrounds = s.selection ? s.backgrounds : estimateBackground(rgba, w, h, selection);
    if (!useKey) {
      state.current = {
        ...s,
        alpha: new Uint8Array(selection),
        preliminary: selection,
        generated: false,
      };
    } else {
      const result = generateMatte(rgba, w, h, selection, options, backgrounds);
      state.current = {
        ...s,
        backgrounds,
        key: result.key,
        alpha: new Uint8Array(result.alpha),
        preliminary: result.alpha,
        generated: true,
      };
    }
    paint();
    bump();
  };
  // Matte settings regenerate after a short pause (one history entry per pause).
  const matteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const changeMatte = (next: MatteOptions) => {
    setMatte(next);
    clearTimeout(matteTimer.current);
    if (state.current.generated) matteTimer.current = setTimeout(() => regenerate(next), 220);
  };
  useEffect(() => () => clearTimeout(matteTimer.current), []);

  const closePolygon = (points = draft) => {
    if (points.length < 3) return;
    setDraft([]);
    applySelection(polygonSelection(w, h, points), points);
  };

  const toImage = (e: { clientX: number; clientY: number }): Point => {
    const r = stageRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * w,
      y: ((e.clientY - r.top) / r.height) * h,
    };
  };
  const brush = (from: Point, to: Point) => {
    const s = state.current;
    const dirty = strokeBrush(
      s.alpha,
      w,
      h,
      from,
      to,
      radius,
      tool as BrushMode,
      {
        rgba,
        preliminary: s.preliminary,
        backgrounds: s.backgrounds.length
          ? s.backgrounds
          : estimateBackground(rgba, w, h, s.selection ?? full),
        key: s.key,
      },
      hardness,
    );
    paint(dirty);
  };
  const brushing = ["foreground", "background", "erase", "restore"].includes(tool);
  // Background removal needs a background estimate even before a selection exists.
  useEffect(() => {
    if (tool === "background" && !state.current.backgrounds.length) {
      const backgrounds = estimateBackground(rgba, w, h, state.current.selection ?? full);
      state.current = {
        ...state.current,
        backgrounds,
        key: resolveKey(rgba, state.current.selection ?? full, backgrounds, matte),
      };
    }
  }, [tool, rgba, w, h, full, matte]);

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input,textarea,select")) return;
      // The extractor is modal: chapter shortcuts (Delete, undo, copy…) must not
      // reach the composition editor underneath.
      e.stopPropagation();
      const command = e.ctrlKey || e.metaKey;
      if (command && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
      } else if (command && e.key.toLowerCase() === "y") {
        e.preventDefault();
        e.stopPropagation();
        redo();
      } else if (e.key === "Enter" && tool === "polygon") {
        e.preventDefault();
        closePolygon();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (draft.length) setDraft([]);
        else onClose();
      }
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  });

  const assetOptions = useMemo<AssetOptions>(
    () => ({
      decontaminate: clean,
      opacity,
      padding: 2,
      recolor: recolorOn ? recolor : undefined,
      outline: outline.width > 0 ? outline : undefined,
      shadow: shadowOn ? shadow : undefined,
    }),
    [clean, opacity, recolorOn, recolor, outline, shadowOn, shadow],
  );
  const build = useCallback(() => {
    const s = state.current;
    return buildAsset(rgba, w, h, s.alpha, s.backgrounds, assetOptions);
  }, [rgba, w, h, assetOptions]);
  // Output preview (debounced): shows recolor/outline/shadow exactly as saved.
  useEffect(() => {
    const timer = setTimeout(() => {
      const result = build(),
        canvas = outputRef.current;
      if (!canvas) return;
      if (!result) {
        canvas.width = canvas.height = 1;
        setOutput(null);
        return;
      }
      canvas.width = result.width;
      canvas.height = result.height;
      canvas
        .getContext("2d")!
        .putImageData(new ImageData(result.data, result.width, result.height), 0, 0);
      setOutput({ width: result.width, height: result.height });
    }, 350);
    return () => clearTimeout(timer);
  }, [build, version]);

  const save = async (place: boolean) => {
    setError("");
    setMessage("");
    const result = build();
    if (!result) {
      setError("Nothing is selected in the mask. Keep some pixels before saving.");
      return;
    }
    setBusy(true);
    const canvas = document.createElement("canvas");
    try {
      canvas.width = result.width;
      canvas.height = result.height;
      canvas
        .getContext("2d")!
        .putImageData(new ImageData(result.data, result.width, result.height), 0, 0);
      let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, 0.95));
      if (!blob) throw Error("The asset could not be encoded. Try PNG.");
      let note = "";
      if (blob.type !== format) {
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw Error("The asset could not be encoded.");
        note = " This browser cannot encode WebP, so PNG was used.";
      }
      await onSave(
        blob,
        name.trim() || "Extracted SFX",
        collection.trim() || "Extracted",
        result.width,
        result.height,
        place,
      );
      setMessage(
        `${place ? "Saved and placed" : "Saved to My Assets"} · ${result.width} × ${result.height} px.${note}`,
      );
      if (place) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The asset could not be saved.");
    } finally {
      canvas.width = canvas.height = 0;
      setBusy(false);
    }
  };

  const s = state.current;
  const marker = 8 / zoom,
    current = TOOLS.find((t) => t.id === tool)!;
  const pathText = (points: Point[], closed: boolean) =>
    points.length ? `M${points.map((p) => `${p.x} ${p.y}`).join(" L")}${closed ? " Z" : ""}` : "";

  return (
    <div className="extractor-overlay" role="dialog" aria-modal="true" aria-label="SFX extractor">
      <header className="extractor-header">
        <strong>Extract SFX &amp; artwork</strong>
        <span className="extractor-size">
          {w} × {h} px
          {source.scale < 1 &&
            ` · reduced from ${source.originalWidth} × ${source.originalHeight} for device memory`}
        </span>
        <Button variant="ghost" size="icon" aria-label="Close extractor" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="extractor-toolbar" role="toolbar" aria-label="Extraction tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? "is-active" : ""}
            aria-pressed={tool === t.id}
            title={t.hint}
            onClick={() => {
              setTool(t.id);
              setDraft([]);
            }}
          >
            <t.icon />
            <span>{t.label}</span>
          </button>
        ))}
        <span className="extractor-divider" />
        <button aria-label="Undo extraction step" disabled={!past.current.length} onClick={undo}>
          <Undo2 />
        </button>
        <button aria-label="Redo extraction step" disabled={!future.current.length} onClick={redo}>
          <Redo2 />
        </button>
        <button
          aria-label="Zoom out extractor"
          onClick={() => setZoom((z) => Math.max(0.02, z / 1.25))}
        >
          <ZoomOut />
        </button>
        <button onClick={fit}>Fit</button>
        <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button
          aria-label="Zoom in extractor"
          onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
        >
          <ZoomIn />
        </button>
        <label className="composition-check">
          <input
            type="checkbox"
            checked={original}
            onChange={(e) => setOriginal(e.target.checked)}
          />
          Show original
        </label>
      </div>
      <div className="extractor-body">
        <div className="extractor-main">
          <p className="extractor-tool-hint" role="status">
            {current.hint}
            {tool === "polygon" && draft.length >= 3 && (
              <Button size="sm" variant="secondary" onClick={() => closePolygon()}>
                Close polygon
              </Button>
            )}
          </p>
          <div
            ref={viewportRef}
            className={`extractor-viewport ${tool === "pan" ? "is-pan" : ""}`}
            onPointerDown={(e) => {
              if (tool !== "pan" || e.pointerType === "touch") return;
              const v = viewportRef.current!;
              const start = { x: e.clientX, y: e.clientY, left: v.scrollLeft, top: v.scrollTop };
              const move = (m: PointerEvent) => {
                v.scrollLeft = start.left - (m.clientX - start.x);
                v.scrollTop = start.top - (m.clientY - start.y);
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          >
            <div
              ref={stageRef}
              className="extractor-stage"
              style={{
                width: w * zoom,
                height: h * zoom,
                touchAction: tool === "pan" ? "auto" : "none",
              }}
              data-extract-version={version}
              onPointerDown={(e) => {
                if (tool === "pan" || e.button !== 0 || pointer.current) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                const p = toImage(e);
                pointer.current = { id: e.pointerId, start: p, last: p, moved: false };
                if (tool === "lasso") setDraft([p]);
                if (tool === "rect") setDraft([p, p]);
                if (brushing) {
                  push();
                  brush(p, p);
                }
              }}
              onPointerMove={(e) => {
                const p = toImage(e);
                if (brushing) setCursor(p);
                const active = pointer.current;
                if (!active || active.id !== e.pointerId) return;
                if (Math.hypot(p.x - active.start.x, p.y - active.start.y) * zoom > 4)
                  active.moved = true;
                if (tool === "rect") setDraft([active.start, p]);
                if (
                  tool === "lasso" &&
                  Math.hypot(p.x - active.last.x, p.y - active.last.y) * zoom >= 3
                ) {
                  setDraft((d) => [...d, p]);
                  active.last = p;
                }
                if (brushing) {
                  brush(active.last, p);
                  active.last = p;
                }
              }}
              onPointerUp={(e) => {
                const active = pointer.current;
                if (!active || active.id !== e.pointerId) return;
                pointer.current = null;
                const p = toImage(e);
                if (tool === "rect") {
                  setDraft([]);
                  if (Math.abs(p.x - active.start.x) >= 2 && Math.abs(p.y - active.start.y) >= 2) {
                    const path = [
                      active.start,
                      { x: p.x, y: active.start.y },
                      p,
                      { x: active.start.x, y: p.y },
                    ];
                    applySelection(
                      rectSelection(w, h, active.start.x, active.start.y, p.x, p.y),
                      path,
                    );
                  }
                } else if (tool === "lasso") {
                  const points = [...draft, p];
                  setDraft([]);
                  if (points.length >= 3) applySelection(polygonSelection(w, h, points), points);
                } else if (tool === "polygon" && !active.moved) {
                  const first = draft[0];
                  if (
                    first &&
                    draft.length >= 3 &&
                    Math.hypot(p.x - first.x, p.y - first.y) * zoom <= 14
                  )
                    closePolygon();
                  else setDraft((d) => [...d, p]);
                } else if (brushing) bump();
              }}
              onPointerCancel={() => {
                pointer.current = null;
                if (tool !== "polygon") setDraft([]);
              }}
              onPointerLeave={() => setCursor(null)}
              onDoubleClick={() => {
                if (tool === "polygon") closePolygon(draft);
              }}
            >
              <canvas
                ref={canvasRef}
                width={w}
                height={h}
                aria-label="Extraction preview over transparency"
              />
              <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
                {s.path && <path className="extractor-ants" d={pathText(s.path, true)} />}
                {draft.length > 0 && (
                  <path
                    className="extractor-draft"
                    d={
                      tool === "rect" && draft.length === 2
                        ? pathText(
                            [
                              draft[0]!,
                              { x: draft[1]!.x, y: draft[0]!.y },
                              draft[1]!,
                              { x: draft[0]!.x, y: draft[1]!.y },
                            ],
                            true,
                          )
                        : pathText(draft, false)
                    }
                  />
                )}
                {tool === "polygon" &&
                  draft.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={i === 0 ? marker * 1.4 : marker}
                      className="extractor-point"
                    />
                  ))}
                {brushing && cursor && (
                  <circle cx={cursor.x} cy={cursor.y} r={radius} className="extractor-cursor" />
                )}
              </svg>
            </div>
          </div>
        </div>
        <aside className="extractor-side" aria-label="Extraction settings">
          <section>
            <h4>Mask</h4>
            <div className="extractor-row">
              <Button
                size="sm"
                variant={s.generated ? "secondary" : "primary"}
                onClick={() => regenerate(matte)}
              >
                <Wand2 />
                Generate mask
              </Button>
              <Button size="sm" variant="ghost" onClick={() => regenerate(matte, false)}>
                Use plain selection
              </Button>
            </div>
            <p className="composition-hint">
              Local color-key matting estimates the background from the selection edge
              {s.backgrounds.length
                ? ` (${s.backgrounds.length} color${s.backgrounds.length > 1 ? "s" : ""})`
                : ""}
              . It works best on flat or simple backgrounds; refine busy artwork with the brushes.
              Changing these settings regenerates the mask (Undo restores brush work).
            </p>
            <label className="editor-field-label">
              Background tolerance · {matte.tolerance}
              <input
                type="range"
                min={0}
                max={200}
                value={matte.tolerance}
                onChange={(e) => changeMatte({ ...matte, tolerance: Number(e.target.value) })}
              />
            </label>
            <label className="editor-field-label">
              Edge softness · {matte.softness}%
              <input
                type="range"
                min={0}
                max={100}
                value={matte.softness}
                onChange={(e) => changeMatte({ ...matte, softness: Number(e.target.value) })}
              />
            </label>
            <label className="composition-check">
              <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} />
              Decontaminate edge colors
            </label>
          </section>
          <section>
            <h4>Brush</h4>
            <label className="editor-field-label">
              Brush size · {radius * 2} px
              <input
                type="range"
                min={1}
                max={Math.max(20, Math.round(Math.max(w, h) / 6))}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              />
            </label>
            <label className="editor-field-label">
              Brush hardness · {Math.round(hardness * 100)}%
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(hardness * 100)}
                onChange={(e) => setHardness(Number(e.target.value) / 100)}
              />
            </label>
          </section>
          <section>
            <h4>Output</h4>
            <div className="extractor-output-preview">
              <canvas ref={outputRef} width={1} height={1} aria-label="Extracted asset preview" />
            </div>
            <p className="composition-hint" role="status">
              {output
                ? `${output.width} × ${output.height} px transparent asset`
                : "Mask is empty."}
            </p>
            <label className="composition-check">
              <input
                type="checkbox"
                checked={recolorOn}
                onChange={(e) => setRecolorOn(e.target.checked)}
              />
              Recolor
            </label>
            {recolorOn && (
              <div className="extractor-grid">
                <label className="editor-field-label">
                  Recolor color
                  <input
                    type="color"
                    value={recolor.color}
                    onChange={(e) => setRecolor({ ...recolor, color: e.target.value })}
                  />
                </label>
                <NumberField
                  label="Recolor strength"
                  value={recolor.strength}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(strength) => setRecolor({ ...recolor, strength })}
                />
                <NumberField
                  label="Keep shading"
                  value={recolor.shading}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(shading) => setRecolor({ ...recolor, shading })}
                />
              </div>
            )}
            <div className="extractor-grid">
              <NumberField
                label="Outline width (px)"
                value={outline.width}
                min={0}
                max={64}
                onChange={(width) => setOutline({ ...outline, width })}
              />
              <label className="editor-field-label">
                Outline color
                <input
                  type="color"
                  value={outline.color}
                  onChange={(e) => setOutline({ ...outline, color: e.target.value })}
                />
              </label>
            </div>
            <label className="composition-check">
              <input
                type="checkbox"
                checked={shadowOn}
                onChange={(e) => setShadowOn(e.target.checked)}
              />
              Drop shadow
            </label>
            {shadowOn && (
              <div className="extractor-grid">
                <label className="editor-field-label">
                  Shadow color
                  <input
                    type="color"
                    value={shadow.color}
                    onChange={(e) => setShadow({ ...shadow, color: e.target.value })}
                  />
                </label>
                <NumberField
                  label="Shadow X"
                  value={shadow.x}
                  min={-200}
                  max={200}
                  onChange={(x) => setShadow({ ...shadow, x })}
                />
                <NumberField
                  label="Shadow Y"
                  value={shadow.y}
                  min={-200}
                  max={200}
                  onChange={(y) => setShadow({ ...shadow, y })}
                />
                <NumberField
                  label="Shadow blur"
                  value={shadow.blur}
                  min={0}
                  max={60}
                  onChange={(blur) => setShadow({ ...shadow, blur })}
                />
                <NumberField
                  label="Shadow opacity"
                  value={shadow.opacity}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(o) => setShadow({ ...shadow, opacity: o })}
                />
              </div>
            )}
            <NumberField
              label="Asset opacity"
              value={opacity}
              min={0.05}
              max={1}
              step={0.05}
              onChange={setOpacity}
            />
          </section>
          <section>
            <h4>Save</h4>
            <label className="editor-field-label">
              Extracted asset name
              <input
                className="field"
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="editor-field-label">
              Extracted asset category
              <input
                className="field"
                value={collection}
                maxLength={80}
                onChange={(e) => setCollection(e.target.value)}
              />
            </label>
            <label className="editor-field-label">
              File format
              <select
                className="field"
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
              >
                <option value="image/png">PNG (lossless, transparent)</option>
                <option value="image/webp">WebP (smaller, transparent)</option>
              </select>
            </label>
            <div className="extractor-row">
              <Button disabled={busy || !output} onClick={() => void save(false)}>
                Save to My Assets
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !output}
                onClick={() => void save(true)}
              >
                Save and place in chapter
              </Button>
            </div>
            {message && <p role="status">{message}</p>}
            {error && <p role="alert">{error}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
