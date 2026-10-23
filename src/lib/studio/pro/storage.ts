import { validateAssets, type ProSession } from "./model";
/** Independent, self-contained blobs: old chapter garbage collection cannot remove Pro assets. */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // F1 AI layers change compositing and asset reachability. A cached pre-F1
    // version-1 client must fail closed rather than save a lossy older envelope.
    const r = indexedDB.open("inkstrip-pro", 2);
    let blocked = false;
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains("sessions"))
        r.result.createObjectStore("sessions", { keyPath: "id" });
    };
    r.onsuccess = () => {
      if (blocked) {
        r.result.close();
        return;
      }
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => {
      blocked = true;
      reject(new Error("Close another Pro Studio tab to open document storage."));
    };
  });
}
export async function loadSession(panelId: string): Promise<ProSession | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions"),
      r = tx.objectStore("sessions").get(panelId);
    let value: ProSession | undefined;
    r.onsuccess = () => {
      value = r.result?.session;
    };
    tx.oncomplete = () => {
      db.close();
      try {
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
      if ((r.result?.session.revision ?? 0) !== expectedRevision) {
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
      resolve(next);
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
