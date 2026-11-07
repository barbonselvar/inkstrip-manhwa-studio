/**
 * The complete, typed surface between the Inkstrip desktop renderer and its Electron
 * main process. Shared by `apps/desktop/src` (main + preload) and `src/lib/desktop`
 * (renderer). Nothing here imports Electron, Node or the DOM.
 *
 * Security model: the renderer never names a filesystem path. Paths come only from
 * native dialogs, the recent-projects list, the command line or a linked project, and
 * the main process hands the renderer opaque `FileToken`s for them.
 */

export const DESKTOP_ORIGIN = "app://inkstrip";
/** Read-only stream of a file the user chose: `${DESKTOP_ORIGIN}${FILE_ROUTE}<token>`. */
export const FILE_ROUTE = "/__desktop/file/";

export const PROJECT_EXTENSION = ".inkstrip";
/** The website's portable project backup; the desktop app opens it as an import. */
export const WEB_BACKUP_EXTENSION = ".inkstrip-project";

export type FileToken = string;

export type FileRef = {
  token: FileToken;
  /** For display only: the main process never accepts it back. */
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
  kind: "project" | "web-backup" | "recovery" | "backup";
};

export type ProjectLink = {
  projectId: string;
  file: FileRef;
  /** Content fingerprint of the workspace copy written by the last successful save. */
  fingerprint: string;
  sha256: string;
  savedAt: number;
  /** File modification time recorded at that save/open: detects edits made elsewhere. */
  fileModifiedAt: number;
};

export type RecentProject = {
  file: FileRef | null;
  path: string;
  title: string;
  projectId: string | null;
  openedAt: number;
  missing: boolean;
};

export type RecoverySnapshot = {
  id: string;
  projectId: string;
  title: string;
  fingerprint: string;
  createdAt: number;
  size: number;
  linkedPath: string | null;
  file: FileRef;
};

export type WriteTarget =
  | { kind: "file"; token: FileToken }
  | { kind: "recovery"; projectId: string };

export type WriteCommit = {
  projectId: string;
  title: string;
  fingerprint: string;
};

export type SaveResult = {
  sha256: string;
  size: number;
  savedAt: number;
  link: ProjectLink | null;
  backupCreated: boolean;
};

export type DesktopSettings = {
  autosave: {
    enabled: boolean;
    /** 1–60 minutes between autosave snapshots of the open project. */
    intervalMinutes: number;
    /** Also write autosaves into the linked `.inkstrip` file (off: recovery snapshots only). */
    writeProjectFile: boolean;
  };
  backups: {
    /** Previous versions kept per project when a save replaces its file (0–50). */
    keep: number;
  };
  updates: {
    autoCheck: boolean;
    autoDownload: boolean;
  };
  ai: {
    /** Cloud AI (artwork leaves the device) is only used when this is on and a key exists. */
    cloudEnabled: boolean;
  };
  developer: {
    devTools: boolean;
  };
};

export type UpdateState =
  | { status: "disabled"; reason: string; canCheckManually: boolean }
  | { status: "idle"; lastCheckedAt: number | null }
  | { status: "checking" }
  | { status: "not-available"; lastCheckedAt: number }
  | { status: "available"; version: string; notes: string; releaseDate: string; pageUrl: string; installable: boolean }
  | {
      status: "downloading";
      version: string;
      notes: string;
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    }
  | { status: "downloaded"; version: string; notes: string; releaseDate: string }
  | { status: "error"; message: string; offline: boolean };

export type AppInfo = {
  name: string;
  version: string;
  packaged: boolean;
  signed: "valid" | "unsigned" | "invalid" | "unknown";
  electron: string;
  chrome: string;
  node: string;
  commit: string;
  locations: Record<"workspace" | "settings" | "recovery" | "backups" | "logs" | "models", string>;
  lastExitClean: boolean;
};

export type MenuCommand =
  | "new-project"
  | "open-project"
  | "save"
  | "save-as"
  | "import-backup"
  | "export-copy"
  | "revert"
  | "recovery"
  | "backups"
  | "settings"
  | "updates"
  | "about"
  | "zoom-in"
  | "zoom-out"
  | "zoom-fit"
  | "undo"
  | "redo"
  | "open-recent";

export type DownloadEvent = {
  id: string;
  name: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  received: number;
  total: number;
  path?: string;
};

export type CloseRequest = { id: string; reason: "close" | "update" };

