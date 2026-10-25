import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import { GradientStops } from "./pro-color";
import { ToolSection } from "../design/tool-section";
import type { Layer } from "@/lib/studio/pro/model";
import { defaultGradient, type Gradient } from "@/lib/studio/pro/gradient";
import { reverseStops } from "@/lib/studio/pro/raster-gradient";
import { EFFECT_NAMES, defaultEffect, type Effect } from "@/lib/studio/pro/effects";
export function GradientFields({
  value,
  onChange,
  prefix = "Gradient",
}: {
  value: Gradient;
  onChange: (g: Gradient) => void;
  prefix?: string;
}) {
  return (
    <>
      <label className="pro-field">
        {prefix} type
        <select
          className="field"
          aria-label={`${prefix} type`}
          value={value.kind}
          onChange={(e) => onChange({ ...value, kind: e.target.value as Gradient["kind"] })}
        >
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
      </label>
      {value.kind === "radial" && (
        <label className="pro-field">
          {prefix} radial shape
          <select
            className="field"
            aria-label={`${prefix} radial shape`}
            value={value.radialShape ?? "ellipse"}
            onChange={(e) =>
              onChange({ ...value, radialShape: e.target.value as "ellipse" | "circle" })
            }
          >
            <option value="ellipse">Ellipse (fits layer)</option>
            <option value="circle">Circle</option>
          </select>
        </label>
      )}
      <div className="pro-number-grid">
        <ProNumber
          label={`${prefix} angle`}
          min={-360}
          max={360}
          value={value.angle}
          onChange={(angle) => onChange({ ...value, angle })}
        />
        <ProNumber
          label={`${prefix} scale`}
          min={1}
          max={1000}
          value={value.scale * 100}
          onChange={(scale) => onChange({ ...value, scale: scale / 100 })}
        />
        <ProNumber
          label={`${prefix} center X`}
          min={-200}
          max={300}
          value={value.center.x * 100}
          onChange={(x) => onChange({ ...value, center: { ...value.center, x: x / 100 } })}
        />
        <ProNumber
          label={`${prefix} center Y`}
          min={-200}
          max={300}
          value={value.center.y * 100}
          onChange={(y) => onChange({ ...value, center: { ...value.center, y: y / 100 } })}
        />
      </div>
      <GradientStops stops={value.stops} onChange={(stops) => onChange({ ...value, stops })} />
      <Button
        variant="ghost"
        aria-label={`Reverse ${prefix.toLowerCase()} stops`}
        onClick={() => onChange({ ...value, stops: reverseStops(value.stops) })}
      >
        Reverse stops
      </Button>
    </>
  );
}
export function ProAppearance({
  layer,
  onPatch,
}: {
  layer: Layer;
  onPatch: (p: Partial<Layer>, group?: string) => void;
}) {
  const effects = layer.effects ?? [],
    set = (kind: Effect["kind"], patch: Partial<Effect>) =>
      onPatch(
        { effects: effects.map((e) => (e.kind === kind ? { ...e, ...patch } : e)) },
        `effect-${kind}-${Object.keys(patch).join("-")}`,
      );
  return (
    <>
      {layer.kind === "gradient" && (
        <ToolSection title="Editable gradient layer" defaultOpen>
          <p className="pro-help">
            Color and opacity stops remain editable. Angle, scale and center update the canvas live;
            Free Transform moves its source plane.
          </p>
          <GradientFields
            value={layer.gradient!}
            onChange={(gradient) => onPatch({ gradient }, "gradient-properties")}
          />
          <Button variant="ghost" onClick={() => onPatch({ gradient: defaultGradient() })}>
            Reset gradient layer
          </Button>
        </ToolSection>
      )}
      {layer.kind === "adjustment" ? (
        <p className="pro-help">
          Independent adjustment layer: affects visible siblings below in this isolated group. Its
          mask/transform sets coverage, and opacity/blend controls strength. Clip it to an artwork
          base to limit its backdrop. It preserves backdrop alpha.
        </p>
      ) : (
        <ToolSection title="Editable layer effects">
          <p className="pro-help">
            Styles remain editable and follow the masked artwork. Exterior styles render behind the
            fill; interior styles and overlays preserve fill alpha. Order is bottom to top within
            each plane. Radius/distance/size use document pixels, independent of object scale. Layer
            opacity and clipping apply to the result once.
          </p>
          {(Object.keys(EFFECT_NAMES) as Effect["kind"][]).map((kind) => (
            <label key={kind} className="pro-check">
              <input
                type="checkbox"
                aria-label={`Enable ${EFFECT_NAMES[kind]}`}
                checked={!!effects.find((e) => e.kind === kind)?.enabled}
                onChange={(event) =>
                  onPatch({
                    effects: effects.some((e) => e.kind === kind)
                      ? effects.map((e) =>
                          e.kind === kind ? { ...e, enabled: event.target.checked } : e,
                        )
                      : [...effects, defaultEffect(kind)],
                  })
                }
              />
              {EFFECT_NAMES[kind]}
            </label>
          ))}
          {effects
            .filter((e) => e.enabled)
            .map((e) => (
              <div key={e.kind} className="pro-effect-properties">
                <h4>{EFFECT_NAMES[e.kind]}</h4>
                <ProNumber
                  label={`${EFFECT_NAMES[e.kind]} opacity`}
                  min={0}
                  max={100}
                  value={e.opacity * 100}
                  onChange={(opacity) => set(e.kind, { opacity: opacity / 100 })}
                />
                {e.kind !== "gradientOverlay" && (
                  <label className="pro-field">
                    {EFFECT_NAMES[e.kind]} color
                    <input
                      type="color"
                      aria-label={`${EFFECT_NAMES[e.kind]} color`}
                      value={e.color}
                      onChange={(v) => set(e.kind, { color: v.target.value })}
                    />
                  </label>
                )}
                {["dropShadow", "innerShadow", "outerGlow", "innerGlow"].includes(e.kind) && (
                  <ProNumber
                    label={`${EFFECT_NAMES[e.kind]} radius`}
                    min={0}
                    max={64}
                    value={e.radius}
                    onChange={(radius) => set(e.kind, { radius })}
                  />
                )}
                {["dropShadow", "innerShadow"].includes(e.kind) && (
                  <div className="pro-number-grid">
                    <ProNumber
                      label={`${EFFECT_NAMES[e.kind]} distance`}
                      min={0}
                      max={256}
                      value={e.distance}
                      onChange={(distance) => set(e.kind, { distance })}
                    />
                    <ProNumber
                      label={`${EFFECT_NAMES[e.kind]} angle`}
                      min={-360}
                      max={360}
                      value={e.angle}
                      onChange={(angle) => set(e.kind, { angle })}
                    />
                  </div>
                )}
                {e.kind === "stroke" && (
                  <>
                    <ProNumber
                      label="Stroke effect size"
                      min={0}
                      max={64}
                      value={e.size}
                      onChange={(size) => set(e.kind, { size })}
                    />
                    <label className="pro-field">
                      Stroke effect position
                      <select
                        className="field"
                        aria-label="Stroke effect position"
                        value={e.position}
                        onChange={(v) =>
                          set(e.kind, { position: v.target.value as Effect["position"] })
                        }
                      >
                        {["inside", "outside", "center"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {e.kind === "gradientOverlay" && (
                  <GradientFields
                    prefix="Overlay gradient"
                    value={e.gradient}
                    onChange={(gradient) => set(e.kind, { gradient })}
                  />
                )}
                <div className="pro-actions">
                  {([-1, 1] as const).map((direction) => (
                    <Button
                      key={direction}
                      variant="secondary"
                      disabled={
                        effects.indexOf(e) + direction < 0 ||
                        effects.indexOf(e) + direction >= effects.length
                      }
                      onClick={() => {
                        const next = [...effects],
                          i = next.indexOf(e);
                        [next[i], next[i + direction]] = [next[i + direction]!, next[i]!];
                        onPatch({ effects: next });
                      }}
                    >
                      {direction < 0 ? "Move style earlier" : "Move style later"} ·{" "}
                      {EFFECT_NAMES[e.kind]}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    onClick={() =>
                      onPatch({
                        effects: effects.map((v) =>
                          v.kind === e.kind ? defaultEffect(e.kind) : v,
                        ),
                      })
                    }
                  >
                    Reset {EFFECT_NAMES[e.kind]}
                  </Button>
                </div>
              </div>
            ))}
          <Button variant="ghost" onClick={() => onPatch({ effects: undefined })}>
            Remove all layer effects
          </Button>
        </ToolSection>
      )}
    </>
  );
}
