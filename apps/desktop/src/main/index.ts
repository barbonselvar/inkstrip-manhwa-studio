/**
 * Inkstrip Manhwa Studio — Electron main process.
 *
 * Loads the bundled studio from app://inkstrip (no website, no dev server), keeps a
 * single locked-down window, and provides native project files, autosave/recovery
 * storage, exports, settings and owner-approved updates through a minimal preload API.
 */
import { app, BrowserWindow, crashReporter, dialog, Menu, screen, session, shell } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_SETTINGS,
  DESKTOP_ORIGIN,
  EVENT_CHANNELS,
  PROJECT_EXTENSION,
  WEB_BACKUP_EXTENSION,
  type AppInfo,
  type DesktopEvents,
  type DesktopSettings,
  type FileRef,
  type MenuCommand,
} from "../../../../src/lib/desktop/contract.ts";
import { configurePaths } from "./app-paths.ts";
import { FileTokens } from "./file-tokens.ts";
import { recentProjects, registerIpc } from "./ipc.ts";
import { JsonDocument, readJson, writeJson } from "./json-store.ts";
import { initLog, log } from "./logger.ts";
import { buildMenu } from "./menu.ts";
import { sweepTemporaryFiles } from "./project-files.ts";
import { HOST, installProtocol, registerSchemePrivileges, SCHEME } from "./protocol.ts";
import { ProjectRegistry } from "./registry.ts";
import { Secrets } from "./secrets.ts";
import { sanitizeSettings } from "./settings.ts";
import { executableSignature, UpdateService } from "./updater.ts";

declare const __INKSTRIP_COMMIT__: string;

const START_URL = `${SCHEME}://${HOST}/`;
const ALLOWED_PERMISSIONS = new Set([
  "clipboard-sanitized-write",
  "clipboard-read",
  "fullscreen",
  "persistent-storage",
  "pointerLock",
]);
/** Remote hosts the app may reach at all (optional AI/OCR downloads, updates, cloud AI). */
const ALLOWED_REMOTE = [
  /^https:\/\/(?:[a-z0-9-]+\.)*huggingface\.co\//,
  /^https:\/\/(?:[a-z0-9-]+\.)*hf\.co\//,
  /^https:\/\/raw\.githubusercontent\.com\/tesseract-ocr\//,
  /^https:\/\/api\.github\.com\/repos\/barbonselvar\/inkstrip-manhwa-studio\//,
  /^https:\/\/github\.com\/barbonselvar\/inkstrip-manhwa-studio\/releases\//,
  /^https:\/\/(?:objects|release-assets)\.githubusercontent\.com\//,
  /^https:\/\/api\.openai\.com\/v1\/images\/edits$/,
];

registerSchemePrivileges();
const paths = configurePaths();
initLog(paths.logs);
crashReporter.start({ uploadToServer: false });
app.setAppUserModelId("app.inkstrip.studio");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void main();
}

function projectArg(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("-")) continue;
    const lower = arg.toLowerCase();
    if ((lower.endsWith(PROJECT_EXTENSION) || lower.endsWith(WEB_BACKUP_EXTENSION)) && existsSync(arg))
      return resolve(arg);
  }
  return null;
}

