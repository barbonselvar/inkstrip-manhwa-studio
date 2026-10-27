import { useEffect, useState } from "react";
import { ProFilterMaskPaint } from "./pro-filter-mask-paint";
import type { Selection } from "@/lib/studio/pro/model";
import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import { ColorOperationFields } from "./pro-color-lab";
import {
  SMART_FILTER_NAMES,
  defaultSmartOperation,
  type SmartFilter,
  type SmartOperation,
  type FilterMask,
} from "@/lib/studio/pro/smart-filters";
import type { ColorOperation } from "@/lib/studio/pro/color-engine";
function OperationFields({
  value,
  onChange,
}: {
  value: SmartOperation;
  onChange: (a: SmartOperation) => void;
}) {
  const patch = (p: Record<string, unknown>) => onChange({ ...value, ...p } as SmartOperation);
  if (
    value.kind === "gaussian" ||
    value.kind === "motion" ||
    value.kind === "unsharp" ||
    value.kind === "highPass" ||
    value.kind === "median"
  )
    return (
      <ColorOperationFields
        operation={value}
        setOperation={(action) =>
          onChange((typeof action === "function" ? action(value) : action) as SmartOperation)
        }
        channel="rgb"
        setChannel={() => {}}
        hist={null}
        allowedKinds={[value.kind] as ColorOperation["kind"][]}
      />
    );
  return (
    <div className="pro-number-grid">
      {value.kind === "radial" && (
        <>
          <label className="pro-field">
            Radial mode
            <select
              className="field"
              aria-label="Radial mode"
              value={value.mode}
              onChange={(e) => patch({ mode: e.target.value })}
            >
              <option value="spin">Spin</option>
              <option value="zoom">Zoom</option>
            </select>
          </label>
          <ProNumber
            label="Radial strength"
            min={0}
            max={100}
            value={value.strength * 100}
            onChange={(v) => patch({ strength: v / 100 })}
          />
          {(["x", "y"] as const).map((k) => (
            <ProNumber
              key={k}
              label={`Radial center ${k}`}
              min={0}
              max={100}
              value={value.center[k] * 100}
              onChange={(v) => patch({ center: { ...value.center, [k]: v / 100 } })}
            />
          ))}
        </>
      )}
      {value.kind === "surface" && (
        <>
          <ProNumber
            label="Surface radius"
            min={1}
            max={16}
            value={value.radius}
            onChange={(radius) => patch({ radius: Math.round(radius) })}
          />
          <ProNumber
            label="Surface threshold"
            min={1}
            max={255}
            value={value.threshold}
            onChange={(threshold) => patch({ threshold })}
          />
        </>
      )}
      {value.kind === "emboss" && (
        <>
          <ProNumber
            label="Emboss angle"
            min={-360}
            max={360}
            value={value.angle}
            onChange={(angle) => patch({ angle })}
          />
          <ProNumber
            label="Emboss height"
            min={1}
            max={32}
            value={value.height}
            onChange={(height) => patch({ height })}
          />
          <ProNumber
            label="Emboss strength"
            min={0}
            max={10}
            step={0.1}
            value={value.strength}
            onChange={(strength) => patch({ strength })}
          />
        </>
      )}
      {value.kind === "edgeDetect" && (
        <>
          <label className="pro-field">
            Edge method
            <select
              className="field"
              aria-label="Edge method"
              value={value.method}
              onChange={(e) => patch({ method: e.target.value })}
            >
              <option value="sobel">Sobel</option>
              <option value="laplacian">Laplacian</option>
            </select>
          </label>
          <ProNumber
            label="Edge strength"
            min={0}
            max={10}
            step={0.1}
            value={value.strength}
            onChange={(strength) => patch({ strength })}
          />
        </>
      )}
      {value.kind === "grain" && (
        <>
          <label className="pro-field">
            Noise distribution
            <select
              className="field"
              aria-label="Noise distribution"
              value={value.distribution}
              onChange={(e) => patch({ distribution: e.target.value })}
            >
              <option value="uniform">Uniform</option>
              <option value="gaussian">Gaussian</option>
            </select>
          </label>
          <ProNumber
            label="Noise strength"
            min={0}
            max={100}
            value={value.amount}
            onChange={(amount) => patch({ amount })}
          />
          <ProNumber
            label="Noise seed"
            min={0}
            max={0xffffffff}
            value={value.seed}
            onChange={(seed) => patch({ seed: Math.round(seed) })}
          />
          <label className="pro-check">
            <input
              type="checkbox"
              aria-label="Monochromatic noise"
              checked={value.monochrome}
              onChange={(e) => patch({ monochrome: e.target.checked })}
            />
            Monochromatic
          </label>
        </>
      )}
    </div>
  );
}
export function ProSmartFilters({
  value,
  onChange,
  captureMask,
  disabledReason,
  maskSize,
  maskClip,
  onEditingChange,
}: {
  value: SmartFilter[];
  onChange: (v: SmartFilter[]) => void;
  captureMask: () => FilterMask;
  disabledReason?: string;
  maskSize: { width: number; height: number };
  maskClip?: Selection;
  onEditingChange: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; mask: FilterMask | undefined } | null>(null);
  useEffect(() => () => onEditingChange(false), [onEditingChange]);
  const patch = (id: string, p: Partial<SmartFilter>) =>
    onChange(value.map((f) => (f.id === id ? { ...f, ...p } : f)));
  if (editing)
    return (
      <ProFilterMaskPaint
        width={maskSize.width}
        height={maskSize.height}
        initial={editing.mask}
        clip={maskClip}
        onPreview={(mask) => patch(editing.id, { mask })}
        onFinish={() => {
          setEditing(null);
          onEditingChange(false);
        }}
        onCancel={() => {
          setEditing(null);
          onEditingChange(false);
        }}
      />
    );
  return (
    <section aria-label="Smart Filter stack">
      <h3>Smart Filters</h3>
      <p className="pro-help">
        Runs on original layer content, before the layer mask and styles. Top to bottom.12 filters
        /4MP /128M aggregate kernel taps. Source pixels stay editable.
      </p>
      {disabledReason ? (
        <p className="pro-help" role="status">
          {disabledReason}
        </p>
      ) : (
        <>
          <label className="pro-field">
            Add Smart Filter
            <select
              className="field"
              aria-label="Add Smart Filter"
              value=""
              disabled={value.length >= 12}
              onChange={(e) => {
                if (e.target.value)
                  onChange([
                    ...value,
                    {
                      id: crypto.randomUUID(),
                      enabled: true,
                      operation: defaultSmartOperation(e.target.value as SmartOperation["kind"]),
                    },
                  ]);
              }}
            >
              <option value="" disabled>
                Choose a filter
              </option>
              {Object.entries(SMART_FILTER_NAMES).map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {value.map((f, i) => (
            <details key={f.id} className="r8-filter-card" open>
              <summary>
                {i + 1}. {SMART_FILTER_NAMES[f.operation.kind]}
              </summary>
              <label className="pro-check">
                <input
                  type="checkbox"
                  aria-label={`Enable Smart Filter ${i + 1}`}
                  checked={f.enabled}
                  onChange={(e) => patch(f.id, { enabled: e.target.checked })}
                />
                Enabled
              </label>
              <OperationFields
                value={f.operation}
                onChange={(operation) => patch(f.id, { operation })}
              />
              <div className="pro-actions">
                {([-1, 1] as const).map((direction) => (
                  <Button
                    key={direction}
                    variant="secondary"
                    disabled={i + direction < 0 || i + direction >= value.length}
                    onClick={() => {
                      const next = [...value];
                      [next[i], next[i + direction]] = [next[i + direction]!, next[i]!];
                      onChange(next);
                    }}
                  >
                    {direction < 0 ? "Move filter earlier" : "Move filter later"}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  onClick={() => onChange(value.filter((n) => n.id !== f.id))}
                >
                  Remove filter
                </Button>
              </div>
              <Button variant="secondary" onClick={() => patch(f.id, { mask: captureMask() })}>
                Use selection as filter mask
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing({ id: f.id, mask: f.mask ? structuredClone(f.mask) : undefined });
                  onEditingChange(true);
                }}
              >
                Paint filter mask
              </Button>
              {f.mask && (
                <>
                  <label className="pro-check">
                    <input
                      type="checkbox"
                      aria-label={`Filter mask ${i + 1} enabled`}
                      checked={f.mask.enabled}
                      onChange={(e) =>
                        patch(f.id, { mask: { ...f.mask!, enabled: e.target.checked } })
                      }
                    />
                    Filter mask enabled
                  </label>
                  <label className="pro-check">
                    <input
                      type="checkbox"
                      aria-label={`Invert filter mask ${i + 1}`}
                      checked={f.mask.inverted}
                      onChange={(e) =>
                        patch(f.id, { mask: { ...f.mask!, inverted: e.target.checked } })
                      }
                    />
                    Invert filter mask
                  </label>
                  <ProNumber
                    label={`Filter mask ${i + 1} strength`}
                    min={0}
                    max={100}
                    value={f.mask.density * 100}
                    onChange={(v) => patch(f.id, { mask: { ...f.mask!, density: v / 100 } })}
                  />
                  <Button variant="ghost" onClick={() => patch(f.id, { mask: undefined })}>
                    Remove filter mask
                  </Button>
                </>
              )}
            </details>
          ))}
        </>
      )}
    </section>
  );
}