/** `window.inkstripDesktop`, exposed by the preload script with `contextBridge`. */
export interface DesktopBridge {
  readonly isDesktop: true;
  info(): Promise<AppInfo>;
  // Project files
  openProjectDialog(): Promise<FileRef | null>;
  importBackupDialog(): Promise<FileRef | null>;
  saveProjectDialog(suggestedName: string): Promise<FileRef | null>;
  exportCopyDialog(suggestedName: string): Promise<FileRef | null>;
  beginWrite(target: WriteTarget, expectedSize: number): Promise<string>;
  writeChunk(session: string, chunk: Uint8Array): Promise<void>;
  commitWrite(session: string, commit: WriteCommit, link: boolean): Promise<SaveResult>;
  abortWrite(session: string): Promise<void>;
  getLink(projectId: string): Promise<ProjectLink | null>;
  listLinks(): Promise<ProjectLink[]>;
  unlink(projectId: string): Promise<void>;
  linkOpened(projectId: string, token: FileToken, fingerprint: string, title: string): Promise<ProjectLink>;
  recentProjects(): Promise<RecentProject[]>;
  removeRecent(path: string): Promise<void>;
  revealFile(token: FileToken): Promise<void>;
  /** A `.inkstrip` file dropped on the window (resolved in the preload, never a typed path). */
  tokenForDroppedFile(file: File): Promise<FileRef | null>;
  // Recovery and backups
  listRecovery(): Promise<RecoverySnapshot[]>;
  discardRecovery(id: string): Promise<void>;
  listBackups(projectId: string): Promise<FileRef[]>;
  openFolder(kind: "recovery" | "backups" | "logs" | "workspace"): Promise<void>;
  // Settings and secrets
  getSettings(): Promise<DesktopSettings>;
  setSettings(patch: DeepPartial<DesktopSettings>): Promise<DesktopSettings>;
  hasCloudKey(): Promise<boolean>;
  setCloudKey(key: string | null): Promise<boolean>;
  // Window
  setTitle(title: string, dirty: boolean): Promise<void>;
  setZoom(direction: "in" | "out" | "reset"): Promise<number>;
  openExternal(url: string): Promise<void>;
  // Updates
  updateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  cancelUpdateDownload(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  // Lifecycle
  closeReady(id: string, proceed: boolean): Promise<void>;
  rendererReady(): Promise<{ pendingOpen: FileRef | null }>;
  on<K extends keyof DesktopEvents>(event: K, listener: (payload: DesktopEvents[K]) => void): () => void;
}

export type DesktopEvents = {
  "menu-command": { command: MenuCommand; arg?: string };
  "open-file": FileRef;
  "update-state": UpdateState;
  download: DownloadEvent;
  "close-request": CloseRequest;
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const DEFAULT_SETTINGS: DesktopSettings = {
  autosave: { enabled: true, intervalMinutes: 3, writeProjectFile: false },
  backups: { keep: 10 },
  updates: { autoCheck: true, autoDownload: true },
  ai: { cloudEnabled: false },
  developer: { devTools: false },
};

/** Every `ipcRenderer.invoke` channel; the preload script and main both use this list. */
export const INVOKE_CHANNELS = [
  "app:info",
  "file:open-dialog",
  "file:import-dialog",
  "file:save-dialog",
  "file:export-dialog",
  "write:begin",
  "write:chunk",
  "write:commit",
  "write:abort",
  "link:get",
  "link:list",
  "link:remove",
  "link:opened",
  "recent:list",
  "recent:remove",
  "file:reveal",
  "file:dropped",
  "recovery:list",
  "recovery:discard",
  "backups:list",
  "folder:open",
  "settings:get",
  "settings:set",
  "secret:has",
  "secret:set",
  "window:title",
  "window:zoom",
  "shell:external",
  "update:state",
  "update:check",
  "update:download",
  "update:cancel",
  "update:install",
  "lifecycle:close-ready",
  "lifecycle:renderer-ready",
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = {
  "menu-command": "event:menu-command",
  "open-file": "event:open-file",
  "update-state": "event:update-state",
  download: "event:download",
  "close-request": "event:close-request",
} as const satisfies Record<keyof DesktopEvents, string>;

/** Largest single IPC write chunk (the renderer sends 8 MiB). */
export const MAX_WRITE_CHUNK = 16 * 1024 * 1024;
