import { deviceLimits } from "../images";
import { zipStore, safeAssetName, type ZipEntry } from "../dialogue/zip";
import { encodeBackup } from "../backup";
import { readProjectData } from "../backup-store";
import type { Panel } from "../types";
import { layout, compositionBlobIds, validateComposition, type CompositionDocument } from "./model";
import { renderRegion, RenderResources, compositionRenderBudget } from "./render";
export type ExportOptions = {
  format: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  quality: number;
  segmentHeight: number;
  background: string;
  panelIds?: string[];
  excluded?: string[];
};
import { segmentRows } from "./segments";
export function toBlob(c: HTMLCanvasElement, format: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (blob) => {
        if (!blob) reject(Error("This device could not encode the image. Try smaller segments."));
        else if (blob.type !== format)
          reject(Error(`This browser does not support ${format} export. Choose PNG.`));
        else resolve(blob);
      },
      format,
      quality,
    ),
  );
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function exportComposition(
  d: CompositionDocument,
  panels: Panel[],
  options: ExportOptions,
  signal?: AbortSignal,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<ZipEntry[]> {
  validateComposition({ version: 1, revision: 0, document: d });
  if (
    !Number.isInteger(options.width) ||
    options.width < 320 ||
    options.width > 4096 ||
    !Number.isInteger(options.segmentHeight) ||
    options.segmentHeight < 128 ||
    options.segmentHeight > 16384 ||
    !Number.isFinite(options.quality) ||
    options.quality < 0.1 ||
    options.quality > 1
  )
    throw Error("Invalid export settings");
  const scale = options.width / d.width,
    scene = layout(d, panels),
    limits = deviceLimits();
  // Reserve all padded intermediate planes; lower segment height without lowering width.
  const { padding, planes } = compositionRenderBudget(d, panels),
    halo = Math.ceil(padding * scale) * 2 + 2;
  const segmentHeight = Math.min(
    options.segmentHeight,
    Math.floor(limits.maxArea / options.width / planes) - halo,
    limits.maxSide - halo,
  );
  if (segmentHeight < 1)
    throw Error(
      "Effect padding exceeds this device's export budget. Reduce effect radius or output width; source artwork was not changed.",
    );
  const scopes = options.panelIds?.length
    ? scene.frames
        .filter((f) => options.panelIds!.includes(f.panel.id))
        .map((f) => ({ name: f.panel.name, y: f.top, height: f.gapY - f.top }))
    : [{ name: "chapter", y: 0, height: scene.height }];
  const jobs = scopes.flatMap((scope, index) =>
    segmentRows(Math.max(1, Math.ceil(scope.height * scale)), segmentHeight).map((rows, part) => ({
      scope,
      index,
      part,
      rows,
    })),
  );
  if (jobs.length > 1000)
    throw Error("This export exceeds 1000 segments. Choose a smaller panel range.");
  const resources = new RenderResources(),
    entries: ZipEntry[] = [];
  try {
    for (const [index, job] of jobs.entries()) {
      signal?.throwIfAborted();
      const output = await renderRegion(
        d,
        panels,
        {
          y: job.scope.y + job.rows.start / scale,
          height: (job.rows.end - job.rows.start) / scale,
        },
        options.width,
        resources,
        { signal, excluded: new Set(options.excluded) },
      );
      try {
        if (options.format === "image/jpeg" || options.background !== "transparent") {
          const ctx = output.getContext("2d")!;
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = options.background === "transparent" ? "#ffffff" : options.background;
          ctx.fillRect(0, 0, output.width, output.height);
        }
        const ext =
          options.format === "image/png" ? "png" : options.format === "image/webp" ? "webp" : "jpg";
        entries.push({
          name: `${String(job.index + 1).padStart(3, "0")}-${safeAssetName(job.scope.name)}-${String(job.part + 1).padStart(3, "0")}.${ext}`,
          blob: await toBlob(
            output,
            options.format,
            options.format === "image/png" ? undefined : options.quality,
          ),
        });
      } finally {
        output.width = output.height = 0;
      }
      onProgress(index + 1, jobs.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return entries;
  } finally {
    resources.clear();
  }
}
export async function downloadComposition(
  title: string,
  d: CompositionDocument,
  panels: Panel[],
  options: ExportOptions,
  signal?: AbortSignal,
  onProgress?: (n: number, total: number) => void,
) {
  const entries = await exportComposition(d, panels, options, signal, onProgress);
  if (entries.length === 1) download(entries[0].blob, `${safeAssetName(title)}-${entries[0].name}`);
  else download(await zipStore(entries, signal), `${safeAssetName(title)}-composition.zip`);
}
/** Does not require saving pending metadata; usable after a quota/conflict failure. */
export async function recoveryPackage(
  projectId: string,
  chapterId: string,
  d?: CompositionDocument,
  order?: string[],
) {
  const data = await readProjectData(projectId);
  if (d && order) {
    const ids = data.panels.filter((p) => p.chapterId === chapterId).map((p) => p.id);
    if (
      ids.length !== order.length ||
      new Set(order).size !== ids.length ||
      order.some((id) => !ids.includes(id))
    )
      throw Error(
        "Chapter images changed during recovery. Keep the editor open and preserve your source images before reopening.",
      );
    const positions = new Map(order.map((id, index) => [id, index]));
    data.panels = data.panels.map((p) =>
      p.chapterId === chapterId ? { ...p, order: positions.get(p.id)! } : p,
    );
  }
  if (d)
    data.chapters = data.chapters.map((c) =>
      c.id === chapterId ? { ...c, composition: { version: 1, revision: 0, document: d } } : c,
    );
  for (const id of compositionBlobIds(
    d ? { document: d } : data.chapters.find((c) => c.id === chapterId)?.composition,
  ))
    if (!data.blobs.has(id)) {
      const { getBlob } = await import("../db");
      const blob = await getBlob(id);
      if (!blob) throw Error("A pending asset is missing. Keep the editor open.");
      data.blobs.set(id, blob);
    }
  return encodeBackup(data);
}
