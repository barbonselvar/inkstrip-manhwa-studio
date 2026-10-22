import { appearanceSvg } from "./vector-svg.ts";
import type { Artboard } from "./artboards.ts";
import {
  MAX_ASSET_BYTES,
  sourceReference,
  validateAssets,
  validateDocument,
  type ProSession,
  type ProDocument,
  type Layer,
} from "./model.ts";
import { affine } from "./transform.ts";
import { outputMatrix, outputSize } from "./geometry.ts";
import { shapePath } from "./paths.ts";
function encode(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export async function nativeFile(s: ProSession): Promise<Blob> {
  validateAssets(s);
  // History stays in the session's immutable pool. Native files carry the current
  // document, not the undo timeline; exporting unused history assets makes repeated
  // import/export exponentially duplicate the same bytes under fresh immutable IDs.
  const referenced = new Set<string>();
  const original = sourceReference(s.document);
  if (original) referenced.add(original.assetId);
  for (const l of s.document.layers) {
    if (l.assetId) referenced.add(l.assetId);
    for (const stroke of [...l.strokes, ...(l.mask?.strokes ?? [])])
      if (stroke.clone) referenced.add(stroke.clone.assetId);
  }
  const assets = Object.fromEntries(
    await Promise.all(
      Object.entries(s.assets)
        .filter(([id]) => referenced.has(id))
        .map(async ([id, b]) => [
          id,
          { mime: b.type, data: encode(new Uint8Array(await b.arrayBuffer())) },
        ]),
    ),
  );
  // Older releases accept extra v1 fields and would silently omit holes/stroke styles.
  // Curve/style features use envelope v2; artboards/layout use v3. Old readers
  // reject newer envelopes safely; v4 adds appearance, path text and binary clips.
  // Internal v1 geometry and legacy files still work.
  const version = s.document.layers.some(
    (l) => l.appearance !== undefined || l.textPath !== undefined || l.vectorClips !== undefined,
  )
    ? 4
    : s.document.artboards !== undefined || s.document.layout !== undefined
      ? 3
      : s.document.layers.some(
            (l) =>
              l.subpaths?.length ||
              l.vectorOverflow ||
              l.fillRule === "evenodd" ||
              l.lineCap !== undefined ||
              l.lineJoin !== undefined ||
              l.miterLimit !== undefined ||
              l.dash !== undefined ||
              l.dashOffset !== undefined ||
              l.fillOpacity !== undefined ||
              l.strokeOpacity !== undefined,
          )
        ? 2
        : 1;
  return new Blob(
    [JSON.stringify({ format: "inkstrip-pro", version, document: s.document, assets })],
    { type: "application/json" },
  );
}
export async function readNative(
  blob: Blob,
  panelId: string,
  acceptedBlobId: string,
): Promise<ProSession> {
  if (blob.size > 70_000_000) throw new Error("Native document exceeds the 70MB import limit.");
  const value = JSON.parse(await blob.text());
  if (
    !value ||
    value.format !== "inkstrip-pro" ||
    ![1, 2, 3, 4].includes(value.version) ||
    !value.assets ||
    typeof value.assets !== "object" ||
    Array.isArray(value.assets)
  )
    throw new Error(
      "Unsupported native document. This editor supports Inkstrip Pro native versions 1, 2, 3 and 4.",
    );
  const assets: Record<string, Blob> = Object.create(null);
  let total = 0;
  for (const [id, entry] of Object.entries(value.assets)) {
    const a = entry as { mime: string; data: string };
    if (
      !a ||
      typeof a.data !== "string" ||
      a.data.length > MAX_ASSET_BYTES * 1.34 ||
      !["image/png", "image/jpeg", "image/webp"].includes(a.mime)
    )
      throw new Error("Invalid embedded raster asset.");
    total += a.data.length * 0.75;
    if (total > MAX_ASSET_BYTES) throw new Error("Embedded assets exceed 48MB.");
    const s = atob(a.data);
    assets[id] = new Blob([Uint8Array.from(s, (c) => c.charCodeAt(0))], { type: a.mime });
  }
  const session: ProSession = {
    document: { ...value.document, panelId },
    assets,
    revision: 0,
    acceptedBlobId,
    updatedAt: Date.now(),
  };
  validateAssets(session);
  return session;
}
export const escapeXml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
/** Explicit vector-only export. Reject unsupported vector effects instead of silently changing them. */
export function vectorSvg(d: ProDocument, board?: Artboard): string {
  validateDocument(d);
  const definitions: string[] = [];
  if (
    d.layers.some(
      (l) => l.kind === "gradient" || l.kind === "adjustment" || l.effects?.some((e) => e.enabled),
    )
  )
    throw new Error(
      "SVG export does not support gradient layers, adjustment layers or layer effects yet. Export native or PNG to preserve them.",
    );
  if (d.layers.some((l) => l.clipped))
    throw new Error(
      "SVG export does not support clipping stacks. Export PNG or a native document to preserve them.",
    );
  if (d.layers.some((l) => ["shape", "text"].includes(l.kind) && l.transform.deform))
    throw new Error(
      "SVG export cannot represent perspective or warp without flattening. Use PNG or native to preserve the document.",
    );
  const included = d.layers.filter(
    (l) => l.kind === "shape" || l.kind === "text" || l.kind === "group",
  );
  for (const l of included)
    if (
      l.mask ||
      (l.color && Object.keys(l.color).length > 0) ||
      l.blend !== "source-over" ||
      Object.values(l.adjustments).some((n) => n !== 0) ||
      l.hue ||
      l.black ||
      l.white !== 255 ||
      l.gamma !== 1 ||
      l.curve.some((n, i) => n !== [0, 64, 128, 192, 255][i])
    )
      throw new Error(
        "SVG export does not support masks, adjustments or non-normal blend modes. Export PNG or a native document to preserve them.",
      );
  const attrs = (l: Layer) =>
    `opacity="${l.opacity}" transform="matrix(${affine(l.transform).join(" ")})" fill="${l.fill}" stroke="${l.stroke}" stroke-width="${l.strokeWidth}" fill-rule="${l.fillRule ?? "nonzero"}" stroke-linecap="${l.lineCap ?? "butt"}" stroke-linejoin="${l.lineJoin ?? (l.kind === "text" ? "miter" : "round")}" stroke-miterlimit="${l.miterLimit ?? 10}" stroke-dasharray="${l.dash?.length ? l.dash.join(" ") : "none"}" stroke-dashoffset="${l.dashOffset ?? 0}" fill-opacity="${l.fillOpacity ?? 1}" stroke-opacity="${l.strokeOpacity ?? 1}"`;
  const branch = (parent?: string): string =>
    included
      .filter((l) => l.parentId === parent && l.visible)
      .map((l) =>
        l.kind === "group"
          ? `<g opacity="${l.opacity}">${branch(l.id)}</g>`
          : l.appearance !== undefined || l.textPath || l.vectorClips?.some((c) => c.enabled)
            ? appearanceSvg(l, definitions)
            : l.kind === "shape"
              ? `<path ${attrs(l)} d="${shapePath(l)}"/>`
              : `<text ${attrs(l)} font-family="${l.fontFamily}" font-size="${l.fontSize}" font-weight="${l.fontWeight}" letter-spacing="${l.letterSpacing}" text-anchor="${l.align === "left" ? "start" : l.align === "center" ? "middle" : "end"}">${l.text
                  .split("\n")
                  .map(
                    (line, i) =>
                      `<tspan x="${l.align === "left" ? 0 : l.align === "center" ? l.width / 2 : l.width}" y="${l.fontSize + i * l.fontSize * l.lineHeight}">${escapeXml(line)}</tspan>`,
                  )
                  .join("")}</text>`,
      )
      .join("");
  const content = branch(),
    paintDefinitions = definitions.length ? `<defs>${definitions.join("")}</defs>` : "";
  if (board) {
    const actual = d.artboards?.find((b) => b.id === board.id);
    if (!actual || JSON.stringify(actual) !== JSON.stringify(board))
      throw Error("Select an existing artboard to export.");
    const background =
      board.background === "transparent"
        ? ""
        : `<rect x="${board.x}" y="${board.y}" width="${board.width}" height="${board.height}" fill="${board.background}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${board.width}" height="${board.height}" viewBox="${board.x} ${board.y} ${board.width} ${board.height}" overflow="hidden">${paintDefinitions}${background}${content}</svg>`;
  }
  const size = outputSize(d);
  if (!d.crop)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${d.width} ${d.height}" preserveAspectRatio="none">${paintDefinitions}${content}</svg>`;
  // With no crop the SVG viewport already clips the original canvas (also after resize).
  // Keep explicit source clipping for rotated/outside crop bounds.
  const clip = d.crop
    ? `<defs><clipPath id="canvas"><rect width="${d.width}" height="${d.height}"/></clipPath></defs>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">${clip}${paintDefinitions}<g transform="matrix(${outputMatrix(d).join(" ")})"${d.crop ? ' clip-path="url(#canvas)"' : ""}>${content}</g></svg>`;
}

/** Import is one undoable metadata action; old raster bytes retain immutable IDs. */
export function mergeNativeSession(current: ProSession, incoming: ProSession): ProSession {
  validateAssets(incoming);
  const mapping = new Map(Object.keys(incoming.assets).map((id) => [id, crypto.randomUUID()]));
  const original = sourceReference(incoming.document),
    assets = { ...current.assets };
  for (const [id, blob] of Object.entries(incoming.assets)) assets[mapping.get(id)!] = blob;
  const document: ProDocument = {
    ...incoming.document,
    source: original ? { ...original, assetId: mapping.get(original.assetId)! } : undefined,
    layers: incoming.document.layers.map((l) => ({
      ...l,
      ...(l.assetId ? { assetId: mapping.get(l.assetId)! } : {}),
      strokes: l.strokes.map((stroke) =>
        stroke.clone
          ? { ...stroke, clone: { ...stroke.clone, assetId: mapping.get(stroke.clone.assetId)! } }
          : stroke,
      ),
      ...(l.mask
        ? {
            mask: {
              ...l.mask,
              strokes: l.mask.strokes.map((stroke) =>
                stroke.clone
                  ? {
                      ...stroke,
                      clone: { ...stroke.clone, assetId: mapping.get(stroke.clone.assetId)! },
                    }
                  : stroke,
              ),
            },
          }
        : {}),
    })),
  };
  const next = { ...current, document, assets };
  validateAssets(next);
  return next;
}
