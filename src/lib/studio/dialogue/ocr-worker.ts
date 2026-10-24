/// <reference lib="webworker" />
import { OcrRuntime } from "./ocr-runtime";
const runtime = new OcrRuntime();
self.onmessage = async ({ data }) => {
  try {
    if (
      !(data.pixels instanceof ArrayBuffer) ||
      !Number.isInteger(data.width) ||
      !Number.isInteger(data.height) ||
      data.width < 1 ||
      data.height < 1 ||
      data.width * data.height > 4_000_000 ||
      data.pixels.byteLength !== data.width * data.height * 4
    )
      throw Error("Invalid OCR input.");
    const image = new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height);
    const result = await runtime.recognize(image, data.language, data.origin, (value) =>
      self.postMessage({ type: "progress", value }),
    );
    self.postMessage({ type: "result", value: result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "OCR failed.",
    });
  }
};
