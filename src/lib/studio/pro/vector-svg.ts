import { appearance, gradientMatrix } from "./vector-appearance.ts";
import { measureTextPath, trimmedTextContour } from "./text-path.ts";
import { contourData, type Layer } from "./model.ts";
import { affine } from "./transform.ts";
import { shapePath } from "./paths.ts";
const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
/** Standard SVG geometry with identical stacked paths/text; no embedded scripts/images. */
export function appearanceSvg(l: Layer, definitions: string[]) {
  const id = () => `ink-${definitions.length}`,
    path = l.kind === "shape" ? shapePath(l) : undefined;
  let textPath: string | undefined;
  if (l.textPath) {
    textPath = id();
    definitions.push(`<path id="${textPath}" d="${contourData(trimmedTextContour(l))}"/>`);
  }
  const output = appearance(l)
    .map((a) => {
      let paint = a.paint.color === "transparent" ? "none" : a.paint.color;
      if (a.paint.gradient) {
        const g = a.paint.gradient,
          key = id(),
          stops = g.stops
            .map(
              (s) =>
                `<stop offset="${s.position}" stop-color="${s.color}" stop-opacity="${s.opacity}"/>`,
            )
            .join(""),
          transform = `gradientUnits="userSpaceOnUse" gradientTransform="matrix(${gradientMatrix(g, l).join(" ")})"`;
        definitions.push(
          g.kind === "linear"
            ? `<linearGradient id="${key}" ${transform} x1="${g.from.x}" y1="${g.from.y}" x2="${g.to.x}" y2="${g.to.y}">${stops}</linearGradient>`
            : `<radialGradient id="${key}" ${transform} fx="${g.from.x}" fy="${g.from.y}" cx="${g.to.x}" cy="${g.to.y}" r="${g.radius}">${stops}</radialGradient>`,
        );
        paint = `url(#${key})`;
      }
      let clip = "";
      if (a.kind === "stroke" && a.alignment !== "center") {
        const key = id();
        definitions.push(
          a.alignment === "inside"
            ? `<clipPath id="${key}" clipPathUnits="userSpaceOnUse"><path d="${path}" fill-rule="${a.fillRule}" clip-rule="${a.fillRule}"/></clipPath>`
            : `<mask id="${key}" maskUnits="userSpaceOnUse" x="-1000000" y="-1000000" width="2000000" height="2000000" mask-type="luminance"><rect x="-1000000" y="-1000000" width="2000000" height="2000000" fill="#ffffff"/><path d="${path}" fill="#000000" fill-rule="${a.fillRule}"/></mask>`,
        );
        clip = `${a.alignment === "inside" ? "clip-path" : "mask"}="url(#${key})"`;
      }
      const attrs = `data-inkstrip-item="${a.kind}" visibility="${a.visible ? "visible" : "hidden"}" opacity="${a.opacity}" fill="${a.kind === "fill" ? paint : "none"}" stroke="${a.kind === "stroke" ? paint : "none"}" fill-rule="${a.fillRule}" stroke-width="${a.width * (a.alignment === "center" ? 1 : 2)}" stroke-linecap="${a.cap}" stroke-linejoin="${a.join}" stroke-miterlimit="${a.miterLimit}" stroke-dasharray="${a.dash.length ? a.dash.join(" ") : "none"}" stroke-dashoffset="${a.dashOffset}" data-inkstrip-stroke-align="${a.alignment}" style="mix-blend-mode:${a.blend === "source-over" ? "normal" : a.blend}" ${clip}`;
      if (path !== undefined) return `<path ${attrs} d="${path}"/>`;
      const font = `xml:space="preserve" font-family="${l.fontFamily}" font-size="${l.fontSize}" font-weight="${l.fontWeight}" letter-spacing="${l.letterSpacing}" font-kerning="${l.textPath || l.letterSpacing ? "none" : "auto"}" font-variant-ligatures="${l.textPath || l.letterSpacing ? "none" : "normal"}" text-anchor="${l.align === "left" ? "start" : l.align === "center" ? "middle" : "end"}"`;
      if (textPath) {
        const length = Math.max(0, measureTextPath(l).length - l.textPath!.start - l.textPath!.end),
          offset =
            (l.align === "left" ? 0 : l.align === "center" ? length / 2 : length) +
            (l.textPath!.offset ?? 0);
        return `<text ${attrs} ${font} dy="${l.textPath!.baseline}"><textPath href="#${textPath}" startOffset="${offset}">${xml(l.text)}</textPath></text>`;
      }
      return `<text ${attrs} ${font}>${l.text
        .split("\n")
        .map(
          (line, i) =>
            `<tspan x="${l.align === "left" ? 0 : l.align === "center" ? l.width / 2 : l.width}" y="${l.fontSize + i * l.fontSize * l.lineHeight}">${xml(line)}</tspan>`,
        )
        .join("")}</text>`;
    })
    .join("");
  let clipped = output;
  for (const c of l.vectorClips ?? [])
    if (c.enabled) {
      const key = id();
      definitions.push(
        `<clipPath id="${key}" clipPathUnits="userSpaceOnUse"><path d="${c.contours.map(contourData).join(" ")}" transform="matrix(${c.matrix.join(" ")})" clip-rule="${c.rule}"/></clipPath>`,
      );
      clipped = `<g clip-path="url(#${key})">${clipped}</g>`;
    }
  return `<g data-inkstrip-appearance="1" data-inkstrip-name="${xml(l.name)}" opacity="${l.opacity}" transform="matrix(${affine(l.transform).join(" ")})" style="isolation:isolate">${clipped}</g>`;
}
