import { getBlob } from "./db";
import { browserCapabilityBudgets } from "./image-capabilities";
import { partName, splitPlan, SplitError, type SplitBudget } from "./page-split";
import { useStudio } from "./store";
import type { Panel } from "./types";

/** This device's Raster editing budget (the existing limits; nothing is raised). */
export function rasterSplitBudget(): SplitBudget {
  const budgets = browserCapabilityBudgets();
  return { maxSide: budgets.rasterSide, maxArea: budgets.raster };
}

function splitInWorker(mime: string, bytes: ArrayBuffer, parts: ReturnType<typeof splitPlan>) {
  const worker = new Worker(new URL("./page-split-worker.ts", import.meta.url), { type: "module" });
  return new Promise<ArrayBuffer[]>((resolve, reject) => {
    worker.onmessage = ({ data }) =>
      data.error ? reject(new SplitError(data.error)) : resolve(data.pngs);
    worker.onerror = () =>
      reject(new SplitError("The split worker stopped. The original is unchanged."));
    worker.postMessage({ id: 1, mime, bytes, parts }, [bytes]);
  }).finally(() => worker.terminate());
}

/**
 * Add lossless parts of `panel` as new Chapter images placed right after it. The original
 * image, its edits and native drafts are untouched; parts go through the normal import
 * pipeline (validation, thumbnails, one atomic commit per batch, storage checks).
 * Returns the number of parts added.
 */
export async function splitChapterImage(chapterId: string, panel: Panel, budget: SplitBudget) {
  const studio = useStudio.getState();
  if (studio.job) throw new SplitError("Wait for the current operation to finish.");
  const parts = splitPlan(panel.width, panel.height, budget);
  useStudio.setState({
    job: { chapterId, done: 0, total: 1, label: `Splitting into ${parts.length} pages…` },
  });
  let pngs: ArrayBuffer[];
  try {
    const blob = await getBlob(panel.blobId);
    if (!blob) throw new SplitError("The image is missing. The chapter is unchanged.");
    pngs = await splitInWorker(blob.type, await blob.arrayBuffer(), parts);
  } finally {
    useStudio.setState({ job: null });
  }
  const before = new Set(useStudio.getState().panels.map((p) => p.id));
  await useStudio.getState().addImages(
    chapterId,
    pngs.map((b, i) => new File([b], partName(panel.name, i, pngs.length), { type: "image/png" })),
  );
  const ordered = useStudio
      .getState()
      .panels.filter((p) => p.chapterId === chapterId)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
    added = ordered.filter((p) => !before.has(p.id));
  if (added.length && ordered.some((p) => p.id === panel.id)) {
    const rest = ordered.filter((p) => before.has(p.id)).map((p) => p.id),
      at = rest.indexOf(panel.id) + 1;
    rest.splice(at, 0, ...added.map((p) => p.id));
    await useStudio.getState().reorderPanels(chapterId, rest);
  }
  return added.length;
}
