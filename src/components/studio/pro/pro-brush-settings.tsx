import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ToolSection } from "../design/tool-section";
import {
  availableBrushPresets,
  canDeleteBrushPreset,
  duplicateBrushPreset,
  isFactoryPreset,
  renameBrushPreset,
  resetBrushPresets,
  type BrushPreset,
  type BrushSettings,
} from "@/lib/studio/pro/brush-presets";
import { DAB_DEFAULTS, PRESSURE_GAMMA } from "@/lib/studio/pro/brush-dynamics";
import type { Stroke } from "@/lib/studio/pro/model";
import { ProNumber } from "./pro-properties";

/** Range for touch plus the exact numeric field (the field keeps the established label). */
function ProRange({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pro-range">
      <ProNumber label={label} value={value} min={min} max={max} step={step} onChange={onChange} />
      <input
        type="range"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

type Pending = { kind: "save" | "rename"; name: string } | { kind: "delete" | "reset" } | null;

export function ProBrushSettings({
  brush,
  onBrush,
  brushPresets,
  onPresets,
  onApplyBrushPreset,
  onSaveBrushPreset,
  pressureGamma,
  onPressureGamma,
}: {
  brush: Omit<Stroke, "points" | "erase">;
  onBrush: (p: Partial<Stroke>) => void;
  brushPresets: BrushPreset[];
  onPresets: (presets: BrushPreset[]) => void;
  onApplyBrushPreset: (settings: BrushSettings, tool?: "brush" | "pencil" | "eraser") => void;
  onSaveBrushPreset: (name: string) => boolean;
  pressureGamma: number;
  onPressureGamma: (gamma: number) => void;
}) {
  const presets = availableBrushPresets(brushPresets),
    [current, setCurrent] = useState(""),
    [pending, setPending] = useState<Pending>(null),
    [message, setMessage] = useState(""),
    dynamics = brush.dynamics ?? DAB_DEFAULTS,
    selected = presets.find((p) => p.name === current),
    custom = presets.filter((p) => !isFactoryPreset(p.name));
  const apply = (preset: BrushPreset) => {
    setCurrent(preset.name);
    onApplyBrushPreset(
      {
        ...preset.settings,
        dynamics: preset.settings.dynamics,
        tip: preset.settings.tip ?? "round",
        sizePressure: preset.settings.sizePressure ?? false,
        smoothing: preset.settings.smoothing ?? 0,
      },
      preset.tool ?? "brush",
    );
  };
  const run = (task: () => void, done: string) => {
    try {
      task();
      setMessage(done);
      setPending(null);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const dyn = (patch: Partial<typeof dynamics>) =>
    onBrush({ dynamics: { ...DAB_DEFAULTS, ...brush.dynamics, ...patch } });
  return (
    <div className="pro-brush-settings">
      <label className="pro-field">
        Brush preset
        <select
          className="field"
          aria-label="Brush preset"
          value={selected ? current : ""}
          onChange={(e) => {
            const preset = presets.find((item) => item.name === e.target.value);
            if (preset) apply(preset);
          }}
        >
          <option value="" disabled>
            Choose a preset
          </option>
          <optgroup label="Inkstrip presets">
            {presets
              .filter((p) => isFactoryPreset(p.name))
              .map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.name}
                </option>
              ))}
          </optgroup>
          {custom.length > 0 && (
            <optgroup label="Your presets">
              {custom.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <div className="pro-actions pro-preset-actions">
        <Button variant="secondary" onClick={() => setPending({ kind: "save", name: "" })}>
          Save current preset
        </Button>
        <Button
          variant="ghost"
          disabled={!selected}
          onClick={() =>
            selected &&
            run(() => {
              if (!onSaveBrushPreset(selected.name)) throw Error("Preset was not updated.");
            }, `Updated “${selected.name}” with the current brush.`)
          }
        >
          Update preset
        </Button>
        <Button
          variant="ghost"
          disabled={!selected}
          onClick={() =>
            selected &&
            run(() => {
              const next = duplicateBrushPreset(brushPresets, selected.name);
              onPresets(next);
              setCurrent(next.at(-1)!.name);
            }, `Duplicated “${selected.name}”.`)
          }
        >
          Duplicate preset
        </Button>
        <Button
          variant="ghost"
          disabled={!selected || isFactoryPreset(selected.name)}
          onClick={() => selected && setPending({ kind: "rename", name: selected.name })}
        >
          Rename preset
        </Button>
        <Button
          variant="ghost"
          disabled={!selected || !canDeleteBrushPreset(brushPresets, selected.name)}
          onClick={() => setPending({ kind: "delete" })}
        >
          Delete preset
        </Button>
        <Button variant="ghost" onClick={() => setPending({ kind: "reset" })}>
          Reset presets
        </Button>
      </div>
      {pending && (pending.kind === "save" || pending.kind === "rename") && (
        <form
          className="pro-preset-form"
          onSubmit={(e) => {
            e.preventDefault();
            const name = pending.name.trim();
            if (!name) return;
            if (pending.kind === "save")
              run(() => {
                // Saving as new never overwrites; changing a preset is "Update preset".
                if (presets.some((p) => p.name === name))
                  throw Error(
                    `A preset named “${name}” already exists. Choose another name, or select it and use Update preset.`,
                  );
                if (!onSaveBrushPreset(name)) throw Error("Preset was not saved.");
                setCurrent(name);
              }, `Saved “${name}”.`);
            else
              run(() => {
                onPresets(renameBrushPreset(brushPresets, current, name));
                setCurrent(name);
              }, `Renamed to “${name}”.`);
          }}
        >
          <input
            className="field"
            autoFocus
            maxLength={40}
            aria-label={pending.kind === "save" ? "New preset name" : "Rename preset to"}
            value={pending.name}
            onChange={(e) => setPending({ ...pending, name: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && setPending(null)}
          />
          <Button type="submit" variant="secondary" disabled={!pending.name.trim()}>
            {pending.kind === "save" ? "Save preset" : "Save name"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setPending(null)}>
            Cancel
          </Button>
        </form>
      )}
      {pending && (pending.kind === "delete" || pending.kind === "reset") && (
        <div className="pro-preset-form" role="group" aria-label="Confirm preset change">
          <span className="pro-help">
            {pending.kind === "delete"
              ? `Delete “${current}”?${isFactoryPreset(current) ? " The Inkstrip version returns." : ""}`
              : "Remove all your presets and saved changes to Inkstrip presets?"}
          </span>
          <Button
            variant="secondary"
            onClick={() =>
              pending.kind === "delete"
                ? run(() => {
                    onPresets(brushPresets.filter((p) => p.name !== current));
                    if (!isFactoryPreset(current)) setCurrent("");
                  }, `Deleted “${current}”.`)
                : run(() => {
                    onPresets(resetBrushPresets());
                    setCurrent("");
                  }, "Presets reset to Inkstrip defaults.")
            }
          >
            {pending.kind === "delete" ? "Confirm delete" : "Confirm reset"}
          </Button>
          <Button variant="ghost" onClick={() => setPending(null)}>
            Cancel
          </Button>
        </div>
      )}
      {message && (
        <p className="pro-help" role="status">
          {message}
        </p>
      )}
      <div className="pro-number-grid">
        <ProRange
          label="Brush size"
          value={brush.size}
          min={1}
          max={1000}
          onChange={(n) => onBrush({ size: n })}
        />
        <ProRange
          label="Brush hardness"
          value={brush.hardness * 100}
          min={0}
          max={100}
          onChange={(n) => onBrush({ hardness: n / 100 })}
        />
        <ProRange
          label="Brush opacity"
          value={brush.opacity * 100}
          min={0}
          max={100}
          onChange={(n) => onBrush({ opacity: n / 100 })}
        />
        <ProRange
          label="Brush flow"
          value={brush.flow * 100}
          min={1}
          max={100}
          onChange={(n) => onBrush({ flow: n / 100 })}
        />
        <ProRange
          label="Dab spacing"
          value={dynamics.spacing * 100}
          min={1}
          max={200}
          onChange={(n) => dyn({ spacing: n / 100 })}
        />
      </div>
      <p className="pro-help">
        Opacity caps the whole stroke; flow is the paint each dab deposits, so overlapping dabs
        build up to the opacity. Spacing is a percentage of the brush diameter.
      </p>
      <label className="pro-field">
        Brush / object color
        <input
          type="color"
          aria-label="Brush color"
          value={brush.color === "transparent" ? "#a4efd6" : brush.color}
          onChange={(e) => onBrush({ color: e.target.value })}
        />
      </label>
      <div className="pro-number-grid">
        <ProNumber
          label="Stroke smoothing"
          value={(brush.smoothing ?? 0) * 100}
          min={0}
          max={95}
          onChange={(n) => onBrush({ smoothing: n / 100 })}
        />
        <ProNumber
          label="Brush stabilization"
          value={brush.dynamics?.stabilization ?? 0}
          min={0}
          max={200}
          onChange={(n) => dyn({ stabilization: n })}
        />
      </div>
      <p className="pro-help">
        Smoothing filters the stroke; stabilization trails the pointer by a string length in pixels.
        Strokes always finish exactly where you lift.
      </p>
      <ToolSection title="Pen pressure" defaultOpen={false}>
        <p className="pro-help">
          Pressure is read only from a pen or stylus. Mouse and touch always paint at the full
          configured size and flow.
        </p>
        <label className="pro-check">
          <input
            type="checkbox"
            aria-label="Pen pressure size"
            checked={brush.sizePressure ?? false}
            onChange={(e) => onBrush({ sizePressure: e.target.checked })}
          />{" "}
          Pen pressure controls size
        </label>
        <label className="pro-check">
          <input
            type="checkbox"
            aria-label="Pen pressure flow"
            checked={brush.dynamics?.opacityPressure ?? false}
            onChange={(e) => dyn({ opacityPressure: e.target.checked })}
          />{" "}
          Pen pressure controls flow
        </label>
        <ProRange
          label="Pen pressure curve"
          value={pressureGamma}
          min={PRESSURE_GAMMA.min}
          max={PRESSURE_GAMMA.max}
          step={0.05}
          onChange={onPressureGamma}
        />
        <p className="pro-help">
          Below 1 reaches full size with a lighter touch; above 1 needs firmer pressure. Saved for
          this device and applied to new pen strokes.
        </p>
      </ToolSection>
      <ToolSection title="Brush dynamics" defaultOpen={false}>
        <p className="pro-help">
          Distance-based dabs with deterministic jitter, so previews, saved files and exports match.
        </p>
        <div className="pro-number-grid">
          {(
            [
              ["roundness", "Brush roundness", 0.05, 1, 0.05],
              ["angle", "Brush angle", -360, 360, 1],
              ["scatter", "Brush scatter", 0, 2, 0.05],
              ["sizeJitter", "Size jitter", 0, 1, 0.05],
              ["opacityJitter", "Flow jitter", 0, 1, 0.05],
              ["velocity", "Velocity thinning", 0, 1, 0.05],
            ] as const
          ).map(([key, label, min, max, step]) => (
            <ProNumber
              key={key}
              label={label}
              value={dynamics[key]}
              min={min}
              max={max}
              step={step}
              onChange={(n) => dyn({ [key]: n })}
            />
          ))}
        </div>
        <label className="pro-check">
          <input
            type="checkbox"
            aria-label="Rotate tip along stroke"
            checked={brush.dynamics?.followDirection ?? false}
            onChange={(e) => dyn({ followDirection: e.target.checked })}
          />
          Rotate tip along stroke
        </label>
        <Button variant="ghost" onClick={() => onBrush({ dynamics: { ...DAB_DEFAULTS } })}>
          Reset brush dynamics
        </Button>
      </ToolSection>
    </div>
  );
}
