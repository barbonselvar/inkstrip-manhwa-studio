/**
 * Every renderer → main request. Each handler checks that it came from the app's own
 * page in the main window, validates its arguments, and only touches paths it resolved
 * itself (from opaque tokens or its own storage folders).
 */
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import type { WindowShell } from "./window-shell.ts";
import { mkdir, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  DESKTOP_ORIGIN,
  MAX_WRITE_CHUNK,
  PROJECT_EXTENSION,
  WEB_BACKUP_EXTENSION,
  type FileRef,
  type InvokeChannel,
  type ProjectLink,
  type RecentProject,
  type WriteCommit,
} from "../../../../src/lib/desktop/contract.ts";
import type { AppPaths } from "./app-paths.ts";
import type { FileTokens } from "./file-tokens.ts";
import { inspectContainer, safeName, sha256File, WriteSession } from "./project-files.ts";
import { PROJECT_ID, type ProjectRegistry, type StoredLink } from "./registry.ts";
import type { Secrets } from "./secrets.ts";
import { mergeSettings } from "./settings.ts";
import type { JsonDocument } from "./json-store.ts";
import type { DesktopSettings } from "../../../../src/lib/desktop/contract.ts";
import type { UpdateService } from "./updater.ts";
import { log } from "./logger.ts";

export type IpcContext = {
  window: () => BrowserWindow | null;
  /** The studio view's web contents: the only sender allowed on these channels. */
  studio: () => WebContents | null;
  frame: () => WindowShell | null;
  paths: AppPaths;
  tokens: FileTokens;
  registry: ProjectRegistry;
  settings: JsonDocument<DesktopSettings>;
  secrets: Secrets;
  updates: UpdateService;
  info: () => Promise<unknown>;
  closeReady: (id: string, proceed: boolean) => void;
  rendererReady: () => Promise<FileRef | null>;
  allowQuitForUpdate: () => void;
  refreshMenu: () => void;
  lastDirectory: { value: string };
};

const FINGERPRINT = /^[a-f0-9]{64}$/;
const EXTERNAL_HOSTS = new Set(["github.com", "platform.openai.com", "huggingface.co", "openai.com"]);

class InvalidRequest extends Error {}
const str = (v: unknown, max = 500): string => {
  if (typeof v !== "string" || v.length > max) throw new InvalidRequest("Invalid request.");
  return v;
};

