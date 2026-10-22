import { svgMatrix } from "./svg-path.ts";
import { compose, type Matrix } from "./transform.ts";
import {
  validateVectorGradient,
  type VectorPaint,
  type VectorGradient,
} from "./vector-appearance.ts";
export function svgNumber(value: string | null | undefined, fallback: number) {
  if (value == null) return fallback;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(px|pt|pc|mm|cm|in|q)?\s*$/i.exec(
    value,
  );
  if (!m) throw Error("SVG uses unsupported units or invalid coordinates.");
  const factors: Record<string, number> = {
      px: 1,
      pt: 96 / 72,
      pc: 16,
      mm: 96 / 25.4,
      cm: 96 / 2.54,
      in: 96,
      q: 96 / 101.6,
    },
    n = Number(m[1]) * (factors[m[2]?.toLowerCase() ?? "px"] ?? 1);
  if (!Number.isFinite(n)) throw Error("Non-finite SVG coordinate.");
  return n;
}
export const localReference = (value: string) => {
  const match = /^url\(\s*(?:(["'])#([\w:.-]+)\1|#([\w:.-]+))\s*\)$/i.exec(value.trim());
  if (!match) throw Error("Only local SVG definition references are supported.");
  return (match[2] ?? match[3])!;
};
export function svgGradient(
  value: string,
  ids: Map<string, Element>,
  local: Matrix,
  width: number,
  height: number,
  parseColor: (s: string) => { color: string; opacity: number },
): VectorPaint {
  const chain: Element[] = [],
    seen = new Set<string>();
  let key: string | undefined = localReference(value);
  while (key) {
    if (seen.has(key) || chain.length >= 16)
      throw Error("Cyclic or excessive SVG gradient inheritance.");
    seen.add(key);
    const el = ids.get(key);
    if (!el || !["linearGradient", "radialGradient"].includes(el.localName))
      throw Error("Missing or unsupported SVG paint definition.");
    if (
      el.hasAttribute("style") ||
      el.hasAttribute("stop-color") ||
      el.hasAttribute("stop-opacity")
    )
      throw Error("Gradient-level styles are unsupported; use explicit stop properties.");
    chain.push(el);
    const href = el.getAttribute("href") ?? el.getAttribute("xlink:href");
    if (href && !/^#[\w:.-]+$/.test(href)) throw Error("External SVG gradients are unsafe.");
    key = href?.slice(1);
  }
  const attr = (name: string, fallback: string) =>
      chain.find((el) => el.hasAttribute(name))?.getAttribute(name) ?? fallback,
    kind = chain[0]!.localName === "linearGradient" ? "linear" : "radial",
    units = attr("gradientUnits", "objectBoundingBox") as VectorGradient["units"];
  if (
    !["objectBoundingBox", "userSpaceOnUse"].includes(units) ||
    attr("spreadMethod", "pad") !== "pad"
  )
    throw Error("Only pad-spread object-bounds/user-space gradients are supported.");
  const coord = (name: string, fallback: string, extent: number) => {
    const v = attr(name, fallback);
    return v.endsWith("%")
      ? (svgNumber(v.slice(0, -1), 0) / 100) * (units === "objectBoundingBox" ? 1 : extent)
      : svgNumber(v, 0);
  };
  const stopsEl = chain.find((el) => el.children.length),
    stops: VectorGradient["stops"] = [];
  if (!stopsEl) throw Error("SVG gradients require stops.");
  for (const el of stopsEl.children) {
    if (el.localName !== "stop") throw Error("Unsupported SVG gradient child.");
    const attrs: Record<string, string> = {};
    for (const k of ["offset", "stop-color", "stop-opacity"])
      if (el.hasAttribute(k)) attrs[k] = el.getAttribute(k)!;
    for (const part of (el.getAttribute("style") ?? "").split(";")) {
      if (!part.trim()) continue;
      const m = /^\s*(stop-color|stop-opacity)\s*:\s*([^:]+)\s*$/.exec(part);
      if (!m) throw Error("Unsupported SVG stop style.");
      attrs[m[1]!] = m[2]!.trim();
    }
    const raw = attrs.offset ?? "0",
      position = Math.max(
        stops.at(-1)?.position ?? 0,
        Math.min(
          1,
          Math.max(0, svgNumber(raw.replace(/%$/, ""), 0) / (raw.endsWith("%") ? 100 : 1)),
        ),
      ),
      color = parseColor(attrs["stop-color"] ?? "#000000");
    stops.push({
      position,
      color: color.color === "transparent" ? "#000000" : color.color,
      opacity:
        (color.color === "transparent" ? 0 : color.opacity) * svgNumber(attrs["stop-opacity"], 1),
    });
  }
  if (stops[0]!.position > 0) stops.unshift({ ...stops[0]!, position: 0 });
  if (stops.at(-1)!.position < 1) stops.push({ ...stops.at(-1)!, position: 1 });
  const center = { x: coord("cx", "50%", width), y: coord("cy", "50%", height) },
    focal = { x: coord("fx", attr("cx", "50%"), width), y: coord("fy", attr("cy", "50%"), height) };
  const g: VectorGradient = {
    kind,
    units,
    from: kind === "linear" ? { x: coord("x1", "0%", width), y: coord("y1", "0%", height) } : focal,
    to:
      kind === "linear" ? { x: coord("x2", "100%", width), y: coord("y2", "0%", height) } : center,
    radius: coord("r", "50%", Math.hypot(width, height) / Math.SQRT2),
    matrix:
      units === "objectBoundingBox"
        ? svgMatrix(attr("gradientTransform", ""))
        : compose(local, svgMatrix(attr("gradientTransform", ""))),
    stops,
  };
  validateVectorGradient(g);
  return { color: "#000000", gradient: g };
}
