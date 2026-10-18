import { useState } from "react";
export function NumberField({
  label,
  value,
  min = 0,
  max = 65535,
  step = 1,
  onChange,
  onEnd,
  disabled,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  onEnd?: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="editor-field-label">
      {label}
      <input
        className="field"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text ?? String(value)}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const next = Number(raw);
          if (raw && Number.isFinite(next) && next >= min && next <= max)
            onChange(step === 1 ? Math.round(next) : next);
        }}
        onBlur={() => {
          setText(null);
          onEnd?.();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}
