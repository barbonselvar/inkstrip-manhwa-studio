import { loadSession } from "./pro/storage";
import { validateNativeImages } from "./pro/native-images";
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
import { preflightRecoveryImages } from "./image-policy";
import { matchingDimensions } from "./image-decode";

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
  const sessions = [];
  for (const panel of panels) {
    const session = await loadSession(panel.id);
    if (session) sessions.push(session);
  }
  // Double-collect native revisions plus Chapter metadata to reject a changing
  // cross-database snapshot, including a newly created native session.
  const snapshots = new Map(sessions.map((s) => [s.document.panelId, s]));
  for (const panel of panels) {
    const latest = await loadSession(panel.id),
      previous = snapshots.get(panel.id);
    if (latest?.revision !== previous?.revision || latest?.document.id !== previous?.document.id)
      throw Error("An editor changed during backup. Save/close it and retry.");
  }
  const verify = db.transaction(["projects", "chapters", "panels"], "readonly"),
    verified = transactionDone(verify);
  const liveProject = await request(verify.objectStore("projects").get(projectId));
  const liveChapters = await request<Chapter[]>(
    verify.objectStore("chapters").index("by_project").getAll(projectId),
  );
  const livePanels = (
    await Promise.all(
      liveChapters.map((c) =>
        request<Panel[]>(verify.objectStore("panels").index("by_chapter").getAll(c.id)),
      ),
    )
  ).flat();
  await verified;
  if (
    JSON.stringify([project, chapters, panels]) !==
    JSON.stringify([liveProject, liveChapters, livePanels])
  )
    throw Error("Chapter data changed during backup. Close its editors and retry.");
  return { project, chapters, panels, blobs, sessions };
}

/** Restore a decoded backup atomically. Refuses to overwrite a project that already exists. */
export async function writeProjectData(data: ProjectData) {
  // Backup metadata is not a trust marker. Check every source/thumbnail/reference
  // and native asset before publishing any URL, session or Chapter record.
  const thumbnails = new Set(
    data.panels.flatMap((p) =>
      [p.thumbId, p.original?.thumbId, p.edit?.source.thumbId, p.draft?.source.thumbId].filter(
        (id): id is string => !!id,
      ),
    ),
  );
  const media = [...data.blobs].map(([id, blob]) => ({ blob, thumbnail: thumbnails.has(id) }));
  const references = (data.project.characters ?? []).flatMap((c) =>
    c.references.map((r) => ({ blob: r.blob })),
  );
  const entries = [
    ...media,
    ...references,
    ...(data.sessions ?? []).flatMap((s) =>
      Object.values(s.assets).map((blob) => ({ blob, decode: true })),
    ),
  ];
  let checked: Awaited<ReturnType<typeof preflightRecoveryImages>>;
  try {
    checked = await preflightRecoveryImages(entries);
  } catch (error) {
    throw Error(
      `Backup image rejected: ${(error as Error).message} Existing projects are unchanged.`,
    );
  }
  const canonicalBlobs = new Map(
    [...data.blobs].map(([id, blob], i) => [
      id,
      blob.type === checked[i]!.mime ? blob : blob.slice(0, blob.size, checked[i]!.mime),
    ]),
  );
  const dimensions = new Map([...data.blobs.keys()].map((id, i) => [id, checked[i]!]));
  // A tiny valid source must not smuggle huge document/canvas dimensions through
  // backup metadata. Original, edit and draft references use the same policy.
  for (const panel of data.panels) {
    for (const ref of [panel, panel.original, panel.edit?.source, panel.draft?.source]) {
      if (!ref) continue;
      const info = dimensions.get(ref.blobId);
      if (!info || !matchingDimensions(ref.width, ref.height, info))
        throw Error(
          "Backup image dimensions disagree with its source header. Existing projects are unchanged.",
        );
    }
  }
  for (const chapter of data.chapters)
    for (const part of chapter.strip?.parts ?? []) {
      const info = dimensions.get(part.blobId);
      if (!info || !matchingDimensions(chapter.strip!.width, part.height, info))
        throw Error(
          "Backup strip dimensions disagree with its image header. Existing projects are unchanged.",
        );
    }
  for (const panel of data.panels)
    if (await loadSession(panel.id))
      throw Error(
        "An existing native draft has the same page ID. Preserve it before restoring this backup.",
      );
  for (const session of data.sessions ?? []) await validateNativeImages(session, 16_777_216);
  const db = await openDb();
  const tx = db.transaction(
    ["projects", "chapters", "panels", "blobs", "nativeRestores"],
    "readwrite",
  );
  const done = transactionDone(tx);
  try {
    if (await request(tx.objectStore("projects").getKey(data.project.id)))
      throw new Error("This project is already on this device. Delete it first to restore.");
    for (const chapter of data.chapters)
      if (await request(tx.objectStore("chapters").getKey(chapter.id)))
        throw new Error("Part of this backup is already on this device.");
    for (const panel of data.panels)
      if (await request(tx.objectStore("panels").getKey(panel.id)))
        throw Error("A page in this backup already exists.");
    for (const [id, blob] of canonicalBlobs) {
      if (await request(tx.objectStore("blobs").getKey(id)))
        throw Error("A backup asset ID already exists; no artwork was overwritten.");
      tx.objectStore("blobs").add(blob, id);
    }
    for (const session of data.sessions ?? [])
      tx.objectStore("nativeRestores").add({
        id: session.document.panelId,
        session: { ...session, revision: 0, recoveryId: crypto.randomUUID() },
      });
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
