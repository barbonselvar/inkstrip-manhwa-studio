import type { OcrLanguage } from "./ocr-models";
import type { DialogueRegion } from "./types";
export type OcrProgress = { stage: string; progress: number };
export type OcrResult = {
  regions: DialogueRegion[];
  text: string;
  elapsedMs: number;
  engine: string;
  language: OcrLanguage;
  dimensions: number[];
};
/** The parent worker owns Tesseract's child worker, so Cancel stops model initialization too. */
export class LocalOcr {
  private worker: Worker | null = null;
  private reject: ((error: Error) => void) | null = null;
  async recognize(
    image: ImageData,
    language: OcrLanguage,
    origin = { x: 0, y: 0 },
    progress: (value: OcrProgress) => void = () => {},
  ): Promise<OcrResult> {
    if (
      !Number.isFinite(origin.x) ||
      !Number.isFinite(origin.y) ||
      Math.abs(origin.x) > 100000 ||
      Math.abs(origin.y) > 100000 ||
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width < 1 ||
      image.height < 1 ||
      image.width * image.height > 4_000_000 ||
      image.data.length !== image.width * image.height * 4
    )
      throw Error(
        "OCR supports a source-resolution region up to 4MP. Select a smaller area; no image is resized silently.",
      );
    this.cancel();
    const worker = new Worker(new URL("./ocr-worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
          this.reject = null;
        }
      };
      this.reject = (error) => {
        cleanup();
        reject(error);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          Error(
            "OCR exceeded the two-minute limit. Select a smaller region; your document is unchanged.",
          ),
        );
      }, 120000);
      worker.onerror = () => {
        cleanup();
        reject(
          Error("The local OCR worker stopped. Try a smaller region; your artwork is unchanged."),
        );
      };
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") {
          progress(data.value);
          return;
        }
        cleanup();
        if (data.type === "result") resolve(data.value);
        else reject(Error(data.error || "OCR failed; document unchanged."));
      };
      const pixels = image.data.slice().buffer;
      worker.postMessage({ width: image.width, height: image.height, pixels, language, origin }, [
        pixels,
      ]);
    });
  }
  cancel() {
    const reject = this.reject;
    this.reject = null;
    this.worker?.terminate();
    this.worker = null;
    reject?.(new DOMException("OCR cancelled.", "AbortError"));
  }
}
