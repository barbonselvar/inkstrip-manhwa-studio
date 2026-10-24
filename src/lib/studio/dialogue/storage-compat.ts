/** Preserve a same-origin, unreleased F1 reader before upgrading Chapter storage.
 * Read-only cursor inspection: no assets are decoded, migrated or discarded.
 */
export async function hasLegacyAiDraft(): Promise<boolean> {
  if (typeof indexedDB.databases === "function") {
    const entries = await indexedDB.databases();
    if (
      (entries.find((d) => d.name === "inkstrip")?.version ?? 0) >= 2 ||
      !entries.some((d) => d.name === "inkstrip-pro")
    )
      return false;
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("inkstrip-pro");
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(Error("Close other native-editor tabs before checking storage compatibility."));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.close();
        resolve(false);
        return;
      }
      const tx = db.transaction("sessions"),
        cursor = tx.objectStore("sessions").openCursor();
      let ai = false;
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        const layers = item.value?.session?.document?.layers;
        if (Array.isArray(layers) && layers.some((l) => l && ("ai" in l || "aiReceipt" in l))) {
          ai = true;
          return;
        }
        item.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve(ai);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
