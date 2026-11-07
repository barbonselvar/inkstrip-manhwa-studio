/**
 * Which workspace project is saved to which `.inkstrip` file, the recent-projects list,
 * and autosave recovery snapshots. Pure Node (paths are injected), unit-tested.
 */
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { JsonDocument, readJson, writeJson } from "./json-store.ts";

export type StoredLink = {
  projectId: string;
  path: string;
  fingerprint: string;
  sha256: string;
  savedAt: number;
  mtime: number;
};
export type StoredRecent = { path: string; title: string; projectId: string | null; openedAt: number };
export type StoredRecovery = {
  id: string;
  projectId: string;
  title: string;
  fingerprint: string;
  createdAt: number;
  size: number;
  linkedPath: string | null;
};

const MAX_RECENT = 15;
export const PROJECT_ID = /^[A-Za-z0-9_-]{1,100}$/;

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function sanitizeLinks(value: unknown): StoredLink[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    const projectId = str(raw?.projectId),
      path = str(raw?.path),
      fingerprint = str(raw?.fingerprint),
      sha256 = str(raw?.sha256),
      savedAt = num(raw?.savedAt),
      mtime = num(raw?.mtime) ?? 0;
    if (!projectId || !PROJECT_ID.test(projectId) || !path || !fingerprint || !sha256 || savedAt === null)
      return [];
    if (seen.has(projectId)) return [];
    seen.add(projectId);
    return [{ projectId, path, fingerprint, sha256, savedAt, mtime }];
  });
}

function sanitizeRecent(value: unknown): StoredRecent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .flatMap((raw) => {
      const path = str(raw?.path),
        title = str(raw?.title) ?? "",
        projectId = str(raw?.projectId),
        openedAt = num(raw?.openedAt);
      if (!path || openedAt === null || seen.has(path.toLowerCase())) return [];
      seen.add(path.toLowerCase());
      return [{ path, title: title.slice(0, 200), projectId: projectId && PROJECT_ID.test(projectId) ? projectId : null, openedAt }];
    })
    .slice(0, MAX_RECENT);
}

function sanitizeRecovery(value: unknown): StoredRecovery | null {
  const id = str((value as StoredRecovery)?.id),
    projectId = str((value as StoredRecovery)?.projectId),
    fingerprint = str((value as StoredRecovery)?.fingerprint),
    createdAt = num((value as StoredRecovery)?.createdAt),
    size = num((value as StoredRecovery)?.size);
  if (!id || !projectId || !PROJECT_ID.test(projectId) || !fingerprint || createdAt === null || size === null)
    return null;
  return {
    id,
    projectId,
    title: (str((value as StoredRecovery).title) ?? "Untitled project").slice(0, 200),
    fingerprint,
    createdAt,
    size,
    linkedPath: str((value as StoredRecovery).linkedPath),
  };
}

export class ProjectRegistry {
  readonly links: JsonDocument<StoredLink[]>;
  readonly recent: JsonDocument<StoredRecent[]>;
  readonly metadataDir: string;
  readonly recoveryDir: string;

  constructor(metadataDir: string, recoveryDir: string) {
    this.metadataDir = metadataDir;
    this.recoveryDir = recoveryDir;
    this.links = new JsonDocument(join(metadataDir, "project-links.json"), () => [], sanitizeLinks);
    this.recent = new JsonDocument(join(metadataDir, "recent-projects.json"), () => [], sanitizeRecent);
  }

  async link(projectId: string) {
    return (await this.links.get()).find((l) => l.projectId === projectId) ?? null;
  }

  async setLink(link: StoredLink) {
    await this.links.update((all) => [
      link,
      // A file belongs to one workspace project; re-linking a path moves it.
      ...all.filter((l) => l.projectId !== link.projectId && l.path.toLowerCase() !== link.path.toLowerCase()),
    ]);
  }

  async removeLink(projectId: string) {
    await this.links.update((all) => all.filter((l) => l.projectId !== projectId));
  }

  async touchRecent(entry: Omit<StoredRecent, "openedAt">) {
    await this.recent.update((all) => [
      { ...entry, openedAt: Date.now() },
      ...all.filter((r) => r.path.toLowerCase() !== entry.path.toLowerCase()),
    ]);
  }

  async removeRecent(path: string) {
    await this.recent.update((all) => all.filter((r) => r.path.toLowerCase() !== path.toLowerCase()));
  }

  recoveryFile(projectId: string) {
    if (!PROJECT_ID.test(projectId)) throw new Error("Invalid project id.");
    return join(this.recoveryDir, `${projectId}.inkstrip`);
  }

  async writeRecoveryMeta(meta: StoredRecovery) {
    await writeJson(join(this.recoveryDir, `${meta.projectId}.json`), meta);
  }

  async listRecovery(): Promise<(StoredRecovery & { file: string })[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.recoveryDir);
    } catch {
      return [];
    }
    const out: (StoredRecovery & { file: string })[] = [];
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      const meta = await readJson(join(this.recoveryDir, name), null, sanitizeRecovery);
      if (!meta) continue;
      const file = this.recoveryFile(meta.projectId);
      const info = await stat(file).catch(() => null);
      if (!info || info.size !== meta.size) continue;
      out.push({ ...meta, file });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  async discardRecovery(projectId: string) {
    if (!PROJECT_ID.test(projectId)) return;
    await unlink(this.recoveryFile(projectId)).catch(() => {});
    await unlink(join(this.recoveryDir, `${projectId}.json`)).catch(() => {});
  }
}
