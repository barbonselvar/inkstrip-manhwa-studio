import { validateDialogue } from "./dialogue/types.ts";
import { validateAssets, type ProSession } from "./pro/model.ts";
import type { Chapter, Panel, Project } from "./types.ts";
import { validateCharacters, type CharacterProfile } from "./characters/types.ts";
import { mediaIds } from "./editor/references.ts";
import {
  RecordError,
  validateChapterRecord,
  validatePanelRecord,
  validateProjectRecord,
} from "./records.ts";

/**
 * Single-file project backup.
 *
 * Layout: MAGIC | uint32 BE header length | UTF-8 JSON header | blob bytes, in header order.
 * Blobs are sliced lazily on restore, so large chapters are never copied into one buffer.
 */
const MAGIC = new TextEncoder().encode("INKSTRIP-BACKUP\n");
const MAX_HEADER = 32 * 1024 * 1024;
export const BACKUP_EXTENSION = ".inkstrip-project";

export type ProjectData = {
  project: Project;
  chapters: Chapter[];
  panels: Panel[];
  blobs: Map<string, Blob>;
  sessions?: ProSession[];
};

type BlobEntry = { id: string; type: string; size: number };
type StoredReference = { id: string; angle: string; blobRef: string };
type StoredCharacter = Omit<CharacterProfile, "references"> & { references: StoredReference[] };
type Header = {
  format: "inkstrip-backup";
  version: 1 | 2;
  sessions?: (Omit<ProSession, "assets"> & { assets: Record<string, string> })[];
  exportedAt: number;
  project: Omit<Project, "characters"> & { characters?: StoredCharacter[] };
  chapters: Chapter[];
  panels: Panel[];
  blobs: BlobEntry[];
};

/** Every stored blob a project's chapters and panels point at (character images live on the project). */
export function projectBlobIds(chapters: Chapter[], panels: Panel[]) {
  return [
    ...new Set([
      ...panels.flatMap(mediaIds),
      ...chapters.flatMap((chapter) => chapter.strip?.parts.map((part) => part.blobId) ?? []),
    ]),
  ];
}

export function backupFileName(title: string, now = new Date()) {
  const safe =
    [...title.normalize("NFKC")]
      .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? " " : char))
      .join("")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "project";
  return `${safe}-${now.toISOString().slice(0, 10)}${BACKUP_EXTENSION}`;
}

export function encodeBackup(data: ProjectData, exportedAt = Date.now()): Blob {
  if (data.project.dialoguePresets)
    validateDialogue({ version: 1, regions: [], presets: data.project.dialoguePresets });
  const entries: BlobEntry[] = [];
  const parts: Blob[] = [];
  const seen = new Set<string>();
  const add = (id: string, blob: Blob) => {
    if (seen.has(id)) throw Error("Duplicate backup asset reference.");
    seen.add(id);
    entries.push({ id, type: blob.type, size: blob.size });
    parts.push(blob);
  };
  for (const id of projectBlobIds(data.chapters, data.panels)) {
    const blob = data.blobs.get(id);
    if (!blob) throw new Error("An image in this project is missing; backup not created.");
    add(id, blob);
  }
  const { characters: profiles, ...projectFields } = data.project;
  const characters = profiles?.map((profile): StoredCharacter => ({
    ...profile,
    references: profile.references.map((reference) => {
      const blobRef = `character:${profile.id}:${reference.id}`;
      add(blobRef, reference.blob);
      return { id: reference.id, angle: reference.angle, blobRef };
    }),
  }));
  const panelIds = new Set(data.panels.map((p) => p.id)),
    sessionIds = new Set<string>();
  const sessions = data.sessions?.map((session) => {
    validateAssets(session);
    const panelId = session.document.panelId;
    if (!panelIds.has(panelId) || sessionIds.has(panelId))
      throw Error("Invalid backup document association.");
    sessionIds.add(panelId);
    const assets = Object.fromEntries(
      Object.entries(session.assets).map(([id, blob], i) => {
        const ref = `native:${panelId}:${i}`;
        add(ref, blob);
        return [id, ref];
      }),
    );
    return { ...session, assets };
  });
  const header: Header = {
    format: "inkstrip-backup",
    version: sessions?.length || data.project.dialoguePresets ? 2 : 1,
    ...(sessions?.length ? { sessions } : {}),
    exportedAt,
    project: { ...projectFields, ...(characters ? { characters } : {}) },
    chapters: data.chapters,
    panels: data.panels,
    blobs: entries,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  if (json.length > MAX_HEADER)
    throw Error("Backup metadata exceeds32MB. Save individual native documents instead.");
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, json.length);
  return new Blob([MAGIC, length, json, ...parts], { type: "application/octet-stream" });
}

/** Character references are stored as blob references in the header; their profiles are
 * fully validated after the references resolve to images. */
