/**
 * Native application menu. Accelerators are displayed but not registered
 * (`registerAccelerator: false`) so every key press still reaches the page: the
 * existing editors keep their own Ctrl+S / Ctrl+Z / Ctrl+Y handling, and the
 * renderer's desktop shell adds the file commands on top without conflicts.
 */
import { Menu, type BrowserWindow, type MenuItemConstructorOptions, type WebContents } from "electron";
import type { MenuCommand, RecentProject } from "../../../../src/lib/desktop/contract.ts";

export function buildMenu(options: {
  window: () => BrowserWindow | null;
  send: (command: MenuCommand, arg?: string) => void;
  recent: RecentProject[];
  devTools: boolean;
  /** The studio view (developer Reload / DevTools act on it, not the title bar). */
  studio: () => WebContents | null;
}) {
  const cmd = (label: string, command: MenuCommand, accelerator?: string, arg?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => options.send(command, arg),
  });
  const recent: MenuItemConstructorOptions[] = options.recent.length
    ? [
        ...options.recent.slice(0, 10).map((r, i) =>
          cmd(`${i < 9 ? `&${i + 1} ` : ""}${(r.title || r.path).replace(/&/g, "&&")}${r.missing ? " (missing)" : ""}`, "open-recent", undefined, r.path),
        ),
      ]
    : [{ label: "No recent projects", enabled: false }];

  const template: MenuItemConstructorOptions[] = [
    {
      label: "&File",
      submenu: [
        cmd("&New Project", "new-project", "Ctrl+N"),
        cmd("&Open Project…", "open-project", "Ctrl+O"),
        { label: "Open &Recent", submenu: recent },
        { type: "separator" },
        cmd("&Save", "save", "Ctrl+S"),
        cmd("Save &As…", "save-as", "Ctrl+Shift+S"),
        cmd("&Export a Copy…", "export-copy"),
        cmd("Re&vert to Saved File…", "revert"),
        { type: "separator" },
        cmd("&Import Website Backup…", "import-backup"),
        cmd("Recover &Autosaved Work…", "recovery"),
        cmd("Project &Backups…", "backups"),
        { type: "separator" },
        cmd("Se&ttings…", "settings", "Ctrl+,"),
        { type: "separator" },
        { label: "E&xit", accelerator: "Alt+F4", registerAccelerator: false, click: () => options.window()?.close() },
      ],
    },
    {
      label: "&Edit",
      submenu: [
        cmd("&Undo", "undo", "Ctrl+Z"),
        cmd("&Redo", "redo", "Ctrl+Y"),
        { type: "separator" },
        { role: "cut", registerAccelerator: false },
        { role: "copy", registerAccelerator: false },
        { role: "paste", registerAccelerator: false },
        { role: "selectAll", registerAccelerator: false },
      ],
    },
    {
      label: "&View",
      submenu: [
        cmd("Zoom &In", "zoom-in", "Ctrl+Plus"),
        cmd("Zoom &Out", "zoom-out", "Ctrl+-"),
        cmd("&Fit to Screen", "zoom-fit", "Ctrl+0"),
        { type: "separator" },
        cmd("&Command Palette…", "command-palette", "Ctrl+Shift+P"),
        cmd("&Window Appearance…", "window-appearance"),
        cmd("Toggle F&ull Screen", "toggle-fullscreen", "F11"),
        ...(options.devTools
          ? ([
              { type: "separator" },
              { label: "Reload Studio", click: () => options.studio()?.reload() },
              { label: "Toggle Developer Tools", click: () => options.studio()?.toggleDevTools() },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: "&Help",
      submenu: [
        cmd("Check for &Updates…", "updates"),
        { type: "separator" },
        cmd("&About Inkstrip Manhwa Studio", "about"),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
