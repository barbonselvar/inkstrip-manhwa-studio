import type { Chapter, Panel, Project, Strip } from "@/lib/studio/types";

const DB_NAME = "inkstrip";
const DB_VERSION = 1;

export type StoreName = "projects" | "chapters" | "panels" | "blobs";

let dbPromise: Promise<IDBDatabase> | null = null;

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

export function openDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser cannot store projects."));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("chapters")) {
          const store = db.createObjectStore("chapters", { keyPath: "id" });
          store.createIndex("by_project", "projectId");
        }
        if (!db.objectStoreNames.contains("panels")) {
          const store = db.createObjectStore("panels", { keyPath: "id" });
          store.createIndex("by_chapter", "chapterId");
        }
        if (!db.objectStoreNames.contains("blobs")) {
          db.createObjectStore("blobs");
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      open.onerror = () => {
        dbPromise = null;
        reject(open.error ?? new Error("Could not open storage."));
      };
    });
  }
  return dbPromise;
}

export async function loadLibrary() {
  const db = await openDb();
  const tx = db.transaction(["projects", "chapters", "panels"], "readonly");
  const projects = await request<Project[]>(tx.objectStore("projects").getAll());
  const chapters = await request<Chapter[]>(tx.objectStore("chapters").getAll());
  const panels = await request<Panel[]>(tx.objectStore("panels").getAll());
  await transactionDone(tx);
  return { projects, chapters, panels };
}

export async function putRecords(input: {
  projects?: Project[];
  chapters?: Chapter[];
  panels?: Panel[];
}) {
  const names = (["projects", "chapters", "panels"] as const).filter(
    (name) => (input[name]?.length ?? 0) > 0,
  );
  if (names.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(names, "readwrite");
  for (const name of names) {
    const store = tx.objectStore(name);
    for (const record of input[name] ?? []) store.put(record);
  }
  await transactionDone(tx);
}

export async function putBlobs(entries: { id: string; blob: Blob }[]) {
  if (entries.length === 0) return;
  const db = await openDb();
  const tx = db.transaction("blobs", "readwrite");
  const store = tx.objectStore("blobs");
  for (const entry of entries) store.put(entry.blob, entry.id);
  await transactionDone(tx);
}

export async function getBlob(id: string) {
  const db = await openDb();
  const tx = db.transaction("blobs", "readonly");
  const blob = await request<Blob | undefined>(tx.objectStore("blobs").get(id));
  await transactionDone(tx);
  return blob;
}

export async function removeRecords(input: {
  projects?: string[];
  chapters?: string[];
  panels?: string[];
  blobs?: string[];
}) {
  const names = (["projects", "chapters", "panels", "blobs"] as const).filter(
    (name) => (input[name]?.length ?? 0) > 0,
  );
  if (names.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(names, "readwrite");
  for (const name of names) {
    const store = tx.objectStore(name);
    for (const id of input[name] ?? []) store.delete(id);
  }
  await transactionDone(tx);
}

export function storageMessage(error: unknown) {
  if (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  ) {
    return "This device is out of space for more photos. Remove a chapter or try fewer images.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong while saving.";
}

/** Commit a media revision and its blobs together; a failed write leaves the old panel intact. */
export async function commitPanelMedia(
  panel: Panel,
  expectedBlobId: string,
  blobs: { id: string; blob: Blob }[],
  obsolete: string[],
) {
  const db = await openDb();
  const tx = db.transaction(["panels", "blobs", "chapters", "projects"], "readwrite");
  const done = transactionDone(tx);
  try {
    const current = await request<Panel | undefined>(tx.objectStore("panels").get(panel.id));
    if (!current || current.blobId !== expectedBlobId)
      throw new Error("This panel changed. Reopen the editor to try again.");
    const chapter = await request<Chapter | undefined>(
      tx.objectStore("chapters").get(panel.chapterId),
    );
    if (!chapter) throw new Error("This chapter is no longer available.");
    const project = await request<Project | undefined>(
      tx.objectStore("projects").get(chapter.projectId),
    );
    const next: Panel = {
      ...current,
      blobId: panel.blobId,
      thumbId: panel.thumbId,
      width: panel.width,
      height: panel.height,
      mime: panel.mime,
      original: panel.original,
      edit: panel.edit,
      mediaUpdatedAt: panel.mediaUpdatedAt,
    };
    for (const reference of [next.original, next.edit?.source]) {
      if (reference && !(await request(tx.objectStore("blobs").get(reference.blobId))))
        throw new Error("A retained source image is missing. Current image unchanged.");
      if (reference && !(await request(tx.objectStore("blobs").get(reference.thumbId))))
        throw new Error("A retained thumbnail is missing. Current image unchanged.");
    }
    const updatedAt = next.mediaUpdatedAt ?? Date.now();
    const nextChapter = { ...chapter, updatedAt };
    const nextProject = project ? { ...project, updatedAt } : null;
    for (const { id, blob } of blobs) tx.objectStore("blobs").put(blob, id);
    tx.objectStore("panels").put(next);
    tx.objectStore("chapters").put(nextChapter);
    if (nextProject) tx.objectStore("projects").put(nextProject);
    const retained = new Set([
      next.blobId,
      next.thumbId,
      next.original?.blobId,
      next.original?.thumbId,
      next.edit?.source.blobId,
      next.edit?.source.thumbId,
    ]);
    for (const id of obsolete) if (!retained.has(id)) tx.objectStore("blobs").delete(id);
    await done;
    return { panel: next, chapter: nextChapter, project: nextProject };
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* The transaction may already have aborted. */
    }
    await done.catch(() => {});
    throw error;
  }
}

/** The old rendered page remains usable if quota, revision checks, or metadata writes fail. */
export async function commitChapterStrip(
  chapterId: string,
  expectedParts: string[],
  strip: Strip | null,
  blobs: { id: string; blob: Blob }[],
  expectedMedia: { id: string; blobId: string }[] = [],
) {
  const db = await openDb();
  const tx = db.transaction(["chapters", "projects", "blobs", "panels"], "readwrite");
  const done = transactionDone(tx);
  try {
    const chapter = await request<Chapter | undefined>(tx.objectStore("chapters").get(chapterId));
    if (
      !chapter ||
      JSON.stringify(chapter.strip?.parts.map((p) => p.blobId) ?? []) !==
        JSON.stringify(expectedParts)
    )
      throw new Error("The rendered chapter changed. Display again to retry.");
    for (const expected of expectedMedia) {
      const panel = await request<Panel | undefined>(tx.objectStore("panels").get(expected.id));
      if (!panel || panel.blobId !== expected.blobId)
        throw new Error(
          "An image changed while stitching. Display again to include the latest edits.",
        );
    }
    const project = await request<Project | undefined>(
      tx.objectStore("projects").get(chapter.projectId),
    );
    const updatedAt = Date.now();
    const nextChapter = { ...chapter, strip, updatedAt };
    const nextProject = project ? { ...project, updatedAt } : null;
    for (const { id, blob } of blobs) tx.objectStore("blobs").put(blob, id);
    tx.objectStore("chapters").put(nextChapter);
    if (nextProject) tx.objectStore("projects").put(nextProject);
    const keep = new Set(strip?.parts.map((part) => part.blobId) ?? []);
    for (const id of expectedParts) if (!keep.has(id)) tx.objectStore("blobs").delete(id);
    await done;
    return { chapter: nextChapter, project: nextProject };
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Transaction may already be complete. */
    }
    await done.catch(() => {});
    throw error;
  }
}
