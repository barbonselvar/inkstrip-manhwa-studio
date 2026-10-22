import { svgGradient, svgNumber, localReference } from "./svg-paint.ts";
import {
  appearance,
  appearanceItem,
  paintBounds,
  type AppearanceItem,
} from "./vector-appearance.ts";
import { defaultTextPath, measureTextPath } from "./text-path.ts";
import type { VectorClip } from "./vector-clip.ts";
import { contours, contourData, fromPanel, layer, validateDocument, type Layer } from "./model.ts";
import { nativePath } from "./compound.ts";
import { svgMatrix } from "./svg-path.ts";
import { compose, fromAffine, affine, inverse, applyMatrix, type Matrix } from "./transform.ts";
function svgShapeData(el: Element, numeric: typeof svgNumber): string {
  const n = (name: string, fallback = 0) => numeric(el.getAttribute(name), fallback);
  let d = "";
  if (el.localName === "path") d = el.getAttribute("d") ?? "";
  else if (el.localName === "rect") {
    const x = n("x"),
      y = n("y"),
      w = n("width"),
      h = n("height"),
      rx = Math.min(w / 2, n("rx", n("ry"))),
      ry = Math.min(h / 2, n("ry", n("rx")));
    if (w < 0 || h < 0 || rx < 0 || ry < 0) throw new Error("Negative SVG rectangle dimensions.");
    if (!w || !h) return "";
    d =
      rx && ry
        ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
        : `M${x} ${y}h${w}v${h}h${-w}Z`;
  } else if (["circle", "ellipse"].includes(el.localName)) {
    const x = n("cx"),
      y = n("cy"),
      rx = n("rx", n("r")),
      ry = n("ry", n("r"));
    if (rx < 0 || ry < 0) throw new Error("Negative SVG ellipse radii.");
    if (!rx || !ry) return "";
    d = `M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
  } else if (el.localName === "line") d = `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`;
  else {
    const points = (el.getAttribute("points") ?? "")
      .trim()
      .split(/[\s,]+/)
      .map((s) => numeric(s, 0));
    if (points.length < 4 || points.length % 2) throw new Error("Invalid SVG points.");
    d =
      `M${points[0]} ${points[1]} ` +
      points.slice(2).reduce((s, v, i) => s + (i % 2 ? `${v} ` : `L${v} `), "") +
      (el.localName === "polygon" ? "Z" : "");
  }
  return d;
}
const STYLES = [
  "fill",
  "stroke",
  "stroke-width",
  "fill-rule",
  "fill-opacity",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "letter-spacing",
  "font-kerning",
  "font-variant-ligatures",
  "visibility",
];
/** Strict data-only SVG import. Never attach markup or external resources to the DOM. */
export function importSvg(text: string): { width: number; height: number; layers: Layer[] } {
  if (text.length > 1_000_000 || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text))
    throw new Error("SVG declarations or oversized input are not supported.");
  const xml = new DOMParser().parseFromString(text, "image/svg+xml"),
    root = xml.documentElement,
    allowed = new Set([
      "svg",
      "g",
      "rect",
      "circle",
      "ellipse",
      "line",
      "polygon",
      "polyline",
      "path",
      "text",
      "title",
      "desc",
      "defs",
      "linearGradient",
      "radialGradient",
      "stop",
      "clipPath",
      "mask",
      "textPath",
      "tspan",
    ]),
    attrs = new Set([
      "xmlns",
      "version",
      "viewBox",
      "preserveAspectRatio",
      "width",
      "height",
      "x",
      "y",
      "rx",
      "ry",
      "r",
      "cx",
      "cy",
      "x1",
      "y1",
      "x2",
      "y2",
      "points",
      "d",
      "transform",
      "opacity",
      "id",
      "style",
      "xmlns:xlink",
      "xml:space",
      "mix-blend-mode",
      "href",
      "xlink:href",
      "dy",
      "startOffset",
      "method",
      "spacing",
      "side",
      "gradientUnits",
      "gradientTransform",
      "spreadMethod",
      "fx",
      "fy",
      "offset",
      "stop-color",
      "stop-opacity",
      "clip-path",
      "clipPathUnits",
      "clip-rule",
      "mask",
      "maskUnits",
      "maskContentUnits",
      "mask-type",
      "display",
      "isolation",
      "data-inkstrip-appearance",
      "data-inkstrip-name",
      "data-inkstrip-item",
      "data-inkstrip-stroke-align",
      ...STYLES,
    ]);
  if (root.localName !== "svg" || xml.querySelector("parsererror"))
    throw new Error("Invalid SVG document.");
  const elements = [root, ...root.querySelectorAll("*")],
    ids = new Map<string, Element>();
  if (elements.length > 4096) throw Error("SVG exceeds the definition/node budget.");
  for (const el of elements) {
    if (
      !allowed.has(el.localName) ||
      (el.namespaceURI && el.namespaceURI !== "http://www.w3.org/2000/svg")
    )
      throw Error(`Unsupported SVG element: ${el.localName}.`);
    let depth = 0;
    for (let parent = el.parentElement; parent; parent = parent.parentElement)
      if (++depth > 64) throw Error("SVG nesting exceeds the safe depth limit.");
    if (el !== root && el.localName === "svg") throw Error("Nested SVG viewports are unsupported.");
    const id = el.getAttribute("id");
    if (id) {
      if (ids.has(id)) throw Error("Duplicate SVG definition ID.");
      ids.set(id, el);
    }
    for (const a of el.attributes) {
      if (!attrs.has(a.name)) throw Error(`Unsafe or unsupported SVG attribute: ${a.name}.`);
      if (["xmlns", "xmlns:xlink"].includes(a.name)) continue;
      if (/javascript:|data:|https?:|\/\//i.test(a.value))
        throw Error("External SVG resources are unsafe.");
      if (/url\s*\(/i.test(a.value)) {
        const references = [...a.value.matchAll(/url\s*\([^)]*\)/gi)];
        if (!references.length) throw Error("Malformed SVG resource reference.");
        for (const reference of references) localReference(reference[0]);
      }
      if (["href", "xlink:href"].includes(a.name) && !/^#[\w:.-]+$/.test(a.value))
        throw Error("SVG references must be local IDs.");
    }
  }
  const numeric = svgNumber;
  const boxText = root.getAttribute("viewBox"),
    box = boxText
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
  if (box && (box.length !== 4 || !box.every(Number.isFinite) || box[2]! <= 0 || box[3]! <= 0))
    throw new Error("Invalid SVG viewBox.");
  const width = numeric(root.getAttribute("width"), box?.[2] ?? 800),
    height = numeric(root.getAttribute("height"), box?.[3] ?? 800);
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 16_000_000)
    throw new Error("SVG dimensions exceed Pro limits.");
  let viewport: Matrix = [1, 0, 0, 1, 0, 0];
  if (box) {
    const sx = width / box[2]!,
      sy = height / box[3]!,
      aspect = root.getAttribute("preserveAspectRatio")?.trim() ?? "xMidYMid meet";
    if (aspect === "none") viewport = [sx, 0, 0, sy, -box[0]! * sx, -box[1]! * sy];
    else {
      const m = aspect.match(/^x(Min|Mid|Max)Y(Min|Mid|Max)(?:\s+(meet|slice))?$/);
      if (!m) throw new Error("Unsupported SVG preserveAspectRatio.");
      const scale = m[3] === "slice" ? Math.max(sx, sy) : Math.min(sx, sy),
        align = { Min: 0, Mid: 0.5, Max: 1 };
      viewport = [
        scale,
        0,
        0,
        scale,
        -box[0]! * scale + (width - box[2]! * scale) * align[m[1] as keyof typeof align],
        -box[1]! * scale + (height - box[3]! * scale) * align[m[2] as keyof typeof align],
      ];
    }
  }
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext("2d")!;
  const color = (s: string): { color: string; opacity: number } => {
    if (s === "none" || s === "transparent") return { color: "transparent", opacity: 1 };
    if (!CSS.supports("color", s) || /var\s*\(|currentcolor|context-/i.test(s))
      throw new Error("Unsupported SVG color.");
    colorContext.fillStyle = "#010203";
    colorContext.fillStyle = s;
    const parsed = colorContext.fillStyle;
    colorContext.fillStyle = "#040506";
    colorContext.fillStyle = s;
    if (colorContext.fillStyle !== parsed) throw new Error("Unsupported SVG color context.");
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = s;
    colorContext.fillRect(0, 0, 1, 1);
    const p = colorContext.getImageData(0, 0, 1, 1).data;
    return {
      color: `#${[p[0]!, p[1]!, p[2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
      opacity: p[3]! / 255,
    };
  };
  const layers: Layer[] = [];
  const push = (l: Layer) => {
    if (layers.length >= 48) throw new Error("SVG exceeds the 48-layer limit.");
    layers.push(l);
  };
  const walk = (
    el: Element,
    parent: Matrix,
    inherited: Record<string, string>,
    parentId?: string,
    clipping: { id: string; mask: boolean; matrix: Matrix; group: boolean }[] = [],
    stackItem = false,
  ) => {
    if (["title", "desc", "defs"].includes(el.localName)) return;
    const style = { ...inherited },
      own: Record<string, string> = {};
    for (const name of [
      ...STYLES,
      "opacity",
      "clip-path",
      "mask",
      "display",
      "isolation",
      "mix-blend-mode",
      "xml:space",
    ])
      if (el.hasAttribute(name)) own[name] = el.getAttribute(name)!;
    if (el.hasAttribute("style"))
      for (const declaration of el.getAttribute("style")!.split(";")) {
        if (!declaration.trim()) continue;
        const m = declaration.match(/^\s*([\w-]+)\s*:\s*([^:]+)\s*$/);
        if (
          !m ||
          ![
            ...STYLES,
            "opacity",
            "clip-path",
            "mask",
            "display",
            "isolation",
            "mix-blend-mode",
            "xml:space",
          ].includes(m[1]!)
        )
          throw new Error("Unsupported SVG style declaration.");
        own[m[1]!] = m[2]!.trim();
      }
    for (const name of [...STYLES, "xml:space"])
      if (own[name] !== undefined) style[name] = own[name]!;
    if (own["isolation"] && !["auto", "isolate"].includes(own["isolation"]))
      throw Error("Unsupported SVG isolation mode.");
    if (
      own["mix-blend-mode"] &&
      !["normal", "multiply", "screen", "overlay", "darken", "lighten"].includes(
        own["mix-blend-mode"],
      )
    )
      throw Error("Unsupported SVG blend mode.");
    if (style["xml:space"] && !["default", "preserve"].includes(style["xml:space"]))
      throw Error("Unsupported SVG whitespace mode.");
    if (!stackItem && own["mix-blend-mode"] && own["mix-blend-mode"] !== "normal")
      throw Error(
        "SVG blend modes are supported inside Inkstrip isolated appearance stacks; external backdrop blending needs native/PNG.",
      );
    const matrix = compose(parent, svgMatrix(el.getAttribute("transform") ?? "")),
      opacity = numeric(own.opacity, 1);
    const groupNode = el.localName === "svg" || el.localName === "g";
    const alignment = el.getAttribute("data-inkstrip-stroke-align") ?? "center";
    const ownClips = [...clipping];
    for (const name of ["clip-path", "mask"])
      if (own[name] && own[name] !== "none" && !(stackItem && alignment !== "center")) {
        if (
          groupNode &&
          !stackItem &&
          [...el.querySelectorAll("path,rect,circle,ellipse,line,polygon,polyline,text")].filter(
            (e) => !e.closest("defs"),
          ).length > 1
        )
          throw Error(
            "Group clipping with overlapping artwork needs group-alpha clipping; import leaf clips or native/PNG instead.",
          );
        ownClips.push({
          id: localReference(own[name]!),
          mask: name === "mask",
          matrix,
          group: groupNode,
        });
      }
    if (el.localName === "g" && el.getAttribute("data-inkstrip-appearance") === "1") {
      const start = layers.length;
      for (const child of el.children) walk(child, matrix, style, parentId, ownClips, true);
      const pieces = layers.splice(start),
        base = pieces[0];
      if (
        !base ||
        pieces.some((l) => l.kind === "group" || l.kind !== base.kind || l.text !== base.text)
      )
        throw Error("Invalid stacked SVG appearance representation.");
      const all: AppearanceItem[] = [];
      for (const part of pieces) {
        const delta = compose(inverse(affine(base.transform)), affine(part.transform));
        const clipGeometry = (l: Layer, transform: Matrix) =>
          (l.vectorClips ?? []).map((c) => ({
            rule: c.rule,
            enabled: c.enabled,
            contours: c.contours.map((s) => ({
              closed: s.closed,
              anchors: s.anchors.map((a) => ({
                ...applyMatrix(compose(transform, c.matrix), a),
                incoming: applyMatrix(compose(transform, c.matrix), a.incoming ?? a),
                outgoing: applyMatrix(compose(transform, c.matrix), a.outgoing ?? a),
              })),
            })),
          }));
        const normalized = (v: unknown) =>
          JSON.stringify(v, (_, n: unknown) =>
            typeof n === "number" ? Math.round(n * 1e6) / 1e6 : n,
          );
        if (
          normalized(clipGeometry(part, delta)) !==
          normalized(clipGeometry(base, [1, 0, 0, 1, 0, 0]))
        )
          throw Error("Stacked paints with different clip geometry cannot be collapsed safely.");
        if (
          base.kind === "text" &&
          [
            "fontFamily",
            "fontSize",
            "fontWeight",
            "letterSpacing",
            "align",
            "lineHeight",
            "textPath",
          ].some((k) => normalized(part[k as keyof Layer]) !== normalized(base[k as keyof Layer]))
        )
          throw Error("Stacked text paints must share typography and baseline layout.");
        if (delta.slice(0, 4).some((n, i) => Math.abs(n - [1, 0, 0, 1][i]!) > 1e-7))
          throw Error("Stacked SVG paints must share the same geometry and transform.");
        const cs = contours(part).map((c) => ({
          ...c,
          anchors: c.anchors.map((a) => ({
            ...a,
            ...applyMatrix(delta, a),
            ...(a.incoming ? { incoming: applyMatrix(delta, a.incoming) } : {}),
            ...(a.outgoing ? { outgoing: applyMatrix(delta, a.outgoing) } : {}),
          })),
        }));
        if (cs.map(contourData).join(" ") !== contours(base).map(contourData).join(" ")) {
          // Float rebasing can perturb final decimal strings; compare coordinates instead.
          const a = cs.flatMap((c) =>
              c.anchors.flatMap((p) => [
                p.x,
                p.y,
                p.incoming?.x ?? p.x,
                p.incoming?.y ?? p.y,
                p.outgoing?.x ?? p.x,
                p.outgoing?.y ?? p.y,
              ]),
            ),
            b = contours(base).flatMap((c) =>
              c.anchors.flatMap((p) => [
                p.x,
                p.y,
                p.incoming?.x ?? p.x,
                p.incoming?.y ?? p.y,
                p.outgoing?.x ?? p.x,
                p.outgoing?.y ?? p.y,
              ]),
            );
          if (
            a.length !== b.length ||
            a.some((n, i) => Math.abs(n - b[i]!) > 1e-6) ||
            cs.some((c, i) => c.closed !== contours(base)[i]?.closed)
          )
            throw Error("Stacked SVG paint geometry differs; refusing to collapse it.");
        }
        for (const item of part.appearance ?? appearance(part)) {
          const copy = structuredClone(item);
          copy.opacity *= part.opacity;
          copy.visible = part.visible;
          if (copy.paint.gradient?.units === "userSpaceOnUse")
            copy.paint.gradient.matrix = compose(delta, copy.paint.gradient.matrix);
          all.push(copy);
        }
      }
      base.name = el.getAttribute("data-inkstrip-name")?.slice(0, 100) || "SVG appearance";
      base.opacity = opacity;
      base.visible = own.display !== "none";
      base.appearance = all;
      base.vectorOverflow = true;
      if (all.length > 16) throw Error("SVG appearance exceeds 16 paints.");
      push(base);
      return;
    }
    if (groupNode) {
      if (stackItem && (opacity !== 1 || own.display === "none"))
        throw Error("Stacked paint wrappers must have neutral opacity and display.");
      let groupId = parentId;
      if (!stackItem && (el.localName === "g" || opacity !== 1)) {
        const group = layer("group", Math.round(width), Math.round(height));
        group.name = el.getAttribute("id")?.slice(0, 100) || "SVG group";
        group.parentId = parentId;
        group.opacity = opacity;
        group.blend =
          !own["mix-blend-mode"] || own["mix-blend-mode"] === "normal"
            ? "source-over"
            : (own["mix-blend-mode"] as Layer["blend"]);
        group.visible = own.display !== "none";
        push(group);
        groupId = group.id;
      }
      for (const child of el.children) walk(child, matrix, style, groupId, ownClips, stackItem);
      return;
    }
    let l = layer(
      el.localName === "text" ? "text" : "shape",
      Math.round(width),
      Math.round(height),
    );
    l.parentId = parentId;
    l.name = el.getAttribute("id")?.slice(0, 100) || `SVG ${el.localName}`;
    const fill = color(
        (style.fill ?? "#000000").startsWith("url(") ? "#000000" : (style.fill ?? "#000000"),
      ),
      stroke = color(
        (style.stroke ?? "none").startsWith("url(") ? "#000000" : (style.stroke ?? "none"),
      );
    l.fill = fill.color;
    l.stroke = stroke.color;
    l.fillOpacity = fill.opacity * numeric(style["fill-opacity"], 1);
    l.strokeOpacity = stroke.opacity * numeric(style["stroke-opacity"], 1);
    l.strokeWidth = numeric(style["stroke-width"], 1);
    l.opacity = opacity;
    if (!stackItem && own["mix-blend-mode"] && own["mix-blend-mode"] !== "normal")
      l.blend = own["mix-blend-mode"] as Layer["blend"];
    l.visible =
      style.visibility !== "hidden" && style.visibility !== "collapse" && own.display !== "none";
    l.fillRule = (style["fill-rule"] ?? "nonzero") as Layer["fillRule"];
    l.lineCap = (style["stroke-linecap"] ?? "butt") as Layer["lineCap"];
    l.lineJoin = (style["stroke-linejoin"] ?? "miter") as Layer["lineJoin"];
    l.miterLimit = numeric(style["stroke-miterlimit"], 4);
    l.dashOffset = numeric(style["stroke-dashoffset"], 0);
    l.dash =
      !style["stroke-dasharray"] || style["stroke-dasharray"] === "none"
        ? []
        : style["stroke-dasharray"]
            .trim()
            .split(/[\s,]+/)
            .map((s) => numeric(s, 0));
    const n = (name: string, fallback = 0) => numeric(el.getAttribute(name), fallback);
    let transform = matrix;
    if (el.localName === "text") {
      const pathChild = [...el.children].find((c) => c.localName === "textPath"),
        spans = [...el.children].filter((c) => c.localName === "tspan");
      if (el.children.length && !pathChild && spans.length !== el.children.length)
        throw Error("Unsupported SVG text content.");
      if (pathChild && (el.children.length !== 1 || pathChild.children.length))
        throw Error("Text-on-path supports one unstyled text run.");
      if (
        spans.some(
          (c) => [...c.attributes].some((a) => !["x", "y"].includes(a.name)) || c.children.length,
        )
      )
        throw Error("Styled or nested SVG spans need a text shaper; use uniform text.");
      const run = (text: string) =>
        style["xml:space"] === "preserve" ? text : text.replace(/[\t\n\r ]+/g, " ").trim();
      l.text = spans.length
        ? spans.map((c) => run(c.textContent ?? "")).join("\n")
        : run((pathChild ?? el).textContent ?? "");
      const font = style["font-family"] ?? "Arial";
      l.fontFamily = (
        font === "sans-serif" ? "Arial" : font === "serif" ? "Georgia" : font
      ) as Layer["fontFamily"];
      l.fontSize = numeric(style["font-size"], 32);
      l.fontWeight =
        style["font-weight"] === "bold"
          ? 700
          : style["font-weight"] === "normal"
            ? 400
            : numeric(style["font-weight"], 400);
      l.letterSpacing = numeric(style["letter-spacing"], 0);
      if (style["text-anchor"] && !["start", "middle", "end"].includes(style["text-anchor"]))
        throw new Error("Unsupported SVG text anchor.");
      l.align =
        style["text-anchor"] === "middle"
          ? "center"
          : style["text-anchor"] === "end"
            ? "right"
            : "left";
      if (pathChild) {
        if (style["font-kerning"] !== "none" || style["font-variant-ligatures"] !== "none")
          throw Error("Unsupported SVG text-path shaping settings.");
        if (
          (pathChild.getAttribute("method") ?? "align") !== "align" ||
          (pathChild.getAttribute("spacing") ?? "exact") !== "exact" ||
          (pathChild.getAttribute("side") ?? "left") !== "left"
        )
          throw Error("Unsupported SVG text-path layout mode.");
        const href = pathChild.getAttribute("href") ?? pathChild.getAttribute("xlink:href"),
          def = href ? ids.get(href.slice(1)) : undefined;
        if (!def || def.localName !== "path")
          throw Error("Text path must reference a local path definition.");
        const baseline = nativePath({
            ...l,
            kind: "shape",
            shape: "path",
            pathData: def.getAttribute("d") ?? "",
          }),
          cs = contours(baseline);
        if (cs.length !== 1 || cs[0]!.anchors.length < 2)
          throw Error("Choose one non-empty contour for text-on-path.");
        const m = svgMatrix(def.getAttribute("transform") ?? "");
        l.anchors = cs[0]!.anchors.map((a) => ({
          ...a,
          ...applyMatrix(m, a),
          ...(a.incoming ? { incoming: applyMatrix(m, a.incoming) } : {}),
          ...(a.outgoing ? { outgoing: applyMatrix(m, a.outgoing) } : {}),
        }));
        l.closed = cs[0]!.closed;
        l.shape = "path";
        l.textPath = defaultTextPath();
        const length = measureTextPath(l).length,
          raw = pathChild.getAttribute("startOffset") ?? "0",
          offset = raw.endsWith("%")
            ? (numeric(raw.slice(0, -1), 0) * length) / 100
            : numeric(raw, 0);
        l.textPath.offset =
          offset - (l.align === "center" ? length / 2 : l.align === "right" ? length : 0);
        l.textPath.baseline = n("dy");
      } else {
        if (
          (!l.letterSpacing && ![undefined, "auto", "normal"].includes(style["font-kerning"])) ||
          (![undefined, "normal"].includes(style["font-variant-ligatures"]) && !l.letterSpacing)
        )
          throw Error(
            "Ordinary SVG text requires default font shaping; use native for explicit shaping controls.",
          );
        const x = spans.length ? numeric(spans[0]!.getAttribute("x"), n("x")) : n("x"),
          y = spans.length ? numeric(spans[0]!.getAttribute("y"), n("y")) : n("y");
        if (spans.length > 1) {
          const gap = numeric(spans[1]!.getAttribute("y"), 0) - y;
          l.lineHeight = gap / l.fontSize;
          if (
            spans.some(
              (c, i) =>
                Math.abs(numeric(c.getAttribute("x"), x) - x) > 1e-6 ||
                Math.abs(numeric(c.getAttribute("y"), y + i * gap) - y - i * gap) > 1e-6,
            )
          )
            throw Error("SVG spans require uniform line spacing/alignment.");
        }
        transform = compose(matrix, [
          1,
          0,
          0,
          1,
          x - (l.align === "center" ? l.width / 2 : l.align === "right" ? l.width : 0),
          y - l.fontSize,
        ]);
      }
      l.vectorOverflow = true;
    } else {
      const d = svgShapeData(el, numeric);
      if (!d) return;
      l.shape = "path";
      l.pathData = d;
      l = nativePath(
        l,
        Math.max(1e-6, 0.01 / Math.max(1, Math.hypot(matrix[0], matrix[1], matrix[2], matrix[3]))),
      );
      l.vectorOverflow = true;
      // Normalize the local source surface before retaining the affine matrix.
      // Negative coordinates/viewBox offsets must not be clipped before transformation.
      const cs = contours(l),
        points = cs.flatMap((c) =>
          c.anchors.flatMap((a) => [
            a,
            ...(a.incoming ? [a.incoming] : []),
            ...(a.outgoing ? [a.outgoing] : []),
          ]),
        );
      if (points.length) {
        const margin = Math.max(
            1,
            l.strokeWidth * (l.lineJoin === "miter" ? (l.miterLimit ?? 4) : 1),
          ),
          x = Math.floor(Math.min(...points.map((p) => p.x)) - margin),
          y = Math.floor(Math.min(...points.map((p) => p.y)) - margin);
        l.width = Math.max(1, Math.ceil(Math.max(...points.map((p) => p.x)) + margin) - x);
        l.height = Math.max(1, Math.ceil(Math.max(...points.map((p) => p.y)) + margin) - y);
        const shifted = cs.map((c) => ({
          ...c,
          anchors: c.anchors.map((a) => ({
            ...a,
            x: a.x - x,
            y: a.y - y,
            ...(a.incoming ? { incoming: { x: a.incoming.x - x, y: a.incoming.y - y } } : {}),
            ...(a.outgoing ? { outgoing: { x: a.outgoing.x - x, y: a.outgoing.y - y } } : {}),
          })),
        }));
        l.anchors = shifted[0]!.anchors;
        l.closed = shifted[0]!.closed;
        l.subpaths = shifted.slice(1);
        transform = compose(matrix, [1, 0, 0, 1, x, y]);
      }
    }
    l.transform = fromAffine(transform, l.transform);
    const local = compose(inverse(affine(l.transform)), matrix);
    if (
      own["mix-blend-mode"] &&
      !["normal", "multiply", "screen", "overlay", "darken", "lighten"].includes(
        own["mix-blend-mode"],
      )
    )
      throw Error("Unsupported SVG blend mode.");
    const fillPaint = (style.fill ?? "").startsWith("url(")
        ? svgGradient(style.fill!, ids, local, box?.[2] ?? width, box?.[3] ?? height, color)
        : { color: l.fill },
      strokePaint = (style.stroke ?? "").startsWith("url(")
        ? svgGradient(style.stroke!, ids, local, box?.[2] ?? width, box?.[3] ?? height, color)
        : { color: l.stroke };
    if (
      l.kind === "text" &&
      [fillPaint.gradient, strokePaint.gradient].some((g) => g?.units === "objectBoundingBox")
    )
      throw Error(
        "SVG text gradients need explicit userSpaceOnUse coordinates; glyph-bounds gradients require a text shaper.",
      );
    if (fillPaint.gradient || strokePaint.gradient || stackItem) {
      l.appearance = [
        { ...appearanceItem("fill", l), paint: fillPaint },
        { ...appearanceItem("stroke", l), paint: strokePaint },
      ];
      if (stackItem) {
        const kind = el.getAttribute("data-inkstrip-item");
        if (!["fill", "stroke"].includes(kind ?? ""))
          throw Error("Invalid SVG appearance item kind.");
        l.appearance = l.appearance.filter((a) => a.kind === kind);
        const a = l.appearance[0]!;
        a.blend =
          own["mix-blend-mode"] === "normal" || !own["mix-blend-mode"]
            ? "source-over"
            : (own["mix-blend-mode"] as Layer["blend"]);
        if (alignment !== "center") {
          const reference = own[alignment === "inside" ? "clip-path" : "mask"],
            def = reference ? ids.get(localReference(reference)) : undefined;
          const paths = def ? [...def.children].filter((c) => c.localName === "path") : [];
          const attributes = (
            node: Element,
            expected: Record<string, string>,
            optional: string[] = [],
          ) =>
            Object.entries(expected).every(([key, value]) => node.getAttribute(key) === value) &&
            [...node.attributes].every(
              (attr) => Object.hasOwn(expected, attr.name) || optional.includes(attr.name),
            );
          const path = paths[0];
          const valid =
            kind === "stroke" &&
            ["inside", "outside"].includes(alignment) &&
            def &&
            path &&
            !own[alignment === "inside" ? "mask" : "clip-path"] &&
            def.localName === (alignment === "inside" ? "clipPath" : "mask") &&
            paths.length === 1 &&
            path.getAttribute("d") === el.getAttribute("d") &&
            (alignment === "inside"
              ? def.children.length === 1 &&
                attributes(def, { clipPathUnits: "userSpaceOnUse" }, ["id"]) &&
                attributes(path, {
                  d: el.getAttribute("d")!,
                  "fill-rule": a.fillRule,
                  "clip-rule": a.fillRule,
                })
              : def.children.length === 2 &&
                def.children[0]!.localName === "rect" &&
                attributes(
                  def,
                  {
                    maskUnits: "userSpaceOnUse",
                    x: "-1000000",
                    y: "-1000000",
                    width: "2000000",
                    height: "2000000",
                    "mask-type": "luminance",
                  },
                  ["id"],
                ) &&
                attributes(def.children[0]!, {
                  x: "-1000000",
                  y: "-1000000",
                  width: "2000000",
                  height: "2000000",
                  fill: "#ffffff",
                }) &&
                attributes(path, {
                  d: el.getAttribute("d")!,
                  fill: "#000000",
                  "fill-rule": a.fillRule,
                }));
          if (!valid)
            throw Error("Stroke-alignment metadata does not match its SVG clipping geometry.");
          a.alignment = alignment as AppearanceItem["alignment"];
          a.width /= 2;
        }
      }
    }
    for (const c of ownClips) {
      const definition = ids.get(c.id);
      if (!definition || definition.localName !== (c.mask ? "mask" : "clipPath"))
        throw Error("Missing SVG clip/mask definition.");
      const children = [...definition.children];
      if (
        children.length !== 1 ||
        !["path", "rect", "circle", "ellipse", "polygon", "polyline"].includes(
          children[0]!.localName,
        )
      )
        throw Error(
          "Clip/mask import supports one compound geometry source per definition. Combine its shapes first.",
        );
      const shape = children[0]!;
      if (definition.hasAttribute("style") || shape.hasAttribute("style"))
        throw Error("Clip/mask style declarations are unsupported; use explicit attributes.");
      if (["opacity", "fill-opacity"].some((a) => numeric(shape.getAttribute(a), 1) !== 1))
        throw Error("Graded clip/mask opacity cannot be converted to a binary vector clip.");
      const units =
        definition.getAttribute(c.mask ? "maskContentUnits" : "clipPathUnits") ?? "userSpaceOnUse";
      if (
        !["userSpaceOnUse", "objectBoundingBox"].includes(units) ||
        ((c.group || l.kind === "text") && units === "objectBoundingBox")
      )
        throw Error("Object-bounds group clips/masks are unsupported.");
      if (
        c.mask &&
        (definition.getAttribute("mask-type") ?? "luminance") !== "alpha" &&
        !["white", "#fff", "#ffffff"].includes(shape.getAttribute("fill") ?? "#000000")
      )
        throw Error(
          "Only opaque binary alpha/white luminance SVG masks are currently editable as vector clips.",
        );
      if (
        c.mask &&
        ["opacity", "fill-opacity"].some((a) => numeric(shape.getAttribute(a), 1) !== 1)
      )
        throw Error("Graded SVG masks require native/PNG; no alpha information was discarded.");
      if (
        c.mask &&
        (color(shape.getAttribute("fill") ?? "#000000").opacity !== 1 ||
          color(shape.getAttribute("fill") ?? "#000000").color === "transparent")
      )
        throw Error("Transparent/graded SVG masks require a native raster mask.");
      if (shape.hasAttribute("stroke") && shape.getAttribute("stroke") !== "none")
        throw Error("SVG mask/clip strokes are unsupported.");
      const raw = nativePath({
        ...layer("shape", 1, 1),
        shape: "path",
        pathData: svgShapeData(shape, numeric),
      });
      const bbox = paintBounds(l),
        original = applyMatrix(inverse(local), bbox);
      const base =
        units === "objectBoundingBox"
          ? compose(local, [bbox.width, 0, 0, bbox.height, original.x, original.y])
          : compose(inverse(affine(l.transform)), c.matrix);
      const clip: VectorClip = {
        contours: contours(raw),
        rule: (shape.getAttribute("clip-rule") ??
          shape.getAttribute("fill-rule") ??
          definition.getAttribute("clip-rule") ??
          definition.getAttribute("fill-rule") ??
          "nonzero") as VectorClip["rule"],
        enabled: true,
        matrix: compose(
          base,
          compose(
            svgMatrix(definition.getAttribute("transform") ?? ""),
            svgMatrix(shape.getAttribute("transform") ?? ""),
          ),
        ),
      };
      l.vectorClips = [...(l.vectorClips ?? []), clip];
      if (c.mask) {
        const maskUnits = definition.getAttribute("maskUnits") ?? "objectBoundingBox";
        if (
          !["objectBoundingBox", "userSpaceOnUse"].includes(maskUnits) ||
          (c.group && maskUnits === "objectBoundingBox") ||
          (l.kind === "text" && maskUnits === "objectBoundingBox")
        )
          throw Error("Object-bounds group/text mask regions are unsupported.");
        const coordinate = (name: string, fallback: string, axis: "x" | "y", size = false) => {
          const raw = definition.getAttribute(name) ?? fallback,
            n = numeric(raw.replace(/%$/, ""), 0) / (raw.endsWith("%") ? 100 : 1);
          if (maskUnits === "objectBoundingBox")
            return n * (axis === "x" ? bbox.width : bbox.height) + (size ? 0 : original[axis]);
          return raw.endsWith("%")
            ? n * (axis === "x" ? (box?.[2] ?? width) : (box?.[3] ?? height))
            : n;
        };
        const x = coordinate("x", "-10%", "x"),
          y = coordinate("y", "-10%", "y"),
          w = coordinate("width", "120%", "x", true),
          h = coordinate("height", "120%", "y", true);
        if (w < 0 || h < 0) throw Error("Negative SVG mask region.");
        l.vectorClips.push({
          contours: [
            {
              closed: true,
              anchors:
                w && h
                  ? [
                      { x, y },
                      { x: x + w, y },
                      { x: x + w, y: y + h },
                      { x, y: y + h },
                    ]
                  : [],
            },
          ],
          rule: "nonzero",
          enabled: true,
          matrix: compose(inverse(affine(l.transform)), c.matrix),
        });
      }
    }
    push(l);
  };
  walk(root, viewport, {});
  if (!layers.some((l) => l.kind !== "group"))
    throw new Error("SVG contains no supported artwork.");
  validateDocument({
    ...fromPanel({ id: "svg", name: "SVG", width: Math.round(width), height: Math.round(height) }),
    layers,
  });
  return { width: Math.round(width), height: Math.round(height), layers };
}
