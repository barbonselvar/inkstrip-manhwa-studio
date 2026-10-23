import { openDb } from "./db";
import { useStudio } from "./store";
import {
  backupFileName,
  decodeBackup,
  encodeBackup,
  projectBlobIds,
  type ProjectData,
} from "./backup";
import type { Chapter, Panel, Project } from "./types";

/** Project backup/restore and storage persistence, kept beside (not inside) the core store. */

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Storage request failed"));
  });
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Storage request failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Storage request aborted"));
  });
}

/** Ask the browser not to evict local projects under storage pressure. Never throws. */
export async function requestPersistentStorage() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Read one project with every image it references, from a single consistent snapshot. */
export async function readProjectData(projectId: string): Promise<ProjectData> {
  const db = await openDb();
  const tx = db.transaction(["projects", "chapters", "panels", "blobs"], "readonly");
  const done = transactionDone(tx);
  const project = await request<Project | undefined>(tx.objectStore("projects").get(projectId));
  if (!project) {
    await done;
    throw new Error("Project no longer exists.");
  }
  const chapters = await request<Chapter[]>(
    tx.objectStore("chapters").index("by_project").getAll(projectId),
  );
  const panels = (
    await Promise.all(
      chapters.map((chapter) =>
        request<Panel[]>(tx.objectStore("panels").index("by_chapter").getAll(chapter.id)),
      ),
    )
  ).flat();
  const blobs = new Map<string, Blob>();
  for (const id of projectBlobIds(chapters, panels)) {
    const blob = await request<Blob | undefined>(tx.objectStore("blobs").get(id));
    if (blob) blobs.set(id, blob);
  }
  await done;
  return { project, chapters, panels, blobs };
}

/** Restore a decoded backup atomically. Refuses to overwrite a project that already exists. */
export async function writeProjectData(data: ProjectData) {
  const db = await openDb();
  const tx = db.transaction(["projects", "chapters", "panels", "blobs"], "readwrite");
  const done = transactionDone(tx);
  try {
    if (await request(tx.objectStore("projects").getKey(data.project.id)))
      throw new Error("This project is already on this device. Delete it first to restore.");
    for (const chapter of data.chapters)
      if (await request(tx.objectStore("chapters").getKey(chapter.id)))
        throw new Error("Part of this backup is already on this device.");
    for (const [id, blob] of data.blobs) tx.objectStore("blobs").put(blob, id);
    tx.objectStore("projects").put(data.project);
    for (const chapter of data.chapters) tx.objectStore("chapters").put(chapter);
    for (const panel of data.panels) tx.objectStore("panels").put(panel);
    await done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already aborted */
    }
    await done.catch(() => {});
    throw error;
  }
}

/** Build a single-file backup of one project. */
export async function exportProject(projectId: string) {
  const data = await readProjectData(projectId);
  return { blob: encodeBackup(data), fileName: backupFileName(data.project.title) };
}

/** Restore a backup file and show it in the library. Returns the restored project id. */
export async function importProject(file: Blob) {
  const data = await decodeBackup(file);
  await writeProjectData(data);
  void requestPersistentStorage();
  useStudio.setState((state) => ({
    projects: [data.project, ...state.projects],
    chapters: [...state.chapters, ...data.chapters],
    panels: [...state.panels, ...data.panels],
  }));
  return data.project.id;
}
