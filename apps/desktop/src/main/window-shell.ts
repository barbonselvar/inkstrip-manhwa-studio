/**
 * The Inkstrip window: one native, resizable Windows frame whose title bar is drawn by a
 * small dedicated page, with the studio in its own view below it.
 *
 *   BrowserWindow (frame kept: native resize edges, Snap, rounded corners, shadow)
 *   ├─ own webContents  → app://inkstrip/__shell/titlebar.html   (title bar, drag region)
 *   ├─ Window Controls Overlay → native minimize / maximize (+ Snap layouts) / close
 *   └─ WebContentsView  → app://inkstrip/                          (the studio, unchanged)
 *
 * Keeping the studio in its own view means none of its full-height layouts, canvases,
 * shortcuts or drag-and-drop are affected by the title bar. All five designs share this
 * shell; switching design only changes colors, height, Mica and the border accent, live.
 */
import { BrowserWindow, Menu, WebContentsView, type Rectangle } from "electron";
import { release } from "node:os";
import {
  DEFAULT_GX_ACCENT,
  EVENT_CHANNELS,
  SHELL_CHANNELS,
  WINDOW_DESIGNS,
  type DesktopSettings,
  type WindowDesign,
  type WindowState,
  type WindowStatus,
} from "../../../../src/lib/desktop/contract.ts";

type Look = {
  background: string;
  overlay: string;
  symbol: string;
  accent: string | boolean;
  mica: boolean;
};

/** Mica needs Windows 11 22H2 (build 22621) or later. */
export const micaSupported = () => {
  if (process.platform !== "win32") return false;
  const build = Number(release().split(".")[2] ?? 0);
  return build >= 22621;
};

export function lookFor(design: WindowDesign, accent: string, mica: boolean): Look {
  switch (design) {
    case "win11":
      return mica
        ? { background: "#00000000", overlay: "#00000000", symbol: "#ffffff", accent: true, mica: true }
        : { background: "#202020", overlay: "#202020", symbol: "#ffffff", accent: true, mica: false };
    case "gx":
      return { background: "#100d16", overlay: "#100d16", symbol: "#ece8f5", accent, mica: false };
    case "vscode":
      return { background: "#1f1f1f", overlay: "#1f1f1f", symbol: "#cccccc", accent: "#2b2b2b", mica: false };
    case "minimal":
      return { background: "#0b0e10", overlay: "#0b0e10", symbol: "#acb8b7", accent: false, mica: false };
    default:
      return { background: "#0b0e10", overlay: "#0b0e10", symbol: "#eff3f1", accent: "#1f4a40", mica: false };
  }
}

export const heightFor = (design: WindowDesign) => WINDOW_DESIGNS.find((d) => d.id === design)?.height ?? 40;

const MENUS = { file: 0, edit: 1, view: 2, help: 3 } as const;

export class WindowShell {
  readonly win: BrowserWindow;
  readonly studio: WebContentsView;
  private design: WindowDesign;
  private accent: string;
  private readonly mica = micaSupported();
  private status: WindowStatus | null = null;
  private menuRects: Record<string, { x: number; y: number; height: number }> = {};

