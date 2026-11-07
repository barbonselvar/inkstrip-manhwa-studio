/**
 * Preload for the title-bar page only: `window.inkstripShell` can open native menus,
 * forward menu commands to the studio and receive window state/status. It has no file,
 * settings or update access.
 */
import { contextBridge, ipcRenderer } from "electron";
import { SHELL_CHANNELS, type ShellBridge, type WindowState, type WindowStatus } from "../../../../src/lib/desktop/contract.ts";

const listen = <T>(channel: string, listener: (value: T) => void) => {
  const wrapped = (_e: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
};

const bridge: ShellBridge = {
  ready: () => ipcRenderer.invoke(SHELL_CHANNELS.ready),
  menu: (name, rect) => ipcRenderer.invoke(SHELL_CHANNELS.menu, name, rect),
  command: (command) => ipcRenderer.invoke(SHELL_CHANNELS.command, command),
  reportMenus: (rects) => ipcRenderer.invoke(SHELL_CHANNELS.reportMenus, rects),
  onState: (listener) => listen<WindowState>(SHELL_CHANNELS.state, listener),
  onStatus: (listener) => listen<WindowStatus>(SHELL_CHANNELS.status, listener),
};

contextBridge.exposeInMainWorld("inkstripShell", bridge);
