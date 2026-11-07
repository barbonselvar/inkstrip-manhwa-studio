import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BOUNDARY_SHAPES,
  boundary as newBoundary,
  type Boundary,
} from "@/lib/studio/composition/boundaries";
import type { Fade } from "@/lib/studio/composition/model";
import type { Controller } from "@/lib/studio/composition/controller";
import {
  describeFade,
  editableEdgeFade,
  removePoint,
  resetAppearance,
  resetPosition,
  resetShape,
  reverseFade,
  smoothPoints,
  toEditable,
  uniqueFadeName,
} from "@/lib/studio/composition/fade-edit";
import { Check, Choice, Color } from "./properties";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  RotateCcw,
  FlipVertical2,
  PenLine,
  Spline,
} from "lucide-react";

/** Range slider plus exact numeric entry. The number field accepts values beyond the slider. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  inputMin = min,
  inputMax = max,
  scale = 1,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  inputMin?: number;
  inputMax?: number;
  /** Display multiplier (e.g. 100 for percentages). */
  scale?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = Math.round(value * scale * 100) / 100;
  return (
    <div className="composition-slider">
      <div className="composition-slider-head">
        <span>{label}</span>
        <input
          className="field"
          type="number"
          inputMode="decimal"
          aria-label={label}
          min={inputMin * scale}
          max={inputMax * scale}
          step={step * scale}
          value={text ?? String(shown)}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (
              e.target.value !== "" &&
              Number.isFinite(n) &&
              n >= inputMin * scale &&
              n <= inputMax * scale
            )
              onChange(n / scale);
          }}
          onBlur={() => setText(null)}
        />
        {unit && <small>{unit}</small>}
      </div>
      <input
        type="range"
        aria-label={`${label} slider`}
        min={min * scale}
        max={max * scale}
        step={step * scale}
        value={Math.max(min * scale, Math.min(max * scale, shown))}
        onChange={(e) => {
          setText(null);
          onChange(Number(e.target.value) / scale);
        }}
      />
    </div>
  );
}

