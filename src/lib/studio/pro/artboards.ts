import { validateDocument, type ProDocument } from "./model.ts";
import { translateLayers, selectedRoots, stacks } from "./layers.ts";
import { objectBounds } from "./precision.ts";
export type Frame = { x: number; y: number; width: number; height: number };
export type Artboard = Frame & { id: string; name: string; background: string };
export type Guide = { id: string; axis: "x" | "y"; position: number; locked: boolean };
export type Layout = {
  dpi: number;
  boundaries: boolean;
  grid: boolean;
  spacing: number;
  guidesVisible: boolean;
  guides: Guide[];
  snapping: boolean;
  tolerance: number;
  smart: boolean;
  modes: { grid: boolean; artboards: boolean; objects: boolean; anchors: boolean; guides: boolean };
};
export const DEFAULT_LAYOUT: Layout = {
  dpi: 96,
  boundaries: true,
  grid: false,
  spacing: 10,
  guidesVisible: true,
  guides: [],
  snapping: true,
  tolerance: 8,
  smart: true,
  modes: { grid: true, artboards: true, objects: true, anchors: true, guides: true },
};
export const layout = (d: ProDocument): Layout => d.layout ?? DEFAULT_LAYOUT;
export const artboards = (d: ProDocument): Artboard[] => d.artboards ?? [];
const finite = (n: unknown, a: number, b: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= a && n <= b;
export function validateLayout(d: ProDocument) {
  if (d.artboards !== undefined) {
    if (!Array.isArray(d.artboards) || d.artboards.length > 32)
      throw Error("Use at most 32 artboards.");
    const ids = new Set<string>();
    for (const b of d.artboards) {
      if (
        !b ||
        typeof b.id !== "string" ||
        !b.id ||
        ids.has(b.id) ||
        typeof b.name !== "string" ||
        !b.name.trim() ||
        b.name.length > 100 ||
        !finite(b.x, -100000, 100000) ||
        !finite(b.y, -100000, 100000) ||
        !Number.isInteger(b.width) ||
        !Number.isInteger(b.height) ||
        !finite(b.width, 1, 16384) ||
        !finite(b.height, 1, 16384) ||
        b.width * b.height > 16_777_216 ||
        typeof b.background !== "string" ||
        !/^(transparent|#[a-f\d]{6})$/i.test(b.background)
      )
        throw Error(
          "Invalid artboard: use finite coordinates and integer dimensions up to 16MP / 16384px.",
        );
      ids.add(b.id);
    }
  }
  if (d.layout === undefined) return;
  if (!d.layout || typeof d.layout !== "object" || Array.isArray(d.layout))
    throw Error("Invalid layout settings.");
  const s = d.layout;
  if (
    !finite(s.dpi, 36, 1200) ||
    !finite(s.spacing, 1, 10000) ||
    !finite(s.tolerance, 1, 32) ||
    [
      s.boundaries,
      s.grid,
      s.guidesVisible,
      s.snapping,
      s.smart,
      ...Object.values(s.modes ?? {}),
    ].some((v) => typeof v !== "boolean") ||
    !s.modes ||
    ["grid", "artboards", "objects", "anchors", "guides"].some(
      (k) => typeof s.modes[k as keyof Layout["modes"]] !== "boolean",
    ) ||
    !Array.isArray(s.guides) ||
    s.guides.length > 128
  )
    throw Error("Invalid grid, guide or snapping settings.");
  const ids = new Set<string>();
  for (const g of s.guides) {
    if (
      !g ||
      !g.id ||
      typeof g.id !== "string" ||
      ids.has(g.id) ||
      !["x", "y"].includes(g.axis) ||
      !finite(g.position, -100000, 100000) ||
      typeof g.locked !== "boolean"
    )
      throw Error("Invalid guide.");
    ids.add(g.id);
  }
}
export function changeArtboard(
  d: ProDocument,
  id: string,
  patch: Partial<Omit<Artboard, "id">>,
  moveArtwork = false,
): ProDocument {
  const b = artboards(d).find((b) => b.id === id);
  if (!b) throw Error("Select an existing artboard.");
  const next = { ...b, ...patch };
  let result = d;
  if (moveArtwork && (next.x !== b.x || next.y !== b.y)) {
    // Only complete root forests contained in the original board are eligible.
    // Linked membership and locks are enforced by the existing translation engine.
    const ids = selectedRoots(
      d,
      d.layers.map((l) => l.id),
    )
      .filter((l) => {
        const box = objectBounds(d, l.id);
        return (
          box &&
          box.x >= b.x &&
          box.y >= b.y &&
          box.x + box.width <= b.x + b.width &&
          box.y + box.height <= b.y + b.height
        );
      })
      .map((l) => l.id);
    const moving = new Set(ids);
    for (const stack of stacks(d.layers.filter((l) => !l.parentId))) {
      const members = [...(stack.base ? [stack.base] : []), ...stack.clips];
      if (members.some((l) => moving.has(l.id)) && members.some((l) => !moving.has(l.id)))
        throw Error(
          "The artboard contains only part of a clipping stack. Move its boundary alone or include the complete stack.",
        );
    }
    if (ids.length) result = translateLayers(d, ids, { x: next.x - b.x, y: next.y - b.y });
  }
  result = { ...result, artboards: artboards(d).map((b) => (b.id === id ? next : b)) };
  validateDocument(result);
  return result;
}
export function addArtboard(d: ProDocument, duplicate?: string) {
  const base = duplicate ? artboards(d).find((b) => b.id === duplicate) : undefined;
  if (duplicate && !base) throw Error("Select an artboard to duplicate.");
  const b: Artboard = {
    id: crypto.randomUUID(),
    name: base ? `${base.name.slice(0, 90)} copy` : `Artboard ${artboards(d).length + 1}`,
    x: base
      ? base.x + base.width + 32
      : artboards(d).length
        ? Math.max(...artboards(d).map((b) => b.x + b.width)) + 32
        : 0,
    y: base?.y ?? 0,
    width: base?.width ?? d.width,
    height: base?.height ?? d.height,
    background: base?.background ?? "transparent",
  };
  const result = {
    ...d,
    artboards: [...artboards(d), b],
    layout: d.layout ?? structuredClone(DEFAULT_LAYOUT),
  };
  validateDocument(result);
  return { document: result, id: b.id };
}
export function removeArtboard(d: ProDocument, id: string) {
  const result = { ...d, artboards: artboards(d).filter((b) => b.id !== id) };
  validateDocument(result);
  return result; // Artwork is deliberately never deleted.
}
export function reorderArtboard(d: ProDocument, id: string, direction: -1 | 1) {
  const boards = [...artboards(d)],
    i = boards.findIndex((b) => b.id === id),
    j = i + direction;
  if (i < 0 || j < 0 || j >= boards.length) return d;
  [boards[i], boards[j]] = [boards[j]!, boards[i]!];
  return { ...d, artboards: boards };
}
export const PRESETS = [
  "A4",
  "A3",
  "Letter",
  "1080 × 1080",
  "1920 × 1080",
  "1080 × 1920",
  "Webtoon 800 × 4000",
] as const;
export function presetSize(name: string, dpi: number) {
  if (!finite(dpi, 36, 1200)) throw Error("DPI must be 36–1200.");
  const physical: Record<string, number[]> = {
    A4: [210 / 25.4, 297 / 25.4],
    A3: [297 / 25.4, 420 / 25.4],
    Letter: [8.5, 11],
  };
  const pixels: Record<string, number[]> = {
    "1080 × 1080": [1080, 1080],
    "1920 × 1080": [1920, 1080],
    "1080 × 1920": [1080, 1920],
    "Webtoon 800 × 4000": [800, 4000],
  };
  const size = physical[name]?.map((v) => Math.round(v * dpi)) ?? pixels[name];
  if (!size) throw Error("Unknown artboard preset.");
  return { width: size[0]!, height: size[1]! };
}
export function unionFrames(frames: Frame[]): Frame {
  if (!frames.length) throw Error("No bounds to fit.");
  const x = Math.min(...frames.map((b) => b.x)),
    y = Math.min(...frames.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(0, Math.max(...frames.map((b) => b.x + b.width)) - x),
    height: Math.max(0, Math.max(...frames.map((b) => b.y + b.height)) - y),
  };
}
export function workspaceFrame(d: ProDocument): Frame {
  return unionFrames([{ x: 0, y: 0, width: d.width, height: d.height }, ...artboards(d)]);
}
export function artboardRange(d: ProDocument, range: string): Artboard[] {
  const boards = artboards(d),
    indices = new Set<number>();
  if (range.trim().toLowerCase() === "all") return boards;
  for (const part of range.split(",")) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match) throw Error("Use artboard numbers, ranges (1-3), or all.");
    const first = Number(match[1]),
      last = Number(match[2] ?? match[1]);
    if (first < 1 || last > boards.length || last < first)
      throw Error("Artboard range is out of bounds.");
    for (let i = first; i <= last; i++) indices.add(i - 1);
  }
  return boards.filter((_, i) => indices.has(i));
}
export function artboardFilename(b: Artboard, index: number, extension: string) {
  return `${String(index + 1).padStart(2, "0")}-${
    b.name
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "artboard"
  }.${extension}`;
}