async function main() {
  const tokens = new FileTokens();
  const registry = new ProjectRegistry(paths.metadata, paths.recovery);
  const settings = new JsonDocument<DesktopSettings>(
    join(paths.settings, "settings.json"),
    () => DEFAULT_SETTINGS,
    (v) => sanitizeSettings(v),
  );
  const secrets = new Secrets(paths.settings);
  const sessionFile = join(paths.metadata, "session.json");
  const previous = await readJson(sessionFile, { clean: true }, (v) => ({
    clean: (v as { clean?: unknown })?.clean !== false,
  }));
  await writeJson(sessionFile, { clean: false, startedAt: Date.now(), version: app.getVersion() });
  const lastDirectory = { value: "" };
  const signature = executableSignature();

  let win: BrowserWindow | null = null;
  let pendingOpen: string | null = projectArg(process.argv);
  let allowClose = false;
  let closeWaiter: { id: string; resolve: (proceed: boolean) => void } | null = null;
  let rendererLoaded = false;

  const send = <K extends keyof DesktopEvents>(event: K, payload: DesktopEvents[K]) => {
    if (win && !win.isDestroyed()) win.webContents.send(EVENT_CHANNELS[event], payload);
  };

  const updates = new UpdateService({
    settings: () => settings.get(),
    emit: (state) => send("update-state", state),
    signature,
  });

  const refreshMenu = () =>
    void (async () => {
      const recent = await recentProjects({ registry, tokens }).catch(() => []);
      const s = await settings.get();
      Menu.setApplicationMenu(
        buildMenu({
          window: () => win,
          send: (command: MenuCommand, arg?: string) => void menuCommand(command, arg),
          recent,
          devTools: !app.isPackaged || s.developer.devTools,
        }),
      );
    })();

  const menuCommand = async (command: MenuCommand, arg?: string) => {
    if (!win) return;
    if (command === "undo" || command === "redo") {
      // Same path as the keyboard, so each editor's own history handles it.
      const keyCode = command === "undo" ? "Z" : "Y";
      win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers: ["control"] });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers: ["control"] });
      return;
    }
    if (command === "open-recent" && arg) {
      if (!existsSync(arg)) {
        await dialog.showMessageBox(win, {
          type: "warning",
          message: "This project file was moved or deleted.",
          detail: arg,
        });
        await registry.removeRecent(arg);
        refreshMenu();
        return;
      }
      const lower = arg.toLowerCase();
      send("open-file", await tokens.ref(arg, lower.endsWith(WEB_BACKUP_EXTENSION) ? "web-backup" : "project"));
      return;
    }
    send("menu-command", { command, arg });
  };

  const info = async (): Promise<AppInfo> => ({
    name: "Inkstrip Manhwa Studio",
    version: app.getVersion(),
    packaged: app.isPackaged,
    signed: await signature,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    commit: typeof __INKSTRIP_COMMIT__ === "string" ? __INKSTRIP_COMMIT__ : "unknown",
    locations: {
      workspace: paths.workspace,
      settings: paths.settings,
      recovery: paths.recovery,
      backups: paths.backups,
      logs: paths.logs,
      models: paths.models,
    },
    lastExitClean: previous.clean,
  });

  registerIpc({
    window: () => win,
    paths,
    tokens,
    registry,
    settings,
    secrets,
    updates,
    info,
    lastDirectory,
    refreshMenu,
    closeReady: (id, proceed) => {
      if (closeWaiter?.id === id) closeWaiter.resolve(proceed);
    },
    rendererReady: async () => {
      rendererLoaded = true;
      const path = pendingOpen;
      pendingOpen = null;
      if (!path) return null;
      return tokens.ref(path, path.toLowerCase().endsWith(WEB_BACKUP_EXTENSION) ? "web-backup" : "project");
    },
    allowQuitForUpdate: () => {
      allowClose = true;
    },
  });

  app.on("second-instance", (_event, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const path = projectArg(argv);
    if (path)
      void tokens
        .ref(path, path.toLowerCase().endsWith(WEB_BACKUP_EXTENSION) ? "web-backup" : "project")
        .then((ref: FileRef) => send("open-file", ref));
  });

  // Ask the page to flush editors and resolve unsaved work before the window closes.
  const requestClose = async (): Promise<boolean> => {
    if (!win || !rendererLoaded) return true;
    if (closeWaiter) return false;
    const id = randomBytes(8).toString("hex");
    const answer = new Promise<boolean>((resolveAnswer) => {
      closeWaiter = { id, resolve: resolveAnswer };
    });
    send("close-request", { id, reason: "close" });
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 45_000));
    let result = await Promise.race([answer, timeout]);
    if (result === "timeout" && win && !win.isDestroyed()) {
      const choice = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Keep Waiting", "Close Anyway"],
        defaultId: 0,
        cancelId: 0,
        message: "Inkstrip is still finishing a save.",
        detail:
          "Closing now may lose the last few seconds of editing. Everything already saved in your workspace is safe.",
      });
      result = choice.response === 1 ? true : await answer;
    }
    closeWaiter = null;
    return result === true;
  };

  await app.whenReady();
  await sweepTemporaryFiles(paths.recovery);

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(ALLOWED_PERMISSIONS.has(permission) && (details.requestingUrl ?? "").startsWith(`${DESKTOP_ORIGIN}/`)),
  );
  ses.setPermissionCheckHandler((_wc, permission, origin) =>
    ALLOWED_PERMISSIONS.has(permission) && `${origin}`.startsWith(DESKTOP_ORIGIN),
  );
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    if (/^(app|blob|data|devtools|chrome-extension):/.test(url)) return callback({});
    if (ALLOWED_REMOTE.some((re) => re.test(url))) return callback({});
    log.warn("[network] blocked", url.slice(0, 200));
    callback({ cancel: true });
  });
  ses.on("will-download", (_event, item) => {
    const id = randomBytes(6).toString("hex");
    const name = item.getFilename();
    const folder = lastDirectory.value || join(app.getPath("pictures"), "Inkstrip");
    item.setSaveDialogOptions({ title: "Save Export", defaultPath: join(folder, name) });
    const report = (state: DesktopEvents["download"]["state"]) =>
      send("download", {
        id,
        name,
        state,
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
        path: item.getSavePath() || undefined,
      });
    item.on("updated", (_e, state) => report(state === "interrupted" ? "interrupted" : "progressing"));
    item.once("done", (_e, state) => {
      if (state === "completed" && item.getSavePath()) lastDirectory.value = join(item.getSavePath(), "..");
      report(state);
    });
  });

  await installProtocol({
    rendererRoot: join(app.getAppPath(), "build", "renderer"),
    tokens,
    cloudAi: async () => ({ enabled: (await settings.get()).ai.cloudEnabled, key: await secrets.get() }),
  });

  const windowState = new JsonDocument(
    join(paths.settings, "window-state.json"),
    () => ({ width: 1440, height: 900, maximized: true }) as WindowState,
    sanitizeWindowState,
  );
  const state = visibleBounds(await windowState.get());
  win = new BrowserWindow({
    ...state,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Inkstrip Manhwa Studio",
    backgroundColor: "#0e0e10",
    icon: join(app.getAppPath(), "build", "icon.ico"),
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(app.getAppPath(), "build", "preload", "index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged || (await settings.get()).developer.devTools,
    },
  });
  if (state.maximized) win.maximize();
  refreshMenu();

  const contents = win.webContents;
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${DESKTOP_ORIGIN}/`)) {
      event.preventDefault();
      if (url.startsWith("https://")) void shell.openExternal(url);
    }
  });
  contents.on("will-redirect", (event, url) => {
    if (!url.startsWith(`${DESKTOP_ORIGIN}/`)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("render-process-gone", async (_event, details) => {
    log.error("[renderer] gone", details);
    if (details.reason === "clean-exit" || !win || win.isDestroyed()) return;
    rendererLoaded = false;
    const choice = await dialog.showMessageBox(win, {
      type: "error",
      buttons: ["Reload Inkstrip", "Quit"],
      defaultId: 0,
      message: "The editor stopped unexpectedly.",
      detail: `Reason: ${details.reason}. Work that was saved in your workspace is intact, and open editors keep autosaved drafts.`,
    });
    if (choice.response === 0) void win.loadURL(START_URL);
    else {
      allowClose = true;
      app.quit();
    }
  });
  contents.on("unresponsive", async () => {
    if (!win) return;
    const choice = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Keep Waiting", "Reload"],
      defaultId: 0,
      message: "Inkstrip is busy.",
      detail: "A large operation may still be running. Reloading discards only unsaved changes from the last few seconds.",
    });
    if (choice.response === 1) contents.reload();
  });
  // Editors guard beforeunload while a save is in flight; never discard silently.
  contents.on("will-prevent-unload", async (event) => {
    if (!win) return;
    const choice = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["Stay", "Leave"],
      defaultId: 0,
      cancelId: 0,
      message: "An editor is still saving changes.",
    });
    if (choice.response === 1) event.preventDefault();
  });

  win.once("ready-to-show", () => win?.show());
  const saveWindow = () => {
    if (!win || win.isDestroyed()) return;
    try {
      // Synchronous: the app may exit right after the window closes.
      writeFileSync(windowState.path, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch {
      /* window position is a convenience */
    }
  };
  win.on("close", (event) => {
    saveWindow();
    if (allowClose) return;
    event.preventDefault();
    void requestClose().then((ok) => {
      if (!ok || !win) return;
      allowClose = true;
      win.close();
    });
  });
  win.on("closed", () => {
    win = null;
  });

  await win.loadURL(START_URL);
  await updates.init();

  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    updates.dispose();
    try {
      // Synchronous best effort: mark a clean exit for the next launch's recovery check.
      writeFileSync(sessionFile, JSON.stringify({ clean: true, endedAt: Date.now() }));
    } catch {
      /* next launch will offer recovery */
    }
  });
  log.info(`Inkstrip ${app.getVersion()} started (Electron ${process.versions.electron})`);
}

type WindowState = { x?: number; y?: number; width: number; height: number; maximized: boolean };

function sanitizeWindowState(v: unknown): WindowState {
  const o = (v ?? {}) as Record<string, unknown>;
  const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : d);
  return {
    x: typeof o.x === "number" ? n(o.x, 0) : undefined,
    y: typeof o.y === "number" ? n(o.y, 0) : undefined,
    width: Math.max(960, n(o.width, 1440)),
    height: Math.max(600, n(o.height, 900)),
    maximized: o.maximized !== false,
  };
}

/** Never restore a window onto a monitor that is no longer connected. */
function visibleBounds(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return { width: state.width, height: state.height, maximized: state.maximized };
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    const x = state.x!,
      y = state.y!;
    return x + 100 > a.x && y + 50 > a.y && x < a.x + a.width - 100 && y < a.y + a.height - 50;
  });
  return visible ? state : { width: state.width, height: state.height, maximized: state.maximized };
}

