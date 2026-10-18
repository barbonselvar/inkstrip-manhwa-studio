import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  MASK_LIMITS,
  rasterizeMask,
  validateStrokes,
  type MaskPoint,
  type MaskStroke,
} from "@/lib/studio/editor/mask";
export type Brush = { mode: "add" | "subtract"; size: number; hardness: number; opacity: number };
/** One immutable recipe/history update per stroke; live mask drawing is animation-frame bounded. */
export function MaskCanvas({
  width,
  height,
  strokes,
  brush,
  disabled,
  pan,
  onCommit,
  onError,
  shouldPan,
}: {
  width: number;
  height: number;
  strokes: MaskStroke[];
  brush: Brush;
  disabled: boolean;
  pan: boolean;
  onCommit: (strokes: MaskStroke[]) => void;
  onError: (message: string) => void;
  shouldPan: () => boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    active = useRef<{ pointer: number; stroke: MaskStroke } | null>(null);
  const paint = useRef<() => void>(() => {}),
    frame = useRef(0);
  const [cursor, setCursor] = useState<MaskPoint | null>(null);
  const queue = () => {
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        paint.current();
      });
  };
  paint.current = () => {
    const el = canvas.current;
    if (!el) return;
    const scale = Math.min(1, 700 / Math.max(width, height));
    el.width = Math.max(1, Math.round(width * scale));
    el.height = Math.max(1, Math.round(height * scale));
    const current = active.current?.stroke;
    const mask = rasterizeMask(
      current ? [...strokes, current] : strokes,
      el.width,
      el.height,
      width,
      height,
    );
    const context = el.getContext("2d");
    if (!context) return;
    const pixels = context.createImageData(el.width, el.height);
    for (let i = 0; i < mask.length; i++) pixels.data[i * 4 + 3] = mask[i]! * 125;
    context.putImageData(pixels, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = getComputedStyle(el).color;
    context.fillRect(0, 0, el.width, el.height);
    context.globalCompositeOperation = "source-over";
  };
  useEffect(() => {
    queue();
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [strokes, width, height]);
  useEffect(
    () => () => {
      active.current = null;
    },
    [],
  );
  const point = (event: ReactPointerEvent): MaskPoint => {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  const finish = (event: ReactPointerEvent, cancelled = false) => {
    const current = active.current;
    if (!current || current.pointer !== event.pointerId) return;
    active.current = null;
    setCursor(null);
    if (!cancelled) {
      try {
        const next = [...strokes, current.stroke];
        validateStrokes(next);
        onCommit(next);
      } catch (error) {
        onError((error as Error).message);
      }
    }
    if (canvas.current?.hasPointerCapture(event.pointerId))
      canvas.current.releasePointerCapture(event.pointerId);
    queue();
  };
  return (
    <>
      <canvas
        ref={canvas}
        className="editor-mask-overlay focus-ring"
        tabIndex={0}
        aria-label="Selection mask"
        style={{ pointerEvents: pan || disabled ? "none" : "auto" }}
        onPointerDown={(event) => {
          if (disabled || pan || shouldPan() || event.button === 1) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          if (active.current) {
            active.current = null;
            queue();
            return;
          }
          if (
            strokes.length >= MASK_LIMITS.strokes ||
            strokes.reduce((n, s) => n + s.points.length, 0) >= MASK_LIMITS.points
          ) {
            onError("The selection is full. Clear it or undo strokes before painting more.");
            return;
          }
          const p = point(event);
          active.current = { pointer: event.pointerId, stroke: { ...brush, points: [p] } };
          setCursor(p);
          event.currentTarget.setPointerCapture(event.pointerId);
          queue();
        }}
        onPointerMove={(event) => {
          const p = point(event);
          setCursor(p);
          const current = active.current;
          if (!current || current.pointer !== event.pointerId) return;
          event.stopPropagation();
          const last = current.stroke.points.at(-1)!;
          if (Math.hypot((p.x - last.x) * width, (p.y - last.y) * height) < 0.5) return;
          // Decimate long strokes without discarding their latest path segment.
          if (current.stroke.points.length >= MASK_LIMITS.perStroke)
            current.stroke.points = current.stroke.points.filter((_, i) => i % 2 === 0);
          current.stroke.points.push(p);
          queue();
        }}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => finish(event, true)}
        onPointerLeave={() => {
          if (!active.current) setCursor(null);
        }}
      />
      {cursor && !pan && !disabled ? (
        <span
          className="editor-brush-cursor"
          style={{
            left: cursor.x * 100 + "%",
            top: cursor.y * 100 + "%",
            width: (brush.size / width) * 100 + "%",
            height: (brush.size / height) * 100 + "%",
          }}
        />
      ) : null}
    </>
  );
}
