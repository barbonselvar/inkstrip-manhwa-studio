import { sfx } from "./library.ts";
import type { Sfx } from "./model.ts";
export function inkObject(text: string, style: string): Sfx {
  return {
    ...sfx(text),
    name: `${style} · ${text}`,
    ink: style,
    size: 130,
    width: Math.max(400, [...text].length * 130),
    height: 210,
    rotation: -8,
    skew: -14,
    fill: "#111111",
    fill2: "#cccccc",
    gradient: style === "Metallic",
    texture: style === "Brush Ink" ? 0.25 : 0,
    shadow: style === "Shadowed Lettering" ? 12 : 0,
    glow: 0,
    strokes:
      style === "Double Outline"
        ? [
            { color: "#111111", width: 14 },
            { color: "#ffffff", width: 9 },
          ]
        : [
            {
              color: "#ffffff",
              width: style === "Thin Slash" ? 4 : style === "White Outline" ? 14 : 8,
            },
          ],
  };
}
