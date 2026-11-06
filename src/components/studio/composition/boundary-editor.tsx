import { useRef } from "react";
import type { Fade } from "@/lib/studio/composition/model";
import type { Controller } from "@/lib/studio/composition/controller";
import { boundaryOffset } from "@/lib/studio/composition/boundaries";
export function BoundaryEditor({
  f,
  panelId,
  width,
  height,
  top,
  scale,
  controller,
  drawing,
}: {
  f: Fade;
  panelId: string;
  width: number;
  height: number;
  top: number;
  scale: number;
  controller: Controller;
  drawing: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<{ index: number; group: string; points: { x: number; y: number }[] } | null>(
      null,
    );
  const b = f.boundary!;
  const bottom = b.placement !== "Top",
    base = f.start + (f.length + f.feather) / 2;
  const position = (x: number, offset: number) => ({
    x: x * width,
    y: bottom ? height - base - offset : base + offset,
  });
  const path = Array.from({ length: 101 }, (_, i) => {
    const p = position(i / 100, boundaryOffset(b, i / 100));
    return `${i ? "L" : "M"}${p.x},${p.y}`;
  }).join(" ");
  const update = (patch: Partial<Fade>, group: string) =>
    controller.change(
      (d) => ({
        ...d,
        panels: {
          ...d.panels,
          [panelId]: {
            ...d.panels[panelId],
            fades: d.panels[panelId].fades.map((x) => (x.id === f.id ? { ...x, ...patch } : x)),
          },
        },
      }),
      group,
    );
  const point = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect(),
      x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y = ((e.clientY - r.top) / r.height) * height,
      offset = (bottom ? height - y : y) - base;
    return {
      x,
      y: Math.max(
        0,
        Math.min(1, offset / Math.max(1, drawing ? Math.min(100000, height - base) : b.amplitude)),
      ),
    };
  };
  const handles =
    b.shape === "Bezier" || b.shape === "Freehand"
      ? b.points
          .map((p, i) => ({ p, index: i }))
          .filter(
            (_, i) =>
              b.shape === "Bezier" || i % Math.max(1, Math.floor(b.points.length / 8)) === 0,
          )
      : [{ p: { x: 0.25, y: boundaryOffset(b, 0.25) / Math.max(1, b.amplitude) }, index: -1 }];
  return (
    <svg
      ref={svg}
      className={`composition-boundary-editor ${drawing ? "is-drawing" : ""}`}
      data-boundary-editor={b.shape}
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height, top }}
      aria-label="Fade boundary canvas controls"
      onPointerDown={(e) => {
        const index = Number((e.target as SVGElement).getAttribute("data-point"));
        if (!drawing && !(e.target as SVGElement).hasAttribute("data-point")) return;
        e.stopPropagation();
        e.preventDefault();
        svg.current!.setPointerCapture(e.pointerId);
        const p = point(e),
          g = { index: drawing ? -2 : index, group: `boundary-${Date.now()}`, points: [p] };
        gesture.current = g;
        if (drawing)
          update(
            {
              boundary: {
                ...b,
                amplitude: Math.min(100000, Math.max(1, height - base)),
                points: [
                  { x: 0, y: p.y },
                  { x: 1, y: p.y },
                ],
              },
            },
            g.group,
          );
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g) return;
        e.stopPropagation();
        const p = point(e);
        if (g.index === -2) {
          if (g.points.length >= 125) g.points = g.points.filter((_, i) => i % 2 === 0);
          if (Math.abs(p.x - g.points.at(-1)!.x) > 0.003) g.points.push(p);
          const points = [...g.points].sort((a, b) => a.x - b.x);
          update(
            {
              boundary: {
                ...b,
                amplitude: Math.min(100000, Math.max(1, height - base)),
                points: [{ x: 0, y: points[0].y }, ...points, { x: 1, y: points.at(-1)!.y }],
              },
            },
            g.group,
          );
        } else if (g.index === -1) {
          const r = svg.current!.getBoundingClientRect(),
            y = ((e.clientY - r.top) / r.height) * height,
            offset = (bottom ? height - y : y) - base,
            v = boundaryOffset({ ...b, amplitude: 1 }, 0.25);
          update(
            {
              boundary: {
                ...b,
                amplitude: Math.max(0, Math.min(100000, offset / Math.max(0.1, v))),
              },
            },
            g.group,
          );
        } else
          update(
            { boundary: { ...b, points: b.points.map((x, i) => (i === g.index ? p : x)) } },
            g.group,
          );
      }}
      onPointerUp={(e) => {
        if (!gesture.current) return;
        e.stopPropagation();
        gesture.current = null;
        controller.setState({ drawBoundary: false });
      }}
      onPointerCancel={() => {
        gesture.current = null;
        controller.setState({ drawBoundary: false });
      }}
    >
      <path
        d={path}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2 / scale}
        strokeDasharray={`${6 / scale} ${4 / scale}`}
        pointerEvents="none"
      />
      {b.placement === "Both" && (
        <path
          d={path}
          transform={`translate(0 ${height}) scale(1 -1)`}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2 / scale}
          pointerEvents="none"
        />
      )}
      {b.shape === "Bezier" && (
        <polyline
          points={b.points
            .map((p) => {
              const q = position(p.x, p.y * b.amplitude);
              return `${q.x},${q.y}`;
            })
            .join(" ")}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1 / scale}
          pointerEvents="none"
        />
      )}
      {handles.map(({ p, index }) => {
        const q = position(p.x, p.y * b.amplitude);
        return (
          <g key={index}>
            <circle
              data-point={index}
              data-boundary-handle={index}
              cx={q.x}
              cy={q.y}
              r={22 / scale}
              fill="transparent"
            />
            <circle
              data-point={index}
              cx={q.x}
              cy={q.y}
              r={6 / scale}
              fill="var(--color-accent)"
              stroke="var(--color-bg)"
              strokeWidth={2 / scale}
            />
          </g>
        );
      })}
    </svg>
  );
}
