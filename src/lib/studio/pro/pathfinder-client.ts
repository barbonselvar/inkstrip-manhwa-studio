import type { ProDocument } from "./model";
import type { PathfinderOperation, PathfinderOptions, PathfinderResult } from "./pathfinder";
/** Each bounded transaction owns its worker. Cancellation never interrupts image rendering. */
export class PathfinderJob {
  private worker: Worker;
  private reject: ((error: Error) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly result: Promise<PathfinderResult>;
  constructor(
    document: ProDocument,
    ids: string[],
    operation: PathfinderOperation,
    options: PathfinderOptions,
  ) {
    this.worker = new Worker(new URL("./pathfinder-worker.ts", import.meta.url), {
      type: "module",
    });
    this.result = new Promise((resolve, reject) => {
      this.reject = reject;
      this.worker.onmessage = ({ data }) => {
        this.stop();
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      this.worker.onerror = () => {
        this.stop();
        reject(new Error("The geometry worker stopped. Source objects retained."));
      };
      this.timer = setTimeout(() => {
        this.stop();
        reject(
          new Error(
            "Pathfinder exceeded its 12-second time budget. Use fewer objects or a coarser tolerance. Sources retained.",
          ),
        );
      }, 12000);
      try {
        this.worker.postMessage({ document, ids, operation, options });
      } catch (error) {
        this.stop();
        reject(error);
      }
    });
  }
  private stop() {
    if (this.timer) clearTimeout(this.timer);
    this.worker.terminate();
    this.reject = undefined;
  }
  cancel() {
    const reject = this.reject;
    this.stop();
    reject?.(new DOMException("Pathfinder cancelled. Source objects retained.", "AbortError"));
  }
}
