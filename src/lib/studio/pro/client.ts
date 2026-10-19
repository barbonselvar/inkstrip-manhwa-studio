import type { ProDocument, ProSession } from "./model";
export class ProRenderer {
  private worker: Worker;
  private serial = 0;
  private pending = new Map<
    number,
    {
      resolve: (r: { bitmap?: ImageBitmap; blob?: Blob }) => void;
      reject: (e: Error) => void;
      progress?: (n: number, total: number) => void;
    }
  >();
  constructor() {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined")
      throw new Error(
        "Pro Studio needs Web Workers and OffscreenCanvas. The existing chapter editor remains available.",
      );
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) {
        data.bitmap?.close();
        return;
      }
      if (data.type === "progress") {
        p.progress?.(data.done, data.total);
        return;
      }
      this.pending.delete(data.id);
      if (data.type === "error") p.reject(new Error(data.error));
      else if (data.type === "cancelled")
        p.reject(new DOMException("Rendering superseded.", "AbortError"));
      else p.resolve(data);
    };
    this.worker.onerror = () =>
      this.dispose(
        new Error(
          "The Pro rendering worker stopped. Export a native backup and try a smaller document.",
        ),
      );
  }
  private request(
    type: string,
    input: Record<string, unknown>,
    progress?: (n: number, t: number) => void,
  ) {
    if (type === "preview")
      for (const [id, p] of this.pending) {
        p.reject(new DOMException("Preview superseded", "AbortError"));
        this.pending.delete(id);
      }
    const id = ++this.serial;
    return new Promise<{ bitmap?: ImageBitmap; blob?: Blob }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker.postMessage({ id, type, ...input });
    });
  }
  init(session: ProSession, maxArea = 16_000_000) {
    return this.request("init", { session, maxArea });
  }
  render(document: ProDocument, maxArea: number) {
    return this.request("preview", { document, maxArea });
  }
  export(
    document: ProDocument,
    maxArea: number,
    mime: string,
    quality: number,
    progress: (n: number, t: number) => void,
  ) {
    return this.request("export", { document, maxArea, mime, quality }, progress);
  }
  dispose(reason: Error = new DOMException("Processing cancelled.", "AbortError")) {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
  }
}
