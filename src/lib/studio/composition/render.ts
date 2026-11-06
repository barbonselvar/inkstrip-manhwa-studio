import { paintInk, inkSupported, inkPolygons } from "./ink";
import { getImageBlob } from "../db";
import { decodeBlob, deviceLimits } from "../images";
import { objectMatrix, objectBounds } from "./geometry";
export { objectMatrix, objectBounds, hitObject } from "./geometry";
import type { Panel } from "../types";
import {
  layout,
  layerStack,
  transitionActive,
  type CompositionDocument,
  type CompositionObject,
  type Fade,
  type Fx,
  type PanelFrame,
  type Sfx,
  type SpaceFrame,
} from "./model";
export type Region = { y: number; height: number };
const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};
import { clamp, noise, fadeCoverage, stopValue } from "./masks";
export class RenderResources {
  private cache = new Map<string, HTMLCanvasElement>();
  private bytes = 0;
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;
  constructor(
    readonly maxBytes = (typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches
      ? 8
      : 32) *
      1024 *
      1024,
  ) {}
  async image<T>(
    id: string,
    fn: (source: CanvasImageSource, w: number, h: number) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      signal?.throwIfAborted();
      if (this.disposed) throw new DOMException("Preview closed", "AbortError");
      const blob = await getImageBlob(id);
      if (!blob)
        throw Error(
          "A composition source image is missing. Original chapter records were not changed.",
        );
      signal?.throwIfAborted();
      // Let an already-started native decode finish before releasing its lease.
      // Superseded queued requests are skipped without decoding their source.
      const decoded = await decodeBlob(blob);
      try {
        signal?.throwIfAborted();
        if (this.disposed) throw new DOMException("Preview closed", "AbortError");
        return await fn(decoded.source, decoded.width, decoded.height);
      } finally {
        decoded.close();
      }
    } finally {
      release();
    }
  }
  get(key: string) {
    const c = this.cache.get(key);
    if (c) {
      this.cache.delete(key);
      this.cache.set(key, c);
    }
    return c;
  }
  put(key: string, c: HTMLCanvasElement) {
    if (this.disposed) return;
    const existing = this.cache.get(key);
    if (existing) {
      this.bytes -= existing.width * existing.height * 4;
      existing.width = existing.height = 0;
      this.cache.delete(key);
    }
    const size = c.width * c.height * 4;
    if (size > this.maxBytes) return;
    while (this.bytes + size > this.maxBytes && this.cache.size) {
      const [k, old] = this.cache.entries().next().value!;
      this.cache.delete(k);
      this.bytes -= old.width * old.height * 4;
      old.width = old.height = 0;
    }
    this.cache.set(key, c);
    this.bytes += size;
  }
  clear() {
    this.disposed = true;
    this.cache.forEach((c) => {
      c.width = c.height = 0;
    });
    this.cache.clear();
    this.bytes = 0;
  }
}
function rgba(color: string, alpha: number) {
  if (color === "transparent") return "rgba(0,0,0,0)";
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return `rgba(${rgb.join(",")},${clamp(alpha)})`;
}
function reset(ctx: CanvasRenderingContext2D, scale: number, y: number) {
  ctx.setTransform(scale, 0, 0, scale, 0, -y * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
}
function fadeMask(
  f: Fade,
  w: number,
  h: number,
  imageHeight: number,
  offsetY: number,
  scale: number,
) {
  const out = canvas(w, h),
    ctx = out.getContext("2d")!,
    image = ctx.createImageData(out.width, out.height);
  const rgb =
    f.color === "transparent"
      ? [0, 0, 0]
      : [1, 3, 5].map((i) => parseInt(f.color.slice(i, i + 2), 16));
  for (let py = 0; py < out.height; py++)
    for (let px = 0; px < out.width; px++) {
      const i = (py * out.width + px) * 4,
        x = (px + 0.5) / scale,
        y = offsetY + (py + 0.5) / scale;
      const alpha = fadeCoverage(f, x, y, out.width / scale, imageHeight);
      image.data[i] = rgb[0];
      image.data[i + 1] = rgb[1];
      image.data[i + 2] = rgb[2];
      image.data[i + 3] = Math.round(clamp(alpha + (noise(x, y, 19) - 0.5) / 255) * 255);
    }
  ctx.putImageData(image, 0, 0);
  return out;
}
async function paintPanel(
  ctx: CanvasRenderingContext2D,
  frame: PanelFrame,
  d: CompositionDocument,
  r: Region,
  scale: number,
  resources: RenderResources,
  signal?: AbortSignal,
  excluded?: Set<string>,
) {
  const settings = frame.settings;
  const fades = settings.fades.filter((f) => f.visible && !excluded?.has(f.id));
  if (!settings.visible || !settings.opacity) return;
  const start = Math.max(r.y, frame.imageY),
    end = Math.min(r.y + r.height, frame.bottomY);
  if (end <= start) return;
  const first = Math.floor(start * scale + 1e-7),
    last = Math.ceil(end * scale - 1e-7),
    y = first / scale;
  const h = last - first,
    key = JSON.stringify([
      frame.panel.blobId,
      settings.snapshot,
      y - frame.imageY,
      h,
      scale,
      fades,
    ]);
  let c = resources.get(key);
  if (!c) {
    c = canvas(d.width * scale, h);
    const p = c.getContext("2d")!;
    p.imageSmoothingEnabled = true;
    p.imageSmoothingQuality = "high";
    await resources.image(
      settings.snapshot?.blobId ?? frame.panel.blobId,
      (source) => {
        p.setTransform(scale, 0, 0, scale, 0, -(y - frame.imageY) * scale);
        p.drawImage(source, 0, 0, d.width, frame.imageHeight);
      },
      signal,
    );
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.beginPath();
    p.rect(0, (frame.imageY - y) * scale, c.width, frame.imageHeight * scale);
    p.clip();
    for (const f of fades) {
      signal?.throwIfAborted();
      const mask = fadeMask(f, c.width, c.height, frame.imageHeight, y - frame.imageY, scale);
      if (f.blur) {
        const radius = f.blur * scale,
          blurred = canvas(c.width + Math.ceil(radius * 6), c.height + Math.ceil(radius * 6)),
          b = blurred.getContext("2d")!;
        b.filter = `blur(${radius}px)`;
        b.drawImage(c, radius * 3, radius * 3);
        b.filter = "none";
        const coverage = mask.getContext("2d")!;
        coverage.globalCompositeOperation = "source-in";
        coverage.drawImage(blurred, -radius * 3, -radius * 3);
        p.drawImage(mask, 0, 0);
        blurred.width = blurred.height = 0;
        // Restore the color mask after mixing the softened edge.
        const colored = fadeMask(f, c.width, c.height, frame.imageHeight, y - frame.imageY, scale);
        p.globalCompositeOperation = f.color === "transparent" ? "destination-out" : f.blend;
        p.drawImage(colored, 0, 0);
        colored.width = colored.height = 0;
      } else {
        p.globalCompositeOperation = f.color === "transparent" ? "destination-out" : f.blend;
        p.drawImage(mask, 0, 0);
      }
      p.globalCompositeOperation = "source-over";
      mask.width = mask.height = 0;
    }
    resources.put(key, c);
  }
  ctx.save();
  ctx.globalAlpha = settings.opacity;
  ctx.globalCompositeOperation = settings.blend ?? "source-over";
  ctx.drawImage(c, 0, y, d.width, h / scale);
  ctx.restore();
  if (resources.get(key) !== c) c.width = c.height = 0;
}
async function paintSpace(
  ctx: CanvasRenderingContext2D,
  frame: SpaceFrame,
  d: CompositionDocument,
  frames: PanelFrame[],
  resources: RenderResources,
  signal?: AbortSignal,
) {
  const s = frame.settings;
  if (!s.visible || !s.opacity || s.fill === "transparent") return;
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.globalCompositeOperation = s.blend ?? "source-over";
  if (s.fill === "gradient") {
    const g = ctx.createLinearGradient(0, frame.y, 0, frame.y + frame.height);
    g.addColorStop(0, s.color);
    g.addColorStop(1, s.color2);
    ctx.fillStyle = g;
    ctx.fillRect(0, frame.y, d.width, frame.height);
  } else if (s.fill === "solid") {
    ctx.fillStyle = s.color;
    ctx.fillRect(0, frame.y, d.width, frame.height);
  } else {
    const neighbor = frame.neighbor ?? (frame.slot === "opening" ? frames[0] : frames.at(-1));
    if (neighbor)
      await resources.image(
        neighbor.settings.snapshot?.blobId ?? neighbor.panel.blobId,
        (source, w, h) => {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, frame.y, d.width, frame.height);
          ctx.clip();
          const top = frame.slot === "top" || frame.slot === "opening",
            sampleH = Math.min(h, Math.max(1, (frame.height * w) / d.width)),
            sy = top ? 0 : h - sampleH;
          if (s.fill === "blur") {
            ctx.filter = `blur(${s.blur * Math.hypot(ctx.getTransform().a, ctx.getTransform().b)}px)`;
            ctx.drawImage(
              source,
              0,
              sy,
              w,
              sampleH,
              -s.blur * 3,
              frame.y - s.blur * 3,
              d.width + s.blur * 6,
              frame.height + s.blur * 6,
            );
          } else {
            ctx.translate(0, frame.y + frame.height);
            ctx.scale(1, -1);
            ctx.drawImage(source, 0, sy, w, sampleH, 0, 0, d.width, frame.height);
          }
          ctx.restore();
        },
        signal,
      );
  }
  ctx.restore();
}
function textRuns(ctx: CanvasRenderingContext2D, o: Sfx, paint: "fill" | "stroke") {
  ctx.font = `${o.italic ? "italic " : ""}${o.weight} ${o.size}px ${o.font}, "Noto Sans KR", "Noto Sans JP", "Noto Sans Arabic"`;
  ctx.direction = o.direction;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = o.direction === "rtl" ? "right" : "left";
  ctx.letterSpacing = `${o.spacing}px`;
  for (const [i, line] of o.text.split("\n").entries()) {
    const x = o.direction === "rtl" ? o.width : 0,
      y = o.size * (1 + i * o.lineHeight);
    if (paint === "fill") ctx.fillText(line, x, y);
    else ctx.strokeText(line, x, y);
  }
}
function paintSfx(ctx: CanvasRenderingContext2D, o: Sfx) {
  if (o.ink && inkSupported(o.text)) {
    paintInk(ctx, o);
    return;
  }
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  const m = ctx.getTransform(),
    filterScale = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  const fill = () => {
    if (o.gradient) {
      const g = ctx.createLinearGradient(0, 0, 0, o.height);
      g.addColorStop(0, o.fill);
      g.addColorStop(1, o.fill2);
      ctx.fillStyle = g;
    } else ctx.fillStyle = o.fill;
  };
  ctx.save();
  if (o.shadow) {
    ctx.fillStyle = "#000000";
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = o.shadow * filterScale;
    ctx.shadowOffsetX = (o.shadow / 2) * (m.a + m.c);
    ctx.shadowOffsetY = (o.shadow / 2) * (m.b + m.d);
    textRuns(ctx, o, "fill");
  }
  if (o.glow) {
    fill();
    ctx.shadowColor = o.fill;
    ctx.shadowBlur = o.glow * filterScale;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    textRuns(ctx, o, "fill");
  }
  ctx.restore();
  ctx.shadowBlur = 0;
  fill();
  for (const stroke of [...o.strokes].sort((a, b) => b.width - a.width)) {
    if (!stroke.width) continue;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * 2;
    textRuns(ctx, o, "stroke");
  }
  textRuns(ctx, o, "fill");
}
function paintFx(ctx: CanvasRenderingContext2D, o: Fx) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, o.width, o.height);
  ctx.clip();
  try {
    const w = o.width,
      h = o.height,
      cx = w / 2,
      cy = h / 2,
      rand = (i: number, k = 0) => noise(i, k, o.seed),
      a = (o.angle * Math.PI) / 180;
    ctx.globalAlpha *= o.amount;
    ctx.strokeStyle = o.color;
    ctx.fillStyle = o.color;
    ctx.lineCap = "round";
    const effect = o.effect;
    if (effect === "Dramatic Blackout") {
      ctx.fillRect(0, 0, w, h);
      return;
    }
    if (
      /Color Overlay|Flashback Overlay|Dream Sequence|Dramatic Blackout|Memory Haze|Time Regression/.test(
        effect,
      )
    ) {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, rgba(o.color, 0.9));
      g.addColorStop(1, rgba(o.color2, 0.35));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      if (/Regression/.test(effect)) {
        ctx.strokeStyle = o.color2;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let t = 0; t < 16 * Math.PI; t += 0.03) {
          const r = (t / (16 * Math.PI)) * Math.max(w, h),
            x = cx + Math.cos(t) * r,
            y = cy + Math.sin(t) * r;
          if (t === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      return;
    }
    if (/Vignette|Horror Shadow|Aura|Glow|Bloom|Impact Flash|Lens Flare/.test(effect)) {
      const radius = Math.max(w, h) * (0.2 + o.radius / 100),
        g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      const dark = /Vignette|Shadow|Dark Aura|Red Aura/.test(effect);
      g.addColorStop(0, rgba(o.color, dark ? 0 : 1));
      g.addColorStop(0.45, rgba(o.color, dark ? 0.1 : 0.35));
      g.addColorStop(1, rgba(o.color, dark ? 1 : 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      if (effect === "Lens Flare") {
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.arc(w * (0.2 + i * 0.16), h * (0.25 + i * 0.1), 10 + i * 7, 0, Math.PI * 2);
          ctx.fillStyle = rgba(o.color2, 0.3);
          ctx.fill();
        }
      }
      return;
    }
    if (/Fog|Mist|Smoke/.test(effect)) {
      for (let i = 0; i < Math.min(o.density, 100); i++) {
        const x = rand(i) * w,
          y = rand(i, 1) * h,
          r = (0.02 + (o.radius / 100) * 0.15 + rand(i, 2) * 0.2) * Math.max(w, h),
          g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(o.color, 0.07));
        g.addColorStop(1, rgba(o.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      return;
    }
    if (/Sword Trail|Slash Trail|Energy Arc|Shockwave/.test(effect)) {
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.lineWidth = Math.max(1, o.radius);
      ctx.shadowBlur = o.radius * Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
      ctx.shadowColor = o.color;
      ctx.beginPath();
      if (effect === "Shockwave") ctx.ellipse(0, 0, w * 0.4, h * 0.38, 0, 0, Math.PI * 2);
      else {
        ctx.moveTo(-w * 0.4, h * 0.18);
        ctx.quadraticCurveTo(0, -h * 0.5, w * 0.4, -h * 0.12);
      }
      ctx.stroke();
      ctx.lineWidth = Math.max(1, o.radius * 0.2);
      ctx.strokeStyle = o.color2;
      ctx.stroke();
      return;
    }
    if (/Rain|Snow|Dust|Leaves|Particles|Sparks/.test(effect)) {
      for (let i = 0; i < o.density; i++) {
        const x = rand(i) * w,
          y = rand(i, 1) * h,
          r = 1 + rand(i, 2) * Math.max(2, o.radius * 0.4);
        ctx.globalAlpha = o.amount * (0.2 + rand(i, 3) * 0.8);
        ctx.beginPath();
        if (effect === "Rain" || effect === "Sparks") {
          ctx.lineWidth = effect === "Rain" ? 1 : 2;
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.sin(a) * r * 4, y + Math.cos(a) * r * 4);
          ctx.stroke();
        } else if (effect === "Falling Leaves") {
          ctx.ellipse(x, y, r * 2, r, a, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
    const radial = /Radial|Zoom|Impact Lines/.test(effect);
    for (let i = 0; i < o.density; i++) {
      ctx.lineWidth = 0.5 + rand(i, 3) * Math.max(1, o.radius * 0.25);
      ctx.globalAlpha = o.amount * (0.2 + rand(i, 4) * 0.8);
      ctx.beginPath();
      if (radial) {
        const angle = rand(i) * Math.PI * 2,
          inner = Math.min(w, h) * (0.1 + rand(i, 1) * 0.25),
          outer = Math.max(w, h);
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      } else {
        const x = rand(i) * w,
          y = rand(i, 1) * h,
          length = (0.1 + rand(i, 2) * 0.5) * Math.max(w, h);
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * length, y + Math.sin(a) * length);
      }
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}
export async function renderObjectThumbnail(object: CompositionObject) {
  const c = canvas(180, 100),
    ctx = c.getContext("2d")!;
  ctx.fillStyle = "#243332";
  ctx.fillRect(0, 0, 180, 100);
  ctx.scale(160 / object.width, 80 / object.height);
  ctx.translate(object.width * 0.06, object.height * 0.08);
  if (object.kind === "sfx") paintSfx(ctx, object);
  if (object.kind === "fx") paintFx(ctx, object);
  if (object.kind === "overlay") {
    const r = new RenderResources();
    try {
      await r.image(object.blobId, (source) =>
        ctx.drawImage(source, 0, 0, object.width, object.height),
      );
    } finally {
      r.clear();
    }
  }
  return c.toDataURL("image/png");
}
async function paintSampledFx(
  ctx: CanvasRenderingContext2D,
  o: Fx,
  frames: PanelFrame[],
  d: CompositionDocument,
  resources: RenderResources,
  signal?: AbortSignal,
) {
  const selected = o.owner
    ? frames.find((f) => f.panel.id === o.owner)
    : (frames.find((f) => o.y + o.height / 2 >= f.imageY && o.y <= f.bottomY) ?? frames[0]);
  if (!selected) return;
  await resources.image(
    selected.settings.snapshot?.blobId ?? selected.panel.blobId,
    (source, w, h) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, o.width, o.height);
      ctx.clip();
      const sy = ((o.owner ? o.y : o.y - selected.imageY) * h) / selected.imageHeight,
        sx = (o.x * w) / d.width,
        sw = (o.width * w) / d.width,
        sh = (o.height * h) / selected.imageHeight;
      const iterations = o.effect === "Screen Shake Appearance" ? 3 : 12;
      ctx.globalAlpha *= o.amount / iterations;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < iterations; i++) {
        ctx.save();
        const t = (i / (iterations - 1) - 0.5) * o.radius;
        if (o.effect === "Radial Blur") {
          ctx.translate(o.width / 2, o.height / 2);
          ctx.rotate(t * o.angle * 0.0001);
          ctx.translate(-o.width / 2, -o.height / 2);
        } else {
          const a = (o.angle * Math.PI) / 180;
          ctx.translate(t * Math.cos(a), t * Math.sin(a));
        }
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, o.width, o.height);
        ctx.restore();
      }
      ctx.restore();
    },
    signal,
  );
}
async function paintBloom(
  ctx: CanvasRenderingContext2D,
  o: Fx,
  frames: PanelFrame[],
  d: CompositionDocument,
  resources: RenderResources,
  scale: number,
  signal?: AbortSignal,
) {
  const frame = o.owner
    ? frames.find((f) => f.panel.id === o.owner)
    : (frames.find((f) => o.y >= f.imageY && o.y < f.bottomY) ?? frames[0]);
  if (!frame) return;
  const plane = canvas(ctx.canvas.width, ctx.canvas.height),
    p = plane.getContext("2d", { willReadFrequently: true })!;
  p.setTransform(ctx.getTransform());
  await resources.image(
    frame.settings.snapshot?.blobId ?? frame.panel.blobId,
    (source, w, h) => {
      p.drawImage(
        source,
        (o.x * w) / d.width,
        ((o.owner ? o.y : o.y - frame.imageY) * h) / frame.imageHeight,
        (o.width * w) / d.width,
        (o.height * h) / frame.imageHeight,
        0,
        0,
        o.width,
        o.height,
      );
    },
    signal,
  );
  const pixels = p.getImageData(0, 0, plane.width, plane.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const luma =
      (pixels.data[i] * 0.2126 + pixels.data[i + 1] * 0.7152 + pixels.data[i + 2] * 0.0722) / 255;
    pixels.data[i + 3] *= clamp((luma - 0.6) / 0.4);
  }
  p.putImageData(pixels, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= o.amount;
  ctx.filter = `blur(${o.radius * scale}px)`;
  ctx.drawImage(plane, 0, 0);
  ctx.restore();
  plane.width = plane.height = 0;
}
function objectPadding(o: CompositionObject, frames: PanelFrame[], objects: CompositionObject[]) {
  const m = objectMatrix(o, frames, objects),
    scale = Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
  return (
    (o.kind === "sfx"
      ? Math.max(o.glow, o.shadow) * 3 +
        o.shadow +
        Math.max(0, ...o.strokes.map((s) => s.width)) * (o.ink ? 4 : 1)
      : o.kind === "fx"
        ? o.radius * 3
        : 0) * scale
  );
}
/** Rasterize ink against stable global bounds, independent of the requested
 * chapter segment. Clipping a transformed polygon path to different viewport
 * sizes changes browser stroke tessellation/AA at the crop. */
function paintStableInk(
  ctx: CanvasRenderingContext2D,
  o: Sfx,
  frames: PanelFrame[],
  objects: CompositionObject[],
  r: Region,
  scale: number,
  resources: RenderResources,
  outputWidth: number,
  maxArea: number,
) {
  const m = objectMatrix(o, frames, objects),
    points = inkPolygons(o).flat();
  if (!points.length) return;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of points) {
    const x = (m[0] * p.x + m[2] * p.y + m[4]) * scale,
      y = (m[1] * p.x + m[3] * p.y + m[5]) * scale;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const pad = Math.ceil(objectPadding(o, frames, objects) * scale) + 2;
  const bounds = {
    left: Math.max(0, Math.floor(x0) - pad),
    top: Math.floor(y0) - pad,
    right: Math.min(outputWidth, Math.ceil(x1) + pad),
    bottom: Math.ceil(y1) + pad,
  };
  if (bounds.right <= bounds.left) return;
  const origin = Math.round(r.y * scale),
    end = origin + ctx.canvas.height,
    limits = deviceLimits(),
    key = JSON.stringify([o, m, scale]);
  const paint = (
    left: number,
    top: number,
    width: number,
    height: number,
    core: { x: number; y: number; w: number; h: number },
  ) => {
    const id = `ink:${key}:${left}:${top}:${width}:${height}`;
    let tile = resources.get(id);
    if (!tile) {
      if (width > limits.maxSide || height > limits.maxSide || width * height > maxArea)
        throw Error(
          "Lettering exceeds this device render budget. Reduce the output width or lettering size.",
        );
      tile = canvas(width, height);
      const p = tile.getContext("2d")!;
      p.setTransform(scale, 0, 0, scale, -left, -top);
      p.transform(...m);
      paintSfx(p, o);
      if (o.texture) {
        p.globalCompositeOperation = "source-atop";
        p.strokeStyle = rgba("#000000", o.texture);
        p.lineWidth = 1;
        for (let i = 0; i < o.width / 7; i++) {
          p.beginPath();
          p.moveTo(i * 7, 0);
          p.lineTo(i * 7 + o.height * 0.2, o.height);
          p.stroke();
        }
      }
      resources.put(id, tile);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(
      tile,
      core.x - left,
      core.y - top,
      core.w,
      core.h,
      core.x,
      core.y - origin,
      core.w,
      core.h,
    );
    ctx.restore();
    if (resources.get(id) !== tile) tile.width = tile.height = 0;
  };
  const width = bounds.right - bounds.left,
    height = bounds.bottom - bounds.top;
  if (width <= limits.maxSide && height <= limits.maxSide && width * height <= maxArea) {
    paint(bounds.left, bounds.top, width, height, {
      x: bounds.left,
      y: bounds.top,
      w: width,
      h: height,
    });
    return;
  }
  // Large lettering stays bounded, with stable 128px cores and a glyph-sized halo.
  const halo =
      pad +
      Math.ceil(o.size * scale * Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])) * 1.5),
    step = 128;
  for (
    let y = Math.floor(Math.max(bounds.top, origin) / step) * step;
    y < Math.min(bounds.bottom, end);
    y += step
  )
    for (let x = Math.floor(bounds.left / step) * step; x < bounds.right; x += step) {
      const left = Math.max(0, x - halo),
        right = Math.min(outputWidth, x + step + halo),
        top = y - halo;
      paint(left, top, right - left, step + 2 * halo, {
        x,
        y,
        w: Math.min(step, outputWidth - x),
        h: step,
      });
    }
}
async function paintObjects(
  ctx: CanvasRenderingContext2D,
  d: CompositionDocument,
  frames: PanelFrame[],
  r: Region,
  scale: number,
  resources: RenderResources,
  signal?: AbortSignal,
  parentId?: string,
  excluded?: Set<string>,
  rootId?: string,
  inkArea = deviceLimits().maxArea / 6,
) {
  for (const o of d.objects.filter(
    (o) => o.parentId === parentId && (!rootId || o.id === rootId),
  )) {
    if (!o.visible || !o.opacity || excluded?.has(o.id)) continue;
    const b = objectBounds(o, frames, d.objects),
      padding = objectPadding(o, frames, d.objects);
    if (o.kind !== "group" && (b.y + b.height + padding < r.y || b.y - padding > r.y + r.height))
      continue;
    signal?.throwIfAborted();
    const layer = canvas(d.width * scale, r.height * scale),
      p = layer.getContext("2d")!;
    try {
      reset(p, scale, r.y);
      if (o.clip && o.owner) {
        const owner = frames.find((f) => f.panel.id === o.owner);
        if (owner) {
          p.beginPath();
          p.rect(0, owner.imageY, d.width, owner.imageHeight);
          p.clip();
        }
      }
      if (o.kind === "group")
        await paintObjects(
          p,
          d,
          frames,
          r,
          scale,
          resources,
          signal,
          o.id,
          excluded,
          undefined,
          inkArea,
        );
      else {
        if (o.clip && o.owner) {
          const owner = frames.find((f) => f.panel.id === o.owner);
          if (owner) {
            p.beginPath();
            p.rect(0, owner.imageY, d.width, owner.imageHeight);
            p.clip();
          }
        }
        p.transform(...objectMatrix(o, frames, d.objects));
        if (o.kind === "sfx") {
          await document.fonts.load(
            `${o.weight} ${o.size}px ${o.font}, "Noto Sans KR", "Noto Sans JP", "Noto Sans Arabic"`,
            o.text || " ",
          );
          signal?.throwIfAborted();
          const ink = o.ink && inkSupported(o.text);
          if (ink)
            paintStableInk(p, o, frames, d.objects, r, scale, resources, d.width * scale, inkArea);
          else paintSfx(p, o);
          if (o.texture && !ink) {
            p.globalCompositeOperation = "source-atop";
            p.strokeStyle = rgba("#000000", o.texture);
            p.lineWidth = 1;
            for (let i = 0; i < o.width / 7; i++) {
              p.beginPath();
              p.moveTo(i * 7, 0);
              p.lineTo(i * 7 + o.height * 0.2, o.height);
              p.stroke();
            }
          }
        } else if (o.kind === "fx") {
          if (o.effect === "Bloom") await paintBloom(p, o, frames, d, resources, scale, signal);
          if (/Blur|Screen Shake/.test(o.effect))
            await paintSampledFx(p, o, frames, d, resources, signal);
          if (!/Blur|Bloom/.test(o.effect)) paintFx(p, o);
        } else if (o.kind === "overlay")
          await resources.image(
            o.blobId,
            (source) => p.drawImage(source, 0, 0, o.width, o.height),
            signal,
          );
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = o.opacity;
      ctx.globalCompositeOperation = o.blend;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    } finally {
      layer.width = layer.height = 0;
    }
  }
}
async function paintTransitions(
  ctx: CanvasRenderingContext2D,
  d: CompositionDocument,
  frames: PanelFrame[],
  panels: Panel[],
  r: Region,
  scale: number,
  resources: RenderResources,
  signal?: AbortSignal,
  excluded?: Set<string>,
  onlyId?: string,
) {
  for (const t of d.transitions) {
    if (onlyId && t.id !== onlyId) continue;
    if (!t.visible || !transitionActive(t, panels) || excluded?.has(t.id)) continue;
    const a = frames.find((f) => f.panel.id === t.a)!,
      b = frames.find((f) => f.panel.id === t.b)!,
      center = (a.bottomY + b.imageY) / 2,
      top = center - t.height / 2;
    const start = Math.max(r.y, top),
      end = Math.min(r.y + r.height, top + t.height);
    if (end <= start) continue;
    const first = Math.floor(start * scale + 1e-7),
      last = Math.ceil(end * scale - 1e-7),
      y = first / scale;
    const plane = canvas(d.width * scale, last - first),
      p = plane.getContext("2d")!;
    if (/Crossfade|Gradient Blend|Dissolve|Blur Transition|Atmospheric|Custom Mask/.test(t.type)) {
      await resources.image(
        a.settings.snapshot?.blobId ?? a.panel.blobId,
        (source, w, h) => {
          const sh = Math.min(h, (t.height * w) / d.width);
          p.setTransform(scale, 0, 0, scale, 0, -(y - top) * scale);
          p.drawImage(source, 0, h - sh, w, sh, 0, 0, d.width, t.height);
        },
        signal,
      );
      const second = canvas(plane.width, plane.height),
        s = second.getContext("2d")!;
      await resources.image(
        b.settings.snapshot?.blobId ?? b.panel.blobId,
        (source, w, h) => {
          const sh = Math.min(h, (t.height * w) / d.width);
          s.setTransform(scale, 0, 0, scale, 0, -(y - top) * scale);
          s.drawImage(source, 0, 0, w, sh, 0, 0, d.width, t.height);
        },
        signal,
      );
      s.setTransform(1, 0, 0, 1, 0, 0);
      const mask = s.getImageData(0, 0, second.width, second.height);
      for (let py = 0; py < second.height; py++)
        for (let px = 0; px < second.width; px++) {
          const x = (px + 0.5) / scale,
            worldY = y + (py + 0.5) / scale,
            angle = (t.angle * Math.PI) / 180;
          let amount = clamp((worldY - top) / t.height + (x / d.width - 0.5) * Math.sin(angle));
          amount = clamp((amount - 0.5) / t.softness + 0.5);
          if (t.type === "Custom Mask Transition") amount = stopValue(t.stops, amount);
          if (t.type === "Dissolve") amount = noise(x, worldY, t.seed) < amount ? 1 : 0;
          mask.data[(py * second.width + px) * 4 + 3] *= amount;
        }
      s.putImageData(mask, 0, 0);
      p.setTransform(1, 0, 0, 1, 0, 0);
      p.drawImage(second, 0, 0);
      second.width = second.height = 0;
    } else {
      p.fillStyle =
        t.type === "White Transition"
          ? "#ffffff"
          : t.type === "Black Transition"
            ? "#000000"
            : t.color;
      p.fillRect(0, 0, plane.width, plane.height);
    }
    const data = p.getImageData(0, 0, plane.width, plane.height);
    for (let py = 0; py < plane.height; py++) {
      const q = (y + (py + 0.5) / scale - top) / t.height,
        coverage = clamp((Math.min(q, 1 - q) * 2) / t.softness) * t.opacity;
      for (let px = 0; px < plane.width; px++)
        data.data[(py * plane.width + px) * 4 + 3] *= coverage;
    }
    p.putImageData(data, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = t.blend ?? "source-over";
    if (
      t.type === "Blur Transition" ||
      t.type === "Fog Transition" ||
      t.type === "Atmospheric Transition"
    )
      ctx.filter = `blur(${t.softness * 30 * scale}px)`;
    ctx.drawImage(plane, 0, y, d.width, plane.height / scale);
    ctx.restore();
    plane.width = plane.height = 0;
  }
}
/** Bound the combined intermediate planes as well as the filter support, before allocation. */
export function compositionRenderBudget(
  d: CompositionDocument,
  panels: Panel[],
  scene = layout(d, panels),
) {
  const padding = Math.ceil(
    Math.max(
      2,
      ...Object.values(d.panels).flatMap((p) =>
        p.fades.filter((f) => f.visible).map((f) => f.blur * 3),
      ),
      ...scene.spaces
        .filter((s) => s.settings.visible && s.settings.fill === "blur")
        .map((s) => s.settings.blur * 3),
      ...d.objects
        .filter((o) => o.visible && o.opacity > 0)
        .map((o) => objectPadding(o, scene.frames, d.objects)),
      ...d.transitions.filter((t) => t.visible).map((t) => t.softness * 90),
    ),
  );

  const byId = new Map(d.objects.map((o) => [o.id, o]));
  let depth = 0;
  for (const o of d.objects) {
    let current = o.parentId,
      n = 0;
    while (current && n <= 64) {
      n++;
      current = byId.get(current)?.parentId;
    }
    depth = Math.max(depth, n);
  }
  return { padding, planes: Math.max(6, depth + 4) };
}
/** The same absolute-coordinate renderer serves editing, reading and output slices. */
export async function renderRegion(
  d: CompositionDocument,
  panels: Panel[],
  region: Region,
  outputWidth: number,
  resources: RenderResources,
  options: { signal?: AbortSignal; excluded?: Set<string> } = {},
) {
  const scale = outputWidth / d.width;
  const scene = layout(d, panels);
  const { padding, planes } = compositionRenderBudget(d, panels, scene);
  const paddingPixels = Math.ceil(padding * scale),
    firstPixel = Math.floor(region.y * scale + 1e-7),
    outputHeight = Math.max(1, Math.round(region.height * scale));
  const r = {
    y: (firstPixel - paddingPixels) / scale,
    height: (outputHeight + paddingPixels * 2 + 2) / scale,
  };
  const limits = deviceLimits();
  if (
    outputWidth > limits.maxSide ||
    r.height * scale > limits.maxSide ||
    outputWidth * r.height * scale * planes > limits.maxArea
  )
    throw Error(
      "This render region exceeds the device budget. Reduce export segment height or output width; original resolution was not changed.",
    );
  const working = canvas(outputWidth, r.height * scale),
    ctx = working.getContext("2d")!;
  reset(ctx, scale, r.y);
  if (d.background !== "transparent") {
    ctx.fillStyle = d.background;
    ctx.fillRect(0, r.y, d.width, r.height);
  }
  try {
    const spaces = new Map(scene.spaces.map((s) => [`space:${s.key}`, s])),
      frames = new Map(scene.frames.map((f) => [`source:${f.panel.id}`, f]));
    for (const key of layerStack(
      d,
      panels.map((p) => p.id),
    )) {
      options.signal?.throwIfAborted();
      if (options.excluded?.has(key)) continue;
      const spacing = spaces.get(key),
        frame = frames.get(key);
      if (spacing) {
        if (spacing.y + spacing.height >= r.y && spacing.y <= r.y + r.height)
          await paintSpace(ctx, spacing, d, scene.frames, resources, options.signal);
      } else if (frame)
        await paintPanel(ctx, frame, d, r, scale, resources, options.signal, options.excluded);
      else if (key.startsWith("transition:"))
        await paintTransitions(
          ctx,
          d,
          scene.frames,
          panels,
          r,
          scale,
          resources,
          options.signal,
          options.excluded,
          key.slice(11),
        );
      else if (key.startsWith("object:"))
        await paintObjects(
          ctx,
          d,
          scene.frames,
          r,
          scale,
          resources,
          options.signal,
          undefined,
          options.excluded,
          key.slice(7),
          limits.maxArea / planes,
        );
    }
    options.signal?.throwIfAborted();
    const out = canvas(outputWidth, outputHeight),
      p = out.getContext("2d")!;
    p.drawImage(
      working,
      0,
      region.y * scale - firstPixel + paddingPixels,
      outputWidth,
      out.height,
      0,
      0,
      outputWidth,
      out.height,
    );
    return out;
  } finally {
    working.width = working.height = 0;
  }
}
