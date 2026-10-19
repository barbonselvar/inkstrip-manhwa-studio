import type { Layer, Selection, Stroke } from "@/lib/studio/pro/model";
import { Button } from "@/components/ui/button";
import { ADJUSTMENT_FIELDS } from "@/lib/studio/editor/adjustments";
import { ToolSection } from "../design/tool-section";
export function ProNumber({
  label,
  value,
  min = -100000,
  max = 100000,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="pro-field">
      {label}
      <input
        className="field"
        type="number"
        aria-label={label}
        value={Math.round(value * 1000) / 1000}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          if (e.target.value === "") return;
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
      />
    </label>
  );
}
export function ProProperties({
  selected,
  onPatch,
  selection,
  onSelection,
  onMask,
  brush,
  onBrush,
  maskMode,
  setMaskMode,
}: {
  selected?: Layer;
  onPatch: (p: Partial<Layer>, group?: string) => void;
  selection: Selection;
  onSelection: (s: Selection) => void;
  onMask: () => void;
  brush: Omit<Stroke, "points" | "erase">;
  onBrush: (p: Partial<Stroke>) => void;
  maskMode: boolean;
  setMaskMode: (v: boolean) => void;
}) {
  return (
    <div className="pro-properties-content">
      <ToolSection title="Brush & selection" defaultOpen>
        <div className="pro-number-grid">
          <ProNumber
            label="Brush size"
            value={brush.size}
            min={1}
            max={1000}
            onChange={(n) => onBrush({ size: n })}
          />
          <ProNumber
            label="Brush hardness"
            value={brush.hardness * 100}
            min={0}
            max={100}
            onChange={(n) => onBrush({ hardness: n / 100 })}
          />
          <ProNumber
            label="Brush opacity"
            value={brush.opacity * 100}
            min={0}
            max={100}
            onChange={(n) => onBrush({ opacity: n / 100 })}
          />
          <ProNumber
            label="Brush flow"
            value={brush.flow * 100}
            min={1}
            max={100}
            onChange={(n) => onBrush({ flow: n / 100 })}
          />
        </div>
        <label className="pro-field">
          Brush / object color
          <input
            type="color"
            aria-label="Brush color"
            value={brush.color === "transparent" ? "#a4efd6" : brush.color}
            onChange={(e) => onBrush({ color: e.target.value })}
          />
        </label>
        <ProNumber
          label="Selection feather"
          value={selection.feather}
          min={0}
          max={100}
          onChange={(n) => onSelection({ ...selection, feather: n })}
        />
        <div className="pro-actions">
          <Button
            variant="secondary"
            onClick={() => onSelection({ ...selection, inverted: !selection.inverted })}
          >
            Invert selection
          </Button>
          <Button
            variant="ghost"
            onClick={() => onSelection({ regions: [], inverted: false, feather: 0 })}
          >
            Deselect
          </Button>
        </div>
      </ToolSection>
      {!selected ? (
        <p className="pro-help">
          Select a layer or create an object. Paint on a new paint layer; the imported artwork stays
          intact.
        </p>
      ) : (
        <>
          <div className="pro-section-title">
            <span>{selected.kind} layer</span>
            <strong>{selected.name}</strong>
          </div>
          <fieldset disabled={selected.locked}>
            <label className="pro-field">
              Layer name
              <input
                className="field"
                aria-label="Pro layer name"
                value={selected.name}
                maxLength={100}
                onChange={(e) => onPatch({ name: e.target.value }, "name")}
              />
            </label>
            <label className="pro-field">
              Layer opacity
              <input
                aria-label="Layer opacity"
                type="range"
                min={0}
                max={100}
                value={Math.round(selected.opacity * 100)}
                onChange={(e) => onPatch({ opacity: +e.target.value / 100 }, "opacity")}
              />
            </label>
            <label className="pro-field">
              Blend mode
              <select
                className="field"
                aria-label="Layer blend mode"
                value={selected.blend}
                onChange={(e) => onPatch({ blend: e.target.value as Layer["blend"] })}
              >
                {["source-over", "multiply", "screen", "overlay", "darken", "lighten"].map((v) => (
                  <option key={v} value={v}>
                    {v === "source-over" ? "Normal" : v}
                  </option>
                ))}
              </select>
            </label>
            {selected.kind !== "group" && (
              <ToolSection title="Transform & alignment" defaultOpen>
                <div className="pro-number-grid">
                  {(["x", "y", "rotation"] as const).map((key) => (
                    <ProNumber
                      key={key}
                      label={`Object ${key}`}
                      value={selected.transform[key]}
                      min={key === "rotation" ? -360 : -100000}
                      max={key === "rotation" ? 360 : 100000}
                      onChange={(n) =>
                        onPatch(
                          { transform: { ...selected.transform, [key]: n } },
                          `transform-${key}`,
                        )
                      }
                    />
                  ))}
                  <ProNumber
                    label="Object width"
                    value={selected.width * selected.transform.scaleX}
                    min={1}
                    max={16384}
                    onChange={(n) =>
                      onPatch(
                        { transform: { ...selected.transform, scaleX: n / selected.width } },
                        "width",
                      )
                    }
                  />
                  <ProNumber
                    label="Object height"
                    value={selected.height * selected.transform.scaleY}
                    min={1}
                    max={16384}
                    onChange={(n) =>
                      onPatch(
                        { transform: { ...selected.transform, scaleY: n / selected.height } },
                        "height",
                      )
                    }
                  />
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    onPatch({ transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } })
                  }
                >
                  Reset transform
                </Button>
              </ToolSection>
            )}
            {selected.kind === "shape" && (
              <ToolSection title="Vector appearance" defaultOpen>
                <label className="pro-field">
                  Fill
                  <input
                    type="color"
                    aria-label="Object fill"
                    value={selected.fill === "transparent" ? "#f3efe6" : selected.fill}
                    onChange={(e) => onPatch({ fill: e.target.value }, "fill")}
                  />
                </label>
                <label className="pro-check">
                  <input
                    type="checkbox"
                    checked={selected.fill === "transparent"}
                    onChange={(e) =>
                      onPatch({ fill: e.target.checked ? "transparent" : "#f3efe6" })
                    }
                  />{" "}
                  No fill
                </label>
                <label className="pro-field">
                  Stroke
                  <input
                    type="color"
                    aria-label="Object stroke"
                    value={selected.stroke === "transparent" ? "#172420" : selected.stroke}
                    onChange={(e) => onPatch({ stroke: e.target.value }, "stroke")}
                  />
                </label>
                <ProNumber
                  label="Stroke width"
                  value={selected.strokeWidth}
                  min={0}
                  max={100}
                  onChange={(n) => onPatch({ strokeWidth: n }, "stroke")}
                />
                {selected.shape === "path" && (
                  <>
                    <label className="pro-check">
                      <input
                        type="checkbox"
                        aria-label="Close Bézier path"
                        checked={selected.closed}
                        onChange={(e) => onPatch({ closed: e.target.checked })}
                      />{" "}
                      Closed path
                    </label>
                    <p className="pro-help">
                      Pen: click anchors, drag for curve handles. Direct select: drag anchors or
                      handles. Imported SVG paths retain their geometry; native anchors are
                      editable.
                    </p>
                  </>
                )}
                {["bubble", "thought"].includes(selected.shape) && (
                  <div className="pro-number-grid">
                    <ProNumber
                      label="Bubble tail X"
                      min={0}
                      max={selected.width}
                      value={selected.tail.x}
                      onChange={(n) => onPatch({ tail: { ...selected.tail, x: n } }, "tail")}
                    />
                    <ProNumber
                      label="Bubble tail Y"
                      min={0}
                      max={selected.height}
                      value={selected.tail.y}
                      onChange={(n) => onPatch({ tail: { ...selected.tail, y: n } }, "tail")}
                    />
                  </div>
                )}
              </ToolSection>
            )}
            {selected.kind === "text" && (
              <ToolSection title="Editable typography" defaultOpen>
                <label className="pro-field">
                  Text
                  <textarea
                    className="field"
                    aria-label="Pro text content"
                    rows={4}
                    maxLength={5000}
                    value={selected.text}
                    onChange={(e) => onPatch({ text: e.target.value }, "text")}
                  />
                </label>
                <label className="pro-field">
                  Font
                  <select
                    className="field"
                    aria-label="Text font"
                    value={selected.fontFamily}
                    onChange={(e) => onPatch({ fontFamily: e.target.value as Layer["fontFamily"] })}
                  >
                    {["Arial", "Georgia", "monospace"].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <div className="pro-number-grid">
                  <ProNumber
                    label="Text font size"
                    value={selected.fontSize}
                    min={1}
                    max={1000}
                    onChange={(n) => onPatch({ fontSize: n }, "font")}
                  />
                  <ProNumber
                    label="Text weight"
                    value={selected.fontWeight}
                    min={100}
                    max={900}
                    step={100}
                    onChange={(n) => onPatch({ fontWeight: n }, "weight")}
                  />
                  <ProNumber
                    label="Text line height"
                    value={selected.lineHeight}
                    min={0.5}
                    max={3}
                    step={0.1}
                    onChange={(n) => onPatch({ lineHeight: n }, "line")}
                  />
                  <ProNumber
                    label="Text letter spacing"
                    value={selected.letterSpacing}
                    min={-20}
                    max={100}
                    step={0.1}
                    onChange={(n) => onPatch({ letterSpacing: n }, "spacing")}
                  />
                </div>
                <label className="pro-field">
                  Text alignment
                  <select
                    className="field"
                    aria-label="Text alignment"
                    value={selected.align}
                    onChange={(e) => onPatch({ align: e.target.value as Layer["align"] })}
                  >
                    {["left", "center", "right"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label className="pro-field">
                  Text fill
                  <input
                    type="color"
                    aria-label="Text fill"
                    value={selected.fill === "transparent" ? "#172420" : selected.fill}
                    onChange={(e) => onPatch({ fill: e.target.value }, "fill")}
                  />
                </label>
              </ToolSection>
            )}
            {selected.kind !== "group" && (
              <ToolSection title="Non-destructive adjustments">
                <p className="pro-help">
                  Traditional RGB filters. Preview is reduced resolution; exports use document
                  dimensions.
                </p>
                {ADJUSTMENT_FIELDS.map((f) => (
                  <label key={f.key} className="pro-field">
                    {f.label} · {selected.adjustments[f.key]}
                    <input
                      type="range"
                      aria-label={`Pro ${f.label}`}
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={selected.adjustments[f.key]}
                      onChange={(e) =>
                        onPatch(
                          { adjustments: { ...selected.adjustments, [f.key]: +e.target.value } },
                          `adjust-${f.key}`,
                        )
                      }
                    />
                  </label>
                ))}
                <ProNumber
                  label="Hue rotation"
                  value={selected.hue}
                  min={-180}
                  max={180}
                  onChange={(n) => onPatch({ hue: n }, "hue")}
                />
                <div className="pro-number-grid">
                  <ProNumber
                    label="Levels black"
                    value={selected.black}
                    min={0}
                    max={selected.white - 1}
                    onChange={(n) => onPatch({ black: n }, "black")}
                  />
                  <ProNumber
                    label="Levels white"
                    value={selected.white}
                    min={selected.black + 1}
                    max={255}
                    onChange={(n) => onPatch({ white: n }, "white")}
                  />
                  <ProNumber
                    label="Levels gamma"
                    value={selected.gamma}
                    min={0.1}
                    max={5}
                    step={0.1}
                    onChange={(n) => onPatch({ gamma: n }, "gamma")}
                  />
                </div>
                <p className="pro-help">
                  Five-point piecewise-linear tone curve (input 0/64/128/192/255).
                </p>
                <div className="pro-number-grid">
                  {selected.curve.map((n, i) => (
                    <ProNumber
                      key={i}
                      label={`Curve point ${i + 1}`}
                      value={n}
                      min={0}
                      max={255}
                      onChange={(v) =>
                        onPatch(
                          { curve: selected.curve.map((p, k) => (k === i ? v : p)) },
                          `curve-${i}`,
                        )
                      }
                    />
                  ))}
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    onPatch({ adjustments: { ...selected.adjustments, saturation: -100 } })
                  }
                >
                  Black & white
                </Button>
              </ToolSection>
            )}
            {selected.kind !== "group" && (
              <ToolSection title="Layer mask">
                <p className="pro-help">
                  White reveals, eraser hides. The source pixels remain intact. A selection becomes
                  a local mask on this layer.
                </p>
                <Button variant="secondary" onClick={onMask}>
                  Mask from selection
                </Button>
                {selected.mask && (
                  <>
                    <label className="pro-check">
                      <input
                        aria-label="Enable layer mask"
                        type="checkbox"
                        checked={selected.mask.enabled}
                        onChange={(e) =>
                          onPatch({ mask: { ...selected.mask!, enabled: e.target.checked } })
                        }
                      />{" "}
                      Enable mask
                    </label>
                    <label className="pro-check">
                      <input
                        aria-label="Paint layer mask"
                        type="checkbox"
                        checked={maskMode}
                        onChange={(e) => setMaskMode(e.target.checked)}
                      />{" "}
                      Paint mask instead of pixels
                    </label>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        onPatch({
                          mask: {
                            ...selected.mask!,
                            inverted: !selected.mask!.inverted,
                          },
                        })
                      }
                    >
                      Invert mask
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        onPatch({ mask: undefined });
                        setMaskMode(false);
                      }}
                    >
                      Remove mask
                    </Button>
                  </>
                )}
              </ToolSection>
            )}
          </fieldset>
        </>
      )}
    </div>
  );
}
