import { ProMaskThumbnail } from "./pro-mask-thumbnail";
import { ProBrushSettings } from "./pro-brush-settings";
import { setMaskLinked } from "@/lib/studio/pro/masks";
import { BLEND_GROUPS, BLEND_GROUP_NAMES, BLEND_LABELS } from "@/lib/studio/pro/blend";
import { ProAppearance } from "./pro-appearance";
import type { ReactNode } from "react";
import { ProColor } from "./pro-color";
import type { Layer, Selection, Stroke } from "@/lib/studio/pro/model";
import { Button } from "@/components/ui/button";
import { ADJUSTMENT_FIELDS } from "@/lib/studio/editor/adjustments";
import { ToolSection } from "../design/tool-section";
import type { BrushPreset, BrushSettings } from "@/lib/studio/pro/brush-presets";
import type { CloneSource } from "@/lib/studio/pro/model";
export function ProNumber({
  label,
  value,
  min = -100000,
  max = 100000,
  step = 1,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <label className="pro-field">
      {label}
      <input
        className="field"
        type="number"
        disabled={disabled}
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
  anchorControls,
  appearanceControls,
  selected,
  documentSize,
  onPatch,
  selection,
  onSelection,
  onMask,
  brush,
  onBrush,
  brushPresets,
  onApplyBrushPreset,
  onSaveBrushPreset,
  pressureGamma,
  onPressureGamma,
  onPresets,
  cloneSource,
  cloneSampleArmed,
  onArmCloneSample,
  onCloneAlignment,
  maskMode,
  setMaskMode,
  maskClipboard,
  onCopyMask,
  onPasteMask,
  onApplyMask,
}: {
  anchorControls?: ReactNode;
  appearanceControls?: ReactNode;
  selected?: Layer;
  documentSize?: { width: number; height: number };
  onPatch: (p: Partial<Layer>, group?: string) => void;
  selection: Selection;
  onSelection: (s: Selection) => void;
  onMask: () => void;
  brush: Omit<Stroke, "points" | "erase">;
  onBrush: (p: Partial<Stroke>) => void;
  brushPresets: BrushPreset[];
  onApplyBrushPreset: (settings: BrushSettings, tool?: "brush" | "pencil" | "eraser") => void;
  onSaveBrushPreset: (name: string) => boolean;
  pressureGamma: number;
  onPressureGamma: (gamma: number) => void;
  onPresets: (presets: BrushPreset[]) => void;
  cloneSource: CloneSource | null;
  cloneSampleArmed: boolean;
  onArmCloneSample: () => void;
  onCloneAlignment: (aligned: boolean) => void;
  maskMode: boolean;
  setMaskMode: (v: boolean) => void;
  maskClipboard: boolean;
  onCopyMask: () => void;
  onPasteMask: () => void;
  onApplyMask: () => void;
}) {
  return (
    <div className="pro-properties-content">
      <ToolSection title="Brush & selection" defaultOpen>
        <ProBrushSettings
          brush={brush}
          onBrush={onBrush}
          brushPresets={brushPresets}
          onPresets={onPresets}
          onApplyBrushPreset={onApplyBrushPreset}
          onSaveBrushPreset={onSaveBrushPreset}
          pressureGamma={pressureGamma}
          onPressureGamma={onPressureGamma}
        />
        <ToolSection title="Clone & Healing source" defaultOpen={false}>
          <p className="pro-help">
            Clone Stamp copies the sampled pixels. Healing Brush uses the same full-resolution
            texture sample and blends its tone using the undamaged surrounding pixels; it does not
            use generative AI. Desktop: hold Alt/Option and click a source point. Touch: arm source
            selection, then tap the canvas.
          </p>
          <Button variant={cloneSampleArmed ? "secondary" : "ghost"} onClick={onArmCloneSample}>
            {cloneSampleArmed ? "Tap canvas to set source" : "Set sample source"}
          </Button>
          <p className="pro-help" role="status">
            {cloneSource
              ? `Source ${Math.round(cloneSource.point.x)}, ${Math.round(cloneSource.point.y)} · ${cloneSource.width} × ${cloneSource.height} px`
              : "No source sampled yet."}
          </p>
          <label className="pro-check">
            <input
              type="checkbox"
              aria-label="Aligned Clone Stamp"
              checked={cloneSource?.aligned ?? true}
              disabled={!cloneSource}
              onChange={(e) => onCloneAlignment(e.target.checked)}
            />
            Aligned sampling
          </label>
          <p className="pro-help">
            Painting creates editable Clone Stamp strokes in a separate paint layer; the sampled
            composite is embedded in the native project.
          </p>
        </ToolSection>
        <p className="pro-help">
          Spot Healing automatically searches nearby opaque texture. Patch Repair: draw a
          destination rectangle, then tap the matching source region center. Hardness controls
          patch-edge softness. Repairs use traditional pixel processing, with the active selection
          and target layer mask preserved.
        </p>
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
                {BLEND_GROUPS.map((group, index) => (
                  <optgroup key={group[0]} label={BLEND_GROUP_NAMES[index]}>
                    {group.map((mode) => (
                      <option key={mode} value={mode}>
                        {BLEND_LABELS[mode]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {maskMode && (
              <p className="pro-help">
                Mask selected. Use Free Transform (F) to move, resize, rotate or flip this mask.
              </p>
            )}
            {selected.kind !== "group" && !maskMode && (
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
                <fieldset disabled={selected.appearance !== undefined}>
                  {selected.appearance !== undefined && (
                    <p className="pro-help">
                      This object uses an editable Appearance stack. Edit its paints in the
                      Appearance panel; Reset there restores basic styling.
                    </p>
                  )}
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
                </fieldset>
                {selected.shape === "path" && (
                  <>
                    <label className="pro-field">
                      Path fill rule
                      <select
                        className="field"
                        aria-label="Path fill rule"
                        disabled={selected.appearance !== undefined}
                        value={selected.fillRule ?? "nonzero"}
                        onChange={(e) => onPatch({ fillRule: e.target.value as Layer["fillRule"] })}
                      >
                        <option value="nonzero">Non-zero winding</option>
                        <option value="evenodd">Even-odd · alternating holes</option>
                      </select>
                    </label>
                    {anchorControls}
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
                {selected.textPath && anchorControls}
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
                    value={selected.lettering?.font ?? selected.fontFamily}
                    onChange={(e) => onPatch({ fontFamily: e.target.value as Layer["fontFamily"] })}
                  >
                    {selected.lettering &&
                      !["Arial", "Georgia", "monospace"].includes(selected.lettering.font) && (
                        <option disabled value={selected.lettering.font}>
                          {selected.lettering.font} · Dialogue font
                        </option>
                      )}
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
                    disabled={!!selected.textPath}
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
                {selected.appearance !== undefined && (
                  <p className="pro-help">
                    Edit this text object’s paints with the legacy Vector tools’ Appearance panel
                    (Vector button above).
                  </p>
                )}
                <label className="pro-field">
                  Text fill
                  <input
                    type="color"
                    aria-label="Text fill"
                    disabled={selected.appearance !== undefined}
                    value={selected.fill === "transparent" ? "#172420" : selected.fill}
                    onChange={(e) => onPatch({ fill: e.target.value }, "fill")}
                  />
                </label>
              </ToolSection>
            )}
            {selected.kind !== "group" && !selected.adjustmentLayer && (
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
            {selected.kind !== "group" && !selected.adjustmentLayer && (
              <ProColor
                layer={selected}
                selection={selection}
                documentSize={documentSize}
                onPatch={onPatch}
              />
            )}
            {appearanceControls ?? <ProAppearance layer={selected} onPatch={onPatch} />}
            <ToolSection title="Layer mask">
              <p className="pro-help">
                White reveals, eraser hides. The source pixels remain intact. A selection becomes a
                local mask on this layer.
              </p>
              <Button variant="secondary" onClick={onMask}>
                Mask from selection
              </Button>
              <Button variant="ghost" disabled={!maskClipboard} onClick={onPasteMask}>
                Paste mask in canvas position
              </Button>
              {selected.mask && (
                <>
                  <ProMaskThumbnail layer={selected} />
                  <div className="pro-actions">
                    <Button
                      variant="secondary"
                      disabled={!!selected.transform.deform}
                      onClick={onCopyMask}
                    >
                      Copy mask
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!!selected.transform.deform}
                      onClick={() =>
                        onPatch({ mask: setMaskLinked(selected, selected.mask!.linked === false) })
                      }
                    >
                      {selected.mask.linked === false
                        ? "Link mask to layer"
                        : "Unlink mask from layer"}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={
                        !selected.mask.enabled || !["raster", "paint"].includes(selected.kind)
                      }
                      onClick={onApplyMask}
                    >
                      Bake layer and mask (destructive)
                    </Button>
                  </div>
                  <div className="pro-number-grid">
                    <ProNumber
                      label="Mask density"
                      value={(selected.mask.density ?? 1) * 100}
                      min={0}
                      max={100}
                      onChange={(n) =>
                        onPatch({ mask: { ...selected.mask!, density: n / 100 } }, "mask-density")
                      }
                    />
                    <ProNumber
                      label="Mask feather"
                      value={selected.mask.feather ?? 0}
                      min={0}
                      max={100}
                      onChange={(n) =>
                        onPatch({ mask: { ...selected.mask!, feather: n } }, "mask-feather")
                      }
                    />
                  </div>
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
          </fieldset>
        </>
      )}
    </div>
  );
}
