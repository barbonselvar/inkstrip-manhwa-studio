import {
  type ProDocument,
  type Layer,
  type Selection,
  type Stroke,
  validateDocument,
} from "./model";
import { shapePath } from "./paths";
import { applyAdjustments, hasAdjustments } from "../editor/adjustments";
import { tonePixels } from "./pixels";
import { cloneSourceMatrix } from "./operations";
import { matchRepairColor } from "./repair";
type Ctx = OffscreenCanvasRenderingContext2D;
function canvas(w: number, h: number) {
  return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
}
function region(ctx: Ctx, r: Selection["regions"][number]) {
  const first = r.points[0]!,
    last = r.points.at(-1)!;
  ctx.beginPath();
  if (r.kind === "rectangle")
    ctx.rect(
      Math.min(first.x, last.x),
      Math.min(first.y, last.y),
      Math.abs(last.x - first.x),
      Math.abs(last.y - first.y),
    );
  else if (r.kind === "ellipse")
    ctx.ellipse(
      (first.x + last.x) / 2,
      (first.y + last.y) / 2,
      Math.abs(last.x - first.x) / 2,
      Math.abs(last.y - first.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
  else {
    ctx.moveTo(first.x, first.y);
    for (const p of r.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
  }
  ctx.fill();
}
export function selectionCanvas(s: Selection, w: number, h: number, scale = 1) {
  const output = canvas(w * scale, h * scale),
    ctx = output.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  for (const r of s.regions) {
    const scratch = canvas(output.width, output.height),
      c = scratch.getContext("2d")!;
    c.scale(scale, scale);
    c.fillStyle = "#ffffff";
    region(c, r);
    ctx.globalCompositeOperation =
      r.operation === "subtract"
        ? "destination-out"
        : r.operation === "intersect"
          ? "destination-in"
          : "source-over";
    ctx.drawImage(scratch, 0, 0);
    scratch.width = scratch.height = 1;
  }
  if (s.inverted) {
    ctx.globalCompositeOperation = "xor";
    ctx.fillRect(0, 0, output.width, output.height);
  }
  if (s.feather) {
    const copy = canvas(output.width, output.height),
      c = copy.getContext("2d")!;
    c.filter = `blur(${s.feather * scale}px)`;
    c.drawImage(output, 0, 0);
    ctx.clearRect(0, 0, output.width, output.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(copy, 0, 0);
    copy.width = copy.height = 1;
  }
  return output;
}
function stroke(ctx: Ctx, s: Stroke) {
  // Flow accumulates per dab; opacity caps the complete stroke independently.
  if (s.opacity < 1) {
    const t = ctx.getTransform(),
      r = s.size / 2;
    const xs = s.points.map((p) => p.x),
      ys = s.points.map((p) => p.y);
    const left = Math.max(0, Math.floor((Math.min(...xs) - r) * t.a + t.e)),
      top = Math.max(0, Math.floor((Math.min(...ys) - r) * t.d + t.f));
    const right = Math.min(ctx.canvas.width, Math.ceil((Math.max(...xs) + r) * t.a + t.e)),
      bottom = Math.min(ctx.canvas.height, Math.ceil((Math.max(...ys) + r) * t.d + t.f));
    if (right <= left || bottom <= top || s.opacity === 0) return;
    const ink = canvas(right - left, bottom - top),
      c = ink.getContext("2d")!;
    c.setTransform(t.a, t.b, t.c, t.d, t.e - left, t.f - top);
    stroke(c, { ...s, opacity: 1, erase: false });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = s.opacity;
    ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    ctx.drawImage(ink, left, top);
    ctx.restore();
    ink.width = ink.height = 1;
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
  ctx.globalAlpha = s.flow;
  const radius = s.size / 2;
  const dot = (x: number, y: number) => {
    ctx.fillStyle = s.color;
    if (s.tip === "square") {
      ctx.fillRect(x - radius, y - radius, s.size, s.size);
      return;
    }
    if (s.hardness < 1) {
      const g = ctx.createRadialGradient(x, y, radius * s.hardness, x, y, radius);
      g.addColorStop(0, s.color);
      g.addColorStop(1, s.color === "transparent" ? "transparent" : `${s.color}00`);
      ctx.fillStyle = g;
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  dot(s.points[0]!.x, s.points[0]!.y);
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1]!,
      b = s.points[i]!,
      n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, radius * 0.2));
    for (let j = 1; j <= n; j++) dot(a.x + ((b.x - a.x) * j) / n, a.y + ((b.y - a.y) * j) / n);
  }
  ctx.restore();
}
async function surface(
  l: Layer,
  scale: number,
  asset: (id: string, scale: number) => Promise<ImageBitmap>,
) {
  const out = canvas(l.width * scale, l.height * scale),
    ctx = out.getContext("2d")!;
  ctx.scale(scale, scale);
  if (l.kind === "raster") ctx.drawImage(await asset(l.assetId!, scale), 0, 0, l.width, l.height);
  if (l.kind === "paint")
    for (const s of l.strokes) {
      if (s.clone) {
        const source = await asset(s.clone.assetId, scale),
          cloned = canvas(out.width, out.height),
          sourceCtx = cloned.getContext("2d")!,
          mask = canvas(out.width, out.height),
          maskCtx = mask.getContext("2d")!,
          offset = {
            x: s.clone.source.x - s.clone.destination.x,
            y: s.clone.source.y - s.clone.destination.y,
          };
        sourceCtx.setTransform(...cloneSourceMatrix(l, offset, scale));
        sourceCtx.drawImage(source, 0, 0);
        if (s.clone.mode === "heal") {
          // Use the immutable full-resolution sample as both the donor texture
          // and the target tone reference. Shift the donor's average RGB toward
          // the target patch before applying the same editable brush mask.
          const points = s.points,
            radius = (s.size / 2) * scale,
            left = Math.max(0, Math.floor((Math.min(...points.map((p) => p.x)) * scale) - radius)),
            top = Math.max(0, Math.floor((Math.min(...points.map((p) => p.y)) * scale) - radius)),
            right = Math.min(out.width, Math.ceil(Math.max(...points.map((p) => p.x)) * scale + radius)),
            bottom = Math.min(out.height, Math.ceil(Math.max(...points.map((p) => p.y)) * scale + radius));
          if (right > left && bottom > top) {
            const reference = canvas(out.width, out.height),
              referenceCtx = reference.getContext("2d", { willReadFrequently: true })!;
            referenceCtx.setTransform(...cloneSourceMatrix(l, { x: 0, y: 0 }, scale));
            referenceCtx.drawImage(source, 0, 0);
            const width = right - left,
              height = bottom - top,
              sampledPixels = sourceCtx.getImageData(left, top, width, height),
              targetPixels = referenceCtx.getImageData(left, top, width, height);
            sampledPixels.data.set(matchRepairColor(sampledPixels.data, targetPixels.data));
            sourceCtx.putImageData(sampledPixels, left, top);
            reference.width = reference.height = 1;
          }
        }
        maskCtx.scale(scale, scale);
        stroke(maskCtx, { ...s, clone: undefined, color: "#ffffff", erase: false, opacity: 1 });
        if (s.clip) {
          maskCtx.setTransform(1, 0, 0, 1, 0, 0);
          const clip = selectionCanvas(s.clip, l.width, l.height, scale);
          maskCtx.globalCompositeOperation = "destination-in";
          maskCtx.drawImage(clip, 0, 0);
          clip.width = clip.height = 1;
        }
        sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
        sourceCtx.globalCompositeOperation = "destination-in";
        sourceCtx.drawImage(mask, 0, 0);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = s.opacity;
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(cloned, 0, 0);
        ctx.restore();
        source.close();
        cloned.width = cloned.height = mask.width = mask.height = 1;
        continue;
      }
      if (s.clip) {
        const ink = canvas(out.width, out.height),
          c = ink.getContext("2d")!;
        c.scale(scale, scale);
        stroke(c, { ...s, erase: false });
        c.setTransform(1, 0, 0, 1, 0, 0);
        const clip = selectionCanvas(s.clip, l.width, l.height, scale);
        c.globalCompositeOperation = "destination-in";
        c.drawImage(clip, 0, 0);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
        ctx.drawImage(ink, 0, 0);
        ctx.restore();
        ink.width = clip.width = 1;
      } else stroke(ctx, s);
    }
  if (l.kind === "shape") {
    const path = new Path2D(shapePath(l));
    ctx.fillStyle = l.fill;
    ctx.strokeStyle = l.stroke;
    ctx.lineWidth = l.strokeWidth;
    ctx.lineJoin = "round";
    if (l.fill !== "transparent") ctx.fill(path);
    if (l.strokeWidth && l.stroke !== "transparent") ctx.stroke(path);
  }
  if (l.kind === "text") {
    ctx.font = `${l.fontWeight} ${l.fontSize}px ${l.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = l.align;
    ctx.fillStyle = l.fill;
    ctx.strokeStyle = l.stroke;
    ctx.lineWidth = l.strokeWidth;
    for (const [i, line] of l.text.split("\n").entries()) {
      const x = l.align === "left" ? 0 : l.align === "center" ? l.width / 2 : l.width,
        y = l.fontSize + i * l.fontSize * l.lineHeight;
      if (l.letterSpacing === 0) {
        if (l.fill !== "transparent") ctx.fillText(line, x, y);
        if (l.strokeWidth && l.stroke !== "transparent") ctx.strokeText(line, x, y);
      } else {
        const chars = Array.from(line),
          length =
            chars.reduce((a, c) => a + ctx.measureText(c).width, 0) +
            Math.max(0, chars.length - 1) * l.letterSpacing;
        let left =
          l.align === "left" ? 0 : l.align === "center" ? (l.width - length) / 2 : l.width - length;
        ctx.textAlign = "left";
        for (const c of chars) {
          if (l.fill !== "transparent") ctx.fillText(c, left, y);
          if (l.strokeWidth && l.stroke !== "transparent") ctx.strokeText(c, left, y);
          left += ctx.measureText(c).width + l.letterSpacing;
        }
        ctx.textAlign = l.align;
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (
    hasAdjustments(l.adjustments) ||
    l.hue ||
    l.black ||
    l.white !== 255 ||
    l.gamma !== 1 ||
    l.curve.some((n, i) => n !== [0, 64, 128, 192, 255][i])
  ) {
    const image = ctx.getImageData(0, 0, out.width, out.height);
    const pixels = applyAdjustments(image.data, out.width, out.height, l.adjustments, scale);
    image.data.set(tonePixels(pixels, l));
    ctx.putImageData(image, 0, 0);
  }
  if (l.mask?.enabled) {
    const mask = selectionCanvas(l.mask.selection, l.width, l.height, scale),
      m = mask.getContext("2d")!;
    m.scale(scale, scale);
    for (const s of l.mask.strokes) stroke(m, { ...s, color: "#ffffff" });
    if (l.mask.inverted) {
      m.save();
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.globalCompositeOperation = "xor";
      m.fillStyle = "#ffffff";
      m.fillRect(0, 0, mask.width, mask.height);
      m.restore();
    }
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0);
    mask.width = mask.height = 1;
  }
  return out;
}
export async function composite(
  d: ProDocument,
  scale: number,
  asset: (id: string, scale: number) => Promise<ImageBitmap>,
  cancel: () => boolean,
  progress: (done: number, total: number) => void,
) {
  validateDocument(d);
  const output = canvas(d.width * scale, d.height * scale);
  let done = 0;
  const total = d.layers.filter((l) => {
    if (!l.visible) return false;
    let parent = l.parentId;
    while (parent) {
      const p = d.layers.find((g) => g.id === parent);
      if (!p?.visible) return false;
      parent = p.parentId;
    }
    return true;
  }).length;
  const branch = async (target: OffscreenCanvas, parent?: string) => {
    const ctx = target.getContext("2d")!;
    for (const l of d.layers.filter((l) => l.parentId === parent)) {
      if (cancel()) throw new DOMException("Rendering superseded.", "AbortError");
      if (!l.visible) continue;
      let bitmap: OffscreenCanvas;
      if (l.kind === "group") {
        bitmap = canvas(output.width, output.height);
        await branch(bitmap, l.id);
      } else bitmap = await surface(l, scale, asset);
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = l.blend;
      if (l.kind !== "group") {
        ctx.translate(l.transform.x * scale, l.transform.y * scale);
        ctx.rotate((l.transform.rotation * Math.PI) / 180);
        ctx.scale(l.transform.scaleX, l.transform.scaleY);
      }
      ctx.drawImage(bitmap, 0, 0);
      ctx.restore();
      bitmap.width = bitmap.height = 1;
      progress(++done, total);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  const ctx = output.getContext("2d")!;
  if (d.background !== "transparent") {
    ctx.fillStyle = d.background;
    ctx.fillRect(0, 0, output.width, output.height);
  }
  try {
    await branch(output);
    return output;
  } catch (e) {
    output.width = output.height = 1;
    throw e;
  }
}
