import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointer } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Scan, Hand } from "lucide-react";
import {
  layer,
  localPoint,
  toLocalSelection,
  worldPoint,
  type ProDocument,
  type Layer,
  type Point,
  type Selection,
  type Stroke,
  type Region,
} from "@/lib/studio/pro/model";
import { isLocked } from "@/lib/studio/pro/operations";
import { shapePath } from "@/lib/studio/pro/paths";
export type ProTool =
  | "move"
  | "hand"
  | "brush"
  | "eraser"
  | "eyedropper"
  | "rectangle"
  | "ellipse"
  | "line"
  | "polygon"
  | "pen"
  | "direct"
  | "text"
  | "select-rect"
  | "select-ellipse"
  | "lasso"
  | "poly-lasso";
type View = { zoom: number; x: number; y: number };
type Gesture = {
  type: string;
  start: Point;
  screen: Point;
  doc: ProDocument;
  id?: string;
  stroke?: Stroke;
  region?: Region;
  index?: number;
  part?: string;
  corner?: string;
  view: View;
  selection: Selection;
};
export function ProCanvas({
  doc,
  activeId,
  tool,
  selection,
  onSelection,
  brush,
  operation,
  maskMode,
  snapping,
  grid,
  before,
  canvasRef,
  renderVersion,
  onTransient,
  onCommit,
  onSelect,
  onColor,
  disabled,
  rendering,
}: {
  doc: ProDocument;
  activeId: string;
  tool: ProTool;
  selection: Selection;
  onSelection: (s: Selection) => void;
  brush: Omit<Stroke, "points" | "erase">;
  operation: Region["operation"];
  maskMode: boolean;
  snapping: boolean;
  grid: boolean;
  before: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  renderVersion: number;
  onTransient: (d: ProDocument | null) => void;
  onCommit: (d: ProDocument, label: string) => void;
  onSelect: (id: string) => void;
  onColor: (c: string) => void;
  disabled: boolean;
  rendering: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    board = useRef<HTMLDivElement>(null),
    mini = useRef<HTMLCanvasElement>(null),
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
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 }),
    gesture = useRef<Gesture | null>(null),
    pointers = useRef(new Map<number, Point>()),
    pinch = useRef<{ distance: number; view: View; center: Point } | null>(null),
    space = useRef(false),
    [polygon, setPolygon] = useState<Point[]>([]),
    pathId = useRef(""),
    [context, setContext] = useState(false);
  const fit = Math.min(
      Math.max(1, size.width - 64) / doc.width,
      Math.max(1, size.height - 64) / doc.height,
    ),
    selected = doc.layers.find((l) => l.id === activeId);
  useEffect(() => {
    pathId.current = "";
    setPolygon([]);
  }, [tool]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        space.current = true;
      }
      if (e.key === "Escape") {
        gesture.current = null;
        onTransient(null);
        setPolygon([]);
      }
      if (e.key === "Enter" && polygon.length >= 3) {
        onSelection({
          ...selection,
          regions: [
            ...selection.regions,
            {
              kind: "lasso",
              operation,
              points: polygon,
            },
          ],
        });
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
  }, [polygon, selection, operation, onSelection, onTransient]);
  const docPoint = (p: Point): Point => {
    const r = board.current!.getBoundingClientRect();
    return {
      x: ((p.x - r.left) / r.width) * doc.width,
      y: ((p.y - r.top) / r.height) * doc.height,
    };
  };
  const zoomAt = (zoom: number, client?: Point) => {
    const r = viewport.current!.getBoundingClientRect(),
      p = client
        ? { x: client.x - r.left - r.width / 2, y: client.y - r.top - r.height / 2 }
        : { x: 0, y: 0 };
    setView((v) => {
      const next = Math.max(0.1, Math.min(12, zoom)),
        ratio = next / v.zoom;
      return { zoom: next, x: p.x - (p.x - v.x) * ratio, y: p.y - (p.y - v.y) * ratio };
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
        return { zoom: z, x: x - (x - v.x) * q, y: y - (y - v.y) * q };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (mini.current && canvasRef.current) {
      const ctx = mini.current.getContext("2d")!;
      ctx.clearRect(0, 0, 160, 110);
      const s = Math.min(160 / doc.width, 110 / doc.height);
      ctx.drawImage(
        canvasRef.current,
        (160 - doc.width * s) / 2,
        (110 - doc.height * s) / 2,
        doc.width * s,
        doc.height * s,
      );
    }
  }, [canvasRef, renderVersion, doc.width, doc.height]);
  const hit = (p: Point) => {
    const ctx = canvasRef.current?.getContext("2d");
    return [...doc.layers].reverse().find((l) => {
      if (!l.visible || l.locked || l.kind === "group") return false;
      let parent = l.parentId;
      while (parent) {
        const g = doc.layers.find((x) => x.id === parent);
        if (!g || !g.visible || g.locked) return false;
        parent = g.parentId;
      }
      const q = localPoint(p, l);
      if (l.kind === "shape" && ctx) {
        const path = new Path2D(shapePath(l));
        ctx.save();
        ctx.lineWidth = Math.max(l.strokeWidth, 10 / (fit * view.zoom));
        const yes =
          (l.fill !== "transparent" && ctx.isPointInPath(path, q.x, q.y)) ||
          ctx.isPointInStroke(path, q.x, q.y);
        ctx.restore();
        return yes;
      }
      return q.x >= 0 && q.y >= 0 && q.x <= l.width && q.y <= l.height;
    });
  };
  const begin = (e: ReactPointer<HTMLDivElement>) => {
    if (disabled || before || e.button !== 0) return;
    e.preventDefault();
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
      gesture.current = null;
      onTransient(null);
      return;
    }
    const p = docPoint(screen),
      base: Gesture = { type: tool, start: p, screen, doc, view, selection };
    if (tool === "hand" || space.current) {
      gesture.current = { ...base, type: "pan" };
      return;
    }
    if (tool === "eyedropper") {
      const c = canvasRef.current;
      if (c) {
        const rgba = c
          .getContext("2d")!
          .getImageData(
            Math.max(0, Math.min(c.width - 1, Math.floor((p.x / doc.width) * c.width))),
            Math.max(0, Math.min(c.height - 1, Math.floor((p.y / doc.height) * c.height))),
            1,
            1,
          ).data;
        onColor("#" + [...rgba.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join(""));
      }
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
          operation,
          points: [p, p],
        },
      };
      return;
    }
    if (tool === "brush" || tool === "eraser") {
      if (
        !selected ||
        isLocked(doc, selected.id) ||
        selected.kind === "group" ||
        (!maskMode && selected.kind !== "paint")
      )
        return;
      const clip =
        selection.regions.length || selection.inverted
          ? toLocalSelection(selection, selected)
          : undefined;
      gesture.current = {
        ...base,
        type: "paint",
        id: selected.id,
        stroke: {
          ...brush,
          clip: maskMode ? undefined : clip,
          erase: maskMode && selected.mask?.inverted ? tool !== "eraser" : tool === "eraser",
          points: [localPoint(p, selected)],
        },
      };
      return;
    }
    const target = e.target as HTMLElement,
      anchor = target.closest("[data-anchor]"),
      corner = target.closest("[data-corner]");
    if (tool === "direct" && anchor && selected && !isLocked(doc, selected.id)) {
      gesture.current = {
        ...base,
        type: "anchor",
        id: selected.id,
        index: Number(anchor.getAttribute("data-anchor")),
        part: anchor.getAttribute("data-part") ?? "point",
      };
      return;
    }
    if (tool === "pen") {
      let existing = doc.layers.find((l) => l.id === pathId.current && !l.closed && !l.locked);
      let next = doc;
      if (!existing) {
        existing = layer("shape", doc.width, doc.height);
        existing.name = "Bézier path";
        existing.shape = "path";
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
    if (["rectangle", "ellipse", "line", "polygon", "text"].includes(tool)) {
      const object = layer(
        tool === "text" ? "text" : "shape",
        Math.max(1, Math.min(280, doc.width * 0.6)),
        Math.max(1, Math.min(140, doc.height * 0.3)),
      );
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
    if (corner && selected && !isLocked(doc, selected.id)) {
      gesture.current = {
        ...base,
        type: "resize",
        id: selected.id,
        corner: corner.getAttribute("data-corner")!,
      };
      return;
    }
    const chosen = hit(p);
    if (chosen) {
      onSelect(chosen.id);
      gesture.current = { ...base, type: "move", id: chosen.id };
    } else onSelect("");
  };
  const update = (screen: Point): ProDocument | null => {
    const g = gesture.current;
    if (!g) return null;
    const p = docPoint(screen);
    if (g.type === "pan") {
      setView({
        ...g.view,
        x: g.view.x + screen.x - g.screen.x,
        y: g.view.y + screen.y - g.screen.y,
      });
      return null;
    }
    if (g.type === "selection") {
      const r = g.region!;
      g.region = { ...r, points: r.kind === "lasso" ? [...r.points, p] : [g.start, p] };
      onSelection({ ...g.selection, regions: [...g.selection.regions, g.region] });
      return null;
    }
    const l = g.doc.layers.find((x) => x.id === g.id);
    if (!l) return null;
    let next = l;
    if (g.type === "move") {
      let x = l.transform.x + p.x - g.start.x,
        y = l.transform.y + p.y - g.start.y;
      if (snapping) {
        x = Math.round(x / 10) * 10;
        y = Math.round(y / 10) * 10;
        const center = worldPoint(
          { x: l.width / 2, y: l.height / 2 },
          { ...l, transform: { ...l.transform, x, y } },
        );
        if (Math.abs(center.x - doc.width / 2) < 8 / (fit * view.zoom))
          x += doc.width / 2 - center.x;
        if (Math.abs(center.y - doc.height / 2) < 8 / (fit * view.zoom))
          y += doc.height / 2 - center.y;
      }
      next = { ...l, transform: { ...l.transform, x, y } };
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
      const q = localPoint(p, l);
      const sx = Math.max(0.01, Math.min(100, (q.x / l.width) * l.transform.scaleX)),
        sy = Math.max(0.01, Math.min(100, (q.y / l.height) * l.transform.scaleY));
      next = { ...l, transform: { ...l.transform, scaleX: sx, scaleY: sy } };
    }
    if (g.type === "pen" || g.type === "anchor") {
      const a = localPoint(p, l),
        anchors = [...l.anchors],
        old = anchors[g.index!]!;
      if (g.type === "pen") {
        const dx = a.x - old.x,
          dy = a.y - old.y;
        anchors[g.index!] = { ...old, outgoing: a, incoming: { x: old.x - dx, y: old.y - dy } };
      } else if (g.part === "incoming" || g.part === "outgoing")
        anchors[g.index!] = { ...old, [g.part]: a };
      else {
        const dx = a.x - old.x,
          dy = a.y - old.y;
        anchors[g.index!] = {
          ...old,
          ...a,
          incoming: old.incoming ? { x: old.incoming.x + dx, y: old.incoming.y + dy } : undefined,
          outgoing: old.outgoing ? { x: old.outgoing.x + dx, y: old.outgoing.y + dy } : undefined,
        };
      }
      next = { ...l, anchors };
    }
    if (g.type === "paint") {
      const s = g.stroke!;
      s.points.push(localPoint(p, l));
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
        zoom: z,
        x: now.x - (initial.x - g.view.x) * q,
        y: now.y - (initial.y - g.view.y) * q,
      });
      return;
    }
    const next = update(screen);
    if (next) onTransient(next);
  };
  const end = (e: ReactPointer<HTMLDivElement>, cancel = false) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (!pointers.current.size) pinch.current = null;
      return;
    }
    const g = gesture.current;
    if (!g) return;
    if (!cancel) {
      const next = update({ x: e.clientX, y: e.clientY });
      if (next)
        onCommit(
          next,
          g.type === "paint"
            ? maskMode
              ? "Paint mask"
              : "Brush stroke"
            : g.type === "pen"
              ? "Add Bézier anchor"
              : `Edit ${g.type}`,
        );
    } else if (g.type === "selection") onSelection(g.selection);
    gesture.current = null;
    onTransient(null);
  };
  const poly = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <section className="pro-canvas-area" aria-label="Pro canvas workspace">
      <div className="pro-viewport-bar">
        <div>
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
            onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
          >
            <Scan />
          </Button>
        </div>
        <span role="status">
          {rendering ? "Rendering preview…" : `${doc.width} × ${doc.height} px`}
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
        onLostPointerCapture={(e) => {
          if (gesture.current) end(e, true);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContext(true);
        }}
        onDoubleClick={() => {
          if (polygon.length >= 3) {
            onSelection({
              ...selection,
              regions: [...selection.regions, { kind: "lasso", operation, points: polygon }],
            });
            setPolygon([]);
          }
        }}
      >
        <div
          ref={board}
          className="pro-artboard"
          data-grid={grid}
          style={
            {
              "--pro-grid-size": `${10 * fit}px`,
              width: doc.width * fit,
              height: doc.height * fit,
              transform: `translate(-50%,-50%) translate(${view.x}px,${view.y}px) scale(${view.zoom})`,
            } as React.CSSProperties
          }
        >
          <canvas ref={canvasRef} aria-label="Pro composite preview" />
          {!before && (
            <svg
              className="pro-overlays"
              viewBox={`0 0 ${doc.width} ${doc.height}`}
              aria-label="Pro selection overlays"
            >
              {snapping && gesture.current?.type === "move" ? (
                <g className="pro-center-guides">
                  <line x1={doc.width / 2} y1={0} x2={doc.width / 2} y2={doc.height} />
                  <line x1={0} y1={doc.height / 2} x2={doc.width} y2={doc.height / 2} />
                </g>
              ) : null}
              {selection.regions.map((r, i) =>
                r.kind === "rectangle" ? (
                  <rect
                    key={i}
                    x={Math.min(r.points[0]!.x, r.points.at(-1)!.x)}
                    y={Math.min(r.points[0]!.y, r.points.at(-1)!.y)}
                    width={Math.abs(r.points[0]!.x - r.points.at(-1)!.x)}
                    height={Math.abs(r.points[0]!.y - r.points.at(-1)!.y)}
                    className="pro-selection-outline"
                  />
                ) : r.kind === "ellipse" ? (
                  <ellipse
                    key={i}
                    cx={(r.points[0]!.x + r.points.at(-1)!.x) / 2}
                    cy={(r.points[0]!.y + r.points.at(-1)!.y) / 2}
                    rx={Math.abs(r.points[0]!.x - r.points.at(-1)!.x) / 2}
                    ry={Math.abs(r.points[0]!.y - r.points.at(-1)!.y) / 2}
                    className="pro-selection-outline"
                  />
                ) : (
                  <polygon key={i} points={poly(r.points)} className="pro-selection-outline" />
                ),
              )}
              {polygon.length > 0 && (
                <polyline points={poly(polygon)} className="pro-selection-outline" />
              )}
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
                    selected.anchors.map((a, i) => {
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
                            data-part="point"
                            cx={p.x}
                            cy={p.y}
                            r={6 / (fit * view.zoom)}
                            className="pro-anchor"
                          />
                        </g>
                      );
                    })}
                </>
              )}
            </svg>
          )}
        </div>
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
              s = Math.min(r.width / doc.width, r.height / doc.height),
              x = (e.clientX - r.left - (r.width - doc.width * s) / 2) / s,
              y = (e.clientY - r.top - (r.height - doc.height * s) / 2) / s;
            setView((v) => ({
              ...v,
              x: (doc.width / 2 - x) * fit * v.zoom,
              y: (doc.height / 2 - y) * fit * v.zoom,
            }));
          }}
        >
          <canvas ref={mini} width={160} height={110} />
        </button>
      </div>
      {polygon.length > 0 && (
        <Button
          variant="secondary"
          onClick={() => {
            if (polygon.length >= 3) {
              onSelection({
                ...selection,
                regions: [...selection.regions, { kind: "lasso", operation, points: polygon }],
              });
              setPolygon([]);
            }
          }}
        >
          Finish polygon selection
        </Button>
      )}
      {context && (
        <div className="pro-context" role="group" aria-label="Canvas context actions">
          <Button
            onClick={() => {
              setView({ zoom: 1, x: 0, y: 0 });
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
