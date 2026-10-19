import type { FaceBox } from "./detect";
export function detectFaces(blob: Blob, signal: AbortSignal, progress: (s: string) => void) {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return new Promise<FaceBox[]>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Face detection cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      finish();
      reject(new Error("Face detector stopped. Select a face manually."));
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        progress(data.label);
        return;
      }
      finish();
      if (data.type === "faces") resolve(data.boxes);
      else reject(new Error(data.message));
    };
    worker.postMessage({ blob });
  });
}
