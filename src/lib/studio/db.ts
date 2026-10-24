import { hasLegacyAiDraft } from "./dialogue/storage-compat";
import { mediaIds } from "./editor/references";
import { validateRecipe } from "./editor/geometry";
import { preflightImage, thumbnailPolicy } from "./image-policy";
import type { Chapter, Panel, Project, Strip } from "@/lib/studio/types";

const DB_NAME = "inkstrip";
const DB_VERSION = 2;

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
    dbPromise = hasLegacyAiDraft()
      .then(
        (protectedAi) =>
          new Promise<IDBDatabase>((resolve, reject) => {
            // An old F1 tab opens Chapter DB v1 explicitly. Do not strand its data
            // behind a newer version merely by visiting the homepage.
            const open = protectedAi
              ? indexedDB.open(DB_NAME)
              : indexedDB.open(DB_NAME, DB_VERSION);
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
              if (!db.objectStoreNames.contains("nativeRestores")) {
                db.createObjectStore("nativeRestores", { keyPath: "id" });
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
            open.onblocked = () => {
              dbPromise = null;
              reject(
                new Error(
                  "Close other Inkstrip tabs to upgrade project storage. Your existing data is unchanged.",
                ),
              );
            };
            open.onerror = () => {
              dbPromise = null;
              reject(open.error ?? new Error("Could not open storage."));
            };
          }),
      )
      .catch((error) => {
        dbPromise = null;
        throw error;
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
/** Keep raw getBlob for byte-exact download/recovery; validate only decode consumers. */
export async function getImageBlob(id: string, thumbnail = false) {
  const blob = await getBlob(id);
  if (!blob) return undefined;
  const info = await preflightImage(blob, thumbnail ? thumbnailPolicy() : undefined);
  return blob.type === info.mime ? blob : blob.slice(0, blob.size, info.mime);
}

/** Publish a staged import as one transaction. No orphan blobs on quota/cancel,
 * no append into a deleted chapter or over a concurrently reordered image list. */
export async function commitChapterImages(
  chapterId: string,
  expected: { id: string; blobId: string; order: number }[],
  panels: Panel[],
  blobs: { id: string; blob: Blob }[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const db = await openDb();
  signal?.throwIfAborted();
  const tx = db.transaction(["projects", "chapters", "panels", "blobs"], "readwrite"),
    done = transactionDone(tx);
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* already completed */
    }
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const chapter = await request<Chapter | undefined>(tx.objectStore("chapters").get(chapterId));
    const current = (
      await request<Panel[]>(tx.objectStore("panels").index("by_chapter").getAll(chapterId))
    ).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    const actual = current.map(({ id, blobId, order }) => ({ id, blobId, order }));
    if (!chapter || JSON.stringify(actual) !== JSON.stringify(expected))
      throw Error(
        "Chapter images changed while importing. Reload Inkstrip and retry; nothing was added.",
      );
    const project = await request<Project | undefined>(
      tx.objectStore("projects").get(chapter.projectId),
    );
    if (!project) throw Error("The destination project was deleted. Nothing was imported.");
    signal?.throwIfAborted();
    let order = current.reduce((n, p) => Math.max(n, p.order), -1) + 1;
    const added = panels.map((p) => {
      if (p.chapterId !== chapterId) throw Error("Import destination mismatch.");
      return { ...p, order: order++ };
    });
    for (const { id, blob } of blobs) tx.objectStore("blobs").add(blob, id);
    for (const panel of added) tx.objectStore("panels").add(panel);
    const updatedAt = Date.now(),
      nextChapter = { ...chapter, updatedAt },
      nextProject = { ...project, updatedAt };
    tx.objectStore("chapters").put(nextChapter);
    tx.objectStore("projects").put(nextProject);
    await done;
    return { panels: added, chapter: nextChapter, project: nextProject };
  } catch (error) {
    abort();
    await done.catch(() => {});
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function removeRecords(input: {
  projects?: string[];
  chapters?: string[];
  panels?: string[];
  blobs?: string[];
}) {
  const names: StoreName[] = ["projects", "chapters", "panels", "blobs"];
  if (!Object.values(input).some((ids) => ids?.length)) return;
  const db = await openDb(),
    tx = db.transaction(names, "readwrite"),
    done = transactionDone(tx);
  try {
    for (const name of ["projects", "chapters", "panels"] as const)
      for (const id of input[name] ?? []) tx.objectStore(name).delete(id);
    const protectedIds = await retainedBlobIds(tx);
    for (const id of input.blobs ?? [])
      if (!protectedIds.has(id)) tx.objectStore("blobs").delete(id);
    await done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* complete */
    }
    await done.catch(() => {});
    throw error;
  }
}

async function retainedBlobIds(tx: IDBTransaction) {
  const panels = await request<Panel[]>(tx.objectStore("panels").getAll()),
    chapters = await request<Chapter[]>(tx.objectStore("chapters").getAll());
  return new Set([
    ...panels.flatMap(mediaIds),
    ...chapters.flatMap((c) => c.strip?.parts.map((p) => p.blobId) ?? []),
  ]);
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
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const db = await openDb();
  signal?.throwIfAborted();
  const tx = db.transaction(["panels", "blobs", "chapters", "projects"], "readwrite");
  const done = transactionDone(tx);
  const cancel = () => {
    try {
      tx.abort();
    } catch {
      /* already committed */
    }
  };
  signal?.addEventListener("abort", cancel, { once: true });
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
      draft: undefined,
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
    signal?.throwIfAborted();
    for (const { id, blob } of blobs) tx.objectStore("blobs").put(blob, id);
    tx.objectStore("panels").put(next);
    tx.objectStore("chapters").put(nextChapter);
    if (nextProject) tx.objectStore("projects").put(nextProject);
    const retained = await retainedBlobIds(tx);
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
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
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
    if (expectedMedia.length) {
      const latest = (
        await request<Panel[]>(tx.objectStore("panels").index("by_chapter").getAll(chapterId))
      )
        .filter((p) => expectedMedia.some((e) => e.id === p.id))
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
      if (latest.map((p) => p.id).join("\0") !== expectedMedia.map((p) => p.id).join("\0"))
        throw new Error("Image order changed while stitching. Display again.");
    }
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
    const keep = await retainedBlobIds(tx);
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

/** Compare-and-update one project under a single read/write transaction, including character blobs. */
export async function updateProject(id: string, update: (project: Project) => Project) {
  const db = await openDb(),
    tx = db.transaction("projects", "readwrite"),
    done = transactionDone(tx);
  try {
    const current = await request<Project | undefined>(tx.objectStore("projects").get(id));
    if (!current) throw new Error("Project no longer exists.");
    const next = update(current);
    if (next.id !== id) throw new Error("Project identifier cannot change.");
    tx.objectStore("projects").put(next);
    await done;
    return next;
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

/** Reorder only the latest records' order fields; never replay stale media/recipes. */
export async function commitPanelOrder(
  chapterId: string,
  expected: string[],
  next: string[],
  undo = false,
) {
  const { sameOrder, validateOrder } = await import("./order");
  const db = await openDb(),
    tx = db.transaction(["panels", "chapters", "projects"], "readwrite"),
    done = transactionDone(tx);
  try {
    const chapter = await request<Chapter | undefined>(tx.objectStore("chapters").get(chapterId));
    if (!chapter) throw new Error("Chapter no longer exists.");
    const current = (
      await request<Panel[]>(tx.objectStore("panels").index("by_chapter").getAll(chapterId))
    ).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    if (
      !sameOrder(
        current.map((p) => p.id),
        expected,
      )
    )
      throw new Error("Order changed in another tab. Reload before reordering.");
    validateOrder(expected, next);
    const history = chapter.orderHistory ?? [];
    if (
      undo &&
      (!history.length ||
        !sameOrder(history.at(-1)!.after, expected) ||
        !sameOrder(history.at(-1)!.before, next))
    )
      throw new Error("This reorder can no longer be undone; images changed.");
    const positions = new Map(next.map((id, i) => [id, i])),
      panels = current.map((p) => ({ ...p, order: positions.get(p.id)! })),
      updatedAt = Date.now();
    const nextChapter = {
      ...chapter,
      updatedAt,
      orderHistory: undo
        ? history.slice(0, -1)
        : [...history, { before: expected, after: next }].slice(-20),
    };
    const project = await request<Project | undefined>(
        tx.objectStore("projects").get(chapter.projectId),
      ),
      nextProject = project ? { ...project, updatedAt } : null;
    for (const p of panels) tx.objectStore("panels").put(p);
    tx.objectStore("chapters").put(nextChapter);
    if (nextProject) tx.objectStore("projects").put(nextProject);
    await done;
    return { panels, chapter: nextChapter, project: nextProject };
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* complete */
    }
    await done.catch(() => {});
    throw error;
  }
}

/** Autosave metadata only, tied to the accepted media revision; never accepts an image. */
export async function saveEditorDraft(
  id: string,
  expectedBlobId: string,
  draft: Panel["draft"] | null,
) {
  const db = await openDb(),
    tx = db.transaction(["panels", "blobs"], "readwrite"),
    done = transactionDone(tx);
  try {
    const panel = await request<Panel | undefined>(tx.objectStore("panels").get(id));
    if (!panel || panel.blobId !== expectedBlobId)
      throw new Error("Image changed; draft was not saved. Reopen the editor.");
    if (draft) {
      if (draft.expectedBlobId !== expectedBlobId) throw new Error("Draft revision mismatch.");
      validateRecipe(draft.recipe, draft.source.width, draft.source.height);
      for (const key of [draft.source.blobId, draft.source.thumbId])
        if (!(await request(tx.objectStore("blobs").get(key))))
          throw new Error("Draft source is missing. Accepted image unchanged.");
    }
    const next = { ...panel, draft: draft ?? undefined };
    tx.objectStore("panels").put(next);
    await done;
    return next;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* complete */
    }
    await done.catch(() => {});
    throw error;
  }
}
