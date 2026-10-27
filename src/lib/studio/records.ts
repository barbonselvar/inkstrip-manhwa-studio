import { validateDialogue } from "./dialogue/types.ts";
import { validateRecipe } from "./editor/geometry.ts";
import { validatePresets } from "./workflow.ts";
import { validateCharacters } from "./characters/types.ts";
import type { Chapter, Panel, PanelMedia, Project, Strip } from "./types.ts";

/**
 * Strict, bounded schemas for Library metadata (INK-AUD-001).
 *
 * Project backups and IndexedDB are not trust markers: a record reaches the Library, the
 * Chapter workspace or the store only after its exact shape is checked here. Every field the
 * app has ever written is accepted (the record types have only grown), so valid historical
 * backups and stored projects keep working; anything else is rejected with a reason.
 */
export class RecordError extends Error {}

const MAX_ID = 128,
  MAX_TITLE = 200,
  MAX_NAME = 1024,
  MAX_SIDE = 65535,
  MAX_ORDER_HISTORY = 20,
  MAX_PANELS_PER_CHAPTER = 10_000;
export const CHAPTER_WIDTH = { min: 320, max: 4096 } as const;
export const CHAPTER_SEAM = { min: 0, max: 512 } as const;
const FORMATS = ["image/jpeg", "image/png"];

const fail = (what: string): never => {
  throw new RecordError(`Invalid ${what}.`);
};
const plain = (value: unknown, what: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(what);
  return value as Record<string, unknown>;
};
function keys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[],
  what: string,
) {
  for (const key of required) if (!(key in value)) fail(`${what} (missing ${key})`);
  for (const key of Object.keys(value))
    if (!required.includes(key) && !optional.includes(key)) fail(`${what} (unknown field ${key})`);
}
const id = (value: unknown, what: string) =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID ? value : fail(what);
const text = (value: unknown, max: number, what: string) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max ? value : fail(what);
const time = (value: unknown, what: string) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8.64e15
    ? value
    : fail(what);
const int = (value: unknown, min: number, max: number, what: string) =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max
    ? (value as number)
    : fail(what);
const mime = (value: unknown, what: string) =>
  typeof value === "string" && /^image\/[a-z0-9.+-]{1,60}$/.test(value) ? value : fail(what);
const ids = (value: unknown, max: number, what: string) => {
  if (!Array.isArray(value) || value.length > max) fail(what);
  const list = (value as unknown[]).map((v) => id(v, what));
  if (new Set(list).size !== list.length) fail(`${what} (duplicate)`);
  return list;
};
/** Run an existing domain validator and report its failure as a record error. */
function nested(check: () => void, what: string) {
  try {
    check();
  } catch (error) {
    throw new RecordError(`Invalid ${what}: ${(error as Error).message}`);
  }
}

/** `characters` holds Blob references in storage and is checked separately in backups. */
export function validateProjectRecord(value: unknown, { characters = true } = {}): Project {
  const p = plain(value, "project");
  keys(
    p,
    ["id", "title", "createdAt", "updatedAt"],
    ["presets", "dialoguePresets", "characters"],
    "project",
  );
  id(p.id, "project identifier");
  text(p.title, MAX_TITLE, "project title");
  time(p.createdAt, "project creation time");
  time(p.updatedAt, "project update time");
  if (p.presets !== undefined) {
    if (!Array.isArray(p.presets)) fail("project presets");
    nested(() => validatePresets(p.presets as Project["presets"] & object), "project presets");
  }
  if (p.dialoguePresets !== undefined) {
    if (!Array.isArray(p.dialoguePresets)) fail("dialogue presets");
    nested(
      () =>
        validateDialogue({
          version: 1,
          regions: [],
          presets: p.dialoguePresets as NonNullable<Project["dialoguePresets"]>,
        }),
      "dialogue presets",
    );
  }
  if (p.characters !== undefined) {
    if (!Array.isArray(p.characters)) fail("character profiles");
    if (characters)
      nested(
        () => validateCharacters(p.characters as NonNullable<Project["characters"]>),
        "character profiles",
      );
  }
  return p as Project;
}

function validateStrip(value: unknown): Strip {
  const s = plain(value, "chapter strip");
  keys(
    s,
    ["width", "totalHeight", "parts", "panelIds", "widthSetting", "seam", "format", "createdAt"],
    ["mediaRevisions"],
    "chapter strip",
  );
  int(s.width, 1, MAX_SIDE, "strip width");
  int(s.totalHeight, 1, Number.MAX_SAFE_INTEGER, "strip height");
  int(s.widthSetting, CHAPTER_WIDTH.min, CHAPTER_WIDTH.max, "strip width setting");
  int(s.seam, CHAPTER_SEAM.min, CHAPTER_SEAM.max, "strip seam");
  if (!FORMATS.includes(s.format as string)) fail("strip format");
  time(s.createdAt, "strip creation time");
  if (!Array.isArray(s.parts) || !s.parts.length || s.parts.length > 4096) fail("strip parts");
  for (const part of s.parts as unknown[]) {
    const p = plain(part, "strip part");
    keys(p, ["blobId", "height"], [], "strip part");
    id(p.blobId, "strip part image");
    int(p.height, 1, MAX_SIDE, "strip part height");
  }
  ids(s.panelIds, MAX_PANELS_PER_CHAPTER, "strip pages");
  if (s.mediaRevisions !== undefined) {
    const r = plain(s.mediaRevisions, "strip media revisions");
    if (Object.keys(r).length > MAX_PANELS_PER_CHAPTER) fail("strip media revisions");
    for (const [k, v] of Object.entries(r)) {
      id(k, "strip media revision");
      id(v, "strip media revision");
    }
  }
  return s as Strip;
}

