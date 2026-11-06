import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { BOUNDARY_SHAPES, boundary, type Boundary } from "@/lib/studio/composition/boundaries";
import { fade, type Fade } from "@/lib/studio/composition/model";
import { fadeCoverage } from "@/lib/studio/composition/masks";
import type { Controller } from "@/lib/studio/composition/controller";
import { Choice, Color } from "./properties";
import { NumberField } from "../editor/number-field";
function shapeThumbnail(shape: Boundary["shape"]) {
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = 110;
  const ctx = c.getContext("2d")!,
    im = ctx.createImageData(200, 110);
  const f = { ...fade(), length: 38, boundary: { ...boundary(shape), amplitude: 30 } };
  for (let y = 0; y < 110; y++)
    for (let x = 0; x < 200; x++) {
      const a = fadeCoverage(f, x, y, 200, 110),
        i = (y * 200 + x) * 4;
      im.data[i] = 30 + (255 - 30) * a;
      im.data[i + 1] = 68 + (255 - 68) * a;
      im.data[i + 2] = 65 + (255 - 65) * a;
      im.data[i + 3] = 255;
    }
  ctx.putImageData(im, 0, 0);
  return c.toDataURL();
}
export function FadeShapeGallery({
  controller,
  owner,
}: {
  controller: Controller;
  owner?: string;
}) {
  const items = useMemo(
    () => BOUNDARY_SHAPES.map((shape) => ({ shape, url: shapeThumbnail(shape) })),
    [],
  );
  return (
    <>
      <p className="composition-hint">
        Choose a boundary. Drag its handles on the artwork; draw your own with Freehand.
      </p>
      <div className="composition-preset-grid">
        {items.map(({ shape, url }) => (
          <button
            className="composition-shape-card"
            key={shape}
            disabled={!owner}
            onClick={() => {
              if (!owner) return;
              const f = { ...fade(), name: `${shape} fade`, boundary: boundary(shape) };
              controller.change((d) => ({
                ...d,
                panels: {
                  ...d.panels,
                  [owner]: { ...d.panels[owner], fades: [...d.panels[owner].fades, f] },
                },
              }));
              controller.select({ kind: "fade", panelId: owner, id: f.id });
            }}
          >
            <img src={url} alt="" />
            <strong>
              {shape === "Bezier"
                ? "Custom Bezier Path"
                : shape === "Freehand"
                  ? "Freehand Boundary"
                  : shape === "Organic"
                    ? "Irregular / Organic"
                    : shape}
            </strong>
            <small>Editable mask · instant preview</small>
          </button>
        ))}
      </div>
    </>
  );
}
export function FadeShapeProperties({
  f,
  update,
  controller,
}: {
  f: Fade;
  update: (patch: Partial<Fade>) => void;
  controller: Controller;
}) {
  const b = f.boundary;
  if (!b)
    return (
      <Button variant="secondary" onClick={() => update({ boundary: boundary("Straight") })}>
        Add shaped boundary
      </Button>
    );
  const set = (patch: Partial<Boundary>) => update({ boundary: { ...b, ...patch } });
  return (
    <div className="composition-shape-properties">
      <Choice
        label="Boundary shape"
        value={b.shape}
        options={BOUNDARY_SHAPES}
        onChange={(shape) => set({ shape: shape as Boundary["shape"], points: boundary().points })}
      />
      <Choice
        label="Fade placement"
        value={b.placement}
        options={["Top", "Bottom", "Both"]}
        onChange={(placement) => set({ placement: placement as Boundary["placement"] })}
      />
      <NumberField
        label="Fade position (px)"
        value={f.start}
        min={0}
        max={100000}
        onChange={(start) => update({ start })}
      />
      {b.shape !== "Straight" && (
        <NumberField
          label="Boundary amplitude"
          value={b.amplitude}
          min={0}
          max={100000}
          onChange={(amplitude) => set({ amplitude })}
        />
      )}
      {["Wave", "Zigzag", "Organic"].includes(b.shape) && (
        <NumberField
          label="Wave frequency"
          value={b.frequency}
          min={0.1}
          max={20}
          step={0.1}
          onChange={(frequency) => set({ frequency })}
        />
      )}
      <NumberField
        label="Fade width"
        value={f.length}
        min={1}
        max={100000}
        onChange={(length) => update({ length })}
      />
      <NumberField
        label="Feather softness"
        value={f.feather}
        min={0}
        max={1000}
        onChange={(feather) => update({ feather })}
      />
      <NumberField
        label="Mask blur radius"
        value={f.blur}
        min={0}
        max={100}
        onChange={(blur) => update({ blur })}
      />
      <NumberField
        label="Shape opacity"
        value={f.opacity}
        min={0}
        max={1}
        step={0.05}
        onChange={(opacity) => update({ opacity })}
      />
      <Color label="Shape target color" value={f.color} onChange={(color) => update({ color })} />
      {b.shape !== "Straight" && (
        <Button variant="secondary" onClick={() => set({ direction: b.direction === 1 ? -1 : 1 })}>
          Reverse curve direction
        </Button>
      )}
      {b.shape === "Freehand" && (
        <Button
          variant="secondary"
          aria-pressed={!!controller.getState().drawBoundary}
          onClick={() =>
            controller.setState({
              drawBoundary: !controller.getState().drawBoundary,
              mobileProperties: false,
            })
          }
        >
          Draw boundary on canvas
        </Button>
      )}
      <p className="composition-hint">
        Mint line marks 50% fade coverage. Drag points to reshape it. Freehand draws left to right;
        release to keep the editable mask.
      </p>
    </div>
  );
}
