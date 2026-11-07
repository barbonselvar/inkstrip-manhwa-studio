import { useMemo } from "react";
import {
  FADE_TYPES,
  TRANSITION_TYPES,
  fade,
  type Fade,
  type Transition,
} from "@/lib/studio/composition/model";
import { fadeCoverage, noise, clamp, stopValue } from "@/lib/studio/composition/masks";

const W = 200,
  H = 110;
/** Sample "artwork": a diagonal two-tone gradient with a figure, so masks read clearly. */
function art(x: number, y: number, tone: [number, number, number]) {
  const figure = Math.hypot(x - W * 0.5, y - H * 0.42) < 26 ? 0.55 : 1,
    t = (x / W) * 0.4 + (y / H) * 0.6;
  return tone.map((c) => c * (0.6 + 0.4 * t) * figure) as [number, number, number];
}
function fadeThumbnail(type: Fade["type"]) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!,
    im = ctx.createImageData(W, H),
    f = {
      ...fade(type),
      length: 46,
      start: type === "Radial Fade" || type === "Elliptical Fade" ? 0 : 0,
    };
  if (type === "Custom Gradient Fade")
    f.stops = [
      { position: 0, opacity: 0 },
      { position: 0.5, opacity: 0.8 },
      { position: 0.7, opacity: 0.2 },
      { position: 1, opacity: 1 },
    ];
  if (type === "Linear Fade" || type === "Directional Fade")
    f.angle = type === "Linear Fade" ? 90 : 35;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = fadeCoverage(f, x, y, W, H),
        [r, g, b] = art(x, y, [40, 150, 140]),
        i = (y * W + x) * 4;
      im.data[i] = r + (255 - r) * a;
      im.data[i + 1] = g + (255 - g) * a;
      im.data[i + 2] = b + (255 - b) * a;
      im.data[i + 3] = 255;
    }
  ctx.putImageData(im, 0, 0);
  if (type === "Blur Fade") {
    const copy = document.createElement("canvas");
    copy.width = W;
    copy.height = H;
    const p = copy.getContext("2d")!;
    p.filter = "blur(3px)";
    p.drawImage(c, 0, 0);
    ctx.drawImage(copy, 0, H * 0.55, W, H * 0.45, 0, H * 0.55, W, H * 0.45);
  }
  return c.toDataURL();
}
/** Same per-row and per-pixel coverage as the chapter renderer, on two sample panels. */
function transitionThumbnail(type: Transition["type"]) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!,
    im = ctx.createImageData(W, H),
    top = H * 0.2,
    height = H * 0.6,
    softness = 0.6;
  const blend = /Crossfade|Gradient Blend|Dissolve|Blur Transition|Atmospheric|Custom Mask/.test(
    type,
  );
  const fill =
    type === "White Transition"
      ? [255, 255, 255]
      : type === "Black Transition"
        ? [0, 0, 0]
        : [214, 225, 255];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4,
        a = art(x, y, [40, 150, 140]),
        b = art(x, y, [190, 90, 70]);
      let base = y < H / 2 ? a : b;
      const q = (y + 0.5 - top) / height;
      if (q >= 0 && q <= 1) {
        const coverage = clamp((Math.min(q, 1 - q) * 2) / softness);
        let layer: number[] = fill;
        if (blend) {
          let amount = clamp((q - 0.5) / softness + 0.5);
          if (type === "Custom Mask Transition")
            amount = stopValue(
              [
                { position: 0, opacity: 0 },
                { position: 0.45, opacity: 0.1 },
                { position: 1, opacity: 1 },
              ],
              amount,
            );
          if (type === "Dissolve") amount = noise(x, y, 1234) < amount ? 1 : 0;
          layer = a.map((v, k) => v + (b[k]! - v) * amount);
        }
        base = base.map((v, k) => v + (layer[k]! - v) * coverage) as typeof base;
      }
      im.data.set([base[0], base[1], base[2], 255], i);
    }
  ctx.putImageData(im, 0, 0);
  if (/Blur|Fog|Atmospheric/.test(type)) {
    const copy = document.createElement("canvas");
    copy.width = W;
    copy.height = H;
    const p = copy.getContext("2d")!;
    p.filter = "blur(4px)";
    p.drawImage(c, 0, 0);
    if (type !== "Blur Transition") {
      p.filter = "none";
      p.fillStyle = "rgba(235,240,245,0.45)";
      p.fillRect(0, top, W, height);
    }
    ctx.drawImage(copy, 0, top, W, height, 0, top, W, height);
  }
  return c.toDataURL();
}
export function FadeTypeGallery({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (type: Fade["type"]) => void;
}) {
  const items = useMemo(() => FADE_TYPES.map((type) => ({ type, url: fadeThumbnail(type) })), []);
  return (
    <div className="composition-preset-grid">
      {items.map(({ type, url }) => (
        <button
          key={type}
          className="composition-shape-card"
          disabled={disabled}
          aria-label={`Add ${type}`}
          onClick={() => onPick(type)}
        >
          <img src={url} alt="" width={W} height={H} />
          <strong>{type}</strong>
        </button>
      ))}
    </div>
  );
}
export function TransitionGallery({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (type: Transition["type"]) => void;
}) {
  const items = useMemo(
    () => TRANSITION_TYPES.map((type) => ({ type, url: transitionThumbnail(type) })),
    [],
  );
  return (
    <div className="composition-preset-grid">
      {items.map(({ type, url }) => (
        <button
          key={type}
          className="composition-shape-card"
          disabled={disabled}
          aria-label={`Connect with ${type}`}
          onClick={() => onPick(type)}
        >
          <img src={url} alt="" width={W} height={H} />
          <strong>{type}</strong>
        </button>
      ))}
    </div>
  );
}