export function validateChapterRecord(value: unknown): Chapter {
  const c = plain(value, "chapter");
  keys(
    c,
    ["id", "projectId", "title", "createdAt", "updatedAt", "width", "seam", "format", "strip"],
    ["orderHistory"],
    "chapter",
  );
  id(c.id, "chapter identifier");
  id(c.projectId, "chapter project");
  text(c.title, MAX_TITLE, "chapter title");
  time(c.createdAt, "chapter creation time");
  time(c.updatedAt, "chapter update time");
  int(c.width, CHAPTER_WIDTH.min, CHAPTER_WIDTH.max, "chapter width");
  int(c.seam, CHAPTER_SEAM.min, CHAPTER_SEAM.max, "chapter seam");
  if (!FORMATS.includes(c.format as string)) fail("chapter output format");
  if (c.strip !== null) validateStrip(c.strip);
  if (c.orderHistory !== undefined) {
    if (!Array.isArray(c.orderHistory) || c.orderHistory.length > MAX_ORDER_HISTORY)
      fail("chapter order history");
    for (const step of c.orderHistory as unknown[]) {
      const s = plain(step, "chapter order history");
      keys(s, ["before", "after"], [], "chapter order history");
      const before = ids(s.before, MAX_PANELS_PER_CHAPTER, "chapter order history"),
        after = ids(s.after, MAX_PANELS_PER_CHAPTER, "chapter order history");
      if (before.length !== after.length) fail("chapter order history");
    }
  }
  return c as Chapter;
}

function validateMedia(value: unknown, what: string): PanelMedia {
  const m = plain(value, what);
  keys(m, ["blobId", "thumbId", "mime", "width", "height"], [], what);
  id(m.blobId, `${what} image`);
  id(m.thumbId, `${what} thumbnail`);
  mime(m.mime, `${what} type`);
  int(m.width, 1, MAX_SIDE, `${what} width`);
  int(m.height, 1, MAX_SIDE, `${what} height`);
  return m as PanelMedia;
}

export function validatePanelRecord(value: unknown): Panel {
  const p = plain(value, "page");
  keys(
    p,
    [
      "id",
      "chapterId",
      "name",
      "mime",
      "width",
      "height",
      "blobId",
      "thumbId",
      "order",
      "createdAt",
    ],
    ["draft", "original", "edit", "mediaUpdatedAt"],
    "page",
  );
  id(p.id, "page identifier");
  id(p.chapterId, "page chapter");
  text(p.name, MAX_NAME, "page name");
  mime(p.mime, "page image type");
  int(p.width, 1, MAX_SIDE, "page width");
  int(p.height, 1, MAX_SIDE, "page height");
  id(p.blobId, "page image");
  id(p.thumbId, "page thumbnail");
  int(p.order, 0, Number.MAX_SAFE_INTEGER, "page order");
  time(p.createdAt, "page creation time");
  if (p.mediaUpdatedAt !== undefined) time(p.mediaUpdatedAt, "page media time");
  if (p.original !== undefined) validateMedia(p.original, "original image");
  if (p.edit !== undefined) {
    const e = plain(p.edit, "image edit");
    keys(e, ["version", "source", "recipe"], [], "image edit");
    if (e.version !== 1) fail("image edit version");
    const source = validateMedia(e.source, "edit source");
    nested(
      () => validateRecipe(e.recipe as never, source.width, source.height),
      "image edit recipe",
    );
  }
  if (p.draft !== undefined) {
    const d = plain(p.draft, "edit draft");
    keys(d, ["expectedBlobId", "source", "recipe", "updatedAt"], [], "edit draft");
    id(d.expectedBlobId, "edit draft image");
    time(d.updatedAt, "edit draft time");
    const source = validateMedia(d.source, "draft source");
    nested(
      () => validateRecipe(d.recipe as never, source.width, source.height),
      "edit draft recipe",
    );
  }
  return p as Panel;
}

/**
 * Split stored Library records into usable ones and quarantined ones. A record is set aside
 * (never deleted) when it is malformed or belongs to a set-aside parent, so one bad entry
 * cannot stop the Library or other projects from opening. Records whose parent is simply
 * absent are passed through unchanged, exactly as before.
 */
export function partitionLibrary(input: {
  projects: unknown[];
  chapters: unknown[];
  panels: unknown[];
}) {
  const quarantined: { store: "projects" | "chapters" | "panels"; key: string; reason: string }[] =
    [];
  const keyOf = (value: unknown) =>
    value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"
      ? ((value as { id: string }).id as string)
      : "(unknown)";
  const accept = <T>(
    store: (typeof quarantined)[number]["store"],
    value: unknown,
    check: () => T,
  ) => {
    try {
      return check();
    } catch (error) {
      quarantined.push({ store, key: keyOf(value), reason: (error as Error).message });
      return undefined;
    }
  };
  const projects = input.projects.flatMap(
    (p) => accept("projects", p, () => validateProjectRecord(p)) ?? [],
  );
  const setAside = new Set(quarantined.map((q) => q.key));
  const chapters = input.chapters.flatMap(
    (c) =>
      accept("chapters", c, () => {
        const chapter = validateChapterRecord(c);
        if (setAside.has(chapter.projectId))
          throw new RecordError("Chapter belongs to a set-aside project.");
        return chapter;
      }) ?? [],
  );
  for (const q of quarantined) setAside.add(q.key);
  const panels = input.panels.flatMap(
    (p) =>
      accept("panels", p, () => {
        const panel = validatePanelRecord(p);
        if (setAside.has(panel.chapterId))
          throw new RecordError("Page belongs to a set-aside chapter.");
        return panel;
      }) ?? [],
  );
  return { projects, chapters, panels, quarantined };
}
