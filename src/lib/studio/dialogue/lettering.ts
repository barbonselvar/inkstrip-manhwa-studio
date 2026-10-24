import type { Layer } from "../pro/model.ts";
import { DEFAULT_LETTERING, validateLettering, type Lettering } from "./types.ts";
export type TextRun = {
  text: string;
  x: number;
  y: number;
  rotation: number;
  align: CanvasTextAlign;
};
export type LetteringLayout = {
  fontSize: number;
  runs: TextRun[];
  width: number;
  height: number;
  overflow: boolean;
};
const graphemes = (s: string, language: string) =>
  typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(language, { granularity: "grapheme" }).segment(s)].map(
        (v) => v.segment,
      )
    : Array.from(s);
export function letteringFont(layer: Layer, size = layer.fontSize) {
  const settings = layer.lettering ?? DEFAULT_LETTERING;
  return `${settings.italic ? "italic " : ""}${layer.fontWeight} ${size}px ${settings.font}`;
}
/** Locale word boundaries plus grapheme-safe breaking. Entire Arabic lines remain shaped together. */
export function wrapLettering(
  text: string,
  width: number,
  size: number,
  settings: Lettering,
  measure: (s: string, size: number) => number,
  spacing = 0,
) {
  const result: { text: string; paragraphEnd: boolean }[] = [];
  const advance = (value: string) =>
    measure(value, size) + Math.max(0, graphemes(value, settings.language).length - 1) * spacing;
  for (const paragraph of text.split("\n")) {
    if (!settings.wrap || !paragraph) {
      result.push({ text: paragraph, paragraphEnd: true });
      continue;
    }
    const words =
      typeof Intl.Segmenter === "function"
        ? [
            ...new Intl.Segmenter(settings.language, { granularity: "word" }).segment(paragraph),
          ].map((v) => v.segment)
        : paragraph.split(/(\s+)/);
    let line = "";
    for (const word of words) {
      if (advance(line + word) <= width) {
        line += word;
        continue;
      }
      if (line.trim()) {
        result.push({ text: line.trimEnd(), paragraphEnd: false });
        line = "";
      }
      if (advance(word) <= width) {
        line = word.trimStart();
        continue;
      }
      for (const char of graphemes(word, settings.language)) {
        if (line && advance(line + char) > width) {
          result.push({ text: line, paragraphEnd: false });
          line = "";
        }
        line += char;
      }
    }
    result.push({ text: line.trimEnd(), paragraphEnd: true });
  }
  return result;
}
export function layoutLettering(
  layer: Layer,
  measure: (s: string, size: number) => number,
): LetteringLayout {
  const settings = layer.lettering ?? DEFAULT_LETTERING;
  validateLettering(settings);
  const padding = Math.min(
    settings.padding,
    Math.max(0, (Math.min(layer.width, layer.height) - 1) / 2),
  );
  const availableWidth = Math.max(1, layer.width - padding * 2),
    availableHeight = Math.max(1, layer.height - padding * 2);
  const build = (size: number): LetteringLayout => {
    const runs: TextRun[] = [];
    if (settings.writing === "vertical") {
      const advance = size * layer.lineHeight,
        perColumn = Math.max(1, Math.floor(availableHeight / advance));
      let column = 0,
        row = 0;
      for (const char of graphemes(layer.text, settings.language)) {
        if (char === "\n") {
          column++;
          row = 0;
          continue;
        }
        if (row >= perColumn) {
          column++;
          row = 0;
        }
        // Keep CJK characters upright; Latin and digits rotate as a single-character run.
        const rotate = /^[\p{Script=Latin}\p{N}]$/u.test(char) ? Math.PI / 2 : 0;
        const verticalPunctuation: Record<string, string> = {
          "、": "︑",
          "。": "︒",
          "「": "﹁",
          "」": "﹂",
          "（": "︵",
          "）": "︶",
          ー: "︱",
        };
        runs.push({
          text: verticalPunctuation[char] ?? char,
          x: layer.width - padding - size / 2 - column * advance,
          y: padding + size + row * advance,
          rotation: rotate,
          align: "center",
        });
        row++;
      }
      const width = (column + 1) * advance,
        height = Math.min(perColumn, row || perColumn) * advance;
      return {
        fontSize: size,
        runs,
        width,
        height,
        overflow: width > availableWidth + 0.01 || size > availableHeight,
      };
    }
    const lines = wrapLettering(
      layer.text,
      availableWidth,
      size,
      settings,
      measure,
      layer.letterSpacing,
    );
    let y = padding + size,
      max = 0;
    for (const line of lines) {
      runs.push({
        text: line.text,
        x:
          layer.align === "left"
            ? padding
            : layer.align === "center"
              ? layer.width / 2
              : layer.width - padding,
        y,
        rotation: 0,
        align: layer.align,
      });
      const width =
        measure(line.text, size) +
        Math.max(0, graphemes(line.text, settings.language).length - 1) * layer.letterSpacing;
      max = Math.max(max, width);
      y += size * layer.lineHeight + (line.paragraphEnd ? settings.paragraphSpacing : 0);
    }
    const height = lines.length ? runs.at(-1)!.y - padding + size * 0.2 : 0;
    return {
      fontSize: size,
      runs,
      width: max,
      height,
      overflow: max > availableWidth + 0.01 || height > availableHeight + 0.01,
    };
  };
  let result = build(layer.fontSize);
  if (settings.fit && result.overflow) {
    let low = Math.min(4, layer.fontSize),
      high = layer.fontSize;
    for (let i = 0; i < 12; i++) {
      const middle = (low + high) / 2,
        candidate = build(middle);
      if (candidate.overflow) high = middle;
      else low = middle;
    }
    result = build(low);
  }
  return result;
}
export function canvasLetteringLayout(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  l: Layer,
) {
  const cache = new Map<string, number>();
  return layoutLettering(l, (value, size) => {
    const key = `${size}:${value}`;
    const saved = cache.get(key);
    if (saved !== undefined) return saved;
    ctx.font = letteringFont(l, size);
    const width = ctx.measureText(value).width;
    cache.set(key, width);
    return width;
  });
}
/** Native Canvas text is retained; no HTML insertion or raster text asset is created. */
export function paintLettering(
  ctx: OffscreenCanvasRenderingContext2D,
  l: Layer,
  kind: "fill" | "stroke",
) {
  const settings = l.lettering!;
  const layout = canvasLetteringLayout(ctx, l);
  ctx.font = letteringFont(l, layout.fontSize);
  ctx.direction = settings.direction;
  ctx.textBaseline = "alphabetic";
  // Modern Canvas spacing preserves Arabic shaping; do not split it into unjoined glyphs.
  ctx.letterSpacing = `${l.letterSpacing}px`;
  for (const run of layout.runs) {
    ctx.save();
    ctx.textAlign = run.align;
    ctx.translate(run.x, run.y);
    ctx.rotate(run.rotation);
    if (kind === "fill") ctx.fillText(run.text, 0, 0);
    else ctx.strokeText(run.text, 0, 0);
    ctx.restore();
  }
}

