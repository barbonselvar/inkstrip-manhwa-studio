import { useCallback, useEffect, useRef } from "react";
import { paintSelection, validateSelection, type Selection } from "@/lib/studio/retouch/selection";
export function SelectionCanvas({
  width,
  height,
  strokes,
  settings,
  disabled,
  onChange,
  onError,
}: {
  width: number;
  height: number;
  strokes: Selection[];
  settings: Omit<Selection, "points">;
  disabled: boolean;
  onChange: (s: Selection[]) => void;
  onError: (s: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    active = useRef<Selection | null>(null),
    pointer = useRef(-1);
  const draw = useCallback(() => {
    const el = canvas.current;
    if (!el) return;
    const scale = Math.min(1, 800 / Math.max(width, height));
    el.width = Math.max(1, Math.round(width * scale));
    el.height = Math.max(1, Math.round(height * scale));
    const c = el.getContext("2d")!;
    paintSelection(c, active.current ? [...strokes, active.current] : strokes, el.width, el.height);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = "rgba(241,139,92,.5)";
    c.fillRect(0, 0, el.width, el.height);
  }, [strokes, width, height]);
  useEffect(() => {
    draw();
  }, [draw]);
  const point = (event: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
    };
  };
  const end = (event: React.PointerEvent, cancel = false) => {
    if (event.pointerId !== pointer.current || !active.current) return;
    const next = [...strokes, active.current];
    active.current = null;
    pointer.current = -1;
    if (!cancel)
      try {
        validateSelection(next);
        onChange(next);
      } catch (e) {
        onError((e as Error).message);
      }
    draw();
  };
  return (
    <canvas
      ref={canvas}
      className="retouch-selection"
      aria-label="Retouch selection"
      style={{ pointerEvents: disabled ? "none" : "auto" }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        active.current = { ...settings, points: [point(e)] };
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        draw();
      }}
      onPointerMove={(e) => {
        if (pointer.current !== e.pointerId || !active.current) return;
        const s = active.current,
          p = point(e);
        if (s.tool === "ellipse" || s.tool === "rectangle") s.points = [s.points[0]!, p];
        else {
          if (s.points.length >= 512) s.points = s.points.filter((_, i) => i % 2 === 0);
          s.points.push(p);
        }
        draw();
      }}
      onPointerUp={(e) => end(e)}
      onPointerCancel={(e) => end(e, true)}
      onLostPointerCapture={(e) => end(e, true)}
    />
  );
}
