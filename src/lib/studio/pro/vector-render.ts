import { paintLettering } from "../dialogue/lettering.ts";
import { appearance, vectorPaint, type AppearanceItem } from "./vector-appearance.ts";
import { shapePath } from "./paths.ts";
import { layoutPathText } from "./text-path.ts";
import type { Layer } from "./model.ts";
/** Appearance operations are isolated within the existing per-layer plane. */
export function drawVectorAppearance(ctx: OffscreenCanvasRenderingContext2D, l: Layer) {
  const path = l.kind === "shape" ? new Path2D(shapePath(l)) : undefined;
  const items = appearance(l);
  if (l.lettering?.outlineFirst && l.appearance === undefined)
    items.sort((a, b) => Number(a.kind === "fill") - Number(b.kind === "fill"));
  if (l.kind === "text") {
    ctx.font = `${l.fontWeight} ${l.fontSize}px ${l.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    ctx.fontKerning = l.textPath || l.letterSpacing ? "none" : "auto";
  }
  const glyphs = l.textPath ? layoutPathText(l, (s) => ctx.measureText(s).width) : undefined;
  for (const a of items) {
    if (!a.visible || !a.opacity) continue;
    if (!path) {
      textPaint(ctx, l, a, glyphs);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = a.opacity;
    ctx.globalCompositeOperation = a.blend;
    const paint = vectorPaint(ctx, a.paint, l);
    ctx.fillStyle = ctx.strokeStyle = paint;
    ctx.lineWidth = a.width * (a.alignment === "center" ? 1 : 2);
    ctx.lineCap = a.cap;
    ctx.lineJoin = a.join;
    ctx.miterLimit = a.miterLimit;
    ctx.setLineDash(a.dash);
    ctx.lineDashOffset = a.dashOffset;
    if (path) {
      if (a.kind === "fill") ctx.fill(path, a.fillRule);
      else if (a.width) {
        if (a.alignment === "inside") ctx.clip(path, a.fillRule);
        if (a.alignment === "outside") {
          const c = new Path2D();
          c.rect(-1000000, -1000000, 2000000, 2000000);
          ctx.clip(c); // destination-out via a geometric complement, preserving holes/winding
          const original = ctx.getTransform();
          // Even-odd complement of an already normalized closed fill uses Path2D clipping.
          // The two successive clip calls need the inverse fill; Canvas supports evenodd.
          const complement = new Path2D();
          complement.rect(-1000000, -1000000, 2000000, 2000000);
          complement.addPath(path);
          if (a.fillRule === "nonzero") {
            // Nonzero overlapping contours need union topology before complementing.
            // Use a separate coverage mask rather than silently switching the fill rule.
            const width = ctx.canvas.width,
              height = ctx.canvas.height,
              plane = new OffscreenCanvas(width, height),
              pc = plane.getContext("2d")!;
            pc.setTransform(original);
            pc.strokeStyle = paint;
            pc.lineWidth = ctx.lineWidth;
            pc.lineCap = a.cap;
            pc.lineJoin = a.join;
            pc.miterLimit = a.miterLimit;
            pc.setLineDash(a.dash);
            pc.lineDashOffset = a.dashOffset;
            pc.stroke(path);
            pc.globalCompositeOperation = "destination-out";
            pc.fill(path, a.fillRule);
            ctx.resetTransform();
            ctx.globalCompositeOperation = a.blend;
            ctx.drawImage(plane, 0, 0);
            plane.width = plane.height = 1;
            ctx.restore();
            continue;
          }
          ctx.clip(complement, "evenodd");
        }
        ctx.stroke(path);
      }
    }
    ctx.restore();
  }
}

function textPaint(
  destination: OffscreenCanvasRenderingContext2D,
  l: Layer,
  a: AppearanceItem,
  glyphs: ReturnType<typeof layoutPathText> | undefined,
) {
  if (a.kind === "stroke" && !a.width) return;
  const plane = new OffscreenCanvas(destination.canvas.width, destination.canvas.height),
    ctx = plane.getContext("2d")!;
  ctx.setTransform(destination.getTransform());
  ctx.font = destination.font;
  ctx.fontKerning = destination.fontKerning;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = a.width;
  ctx.lineCap = a.cap;
  ctx.lineJoin = a.join;
  ctx.miterLimit = a.miterLimit;
  ctx.setLineDash(a.dash);
  ctx.lineDashOffset = a.dashOffset;
  if (l.lettering) {
    paintLettering(ctx, l, a.kind);
  } else if (glyphs) {
    ctx.textAlign = "center";
    for (const g of glyphs) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      if (a.kind === "fill") ctx.fillText(g.text, 0, l.textPath!.baseline);
      else if (a.width) ctx.strokeText(g.text, 0, l.textPath!.baseline);
      ctx.restore();
    }
  } else {
    for (const [i, line] of l.text.split("\n").entries()) {
      const y = l.fontSize + i * l.fontSize * l.lineHeight,
        chars = Array.from(line);
      if (!l.letterSpacing) {
        ctx.textAlign = l.align;
        const x = l.align === "left" ? 0 : l.align === "center" ? l.width / 2 : l.width;
        if (a.kind === "fill") ctx.fillText(line, x, y);
        else if (a.width) ctx.strokeText(line, x, y);
      } else {
        const advance =
          chars.reduce((n, c) => n + ctx.measureText(c).width, 0) +
          Math.max(0, chars.length - 1) * l.letterSpacing;
        let x =
          l.align === "left"
            ? 0
            : l.align === "center"
              ? (l.width - advance) / 2
              : l.width - advance;
        ctx.textAlign = "left";
        for (const c of chars) {
          if (a.kind === "fill") ctx.fillText(c, x, y);
          else if (a.width) ctx.strokeText(c, x, y);
          x += ctx.measureText(c).width + l.letterSpacing;
        }
      }
    }
  }

  // Paint the coverage once in object coordinates: gradients span the object,
  // and overlapping glyphs receive item opacity/blending exactly once.
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = vectorPaint(ctx, a.paint, l);
  const inv = ctx.getTransform().inverse(),
    corners = [
      new DOMPoint(0, 0),
      new DOMPoint(plane.width, 0),
      new DOMPoint(0, plane.height),
      new DOMPoint(plane.width, plane.height),
    ].map((p) => p.matrixTransform(inv)),
    left = Math.min(...corners.map((p) => p.x)),
    top = Math.min(...corners.map((p) => p.y));
  ctx.fillRect(
    left - 1,
    top - 1,
    Math.max(...corners.map((p) => p.x)) - left + 2,
    Math.max(...corners.map((p) => p.y)) - top + 2,
  );
  destination.save();
  destination.globalAlpha = a.opacity;
  destination.globalCompositeOperation = a.blend;
  destination.resetTransform();
  destination.drawImage(plane, 0, 0);
  destination.restore();
  plane.width = plane.height = 1;
}