  constructor(options: {
    bounds: Partial<Rectangle> & { width: number; height: number };
    window: DesktopSettings["window"];
    shellPreload: string;
    studioPreload: string;
    icon: string;
    devTools: boolean;
  }) {
    this.design = options.window.design;
    this.accent = options.window.accent || DEFAULT_GX_ACCENT;
    const look = lookFor(this.design, this.accent, this.mica);
    const secure = {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: options.devTools,
    };
    this.win = new BrowserWindow({
      ...options.bounds,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: "Inkstrip Manhwa Studio",
      icon: options.icon,
      backgroundColor: look.background,
      titleBarStyle: "hidden",
      titleBarOverlay: { color: look.overlay, symbolColor: look.symbol, height: heightFor(this.design) },
      ...(look.mica ? { backgroundMaterial: "mica" as const } : {}),
      accentColor: look.accent,
      webPreferences: { ...secure, preload: options.shellPreload },
    });
    this.studio = new WebContentsView({ webPreferences: { ...secure, preload: options.studioPreload } });
    this.studio.setBackgroundColor("#0b0e10");
    this.win.contentView.addChildView(this.studio);
    this.layout();
    // Lay out immediately, then once more after Windows finishes the transition
    // (maximize/restore/full screen report intermediate sizes on the first event).
    let settle: NodeJS.Timeout | null = null;
    const relayout = () => {
      this.layout();
      this.sendState();
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        this.layout();
        this.sendState();
      }, 120);
    };
    for (const event of ["resize", "resized", "maximize", "unmaximize", "restore", "enter-full-screen", "leave-full-screen", "show", "ready-to-show"] as const)
      this.win.on(event as "resize", relayout);
    this.win.on("focus", () => {
      this.sendState();
      // Keyboard input belongs to the studio, not the title bar.
      if (!this.studio.webContents.isDestroyed()) this.studio.webContents.focus();
    });
    this.win.on("blur", () => this.sendState());
  }

  get state(): WindowState {
    return {
      design: this.design,
      accent: this.accent,
      maximized: !this.win.isDestroyed() && this.win.isMaximized(),
      fullscreen: !this.win.isDestroyed() && this.win.isFullScreen(),
      focused: !this.win.isDestroyed() && this.win.isFocused(),
      mica: lookFor(this.design, this.accent, this.mica).mica,
    };
  }

  get windowStatus() {
    return this.status;
  }

  get micaAvailable() {
    return this.mica;
  }

  /** The studio fills everything below the title bar (all of it in full screen). */
  layout() {
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    const top = this.win.isFullScreen() ? 0 : heightFor(this.design);
    this.studio.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
  }

  /** Switch design live: overlay colors/height, material, border accent, layout. */
  apply(window: DesktopSettings["window"]) {
    this.design = window.design;
    this.accent = window.accent || DEFAULT_GX_ACCENT;
    const look = lookFor(this.design, this.accent, this.mica);
    if (this.win.isDestroyed()) return;
    this.win.setBackgroundColor(look.background);
    if (this.mica) this.win.setBackgroundMaterial(look.mica ? "mica" : "none");
    this.win.setTitleBarOverlay({ color: look.overlay, symbolColor: look.symbol, height: heightFor(this.design) });
    try {
      this.win.setAccentColor(look.accent);
    } catch {
      /* not supported on this Windows version */
    }
    this.layout();
    this.sendState();
  }

  setStatus(status: WindowStatus) {
    this.status = status;
    if (!this.win.isDestroyed()) this.win.webContents.send(SHELL_CHANNELS.status, status);
  }

  setMenuRects(rects: Record<string, { x: number; y: number; height: number }>) {
    this.menuRects = rects;
  }

  sendState() {
    if (this.win.isDestroyed()) return;
    const state = this.state;
    this.win.webContents.send(SHELL_CHANNELS.state, state);
    if (!this.studio.webContents.isDestroyed()) this.studio.webContents.send(EVENT_CHANNELS["window-state"], state);
  }

  /** Open a real native menu under its title-bar button; focus returns to the studio. */
  popupMenu(name: "file" | "edit" | "view" | "help" | "all", at?: { x: number; y: number; height: number }) {
    const app = Menu.getApplicationMenu();
    if (!app || this.win.isDestroyed()) return;
    const rect = at ?? this.menuRects[name] ?? { x: 8, y: 0, height: heightFor(this.design) };
    const menu = name === "all" ? app : app.items[MENUS[name]]?.submenu;
    if (!menu) return;
    menu.popup({
      window: this.win,
      x: Math.round(rect.x),
      y: Math.round(rect.y + rect.height),
      callback: () => {
        if (!this.studio.webContents.isDestroyed()) this.studio.webContents.focus();
      },
    });
  }

  toggleFullScreen() {
    if (!this.win.isDestroyed()) this.win.setFullScreen(!this.win.isFullScreen());
  }
}
