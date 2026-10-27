import { AdvancedGradientStops } from "./pro-gradient-stops";
import { BLEND_LABELS } from "@/lib/studio/pro/blend";
import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import { GradientStops } from "./pro-color";
import { ToolSection } from "../design/tool-section";
import type { Layer } from "@/lib/studio/pro/model";
import { advancedGradient, defaultGradient, type Gradient } from "@/lib/studio/pro/gradient";
import { EFFECT_NAMES, defaultEffect, advancedEffect, type Effect } from "@/lib/studio/pro/effects";
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
          {value.version === 2 && (
            <>
              <option value="angular">Angular</option>
              <option value="reflected">Reflected</option>
              <option value="diamond">Diamond</option>
            </>
          )}
        </select>
      </label>
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
      {value.version === 2 ? (
        <>
          <label className="pro-field">
            {prefix} interpolation
            <select
              className="field"
              aria-label={`${prefix} interpolation`}
              value={value.interpolation}
              onChange={(e) =>
                onChange({ ...value, interpolation: e.target.value as Gradient["interpolation"] })
              }
            >
              <option value="rgb">RGB</option>
              <option value="oklab">OKLab</option>
            </select>
          </label>
          <ProNumber
            label={`${prefix} smoothness`}
            min={0}
            max={100}
            value={(value.smoothness ?? 0) * 100}
            onChange={(v) => onChange({ ...value, smoothness: v / 100 })}
          />
          <label className="pro-check">
            <input
              type="checkbox"
              aria-label={`${prefix} reverse`}
              checked={value.reverse}
              onChange={(e) => onChange({ ...value, reverse: e.target.checked })}
            />
            Reverse colors
          </label>
          <AdvancedGradientStops value={value} onChange={onChange} />
        </>
      ) : (
        <GradientStops stops={value.stops} onChange={(stops) => onChange({ ...value, stops })} />
      )}
    </>
  );
}
export function ProAppearance({
  layer,
  onPatch,
  advanced = false,
  showGradient = true,
  showEffects = true,
  onPatternImport,
}: {
  layer: Layer;
  advanced?: boolean;
  showGradient?: boolean;
  showEffects?: boolean;
  onPatch: (p: Partial<Layer>, group?: string) => void;
  onPatternImport?: (file: File) => void;
}) {
  const effects = layer.effects ?? [],
    set = (kind: Effect["kind"], patch: Partial<Effect>) =>
      onPatch(
        {
          effects: effects.map((e) =>
            e.kind === kind
              ? {
                  ...e,
                  ...patch,
                  ...(advanced
                    ? {
                        version:
                          (patch.pattern ?? e.pattern)?.kind === "bitmap"
                            ? (3 as const)
                            : (2 as const),
                      }
                    : {}),
                }
              : e,
          ),
        },
        `effect-${kind}-${Object.keys(patch).join("-")}`,
      );
  return (
    <>
      {showGradient && layer.kind === "gradient" && (
        <ToolSection title="Editable gradient layer" defaultOpen>
          <p className="pro-help">
            Color and opacity stops remain editable. Angle, scale and center update the canvas live;
            Free Transform moves its source plane.
          </p>
          <GradientFields
            value={
              advanced ? { ...advancedGradient(), ...layer.gradient, version: 2 } : layer.gradient!
            }
            onChange={(gradient) => onPatch({ gradient }, "gradient-properties")}
          />
          <Button
            variant="ghost"
            onClick={() => onPatch({ gradient: advanced ? advancedGradient() : defaultGradient() })}
          >
            Reset gradient layer
          </Button>
        </ToolSection>
      )}
      {showEffects &&
        (layer.kind === "adjustment" ? (
          <p className="pro-help">
            Independent adjustment layer: affects visible siblings below in this isolated group. Its
            mask/transform sets coverage, and opacity/blend controls strength. Clip it to an artwork
            base to limit its backdrop. It preserves backdrop alpha.
          </p>
        ) : (
          <ToolSection title="Editable layer effects" defaultOpen={advanced}>
            <p className="pro-help">
              Styles remain editable and follow the masked artwork. Exterior styles render behind
              the fill; interior styles and overlays preserve fill alpha. Order is bottom to top
              within each plane. Radius/distance/size use document pixels, independent of object
              scale. Layer opacity and clipping apply to the result once.
            </p>
            {(Object.keys(EFFECT_NAMES) as Effect["kind"][])
              .filter((k) => advanced || !["patternOverlay", "bevel"].includes(k))
              .map((kind) => (
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
                          : [...effects, advanced ? advancedEffect(kind) : defaultEffect(kind)],
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
                  {advanced && (
                    <>
                      <label className="pro-field">
                        {EFFECT_NAMES[e.kind]} blend
                        <select
                          className="field"
                          aria-label={`${EFFECT_NAMES[e.kind]} blend`}
                          value={e.blend}
                          onChange={(v) =>
                            set(e.kind, { blend: v.target.value as Effect["blend"] })
                          }
                        >
                          {Object.entries(BLEND_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {["dropShadow", "innerShadow", "bevel"].includes(e.kind) && (
                        <label className="pro-check">
                          <input
                            type="checkbox"
                            aria-label={`${EFFECT_NAMES[e.kind]} global light`}
                            checked={e.globalLight ?? false}
                            onChange={(v) => set(e.kind, { globalLight: v.target.checked })}
                          />
                          Use shared light
                        </label>
                      )}
                      {["dropShadow", "outerGlow"].includes(e.kind) && (
                        <ProNumber
                          label={`${EFFECT_NAMES[e.kind]} spread`}
                          min={0}
                          max={64}
                          value={e.spread ?? 0}
                          onChange={(spread) => set(e.kind, { spread })}
                        />
                      )}
                      {["innerShadow", "innerGlow"].includes(e.kind) && (
                        <ProNumber
                          label={`${EFFECT_NAMES[e.kind]} choke`}
                          min={0}
                          max={64}
                          value={e.choke ?? 0}
                          onChange={(choke) => set(e.kind, { choke })}
                        />
                      )}
                      {e.kind === "innerGlow" && (
                        <label className="pro-field">
                          Inner Glow source
                          <select
                            className="field"
                            aria-label="Inner Glow source"
                            value={e.glowSource ?? "edge"}
                            onChange={(v) =>
                              set(e.kind, { glowSource: v.target.value as Effect["glowSource"] })
                            }
                          >
                            <option value="edge">Edge</option>
                            <option value="center">Center</option>
                          </select>
                        </label>
                      )}
                      {["stroke", "innerGlow", "outerGlow"].includes(e.kind) && (
                        <label className="pro-field">
                          {EFFECT_NAMES[e.kind]} fill
                          <select
                            className="field"
                            aria-label={`${EFFECT_NAMES[e.kind]} fill`}
                            value={e.fillKind ?? "solid"}
                            onChange={(v) =>
                              set(e.kind, { fillKind: v.target.value as Effect["fillKind"] })
                            }
                          >
                            <option value="solid">Solid</option>
                            <option value="gradient">Gradient</option>
                          </select>
                        </label>
                      )}
                      {e.kind === "patternOverlay" && e.pattern && (
                        <>
                          <label className="pro-field">
                            Pattern texture
                            <select
                              className="field"
                              aria-label="Pattern texture"
                              value={e.pattern.kind}
                              onChange={(v) =>
                                set(e.kind, {
                                  pattern: {
                                    kind: v.target.value as NonNullable<Effect["pattern"]>["kind"],
                                    scale: e.pattern!.scale,
                                    offsetX: e.pattern!.offsetX,
                                    offsetY: e.pattern!.offsetY,
                                    color2: e.pattern!.color2,
                                  },
                                })
                              }
                            >
                              {[
                                "checker",
                                "stripes",
                                "dots",
                                ...(e.pattern.kind === "bitmap" ? ["bitmap"] : []),
                              ].map((k) => (
                                <option key={k}>{k}</option>
                              ))}
                            </select>
                          </label>
                          {onPatternImport && (
                            <label className="pro-field">
                              Import bitmap pattern (up to512px per side /2MB)
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                aria-label="Import bitmap pattern"
                                onChange={(ev) => {
                                  const file = ev.target.files?.[0];
                                  ev.target.value = "";
                                  if (file) onPatternImport(file);
                                }}
                              />
                            </label>
                          )}
                          <label className="pro-field" hidden={e.pattern.kind === "bitmap"}>
                            Pattern second color
                            <input
                              type="color"
                              aria-label="Pattern second color"
                              value={e.pattern.color2}
                              onChange={(v) =>
                                set(e.kind, { pattern: { ...e.pattern!, color2: v.target.value } })
                              }
                            />
                          </label>
                          {(["scale", "offsetX", "offsetY"] as const).map((k) => (
                            <ProNumber
                              key={k}
                              label={`Pattern ${k}`}
                              min={k === "scale" ? 0.1 : -4096}
                              max={k === "scale" ? 32 : 4096}
                              step={k === "scale" ? 0.1 : 1}
                              value={e.pattern![k]}
                              onChange={(v) => set(e.kind, { pattern: { ...e.pattern!, [k]: v } })}
                            />
                          ))}
                        </>
                      )}
                      {e.kind === "bevel" && e.bevel && (
                        <>
                          <ProNumber
                            label="Bevel size"
                            min={0}
                            max={64}
                            value={e.size}
                            onChange={(size) => set(e.kind, { size })}
                          />
                          <ProNumber
                            label="Bevel lighting angle"
                            disabled={!!e.globalLight}
                            min={-360}
                            max={360}
                            value={e.angle}
                            onChange={(angle) => set(e.kind, { angle })}
                          />
                          <label className="pro-field">
                            Bevel direction
                            <select
                              className="field"
                              aria-label="Bevel direction"
                              value={e.bevel.direction}
                              onChange={(v) =>
                                set(e.kind, {
                                  bevel: {
                                    ...e.bevel!,
                                    direction: v.target.value as "up" | "down",
                                  },
                                })
                              }
                            >
                              <option value="up">Up</option>
                              <option value="down">Down</option>
                            </select>
                          </label>
                          {(
                            [
                              "depth",
                              "soften",
                              "elevation",
                              "highlightOpacity",
                              "shadowOpacity",
                            ] as const
                          ).map((k) => (
                            <ProNumber
                              key={k}
                              label={`Bevel ${k}`}
                              min={k === "elevation" ? 1 : 0}
                              max={
                                k.includes("Opacity")
                                  ? 1
                                  : k === "elevation"
                                    ? 89
                                    : k === "soften"
                                      ? 32
                                      : 10
                              }
                              step={k.includes("Opacity") || k === "depth" ? 0.1 : 1}
                              value={e.bevel![k]}
                              onChange={(v) => set(e.kind, { bevel: { ...e.bevel!, [k]: v } })}
                            />
                          ))}
                          {(["highlight", "shadow"] as const).map((k) => (
                            <label className="pro-field" key={k}>
                              Bevel {k} color
                              <input
                                type="color"
                                aria-label={`Bevel ${k} color`}
                                value={e.bevel![k]}
                                onChange={(v) =>
                                  set(e.kind, { bevel: { ...e.bevel!, [k]: v.target.value } })
                                }
                              />
                            </label>
                          ))}
                        </>
                      )}
                    </>
                  )}
                  {e.kind !== "gradientOverlay" &&
                    e.kind !== "bevel" &&
                    !(advanced && e.fillKind === "gradient") && (
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
                        disabled={advanced && !!e.globalLight}
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
                  {(e.kind === "gradientOverlay" || (advanced && e.fillKind === "gradient")) && (
                    <GradientFields
                      prefix="Overlay gradient"
                      value={
                        advanced ? { ...advancedGradient(), ...e.gradient, version: 2 } : e.gradient
                      }
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
                            v.kind === e.kind
                              ? advanced
                                ? advancedEffect(e.kind)
                                : defaultEffect(e.kind)
                              : v,
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
        ))}
    </>
  );
}
