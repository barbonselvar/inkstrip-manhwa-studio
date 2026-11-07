/**
 * Desktop `.inkstrip` project files on top of the studio's workspace storage.
 *
 * The workspace (IndexedDB inside the app profile) stays the live, transactional working
 * copy that every editor already autosaves into. A `.inkstrip` file is the user's
 * portable, versioned document: the same validated container as the website's project
 * backup (`src/lib/studio/backup.ts`), so website backups open directly in the app.
 *
 * - Save streams the encoded project to the main process in bounded chunks; the main
 *   process verifies it on disk and atomically replaces the file (see apps/desktop).
 * - A content fingerprint of the workspace copy (records + native document revisions,
 *   no pixel reads) tells whether there are changes since the last file save.
 * - Opening never silently overwrites newer workspace work: conflicts are resolved by
 *   the caller, and any replaced workspace copy is first written to a recovery snapshot.
 */
import { decodeBackup, encodeBackup, type ProjectData } from "@/lib/studio/backup";
import { readProjectData, requestPersistentStorage, writeProjectData } from "@/lib/studio/backup-store";
import { openDb } from "@/lib/studio/db";
import { deleteNativeDrafts, nativeRevisions } from "@/lib/studio/pro/storage";
import { useStudio } from "@/lib/studio/store";
import type { Chapter, Panel, Project } from "@/lib/studio/types";
import { desktopBridge, flushEditors } from "./bridge";
import { FILE_ROUTE, type FileRef, type ProjectLink, type SaveResult, type WriteTarget } from "./contract";

const CHUNK = 8 * 1024 * 1024;

export type Progress = (stage: string, fraction: number) => void;

function bridge() {
  const b = desktopBridge();
  if (!b) throw new Error("Project files are available in the Inkstrip desktop app.");
  return b;
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Storage request failed"));
  });
}

/** Fingerprint of everything a save would write, or null if the project is gone. */
export async function fingerprintProject(projectId: string): Promise<string | null> {
  const db = await openDb();
  const tx = db.transaction(["projects", "chapters", "panels"], "readonly");
  const project = await request<Project | undefined>(tx.objectStore("projects").get(projectId));
  if (!project) return null;
  const chapters = await request<Chapter[]>(tx.objectStore("chapters").index("by_project").getAll(projectId));
  const panels = (
    await Promise.all(
      chapters.map((c) => request<Panel[]>(tx.objectStore("panels").index("by_chapter").getAll(c.id))),
    )
  ).flat();
  const native = await nativeRevisions(panels.map((p) => p.id).sort());
  return sha256(
    JSON.stringify([project, byId(chapters), byId(panels), Object.entries(native).sort(([a], [b]) => (a < b ? -1 : 1))]),
  );
}

/** A consistent snapshot plus the fingerprint it corresponds to (retries if editing races it). */
async function snapshot(projectId: string): Promise<{ data: ProjectData; fingerprint: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const before = await fingerprintProject(projectId);
      if (!before) throw new Error("This project is no longer in the workspace.");
      const data = await readProjectData(projectId);
      const after = await fingerprintProject(projectId);
      if (before === after) return { data, fingerprint: after! };
      lastError = new Error("The project changed while saving. Try again.");
    } catch (error) {
      lastError = error;
      if (!/changed during backup|changed while/i.test((error as Error).message ?? "")) throw error;
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  throw lastError;
}

async function stream(target: WriteTarget, blob: Blob, commit: { projectId: string; title: string; fingerprint: string }, link: boolean, progress?: Progress, signal?: AbortSignal): Promise<SaveResult> {
  const b = bridge();
  const session = await b.beginWrite(target, blob.size);
  try {
    for (let offset = 0; offset < blob.size; offset += CHUNK) {
      signal?.throwIfAborted();
      const chunk = new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + CHUNK)).arrayBuffer());
      await b.writeChunk(session, chunk);
      progress?.("Writing", Math.min(1, (offset + chunk.byteLength) / blob.size) * 0.9);
    }
    progress?.("Verifying", 0.95);
    return await b.commitWrite(session, commit, link);
  } catch (error) {
    await b.abortWrite(session).catch(() => {});
    throw error;
  }
}

export type SaveMode = "save" | "save-as" | "export";

export type SaveOutcome = { result: SaveResult; fingerprint: string; file: FileRef } | null;

/** Save the workspace project to its file (asking for one if needed). Null if cancelled. */
export async function saveProject(projectId: string, mode: SaveMode, progress?: Progress, signal?: AbortSignal): Promise<SaveOutcome> {
  const b = bridge();
  progress?.("Saving open editors", 0);
  await flushEditors();
  const project = useStudio.getState().projects.find((p) => p.id === projectId);
  if (!project) throw new Error("This project is no longer in the workspace.");
  let file: FileRef | null = null;
  if (mode === "save") file = (await b.getLink(projectId))?.file ?? null;
  if (file && file.size === 0 && file.modifiedAt === 0) file = null; // linked file was moved/deleted
  if (!file) file = mode === "export" ? await b.exportCopyDialog(project.title) : await b.saveProjectDialog(project.title);
  if (!file) return null;
  progress?.("Collecting artwork", 0.05);
  const { data, fingerprint } = await snapshot(projectId);
  const blob = encodeBackup(data);
  const result = await stream(
    { kind: "file", token: file.token },
    blob,
    { projectId, title: data.project.title, fingerprint },
    mode !== "export",
    progress,
    signal,
  );
  progress?.("Saved", 1);
  return { result, fingerprint, file };
}

