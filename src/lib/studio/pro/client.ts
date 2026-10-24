import type { RefineOptions } from "./refine-selection";
import type { Frame, Artboard } from "./artboards";
import type { RepairRequest } from "./repair";
import type { ColorSelectionOptions } from "./selection";
import type { ProDocument, ProSession, Region } from "./model";
type RenderReply = {
  bitmap?: ImageBitmap;
  blob?: Blob;
  region?: Region;
  sample?: [number, number, number];
  document?: ProDocument;
  assetId?: string;
  layerId?: string;
  thumbnails?: { id: string; blob: Blob }[];
};
export class ProRenderer {
  private worker: Worker;
  private serial = 0;
  private stopped = false;
  private pending = new Map<
    number,
    {
      type: string;
      resolve: (r: RenderReply) => void;
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
    if (this.stopped)
      return Promise.reject(
        new Error(
          "The rendering worker is closed. Save a native recovery file, then close and reopen Pro Studio.",
        ),
      );
    if (type === "preview")
      for (const [id, p] of this.pending) {
        if (p.type !== "preview") continue;
        p.reject(new DOMException("Preview superseded", "AbortError"));
        this.pending.delete(id);
      }
    const id = ++this.serial;
    return new Promise<RenderReply>((resolve, reject) => {
      this.pending.set(id, { type, resolve, reject, progress });
      this.worker.postMessage({ id, type, ...input });
    });
  }
  init(session: ProSession, maxArea = 16_777_216) {
    return this.request("init", { session, maxArea });
  }
  render(document: ProDocument, maxArea: number, frame?: Frame) {
    return this.request("preview", { document, maxArea, frame });
  }
  export(
    document: ProDocument,
    maxArea: number,
    mime: string,
    quality: number,
    progress: (n: number, t: number) => void,
    fullCanvas = false,
  ) {
    return this.request("export", { document, maxArea, mime, quality, fullCanvas }, progress);
  }
  exportArtboard(
    document: ProDocument,
    maxArea: number,
    board: Artboard,
    scale: number,
    mime: string,
    quality: number,
  ) {
    return this.request("artboard-export", {
      document,
      maxArea,
      board,
      exportScale: scale,
      mime,
      quality,
    });
  }
  region(document: ProDocument, maxArea: number, frame: Frame) {
    return this.request("dialogue-region", { document, maxArea, frame });
  }
  select(
    document: ProDocument,
    maxArea: number,
    point: { x: number; y: number },
    options: ColorSelectionOptions,
  ) {
    return this.request("select", { document, maxArea, point, options });
  }
  sample(document: ProDocument, maxArea: number, point: { x: number; y: number }) {
    return this.request("sample", { document, maxArea, point });
  }
  applyMask(document: ProDocument, maxArea: number, layerId: string) {
    return this.request("apply-mask", { document, maxArea, layerId });
  }
  refine(
    document: ProDocument,
    maxArea: number,
    options: RefineOptions,
    progress?: (n: number, t: number) => void,
  ) {
    return this.request("refine", { document, maxArea, options }, progress);
  }
  repair(document: ProDocument, maxArea: number, request: RepairRequest) {
    return this.request("repair", { document, maxArea, request });
  }
  thumbnails(document: ProDocument, maxArea: number) {
    return this.request("thumbnails", { document, maxArea });
  }
  merge(
    document: ProDocument,
    maxArea: number,
    mode: "selected" | "visible" | "flatten",
    ids: string[],
    progress: (n: number, total: number) => void,
  ) {
    return this.request("merge", { document, maxArea, mode, ids }, progress);
  }
  dispose(reason: Error = new DOMException("Processing cancelled.", "AbortError")) {
    this.stopped = true;
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
  }
}
