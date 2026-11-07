/**
 * Crash-safe `.inkstrip` file writing and container integrity checks.
 *
 * A save never touches the existing project file until a complete, verified copy is on
 * disk: bytes stream into a hidden temporary file in the destination folder, are flushed
 * with fsync, re-read and hashed, structurally validated, and only then renamed over the
 * original (an atomic replace on NTFS). If anything fails, the original file is unchanged
 * and the temporary file is removed. The previous version is copied into the rotating
 * backup folder first.
 *
 * Pure Node: no Electron imports, so it is unit-tested directly.
 */
import { createHash, randomBytes, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  stat,
  statfs,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Same container as the website's project backup (`src/lib/studio/backup.ts`). */
export const CONTAINER_MAGIC = Buffer.from("INKSTRIP-BACKUP\n", "utf8");
const MAX_HEADER = 32 * 1024 * 1024;
/** Keep this much free space beyond the file itself so Windows is never filled to zero. */
const SPACE_MARGIN = 64 * 1024 * 1024;

export class ProjectFileError extends Error {
  readonly code: "space" | "integrity" | "format" | "size" | "busy" | "io";
  constructor(message: string, code: ProjectFileError["code"]) {
    super(message);
    this.name = "ProjectFileError";
    this.code = code;
  }
}

export type ContainerSummary = {
  version: number;
  projectId: string;
  title: string;
  chapters: number;
  panels: number;
  assets: number;
  exportedAt: number;
};

/**
 * Validate the container structure without loading artwork: magic, header length,
 * parsable header, and blob sizes that account for every byte of the file. A truncated
 * or padded file fails. (The renderer then validates every record and image.)
 */
export async function inspectContainer(path: string): Promise<ContainerSummary> {
  const info = await stat(path);
  const handle = await open(path, "r");
  try {
    const prefixLength = CONTAINER_MAGIC.length + 4;
    if (info.size < prefixLength) throw formatError();
    const prefix = Buffer.alloc(prefixLength);
    await handle.read(prefix, 0, prefixLength, 0);
    if (!prefix.subarray(0, CONTAINER_MAGIC.length).equals(CONTAINER_MAGIC)) throw formatError();
    const headerLength = prefix.readUInt32BE(CONTAINER_MAGIC.length);
    if (headerLength > MAX_HEADER || prefixLength + headerLength > info.size) throw formatError();
    const headerBytes = Buffer.alloc(headerLength);
    await handle.read(headerBytes, 0, headerLength, prefixLength);
    let header: {
      format?: unknown;
      version?: unknown;
      exportedAt?: unknown;
      project?: { id?: unknown; title?: unknown };
      chapters?: unknown;
      panels?: unknown;
      blobs?: { size?: unknown }[];
    };
    try {
      header = JSON.parse(headerBytes.toString("utf8"));
    } catch {
      throw formatError();
    }
    if (header?.format !== "inkstrip-backup" || typeof header.version !== "number")
      throw formatError();
    if (!Array.isArray(header.blobs) || !Array.isArray(header.chapters) || !Array.isArray(header.panels))
      throw formatError();
    let total = prefixLength + headerLength;
    for (const entry of header.blobs) {
      if (!Number.isSafeInteger(entry?.size) || (entry.size as number) < 0) throw formatError();
      total += entry.size as number;
    }
    if (total !== info.size)
      throw new ProjectFileError(
        "This project file is incomplete or damaged (its size does not match its contents).",
        "integrity",
      );
    const id = header.project?.id,
      title = header.project?.title;
    if (typeof id !== "string" || !id) throw formatError();
    return {
      version: header.version,
      projectId: id,
      title: typeof title === "string" ? title : "Untitled project",
      chapters: header.chapters.length,
      panels: header.panels.length,
      assets: header.blobs.length,
      exportedAt: typeof header.exportedAt === "number" ? header.exportedAt : 0,
    };
  } finally {
    await handle.close();
  }
}

const formatError = () =>
  new ProjectFileError("This file is not a valid Inkstrip project.", "format");

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve());
  });
  return hash.digest("hex");
}