/** Autosave / safety copy into %APPDATA%\Inkstrip Manhwa Studio\recovery. */
export async function writeRecoverySnapshot(projectId: string, known?: { data: ProjectData; fingerprint: string }) {
  const { data, fingerprint } = known ?? (await snapshot(projectId));
  await stream({ kind: "recovery", projectId }, encodeBackup(data), { projectId, title: data.project.title, fingerprint }, false);
  return fingerprint;
}

export async function readFileRef(ref: FileRef): Promise<ProjectData> {
  const response = await fetch(`${FILE_ROUTE}${encodeURIComponent(ref.token)}`);
  if (!response.ok) throw new Error("This file could not be read. It may have been moved or deleted.");
  return decodeBackup(await response.blob());
}

function publish(data: ProjectData) {
  const chapterIds = new Set(data.chapters.map((c) => c.id));
  useStudio.setState((state) => ({
    projects: [data.project, ...state.projects.filter((p) => p.id !== data.project.id)],
    chapters: [...state.chapters.filter((c) => c.projectId !== data.project.id), ...data.chapters],
    panels: [...state.panels.filter((p) => !chapterIds.has(p.chapterId)), ...data.panels],
  }));
}

/**
 * Replace the workspace copy of a project with `data`. A recovery snapshot of the old
 * copy is written first and, if the replacement fails, the old copy is put back.
 */
export async function replaceWorkspaceProject(data: ProjectData) {
  const id = data.project.id;
  await flushEditors();
  const old = await snapshot(id).catch(() => null);
  if (old) await writeRecoverySnapshot(id, old);
  await useStudio.getState().deleteProject(id);
  await deleteNativeDrafts(data.panels.map((p) => p.id));
  try {
    await writeProjectData(data);
  } catch (error) {
    if (old) {
      await deleteNativeDrafts(old.data.panels.map((p) => p.id)).catch(() => {});
      await writeProjectData(old.data)
        .then(() => publish(old.data))
        .catch((e) => console.error("Inkstrip could not roll back; the recovery snapshot has the old copy", e));
    }
    throw error;
  }
  publish(data);
}

export type OpenConflict = {
  title: string;
  /**
   * unsaved: the workspace copy has changes not saved to this file;
   * other-file: the workspace copy belongs to a different file;
   * unlinked: the workspace already has this project but it was never saved to a file.
   */
  reason: "unsaved" | "other-file" | "unlinked";
  linkedPath: string | null;
};
export type ConflictChoice = "keep" | "replace" | "cancel";

export type OpenOutcome = {
  projectId: string;
  link: ProjectLink | null;
  action: "imported" | "opened" | "reloaded" | "replaced" | "kept";
};

/** Open a `.inkstrip` file or import a website backup / recovery / backup copy. */
export async function openProjectFile(
  ref: FileRef,
  resolveConflict: (conflict: OpenConflict) => Promise<ConflictChoice>,
  progress?: Progress,
): Promise<OpenOutcome | null> {
  const b = bridge();
  await useStudio.getState().hydrate();
  progress?.("Reading project file", 0.1);
  const data = await readFileRef(ref);
  const id = data.project.id;
  const linkable = ref.kind === "project";
  const exists = useStudio.getState().projects.some((p) => p.id === id);
  let action: OpenOutcome["action"] = "imported";
  if (!exists) {
    progress?.("Checking and importing artwork", 0.4);
    await writeProjectData(data);
    publish(data);
    void requestPersistentStorage();
  } else {
    const link = await b.getLink(id);
    const local = await fingerprintProject(id);
    const sameFile = !!link && link.file.path.toLowerCase() === ref.path.toLowerCase();
    const clean = !!link && link.fingerprint === local;
    if (sameFile && clean) {
      // Unchanged workspace copy: reload only if the file was changed elsewhere.
      if (Math.abs(ref.modifiedAt - link!.fileModifiedAt) > 1) {
        progress?.("Loading the newer file", 0.4);
        await replaceWorkspaceProject(data);
        action = "reloaded";
      } else action = "opened";
    } else {
      const choice = await resolveConflict({
        title: data.project.title,
        reason: sameFile ? "unsaved" : link ? "other-file" : "unlinked",
        linkedPath: link?.file.path ?? null,
      });
      if (choice === "cancel") return null;
      if (choice === "keep") return { projectId: id, link, action: "kept" };
      progress?.("Replacing the workspace copy", 0.4);
      await replaceWorkspaceProject(data);
      action = "replaced";
    }
  }
  progress?.("Finishing", 0.95);
  let link: ProjectLink | null = null;
  if (linkable) {
    const fingerprint = await fingerprintProject(id);
    if (fingerprint) link = await b.linkOpened(id, ref.token, fingerprint, data.project.title);
  } else link = await b.getLink(id);
  return { projectId: id, link, action };
}

/** Discard workspace changes since the last save (a recovery snapshot is kept first). */
export async function revertToSaved(projectId: string) {
  const link = await bridge().getLink(projectId);
  if (!link || (link.file.size === 0 && link.file.modifiedAt === 0))
    throw new Error("This project has no saved file to revert to.");
  const data = await readFileRef(link.file);
  if (data.project.id !== projectId) throw new Error("The linked file now contains a different project.");
  await replaceWorkspaceProject(data);
  const fingerprint = await fingerprintProject(projectId);
  if (fingerprint) await bridge().linkOpened(projectId, link.file.token, fingerprint, data.project.title);
}
