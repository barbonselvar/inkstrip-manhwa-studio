import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import { createHistory, record, undo, redo, type History } from "@/lib/studio/editor/history";
import { FilterMaskSurface, type MaskPaintState } from "@/lib/studio/pro/filter-mask-paint";
import { appendBrushSample, finishBrushStroke } from "@/lib/studio/pro/brush-dynamics";
import type { FilterMask } from "@/lib/studio/pro/smart-filters";
import type { Selection, Stroke } from "@/lib/studio/pro/model";
const WHITE: Selection = { regions: [], inverted: true, feather: 0 };
export function ProFilterMaskPaint({
  width,
  height,
  initial,
  clip,
  onPreview,
  onFinish,
  onCancel,
}: {
  width: number;
  height: number;
  initial: FilterMask | undefined;
  clip?: Selection;
  onPreview: (mask: FilterMask | undefined) => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const [base] = useState<FilterMask>(() =>
    structuredClone(initial ?? { selection: WHITE, enabled: true, inverted: false, density: 1 }),
  );
  const [start] = useState<MaskPaintState>(() => ({ base: base.selection, strokes: [] }));
  const [history, setHistory] = useState(() => createHistory(start));
  const live = useRef(history),
    surface = useRef<FilterMaskSurface | null>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{
    id: number;
    stroke: Stroke;
    filtered?: Stroke["points"][number];
    length: number;
  } | null>(null);
  const [size, setSize] = useState(32),
    [hardness, setHardness] = useState(0.8),
    [opacity, setOpacity] = useState(1),
    [mode, setMode] = useState<"reveal" | "hide">("hide"),
    [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const draw = useCallback(
    (state: MaskPaintState, current?: Stroke) => {
      const raw = surface.current?.paint(state, current),
        c = canvas.current;
      if (!raw || !c) return;
      const scale = Math.min(1, 512 / raw.width, 512 / raw.height);
      c.width = Math.max(1, Math.round(raw.width * scale));
      c.height = Math.max(1, Math.round(raw.height * scale));
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(raw, 0, 0, c.width, c.height);
      if (base.inverted) {
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.globalAlpha = 1 - base.density;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalAlpha = 1;
    },
    [base],
  );
  useEffect(() => {
    try {
      surface.current = new FilterMaskSurface(width, height);
      draw(start);
      setReady(true);
    } catch (e) {
      setError((e as Error).message);
    }
    return () => {
      surface.current?.dispose();
      surface.current = null;
    };
  }, [width, height, start, draw]);
  const applyState = (next: History<MaskPaintState>) => {
    live.current = next;
    setHistory(next);
    try {
      draw(next.present);
      onPreview(next.present === start ? initial : surface.current!.mask(next.present, base));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * Math.ceil(width)) / r.width,
      y: ((e.clientY - r.top) * Math.ceil(height)) / r.height,
    };
  };
  const stop = (e: PointerEvent<HTMLCanvasElement>, cancel = false) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (cancel) {
      draw(live.current.present);
      return;
    }
    finishBrushStroke(g.stroke, g.filtered, point(e), g.length);
    const next = {
      ...live.current.present,
      strokes: [...live.current.present.strokes, { ...g.stroke, points: [...g.stroke.points] }],
    };
    applyState(record(live.current, next));
  };
  return (
    <section className="r8-mask-paint" aria-label="Paint Smart Filter mask">
      <h3>Paint filter mask</h3>
      <p className="pro-help">
        White reveals the filter; black hides it. Source pixels stay editable. The composite preview
        updates after each stroke. Finish this mask before applying layer properties.
      </p>
      <div className="pro-number-grid">
        <ProNumber label="Mask brush size" value={size} min={1} max={512} onChange={setSize} />
        <ProNumber
          label="Mask brush hardness"
          value={hardness * 100}
          min={0}
          max={100}
          onChange={(v) => setHardness(v / 100)}
        />
        <ProNumber
          label="Mask brush opacity"
          value={opacity * 100}
          min={0}
          max={100}
          onChange={(v) => setOpacity(v / 100)}
        />
      </div>
      <label className="pro-field">
        Mask brush action
        <select
          className="field"
          aria-label="Mask brush action"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="hide">Hide filter (black)</option>
          <option value="reveal">Reveal filter (white)</option>
        </select>
      </label>
      <canvas
        ref={canvas}
        aria-label="Paintable filter mask canvas"
        className="r8-mask-paint-canvas"
        onPointerDown={(e) => {
          if (!ready || !surface.current || gesture.current || e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          setError("");
          e.currentTarget.setPointerCapture(e.pointerId);
          const s: Stroke = {
            size,
            hardness,
            opacity,
            flow: 1,
            color: "#ffffff",
            erase: mode === "reveal" ? base.inverted : !base.inverted,
            points: [point(e)],
            ...(clip ? { clip } : {}),
            sizePressure: false,
          };
          gesture.current = { id: e.pointerId, stroke: s, length: 0 };
          try {
            draw(live.current.present, s);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || g.id !== e.pointerId) return;
          e.preventDefault();
          e.stopPropagation();
          const r = appendBrushSample(
            g.stroke,
            g.filtered,
            point(e),
            { pointerType: e.pointerType, pressure: 1 },
            g.length,
          );
          g.filtered = r.filtered;
          g.length = r.length;
          try {
            draw(live.current.present, g.stroke);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
        onPointerUp={(e) => stop(e)}
        onPointerCancel={(e) => stop(e, true)}
        onLostPointerCapture={(e) => stop(e, true)}
      />
      {error && (
        <p role="alert" className="pro-error">
          {error}
        </p>
      )}
      <div className="pro-actions">
        <Button
          variant="secondary"
          disabled={!history.past.length}
          onClick={() => applyState(undo(live.current))}
        >
          Mask undo
        </Button>
        <Button
          variant="secondary"
          disabled={!history.future.length}
          onClick={() => applyState(redo(live.current))}
        >
          Mask redo
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            applyState(
              record(live.current, {
                base: base.inverted ? { ...WHITE, inverted: false } : WHITE,
                strokes: [],
              }),
            )
          }
        >
          Reset filter mask to white
        </Button>
        <Button disabled={!!error || !ready} onClick={onFinish}>
          Finish filter mask
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onPreview(initial);
            onCancel();
          }}
        >
          Cancel filter mask
        </Button>
      </div>
    </section>
  );
}
