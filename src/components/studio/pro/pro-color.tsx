import { Button } from "@/components/ui/button";
import { ToolSection } from "../design/tool-section";
import { ProNumber } from "./pro-properties";
import {
  GRADIENT_PRESETS,
  type ColorAdjustments,
  type GradientStop,
  type RGB,
} from "@/lib/studio/pro/color";
import { toLocalSelection, type Layer, type Selection } from "@/lib/studio/pro/model";
const DEFAULTS: Required<ColorAdjustments> = {
  balance: {
    shadows: [0, 0, 0],
    midtones: [0, 0, 0],
    highlights: [0, 0, 0],
    preserveLuminance: true,
  },
  vibrance: 0,
  mixer: { red: [100, 0, 0, 0], green: [0, 100, 0, 0], blue: [0, 0, 100, 0] },
  shadowsHighlights: { shadows: 0, highlights: 0, width: 0.5 },
  gradientMap: { stops: GRADIENT_PRESETS.Grayscale!, amount: 1 },
  threshold: 128,
  posterize: 8,
};
/** Stops shared by color mapping, editable gradient layers and gradient overlays. Endpoints remain anchored. */
export function GradientStops({
  stops,
  onChange,
}: {
  stops: GradientStop[];
  onChange: (s: GradientStop[]) => void;
}) {
  const patch = (i: number, p: Partial<GradientStop>) =>
    onChange(stops.map((s, j) => (i === j ? { ...s, ...p } : s)));
  return (
    <>
      <label className="pro-field">
        Gradient preset
        <select
          className="field"
          aria-label="Gradient preset"
          value="custom"
          onChange={(e) => onChange(structuredClone(GRADIENT_PRESETS[e.target.value]!))}
        >
          <option value="custom" disabled>
            Custom stops
          </option>
          {Object.keys(GRADIENT_PRESETS).map((key) => (
            <option key={key}>{key}</option>
          ))}
        </select>
      </label>
      {stops.map((s, i) => (
        <div key={i} className="pro-section">
          <label className="pro-field">
            Stop {i + 1} color
            <input
              aria-label={`Gradient stop ${i + 1} color`}
              type="color"
              value={s.color}
              onChange={(e) => patch(i, { color: e.target.value })}
            />
          </label>
          <div className="pro-number-grid">
            {i > 0 && i < stops.length - 1 ? (
              <ProNumber
                label={`Gradient stop ${i + 1} position`}
                value={s.position * 100}
                min={i ? stops[i - 1]!.position * 100 + 0.1 : 0}
                max={i < stops.length - 1 ? stops[i + 1]!.position * 100 - 0.1 : 100}
                step={0.1}
                onChange={(n) => {
                  if (i && i < stops.length - 1) patch(i, { position: n / 100 });
                }}
              />
            ) : (
              <p className="pro-help">Position: {i ? "100%" : "0%"} (anchored)</p>
            )}
            <ProNumber
              label={`Gradient stop ${i + 1} opacity`}
              value={s.opacity * 100}
              min={0}
              max={100}
              onChange={(n) => patch(i, { opacity: n / 100 })}
            />
          </div>
          {i > 0 && i < stops.length - 1 && (
            <Button variant="ghost" onClick={() => onChange(stops.filter((_, j) => j !== i))}>
              Remove stop {i + 1}
            </Button>
          )}
        </div>
      ))}
      <Button
        variant="secondary"
        disabled={stops.length >= 16}
        onClick={() => {
          let index = 0;
          for (let i = 1; i < stops.length - 1; i++)
            if (
              stops[i + 1]!.position - stops[i]!.position >
              stops[index + 1]!.position - stops[index]!.position
            )
              index = i;
          const next = [...stops];
          next.splice(index + 1, 0, {
            position: (stops[index]!.position + stops[index + 1]!.position) / 2,
            color: stops[index]!.color,
            opacity: stops[index]!.opacity,
          });
          onChange(next);
        }}
      >
        Add gradient stop
      </Button>
    </>
  );
}
export function ProColor({
  layer,
  selection,
  documentSize,
  onPatch,
}: {
  layer: Layer;
  selection: Selection;
  documentSize?: { width: number; height: number };
  onPatch: (p: Partial<Layer>, group?: string) => void;
}) {
  const a = layer.color ?? {},
    set = <K extends keyof ColorAdjustments>(
      key: K,
      value: ColorAdjustments[K],
      group = String(key),
    ) => {
      const next = { ...a };
      if (value === undefined) delete next[key];
      else next[key] = value;
      onPatch({ color: Object.keys(next).length ? next : undefined }, `color-${group}`);
    },
    control = <K extends keyof ColorAdjustments>(key: K, title: string) => (
      <div className="pro-actions">
        <label className="pro-check">
          <input
            type="checkbox"
            aria-label={`Enable ${title}`}
            checked={a[key] !== undefined}
            onChange={(e) =>
              set(
                key,
                e.target.checked ? structuredClone(DEFAULTS[key]) : undefined,
                `${key}-enable`,
              )
            }
          />
          {title}
        </label>
        {a[key] !== undefined && (
          <Button
            variant="ghost"
            onClick={() => set(key, structuredClone(DEFAULTS[key]), `${key}-reset`)}
          >
            Reset {title}
          </Button>
        )}
      </div>
    );
  return (
    <ToolSection title="Professional color adjustments">
      <p className="pro-help">
        {layer.kind === "adjustment"
          ? "Editable RGB operations on the visible backdrop below this adjustment layer."
          : "Editable RGB operations on this layer."}{" "}
        Live preview and native-resolution exports share the same pipeline: Balance → Vibrance →
        Mixer → Shadows/Highlights → Gradient Map → Threshold → Posterize. Layer masks, opacity,
        clipping and blend modes apply afterward.
      </p>
      {documentSize && (
        <label className="pro-check">
          <input
            type="checkbox"
            aria-label="Limit color to selection"
            checked={!!layer.colorSelection}
            disabled={!layer.colorSelection && !selection.regions.length && !selection.inverted}
            onChange={(e) =>
              onPatch({
                colorSelection: e.target.checked
                  ? toLocalSelection(selection, layer, documentSize)
                  : undefined,
              })
            }
          />
          Limit color to captured selection
        </label>
      )}
      {control("balance", "Color Balance")}
      {a.balance && (
        <>
          {(["shadows", "midtones", "highlights"] as const).map((range) => (
            <div key={range}>
              <p className="pro-help">{range}</p>
              <div className="pro-number-grid">
                {["Cyan / Red", "Magenta / Green", "Yellow / Blue"].map((name, c) => (
                  <ProNumber
                    key={name}
                    label={`${range} ${name}`}
                    min={-100}
                    max={100}
                    value={a.balance![range][c]!}
                    onChange={(n) =>
                      set(
                        "balance",
                        {
                          ...a.balance!,
                          [range]: a.balance![range].map((v, j) => (j === c ? n : v)) as RGB,
                        },
                        `balance-${range}-${c}`,
                      )
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          <label className="pro-check">
            <input
              type="checkbox"
              aria-label="Preserve balance luminance"
              checked={a.balance.preserveLuminance}
              onChange={(e) =>
                set("balance", { ...a.balance!, preserveLuminance: e.target.checked })
              }
            />
            Preserve luminance
          </label>
        </>
      )}
      {control("vibrance", "Vibrance")}
      {a.vibrance !== undefined && (
        <ProNumber
          label="Vibrance amount"
          min={-100}
          max={100}
          value={a.vibrance}
          onChange={(n) => set("vibrance", n)}
        />
      )}
      {control("mixer", "Channel Mixer")}
      {a.mixer &&
        (["red", "green", "blue"] as const).map((row) => (
          <div key={row}>
            <p className="pro-help">{row} output channel (%)</p>
            <div className="pro-number-grid">
              {["Red", "Green", "Blue", "Constant"].map((col, c) => (
                <ProNumber
                  key={col}
                  label={`Mixer ${row} ${col}`}
                  min={-200}
                  max={200}
                  value={a.mixer![row][c]!}
                  onChange={(n) =>
                    set(
                      "mixer",
                      { ...a.mixer!, [row]: a.mixer![row].map((v, j) => (j === c ? n : v)) },
                      `mixer-${row}-${c}`,
                    )
                  }
                />
              ))}
            </div>
          </div>
        ))}
      {control("shadowsHighlights", "Shadows and Highlights")}
      {a.shadowsHighlights && (
        <div className="pro-number-grid">
          <ProNumber
            label="Shadow lift"
            min={-100}
            max={100}
            value={a.shadowsHighlights.shadows}
            onChange={(n) =>
              set("shadowsHighlights", { ...a.shadowsHighlights!, shadows: n }, "shadow")
            }
          />
          <ProNumber
            label="Highlight recovery"
            min={-100}
            max={100}
            value={a.shadowsHighlights.highlights}
            onChange={(n) =>
              set("shadowsHighlights", { ...a.shadowsHighlights!, highlights: n }, "highlight")
            }
          />
          <ProNumber
            label="Tonal width"
            min={1}
            max={100}
            value={a.shadowsHighlights.width * 100}
            onChange={(n) =>
              set("shadowsHighlights", { ...a.shadowsHighlights!, width: n / 100 }, "tonal-width")
            }
          />
        </div>
      )}
      {control("gradientMap", "Gradient Map")}
      {a.gradientMap && (
        <>
          <ProNumber
            label="Gradient map amount"
            min={0}
            max={100}
            value={a.gradientMap.amount * 100}
            onChange={(n) =>
              set("gradientMap", { ...a.gradientMap!, amount: n / 100 }, "map-amount")
            }
          />
          <GradientStops
            stops={a.gradientMap.stops}
            onChange={(stops) => set("gradientMap", { ...a.gradientMap!, stops }, "map-stops")}
          />
        </>
      )}
      {control("threshold", "Threshold")}
      {a.threshold !== undefined && (
        <ProNumber
          label="Threshold level"
          min={0}
          max={255}
          value={a.threshold}
          onChange={(n) => set("threshold", n)}
        />
      )}
      {control("posterize", "Posterize")}
      {a.posterize !== undefined && (
        <ProNumber
          label="Posterize levels"
          min={2}
          max={256}
          value={a.posterize}
          onChange={(n) => set("posterize", Math.round(n))}
        />
      )}
      <Button
        variant="ghost"
        onClick={() => onPatch({ color: undefined, colorSelection: undefined })}
      >
        Reset professional color
      </Button>
      <p className="pro-help">
        Shadows/Highlights uses luminance weights, without a spatial local-contrast filter.
        {layer.kind === "adjustment"
          ? "This independent layer filters visible siblings below in the same isolated group; its coverage mask and opacity control the result."
          : "These parameters affect this layer. Add an Adjustment layer to filter the visible backdrop independently."}{" "}
        Original assets and editable text/vector geometry remain intact.
      </p>
    </ToolSection>
  );
}
