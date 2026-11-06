import { BoundaryEditor } from "./boundary-editor";
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
import { objectFlags, pickCreative } from "@/lib/studio/composition/geometry";
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
}: {
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
  } | null>(null);
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
                x: p.x,
                y: p.y - (frame?.imageY ?? 0),
              };
              controller.change((d) => ({ ...d, objects: [...d.objects, next] }));
              controller.select({ kind: "object", id: next.id });
            }
          } catch {
            onError("This artwork could not be dropped. Try clicking its gallery thumbnail.");
          }
        }}
        onPointerDown={(event) => {
          if ((event.target as Element).closest("button,input") || event.button !== 0) return;
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
              if (locked) {
                controller.setState({ selection: { kind: "object", id: object.id } });
                drag.current = null;
                return;
              }
              controller.setState({ selection: { kind: "object", id: object.id } });
              drag.current = {
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
          controller.change(
            (doc) => ({
              ...doc,
              objects: doc.objects.map((o) => {
                if (o.id !== start.id) return o;
                let x = start.startX + dx,
                  y = start.startY + dy;
                if (!o.parentId) {
                  const bounds = objectBounds(o, scene.frames, doc.objects),
                    offsetX = bounds.x - o.x,
                    ownerY = o.owner
                      ? (scene.frames.find((f) => f.panel.id === o.owner)?.imageY ?? 0)
                      : 0,
                    offsetY = bounds.y - o.y - ownerY;
                  for (const guide of [0, d.width / 2 - bounds.width / 2, d.width - bounds.width])
                    if (Math.abs(x + offsetX - guide) < 6 / scale) x = guide - offsetX;
                  for (const guide of [
                    0,
                    scene.height,
                    ...scene.frames.flatMap((f) => [f.imageY, f.bottomY, f.top, f.gapY]),
                  ])
                    for (const edge of [0, bounds.height / 2, bounds.height])
                      if (Math.abs(y + ownerY + offsetY + edge - guide) < 6 / scale)
                        y = guide - ownerY - offsetY - edge;
                }
                return { ...o, x: Math.round(x), y: Math.round(y) };
              }),
            }),
            start.group,
          );
        }}
        onPointerUp={(event) => {
          const start = drag.current;
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
                />
              )}
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
                    <span>{selected.name}</span>
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
                  </div>
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
