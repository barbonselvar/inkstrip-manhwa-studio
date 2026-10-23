import { useEffect, useRef } from "react";
import type { Layer } from "@/lib/studio/pro/model";
import { layerMaskCanvas } from "@/lib/studio/pro/render";
/** Preview uses the same coverage/compositing path as native exports. */
export function ProMaskThumbnail({ layer }: { layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    void layerMaskCanvas(layer, Math.min(1, 96 / layer.width, 72 / layer.height))
      .then((mask) => {
        if (active && ref.current) {
          const c = ref.current;
          c.width = mask.width;
          c.height = mask.height;
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(mask, 0, 0);
        }
        mask.width = mask.height = 1;
      })
      .catch(() => {
        /* Main worker reports unsupported geometry; a thumbnail must not interrupt editing. */
      });
    return () => {
      active = false;
    };
  }, [layer]);
  return <canvas ref={ref} aria-label="Layer mask thumbnail" className="pro-mask-thumbnail" />;
}
