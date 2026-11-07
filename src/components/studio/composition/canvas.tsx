import { BoundaryEditor } from "./boundary-editor";
import { fadeLine, hitFade, parts } from "@/lib/studio/composition/fade-edit";
import { inkObject } from "@/lib/studio/composition/ink-presets";
import { MANHWA_WORDS, INK_STYLES } from "@/lib/studio/composition/ink-catalog";
import type { CompositionPreset, CompositionObject } from "@/lib/studio/composition/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import {
  layout,
  createComposition,
  layerStack,
  transitionActive,
  type CompositionDocument,
  type PanelFrame,
} from "@/lib/studio/composition/model";
import type { Panel, Chapter } from "@/lib/studio/types";
import type { Controller } from "@/lib/studio/composition/controller";
import {
  renderRegion,
  RenderResources,
  compositionRenderBudget,
  objectBounds,
} from "@/lib/studio/composition/render";
import {
  objectFlags,
  pickCreative,
  rotateAboutCenter,
  reanchor,
} from "@/lib/studio/composition/geometry";
import { bubble as newBubble, BUBBLE_PRESETS } from "@/lib/studio/composition/bubble-presets";
import {
  nearestAttachment,
  baseOutline,
  outlineAt,
  type Bubble,
} from "@/lib/studio/composition/bubble";
import { applyMatrix, inverse } from "@/lib/studio/pro/transform";
import { deviceLimits } from "@/lib/studio/images";
import { objectMatrix } from "@/lib/studio/composition/geometry";
import { ChevronLeft, ChevronRight, Focus, X } from "lucide-react";
const TILE = 512;
function Tile({
  document,
  panels,
  y,
  height,
  outputWidth,
  resources,
  onError,
  onLoading,
}: {
  document: CompositionDocument;
  panels: Panel[];
  y: number;
  height: number;
  outputWidth: number;
  resources: RenderResources;
  onError: (message: string) => void;
  onLoading: (loading: boolean) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [display, setDisplay] = useState({ y, height });
  useEffect(() => {
    const abort = new AbortController();
    onLoading(true);
    if (ref.current) ref.current.dataset.renderStatus = "loading";
    void renderRegion(document, panels, { y, height }, outputWidth, resources, {
      signal: abort.signal,
    })
      .then((c) => {
        if (!abort.signal.aborted && ref.current) {
          ref.current.width = c.width;
          ref.current.height = c.height;
          ref.current.getContext("2d")!.drawImage(c, 0, 0);
          ref.current.dataset.renderStatus = "ready";
          setDisplay({ y, height });
          onLoading(false);
        }
        c.width = c.height = 0;
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          if (ref.current) ref.current.dataset.renderStatus = "error";
          onLoading(false);
          onError(error instanceof Error ? error.message : "Preview could not render.");
        }
      });
    return () => abort.abort();
  }, [document, panels, y, height, outputWidth, resources, onError, onLoading]);
  return (
    <canvas
      ref={ref}
      className="composition-tile"
      style={{ top: display.y, width: document.width, height: display.height }}
      aria-hidden="true"
    />
  );
}
export function CompositionCanvas({
  controller,
  chapter,
  panels,
  onError,
  assetPresets = [],
  onPlaceSuggestion,
}: {
  onPlaceSuggestion?: (index: number) => void;
  assetPresets?: CompositionPreset[];
  controller: Controller;
  chapter: Chapter;
  panels: Panel[];
  onError: (message: string) => void;
}) {
  const session = useStore(controller),
    d = session.history.present.document;
  const raw = useMemo(
    () => (session.before ? { ...createComposition(chapter, panels), width: d.width } : d),
    [chapter, panels, d, session.before],
  );
  const scene = useMemo(() => layout(raw, panels), [raw, panels]);
  const focus = scene.frames.find((f) => f.panel.id === session.focus);
  const origin = focus?.top ?? 0,
    height = focus ? focus.gapY - focus.top : scene.height;
  const viewport = useRef<HTMLDivElement>(null);
  const [resources, setResources] = useState<RenderResources | null>(null);
  const [view, setView] = useState({ top: 0, width: 700, height: 700 });
  const [context, setContext] = useState<PanelFrame | null>(null);
  const [rendering, setRendering] = useState(true);
  const onLoading = useCallback((loading: boolean) => setRendering(loading), []);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const fit = Math.max(0.05, (view.width - 32) / d.width),
    scale = fit * session.zoom;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{
    kind: "object" | "pan" | "space" | "fade";
    id: string;
    x: number;
    y: number;
    startX: number;
    startY: number;
    slot?: "top" | "bottom" | "after" | "opening" | "ending";
    value: number;
    group: string;
    panelId?: string;
    frame?: PanelFrame;
    others?: { id: string; x: number; y: number }[];
  } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const pinch = useRef<{ distance: number; zoom: number; anchorY: number } | null>(null),
    tap = useRef({ time: 0, id: "" }),
    longpress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const resources = new RenderResources();
    setResources(resources);
    return () => resources.clear();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let pending = 0;
    const update = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() =>
        setView({
          top: element.scrollTop,
          width: element.clientWidth,
          height: element.clientHeight,
        }),
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
      cancelAnimationFrame(pending);
    };
  }, []);
  const pendingPanelTap = useRef<string | null>(null);
  const previousFocus = useRef<string | null>(null);
  useEffect(() => {
    if (previousFocus.current === session.focus) return;
    if (viewport.current)
      viewport.current.scrollTop = session.focus
        ? 0
        : (scene.frames.find((f) => f.panel.id === previousFocus.current)?.top ?? 0) * scale;
    previousFocus.current = session.focus;
  }, [session.focus, scene.frames, scale]);
  useEffect(() => {
    // The reader starts at the opening, independently of the editor's scroll
    // position. Retaining CSS scroll pixels after fitting to a phone width can
    // otherwise land in an ending extension with no artwork in view.
    if (session.preview && viewport.current) viewport.current.scrollTop = 0;
  }, [session.preview]);
  const budget = useMemo(() => compositionRenderBudget(raw, panels, scene), [raw, panels, scene]);
  const a = d.width * (view.height / scale + budget.padding * 2),
    b = d.width * TILE * 3,
    area = deviceLimits().maxArea / budget.planes;
  const safeScale = (2 * area) / (b + Math.sqrt(b * b + 4 * a * area));
  const outputWidth = Math.max(
      1,
      Math.floor(
        d.width * Math.min(2, scale * Math.min(2, window.devicePixelRatio || 1), safeScale * 0.9),
      ),
    ),
    renderScale = outputWidth / d.width,
    tileHeight = TILE / renderScale;
  const from = Math.max(0, Math.floor(view.top / scale / tileHeight) - 1),
    to = Math.min(
      Math.ceil(height / tileHeight),
      Math.ceil((view.top + view.height) / scale / tileHeight) + 1,
    );
  const point = (event: { clientX: number; clientY: number }) => {
    const rect = viewport.current!.querySelector(".composition-scene")!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale + origin,
    };
  };
  const selected =
    session.selection?.kind === "object"
      ? d.objects.find((o) => o.id === session.selection?.id)
      : null;
  const selectedBounds = selected ? objectBounds(selected, scene.frames, d.objects) : null;
  const fadePanelId = session.selection?.kind === "fade" ? session.selection.panelId : undefined;
  const selectedFade = scene.frames.find((f) => f.panel.id === fadePanelId);
  const fade = selectedFade?.settings.fades.find((f) => f.id === session.selection?.id);
  /** Panel whose fades show outlines and can be clicked: the selected fade's or panel's. */
  const activeFrame =
    selectedFade ??
    (session.selection?.kind === "panel"
      ? scene.frames.find((f) => f.panel.id === session.selection?.id)
      : undefined);
  const updateSpace = (
    id: string,
    slot: "top" | "bottom" | "after" | "opening" | "ending",
    value: number,
    group: string,
  ) =>
    controller.change((doc) => {
      const height = Math.max(0, Math.min(100000, Math.round(value)));
      if (slot === "opening" || slot === "ending")
        return { ...doc, [slot]: { ...doc[slot], height } };
      const p = doc.panels[id];
      return { ...doc, panels: { ...doc.panels, [id]: { ...p, [slot]: { ...p[slot], height } } } };
    }, group);
  const selectPanel = (frame: PanelFrame, append = false) => {
    controller.setState((s) => ({
      selection: { kind: "panel", id: frame.panel.id },
      selectedPanels: append
        ? s.selectedPanels.includes(frame.panel.id)
          ? s.selectedPanels.filter((id) => id !== frame.panel.id)
          : [...s.selectedPanels, frame.panel.id]
        : [frame.panel.id],
    }));
  };
  const handleSize = (coarse ? 44 : 14) / scale;
  const toLocal = (o: CompositionObject, world: { x: number; y: number }) => {
    const doc = controller.getState().history.present.document,
      frames = layout(doc, panels).frames;
    return applyMatrix(inverse(objectMatrix(o, frames, doc.objects)), world);
  };
  const toWorld = (o: CompositionObject, local: { x: number; y: number }) =>
    applyMatrix(objectMatrix(o, scene.frames, d.objects), local);
  /** Pointer-captured handle drag; one history entry per gesture. */
  const handleDrag = (
    event: React.PointerEvent<HTMLElement>,
    move: (world: { x: number; y: number }, e: PointerEvent, group: string) => void,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    const target = event.currentTarget,
      group = `handle-${Date.now()}`;
    target.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => move(point(e), e, group);
    const up = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", up, { once: true });
    target.addEventListener("pointercancel", up, { once: true });
  };
  const patchObject = (
    id: string,
    fn: (o: CompositionObject) => CompositionObject,
    group: string,
  ) =>
    controller.change(
      (doc) => ({ ...doc, objects: doc.objects.map((o) => (o.id === id ? fn(o) : o)) }),
      group,
    );
  const selectedLocked = selected ? objectFlags(selected, d.objects).locked : true;
  const ownerFrame = selected?.owner
    ? scene.frames.find((f) => f.panel.id === selected.owner)
    : undefined;
  const editingBubble = d.objects.find((o): o is Bubble => o.id === editing && o.kind === "bubble");
  const focusNeighbor = (direction: -1 | 1) => {
    const id = panels[panels.findIndex((p) => p.id === focus?.panel.id) + direction]?.id;
    if (id)
      controller.setState({ focus: id, selectedPanels: [id], selection: { kind: "panel", id } });
  };
  return (
    <div className={`composition-center ${session.preview ? "is-reading" : ""}`}>
      {focus && !session.preview && (
        <div className="composition-focus-bar">
          <Button variant="ghost" onClick={() => controller.setState({ focus: null })}>
            <ChevronLeft /> Return to Chapter
          </Button>
          <span>
            {focus.panel.name} · {focus.settings.snapshot?.width ?? focus.panel.width} ×{" "}
            {focus.settings.snapshot?.height ?? focus.panel.height}
            {focus.settings.snapshot ? " · native draft" : ""}
          </span>
          <Button
            variant="ghost"
            disabled={panels[0]?.id === focus.panel.id}
            aria-label="Previous panel"
            onClick={() => focusNeighbor(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            disabled={panels.at(-1)?.id === focus.panel.id}
            aria-label="Next panel"
            onClick={() => focusNeighbor(1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
      <div
        ref={viewport}
        className="composition-viewport"
        aria-label={session.preview ? "Reading simulator" : "Chapter composition canvas"}
        tabIndex={0}
        onContextMenu={(event) => {
          if (session.preview) return;
          event.preventDefault();
          const p = point(event),
            frame = scene.frames.find((f) => p.y >= f.top && p.y <= f.end);
          if (frame) {
            selectPanel(frame);
            setContext(frame);
          }
        }}
        onDoubleClick={(event) => {
          if (session.preview) return;
          const hit = pickCreative(
            d,
            scene.frames,
            point(event),
            layerStack(
              d,
              panels.map((p) => p.id),
            ),
            -1,
          );
          if (hit?.kind === "bubble" && !objectFlags(hit, d.objects).locked) {
            controller.setState({ selection: { kind: "object", id: hit.id } });
            setEditing(hit.id);
            return;
          }
          const p = point(event),
            frame = scene.frames.find((f) => p.y >= f.imageY && p.y <= f.bottomY);
          if (frame) {
            selectPanel(frame);
            controller.setState({ focus: frame.panel.id });
          }
        }}
        onDragOver={(e) => {
          if (
            !session.preview &&
            !session.before &&
            e.dataTransfer.types.includes("application/x-inkstrip-composition")
          )
            e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (session.preview || session.before || session.blocked) return;
          try {
            const payload = JSON.parse(
                e.dataTransfer.getData("application/x-inkstrip-composition"),
              ),
              p = point(e),
              frame = scene.frames.find((f) => p.y >= f.top && p.y < f.gapY);
            let object: CompositionObject | undefined;
            if (
              payload.kind === "manhwa" &&
              Number.isInteger(payload.index) &&
              MANHWA_WORDS[payload.index] &&
              INK_STYLES.includes(payload.style)
            )
              object = inkObject(
                MANHWA_WORDS[payload.index][payload.english ? 2 : 1],
                payload.style,
              );
            if (payload.kind === "bubble") {
              const builtIn = BUBBLE_PRESETS.find((x) => x.name === payload.preset),
                saved = assetPresets.find((x) => x.category === "bubble" && x.id === payload.id);
              if (builtIn) object = newBubble(builtIn);
              else if (saved)
                object = { ...structuredClone(saved.value), id: crypto.randomUUID() } as Bubble;
              if (object) object = { ...object, x: p.x - object.width / 2 };
            }
            if (payload.kind === "asset") {
              const preset = assetPresets.find(
                (x) => x.category === "asset" && x.id === payload.id,
              );
              if (preset) object = structuredClone(preset.value) as CompositionObject;
            }
            if (object) {
              const next = {
                ...object,
                id: crypto.randomUUID(),
                owner: frame?.panel.id,
                parentId: undefined,
                x: object.kind === "bubble" ? object.x : p.x,
                y: p.y - (frame?.imageY ?? 0) - (object.kind === "bubble" ? object.height / 2 : 0),
              };
              controller.change((d) => ({ ...d, objects: [...d.objects, next] }));
              controller.select({ kind: "object", id: next.id });
            }
          } catch {
            onError("This artwork could not be dropped. Try clicking its gallery thumbnail.");
          }
        }}
        onPointerDown={(event) => {
          if ((event.target as Element).closest("button,input,textarea") || event.button !== 0)
            return;
          pendingPanelTap.current = null;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          event.currentTarget.setPointerCapture(event.pointerId);
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinch.current = {
              distance: Math.hypot(a.x - b.x, a.y - b.y),
              zoom: session.zoom,
              anchorY: point({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }).y,
            };
            drag.current = null;
            clearTimeout(longpress.current);
            return;
          }
          const p = point(event);
          if (!session.preview && !session.before) {
            const stack = layerStack(
              d,
              panels.map((p) => p.id),
            );
            const source = scene.frames.find(
              (f) =>
                p.y >= f.imageY && p.y < f.bottomY && f.settings.visible && f.settings.opacity > 0,
            );
            const spacing = scene.spaces.find(
              (s) =>
                p.y >= s.y &&
                p.y < s.y + s.height &&
                s.settings.visible &&
                s.settings.opacity > 0 &&
                s.settings.fill !== "transparent",
            );
            const transition = [...d.transitions]
              .filter((t) => t.visible && t.opacity > 0 && transitionActive(t, panels))
              .filter((t) => {
                const a = scene.frames.find((f) => f.panel.id === t.a)!,
                  b = scene.frames.find((f) => f.panel.id === t.b)!,
                  center = (a.bottomY + b.imageY) / 2;
                return Math.abs(p.y - center) <= t.height / 2;
              })
              .sort(
                (a, b) => stack.indexOf(`transition:${b.id}`) - stack.indexOf(`transition:${a.id}`),
              )[0];
            const structuralRank = Math.max(
              source ? stack.indexOf(`source:${source.panel.id}`) : -1,
              spacing ? stack.indexOf(`space:${spacing.key}`) : -1,
              transition ? stack.indexOf(`transition:${transition.id}`) : -1,
            );
            const object = pickCreative(d, scene.frames, p, stack, structuralRank);
            if (object) {
              const locked = objectFlags(object, d.objects).locked;
              const current = controller.getState(),
                previous = current.selection?.kind === "object" ? current.selection.id : undefined;
              let multi = current.multi ?? [];
              if (event.shiftKey && previous && previous !== object.id) {
                multi = multi.includes(object.id)
                  ? multi.filter((id) => id !== object.id)
                  : [...new Set([...multi, previous, object.id])];
              } else if (!multi.includes(object.id)) multi = [];
              if (locked) {
                controller.setState({ selection: { kind: "object", id: object.id }, multi });
                drag.current = null;
                return;
              }
              controller.setState({ selection: { kind: "object", id: object.id }, multi });
              const others = multi
                .filter((id) => id !== object.id)
                .map((id) => d.objects.find((o) => o.id === id))
                .filter(
                  (o): o is CompositionObject =>
                    !!o && !o.parentId && !objectFlags(o, d.objects).locked,
                )
                .map((o) => ({ id: o.id, x: o.x, y: o.y }));
              drag.current = {
                others,
                kind: "object",
                id: object.id,
                x: p.x,
                y: p.y,
                startX: object.x,
                startY: object.y,
                value: 0,
                group: `pointer-${event.pointerId}-${Date.now()}`,
              };
              return;
            }
            if (controller.getState().multi?.length) controller.setState({ multi: [] });
            if (activeFrame && !activeFrame.settings.locked) {
              const local = { x: p.x, y: p.y - activeFrame.imageY },
                hits = activeFrame.settings.fades.filter(
                  (x) => !!hitFade(x, local, d.width, activeFrame.imageHeight, 8 / scale),
                );
              if (hits.length) {
                // Repeated clicks cycle through overlapping fades, topmost first.
                const order = [...hits].reverse(),
                  current = order.findIndex((x) => x.id === session.selection?.id),
                  next = order[(current + 1) % order.length]!;
                if (next.id !== session.selection?.id) {
                  controller.select({ kind: "fade", id: next.id, panelId: activeFrame.panel.id });
                  drag.current = null;
                  return;
                }
              }
            }
            const region = scene.spaces.find((s) => p.y >= s.y && p.y < s.y + s.height);
            if (transition && stack.indexOf(`transition:${transition.id}`) === structuralRank) {
              controller.setState({
                selection: { kind: "transition", id: transition.id },
                tool: "Transitions",
              });
            } else if (region) {
              controller.setState({
                selection: { kind: "space", id: region.panelId ?? region.slot, slot: region.slot },
              });
              controller.setState({ tool: "Spacing" });
            } else {
              const frame = scene.frames.find((f) => p.y >= f.imageY && p.y < f.bottomY);
              if (frame) {
                selectPanel(frame, event.shiftKey);
                if (event.pointerType === "touch") {
                  pendingPanelTap.current = frame.panel.id;
                  longpress.current = setTimeout(() => setContext(frame), 500);
                }
              }
            }
          }
          drag.current = {
            kind: "pan",
            id: "",
            x: event.clientX,
            y: event.clientY,
            startX: viewport.current!.scrollLeft,
            startY: viewport.current!.scrollTop,
            value: 0,
            group: "",
          };
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size >= 2 && pinch.current) {
            const [a, b] = [...pointers.current.values()],
              ratio = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.distance);
            const zoom = Math.max(0.15, Math.min(5, pinch.current.zoom * ratio)),
              anchor = pinch.current.anchorY,
              center = (a.y + b.y) / 2 - viewport.current!.getBoundingClientRect().top - 16;
            controller.setState({ zoom });
            requestAnimationFrame(() => {
              if (viewport.current)
                viewport.current.scrollTop = (anchor - origin) * fit * zoom - center;
            });
            return;
          }
          const start = drag.current;
          if (!start) return;
          if (start.kind === "pan") {
            const dx = event.clientX - start.x,
              dy = event.clientY - start.y;
            if (Math.hypot(dx, dy) > 5) {
              clearTimeout(longpress.current);
              viewport.current!.scrollTop = start.startY - dy;
              viewport.current!.scrollLeft = start.startX - dx;
            }
            return;
          }
          const p = point(event);
          let dx = p.x - start.x,
            dy = p.y - start.y;
          const moving =
              start.kind === "object" ? d.objects.find((o) => o.id === start.id) : undefined,
            parent = d.objects.find((o) => o.id === moving?.parentId);
          if (parent) {
            const matrix = inverse(objectMatrix(parent, scene.frames, d.objects)),
              from = applyMatrix(matrix, { x: start.x, y: start.y }),
              to = applyMatrix(matrix, p);
            dx = to.x - from.x;
            dy = to.y - from.y;
          }
          if (start.kind === "space") {
            updateSpace(start.id, start.slot!, start.value + dy, start.group);
            return;
          }
          if (start.kind === "fade") {
            const f = start.frame!,
              type = d.panels[f.panel.id].fades.find((x) => x.id === start.id)!;
            const length =
              type.edges[0] === "top"
                ? p.y - f.imageY
                : type.edges[0] === "left"
                  ? p.x
                  : type.edges[0] === "right"
                    ? d.width - p.x
                    : f.bottomY - p.y;
            controller.change(
              (doc) => ({
                ...doc,
                panels: {
                  ...doc.panels,
                  [f.panel.id]: {
                    ...doc.panels[f.panel.id],
                    fades: doc.panels[f.panel.id].fades.map((x) =>
                      x.id === start.id ? { ...x, length: Math.max(1, Math.round(length)) } : x,
                    ),
                  },
                },
              }),
              start.group,
            );
            return;
          }
          let shift: { x: number; y: number } | null = null;
          controller.change(
            (doc) => ({
              ...doc,
              objects: doc.objects.map((o) => {
                if (o.id !== start.id) return o;
                let x = start.startX + dx,
                  y = start.startY + dy;
                if (!o.parentId && controller.getState().snap !== false) {
                  const bounds = objectBounds(o, scene.frames, doc.objects),
                    offsetX = bounds.x - o.x,
                    ownerY = o.owner
                      ? (scene.frames.find((f) => f.panel.id === o.owner)?.imageY ?? 0)
                      : 0,
                    offsetY = bounds.y - o.y - ownerY;
                  const near = doc.objects
                    .filter(
                      (n) =>
                        n.id !== o.id &&
                        !n.parentId &&
                        n.visible &&
                        !start.others?.some((x) => x.id === n.id),
                    )
                    .slice(0, 400)
                    .map((n) => objectBounds(n, scene.frames, doc.objects))
                    .filter((n) => Math.abs(n.y - bounds.y) < 3000);
                  for (const guide of [
                    0,
                    d.width / 2 - bounds.width / 2,
                    d.width - bounds.width,
                    ...near.flatMap((n) => [
                      n.x,
                      n.x + n.width - bounds.width,
                      n.x + n.width / 2 - bounds.width / 2,
                    ]),
                  ])
                    if (Math.abs(x + offsetX - guide) < 6 / scale) x = guide - offsetX;
                  for (const guide of [
                    0,
                    scene.height,
                    ...scene.frames.flatMap((f) => [f.imageY, f.bottomY, f.top, f.gapY]),
                    ...near.flatMap((n) => [n.y, n.y + n.height]),
                  ])
                    for (const edge of [0, bounds.height / 2, bounds.height])
                      if (Math.abs(y + ownerY + offsetY + edge - guide) < 6 / scale)
                        y = guide - ownerY - offsetY - edge;
                }
                shift = { x: Math.round(x) - start.startX, y: Math.round(y) - start.startY };
                return { ...o, x: Math.round(x), y: Math.round(y) };
              }),
            }),
            start.group,
          );
          if (start.others?.length && shift) {
            const delta = shift as { x: number; y: number };
            controller.change(
              (doc) => ({
                ...doc,
                objects: doc.objects.map((o) => {
                  const origin = start.others!.find((x) => x.id === o.id);
                  return origin ? { ...o, x: origin.x + delta.x, y: origin.y + delta.y } : o;
                }),
              }),
              start.group,
            );
          }
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          if (start?.kind === "object") {
            const ids = new Set([start.id, ...(start.others ?? []).map((x) => x.id)]);
            controller.change((doc) => {
              const frames = layout(doc, panels).frames;
              let changed = false;
              const objects = doc.objects.map((o) => {
                if (!ids.has(o.id) || o.kind !== "bubble") return o;
                const next = reanchor(o, frames, doc.objects);
                if (next !== o) changed = true;
                return next;
              });
              return changed ? { ...doc, objects } : doc;
            }, start.group);
          }
          if (start && pointers.current.size === 1 && !session.preview) {
            const p = point(event),
              distance =
                start.kind !== "pan"
                  ? Math.hypot(p.x - start.x, p.y - start.y) * scale
                  : Math.hypot(event.clientX - start.x, event.clientY - start.y);
            if (
              distance < 6 &&
              ["space", "object", "fade", "transition"].includes(
                controller.getState().selection?.kind ?? "",
              )
            )
              controller.setState({ mobileProperties: true });
            if (
              distance < 6 &&
              event.pointerType === "touch" &&
              pendingPanelTap.current &&
              !pinch.current
            ) {
              const id = pendingPanelTap.current;
              if (Date.now() - tap.current.time < 300 && tap.current.id === id)
                controller.setState({ focus: id });
              tap.current = { time: Date.now(), id };
            }
          }
          pendingPanelTap.current = null;
          pointers.current.delete(event.pointerId);
          drag.current = null;
          pinch.current = null;
          clearTimeout(longpress.current);
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          drag.current = null;
          pinch.current = null;
          clearTimeout(longpress.current);
        }}
      >
        <div
          className="composition-scene"
          style={{ width: d.width * scale, height: height * scale }}
        >
          <div
            className="composition-world"
            style={{ width: d.width, height, transform: `scale(${scale})` }}
          >
            <div className="composition-render-offset" style={{ top: -origin }}>
              {resources && (
                <Tile
                  document={raw}
                  panels={panels}
                  y={origin + from * tileHeight}
                  height={Math.max(
                    1,
                    Math.min((to - from) * tileHeight, height - from * tileHeight),
                  )}
                  outputWidth={outputWidth}
                  resources={resources}
                  onError={onError}
                  onLoading={onLoading}
                />
              )}
            </div>
            {!session.preview &&
              !session.before &&
              fade?.boundary &&
              selectedFade &&
              !fade.locked &&
              !selectedFade.settings.locked && (
                <BoundaryEditor
                  f={fade}
                  panelId={selectedFade.panel.id}
                  width={d.width}
                  height={selectedFade.imageHeight}
                  top={selectedFade.imageY - origin}
                  scale={scale}
                  controller={controller}
                  drawing={!!session.drawBoundary}
                  coarse={coarse}
                />
              )}
            {!session.preview &&
              !session.before &&
              !session.drawBoundary &&
              activeFrame &&
              activeFrame.settings.fades
                .filter(
                  (x) =>
                    x.boundary &&
                    x.visible &&
                    x.id !==
                      (fade?.boundary && !fade.locked && !activeFrame.settings.locked
                        ? fade.id
                        : ""),
                )
                .map((x) => {
                  const line = parts(x).map((part) =>
                    fadeLine(x, part, 0.5, d.width, activeFrame.imageHeight, 48),
                  );
                  const first = line[0]![0]!;
                  const select = () =>
                    controller.select({ kind: "fade", id: x.id, panelId: activeFrame.panel.id });
                  return (
                    <div key={x.id}>
                      <svg
                        className="composition-fade-outline"
                        style={{
                          top: activeFrame.imageY - origin,
                          width: d.width,
                          height: activeFrame.imageHeight,
                        }}
                        viewBox={`0 0 ${d.width} ${activeFrame.imageHeight}`}
                        aria-hidden="true"
                      >
                        {line.map((pts, i) => (
                          <path
                            key={i}
                            d={pts.map((q, j) => `${j ? "L" : "M"}${q.x},${q.y}`).join(" ")}
                            fill="none"
                            stroke={x.id === fade?.id ? "var(--color-accent)" : "#38d6e8"}
                            strokeOpacity={0.75}
                            strokeWidth={(coarse ? 3 : 1.5) / scale}
                            strokeDasharray={`${4 / scale} ${4 / scale}`}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              select();
                            }}
                          />
                        ))}
                      </svg>
                      <button
                        className="composition-fade-chip"
                        aria-label={`Select fade ${x.name}`}
                        style={{
                          left: Math.max(0, first.x) + 6 / scale,
                          top: activeFrame.imageY - origin + first.y - (coarse ? 30 : 22) / scale,
                          fontSize: 11 / scale,
                          padding: `${(coarse ? 8 : 3) / scale}px ${8 / scale}px`,
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={select}
                      >
                        {x.name}
                        {x.locked ? " · locked" : ""}
                      </button>
                    </div>
                  );
                })}
            {!session.preview && !session.before && (
              <>
                {scene.frames
                  .filter(
                    (f) =>
                      f.bottomY >= origin + view.top / scale - TILE &&
                      f.top <= origin + (view.top + view.height) / scale + TILE,
                  )
                  .map((f) => (
                    <div
                      key={f.panel.id}
                      className={`composition-panel-outline ${session.selectedPanels.includes(f.panel.id) ? "is-selected" : ""}`}
                      style={{ top: f.imageY - origin, width: d.width, height: f.imageHeight }}
                    >
                      <span className="composition-panel-label">
                        {panels.indexOf(f.panel) + 1} · {f.panel.name}
                      </span>
                    </div>
                  ))}
                {scene.spaces
                  .filter(
                    (s) =>
                      s.y + s.height >= origin + view.top / scale &&
                      s.y <= origin + (view.top + view.height) / scale,
                  )
                  .map((s) => (
                    <button
                      key={s.key}
                      className="composition-gap-handle"
                      style={{
                        top: s.y + s.height - origin - (coarse ? 22 / scale : 12),
                        width: d.width,
                        minHeight: coarse ? 44 / scale : undefined,
                        fontSize: coarse ? 12 / scale : undefined,
                        lineHeight: coarse ? `${44 / scale}px` : undefined,
                      }}
                      aria-label={`Resize ${s.slot} ${s.neighbor?.panel.name ?? "chapter"} spacing`}
                      title={`${s.slot}: ${s.height}px — drag to resize`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (s.settings.locked) return;
                        const p = point(event);
                        pointers.current.set(event.pointerId, {
                          x: event.clientX,
                          y: event.clientY,
                        });
                        viewport.current!.setPointerCapture(event.pointerId);
                        controller.setState({
                          selection: { kind: "space", id: s.panelId ?? s.slot, slot: s.slot },
                        });
                        controller.setState({ tool: "Spacing" });
                        drag.current = {
                          kind: "space",
                          id: s.panelId ?? s.slot,
                          slot: s.slot,
                          value: s.height,
                          x: p.x,
                          y: p.y,
                          startX: 0,
                          startY: 0,
                          group: `space-${Date.now()}`,
                        };
                      }}
                    >
                      {s.slot} · {s.height} px
                    </button>
                  ))}
                {selectedBounds &&
                  [0, d.width / 2, d.width]
                    .filter((x) =>
                      [
                        selectedBounds.x,
                        selectedBounds.x + selectedBounds.width / 2,
                        selectedBounds.x + selectedBounds.width,
                      ].some((edge) => Math.abs(edge - x) < 6 / scale),
                    )
                    .map((x) => (
                      <div
                        key={`guide-x-${x}`}
                        className="composition-guide is-vertical"
                        style={{
                          left: x,
                          top: view.top / scale,
                          height: view.height / scale,
                          borderLeftWidth: 1 / scale,
                        }}
                      />
                    ))}
                {selectedBounds &&
                  [
                    ...new Set([
                      0,
                      scene.height,
                      ...scene.frames.flatMap((f) => [f.imageY, f.bottomY]),
                    ]),
                  ]
                    .filter((y) =>
                      [
                        selectedBounds.y,
                        selectedBounds.y + selectedBounds.height / 2,
                        selectedBounds.y + selectedBounds.height,
                      ].some((edge) => Math.abs(edge - y) < 6 / scale),
                    )
                    .map((y) => (
                      <div
                        key={`guide-y-${y}`}
                        className="composition-guide is-horizontal"
                        style={{
                          left: 0,
                          top: y - origin,
                          width: d.width,
                          borderTopWidth: 1 / scale,
                        }}
                      />
                    ))}
                {selectedBounds && selected && (
                  <div
                    className="composition-object-outline"
                    style={{
                      left: selectedBounds.x,
                      top: selectedBounds.y - origin,
                      width: selectedBounds.width,
                      height: selectedBounds.height,
                    }}
                  >
                    <span>
                      {selected.name} · {Math.round(selectedBounds.width)} ×{" "}
                      {Math.round(selectedBounds.height)}
                      {ownerFrame &&
                        ` · ${Math.round(selectedBounds.y - ownerFrame.imageY)} px from panel top`}
                    </span>
                    {selected.kind !== "bubble" && (
                      <button
                        aria-label="Resize selected effect"
                        className="composition-scale-handle"
                        style={
                          coarse
                            ? {
                                width: 44 / scale,
                                height: 44 / scale,
                                right: -22 / scale,
                                bottom: -22 / scale,
                              }
                            : undefined
                        }
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          const startX = event.clientX,
                            startScale = selected.scaleX;
                          event.currentTarget.setPointerCapture(event.pointerId);
                          const button = event.currentTarget,
                            group = `scale-${Date.now()}`;
                          const move = (e: PointerEvent) =>
                            controller.change(
                              (doc) => ({
                                ...doc,
                                objects: doc.objects.map((o) =>
                                  o.id === selected.id
                                    ? {
                                        ...o,
                                        scaleX: Math.max(
                                          0.05,
                                          Math.min(
                                            20,
                                            startScale +
                                              (e.clientX - startX) /
                                                scale /
                                                Math.max(1, selected.width),
                                          ),
                                        ),
                                        scaleY: Math.max(
                                          0.05,
                                          Math.min(
                                            20,
                                            startScale +
                                              (e.clientX - startX) /
                                                scale /
                                                Math.max(1, selected.width),
                                          ),
                                        ),
                                      }
                                    : o,
                                ),
                              }),
                              group,
                            );
                          const up = () => {
                            button.removeEventListener("pointermove", move);
                            button.removeEventListener("pointerup", up);
                            button.removeEventListener("pointercancel", up);
                          };
                          button.addEventListener("pointermove", move);
                          button.addEventListener("pointerup", up, { once: true });
                          button.addEventListener("pointercancel", up, { once: true });
                        }}
                      />
                    )}
                  </div>
                )}
                {selected && selectedBounds && !selectedLocked && (
                  <button
                    className="composition-handle composition-rotate-handle"
                    aria-label="Rotate selected layer"
                    title="Drag to rotate · Shift snaps to 15°"
                    style={{
                      left: selectedBounds.x + selectedBounds.width / 2 - handleSize / 2,
                      top: selectedBounds.y - origin - handleSize - 24 / scale,
                      width: handleSize,
                      height: handleSize,
                    }}
                    onPointerDown={(event) => {
                      const o = selected,
                        center = toWorld(o, { x: o.width / 2, y: o.height / 2 }),
                        start = point(event),
                        startAngle = Math.atan2(start.x - center.x, -(start.y - center.y));
                      handleDrag(event, (p, e, group) => {
                        let angle =
                          o.rotation +
                          ((Math.atan2(p.x - center.x, -(p.y - center.y)) - startAngle) * 180) /
                            Math.PI;
                        angle = ((((angle + 180) % 360) + 360) % 360) - 180;
                        if (e.shiftKey) angle = Math.round(angle / 15) * 15;
                        else if (Math.abs(angle - Math.round(angle / 45) * 45) < 3)
                          angle = Math.round(angle / 45) * 45;
                        const doc = controller.getState().history.present.document;
                        patchObject(
                          o.id,
                          (x) =>
                            rotateAboutCenter(
                              x,
                              Math.round(angle * 10) / 10,
                              layout(doc, panels).frames,
                              doc.objects,
                            ),
                          group,
                        );
                      });
                    }}
                  />
                )}
                {selected?.kind === "bubble" &&
                  !selectedLocked &&
                  (() => {
                    const b = selected,
                      corner = toWorld(b, { x: b.width, y: b.height }),
                      outline = baseOutline(b);
                    return (
                      <>
                        <button
                          className="composition-handle composition-bubble-resize"
                          aria-label="Resize speech bubble"
                          title="Drag to resize; text re-wraps"
                          style={{
                            left: corner.x - handleSize / 2,
                            top: corner.y - origin - handleSize / 2,
                            width: handleSize,
                            height: handleSize,
                          }}
                          onPointerDown={(event) =>
                            handleDrag(event, (p, _e, group) => {
                              const local = toLocal(b, p);
                              patchObject(
                                b.id,
                                (x) => ({
                                  ...x,
                                  width: Math.max(40, Math.min(100000, Math.round(local.x))),
                                  height: Math.max(30, Math.min(100000, Math.round(local.y))),
                                }),
                                group,
                              );
                            })
                          }
                        />
                        {b.tails.map((t, i) => {
                          const tip = toWorld(b, t.tip),
                            base = outline.length
                              ? toWorld(b, outlineAt(outline, t.attachment))
                              : null;
                          const patchTail = (
                            patch: (tail: Bubble["tails"][number]) => Bubble["tails"][number],
                            group: string,
                          ) =>
                            patchObject(
                              b.id,
                              (x) =>
                                x.kind === "bubble"
                                  ? {
                                      ...x,
                                      tails: x.tails.map((y) => (y.id === t.id ? patch(y) : y)),
                                    }
                                  : x,
                              group,
                            );
                          return (
                            <span key={t.id}>
                              <button
                                className="composition-handle composition-tail-tip"
                                aria-label={`Move tail ${i + 1} tip`}
                                style={{
                                  left: tip.x - handleSize / 2,
                                  top: tip.y - origin - handleSize / 2,
                                  width: handleSize,
                                  height: handleSize,
                                }}
                                onPointerDown={(event) =>
                                  handleDrag(event, (p, _e, group) => {
                                    const local = toLocal(b, p);
                                    patchTail(
                                      (y) => ({
                                        ...y,
                                        tip: { x: Math.round(local.x), y: Math.round(local.y) },
                                      }),
                                      group,
                                    );
                                  })
                                }
                              />
                              {base && (
                                <button
                                  className="composition-handle composition-tail-base"
                                  aria-label={`Move tail ${i + 1} anchor`}
                                  style={{
                                    left: base.x - handleSize / 2,
                                    top: base.y - origin - handleSize / 2,
                                    width: handleSize,
                                    height: handleSize,
                                  }}
                                  onPointerDown={(event) =>
                                    handleDrag(event, (p, _e, group) => {
                                      const attachment =
                                        Math.round(nearestAttachment(b, toLocal(b, p)) * 1000) /
                                        1000;
                                      patchTail((y) => ({ ...y, attachment }), group);
                                    })
                                  }
                                />
                              )}
                            </span>
                          );
                        })}
                      </>
                    );
                  })()}
                {(session.multi ?? [])
                  .filter((id) => id !== selected?.id)
                  .map((id) => d.objects.find((o) => o.id === id))
                  .filter((o): o is CompositionObject => !!o)
                  .map((o) => {
                    const b = objectBounds(o, scene.frames, d.objects);
                    return (
                      <div
                        key={o.id}
                        className="composition-object-outline is-secondary"
                        style={{ left: b.x, top: b.y - origin, width: b.width, height: b.height }}
                      />
                    );
                  })}
                {(session.suggestions ?? []).map((r, i) => (
                  <div
                    key={`suggestion-${i}`}
                    className="composition-suggestion"
                    style={{
                      left: r.x,
                      top: r.y - origin,
                      width: r.width,
                      height: r.height,
                      zIndex: 20 - i,
                    }}
                  >
                    <button
                      style={{ fontSize: 13 / scale, padding: `${4 / scale}px ${8 / scale}px` }}
                      aria-label={`Place suggested bubble ${i + 1}`}
                      onClick={() => onPlaceSuggestion?.(i)}
                    >
                      {i + 1}. Place here · {r.reason}
                    </button>
                  </div>
                ))}
                {editingBubble && (
                  <textarea
                    className="composition-inline-text"
                    aria-label="Edit bubble text"
                    dir="auto"
                    autoFocus
                    value={editingBubble.text}
                    style={{
                      ...(() => {
                        const b = objectBounds(editingBubble, scene.frames, d.objects);
                        return { left: b.x, top: b.y - origin, width: b.width, height: b.height };
                      })(),
                      fontSize: editingBubble.size * editingBubble.scaleY,
                      fontFamily: `"${editingBubble.font}", sans-serif`,
                      textAlign: editingBubble.align,
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      patchObject(
                        editingBubble.id,
                        (x) => ({ ...x, text: e.target.value.slice(0, 10000) }),
                        `object-${editingBubble.id}-text`,
                      )
                    }
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                  />
                )}
                {selectedFade && fade && !fade.boundary && (
                  <button
                    className="composition-fade-handle"
                    aria-label="Drag fade length"
                    style={{
                      top:
                        (fade.edges[0] === "top"
                          ? selectedFade.imageY + fade.length
                          : selectedFade.bottomY - fade.length) - origin,
                      width: d.width,
                      minHeight: coarse ? 44 / scale : undefined,
                      fontSize: coarse ? 12 / scale : undefined,
                      lineHeight: coarse ? `${44 / scale}px` : undefined,
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (fade.locked) return;
                      const p = point(event);
                      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                      viewport.current!.setPointerCapture(event.pointerId);
                      drag.current = {
                        kind: "fade",
                        id: fade.id,
                        panelId: selectedFade.panel.id,
                        frame: selectedFade,
                        x: p.x,
                        y: p.y,
                        value: 0,
                        startX: 0,
                        startY: 0,
                        group: `fade-${Date.now()}`,
                      };
                    }}
                  >
                    Fade · {fade.length} px
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {rendering && (
        <div className="composition-render-progress" role="status">
          Rendering artwork…
        </div>
      )}
      {context && (
        <div className="composition-context">
          <strong>{context.panel.name}</strong>
          <Button
            variant="secondary"
            onClick={() => {
              controller.setState({ focus: context.panel.id });
              setContext(null);
            }}
          >
            <Focus />
            Edit Panel
          </Button>
          <Button variant="ghost" onClick={() => setContext(null)} aria-label="Close panel menu">
            <X />
          </Button>
        </div>
      )}
      <div className="composition-canvas-status">
        <span>
          {d.width} × {Math.ceil(height).toLocaleString()} px · {panels.length} panels
        </span>
        <span>
          {Math.round(scale * 100)}% ·{" "}
          {session.preview ? "Reading preview" : "Drag objects · double-click to focus"}
        </span>
      </div>
    </div>
  );
}
