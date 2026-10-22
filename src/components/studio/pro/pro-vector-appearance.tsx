import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import { GradientStops } from "./pro-color";
import { Plus, Copy, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import {
  appearance,
  appearanceItem,
  defaultVectorGradient,
  VECTOR_BLENDS,
  type AppearanceItem,
  type VectorGradient,
} from "@/lib/studio/pro/vector-appearance";
import type { Layer } from "@/lib/studio/pro/model";
export function ProVectorAppearance({
  layer: l,
  selectedId,
  onSelect,
  onPatch,
  clipboard,
  onCopy,
  onGradient,
}: {
  layer?: Layer;
  selectedId: string;
  onSelect: (id: string) => void;
  onPatch: (p: Partial<Layer>, group?: string) => void;
  clipboard: AppearanceItem[] | null;
  onCopy: (a: AppearanceItem[]) => void;
  onGradient: () => void;
}) {
  if (!l || !["shape", "text"].includes(l.kind))
    return (
      <p className="pro-help">Select a vector object or editable text to manage its appearance.</p>
    );
  const stack = appearance(l),
    current = stack.find((a) => a.id === selectedId) ?? stack[0];
  const set = (items: AppearanceItem[], group?: string) =>
    onPatch({ appearance: items, ...(l.kind === "shape" ? { vectorOverflow: true } : {}) }, group);
  const patch = (p: Partial<AppearanceItem>, group?: string) =>
    current &&
    set(
      stack.map((a) => (a.id === current.id ? { ...a, ...p } : a)),
      group ? `appearance:${current.id}:${group}` : undefined,
    );
  const gradient = current?.paint.gradient;
  const changeGradient = (p: Partial<VectorGradient>, group = Object.keys(p).join()) =>
    gradient && patch({ paint: { ...current!.paint, gradient: { ...gradient, ...p } } }, group);
  const reorder = (direction: number) => {
    if (!current) return;
    const a = [...stack],
      i = a.indexOf(current),
      j = i + direction;
    if (j >= 0 && j < a.length) {
      [a[i], a[j]] = [a[j]!, a[i]!];
      set(a);
    }
  };
  return (
    <fieldset className="pro-layout-panel" disabled={l.locked}>
      <h3>Vector appearance</h3>
      {!!l.vectorClips?.length && (
        <div className="pro-layout-panel">
          <h4>Imported clipping geometry</h4>
          <p className="pro-help">
            Editable binary SVG clips/masks. Coordinates follow this object. Disabling or removing a
            clip preserves the underlying artwork.
          </p>
          {l.vectorClips.map((c, index) => (
            <div className="pro-layout-actions" key={index}>
              <label className="pro-check">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) =>
                    onPatch({
                      vectorClips: l.vectorClips!.map((p, i) =>
                        i === index ? { ...p, enabled: e.target.checked } : p,
                      ),
                    })
                  }
                />
                Clip {index + 1} enabled
              </label>
              <Button
                variant="secondary"
                onClick={() =>
                  onPatch({ vectorClips: l.vectorClips!.filter((_, i) => i !== index) })
                }
              >
                Remove clip {index + 1}
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="pro-help">
        Bottom-to-top stack, isolated inside this object. Advanced appearance overrides its basic
        fill/stroke; Reset restores those basic properties.
      </p>
      <div className="pro-layout-actions">
        {(["fill", "stroke"] as const).map((kind) => (
          <Button
            key={kind}
            disabled={stack.length >= 16}
            onClick={() => {
              const a = appearanceItem(kind, l);
              if (a.paint.color === "transparent") a.paint.color = "#a4efd6";
              if (kind === "stroke" && !a.width) a.width = 3;
              set([...stack, a]);
              onSelect(a.id);
            }}
          >
            <Plus />
            Add {kind}
          </Button>
        ))}
      </div>
      <label className="pro-field">
        Appearance item
        <select
          className="field"
          aria-label="Appearance item"
          value={current?.id ?? ""}
          onChange={(e) => onSelect(e.target.value)}
        >
          {stack.map((a, i) => (
            <option key={a.id} value={a.id}>
              {i + 1}. {a.kind}
              {a.paint.gradient ? ` · ${a.paint.gradient.kind}` : ""}
              {a.visible ? "" : " · hidden"}
            </option>
          ))}
        </select>
      </label>
      <div className="pro-layout-actions">
        <Button
          variant="secondary"
          disabled={!current || stack.length >= 16}
          onClick={() => {
            const a = { ...structuredClone(current!), id: crypto.randomUUID() };
            set([...stack, a]);
            onSelect(a.id);
          }}
        >
          <Copy />
          Duplicate item
        </Button>
        <Button
          variant="secondary"
          disabled={!current}
          onClick={() => set(stack.filter((a) => a.id !== current!.id))}
        >
          <Trash2 />
          Remove item
        </Button>
        <Button
          variant="secondary"
          disabled={!current || stack[0]?.id === current.id}
          onClick={() => reorder(-1)}
        >
          <ArrowDown />
          Lower item
        </Button>
        <Button
          variant="secondary"
          disabled={!current || stack.at(-1)?.id === current.id}
          onClick={() => reorder(1)}
        >
          <ArrowUp />
          Raise item
        </Button>
        <Button variant="secondary" onClick={() => onCopy(structuredClone(stack))}>
          Copy appearance
        </Button>
        <Button
          variant="secondary"
          disabled={!clipboard}
          onClick={() =>
            set(clipboard!.map((a) => ({ ...structuredClone(a), id: crypto.randomUUID() })))
          }
        >
          Paste appearance
        </Button>
      </div>
      <Button
        variant="ghost"
        disabled={l.appearance === undefined}
        onClick={() => onPatch({ appearance: undefined })}
      >
        Reset appearance to basic styles
      </Button>
      {current && (
        <>
          <label className="pro-check">
            <input
              type="checkbox"
              checked={current.visible}
              onChange={(e) => patch({ visible: e.target.checked })}
            />
            Appearance item visible
          </label>
          <ProNumber
            label="Appearance opacity %"
            value={current.opacity * 100}
            min={0}
            max={100}
            onChange={(n) => patch({ opacity: n / 100 }, "opacity")}
          />
          <label className="pro-field">
            Appearance blend
            <select
              className="field"
              aria-label="Appearance blend"
              value={current.blend}
              onChange={(e) => patch({ blend: e.target.value as AppearanceItem["blend"] })}
            >
              {VECTOR_BLENDS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="pro-field">
            Paint
            <select
              className="field"
              aria-label="Vector paint type"
              value={gradient?.kind ?? "solid"}
              onChange={(e) =>
                patch({
                  paint: {
                    ...current.paint,
                    gradient:
                      e.target.value === "solid"
                        ? undefined
                        : {
                            ...(gradient ?? defaultVectorGradient()),
                            kind: e.target.value as "linear" | "radial",
                            from:
                              e.target.value === "radial" ? { x: 0.5, y: 0.5 } : { x: 0, y: 0.5 },
                            to: e.target.value === "radial" ? { x: 0.5, y: 0.5 } : { x: 1, y: 0.5 },
                          },
                  },
                })
              }
            >
              <option value="solid">Solid</option>
              <option value="linear">Linear gradient</option>
              <option value="radial">Radial gradient</option>
            </select>
          </label>
          {!gradient && (
            <>
              <label className="pro-field">
                Paint color
                <input
                  type="color"
                  aria-label="Appearance color"
                  value={current.paint.color === "transparent" ? "#000000" : current.paint.color}
                  onChange={(e) => patch({ paint: { color: e.target.value } }, "color")}
                />
              </label>
              <label className="pro-check">
                <input
                  type="checkbox"
                  checked={current.paint.color === "transparent"}
                  onChange={(e) =>
                    patch({ paint: { color: e.target.checked ? "transparent" : "#a4efd6" } })
                  }
                />
                Transparent paint
              </label>
            </>
          )}
          <label className="pro-field">
            Fill rule
            <select
              className="field"
              aria-label="Appearance fill rule"
              value={current.fillRule}
              onChange={(e) => patch({ fillRule: e.target.value as AppearanceItem["fillRule"] })}
            >
              <option value="nonzero">Non-zero</option>
              <option value="evenodd">Even-odd</option>
            </select>
          </label>
          {current.kind === "stroke" && (
            <>
              <ProNumber
                label="Appearance stroke width"
                value={current.width}
                min={0}
                max={100}
                onChange={(width) => patch({ width }, "width")}
              />
              <label className="pro-field">
                Stroke alignment
                <select
                  className="field"
                  aria-label="Appearance stroke alignment"
                  value={current.alignment}
                  onChange={(e) =>
                    patch({ alignment: e.target.value as AppearanceItem["alignment"] })
                  }
                >
                  {["center", "inside", "outside"].map((a) => (
                    <option
                      key={a}
                      disabled={
                        a !== "center" &&
                        (l.kind === "text" ||
                          l.shape === "line" ||
                          (l.shape === "path" &&
                            (!l.closed || l.subpaths?.some((c) => !c.closed) || !!l.pathData)))
                      }
                    >
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pro-field">
                Stroke dash array
                <input
                  key={current.id + current.dash.join()}
                  className="field"
                  aria-label="Appearance dash array"
                  defaultValue={current.dash.join(" ")}
                  placeholder="empty = solid; 6 3; 0 6 = dots with round cap"
                  onBlur={(e) => {
                    const dash = e.target.value.trim()
                      ? e.target.value.trim().split(/[ ,]+/).map(Number)
                      : [];
                    patch({ dash });
                  }}
                />
              </label>
              <ProNumber
                label="Appearance dash offset"
                value={current.dashOffset}
                onChange={(dashOffset) => patch({ dashOffset }, "dash-offset")}
              />
              <label className="pro-field">
                Line cap
                <select
                  className="field"
                  aria-label="Appearance line cap"
                  value={current.cap}
                  onChange={(e) => patch({ cap: e.target.value as AppearanceItem["cap"] })}
                >
                  {["butt", "round", "square"].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="pro-field">
                Line join
                <select
                  className="field"
                  aria-label="Appearance line join"
                  value={current.join}
                  onChange={(e) => patch({ join: e.target.value as AppearanceItem["join"] })}
                >
                  {["miter", "round", "bevel"].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <ProNumber
                label="Appearance miter limit"
                value={current.miterLimit}
                min={1}
                max={1000}
                onChange={(miterLimit) => patch({ miterLimit }, "miter")}
              />
            </>
          )}
          {gradient && (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  onSelect(current.id);
                  onGradient();
                }}
              >
                Edit gradient on canvas · G
              </Button>
              <p className="pro-help">
                Object-bounds coordinates are fractions of geometric bounds. User-space coordinates
                are local pixels. Radial From is the focal point; To is the center. Text uses its
                editable frame.
              </p>
              <label className="pro-field">
                Gradient coordinates
                <select
                  className="field"
                  aria-label="Vector gradient units"
                  value={gradient.units}
                  onChange={(e) =>
                    changeGradient({ units: e.target.value as VectorGradient["units"] })
                  }
                >
                  <option value="objectBoundingBox">Object bounds · fractions</option>
                  <option value="userSpaceOnUse">Local user space · pixels</option>
                </select>
              </label>
              <div className="pro-layout-actions">
                {(["from", "to"] as const).flatMap((k) =>
                  (["x", "y"] as const).map((axis) => (
                    <ProNumber
                      key={k + axis}
                      label={`Vector gradient ${k} ${axis}`}
                      value={gradient[k][axis]}
                      step={0.01}
                      onChange={(n) =>
                        changeGradient({ [k]: { ...gradient[k], [axis]: n } }, k + axis)
                      }
                    />
                  )),
                )}
              </div>
              {gradient.kind === "linear" ? (
                <ProNumber
                  label="Vector gradient angle"
                  value={
                    (Math.atan2(gradient.to.y - gradient.from.y, gradient.to.x - gradient.from.x) *
                      180) /
                    Math.PI
                  }
                  min={-360}
                  max={360}
                  onChange={(n) => {
                    const r = Math.hypot(
                        gradient.to.x - gradient.from.x,
                        gradient.to.y - gradient.from.y,
                      ),
                      a = (n * Math.PI) / 180;
                    changeGradient(
                      {
                        to: {
                          x: gradient.from.x + r * Math.cos(a),
                          y: gradient.from.y + r * Math.sin(a),
                        },
                      },
                      "angle",
                    );
                  }}
                />
              ) : (
                <ProNumber
                  label="Vector gradient radius"
                  value={gradient.radius}
                  min={0.00001}
                  max={100000}
                  step={0.01}
                  onChange={(radius) => changeGradient({ radius }, "radius")}
                />
              )}
              <div className="pro-layout-actions">
                {gradient.matrix.map((n, i) => (
                  <ProNumber
                    key={i}
                    label={`Vector gradient matrix ${"abcdef"[i]}`}
                    value={n}
                    step={0.01}
                    onChange={(n) => {
                      const matrix = [...gradient.matrix] as VectorGradient["matrix"];
                      matrix[i] = n;
                      changeGradient({ matrix }, "matrix" + i);
                    }}
                  />
                ))}
              </div>
              <GradientStops
                stops={gradient.stops}
                onChange={(stops) => changeGradient({ stops }, "stops")}
              />
              <Button
                variant="ghost"
                onClick={() => patch({ paint: { color: current.paint.color } })}
              >
                Remove gradient
              </Button>
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
