import { contours, fromPanel, layer, validateDocument, type Layer } from "./model.ts";
import { nativePath } from "./compound.ts";
import { svgMatrix } from "./svg-path.ts";
import { compose, fromAffine, type Matrix } from "./transform.ts";
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
      ...STYLES,
    ]);
  if (root.localName !== "svg" || xml.querySelector("parsererror"))
    throw new Error("Invalid SVG document.");
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (
      !allowed.has(el.localName) ||
      (el.namespaceURI && el.namespaceURI !== "http://www.w3.org/2000/svg")
    )
      throw new Error(`Unsupported SVG element: ${el.localName}.`);
    if (el !== root && el.localName === "svg")
      throw new Error("Nested SVG viewports are unsupported.");
    for (const a of el.attributes)
      if (
        !attrs.has(a.name) ||
        (a.name !== "xmlns" && /url\s*\(|javascript:|data:|https?:|\/\//i.test(a.value))
      )
        throw new Error(`Unsafe or unsupported SVG attribute: ${a.name}.`);
  }
  const numeric = (value: string | null | undefined, fallback: number) => {
    if (value == null) return fallback;
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$/.test(value.trim()))
      throw new Error("SVG uses unsupported units or invalid coordinates.");
    const n = Number(value.trim().replace(/px$/, ""));
    if (!Number.isFinite(n)) throw new Error("Non-finite SVG coordinate.");
    return n;
  };
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
  ) => {
    if (["title", "desc"].includes(el.localName)) return;
    const style = { ...inherited },
      own: Record<string, string> = {};
    for (const name of [...STYLES, "opacity"])
      if (el.hasAttribute(name)) own[name] = el.getAttribute(name)!;
    if (el.hasAttribute("style"))
      for (const declaration of el.getAttribute("style")!.split(";")) {
        if (!declaration.trim()) continue;
        const m = declaration.match(/^\s*([\w-]+)\s*:\s*([^:]+)\s*$/);
        if (!m || ![...STYLES, "opacity"].includes(m[1]!))
          throw new Error("Unsupported SVG style declaration.");
        own[m[1]!] = m[2]!.trim();
      }
    for (const name of STYLES) if (own[name] !== undefined) style[name] = own[name]!;
    const matrix = compose(parent, svgMatrix(el.getAttribute("transform") ?? "")),
      opacity = numeric(own.opacity, 1);
    if (el.localName === "svg" || el.localName === "g") {
      let groupId = parentId;
      if (el.localName === "g" || opacity !== 1) {
        const group = layer("group", Math.round(width), Math.round(height));
        group.name = el.getAttribute("id")?.slice(0, 100) || "SVG group";
        group.parentId = parentId;
        group.opacity = opacity;
        push(group);
        groupId = group.id;
      }
      for (const child of el.children) walk(child, matrix, style, groupId);
      return;
    }
    let l = layer(
      el.localName === "text" ? "text" : "shape",
      Math.round(width),
      Math.round(height),
    );
    l.parentId = parentId;
    l.name = el.getAttribute("id")?.slice(0, 100) || `SVG ${el.localName}`;
    const fill = color(style.fill ?? "#000000"),
      stroke = color(style.stroke ?? "none");
    l.fill = fill.color;
    l.stroke = stroke.color;
    l.fillOpacity = fill.opacity * numeric(style["fill-opacity"], 1);
    l.strokeOpacity = stroke.opacity * numeric(style["stroke-opacity"], 1);
    l.strokeWidth = numeric(style["stroke-width"], 1);
    l.opacity = opacity;
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
      if (el.children.length)
        throw new Error("SVG text spans are unsupported; use native Pro for multiline text.");
      l.text = el.textContent ?? "";
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
      transform = compose(matrix, [
        1,
        0,
        0,
        1,
        n("x") - (l.align === "center" ? l.width / 2 : l.align === "right" ? l.width : 0),
        n("y") - l.fontSize,
      ]);
    } else {
      let d = "";
      if (el.localName === "path") d = el.getAttribute("d") ?? "";
      else if (el.localName === "rect") {
        const x = n("x"),
          y = n("y"),
          w = n("width"),
          h = n("height"),
          rx = Math.min(w / 2, n("rx", n("ry"))),
          ry = Math.min(h / 2, n("ry", n("rx")));
        if (w < 0 || h < 0 || rx < 0 || ry < 0)
          throw new Error("Negative SVG rectangle dimensions.");
        if (!w || !h) return;
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
        if (!rx || !ry) return;
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
