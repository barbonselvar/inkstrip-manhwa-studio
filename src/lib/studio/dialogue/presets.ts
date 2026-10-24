import { openDb } from "../db";
import { useStudio } from "../store";
import { validateDialogue, type DialoguePreset } from "./types";
import type { Project } from "../types";
/** Read-modify-write inside one transaction so sharing a preset cannot overwrite a newer title. */
export async function saveProjectPresets(
  projectId: string,
  update: (presets: DialoguePreset[]) => DialoguePreset[],
) {
  const db = await openDb();
  const project = await new Promise<Project>((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite"),
      store = tx.objectStore("projects"),
      r = store.get(projectId);
    let next: Project;
    r.onsuccess = () => {
      try {
        if (!r.result) throw Error("Project no longer exists.");
        const presets = update(r.result.dialoguePresets ?? []);
        validateDialogue({ version: 1, regions: [], presets });
        next = { ...r.result, dialoguePresets: presets, updatedAt: Date.now() };
        store.put(next);
      } catch (e) {
        tx.abort();
        reject(e);
      }
    };
    tx.oncomplete = () => resolve(next);
    tx.onerror = tx.onabort = () => reject(tx.error ?? Error("Preset library could not be saved."));
  });
  useStudio.setState((state) => ({
    projects: state.projects.map((p) => (p.id === projectId ? project : p)),
  }));
}
