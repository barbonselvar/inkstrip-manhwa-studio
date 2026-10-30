import { set as cacheModel } from "idb-keyval";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import workerUrl from "../../../../node_modules/tesseract.js/dist/worker.min.js?url";
import coreUrl from "../../../../node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import { OCR_MODELS, OCR_SOURCE, type OcrLanguage } from "./ocr-models";
import type { DialogueRegion } from "./types";
export type OcrProgress = { stage: string; progress: number };
async function weights(
  language: OcrLanguage,
  signal: AbortSignal,
  progress: (v: OcrProgress) => void,
) {
  const model = OCR_MODELS[language],
    url = `${OCR_SOURCE}/${language}.traineddata`;
  let cache: Cache | undefined;
  try {
    cache = await caches.open("inkstrip-ocr-verified-v1");
  } catch {
    /* Caching is optional. */
  }
  let response = await cache?.match(url);
  const cached = !!response;
  if (!response)
    response = await fetch(url, {
      signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  if (!response.ok || !response.body) {
    if (cached) await cache?.delete(url);
    throw Error("OCR language data could not be downloaded. No image was uploaded.");
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > model.bytes) {
        await reader.cancel();
        if (cached) await cache?.delete(url);
        throw Error("OCR model exceeds its verified size.");
      }
      chunks.push(new Uint8Array(value));
      progress({
        stage: cached
          ? "Verifying cached OCR language"
          : "Downloading OCR language · no artwork upload",
        progress: received / model.bytes,
      });
    }
  } finally {
    reader.releaseLock();
  }
  if (received !== model.bytes) {
    if (cached) await cache?.delete(url);
    throw Error(
      "OCR model download is incomplete; any corrupt cached copy was removed. Retry to download verified data.",
    );
  }
  const bytes = await new Blob(chunks).arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== model.sha256) {
    await cache?.delete(url);
    throw Error("OCR language integrity check failed; corrupt cache removed.");
  }
  signal.throwIfAborted();
  if (!cached)
    try {
      await cache?.put(url, new Response(bytes));
    } catch {
      /* Quota failure does not affect document state. */
    }
  return bytes;
}
/** One bounded local worker. Cancel destroys computation; no images leave this browser. */
export class OcrRuntime {
  private worker: Worker | null = null;
  private controller: AbortController | null = null;
  private serial = 0;
  async recognize(
    image: ImageData,
    language: OcrLanguage,
    origin = { x: 0, y: 0 },
    progress: (value: OcrProgress) => void = () => {},
  ) {
    if (
      !Object.hasOwn(OCR_MODELS, language) ||
      !Number.isFinite(origin.x) ||
      !Number.isFinite(origin.y) ||
      Math.abs(origin.x) > 100000 ||
      Math.abs(origin.y) > 100000 ||
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width * image.height > 4_000_000 ||
      image.width < 1 ||
      image.height < 1 ||
      image.data.length !== image.width * image.height * 4
    )
      throw Error(
        "OCR supports a source-resolution region up to 4MP. Select a smaller region; artwork is never resized silently.",
      );
    this.cancel();
    const serial = this.serial,
      controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => this.cancel(), 120000);
    const start = performance.now();
    const current = () => {
      if (serial !== this.serial || controller.signal.aborted)
        throw new DOMException("OCR cancelled.", "AbortError");
    };
    try {
      const verified = await weights(language, controller.signal, progress);
      current();
      const cachePath = `inkstrip-ocr-v1/${OCR_MODELS[language].sha256}`;
      let cachedModel = false;
      try {
        // Seed Tesseract's documented cachePath with the verified bytes. String
        // languages avoid its byte-object initialization bug, without a second
        // network retrieval or an offline dependency after caching.
        await cacheModel(`${cachePath}/${language}.traineddata`, new Uint8Array(verified));
        cachedModel = true;
      } catch {
        progress({
          stage: "OCR model cache unavailable · network required, no artwork upload",
          progress: 0,
        });
      }
      current();
      const pending = await createWorker(language, OEM.LSTM_ONLY, {
        workerPath: new URL(workerUrl, location.origin).href,
        corePath: new URL(coreUrl, location.origin).href,
        workerBlobURL: false,
        langPath: OCR_SOURCE,
        gzip: false,
        cacheMethod: cachedModel ? "readOnly" : "none",
        cachePath,
        logger: (message) => {
          if (serial === this.serial)
            progress({ stage: message.status, progress: message.progress });
        },
      });
      if (serial !== this.serial) {
        await pending.terminate();
        current();
      }
      this.worker = pending;
      current();
      // Verify the actual model file loaded by Tesseract, not only the preflight response.
      const loaded = (await pending.FS("readFile", [`${language}.traineddata`]))
        .data as unknown as Uint8Array;
      if (!(loaded instanceof Uint8Array) || loaded.byteLength !== OCR_MODELS[language].bytes)
        throw Error("OCR engine loaded an unexpected language file.");
      const actualHash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(loaded))),
      ]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      loaded.fill(0);
      if (actualHash !== OCR_MODELS[language].sha256)
        throw Error("OCR engine language integrity check failed.");
      current();
      await pending.setParameters({
        tessedit_pageseg_mode:
          language === "jpn_vert" ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      const canvas = new OffscreenCanvas(image.width, image.height);
      canvas.getContext("2d")!.putImageData(image, 0, 0);
      const input = await canvas.convertToBlob({ type: "image/png" });
      canvas.width = canvas.height = 1;
      const result = await pending.recognize(input, {}, { text: true, blocks: true });
      current();
      const selectedLanguage =
        language === "ara"
          ? "ar"
          : language === "kor"
            ? "ko"
            : language.startsWith("jpn")
              ? "ja"
              : "en";
      const regions: DialogueRegion[] = [];
      for (const block of result.data.blocks ?? [])
        for (const paragraph of block.paragraphs ?? []) {
          if (!paragraph.text.trim()) continue;
          const b = paragraph.bbox,
            x = Math.max(0, Math.min(image.width - 1, b.x0 - 3)),
            y = Math.max(0, Math.min(image.height - 1, b.y0 - 3)),
            right = Math.max(x + 1, Math.min(image.width, b.x1 + 3)),
            bottom = Math.max(y + 1, Math.min(image.height, b.y1 + 3));
          regions.push({
            id: crypto.randomUUID(),
            x: origin.x + x,
            y: origin.y + y,
            width: right - x,
            height: bottom - y,
            sourceLanguage: selectedLanguage,
            targetLanguage: "en",
            original: paragraph.text.trim(),
            corrected: paragraph.text.trim(),
            replacement: "",
            confidence: Math.max(0, Math.min(100, paragraph.confidence)),
            status: "detected",
          });
        }
      if (regions.length > 200)
        throw Error(
          "OCR found more than 200 regions. Select a smaller area before adding a review queue.",
        );
      return {
        regions,
        text: result.data.text,
        elapsedMs: performance.now() - start,
        engine: "Tesseract.js7.0.0 / tessdata_fast",
        language,
        dimensions: [image.width, image.height],
      };
    } finally {
      clearTimeout(timer);
      if (serial === this.serial) {
        this.controller = null;
        const worker = this.worker;
        this.worker = null;
        await worker?.terminate();
      }
    }
  }
  cancel() {
    this.serial++;
    this.controller?.abort();
    this.controller = null;
    const worker = this.worker;
    this.worker = null;
    void worker?.terminate();
  }
}
