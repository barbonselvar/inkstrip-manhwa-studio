import { useMemo } from "react";
import { BOUNDARY_SHAPES, boundary, type Boundary } from "@/lib/studio/composition/boundaries";
import { fade } from "@/lib/studio/composition/model";
import { fadeCoverage } from "@/lib/studio/composition/masks";
import { uniqueFadeName } from "@/lib/studio/composition/fade-edit";
import type { Controller } from "@/lib/studio/composition/controller";
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
              const f = {
                ...fade(),
                name: uniqueFadeName(
                  controller.getState().history.present.document.panels[owner]?.fades ?? [],
                  `${shape} fade`,
                ),
                boundary: boundary(shape),
                extend: true,
              };
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
