/** Strict SVG geometry allowlist. SVG is decoded only after sanitization and is
 * stored as a bounded PNG, never as executable markup in a chapter. */
export function sanitizeSfxSvg(source: string): string {
  if (source.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(source))
    throw Error("SVG entities and documents over 2 MB are unsupported.");
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg")
    throw Error("Invalid SVG.");
  const tags = new Set([
    "svg",
    "g",
    "path",
    "polygon",
    "polyline",
    "rect",
    "circle",
    "ellipse",
    "line",
    "title",
    "desc",
  ]);
  const attrs = new Set([
    "viewBox",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "fill-rule",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "transform",
    "preserveAspectRatio",
  ]);
  const clean = parsed.documentElement;
  for (const node of [clean, ...Array.from(clean.querySelectorAll("*"))]) {
    if (!tags.has(node.localName)) {
      node.remove();
      continue;
    }
    for (const attr of Array.from(node.attributes)) {
      if (
        !attrs.has(attr.name) ||
        (["fill", "stroke"].includes(attr.name) &&
          !/^(none|currentColor|#[a-f0-9]{3,8}|[a-z]+|rgba?\([0-9 .,%]+\))$/i.test(attr.value)) ||
        /url\s*\(|javascript:|data:|https?:|[<>;]/i.test(attr.value)
      )
        node.removeAttribute(attr.name);
    }
  }
  if (!clean.querySelector("path,polygon,polyline,rect,circle,ellipse,line"))
    throw Error(
      "SVG needs vector paths or geometry. Convert text and linked artwork to paths before importing.",
    );
  clean.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const box = (clean.getAttribute("viewBox") ?? "").trim().split(/[ ,]+/).map(Number);
  const width = box.length === 4 ? box[2] : parseFloat(clean.getAttribute("width") ?? "0");
  const height = box.length === 4 ? box[3] : parseFloat(clean.getAttribute("height") ?? "0");
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 100000 ||
    height > 100000
  )
    throw Error("SVG needs a finite viewBox or width and height.");
  const scale = Math.min(1, 2048 / Math.max(width, height));
  clean.setAttribute("width", String(Math.max(1, Math.round(width * scale))));
  clean.setAttribute("height", String(Math.max(1, Math.round(height * scale))));
  return new XMLSerializer().serializeToString(clean);
}
/** Remove only a corner-connected matte. Interior white lettering stays intact. */
export function removeCornerMatte(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance: number,
) {
  const out = new Uint8ClampedArray(data),
    seen = new Uint8Array(w * h),
    queue = new Uint32Array(w * h);
  let head = 0,
    tail = 0;
  const corners = [0, w - 1, w * (h - 1), w * h - 1];
  const colors = corners
    .filter((i) => data[i * 4 + 3] > 240)
    .map((i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  const push = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    const p = i * 4;
    if (
      data[p + 3] === 0 ||
      colors.some(
        (c) =>
          Math.max(
            Math.abs(data[p] - c[0]),
            Math.abs(data[p + 1] - c[1]),
            Math.abs(data[p + 2] - c[2]),
          ) <= tolerance,
      )
    )
      queue[tail++] = i;
  };
  corners.forEach(push);
  while (head < tail) {
    const i = queue[head++];
    out[i * 4 + 3] = 0;
    const x = i % w,
      y = Math.floor(i / w);
    if (x) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return out;
}
