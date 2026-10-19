import { layer, type Layer } from "./model";
/** Deliberately narrow SVG subset. Never insert imported markup into the DOM. */
export function importSvg(text: string): { width: number; height: number; layers: Layer[] } {
  if (text.length > 1_000_000 || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text))
    throw new Error("SVG declarations or oversized input are not supported.");
  const xml = new DOMParser().parseFromString(text, "image/svg+xml"),
    root = xml.documentElement;
  if (root.localName !== "svg" || xml.querySelector("parsererror"))
    throw new Error("Invalid SVG document.");
  const allowed = new Set([
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
  ]);
  const attrs = new Set([
    "xmlns",
    "version",
    "viewBox",
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
    "fill",
    "stroke",
    "stroke-width",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "font-family",
    "font-size",
    "font-weight",
    "text-anchor",
    "letter-spacing",
    "id",
  ]);
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (!allowed.has(el.localName))
      throw new Error(
        `Unsupported SVG element: ${el.localName}. Only basic vector objects are imported.`,
      );
    for (const a of el.attributes)
      if (
        !attrs.has(a.name) ||
        (/url\s*\(|javascript:|data:|https?:|\/\//i.test(a.value) && a.name !== "xmlns")
      )
        throw new Error(`Unsafe or unsupported SVG attribute: ${a.name}.`);
  }
  const num = (el: Element, name: string, fallback: number) => {
    const value = el.getAttribute(name);
    if (value === null) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n))
      throw new Error("SVG uses unsupported units or non-finite coordinates.");
    return n;
  };
  const box = (root.getAttribute("viewBox") ?? "")
      .trim()
      .split(/[\s,]+/)
      .map(Number),
    width = box.length === 4 ? box[2]! : num(root, "width", 800),
    height = box.length === 4 ? box[3]! : num(root, "height", 800);
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 16_000_000)
    throw new Error("SVG dimensions exceed Pro limits.");
  const layers: Layer[] = [];
  const walk = (el: Element, parent: DOMMatrix, style: Record<string, string>) => {
    const current = { ...style };
    for (const a of [
      "fill",
      "stroke",
      "stroke-width",
      "font-family",
      "font-size",
      "font-weight",
      "text-anchor",
      "letter-spacing",
    ])
      if (el.hasAttribute(a)) current[a] = el.getAttribute(a)!;
    if (el.hasAttribute("fill-opacity") || el.hasAttribute("stroke-opacity"))
      throw new Error("Independent SVG fill/stroke opacity is unsupported; use object opacity.");
    let matrix = parent;
    if (el.hasAttribute("transform")) {
      const transform = el.getAttribute("transform")!;
      let consumed = "",
        local = new DOMMatrix();
      for (const m of transform.matchAll(/(translate|scale|rotate)\s*\(([^)]*)\)/g)) {
        consumed += m[0];
        const a = m[2]!
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (!a.every(Number.isFinite)) throw new Error("Invalid SVG transform.");
        if (m[1] === "translate" && (a.length === 1 || a.length === 2))
          local = local.translate(a[0], a[1] ?? 0);
        else if (m[1] === "scale" && (a.length === 1 || a.length === 2))
          local = local.scale(a[0], a[1] ?? a[0]);
        else if (m[1] === "rotate" && (a.length === 1 || a.length === 3)) {
          if (a.length === 3) local = local.translate(a[1], a[2]);
          local = local.rotate(a[0]);
          if (a.length === 3) local = local.translate(-a[1]!, -a[2]!);
        } else throw new Error("Unsupported SVG transform.");
      }
      if (consumed.replace(/\s/g, "") !== transform.replace(/\s/g, ""))
        throw new Error("Unsupported SVG transform; use translate/scale/rotate.");
      matrix = parent.multiply(local);
    }
    const opacity = Number(style.__opacity ?? 1) * num(el, "opacity", 1);
    current.__opacity = String(opacity);
    if (["svg", "g"].includes(el.localName)) {
      if (num(el, "opacity", 1) !== 1)
        throw new Error(
          "SVG group opacity is unsupported; use a native document to preserve isolated compositing.",
        );
      for (const child of el.children) walk(child, matrix, current);
      return;
    }
    if (["title", "desc"].includes(el.localName)) return;
    const l = layer(el.localName === "text" ? "text" : "shape", width, height);
    l.name = `SVG ${el.localName}`;
    l.fill = current.fill ?? "#000000";
    l.stroke = current.stroke ?? "transparent";
    const color = (s: string) =>
      s === "none"
        ? "transparent"
        : s === "white"
          ? "#ffffff"
          : s === "black"
            ? "#000000"
            : /^#[0-9a-f]{3}$/i.test(s)
              ? "#" +
                s
                  .slice(1)
                  .split("")
                  .map((c) => c + c)
                  .join("")
              : s;
    l.fill = color(l.fill);
    l.stroke = color(l.stroke);
    l.strokeWidth = Number(current["stroke-width"] ?? 1);
    l.opacity = opacity;
    l.pathData = "";
    const n = (name: string, fallback = 0) => num(el, name, fallback);
    switch (el.localName) {
      case "rect": {
        const x = n("x"),
          y = n("y"),
          w = n("width"),
          h = n("height");
        if (n("rx") || n("ry")) throw new Error("Rounded SVG rectangles are not yet supported.");
        l.pathData = `M${x} ${y} h${w} v${h} h${-w} Z`;
        break;
      }
      case "circle":
      case "ellipse": {
        const x = n("cx"),
          y = n("cy"),
          rx = n("rx", n("r")),
          ry = n("ry", n("r"));
        l.pathData = `M${x - rx} ${y} a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
        break;
      }
      case "line":
        l.pathData = `M${n("x1")} ${n("y1")} L${n("x2")} ${n("y2")}`;
        break;
      case "path":
        l.pathData = el.getAttribute("d") ?? "";
        break;
      case "polygon":
      case "polyline": {
        const points = (el.getAttribute("points") ?? "")
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (points.length < 4 || points.length % 2 || !points.every(Number.isFinite))
          throw new Error("Invalid SVG points.");
        l.pathData =
          `M${points[0]} ${points[1]} ` +
          points.slice(2).reduce((s, v, i) => s + (i % 2 ? `${v} ` : `L${v} `), "") +
          (el.localName === "polygon" ? "Z" : "");
        break;
      }
      case "text":
        if (el.children.length)
          throw new Error("SVG text spans are unsupported; native Pro preserves multiline text.");
        l.text = el.textContent ?? "";
        l.fontFamily = (current["font-family"] ?? "Arial") as Layer["fontFamily"];
        l.fontSize = Number(current["font-size"] ?? 32);
        l.fontWeight = Number(current["font-weight"] ?? 400);
        l.letterSpacing = Number(current["letter-spacing"] ?? 0);
        l.align =
          current["text-anchor"] === "middle"
            ? "center"
            : current["text-anchor"] === "end"
              ? "right"
              : "left";
        matrix = matrix.translate(n("x"), n("y") - l.fontSize);
        break;
    }
    l.shape = "path";
    const sx = Math.hypot(matrix.a, matrix.b),
      sy = Math.hypot(matrix.c, matrix.d);
    if (
      sx < 0.01 ||
      sy < 0.01 ||
      matrix.a * matrix.d - matrix.b * matrix.c <= 0 ||
      Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) > 0.001 * sx * sy
    )
      throw new Error("Reflected/skewed SVG transforms are unsupported.");
    l.transform = {
      x: matrix.e,
      y: matrix.f,
      scaleX: sx,
      scaleY: sy,
      rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
    };
    layers.push(l);
  };
  const offset = new DOMMatrix().translate(
    box.length === 4 ? -box[0]! : 0,
    box.length === 4 ? -box[1]! : 0,
  );
  walk(root, offset, {});
  if (!layers.length || layers.length > 48)
    throw new Error("SVG must contain 1–48 supported objects.");
  return { width: Math.round(width), height: Math.round(height), layers };
}
