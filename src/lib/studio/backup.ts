import type { Chapter, Panel, Project } from "./types.ts";
import type { CharacterProfile } from "./characters/types.ts";
import { mediaIds } from "./editor/references.ts";

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
};

type BlobEntry = { id: string; type: string; size: number };
type StoredReference = { id: string; angle: string; blobRef: string };
type StoredCharacter = Omit<CharacterProfile, "references"> & { references: StoredReference[] };
type Header = {
  format: "inkstrip-backup";
  version: 1;
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
  const entries: BlobEntry[] = [];
  const parts: Blob[] = [];
  const add = (id: string, blob: Blob) => {
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
  const header: Header = {
    format: "inkstrip-backup",
    version: 1,
    exportedAt,
    project: { ...projectFields, ...(characters ? { characters } : {}) },
    chapters: data.chapters,
    panels: data.panels,
    blobs: entries,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, json.length);
  return new Blob([MAGIC, length, json, ...parts], { type: "application/octet-stream" });
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
  if (header.version !== 1) throw new Error("This backup was made by a newer Inkstrip version.");
  const { project, chapters, panels, blobs: entries } = header;
  if (!isString(project?.id) || !Array.isArray(chapters) || !Array.isArray(panels)) fail();
  if (!Array.isArray(entries)) fail();

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

  const characters = project.characters?.map((profile) => ({
    ...profile,
    references: profile.references.map(({ id, angle, blobRef }) => {
      const blob = blobs.get(blobRef);
      if (!blob) return fail();
      blobs.delete(blobRef);
      return { id, angle, blob };
    }),
  }));
  return {
    project: { ...project, ...(characters ? { characters } : {}) } as Project,
    chapters,
    panels,
    blobs,
  };
}
