import {
  MAX_ASSET_BYTES,
  sourceReference,
  validateAssets,
  type ProSession,
  type ProDocument,
  type Layer,
} from "./model.ts";
import { shapePath } from "./paths.ts";
function encode(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export async function nativeFile(s: ProSession): Promise<Blob> {
  validateAssets(s);
  const assets = Object.fromEntries(
    await Promise.all(
      Object.entries(s.assets).map(async ([id, b]) => [
        id,
        { mime: b.type, data: encode(new Uint8Array(await b.arrayBuffer())) },
      ]),
    ),
  );
  return new Blob(
    [JSON.stringify({ format: "inkstrip-pro", version: 1, document: s.document, assets })],
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
    value.version !== 1 ||
    !value.assets ||
    typeof value.assets !== "object" ||
    Array.isArray(value.assets)
  )
    throw new Error("Unsupported native document. Use an Inkstrip Pro version 1 file.");
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
export function vectorSvg(d: ProDocument): string {
  const included = d.layers.filter(
    (l) => l.kind === "shape" || l.kind === "text" || l.kind === "group",
  );
  for (const l of included)
    if (
      l.mask ||
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
    `opacity="${l.opacity}" transform="translate(${l.transform.x} ${l.transform.y}) rotate(${l.transform.rotation}) scale(${l.transform.scaleX} ${l.transform.scaleY})" fill="${l.fill}" stroke="${l.stroke}" stroke-width="${l.strokeWidth}"`;
  const branch = (parent?: string): string =>
    included
      .filter((l) => l.parentId === parent && l.visible)
      .map((l) =>
        l.kind === "group"
          ? `<g opacity="${l.opacity}">${branch(l.id)}</g>`
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}">${branch()}</svg>`;
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