function validateStoredCharacters(value: unknown) {
  if (!Array.isArray(value) || value.length > 32)
    throw new RecordError("Invalid character profiles.");
  for (const profile of value as StoredCharacter[])
    if (
      !profile ||
      typeof profile !== "object" ||
      !Array.isArray(profile.references) ||
      profile.references.length > 6 ||
      profile.references.some(
        (r) =>
          !r ||
          typeof r !== "object" ||
          !isString(r.id) ||
          typeof r.angle !== "string" ||
          !isString(r.blobRef) ||
          Object.keys(r).some((k) => !["id", "angle", "blobRef"].includes(k)),
      )
    )
      throw new RecordError("Invalid character profiles.");
}

const fail = (): never => {
  throw new Error("This file is not a valid Inkstrip backup.");
};
const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

export async function decodeBackup(file: Blob): Promise<ProjectData> {
  const prefixLength = MAGIC.length + 4;
  if (file.size < prefixLength) fail();
  const prefix = new Uint8Array(await file.slice(0, prefixLength).arrayBuffer());
  if (MAGIC.some((byte, index) => prefix[index] !== byte)) fail();
  const headerLength = new DataView(prefix.buffer).getUint32(MAGIC.length);
  if (headerLength > MAX_HEADER || prefixLength + headerLength > file.size) fail();

  let header: Header;
  try {
    header = JSON.parse(
      new TextDecoder().decode(
        await file.slice(prefixLength, prefixLength + headerLength).arrayBuffer(),
      ),
    ) as Header;
  } catch {
    return fail();
  }
  if (header?.format !== "inkstrip-backup") fail();
  if (![1, 2].includes(header.version))
    throw new Error("This backup was made by a newer Inkstrip version.");
  const { project, chapters, panels, blobs: entries } = header;
  if (!Array.isArray(chapters) || !Array.isArray(panels) || !Array.isArray(entries)) fail();
  // Every record is checked before anything is returned, so a malformed backup is
  // rejected as a whole and nothing reaches storage or the Library (INK-AUD-001).
  try {
    validateProjectRecord(project, { characters: false });
    if (project.characters !== undefined) validateStoredCharacters(project.characters);
    chapters.forEach(validateChapterRecord);
    panels.forEach(validatePanelRecord);
  } catch (error) {
    if (error instanceof RecordError)
      throw new Error(
        `This backup has invalid project metadata (${error.message.replace(/\.$/, "")}). Nothing was restored; existing projects are unchanged.`,
      );
    throw error;
  }

  const blobs = new Map<string, Blob>();
  let offset = prefixLength + headerLength;
  for (const entry of entries) {
    if (!isString(entry?.id) || !Number.isSafeInteger(entry.size) || entry.size < 0) fail();
    if (blobs.has(entry.id) || offset + entry.size > file.size) fail();
    blobs.set(entry.id, file.slice(offset, offset + entry.size, entry.type));
    offset += entry.size;
  }
  if (offset !== file.size) fail();

  const chapterIds = new Set<string>();
  for (const chapter of chapters) {
    if (!isString(chapter?.id) || chapter.projectId !== project.id || chapterIds.has(chapter.id))
      fail();
    chapterIds.add(chapter.id);
  }
  const panelIds = new Set<string>();
  for (const panel of panels) {
    if (!isString(panel?.id) || !chapterIds.has(panel.chapterId) || panelIds.has(panel.id)) fail();
    panelIds.add(panel.id);
  }
  for (const id of projectBlobIds(chapters, panels)) if (!blobs.has(id)) fail();

  if (
    header.sessions !== undefined &&
    (!Array.isArray(header.sessions) || header.sessions.length > panels.length)
  )
    fail();
  if (header.version === 1 && header.sessions?.length) fail();
  const nativeRefs = new Set<string>(),
    protectedRefs = new Set(projectBlobIds(chapters, panels));
  const sessionIds = new Set<string>();
  const sessions = header.sessions?.map((stored) => {
    if (
      !stored?.document ||
      !panelIds.has(stored.document.panelId) ||
      sessionIds.has(stored.document.panelId) ||
      !stored.assets ||
      typeof stored.assets !== "object"
    )
      fail();
    sessionIds.add(stored.document.panelId);
    const assets = Object.fromEntries(
      Object.entries(stored.assets).map(([id, ref]) => {
        if (typeof ref !== "string" || !ref.startsWith(`native:${stored.document.panelId}:`))
          return fail();
        if (nativeRefs.has(ref) || protectedRefs.has(ref)) return fail();
        nativeRefs.add(ref);
        const blob = blobs.get(ref);
        if (!blob) return fail();
        // Keep lazy Blob slices; a model's native validator checks references and budgets.
        return [id, blob];
      }),
    );
    const session = { ...stored, assets };
    validateAssets(session);
    return session;
  });
  for (const stored of header.sessions ?? [])
    for (const ref of Object.values(stored.assets)) blobs.delete(ref);
  const characters = project.characters?.map((profile) => ({
    ...profile,
    references: profile.references.map(({ id, angle, blobRef }) => {
      const blob = blobs.get(blobRef);
      if (!blob) return fail();
      blobs.delete(blobRef);
      return { id, angle, blob };
    }),
  }));
  if (characters) validateCharacters(characters);
  return {
    project: { ...project, ...(characters ? { characters } : {}) } as Project,
    chapters,
    panels,
    blobs,
    ...(sessions?.length ? { sessions } : {}),
  };
}