export async function freeBytes(folder: string): Promise<number | null> {
  try {
    const s = await statfs(folder);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export type BackupPolicy = { folder: string; keep: number };

export type CommitResult = {
  sha256: string;
  size: number;
  summary: ContainerSummary;
  backupCreated: boolean;
};

/** One streaming save. Create with `begin`, feed `append`, finish with `commit` or `abort`. */
export class WriteSession {
  readonly id = randomBytes(16).toString("hex");
  private handle: FileHandle | null = null;
  private hash: Hash = createHash("sha256");
  private written = 0;
  private closed = false;
  readonly temp: string;
  readonly target: string;
  readonly expectedSize: number;

  private constructor(target: string, expectedSize: number) {
    this.target = target;
    this.expectedSize = expectedSize;
    // Same folder as the target, so the final rename is atomic and never crosses volumes.
    this.temp = join(
      dirname(target),
      `.${basename(target)}.${randomBytes(6).toString("hex")}.saving`,
    );
  }

  static async begin(target: string, expectedSize: number): Promise<WriteSession> {
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= CONTAINER_MAGIC.length)
      throw new ProjectFileError("Nothing to save.", "size");
    await mkdir(dirname(target), { recursive: true });
    const free = await freeBytes(dirname(target));
    if (free !== null && free < expectedSize + SPACE_MARGIN)
      throw new ProjectFileError(
        `Not enough disk space to save (${formatBytes(expectedSize)} needed, ${formatBytes(Math.max(0, free - SPACE_MARGIN))} available). Your project file was not changed.`,
        "space",
      );
    const session = new WriteSession(target, expectedSize);
    session.handle = await open(session.temp, "wx");
    return session;
  }

  get bytesWritten() {
    return this.written;
  }

  async append(chunk: Uint8Array) {
    if (!this.handle || this.closed) throw new ProjectFileError("Save session closed.", "io");
    if (this.written + chunk.byteLength > this.expectedSize)
      throw new ProjectFileError("Save data exceeded its declared size.", "size");
    if (this.written < CONTAINER_MAGIC.length) {
      // Never let a non-project payload overwrite a project file (checked across chunks).
      const take = Math.min(chunk.byteLength, CONTAINER_MAGIC.length - this.written);
      const head = Buffer.from(chunk.buffer, chunk.byteOffset, take);
      if (!head.equals(CONTAINER_MAGIC.subarray(this.written, this.written + take)))
        throw new ProjectFileError("Save data is not an Inkstrip project.", "format");
    }
    let offset = 0;
    while (offset < chunk.byteLength) {
      const { bytesWritten } = await this.handle.write(chunk, offset, chunk.byteLength - offset);
      offset += bytesWritten;
    }
    this.hash.update(chunk);
    this.written += chunk.byteLength;
  }

  /** Verify and atomically publish the file. Throws (original untouched) on any failure. */
  async commit(backup?: BackupPolicy): Promise<CommitResult> {
    if (!this.handle || this.closed) throw new ProjectFileError("Save session closed.", "io");
    try {
      if (this.written !== this.expectedSize)
        throw new ProjectFileError("The save was interrupted before all data arrived.", "size");
      await this.handle.sync();
      await this.handle.close();
      this.handle = null;
      const digest = this.hash.digest("hex");
      // Re-read what is actually on disk: catches failing media and filter drivers.
      if ((await sha256File(this.temp)) !== digest)
        throw new ProjectFileError(
          "The saved data did not verify on disk. Your project file was not changed.",
          "integrity",
        );
      const summary = await inspectContainer(this.temp);
      let backupCreated = false;
      if (backup && backup.keep > 0 && (await exists(this.target))) {
        backupCreated = await keepBackup(this.target, backup, summary.title);
      }
      await renameWithRetry(this.temp, this.target);
      this.closed = true;
      await syncDirectory(dirname(this.target));
      return { sha256: digest, size: this.written, summary, backupCreated };
    } catch (error) {
      await this.abort();
      throw error;
    }
  }

  async abort() {
    this.closed = true;
    try {
      await this.handle?.close();
    } catch {
      /* already closed */
    }
    this.handle = null;
    await unlink(this.temp).catch(() => {});
  }
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Copy the current file into the backup folder, then prune the oldest beyond `keep`. */
export async function keepBackup(source: string, policy: BackupPolicy, title: string) {
  try {
    await mkdir(policy.folder, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${stamp}-${safeName(title)}.inkstrip`;
    await copyFile(source, join(policy.folder, name));
    await pruneBackups(policy.folder, policy.keep);
    return true;
  } catch {
    // A backup failure must never block saving the user's newer work.
    return false;
  }
}

export async function pruneBackups(folder: string, keep: number) {
  const entries = (await readdir(folder)).filter((n) => n.endsWith(".inkstrip")).sort();
  for (const name of entries.slice(0, Math.max(0, entries.length - keep)))
    await unlink(join(folder, name)).catch(() => {});
}

/** Windows antivirus/indexers briefly lock new files; retry the atomic replace. */
export async function renameWithRetry(from: string, to: string, attempts = 12) {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (i >= attempts - 1 || !["EPERM", "EBUSY", "EACCES"].includes(code ?? ""))
        throw new ProjectFileError(
          code === "EBUSY" || code === "EPERM" || code === "EACCES"
            ? "The project file is locked by another program. Close it there and save again; your work is safe in Inkstrip."
            : `Could not replace the project file (${code ?? "error"}).`,
          code === "EBUSY" || code === "EPERM" ? "busy" : "io",
        );
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

async function syncDirectory(folder: string) {
  // Directory fsync is unsupported on Windows; NTFS journals the rename itself.
  if (process.platform === "win32") return;
  try {
    const handle = await open(folder, "r");
    await handle.sync();
    await handle.close();
  } catch {
    /* best effort */
  }
}

export function safeName(title: string) {
  return (
    [...title.normalize("NFKC")]
      .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? " " : c))
      .join("")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 60) || "project"
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Remove abandoned `.saving` files left by a crash or power loss mid-save. */
export async function sweepTemporaryFiles(folder: string, olderThanMs = 60 * 60 * 1000) {
  try {
    for (const name of await readdir(folder)) {
      if (!/^\..+\.[0-9a-f]{12}\.saving$/.test(name)) continue;
      const path = join(folder, name);
      const info = await stat(path).catch(() => null);
      if (info && Date.now() - info.mtimeMs > olderThanMs) await unlink(path).catch(() => {});
    }
  } catch {
    /* folder gone */
  }
}