/** Named, orderable fades of one panel with visibility, lock, duplicate and delete. */
export function FadeList({
  fades,
  selected,
  onSelect,
  onChange,
}: {
  fades: Fade[];
  selected?: string;
  onSelect: (id: string) => void;
  onChange: (fades: Fade[], selectId?: string | null) => void;
}) {
  if (!fades.length) return <p className="composition-hint">No fades on this panel yet.</p>;
  const patch = (id: string, p: Partial<Fade>) =>
    onChange(fades.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const move = (i: number, dir: 1 | -1) => {
    const list = [...fades],
      j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    onChange(list);
  };
  // Topmost first: the last fade in the array paints last.
  return (
    <ol className="composition-fade-list" aria-label="Fades on this panel">
      {fades
        .map((f, i) => ({ f, i }))
        .reverse()
        .map(({ f, i }) => (
          <li
            key={f.id}
            className={f.id === selected ? "is-selected" : ""}
            aria-current={f.id === selected}
          >
            <button
              className="composition-fade-list-name"
              aria-label={`Select fade ${f.name}`}
              onClick={() => onSelect(f.id)}
            >
              <strong>{f.name}</strong>
              <small>
                {describeFade(f)}
                {f.visible ? "" : " · hidden"}
                {f.locked ? " · locked" : ""}
              </small>
            </button>
            <div className="composition-fade-list-actions">
              <Button
                size="icon"
                variant="ghost"
                aria-label={`${f.visible ? "Hide" : "Show"} fade ${f.name}`}
                aria-pressed={!f.visible}
                onClick={() => patch(f.id, { visible: !f.visible })}
              >
                {f.visible ? <Eye /> : <EyeOff />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`${f.locked ? "Unlock" : "Lock"} fade ${f.name}`}
                aria-pressed={f.locked}
                onClick={() => patch(f.id, { locked: !f.locked })}
              >
                {f.locked ? <Lock /> : <Unlock />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Move fade ${f.name} up`}
                disabled={i === fades.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowUp />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Move fade ${f.name} down`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowDown />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Duplicate fade ${f.name}`}
                onClick={() => {
                  const copy = {
                    ...structuredClone(f),
                    id: crypto.randomUUID(),
                    name: uniqueFadeName(fades, `${f.name} copy`).slice(0, 200),
                    locked: false,
                  };
                  onChange([...fades.slice(0, i + 1), copy, ...fades.slice(i + 1)], copy.id);
                }}
              >
                <Copy />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete fade ${f.name}`}
                disabled={f.locked}
                onClick={() =>
                  onChange(
                    fades.filter((x) => x.id !== f.id),
                    f.id === selected ? null : undefined,
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
    </ol>
  );
}

/** Visual-first controls for the selected fade. Numeric detail stays available. */
export function FadeInspector({
  f,
  imageHeight,
  imageWidth,
  update,
  controller,
}: {
  f: Fade;
  imageHeight: number;
  imageWidth: number;
  update: (patch: Partial<Fade>) => void;
  controller: Controller;
}) {
  const session = controller.getState();
  const replace = (next: Fade) => {
    const patch: Partial<Fade> = { ...next };
    // Explicitly clear optional extent fields that a reset removed.
    for (const key of ["x", "width"] as const) if (!(key in next)) patch[key] = undefined;
    update(patch);
  };
  const b = f.boundary;
  const set = (p: Partial<Boundary>) => b && update({ boundary: { ...b, ...p } });
  const editable = editableEdgeFade(f);
  const point = session.fadePoint;
  return (
    <div className="composition-fade-inspector" data-fade-inspector={f.id}>
      <label className="editor-field-label">
        Fade name
        <input
          className="field"
          maxLength={200}
          value={f.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      <div className="composition-fade-toolbar" role="toolbar" aria-label="Fade actions">
        <Button
          variant="ghost"
          aria-pressed={!f.visible}
          onClick={() => update({ visible: !f.visible })}
        >
          {f.visible ? <Eye /> : <EyeOff />}
          {f.visible ? "Hide" : "Show"}
        </Button>
        <Button
          variant="ghost"
          aria-pressed={f.locked}
          onClick={() => update({ locked: !f.locked })}
        >
          {f.locked ? <Lock /> : <Unlock />}
          {f.locked ? "Unlock" : "Lock"}
        </Button>
      </div>
      {f.locked && <p className="composition-hint">Locked: unlock to edit it on the canvas.</p>}
      {!b &&
        (editable ? (
          <Button variant="secondary" onClick={() => update({ boundary: editable.boundary })}>
            <Spline />
            Edit freely on canvas
          </Button>
        ) : (
          <p className="composition-hint">
            This fade type keeps numeric controls. Use a shape fade for free canvas editing.
          </p>
        ))}
      <h4>Intensity &amp; size</h4>
      <Slider
        label="Density"
        unit="%"
        value={f.opacity}
        min={0}
        max={1}
        step={0.01}
        scale={100}
        onChange={(opacity) => update({ opacity })}
      />
      <Slider
        label="Fade depth (px)"
        value={f.length}
        min={1}
        max={Math.max(2000, Math.round(imageHeight * 1.5))}
        inputMax={100000}
        onChange={(length) => update({ length: Math.max(1, Math.round(length)) })}
      />
      <Slider
        label="Softness (px)"
        value={f.softness ?? 0}
        min={0}
        max={300}
        inputMax={1000}
        onChange={(softness) => update({ softness })}
      />
      <Slider
        label="Fade position (px)"
        value={f.start}
        min={-Math.round(imageHeight)}
        max={Math.round(imageHeight * 2)}
        inputMin={-100000}
        inputMax={100000}
        onChange={(start) => update({ start: Math.round(start) })}
      />
      <Slider
        label="Falloff curve"
        value={f.curve}
        min={0.2}
        max={5}
        step={0.05}
        inputMin={0.1}
        inputMax={10}
        onChange={(curve) => update({ curve })}
      />
      {b && (
        <>
          <h4>Shape</h4>
          <Choice
            label="Boundary shape"
            value={b.shape}
            options={BOUNDARY_SHAPES}
            onChange={(shape) =>
              set({
                shape: shape as Boundary["shape"],
                points: newBoundary(shape as Boundary["shape"]).points,
              })
            }
          />
          <Choice
            label="Fade placement"
            value={b.placement}
            options={["Top", "Bottom", "Both"]}
            onChange={(placement) => set({ placement: placement as Boundary["placement"] })}
          />
          {b.shape !== "Straight" && (
            <Slider
              label="Shape height (px)"
              value={b.amplitude}
              min={0}
              max={Math.max(1000, Math.round(imageHeight))}
              inputMax={100000}
              onChange={(amplitude) => set({ amplitude: Math.round(amplitude) })}
            />
          )}
          {["Wave", "Zigzag", "Organic"].includes(b.shape) && (
            <Slider
              label="Wave frequency"
              value={b.frequency}
              min={0.1}
              max={20}
              step={0.1}
              onChange={(frequency) => set({ frequency })}
            />
          )}
          <div className="composition-actions">
            <Button variant="secondary" onClick={() => replace(reverseFade(f))}>
              <FlipVertical2 />
              Reverse fade direction
            </Button>
            {b.shape !== "Straight" && (
              <Button
                variant="ghost"
                onClick={() => set({ direction: b.direction === 1 ? -1 : 1 })}
              >
                Flip curve
              </Button>
            )}
            <Button
              variant="secondary"
              aria-pressed={!!session.drawBoundary}
              onClick={() =>
                controller.setState({
                  drawBoundary: !controller.getState().drawBoundary,
                  mobileProperties: false,
                })
              }
            >
              <PenLine />
              Draw boundary on canvas
            </Button>
            {b.shape !== "Freehand" && b.shape !== "Bezier" && (
              <Button variant="ghost" onClick={() => replace(toEditable(f))}>
                Convert to editable points
              </Button>
            )}
            {b.shape === "Freehand" && (
              <Button variant="ghost" onClick={() => replace(smoothPoints(f, 2))}>
                Smooth path
              </Button>
            )}
            {b.shape === "Freehand" &&
              point !== undefined &&
              point > 0 &&
              point < b.points.length - 1 &&
              b.points.length > 2 && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    replace(removePoint(f, point));
                    controller.setState({ fadePoint: undefined });
                  }}
                >
                  Remove point {point + 1}
                </Button>
              )}
          </div>
          <h4>Horizontal extent</h4>
          <Slider
            label="Horizontal position (px)"
            value={f.x ?? 0}
            min={-Math.round(imageWidth)}
            max={Math.round(imageWidth)}
            inputMin={-100000}
            inputMax={100000}
            onChange={(x) => update({ x: Math.round(x), width: f.width ?? imageWidth })}
          />
          <Slider
            label="Horizontal width (px)"
            value={f.width ?? imageWidth}
            min={8}
            max={Math.round(imageWidth * 2)}
            inputMin={1}
            inputMax={100000}
            onChange={(width) => update({ width: Math.max(1, Math.round(width)), x: f.x ?? 0 })}
          />
          <Check
            label="Extend into spacing and gutters"
            value={!!f.extend}
            onChange={(extend) => update({ extend })}
          />
        </>
      )}
      <h4>Color</h4>
      <Color label="Fade target color" value={f.color} onChange={(color) => update({ color })} />
      <Check
        label="Fade to transparency"
        value={f.color === "transparent"}
        onChange={(checked) => update({ color: checked ? "transparent" : "#ffffff" })}
      />
      <div className="composition-actions composition-fade-resets">
        <Button variant="ghost" onClick={() => replace(resetPosition(f))}>
          <RotateCcw />
          Reset position
        </Button>
        {b && (
          <Button variant="ghost" onClick={() => replace(resetShape(f))}>
            <RotateCcw />
            Reset shape
          </Button>
        )}
        <Button variant="ghost" onClick={() => replace(resetAppearance(f))}>
          <RotateCcw />
          Reset settings
        </Button>
      </div>
      <p className="composition-hint">
        {b
          ? "On the canvas: drag the hatched band or the centre grip to move, the square to change depth, the side bars to resize, dots to reshape. Double-click the line to add a point; double-click a point to remove it."
          : "Drag the fade bar on the canvas to change its length."}
      </p>
    </div>
  );
}
