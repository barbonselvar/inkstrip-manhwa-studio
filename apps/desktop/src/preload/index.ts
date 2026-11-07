/**
 * Sandboxed preload: exposes `window.inkstripDesktop` — a fixed list of typed calls and
 * event subscriptions. No Node, no `ipcRenderer`, no paths are exposed to the page.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type DesktopBridge,
  type DesktopEvents,
  type InvokeChannel,
} from "../../../../src/lib/desktop/contract.ts";

const allowed = new Set<string>(INVOKE_CHANNELS);
const call = <T>(channel: InvokeChannel, ...args: unknown[]): Promise<T> => {
  if (!allowed.has(channel)) return Promise.reject(new Error("Unknown request."));
  // Show users the main process's message, not Electron's IPC wrapper text.
  return (ipcRenderer.invoke(channel, ...args) as Promise<T>).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ""));
  });
};

const bridge: DesktopBridge = {
  isDesktop: true,
  info: () => call("app:info"),
  openProjectDialog: () => call("file:open-dialog"),
  importBackupDialog: () => call("file:import-dialog"),
  saveProjectDialog: (name) => call("file:save-dialog", name),
  exportCopyDialog: (name) => call("file:export-dialog", name),
  beginWrite: (target, size) => call("write:begin", target, size),
  writeChunk: (session, chunk) => call("write:chunk", session, chunk),
  commitWrite: (session, commit, link) => call("write:commit", session, commit, link),
  abortWrite: (session) => call("write:abort", session),
  getLink: (projectId) => call("link:get", projectId),
  listLinks: () => call("link:list"),
  unlink: (projectId) => call("link:remove", projectId),
  linkOpened: (projectId, token, fingerprint, title) => call("link:opened", projectId, token, fingerprint, title),
  recentProjects: () => call("recent:list"),
  removeRecent: (path) => call("recent:remove", path),
  revealFile: (token) => call("file:reveal", token),
  tokenForDroppedFile: (file) => {
    let path = "";
    try {
      path = webUtils.getPathForFile(file);
    } catch {
      return Promise.resolve(null);
    }
    return path ? call("file:dropped", path) : Promise.resolve(null);
  },
  listRecovery: () => call("recovery:list"),
  discardRecovery: (id) => call("recovery:discard", id),
  listBackups: (projectId) => call("backups:list", projectId),
  openFolder: (kind) => call("folder:open", kind),
  getSettings: () => call("settings:get"),
  setSettings: (patch) => call("settings:set", patch),
  hasCloudKey: () => call("secret:has"),
  setCloudKey: (key) => call("secret:set", key),
  setTitle: (title, dirty) => call("window:title", title, dirty),
  setZoom: (direction) => call("window:zoom", direction),
  openExternal: (url) => call("shell:external", url),
  updateState: () => call("update:state"),
  checkForUpdates: () => call("update:check"),
  downloadUpdate: () => call("update:download"),
  cancelUpdateDownload: () => call("update:cancel"),
  installUpdate: () => call("update:install"),
  closeReady: (id, proceed) => call("lifecycle:close-ready", id, proceed),
  rendererReady: () => call("lifecycle:renderer-ready"),
  on: <K extends keyof DesktopEvents>(event: K, listener: (payload: DesktopEvents[K]) => void) => {
    const channel = EVENT_CHANNELS[event];
    if (!channel) throw new Error("Unknown event.");
    const wrapped = (_event: Electron.IpcRendererEvent, payload: DesktopEvents[K]) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("inkstripDesktop", bridge);
