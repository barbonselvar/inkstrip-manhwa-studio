import { canonicalNative, validateNativeTree } from "./adjustment-schema.ts";
import { nativeFile, readNative } from "./files.ts";
import { validateAssets, type ProSession } from "./model.ts";

export const CHECKPOINT_DB = "inkstrip-pro-recovery";
export const CHECKPOINT_MAX_FILE = 70_000_000;
export const CHECKPOINT_MAX_TOTAL = 144_000_000;
export const CHECKPOINTS_PER_PAGE = 3;
export type CheckpointHeader = {
  version: 1;
  id: string;
  panelId: string;
  documentId: string;
  name: string;
  revision: number;
  acceptedBlobId: string;
  recoveryId?: string;
  savedAt: number;
  createdAt: number;
  nativeBytes: number;
  nativeSha256: string;
  integritySha256: string;
};
export type Checkpoint = { header: CheckpointHeader; native: Blob };
const fields =
  "version id panelId documentId name revision acceptedBlobId recoveryId savedAt createdAt nativeBytes nativeSha256 integritySha256".split(
    " ",
  );
const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
const time = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 8.64e15;
export function validateCheckpointHeader(v: unknown): asserts v is CheckpointHeader {
  validateNativeTree(v);
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Invalid recovery checkpoint metadata.");
  const h = v as CheckpointHeader;
  if (
    Object.keys(h).some((k) => !fields.includes(k)) ||
    fields.filter((k) => k !== "recoveryId").some((k) => !Object.hasOwn(h, k)) ||
    h.version !== 1 ||
    !text(h.id, 128) ||
    !text(h.panelId, 128) ||
    !text(h.documentId, 1024) ||
    typeof h.name !== "string" ||
    h.name.length > 200 ||
    !Number.isSafeInteger(h.revision) ||
    h.revision < 1 ||
    !text(h.acceptedBlobId, 128) ||
    (h.recoveryId !== undefined &&
      (typeof h.recoveryId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(h.recoveryId))) ||
    !time(h.savedAt) ||
    !time(h.createdAt) ||
    !Number.isSafeInteger(h.nativeBytes) ||
    h.nativeBytes < 1 ||
    h.nativeBytes > CHECKPOINT_MAX_FILE ||
    ![h.nativeSha256, h.integritySha256].every(
      (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s),
    )
  )
    throw Error(
      "Unsupported or corrupted recovery checkpoint metadata. Saved artwork was not changed.",
    );
}
async function sha256(blob: Blob) {
  if (blob.size > CHECKPOINT_MAX_FILE)
    throw Error("Recovery checkpoint exceeds its 70MB safety limit.");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
async function headerHash(h: Omit<CheckpointHeader, "integritySha256"> | CheckpointHeader) {
  const value = { ...h } as Partial<CheckpointHeader>;
  delete value.integritySha256;
  return sha256(new Blob([canonicalNative(value)]));
}
/** Called exclusively with the snapshot acknowledged by the primary transaction. */
export async function createCheckpoint(
  session: ProSession,
  id: string = crypto.randomUUID(),
  now = Date.now(),
): Promise<Checkpoint> {
  validateAssets(session);
  // Reject unsafe identity/revision metadata before serializing embedded assets.
  validateCheckpointHeader({
    version: 1,
    id,
    panelId: session.document.panelId,
    documentId: session.document.id,
    name: session.document.name,
    revision: session.revision,
    acceptedBlobId: session.acceptedBlobId,
    ...(session.recoveryId ? { recoveryId: session.recoveryId } : {}),
    savedAt: session.updatedAt,
    createdAt: now,
    nativeBytes: 1,
    nativeSha256: "0".repeat(64),
    integritySha256: "0".repeat(64),
  });
  const native = await nativeFile(session);
  const value: Omit<CheckpointHeader, "integritySha256"> = {
    version: 1,
    id,
    panelId: session.document.panelId,
    documentId: session.document.id,
    name: session.document.name,
    revision: session.revision,
    acceptedBlobId: session.acceptedBlobId,
    ...(session.recoveryId ? { recoveryId: session.recoveryId } : {}),
    savedAt: session.updatedAt,
    createdAt: now,
    nativeBytes: native.size,
    nativeSha256: await sha256(native),
  };
  const header = { ...value, integritySha256: await headerHash(value) };
  validateCheckpointHeader(header);
  return { header, native };
}
export async function verifyCheckpoint(value: Checkpoint): Promise<ProSession> {
  validateCheckpointHeader(value?.header);
  const h = value.header;
  if (
    !(value.native instanceof Blob) ||
    value.native.type !== "application/json" ||
    value.native.size !== h.nativeBytes ||
    (await headerHash(h)) !== h.integritySha256 ||
    (await sha256(value.native)) !== h.nativeSha256
  )
    throw Error(
      "Recovery checkpoint integrity verification failed. Existing artwork is unchanged.",
    );
  const decoded = await readNative(value.native, h.panelId, h.acceptedBlobId);
  if (decoded.document.id !== h.documentId || decoded.document.name !== h.name)
    throw Error("Recovery checkpoint document identity does not match its metadata.");
  const session: ProSession = {
    ...decoded,
    revision: h.revision,
    updatedAt: h.savedAt,
    ...(h.recoveryId ? { recoveryId: h.recoveryId } : {}),
  };
  validateAssets(session);
  return session;
}
/** Deterministic bounded retention. Only checkpoint versions are pruned; the
 * primary document and its immutable asset pool are never cleaned here. */
export function retainedCheckpoints(headers: CheckpointHeader[], preferred: string) {
  if (headers.length > 257) throw Error("Recovery index exceeds its safety limit.");
  for (const h of headers) validateCheckpointHeader(h);
  if (new Set(headers.map((h) => h.id)).size !== headers.length)
    throw Error("Duplicate recovery checkpoint identity.");
  // Select page versions by primary revision, not by when a delayed worker
  // happened to finish. Keep the newly written snapshot and the newest peers.
  const pages = new Map<string, CheckpointHeader[]>();
  for (const h of headers) pages.set(h.panelId, [...(pages.get(h.panelId) ?? []), h]);
  const candidates = [...pages.values()].flatMap((page) =>
    page
      .sort(
        (a, b) =>
          Number(b.id === preferred) - Number(a.id === preferred) ||
          b.revision - a.revision ||
          b.savedAt - a.savedAt ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .slice(0, CHECKPOINTS_PER_PAGE),
  );
  const sorted = candidates.sort(
    (a, b) =>
      Number(b.id === preferred) - Number(a.id === preferred) ||
      b.savedAt - a.savedAt ||
      b.revision - a.revision ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const counts = new Map<string, number>();
  const keep: CheckpointHeader[] = [];
  let bytes = 0;
  for (const h of sorted) {
    const count = counts.get(h.panelId) ?? 0;
    if (
      count >= CHECKPOINTS_PER_PAGE ||
      keep.length >= 64 ||
      bytes + h.nativeBytes > CHECKPOINT_MAX_TOTAL
    )
      continue;
    keep.push(h);
    counts.set(h.panelId, count + 1);
    bytes += h.nativeBytes;
  }
  return keep;
}
function openRecovery(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const r = indexedDB.open(CHECKPOINT_DB, 1);
    r.onupgradeneeded = () => {
      const headers = r.result.createObjectStore("headers", { keyPath: "id" });
      headers.createIndex("by_panel", "panelId");
      r.result.createObjectStore("snapshots", { keyPath: "id" });
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    r.onerror = () => {
      settled = true;
      reject(r.error ?? Error("Recovery storage is unavailable."));
    };
    r.onblocked = () => {
      settled = true;
      reject(Error("Close another tab to open recovery checkpoint storage."));
    };
  });
}
export async function storeCheckpoint(checkpoint: Checkpoint) {
  // Full verification outside the transaction; no asynchronous crypto can let an
  // IndexedDB transaction auto-commit before its intended writes.
  await verifyCheckpoint(checkpoint);
  const db = await openRecovery();
  let verifiedIndex: CheckpointHeader[];
  try {
    verifiedIndex = await new Promise<CheckpointHeader[]>((resolve, reject) => {
      const tx = db.transaction("headers"),
        r = tx.objectStore("headers").getAll(undefined, 257);
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    if (verifiedIndex.length >= 257) throw Error("Recovery index exceeds its safety limit.");
    await Promise.all(
      verifiedIndex.map(async (h) => {
        validateCheckpointHeader(h);
        if ((await headerHash(h)) !== h.integritySha256)
          throw Error(
            "Recovery index integrity verification failed. Existing checkpoints were retained.",
          );
      }),
    );
  } catch (e) {
    db.close();
    throw e;
  }
  return new Promise<CheckpointHeader>((resolve, reject) => {
    const tx = db.transaction(["headers", "snapshots"], "readwrite"),
      headers = tx.objectStore("headers"),
      snapshots = tx.objectStore("snapshots");
    let failure: unknown;
    const r = headers.getAll(undefined, 257);
    r.onsuccess = () => {
      try {
        if (canonicalNative(r.result) !== canonicalNative(verifiedIndex))
          throw Error(
            "Recovery index changed during verification. Newer checkpoints were retained; retry after saving the current draft.",
          );
        if (r.result.length >= 257) throw Error("Recovery index exceeds its safety limit.");
        const existing = (r.result as CheckpointHeader[]).find(
          (h) => h.id === checkpoint.header.id,
        );
        if (existing && canonicalNative(existing) !== canonicalNative(checkpoint.header))
          throw Error(
            "Recovery checkpoint identities are immutable. Existing recovery data was retained.",
          );
        const all = (r.result as CheckpointHeader[]).filter((h) => h.id !== checkpoint.header.id);
        const keep = retainedCheckpoints([...all, checkpoint.header], checkpoint.header.id),
          ids = new Set(keep.map((h) => h.id));
        headers.put(checkpoint.header);
        snapshots.put({ id: checkpoint.header.id, native: checkpoint.native });
        for (const old of all)
          if (!ids.has(old.id)) {
            headers.delete(old.id);
            snapshots.delete(old.id);
          }
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(checkpoint.header);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(
        failure ??
          tx.error ??
          Error("Recovery checkpoint write was interrupted; previous checkpoints remain intact."),
      );
    };
  });
}
export async function listCheckpoints(
  panelId: string,
): Promise<{ entries: CheckpointHeader[]; invalid: number }> {
  if (!text(panelId, 128)) throw Error("Invalid recovery page identity.");
  const db = await openRecovery();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("headers"),
      r = tx.objectStore("headers").index("by_panel").getAll(panelId, 65);
    tx.oncomplete = async () => {
      db.close();
      const entries: CheckpointHeader[] = [];
      let invalid = 0;
      for (const h of r.result) {
        try {
          validateCheckpointHeader(h);
          if (h.panelId !== panelId) throw Error();
          if ((await headerHash(h)) !== h.integritySha256)
            throw Error("Corrupted recovery index metadata.");
          entries.push(h);
        } catch {
          invalid++;
        }
      }
      if (r.result.length >= 65) {
        reject(Error("Recovery index exceeds its safety limit."));
        return;
      }
      resolve({
        entries: entries.sort(
          (a, b) => b.revision - a.revision || b.savedAt - a.savedAt || b.createdAt - a.createdAt,
        ),
        invalid,
      });
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error ?? Error("Recovery storage could not be read."));
    };
  });
}
export async function readCheckpoint(id: string, panelId: string) {
  if (!text(id, 128) || !text(panelId, 128)) throw Error("Invalid recovery identity.");
  const db = await openRecovery();
  const entry = await new Promise<Checkpoint>((resolve, reject) => {
    const tx = db.transaction(["headers", "snapshots"]),
      h = tx.objectStore("headers").get(id),
      s = tx.objectStore("snapshots").get(id);
    tx.oncomplete = () => {
      db.close();
      if (!h.result || h.result.id !== id || h.result.panelId !== panelId || s.result?.id !== id) {
        reject(Error("Recovery checkpoint is missing or belongs to another page."));
        return;
      }
      resolve({ header: h.result, native: s.result.native });
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error ?? Error("Recovery checkpoint could not be read."));
    };
  });
  return { ...entry, session: await verifyCheckpoint(entry) };
}
