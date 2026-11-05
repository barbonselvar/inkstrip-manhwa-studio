import { openDb } from "../db";
import type { Chapter, Panel, Project } from "../types";
import {
  validateComposition,
  validateCompositionPreferences,
  type CompositionDocument,
  type CompositionRecord,
  type CompositionPreferences,
} from "./model";
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const complete = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? Error("Storage transaction aborted"));
  });

/** All composition/order writes compare the latest durable records, never stale artwork. */
export async function saveComposition(
  chapterId: string,
  document: CompositionDocument,
  revision: number,
  expectedOrder: string[],
  order: string[],
) {
  const record: CompositionRecord = { version: 1, revision: revision + 1, document };
  validateComposition(record);
  const db = await openDb(),
    tx = db.transaction(["chapters", "panels", "projects", "blobs"], "readwrite"),
    done = complete(tx);
  try {
    const chapter = await request<Chapter | undefined>(tx.objectStore("chapters").get(chapterId));
    if (!chapter)
      throw Error("This chapter was deleted. Export your recovery package before leaving.");
    const stored = chapter.composition as CompositionRecord | undefined;
    if (stored !== undefined) validateComposition(stored);
    if ((stored?.revision ?? 0) !== revision)
      throw Error(
        "Another tab changed this composition. Export recovery before reloading; nothing was overwritten.",
      );
    const panels = (
      await request<Panel[]>(tx.objectStore("panels").index("by_chapter").getAll(chapterId))
    ).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    const current = panels.map((p) => p.id);
    if (
      JSON.stringify(current) !== JSON.stringify(expectedOrder) ||
      order.length !== current.length ||
      new Set(order).size !== current.length ||
      order.some((id) => !current.includes(id))
    )
      throw Error(
        "Chapter images or order changed. Export recovery and reopen Composition; nothing was overwritten.",
      );
    for (const settings of Object.values(document.panels))
      if (
        settings.snapshot &&
        !(await request(tx.objectStore("blobs").getKey(settings.snapshot.blobId)))
      )
        throw Error("A saved draft snapshot is missing. Existing artwork is unchanged.");
    for (const object of document.objects)
      if (
        object.kind === "overlay" &&
        !(await request(tx.objectStore("blobs").getKey(object.blobId)))
      )
        throw Error("An overlay image is missing. Existing artwork is unchanged.");
    const positions = new Map(order.map((id, i) => [id, i]));
    const nextPanels = panels.map((p) => ({ ...p, order: positions.get(p.id)! }));
    if (JSON.stringify(order) !== JSON.stringify(expectedOrder))
      for (const p of nextPanels) tx.objectStore("panels").put(p);
    const updatedAt = Date.now(),
      nextChapter = { ...chapter, composition: record, updatedAt };
    const project = await request<Project | undefined>(
      tx.objectStore("projects").get(chapter.projectId),
    );
    const nextProject = project ? { ...project, updatedAt } : undefined;
    tx.objectStore("chapters").put(nextChapter);
    if (nextProject) tx.objectStore("projects").put(nextProject);
    await done;
    return { chapter: nextChapter, panels: nextPanels, project: nextProject, record };
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* completed */
    }
    await done.catch(() => {});
    throw error;
  }
}
export async function saveCompositionPreferences(projectId: string, value: CompositionPreferences) {
  validateCompositionPreferences(value);
  const { updateProject } = await import("../db");
  return updateProject(projectId, (p) => ({
    ...p,
    compositionPreferences: value,
    updatedAt: Date.now(),
  }));
}
