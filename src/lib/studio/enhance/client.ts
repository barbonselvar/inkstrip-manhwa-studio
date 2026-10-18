import type { EnhanceOptions, EnhanceProgress, EnhanceResult, WorkerReply } from "./types";

export class EnhancementEngine {
  private worker: Worker | null = null;
  private reject: ((error: Error) => void) | null = null;

  run(blob: Blob, options: EnhanceOptions, onProgress: (progress: EnhanceProgress) => void) {
    if (this.reject) return Promise.reject(new Error("Enhancement is already running."));
    this.worker ??= new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    return new Promise<EnhanceResult>((resolve, reject) => {
      this.reject = reject;
      this.worker!.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
        if (data.type === "progress") onProgress(data.progress);
        else {
          this.reject = null;
          if (data.type === "result") resolve(data.result);
          else reject(new Error(data.error));
        }
      };
      this.worker!.onerror = () => {
        this.reject = null;
        reject(
          new Error("The AI worker could not start. Check your connection or try a smaller image."),
        );
        this.dispose();
      };
      this.worker!.postMessage({ blob, options });
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.reject?.(
      new DOMException("Enhancement cancelled. Originals are unchanged.", "AbortError"),
    );
    this.reject = null;
  }
}
