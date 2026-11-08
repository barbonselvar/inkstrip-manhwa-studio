import { openDb } from "../db";
import { checkpointAfterConfirmedSave } from "./recovery-client";
import { validateAssets, type ProSession } from "./model";
/** Storage version5 fences schema3 drafts from older native readers.
 * Independent, self-contained blobs: old chapter garbage collection cannot remove Pro assets. */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let aiDraft = false;
    const r = indexedDB.open("inkstrip-pro", 5);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains("sessions"))
        r.result.createObjectStore("sessions", { keyPath: "id" });
      // A same-origin F1 draft must remain openable by its v2 reader until that
      // independent branch is integrated. Abort the upgrade before changing data.
      const cursor = r.transaction!.objectStore("sessions").openCursor();
      cursor.onsuccess = () => {
        const value = cursor.result;
        if (!value) return;
        const layers = value.value?.session?.document?.layers;
        if (Array.isArray(layers) && layers.some((l) => l && ("ai" in l || "aiReceipt" in l))) {
          aiDraft = true;
          r.transaction?.abort();
          return;
        }
        value.continue();
      };
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    r.onerror = () =>
      reject(
        aiDraft
          ? new Error(
              "This origin contains an unreleased F1 AI draft. Its storage was left unchanged; use a separate Dialogue preview until the AI branch is integrated.",
            )
          : r.error,
      );
    r.onblocked = () => reject(new Error("Close another Pro Studio tab to open document storage."));
  });
}
export async function loadSession(panelId: string): Promise<ProSession | undefined> {
  // Project restore commits this recovery journal atomically with Chapter records.
  // Once a normal Pro save succeeds it takes precedence; no cross-database partial import.
  const db = await open();
  const main = await openDb().catch((error) => {
    db.close();
    throw error;
  });
  const staged = await new Promise<ProSession | undefined>((resolve, reject) => {
    if (!main.objectStoreNames.contains("nativeRestores")) {
      resolve(undefined);
      return;
    }
    const tx = main.transaction("nativeRestores"),
      r = tx.objectStore("nativeRestores").get(panelId);
    tx.oncomplete = () => resolve(r.result?.session);
    tx.onerror = () => reject(tx.error);
  }).catch((error) => {
    db.close();
    throw error;
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions"),
      r = tx.objectStore("sessions").get(panelId);
    let value: ProSession | undefined,
      collision = false;
    r.onsuccess = () => {
      collision =
        !!staged && !!r.result?.session && r.result.session.recoveryId !== staged.recoveryId;
      value = r.result?.session ?? staged;
    };
    tx.oncomplete = () => {
      db.close();
      try {
        if (collision)
          throw Error(
            "A restored page conflicts with another native draft. Both copies were retained; export the existing draft before recovery.",
          );
        if (value) validateAssets(value);
        resolve(value);
      } catch (e) {
        reject(e);
      }
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
async function clearRecovery(panelId: string, recoveryId: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("nativeRestores", "readwrite"),
      store = tx.objectStore("nativeRestores"),
      r = store.get(panelId);
    r.onsuccess = () => {
      if (r.result?.session.recoveryId === recoveryId) store.delete(panelId);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
export async function saveSession(
  session: ProSession,
  expectedRevision: number,
): Promise<ProSession> {
  validateAssets(session);
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite"),
      store = tx.objectStore("sessions"),
      r = store.get(session.document.panelId);
    let conflict = false;
    let failure: unknown;
    const next = { ...session, revision: expectedRevision + 1, updatedAt: Date.now() };
    r.onsuccess = () => {
      if (
        (r.result?.session.revision ?? 0) !== expectedRevision ||
        (r.result?.session && r.result.session.recoveryId !== session.recoveryId)
      ) {
        conflict = true;
        tx.abort();
        return;
      }
      try {
        store.put({ id: session.document.panelId, session: next });
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      db.close();
      // Snapshot the acknowledged transaction, never a newer in-memory preview.
      // This independent worker/database cannot turn a durable primary save into
      // a failed save, or let an interrupted checkpoint replace that draft.
      checkpointAfterConfirmedSave(next);
      resolve(next);
      if (next.recoveryId)
        void clearRecovery(next.document.panelId, next.recoveryId).catch(() => {
          /* Matching primary save remains authoritative; retry cleanup on next save. */
        });
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        conflict
          ? new Error(
              "Another tab saved this Pro document. Export your document before reopening; no changes were overwritten.",
            )
          : (failure ??
              tx.error ??
              new Error(
                "Pro document could not be saved. Keep this workspace open and export a native backup.",
              )),
      );
    };
  });
}

/**
 * Remove the native (Raster/Pro) documents of deleted pages: the saved session and any
 * staged restore. Called when the user deletes a project or chapter, or replaces a
 * workspace project with its saved file. Without it a deleted project's pages kept their
 * native drafts, and restoring that project again failed ("An existing native draft has
 * the same page ID").
 */
export async function deleteNativeDrafts(panelIds: string[]) {
  if (!panelIds.length) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    for (const id of panelIds) tx.objectStore("sessions").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  }).finally(() => db.close());
  const main = await openDb();
  if (!main.objectStoreNames.contains("nativeRestores")) return;
  await new Promise<void>((resolve, reject) => {
    const tx = main.transaction("nativeRestores", "readwrite");
    for (const id of panelIds) tx.objectStore("nativeRestores").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** Revision markers of the native documents of these pages (saved or staged), read in
 * one transaction per database. Cheap: used for desktop unsaved-change detection. */
export async function nativeRevisions(panelIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!panelIds.length) return out;
  const main = await openDb();
  if (main.objectStoreNames.contains("nativeRestores"))
    await new Promise<void>((resolve, reject) => {
      const tx = main.transaction("nativeRestores");
      for (const id of panelIds) {
        const r = tx.objectStore("nativeRestores").get(id);
        r.onsuccess = () => {
          const s = r.result?.session as ProSession | undefined;
          if (s) out[id] = `staged:${s.recoveryId}:${s.revision}`;
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("sessions");
    for (const id of panelIds) {
      const r = tx.objectStore("sessions").get(id);
      r.onsuccess = () => {
        const s = r.result?.session as ProSession | undefined;
        if (s) out[id] = `${s.document.id}:${s.recoveryId}:${s.revision}`;
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
  return out;
}
