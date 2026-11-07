import type { DesktopBridge } from "./contract";

declare global {
  interface Window {
    /** Present only inside the Inkstrip Windows app (exposed by its preload script). */
    inkstripDesktop?: DesktopBridge;
  }
}

/** The desktop bridge, or null in a normal browser (the website is unaffected). */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.inkstripDesktop;
  return bridge && bridge.isDesktop === true ? bridge : null;
}

export const isDesktopApp = () => desktopBridge() !== null;

/** Components that must save before a file save, quit or update register here. */
const flushers = new Set<() => Promise<unknown>>();

export function registerEditorFlush(flush: () => Promise<unknown>) {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

/** Write every open editor's pending changes into the workspace (IndexedDB). */
export async function flushEditors() {
  const failures: unknown[] = [];
  await Promise.all(
    [...flushers].map((flush) =>
      flush().catch((error) => {
        failures.push(error);
      }),
    ),
  );
  if (failures.length) throw failures[0];
}

export const hasOpenEditors = () => flushers.size > 0;
