import {
  layer,
  toLocalSelection,
  validateDocument,
  type ProDocument,
  type Selection,
} from "../pro/model.ts";
import type { Frame } from "../pro/artboards.ts";
import { dialogueData } from "./operations.ts";
/** Traditional solid-background cleaning only. It cannot reconstruct complex artwork. */
export function flatBackground(image: { width: number; height: number; data: Uint8ClampedArray }) {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width > 16384 ||
    image.height > 16384 ||
    image.width < 3 ||
    image.height < 3 ||
    image.width * image.height > 4_000_000 ||
    image.data.length !== image.width * image.height * 4
  )
    throw Error("Select a native region from 3×3px up to 4MP.");
  const ring: number[][] = [];
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4;
      if (image.data[at + 3] !== 255)
        throw Error(
          "Flat cleanup requires an opaque background. Use Raster mask/repair tools for transparent edges.",
        );
      if (x < 2 || y < 2 || x >= image.width - 2 || y >= image.height - 2)
        ring.push([image.data[at]!, image.data[at + 1]!, image.data[at + 2]!]);
    }
  const median = [0, 1, 2].map((channel) => {
    const sorted = ring.map((c) => c[channel]!).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  });
  const inliers =
    ring.filter((c) => c.every((v, i) => Math.abs(v - median[i]!) <= 12)).length / ring.length;
  if (inliers < 0.85)
    throw Error(
      "This boundary is textured or crosses artwork. Flat cleanup cannot restore it reliably. Use Raster Clone/Healing; generative restoration is not configured.",
    );
  return {
    color: "#" + median.map((v) => v.toString(16).padStart(2, "0")).join(""),
    boundaryInliers: inliers,
  };
}
export function cleanupProposal(
  d: ProDocument,
  frame: Frame,
  color: string,
  selection?: Selection,
) {
  if (
    ![frame.x, frame.y, frame.width, frame.height].every(Number.isInteger) ||
    frame.x < 0 ||
    frame.y < 0 ||
    frame.width < 1 ||
    frame.height < 1 ||
    frame.x + frame.width > d.width ||
    frame.y + frame.height > d.height ||
    !/^#[0-9a-f]{6}$/i.test(color)
  )
    throw Error("Invalid cleanup region.");
  const l = layer("shape", frame.width, frame.height);
  l.name = "Approved flat background cleanup";
  l.dialogueRole = "cleanup";
  l.shape = "rectangle";
  l.fill = color;
  l.strokeWidth = 0;
  l.transform.x = frame.x;
  l.transform.y = frame.y;
  if (selection && (selection.regions.length || selection.inverted))
    l.mask = { enabled: true, selection: toLocalSelection(selection, l), strokes: [] };
  const document = { ...d, dialogue: dialogueData(d), layers: [...d.layers, l] };
  validateDocument(document);
  return { document, id: l.id };
}
