import {
  validateEnhanceOptions,
  type EnhanceOptions,
  type EnhanceProgress,
  type EnhanceResult,
  type WorkerReply,
} from "./types.ts";

export class EnhancementEngine {
  private worker: Worker | null = null;
  private generation = 0;
  private reject: ((error: Error) => void) | null = null;

  run(blob: Blob, options: EnhanceOptions, onProgress: (progress: EnhanceProgress) => void) {
    if (this.reject) return Promise.reject(new Error("Enhancement is already running."));
    try {
      validateEnhanceOptions(options);
    } catch (error) {
      return Promise.reject(error);
    }
    this.worker ??= new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const worker = this.worker,
      generation = ++this.generation;
    return new Promise<EnhanceResult>((resolve, reject) => {
      this.reject = reject;
      worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
        if (this.worker !== worker || generation !== this.generation) return;
        if (data.type === "progress") onProgress(data.progress);
        else {
          this.reject = null;
          if (data.type === "result") resolve(data.result);
          else reject(new Error(data.error));
        }
      };
      worker.onerror = () => {
        if (this.worker !== worker || generation !== this.generation) return;
        this.reject = null;
        reject(
          new Error("The AI worker could not start. Check your connection or try a smaller image."),
        );
        this.dispose();
      };
      try {
        worker.postMessage({ blob, options });
      } catch (error) {
        this.reject = null;
        reject(error);
        this.dispose();
      }
    });
  }

  dispose() {
    this.generation++;
    this.worker?.terminate();
    this.worker = null;
    this.reject?.(
      new DOMException("Enhancement cancelled. Originals are unchanged.", "AbortError"),
    );
    this.reject = null;
  }
}
