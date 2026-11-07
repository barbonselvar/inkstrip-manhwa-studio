import { useRef } from "react";
import type { Fade } from "@/lib/studio/composition/model";
import type { Controller } from "@/lib/studio/composition/controller";
import {
  fadeLine,
  fromDrawing,
  insertPoint,
  lineY,
  movePoint,
  moveFade,
  parts,
  pointOffsets,
  ramp,
  removePoint,
  resizeSide,
  setAmplitude,
  setDepth,
  span,
  type Part,
  type Pt,
} from "@/lib/studio/composition/fade-edit";

type Action = "move" | "depth" | "left" | "right" | "point" | "amplitude" | "draw";
const path = (points: Pt[]) => points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");

/**
 * Direct manipulation for one shaped fade, drawn in image-local chapter pixels.
 * The overlay overflows the image, so a fade can be dragged, resized and drawn into
 * spacing and gutters. Every gesture is one undo step and works with mouse, pen
 * and touch (pointer capture on the grabbed element).
 */
export function BoundaryEditor({
  f,
  panelId,
  width,
  height,
  top,
  scale,
  controller,
  drawing,
  coarse = false,
}: {
  f: Fade;
  panelId: string;
  width: number;
  height: number;
  top: number;
  scale: number;
  controller: Controller;
  drawing: boolean;
  coarse?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<{
      action: Action;
      part: Part;
      index: number;
      origin: Pt;
      snapshot: Fade;
      group: string;
      drawn: Pt[];
    } | null>(null);
  const b = f.boundary!,
    s = span(f, width),
    unit = 1 / scale,
    handle = (coarse ? 22 : 7) * unit,
    hit = (coarse ? 26 : 12) * unit;
  const update = (next: Fade, group: string) =>
    controller.change(
      (d) => ({
        ...d,
        panels: {
          ...d.panels,
          [panelId]: {
            ...d.panels[panelId],
            fades: d.panels[panelId].fades.map((x) => (x.id === f.id ? next : x)),
          },
        },
      }),
      group,
    );
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * width,
      y: ((e.clientY - r.top) / r.height) * height,
    };
  };
  const begin = (e: React.PointerEvent, action: Action, part: Part, index = -1) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const origin = local(e);
    gesture.current = {
      action,
      part,
      index,
      origin,
      snapshot: f,
      group: `fade-${action}-${Date.now()}`,
      drawn: [origin],
    };
    if (action === "point") controller.setState({ fadePoint: index });
  };
  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    e.stopPropagation();
    const p = local(e),
      o = g.snapshot;
    let next: Fade;
    switch (g.action) {
      case "move":
        next = moveFade(o, g.part, p.x - g.origin.x, p.y - g.origin.y, width, height);
        break;
      case "depth":
        next = setDepth(o, g.part, 0.5, p.y, height);
        break;
      case "left":
      case "right":
        next = resizeSide(o, g.action, p.x, width);
        break;
      case "point":
        next = movePoint(o, g.part, g.index, p, width, height);
        break;
      case "amplitude":
        next = setAmplitude(o, g.part, p, height);
        break;
      case "draw":
        if (Math.abs(p.x - g.drawn.at(-1)!.x) < 1.5 * unit) return;
        g.drawn.push(p);
        next = fromDrawing(o, g.part, g.drawn, width, height);
        break;
    }
    update(next, g.group);
  };
  const end = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    e.stopPropagation();
    gesture.current = null;
    if (g.action === "draw") controller.setState({ drawBoundary: false });
  };
  const editablePoints = b.shape === "Bezier" || b.shape === "Freehand";
  const offsets = editablePoints ? pointOffsets(b) : [];
  return (
    <svg
      ref={svg}
      className={`composition-boundary-editor ${drawing ? "is-drawing" : ""}`}
      data-boundary-editor={b.shape}
      data-fade-editor={f.id}
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height, top }}
      aria-label={`${f.name} canvas controls`}
      onPointerDown={(e) => {
        if (!drawing) return;
        const p = local(e);
        begin(
          e,
          "draw",
          b.placement === "Both" ? (p.y < height / 2 ? "top" : "bottom") : parts(f)[0]!,
        );
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <defs>
        <pattern
          id={`fade-hatch-${f.id}`}
          width={10 * unit}
          height={10 * unit}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={10 * unit} height={10 * unit} fill="rgba(56, 214, 232, 0.08)" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2={10 * unit}
            stroke="rgba(56, 214, 232, 0.45)"
            strokeWidth={2 * unit}
          />
        </pattern>
      </defs>
      {drawing && (
        // Drawing may start or continue in spacing above and below the image.
        <rect
          x={-width}
          y={-height}
          width={width * 3}
          height={height * 3}
          fill="transparent"
          pointerEvents="all"
        />
      )}
      {parts(f).map((part) => {
        const near = fadeLine(f, part, 0, width, height),
          mid = fadeLine(f, part, 0.5, width, height),
          far = fadeLine(f, part, 1, width, height);
        const band = `${path(near)} ${path([...far].reverse()).replace(/^M/, "L")} Z`;
        const depth = { x: s.x + s.width / 2, y: lineY(f, part, 0.5, 1, height) },
          grip = { x: s.x + s.width / 2, y: lineY(f, part, 0.5, 0.2, height) },
          left = { x: s.x, y: lineY(f, part, 0, 0.5, height) },
          right = { x: s.x + s.width, y: lineY(f, part, 1, 0.5, height) };
        return (
          <g key={part} data-fade-part={part}>
            <path
              d={band}
              fill={`url(#fade-hatch-${f.id})`}
              stroke="none"
              pointerEvents={drawing ? "none" : "all"}
              className="composition-fade-band"
              data-fade-action="move"
              onPointerDown={(e) => begin(e, "move", part)}
            />
            <path
              d={path(near)}
              fill="none"
              stroke="#38d6e8"
              strokeWidth={1 * unit}
              pointerEvents="none"
            />
            <path
              d={path(far)}
              fill="none"
              stroke="#38d6e8"
              strokeWidth={1 * unit}
              strokeDasharray={`${3 * unit} ${3 * unit}`}
              pointerEvents="none"
            />
            <path
              d={path(mid)}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={2.5 * unit}
              strokeDasharray={`${6 * unit} ${4 * unit}`}
              pointerEvents="none"
            />
            {!drawing && (
              <path
                d={path(mid)}
                fill="none"
                stroke="transparent"
                strokeWidth={hit}
                pointerEvents="stroke"
                className="composition-fade-line"
                data-fade-action="insert"
                onPointerDown={(e) => begin(e, "move", part)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  update(
                    insertPoint(f, part, local(e), width, height),
                    `fade-insert-${Date.now()}`,
                  );
                }}
              />
            )}
            <text
              x={s.x + 8 * unit}
              y={lineY(f, part, 0, 0.5, height) - 8 * unit}
              fontSize={12 * unit}
              fill="var(--color-accent)"
              stroke="var(--color-bg)"
              strokeWidth={3 * unit}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {f.name}
            </text>
            {!drawing && (
              <>
                {editablePoints &&
                  b.points.map((pt, index) => {
                    const y =
                      part === "top"
                        ? f.start + offsets[index]! + ramp(f) / 2
                        : height - f.start - offsets[index]! - ramp(f) / 2;
                    const q = { x: s.x + pt.x * s.width, y };
                    return (
                      <g key={index}>
                        <circle
                          data-point={index}
                          data-boundary-handle={index}
                          cx={q.x}
                          cy={q.y}
                          r={hit}
                          fill="transparent"
                          onPointerDown={(e) => begin(e, "point", part, index)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            update(removePoint(f, index), `fade-remove-${Date.now()}`);
                          }}
                        />
                        <circle
                          data-point={index}
                          cx={q.x}
                          cy={q.y}
                          r={handle * 0.85}
                          fill="var(--color-accent)"
                          stroke="var(--color-bg)"
                          strokeWidth={2 * unit}
                          pointerEvents="none"
                        />
                      </g>
                    );
                  })}
                <rect
                  x={depth.x - handle}
                  y={depth.y - handle}
                  width={handle * 2}
                  height={handle * 2}
                  rx={2 * unit}
                  className="composition-fade-handle-svg"
                  fill="#38d6e8"
                  stroke="var(--color-bg)"
                  strokeWidth={2 * unit}
                  data-fade-handle="depth"
                  aria-label="Fade depth handle"
                  role="slider"
                  aria-valuenow={Math.round(ramp(f))}
                  onPointerDown={(e) => begin(e, "depth", part)}
                />
                <g
                  className="composition-fade-handle-svg"
                  data-fade-handle="move"
                  role="button"
                  aria-label="Move fade"
                  onPointerDown={(e) => begin(e, "move", part)}
                >
                  <circle
                    cx={grip.x}
                    cy={grip.y}
                    r={handle * 1.35}
                    fill="var(--color-accent)"
                    stroke="var(--color-bg)"
                    strokeWidth={2 * unit}
                  />
                  <path
                    d={`M${grip.x - handle * 0.8},${grip.y} H${grip.x + handle * 0.8} M${grip.x},${grip.y - handle * 0.8} V${grip.y + handle * 0.8}`}
                    stroke="var(--color-bg)"
                    strokeWidth={2 * unit}
                  />
                </g>
                {(["left", "right"] as const).map((side) => {
                  const q = side === "left" ? left : right;
                  return (
                    <rect
                      key={side}
                      x={q.x - handle * 0.6}
                      y={q.y - handle * 1.6}
                      width={handle * 1.2}
                      height={handle * 3.2}
                      rx={handle * 0.6}
                      className="composition-fade-handle-svg is-side"
                      fill="var(--color-bg-elevated)"
                      stroke="var(--color-accent)"
                      strokeWidth={2 * unit}
                      data-fade-handle={side}
                      aria-label={`Resize fade ${side} edge`}
                      role="slider"
                      onPointerDown={(e) => begin(e, side, part)}
                    />
                  );
                })}
                {!editablePoints && b.shape !== "Straight" && (
                  <g>
                    <circle
                      data-point={-1}
                      data-boundary-handle={-1}
                      cx={s.x + 0.25 * s.width}
                      cy={lineY(f, part, 0.25, 0.5, height)}
                      r={hit}
                      fill="transparent"
                      aria-label="Shape height handle"
                      onPointerDown={(e) => begin(e, "amplitude", part)}
                    />
                    <circle
                      cx={s.x + 0.25 * s.width}
                      cy={lineY(f, part, 0.25, 0.5, height)}
                      r={handle * 0.85}
                      fill="var(--color-accent)"
                      stroke="var(--color-bg)"
                      strokeWidth={2 * unit}
                      pointerEvents="none"
                    />
                  </g>
                )}
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