export function registerIpc(ctx: IpcContext) {
  const sessions = new Map<string, { session: WriteSession; kind: "file" | "recovery"; path: string; started: number }>();

  const handle = (channel: InvokeChannel, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const contents = ctx.studio();
      const url = event.senderFrame?.url ?? "";
      if (!contents || event.sender !== contents || !url.startsWith(`${DESKTOP_ORIGIN}/`) || url.startsWith(`${DESKTOP_ORIGIN}/__shell/`))
        throw new Error("Request rejected.");
      try {
        return await fn(...args);
      } catch (error) {
        if (!(error instanceof InvalidRequest)) log.warn(`[ipc] ${channel} failed`, error);
        throw error instanceof Error ? new Error(error.message) : new Error(String(error));
      }
    });

  const linkRef = async (link: StoredLink): Promise<ProjectLink> => ({
    projectId: link.projectId,
    file: await ctx.tokens.ref(link.path, "project"),
    fingerprint: link.fingerprint,
    sha256: link.sha256,
    savedAt: link.savedAt,
    fileModifiedAt: link.mtime,
  });

  const projectKind = (path: string): FileRef["kind"] =>
    path.toLowerCase().endsWith(WEB_BACKUP_EXTENSION) ? "web-backup" : "project";

  const chooseFile = async (title: string, webBackupFirst: boolean) => {
    const win = ctx.window();
    if (!win) return null;
    await mkdir(ctx.paths.documents, { recursive: true }).catch(() => {});
    const filters = [
      { name: "Inkstrip projects", extensions: ["inkstrip", "inkstrip-project"] },
      { name: "Inkstrip project files", extensions: ["inkstrip"] },
      { name: "Inkstrip website backups", extensions: ["inkstrip-project"] },
    ];
    const result = await dialog.showOpenDialog(win, {
      title,
      defaultPath: ctx.lastDirectory.value || ctx.paths.documents,
      filters: webBackupFirst ? [filters[2]!, filters[0]!] : filters,
      properties: ["openFile"],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    ctx.lastDirectory.value = join(path, "..");
    await inspectContainer(path); // Reject non-projects before the renderer reads anything.
    return ctx.tokens.ref(path, projectKind(path));
  };

  const chooseSave = async (title: string, suggested: unknown) => {
    const win = ctx.window();
    if (!win) return null;
    // Default home for projects: Documents\Inkstrip (created on first use).
    await mkdir(ctx.paths.documents, { recursive: true }).catch(() => {});
    const name = safeName(str(suggested, 200).replace(/\.inkstrip$/i, "")) + PROJECT_EXTENSION;
    const result = await dialog.showSaveDialog(win, {
      title,
      defaultPath: join(ctx.lastDirectory.value || ctx.paths.documents, name),
      filters: [{ name: "Inkstrip project", extensions: ["inkstrip"] }],
      properties: ["showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return null;
    let path = result.filePath;
    if (extname(path).toLowerCase() !== PROJECT_EXTENSION) path += PROJECT_EXTENSION;
    ctx.lastDirectory.value = join(path, "..");
    return ctx.tokens.ref(path, "project");
  };

  handle("app:info", () => ctx.info());
  handle("file:open-dialog", () => chooseFile("Open Inkstrip Project", false));
  handle("file:import-dialog", () => chooseFile("Import a Website Backup", true));
  handle("file:save-dialog", (name) => chooseSave("Save Project As", name));
  handle("file:export-dialog", (name) => chooseSave("Export a Copy of the Project", name));

  handle("write:begin", async (target, expectedSize) => {
    if (sessions.size >= 4) throw new Error("Too many saves in progress.");
    if (typeof expectedSize !== "number") throw new InvalidRequest("Invalid size.");
    const t = target as { kind?: unknown; token?: unknown; projectId?: unknown };
    let path: string;
    let kind: "file" | "recovery";
    if (t?.kind === "file") {
      const entry = ctx.tokens.resolve(t.token, ["project"]);
      if (!entry) throw new Error("That file is no longer available. Choose Save As.");
      path = entry.path;
      kind = "file";
    } else if (t?.kind === "recovery" && typeof t.projectId === "string" && PROJECT_ID.test(t.projectId)) {
      path = ctx.registry.recoveryFile(t.projectId);
      kind = "recovery";
    } else throw new InvalidRequest("Invalid save target.");
    const session = await WriteSession.begin(path, expectedSize);
    sessions.set(session.id, { session, kind, path, started: Date.now() });
    return session.id;
  });

  handle("write:chunk", async (id, chunk) => {
    const entry = sessions.get(str(id, 64));
    if (!entry) throw new Error("Save session expired.");
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0 || chunk.byteLength > MAX_WRITE_CHUNK)
      throw new InvalidRequest("Invalid save data.");
    try {
      await entry.session.append(chunk);
    } catch (error) {
      sessions.delete(entry.session.id);
      await entry.session.abort();
      throw error;
    }
  });

  handle("write:abort", async (id) => {
    const entry = sessions.get(str(id, 64));
    sessions.delete(str(id, 64));
    await entry?.session.abort();
  });

  handle("write:commit", async (id, rawCommit, link) => {
    const entry = sessions.get(str(id, 64));
    if (!entry) throw new Error("Save session expired.");
    sessions.delete(entry.session.id);
    const c = rawCommit as WriteCommit;
    try {
      if (!PROJECT_ID.test(str(c?.projectId, 100)) || !FINGERPRINT.test(str(c?.fingerprint, 64)))
        throw new InvalidRequest("Invalid save metadata.");
      const title = str(c.title, 300).slice(0, 200);
      const settings = await ctx.settings.get();
      const result = await entry.session.commit(
        entry.kind === "file"
          ? { folder: join(ctx.paths.backups, c.projectId), keep: settings.backups.keep }
          : undefined,
      );
      if (result.summary.projectId !== c.projectId) throw new Error("Saved project identity mismatch.");
      const savedAt = Date.now();
      let projectLink: ProjectLink | null = null;
      if (entry.kind === "recovery") {
        const linked = await ctx.registry.link(c.projectId);
        await ctx.registry.writeRecoveryMeta({
          id: c.projectId,
          projectId: c.projectId,
          title,
          fingerprint: c.fingerprint,
          createdAt: savedAt,
          size: result.size,
          linkedPath: linked?.path ?? null,
        });
      } else if (link === true) {
        const mtime = (await stat(entry.path)).mtimeMs;
        const stored = { projectId: c.projectId, path: entry.path, fingerprint: c.fingerprint, sha256: result.sha256, savedAt, mtime };
        await ctx.registry.setLink(stored);
        await ctx.registry.touchRecent({ path: entry.path, title, projectId: c.projectId });
        ctx.refreshMenu();
        projectLink = await linkRef(stored);
      }
      log.info(`[save] ${entry.kind} ${result.size} bytes in ${Date.now() - entry.started} ms`);
      return { sha256: result.sha256, size: result.size, savedAt, link: projectLink, backupCreated: result.backupCreated };
    } catch (error) {
      await entry.session.abort();
      throw error;
    }
  });

  handle("link:get", async (projectId) => {
    const link = await ctx.registry.link(str(projectId, 100));
    return link ? linkRef(link) : null;
  });
  handle("link:list", async () => Promise.all((await ctx.registry.links.get()).map(linkRef)));
  handle("link:remove", async (projectId) => {
    await ctx.registry.removeLink(str(projectId, 100));
  });
  handle("link:opened", async (projectId, token, fingerprint, title) => {
    if (!PROJECT_ID.test(str(projectId, 100)) || !FINGERPRINT.test(str(fingerprint, 64)))
      throw new InvalidRequest("Invalid link.");
    const entry = ctx.tokens.resolve(token, ["project"]);
    if (!entry) throw new InvalidRequest("Invalid file.");
    const summary = await inspectContainer(entry.path);
    if (summary.projectId !== projectId) throw new Error("This file belongs to a different project.");
    const info = await stat(entry.path);
    const stored = {
      projectId: projectId as string,
      path: entry.path,
      fingerprint: fingerprint as string,
      sha256: await sha256File(entry.path),
      savedAt: info.mtimeMs,
      mtime: info.mtimeMs,
    };
    await ctx.registry.setLink(stored);
    await ctx.registry.touchRecent({ path: entry.path, title: str(title, 300), projectId: stored.projectId });
    ctx.refreshMenu();
    return linkRef(stored);
  });

  handle("recent:list", () => recentProjects(ctx));
  handle("recent:remove", async (path) => {
    await ctx.registry.removeRecent(str(path, 4000));
    ctx.refreshMenu();
  });
  handle("file:reveal", (token) => {
    const entry = ctx.tokens.resolve(token);
    if (entry) shell.showItemInFolder(entry.path);
  });

  handle("file:dropped", async (path) => {
    const full = str(path, 4000);
    const lower = full.toLowerCase();
    if (!lower.endsWith(PROJECT_EXTENSION) && !lower.endsWith(WEB_BACKUP_EXTENSION)) return null;
    await inspectContainer(full);
    return ctx.tokens.ref(full, projectKind(full));
  });
  handle("recovery:list", async () =>
    Promise.all(
      (await ctx.registry.listRecovery()).map(async (r) => ({
        id: r.id,
        projectId: r.projectId,
        title: r.title,
        fingerprint: r.fingerprint,
        createdAt: r.createdAt,
        size: r.size,
        linkedPath: r.linkedPath,
        file: await ctx.tokens.ref(r.file, "recovery"),
      })),
    ),
  );
  handle("recovery:discard", async (id) => ctx.registry.discardRecovery(str(id, 100)));
  handle("backups:list", async (projectId) => {
    if (!PROJECT_ID.test(str(projectId, 100))) throw new InvalidRequest("Invalid project.");
    const folder = join(ctx.paths.backups, projectId as string);
    const names = await readdir(folder).catch(() => [] as string[]);
    const refs = await Promise.all(
      names.filter((n) => n.endsWith(PROJECT_EXTENSION)).map((n) => ctx.tokens.ref(join(folder, n), "backup")),
    );
    return refs.sort((a, b) => b.modifiedAt - a.modifiedAt);
  });
  handle("folder:open", async (kind) => {
    const folders = {
      recovery: ctx.paths.recovery,
      backups: ctx.paths.backups,
      logs: ctx.paths.logs,
      workspace: ctx.paths.local,
    } as const;
    const folder = folders[kind as keyof typeof folders];
    if (!folder) throw new InvalidRequest("Invalid folder.");
    await shell.openPath(folder);
  });

  handle("settings:get", () => ctx.settings.get());
  handle("settings:set", async (patch) => {
    const next = await ctx.settings.update((current) => mergeSettings(current, patch));
    ctx.refreshMenu();
    ctx.frame()?.apply(next.window);
    return next;
  });
  handle("secret:has", async () => (await ctx.secrets.get()) !== null);
  handle("secret:set", (key) => ctx.secrets.set(key === null ? null : str(key, 400).trim()));

  handle("window:title", (title, dirty) => {
    const win = ctx.window();
    if (!win) return;
    const name = str(title, 300).trim();
    win.setTitle(`${dirty === true ? "● " : ""}${name ? `${name} — ` : ""}Inkstrip Manhwa Studio`);
    win.setDocumentEdited(dirty === true);
  });
  handle("window:status", (raw) => {
    const v = (raw ?? {}) as Record<string, unknown>;
    const text = (x: unknown) => (typeof x === "string" ? x.slice(0, 200) : null);
    const SAVE = ["none", "saved", "dirty", "unlinked", "missing", "saving"];
    const WORK = ["library", "project", "chapter"];
    ctx.frame()?.setStatus({
      project: text(v.project),
      chapter: text(v.chapter),
      workspace: (WORK.includes(v.workspace as string) ? v.workspace : "library") as "library",
      save: (SAVE.includes(v.save as string) ? v.save : "none") as "none",
      fileName: text(v.fileName),
      savedAt: typeof v.savedAt === "number" ? v.savedAt : null,
    });
  });
  handle("window:popup-menu", (name) => {
    if (typeof name === "string" && ["file", "edit", "view", "help", "all"].includes(name))
      ctx.frame()?.popupMenu(name as "file");
  });
  handle("window:state", () => ctx.frame()?.state ?? null);
  handle("window:fullscreen", () => ctx.frame()?.toggleFullScreen());
  handle("window:zoom", (direction) => {
    const win = ctx.window();
    const contents = ctx.studio();
    if (!win || !contents) return 1;
    const current = contents.getZoomFactor();
    const next =
      direction === "in" ? current * 1.1 : direction === "out" ? current / 1.1 : direction === "reset" ? 1 : current;
    const clamped = Math.round(Math.min(2, Math.max(0.5, next)) * 100) / 100;
    contents.setZoomFactor(clamped);
    return clamped;
  });
  handle("shell:external", async (url) => {
    const u = new URL(str(url, 2000));
    if (u.protocol !== "https:" || !EXTERNAL_HOSTS.has(u.hostname)) throw new InvalidRequest("Link blocked.");
    await shell.openExternal(u.href);
  });

  handle("update:state", () => ctx.updates.current);
  handle("update:check", () => ctx.updates.check(true));
  handle("update:download", () => ctx.updates.download());
  handle("update:cancel", () => ctx.updates.cancelDownload());
  handle("update:install", async () => {
    // Quitting without prompts is allowed only once the update re-verified.
    await ctx.updates.install(() => ctx.allowQuitForUpdate());
  });

  handle("lifecycle:close-ready", (id, proceed) => ctx.closeReady(str(id, 64), proceed === true));
  handle("lifecycle:renderer-ready", async () => ({ pendingOpen: await ctx.rendererReady() }));
}

export async function recentProjects(ctx: Pick<IpcContext, "registry" | "tokens">): Promise<RecentProject[]> {
  const recent = await ctx.registry.recent.get();
  return Promise.all(
    recent.map(async (r) => {
      const present = await stat(r.path).then((s) => s.isFile()).catch(() => false);
      return {
        file: present ? await ctx.tokens.ref(r.path, projectKind(r.path)) : null,
        path: r.path,
        title: r.title,
        projectId: r.projectId,
        openedAt: r.openedAt,
        missing: !present,
      };
    }),
  );
}

function projectKind(path: string): FileRef["kind"] {
  return path.toLowerCase().endsWith(WEB_BACKUP_EXTENSION) ? "web-backup" : "project";
}
