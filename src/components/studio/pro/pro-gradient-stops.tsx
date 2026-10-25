import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import { gradientPixels, advancedGradientSampler, type Gradient } from "@/lib/studio/pro/gradient";
import { GRADIENT_PRESETS } from "@/lib/studio/pro/color";
export function AdvancedGradientStops({
  value,
  onChange,
}: {
  value: Gradient;
  onChange: (g: Gradient) => void;
}) {
  const [selected, setSelected] = useState(0),
    canvas = useRef<HTMLCanvasElement>(null),
    drag = useRef<number | null>(null);
  const stops = value.stops,
    index = Math.min(selected, stops.length - 1),
    current = stops[index]!;
  useEffect(() => {
    const c = canvas.current;
    if (c) {
      c.width = 256;
      c.height = 24;
      c.getContext("2d")!.putImageData(
        new ImageData(
          gradientPixels(256, 24, {
            ...value,
            kind: "linear",
            angle: 0,
            center: { x: 0.5, y: 0.5 },
            scale: 1,
            reverse: false,
          }),
          256,
          24,
        ),
        0,
        0,
      );
    }
  }, [value]);
  const patch = (i: number, p: Partial<Gradient["stops"][number]>) => {
    const item = { ...stops[i]!, ...p };
    if (p.position !== undefined) {
      item.position = Math.max(0.00001, Math.min(0.99999, p.position));
      if (stops.some((s, j) => j !== i && Math.abs(s.position - item.position) < 0.00001)) return;
    }
    const next = stops.map((s, j) => (j === i ? item : s)).sort((a, b) => a.position - b.position),
      at = next.indexOf(item);
    if (drag.current !== null) drag.current = at;
    setSelected(at);
    onChange({ ...value, stops: next });
  };
  return (
    <div className="r8-gradient-stops">
      <label className="pro-field">
        Gradient stop preset
        <select
          className="field"
          aria-label="Gradient stop preset"
          defaultValue=""
          onChange={(e) => {
            const p = GRADIENT_PRESETS[e.target.value];
            if (p) {
              onChange({ ...value, stops: structuredClone(p) });
              setSelected(0);
            }
          }}
        >
          <option value="" disabled>
            Choose a recipe
          </option>
          {Object.keys(GRADIENT_PRESETS).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <div
        className="r8-stop-ramp"
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const i = drag.current;
          if (i === 0 || i === stops.length - 1) return;
          const r = e.currentTarget.getBoundingClientRect();
          patch(i, { position: (e.clientX - r.left) / r.width });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <canvas ref={canvas} aria-label="Gradient ramp" />
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            className="r8-stop-marker"
            style={{ left: `${s.position * 100}%` }}
            aria-label={`Select gradient stop ${i + 1}`}
            aria-pressed={i === index}
            onPointerDown={(e) => {
              e.preventDefault();
              setSelected(i);
              drag.current = i;
              e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
            }}
            onClick={() => setSelected(i)}
          >
            <span style={{ backgroundColor: s.color }} />
          </button>
        ))}
      </div>
      <p className="pro-help">
        Drag markers to move and reorder stops. Endpoints stay at0% and100%.
      </p>
      <div className="pro-number-grid">
        <ProNumber
          label="Stop position"
          min={0}
          max={100}
          step={0.1}
          value={current.position * 100}
          disabled={index === 0 || index === stops.length - 1}
          onChange={(position) => patch(index, { position: position / 100 })}
        />
        <label className="pro-field">
          Stop color
          <input
            type="color"
            aria-label="Stop color"
            value={current.color}
            onChange={(e) => patch(index, { color: e.target.value })}
          />
        </label>
        <ProNumber
          label="Stop opacity"
          min={0}
          max={100}
          value={current.opacity * 100}
          onChange={(opacity) => patch(index, { opacity: opacity / 100 })}
        />
        <ProNumber
          label="Stop midpoint"
          min={1}
          max={99}
          value={(current.midpoint ?? 0.5) * 100}
          disabled={index === stops.length - 1}
          onChange={(midpoint) => patch(index, { midpoint: midpoint / 100 })}
        />
      </div>
      <div className="pro-actions">
        <Button
          variant="secondary"
          disabled={stops.length >= 128}
          onClick={() => {
            let at = 0;
            for (let j = 1; j < stops.length - 1; j++)
              if (
                stops[j + 1]!.position - stops[j]!.position >
                stops[at + 1]!.position - stops[at]!.position
              )
                at = j;
            const position = (stops[at]!.position + stops[at + 1]!.position) / 2,
              rgba = advancedGradientSampler(value)(position),
              hex =
                "#" +
                rgba
                  .slice(0, 3)
                  .map((v) =>
                    Math.round(v * 255)
                      .toString(16)
                      .padStart(2, "0"),
                  )
                  .join("");
            const next = [...stops];
            next.splice(at + 1, 0, { position, color: hex, opacity: rgba[3] });
            onChange({ ...value, stops: next });
            setSelected(at + 1);
          }}
        >
          Add gradient stop
        </Button>
        <Button
          variant="ghost"
          disabled={index === 0 || index === stops.length - 1}
          onClick={() => {
            onChange({ ...value, stops: stops.filter((_, i) => i !== index) });
            setSelected(Math.max(0, index - 1));
          }}
        >
          Remove gradient stop
        </Button>
      </div>
    </div>
  );
}
