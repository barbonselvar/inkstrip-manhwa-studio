import type { EditRecipe, RenderLimits } from "./geometry";
export type RenderReply = {
  type: string;
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  blob?: Blob;
};
export class ImageRenderer {
  private worker: Worker | null = null;
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve: (reply: RenderReply) => void;
      reject: (error: Error) => void;
      progress?: (done: number, total: number) => void;
    }
  >();
  constructor(private limits: RenderLimits) {}
  private request(
    type: "source" | "preview" | "save",
    values: { blob?: Blob; recipe?: EditRecipe; sourceView?: boolean },
    progress?: (done: number, total: number) => void,
  ) {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined")
      return Promise.reject(
        new Error(
          "This editor needs a current browser with Web Workers and OffscreenCanvas. Existing images are unchanged.",
        ),
      );
    if (!this.worker) {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = ({
        data,
      }: MessageEvent<
        RenderReply & { id: number; error?: string; done: number; total: number }
      >) => {
        const callback = this.pending.get(data.id);
        if (!callback) {
          data.bitmap?.close();
          return;
        }
        if (data.type === "progress") {
          callback.progress?.(data.done, data.total);
          return;
        }
        this.pending.delete(data.id);
        if (data.type === "cancelled") {
          callback.reject(new DOMException("Preview superseded.", "AbortError"));
          return;
        }
        if (data.type === "error") callback.reject(new Error(data.error));
        else callback.resolve(data);
      };
      this.worker.onerror = () =>
        this.dispose(
          new Error("The image worker stopped. Try a smaller image or a current browser."),
        );
    }
    const id = ++this.next;
    return new Promise<RenderReply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker!.postMessage({ id, type, limits: this.limits, ...values });
    });
  }
  source(blob: Blob) {
    this.dispose();
    return this.request("source", { blob });
  }
  preview(recipe: EditRecipe, sourceView = false) {
    return this.request("preview", { recipe, sourceView });
  }
  save(recipe: EditRecipe, progress?: (done: number, total: number) => void) {
    return this.request("save", { recipe }, progress);
  }
  dispose(reason: Error = new DOMException("Editing cancelled.", "AbortError")) {
    this.worker?.terminate();
    this.worker = null;
    for (const callback of this.pending.values()) callback.reject(reason);
    this.pending.clear();
  }
}
