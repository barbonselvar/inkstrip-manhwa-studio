import type { Chapter, Panel, Project } from "@/lib/studio/types";

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
      throw new Error("This panel changed. Reopen enhancement to try again.");
    const chapter = await request<Chapter | undefined>(
      tx.objectStore("chapters").get(panel.chapterId),
    );
    if (!chapter) throw new Error("This chapter is no longer available.");
    const project = await request<Project | undefined>(
      tx.objectStore("projects").get(chapter.projectId),
    );
    for (const { id, blob } of blobs) tx.objectStore("blobs").put(blob, id);
    tx.objectStore("panels").put(panel);
    tx.objectStore("chapters").put({ ...chapter, updatedAt: Date.now() });
    if (project) tx.objectStore("projects").put({ ...project, updatedAt: Date.now() });
    for (const id of obsolete) tx.objectStore("blobs").delete(id);
    await done;
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
