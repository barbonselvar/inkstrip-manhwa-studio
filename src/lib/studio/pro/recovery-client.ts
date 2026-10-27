import { CheckpointQueue } from "./checkpoint-queue.ts";
import { validateCheckpointHeader, type CheckpointHeader } from "./recovery.ts";
import type { ProSession } from "./model.ts";
export type RecoveryStatus = {
  state: "idle" | "writing" | "available" | "failed";
  header?: CheckpointHeader;
  error?: string;
};
const states = new Map<string, RecoveryStatus>(),
  listeners = new Map<string, Set<(s: RecoveryStatus) => void>>();
function publish(panelId: string, status: RecoveryStatus) {
  states.set(panelId, status);
  for (const listen of listeners.get(panelId) ?? []) {
    try {
      listen(status);
    } catch {
      /* A detached UI subscriber cannot affect a durable primary save. */
    }
  }
}
function writeInWorker(session: ProSession): Promise<CheckpointHeader> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./recovery-worker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      reject(e);
      return;
    }
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) {
        const e = new Error(data.error);
        e.name = data.name ?? "Error";
        reject(e);
        return;
      }
      try {
        validateCheckpointHeader(data.header);
        resolve(data.header);
      } catch (e) {
        reject(e);
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(
        Error(
          "Recovery processing stopped. The primary draft remains saved; export a native backup.",
        ),
      );
    };
    try {
      worker.postMessage(session);
    } catch (e) {
      worker.terminate();
      reject(e);
    }
  });
}
const queue = new CheckpointQueue(writeInWorker, (session, result, more) => {
  const previous = states.get(session.document.panelId);
  if ("value" in result)
    publish(session.document.panelId, {
      state: more ? "writing" : "available",
      header: result.value,
    });
  else
    publish(session.document.panelId, {
      state: more ? "writing" : "failed",
      header: previous?.header,
      error:
        result.error instanceof Error
          ? result.error.message
          : "Recovery checkpoint could not be stored.",
    });
});
/** Primary save success never depends on checkpoint availability. */
export function checkpointAfterConfirmedSave(session: ProSession) {
  const previous = states.get(session.document.panelId);
  publish(session.document.panelId, { ...previous, state: "writing", error: undefined });
  try {
    queue.enqueue(session);
  } catch (e) {
    publish(session.document.panelId, {
      ...previous,
      state: "failed",
      error: (e as Error).message,
    });
  }
}
export const flushCheckpoints = () => queue.flush();
export function subscribeRecovery(panelId: string, listener: (s: RecoveryStatus) => void) {
  const set = listeners.get(panelId) ?? new Set();
  set.add(listener);
  listeners.set(panelId, set);
  listener(states.get(panelId) ?? { state: "idle" });
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(panelId);
  };
}
