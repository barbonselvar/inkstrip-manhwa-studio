import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ADJUSTMENT_FIELDS,
  NEUTRAL,
  PRESETS,
  type Adjustments,
} from "@/lib/studio/editor/adjustments";
import { NumberField } from "./number-field";
export function AdjustmentControls({
  value,
  onChange,
  onEnd,
  selective = false,
}: {
  value: Adjustments;
  onChange: (next: Adjustments, group?: string) => void;
  onEnd: () => void;
  selective?: boolean;
}) {
  const prefix = selective ? "Selective " : "";
  return (
    <>
      {!selective ? (
        <>
          <div className="editor-section-heading">
            <h3>Manhwa presets</h3>
          </div>
          <div className="editor-presets">
            {PRESETS.map((preset) => (
              <Button
                key={preset.name}
                variant="secondary"
                size="sm"
                onClick={() => onChange({ ...NEUTRAL, ...preset.values })}
              >
                {preset.name}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted">
            Presets replace these adjustments. Your crop and selection stay intact.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted">
          Changes apply only inside the painted mask, after whole-image adjustments.
        </p>
      )}
      {ADJUSTMENT_FIELDS.map((field) => {
        const label = prefix + (selective ? field.label.toLowerCase() : field.label);
        return (
          <div className="editor-adjustment" key={field.key}>
            <NumberField
              label={label}
              value={value[field.key]}
              min={field.min}
              max={field.max}
              step={field.step}
              onChange={(v) => onChange({ ...value, [field.key]: v }, `${prefix}${field.key}`)}
              onEnd={onEnd}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Reset ${label.toLowerCase()}`}
              disabled={value[field.key] === 0}
              onClick={() => onChange({ ...value, [field.key]: 0 })}
            >
              <RotateCcw className="size-4" />
            </Button>
            <input
              type="range"
              aria-label={`${label} slider`}
              min={field.min}
              max={field.max}
              step={field.step}
              value={value[field.key]}
              onChange={(e) =>
                onChange({ ...value, [field.key]: +e.target.value }, `${prefix}${field.key}`)
              }
              onPointerUp={onEnd}
              onKeyUp={onEnd}
            />
          </div>
        );
      })}
      <Button variant="secondary" onClick={() => onChange({ ...NEUTRAL })}>
        {selective ? "Reset selective adjustments" : "Reset adjustments"}
      </Button>
      <p className="text-xs text-subtle">
        Local pixel filters, not AI. Blur radius is in output pixels. Temperature is a warm/cool
        shift. Use subtle settings to protect lettering and line art.
      </p>
    </>
  );
}
