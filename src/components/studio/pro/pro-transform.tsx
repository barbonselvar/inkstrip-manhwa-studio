import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import { bounds, MESH, QUAD, withPivot, type TransformMode } from "@/lib/studio/pro/transform";
import type { Layer, Point, Transform } from "@/lib/studio/pro/model";
export type TransformDraft = {
  layerId: string;
  value: Transform;
  base: Transform;
  mode: TransformMode;
  lock: boolean;
  translation: Point;
};
export function ProTransform({
  layer,
  draft,
  onDraft,
  onApply,
  onCancel,
  disabled,
}: {
  layer?: Layer;
  draft: TransformDraft | null;
  onDraft: (d: TransformDraft) => void;
  onApply: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  if (!draft || !layer)
    return (
      <p className="pro-help">
        Select an unlocked raster, paint, shape or text layer and choose Free Transform (F).
      </p>
    );
  const t = draft.value,
    box = bounds(t, layer.width, layer.height),
    update = (p: Partial<Transform>) =>
      onDraft({
        ...draft,
        value: { ...t, ...p },
        translation: {
          x: draft.translation.x + (p.x === undefined ? 0 : p.x - t.x),
          y: draft.translation.y + (p.y === undefined ? 0 : p.y - t.y),
        },
      });
  return (
    <fieldset className="pro-geometry" disabled={disabled}>
      <h3>Free Transform</h3>
      <p className="pro-help">
        Live preview · {layer.name}. Apply records one undo step; Cancel restores the saved
        geometry. Source artwork, editable objects and masks are retained.
      </p>
      <label className="pro-field">
        Transform mode
        <select
          className="field"
          aria-label="Transform mode"
          value={draft.mode}
          onChange={(e) => {
            const mode = e.target.value as TransformMode;
            onDraft({
              ...draft,
              mode,
              value:
                mode === "affine" || t.deform?.kind === mode
                  ? t
                  : {
                      ...t,
                      deform: {
                        kind: mode,
                        width: layer.width,
                        height: layer.height,
                        points: (mode === "warp" ? MESH : QUAD).map((p) => ({ ...p })),
                      },
                    },
            });
          }}
        >
          <option value="affine">Affine · move, scale, rotate, shear</option>
          <option value="perspective">Perspective · four corners</option>
          <option value="warp">Warp · smooth 3 × 3 mesh</option>
        </select>
      </label>
      <p className="pro-help">
        Drag inside to move. Shift constrains movement or toggles aspect lock; Shift snaps rotation
        to 15°. Alt scales about the pivot. Drag the crosshair to reposition the pivot without
        moving artwork.
      </p>
      <label className="pro-check">
        <input
          type="checkbox"
          aria-label="Transform aspect lock"
          checked={draft.lock}
          onChange={(e) => onDraft({ ...draft, lock: e.target.checked })}
        />
        Lock transform aspect ratio
      </label>
      <div className="pro-field-grid">
        <ProNumber label="Transform X" value={t.x} onChange={(x) => update({ x })} />
        <ProNumber label="Transform Y" value={t.y} onChange={(y) => update({ y })} />
        <ProNumber
          label="Transform width"
          min={Math.max(0.01, layer.width * 0.01)}
          max={Math.min(16384, layer.width * 100)}
          value={layer.width * t.scaleX}
          onChange={(n) =>
            update({
              scaleX: n / layer.width,
              ...(draft.lock ? { scaleY: (t.scaleY * n) / (layer.width * t.scaleX) } : {}),
            })
          }
        />
        <ProNumber
          label="Transform height"
          min={Math.max(0.01, layer.height * 0.01)}
          max={Math.min(16384, layer.height * 100)}
          value={layer.height * t.scaleY}
          onChange={(n) =>
            update({
              scaleY: n / layer.height,
              ...(draft.lock ? { scaleX: (t.scaleX * n) / (layer.height * t.scaleY) } : {}),
            })
          }
        />
        <ProNumber
          label="Transform rotation"
          min={-360}
          max={360}
          step={0.1}
          value={t.rotation}
          onChange={(rotation) => update({ rotation })}
        />
        <ProNumber
          label="Horizontal shear"
          min={-75}
          max={75}
          step={0.1}
          value={t.shearX ?? 0}
          onChange={(shearX) => update({ shearX })}
        />
        <ProNumber
          label="Vertical shear"
          min={-75}
          max={75}
          step={0.1}
          value={t.shearY ?? 0}
          onChange={(shearY) => update({ shearY })}
        />
      </div>
      <div className="pro-actions">
        <Button
          variant="secondary"
          aria-pressed={!!t.flipX}
          onClick={() => update({ flipX: !t.flipX })}
        >
          Flip horizontal
        </Button>
        <Button
          variant="secondary"
          aria-pressed={!!t.flipY}
          onClick={() => update({ flipY: !t.flipY })}
        >
          Flip vertical
        </Button>
      </div>
      <div className="pro-field-grid">
        <ProNumber
          label="Pivot X"
          value={t.pivot?.x ?? 0}
          onChange={(x) => onDraft({ ...draft, value: withPivot(t, { x, y: t.pivot?.y ?? 0 }) })}
        />
        <ProNumber
          label="Pivot Y"
          value={t.pivot?.y ?? 0}
          onChange={(y) => onDraft({ ...draft, value: withPivot(t, { x: t.pivot?.x ?? 0, y }) })}
        />
      </div>
      <Button
        variant="secondary"
        onClick={() =>
          onDraft({ ...draft, value: withPivot(t, { x: layer.width / 2, y: layer.height / 2 }) })
        }
      >
        Center pivot
      </Button>
      {draft.mode !== "affine" && t.deform && (
        <>
          <p className="pro-help">
            {draft.mode === "warp"
              ? "Drag any of nine control points. This first warp version uses a smooth quadratic Bézier surface with 10% control offsets to prevent folds."
              : "Drag four independent corners. Perspective uses a homography with bilinear, alpha-aware sampling. Crossed or degenerate corners are rejected."}{" "}
            Switching deformation modes replaces the current cage in this draft.
          </p>
          {t.deform.points.map((p, i) => (
            <div className="pro-field-grid" key={i}>
              <ProNumber
                label={`Control ${i + 1} X`}
                value={p.x * t.deform!.width}
                step={0.1}
                onChange={(x) => {
                  const d = t.deform!;
                  update({
                    deform: {
                      ...d,
                      points: d.points.map((q, j) => (j === i ? { ...q, x: x / d.width } : q)),
                    },
                  });
                }}
              />
              <ProNumber
                label={`Control ${i + 1} Y`}
                value={p.y * t.deform!.height}
                step={0.1}
                onChange={(y) => {
                  const d = t.deform!;
                  update({
                    deform: {
                      ...d,
                      points: d.points.map((q, j) => (j === i ? { ...q, y: y / d.height } : q)),
                    },
                  });
                }}
              />
            </div>
          ))}
        </>
      )}
      <p className="pro-help">
        Transformed bounds · {box.width.toFixed(2)} × {box.height.toFixed(2)} px at{" "}
        {box.x.toFixed(2)}, {box.y.toFixed(2)}. Width/height controls describe the source axes
        before shear/rotation.
      </p>
      <div className="pro-actions">
        <Button onClick={onApply}>Apply transform</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel transform
        </Button>
      </div>
      <div className="pro-actions">
        <Button
          variant="ghost"
          onClick={() =>
            onDraft({
              ...draft,
              value: structuredClone(draft.base),
              translation: { x: 0, y: 0 },
              mode: draft.base.deform?.kind ?? "affine",
            })
          }
        >
          Restore initial transform
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            onDraft({
              ...draft,
              translation: { x: 0, y: 0 },
              value: {
                ...t,
                x: 0,
                y: 0,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                shearX: 0,
                shearY: 0,
                flipX: false,
                flipY: false,
                pivot: { x: 0, y: 0 },
              },
            })
          }
        >
          Reset affine transform
        </Button>
        <Button
          variant="ghost"
          disabled={!t.deform}
          onClick={() => onDraft({ ...draft, value: { ...t, deform: undefined }, mode: "affine" })}
        >
          Reset deformation
        </Button>
      </div>
    </fieldset>
  );
}
