import { pathData, type Layer } from "./model.ts";
export function shapePath(l: Layer): string {
  const w = l.width,
    h = l.height;
  if (l.shape === "path") return pathData(l);
  if (l.shape === "line") return `M0 0 L${w} ${h}`;
  if (l.shape === "rectangle" || l.shape === "caption") return `M0 0 H${w} V${h} H0 Z`;
  if (l.shape === "ellipse")
    return `M0 ${h / 2} A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2} A${w / 2} ${h / 2} 0 1 0 0 ${h / 2} Z`;
  if (l.shape === "polygon" || l.shape === "shout") {
    const n = l.shape === "shout" ? 24 : 6,
      points = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2,
          r = l.shape === "shout" && i % 2 ? 0.72 : 1;
        return `${w / 2 + ((Math.cos(a) * w) / 2) * r} ${h / 2 + ((Math.sin(a) * h) / 2) * r}`;
      });
    return `M${points.join(" L")} Z`;
  }
  if (l.shape === "thought") {
    const points = Array.from({ length: 96 }, (_, i) => {
      const angle = (i / 96) * Math.PI * 2,
        r = 1 + 0.06 * Math.cos(angle * 12);
      return {
        x: w / 2 + Math.cos(angle) * w * 0.46 * r,
        y: h * 0.36 + Math.sin(angle) * h * 0.32 * r,
      };
    });
    let d = `M${points[0]!.x} ${points[0]!.y}`;
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length]!,
        b = points[i]!,
        c = points[(i + 1) % points.length]!,
        e = points[(i + 2) % points.length]!;
      d += ` C${b.x + (c.x - a.x) / 6} ${b.y + (c.y - a.y) / 6} ${c.x - (e.x - b.x) / 6} ${c.y - (e.y - b.y) / 6} ${c.x} ${c.y}`;
    }
    const r = Math.min(w, h) * 0.06,
      x = l.tail.x,
      y = l.tail.y;
    return d + ` Z M${x - r} ${y} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
  }
  // One closed bubble outline: its tail is part of the editable path, never an overlay fill.
  return `M${w * 0.62} ${h * 0.68} C${w * 1.15} ${h * 0.6} ${w * 1.1} 0 ${w * 0.5} 0 C${-w * 0.1} 0 ${-w * 0.1} ${h * 0.65} ${w * 0.4} ${h * 0.7} L${l.tail.x} ${l.tail.y} L${w * 0.53} ${h * 0.71} Z`;
}
export function textLines(l: Layer): string[] {
  return l.text.split("\n");
}
