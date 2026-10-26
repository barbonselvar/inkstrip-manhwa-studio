import { useRef, useState, type PointerEvent as ReactPointer } from "react";
import type { Frame } from "@/lib/studio/pro/artboards";
import type { Point } from "@/lib/studio/pro/model";
import type { CanvasView } from "@/lib/studio/pro/viewport";
import {
  RULER_SIZE,
  documentToRuler,
  guidePosition,
  rulerMap,
  rulerTicks,
  type RulerEdge,
  type RulerUnit,
} from "@/lib/studio/pro/rulers";

/** Horizontal and vertical rulers over the Pro viewport. Dragging out of a ruler creates
 * a guide (top ruler → horizontal guide, left ruler → vertical guide). The rulers own
 * their pointer events, so canvas tools never see them. */
export function ProRulers({
  viewport,
  frame,
  fit,
  view,
  doc,
  unit,
  cursor,
  onGuide,
}: {
  viewport: { width: number; height: number };
  frame: Frame;
  fit: number;
  view: CanvasView;
  doc: { width: number; height: number };
  unit: RulerUnit;
  cursor: Point | null;
  onGuide: (axis: "x" | "y", position: number) => void;
}) {
  const [drag, setDrag] = useState<{ edge: RulerEdge; at: number } | null>(null),
    host = useRef<HTMLDivElement>(null);
  const top = rulerMap("top", viewport, frame, fit, view),
    left = rulerMap("left", viewport, frame, fit, view);
  if (!top || !left)
    return (
      <div className="pro-rulers-note" role="status">
        Rulers follow quarter-turn views. Reset the view rotation to use them.
      </div>
    );
  const local = (e: ReactPointer) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const start = (edge: RulerEdge) => (e: ReactPointer<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    setDrag({ edge, at: edge === "top" ? p.y : p.x });
  };
  const moveDrag = (e: ReactPointer<HTMLDivElement>) => {
    if (!drag) return;
    e.stopPropagation();
    const p = local(e);
    setDrag({ ...drag, at: drag.edge === "top" ? p.y : p.x });
  };
  const finish = (cancel: boolean) => (e: ReactPointer<HTMLDivElement>) => {
    if (!drag) return;
    e.stopPropagation();
    const p = local(e),
      // Top ruler → horizontal guide measured along the left ruler, and vice versa.
      guideEdge: RulerEdge = drag.edge === "top" ? "left" : "top",
      m = guideEdge === "top" ? top : left,
      beyond = drag.edge === "top" ? p.y > RULER_SIZE : p.x > RULER_SIZE;
    setDrag(null);
    if (!cancel && beyond) onGuide(m.axis, guidePosition(m, p, guideEdge));
  };
  const ruler = (edge: RulerEdge) => {
    const m = edge === "top" ? top : left,
      length = edge === "top" ? viewport.width : viewport.height,
      ticks = rulerTicks(m, length, m.axis === "x" ? doc.width : doc.height, unit),
      marker = cursor ? documentToRuler(m, cursor[m.axis]) : null;
    return (
      <div
        className={`pro-ruler pro-ruler-${edge}`}
        role="slider"
        aria-label={`${edge === "top" ? "Horizontal" : "Vertical"} ruler · drag to create a ${
          edge === "top" ? "horizontal" : "vertical"
        } guide`}
        aria-valuetext={marker === null ? undefined : `${Math.round(cursor![m.axis])} px`}
        aria-valuenow={marker === null ? undefined : Math.round(cursor![m.axis])}
        data-ruler={edge}
        onPointerDown={start(edge)}
        onPointerMove={moveDrag}
        onPointerUp={finish(false)}
        onPointerCancel={finish(true)}
      >
        <svg width="100%" height="100%" aria-hidden="true">
          {ticks.map((t) =>
            edge === "top" ? (
              <g key={t.value}>
                <line x1={t.at} x2={t.at} y1={t.major ? 4 : 13} y2={RULER_SIZE} />
                {t.label && (
                  <text x={t.at + 3} y={10}>
                    {t.label}
                  </text>
                )}
              </g>
            ) : (
              <g key={t.value}>
                <line y1={t.at} y2={t.at} x1={t.major ? 4 : 13} x2={RULER_SIZE} />
                {t.label && (
                  <text x={10} y={t.at + 3} transform={`rotate(-90 10 ${t.at + 3})`}>
                    {t.label}
                  </text>
                )}
              </g>
            ),
          )}
          {marker !== null &&
            (edge === "top" ? (
              <line className="pro-ruler-cursor" x1={marker} x2={marker} y1={0} y2={RULER_SIZE} />
            ) : (
              <line className="pro-ruler-cursor" y1={marker} y2={marker} x1={0} x2={RULER_SIZE} />
            ))}
        </svg>
      </div>
    );
  };
  return (
    <div ref={host} className="pro-rulers" data-unit={unit}>
      {ruler("top")}
      {ruler("left")}
      <div className="pro-ruler-corner" aria-hidden="true">
        {unit}
      </div>
      {drag && (
        <div
          className={`pro-ruler-preview pro-ruler-preview-${drag.edge === "top" ? "h" : "v"}`}
          style={drag.edge === "top" ? { top: drag.at } : { left: drag.at }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
