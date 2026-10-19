import type { Selection } from "./selection";
export async function retouchImage(
  blob: Blob,
  strokes: Selection[],
  options: {
    mode: "local" | "cloud";
    operation?: "erase" | "face";
    reference?: Blob;
    notes?: string;
    access?: string;
    signal: AbortSignal;
    progress: (label: string, n: number) => void;
  },
) {
  options.signal.throwIfAborted();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const ask = (message: object) =>
    new Promise<{ blob?: Blob; image?: Blob; mask?: Blob }>((resolve, reject) => {
      const abort = () => {
        worker.terminate();
        reject(new DOMException("Processing cancelled.", "AbortError"));
      };
      options.signal.addEventListener("abort", abort, { once: true });
      worker.onerror = () => {
        options.signal.removeEventListener("abort", abort);
        reject(new Error("Repair worker stopped. Try a smaller region."));
      };
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") {
          options.progress("Synthesizing local texture", data.value);
          return;
        }
        options.signal.removeEventListener("abort", abort);
        if (data.type === "error") reject(new Error(data.message));
        else resolve(data);
      };
      worker.postMessage(message);
    });
  try {
    options.progress(
      options.mode === "local" ? "Preparing local texture repair" : "Preparing cloud context",
      0,
    );
    const prepared = await ask({
      type: options.mode === "local" ? "local" : "prepare",
      blob,
      strokes,
    });
    if (options.mode === "local") return prepared.blob!;
    options.signal.throwIfAborted();
    const body = new FormData();
    body.set("image", prepared.image!, "context.png");
    body.set("mask", prepared.mask!, "mask.png");
    body.set("operation", options.operation ?? "erase");
    body.set("notes", options.notes ?? "");
    if (options.reference) body.set("reference", options.reference, "reference.png");
    options.progress("Cloud inference — progress is indeterminate", 0.5);
    const response = await fetch("/api/studio/ai-edit", {
      method: "POST",
      headers: { "x-inkstrip-access": options.access ?? "" },
      body,
      signal: options.signal,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "AI service failed." }));
      throw new Error(error.error ?? "AI service failed.");
    }
    const generated = await response.blob();
    if (generated.type !== "image/png")
      throw new Error("AI service returned an unsupported image.");
    options.signal.throwIfAborted();
    options.progress("Blending selected pixels", 0.95);
    return (await ask({ type: "compose", generated })).blob!;
  } finally {
    worker.terminate();
  }
}
