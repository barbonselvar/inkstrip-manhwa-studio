import { createStore, get, set } from "idb-keyval";
import {
  CHUNK_BYTES,
  canonicalManifest,
  validateManifest,
  type Manifest,
  type CloudProject,
} from "./policy";
import {
  accountGet,
  accountPost,
  accountSession,
  downloadPart,
  uploadPart,
  AccountError,
} from "./client";
import { encodeBackup, decodeBackup, backupFileName } from "../studio/backup";
import { readProjectData, importProject } from "../studio/backup-store";
const journals = createStore("inkstrip-cloud-transfers", "journals");
type Journal = {
  owner: string;
  localId: string;
  cloudLocalId: string;
  cloudId: string;
  base: number;
  hash: string;
  completed: boolean;
};
const key = (owner: string, id: string) => `${owner}:${id}`;
export const sha256 = async (blob: Blob | string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof blob === "string" ? new TextEncoder().encode(blob) : await blob.arrayBuffer(),
      ),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
export async function packageManifest(
  blob: Blob,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
) {
  const parts = [];
  for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
    signal?.throwIfAborted();
    const part = blob.slice(offset, offset + CHUNK_BYTES);
    parts.push({ digest: await sha256(part), bytes: part.size });
    onProgress?.(Math.min(offset + part.size, blob.size), blob.size);
  }
  return validateManifest({ version: 1, bytes: blob.size, parts });
}
async function sameAccount(owner: string, signal?: AbortSignal) {
  const s = await accountSession(signal);
  if (s.user?.id !== owner)
    throw new AccountError(
      "The signed-in account changed. No more data was transferred.",
      "account_changed",
      401,
    );
}
export async function uploadLocalProject(
  owner: string,
  id: string,
  separateCopy: boolean,
  signal: AbortSignal,
  progress: (stage: string, done: number, total: number) => void,
) {
  await sameAccount(owner, signal);
  const data = await readProjectData(id),
    blob = encodeBackup(data, 0),
    manifest = await packageManifest(blob, signal, (d, t) =>
      progress("Checking local package", d, t),
    ),
    hash = await sha256(canonicalManifest(manifest));
  let journal = await get<Journal>(key(owner, id), journals);
  if (journal?.owner !== owner) journal = undefined;
  const cloudLocalId = separateCopy
    ? `${id.slice(0, 150)}:copy:${crypto.randomUUID()}`
    : (journal?.cloudLocalId ?? id);
  const { project } = await accountPost<{ project: CloudProject }>(
    "open-project",
    {
      localId: cloudLocalId,
      title: separateCopy
        ? `${data.project.title.slice(0, 280)} (separate copy)`
        : data.project.title,
    },
    signal,
  );
  if (!separateCopy && !journal && project.head_revision > 0) {
    const latest = await accountGet<{ manifest_hash: string }>(
      `revision?project=${project.id}`,
      signal,
    );
    if (latest.manifest_hash !== hash)
      throw new AccountError(
        "This local project already has a cloud copy on another device. Download that revision or explicitly upload a separate copy.",
        "revision_conflict",
        409,
      );
    journal = {
      owner,
      localId: id,
      cloudLocalId,
      cloudId: project.id,
      base: project.head_revision,
      hash,
      completed: true,
    };
    await set(key(owner, id), journal, journals);
    return { revision: project.head_revision, duplicate: true };
  }
  const base = separateCopy ? 0 : (journal?.base ?? 0);
  journal = { owner, localId: id, cloudLocalId, cloudId: project.id, base, hash, completed: false };
  await set(key(owner, id), journal, journals);
  let offset = 0;
  for (const part of manifest.parts) {
    signal.throwIfAborted();
    await sameAccount(owner, signal);
    await uploadPart(project.id, part.digest, blob.slice(offset, offset + part.bytes), signal);
    offset += part.bytes;
    progress("Uploading verified chunks", offset, blob.size);
  }
  await sameAccount(owner, signal);
  // Do not publish a stale local snapshot if edits occurred during a long upload.
  const latest = await readProjectData(id);
  if (
    JSON.stringify([
      latest.project,
      latest.chapters,
      latest.panels,
      latest.sessions?.map((s) => s.revision),
    ]) !==
    JSON.stringify([
      data.project,
      data.chapters,
      data.panels,
      data.sessions?.map((s) => s.revision),
    ])
  )
    throw new AccountError(
      "The local project changed during upload. Its files remain safe; upload the latest version again.",
      "local_changed",
      409,
    );
  const result = await accountPost<{ revision: number; duplicate: boolean; hash: string }>(
    "commit",
    { project: project.id, base, manifest, title: data.project.title },
    signal,
  );
  await set(key(owner, id), { ...journal, base: result.revision, hash, completed: true }, journals);
  progress("Cloud revision verified", blob.size, blob.size);
  return result;
}
export async function cloudPackage(
  owner: string,
  project: CloudProject,
  signal: AbortSignal,
  progress: (stage: string, done: number, total: number) => void,
) {
  await sameAccount(owner, signal);
  const record = await accountGet<{ revision: number; manifest: Manifest; manifest_hash: string }>(
      `revision?project=${project.id}`,
      signal,
    ),
    manifest = validateManifest(record.manifest);
  if ((await sha256(canonicalManifest(manifest))) !== record.manifest_hash)
    throw new AccountError("Cloud manifest failed its integrity check.", "integrity", 422);
  const parts: Blob[] = [];
  let done = 0;
  for (const part of manifest.parts) {
    signal.throwIfAborted();
    await sameAccount(owner, signal);
    const blob = await downloadPart(project.id, part.digest, signal);
    if (blob.size !== part.bytes || (await sha256(blob)) !== part.digest)
      throw new AccountError(
        "A cloud file failed its integrity check. Local projects were not changed.",
        "integrity",
        422,
      );
    parts.push(blob);
    done += part.bytes;
    progress("Downloading verified chunks", done, manifest.bytes);
  }
  const blob = new Blob(parts, { type: "application/octet-stream" });
  if (blob.size !== manifest.bytes)
    throw new AccountError("Cloud package size does not match.", "integrity", 422);
  return { blob, record };
}
export async function restoreCloudProject(
  owner: string,
  project: CloudProject,
  signal: AbortSignal,
  progress: (stage: string, done: number, total: number) => void,
) {
  const { blob, record } = await cloudPackage(owner, project, signal, progress);
  signal.throwIfAborted();
  await sameAccount(owner, signal);
  const decoded = await decodeBackup(blob);
  const id = await importProject(blob);
  await set(
    key(owner, id),
    {
      owner,
      localId: id,
      cloudLocalId: project.local_id,
      cloudId: project.id,
      base: record.revision,
      hash: record.manifest_hash,
      completed: true,
    } satisfies Journal,
    journals,
  );
  return decoded.project.title;
}
export async function downloadCloudProject(
  owner: string,
  project: CloudProject,
  signal: AbortSignal,
  progress: (stage: string, done: number, total: number) => void,
) {
  const { blob } = await cloudPackage(owner, project, signal, progress);
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = backupFileName(project.title);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