const svgSpaceCache = new Map<string, number>();
/** SVG and Canvas can choose different advances for spaces in the same CJK font.
 * Measure that browser difference explicitly; keep glyph shapes and editable text intact. */
export function svgWordSpacing(l: Layer, text: string, size: number) {
  const spaces = (text.match(/ /g) ?? []).length;
  if (!spaces || typeof document === "undefined") return 0;
  const key = JSON.stringify([l.lettering, l.fontWeight, l.letterSpacing, text, size]);
  const cached = svgSpaceCache.get(key);
  if (cached !== undefined) return cached;
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg"),
    node = document.createElementNS(ns, "text"),
    settings = l.lettering!;
  svg.setAttribute("width", "1");
  svg.setAttribute("height", "1");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "fixed";
  svg.style.left = "-10000px";
  svg.style.visibility = "hidden";
  for (const [name, value] of Object.entries({
    "font-family": settings.font,
    "font-size": String(size),
    "font-weight": String(l.fontWeight),
    "font-style": settings.italic ? "italic" : "normal",
    "letter-spacing": String(l.letterSpacing),
    direction: settings.direction,
    "unicode-bidi": "plaintext",
  }))
    node.setAttribute(name, value);
  node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  node.textContent = text;
  svg.append(node);
  document.body.append(svg);
  let measured: number;
  try {
    measured = node.getComputedTextLength();
  } finally {
    svg.remove();
  }
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = letteringFont(l, size);
  ctx.letterSpacing = `${l.letterSpacing}px`;
  ctx.fontKerning = l.letterSpacing ? "none" : "auto";
  ctx.direction = settings.direction;
  const correction = (ctx.measureText(text).width - measured) / spaces;
  if (!Number.isFinite(correction) || Math.abs(correction) > size * 0.25)
    throw Error(
      "This font has incompatible SVG spacing metrics. Choose another font or export PNG/native to preserve the artwork.",
    );
  if (svgSpaceCache.size >= 128) svgSpaceCache.clear();
  svgSpaceCache.set(key, correction);
  return correction;
}
