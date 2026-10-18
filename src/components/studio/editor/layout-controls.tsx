import { Button } from "@/components/ui/button";
import {
  DEFAULT_LAYOUT,
  layoutPlacement,
  type EditRecipe,
  type Layout,
} from "@/lib/studio/editor/geometry";
import { NumberField } from "./number-field";
export function LayoutControls({
  recipe,
  onChange,
  onEnd,
}: {
  recipe: EditRecipe;
  onChange: (layout: Layout, group?: string) => void;
  onEnd: () => void;
}) {
  const value = recipe.layout ?? DEFAULT_LAYOUT;
  const p = layoutPlacement(recipe.width, recipe.height, value);
  const range = layoutPlacement(recipe.width, recipe.height, { ...value, x: 1, y: 1 });
  const rounded = (v: number) => Math.round(v * 1000) / 1000;
  const normalized = (v: number, extent: number) =>
    extent ? Math.max(-1, Math.min(1, v / extent)) : 0;
  return (
    <>
      <div className="editor-section-heading">
        <h3>Artwork in output frame</h3>
      </div>
      <p className="text-xs text-muted">
        Reduce artwork scale to add transparent space, then position it inside the frame. All
        artwork stays inside the output. Chapter spacing is unchanged.
      </p>
      <NumberField
        label="Artwork scale percent"
        min={10}
        max={100}
        value={value.scale}
        onChange={(scale) => onChange({ ...value, scale }, "artwork-scale")}
        onEnd={onEnd}
      />
      <input
        type="range"
        aria-label="Artwork scale slider"
        min={10}
        max={100}
        value={value.scale}
        onChange={(e) => onChange({ ...value, scale: +e.target.value }, "artwork-scale")}
        onPointerUp={onEnd}
        onKeyUp={onEnd}
      />
      <div className="editor-number-grid">
        <NumberField
          label="Artwork X offset"
          min={-rounded(range.x)}
          max={rounded(range.x)}
          step={0.001}
          value={rounded(p.x)}
          disabled={!range.x}
          onChange={(x) => onChange({ ...value, x: normalized(x, range.x) }, "artwork-x")}
          onEnd={onEnd}
        />
        <NumberField
          label="Artwork Y offset"
          min={-rounded(range.y)}
          max={rounded(range.y)}
          step={0.001}
          value={rounded(p.y)}
          disabled={!range.y}
          onChange={(y) => onChange({ ...value, y: normalized(y, range.y) }, "artwork-y")}
          onEnd={onEnd}
        />
      </div>
      <div className="editor-align-grid">
        {(
          [
            [-1, "Left"],
            [0, "Center"],
            [1, "Right"],
          ] as const
        ).map(([x, label]) => (
          <Button
            key={label}
            variant="secondary"
            size="sm"
            aria-pressed={value.x === x}
            onClick={() => onChange({ ...value, x })}
          >{`Align ${label.toLowerCase()}`}</Button>
        ))}
        {(
          [
            [-1, "Top"],
            [0, "Middle"],
            [1, "Bottom"],
          ] as const
        ).map(([y, label]) => (
          <Button
            key={label}
            variant="secondary"
            size="sm"
            aria-pressed={value.y === y}
            onClick={() => onChange({ ...value, y })}
          >{`Align ${label.toLowerCase()}`}</Button>
        ))}
      </div>
      <Button variant="ghost" onClick={() => onChange({ ...DEFAULT_LAYOUT })}>
        Reset artwork position
      </Button>
    </>
  );
}
