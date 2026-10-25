import { create } from "zustand";
import {
  commitPanelMedia,
  commitChapterImages,
  commitPanelOrder,
  commitChapterStrip,
  getBlob,
  getImageBlob,
  loadLibrary,
  putRecords,
  removeRecords,
  storageMessage,
} from "@/lib/studio/db";
import { decodeBlob, makeThumb, stitchChapter } from "@/lib/studio/images";
import { preflightImage, browserImagePolicy, imagePolicy, thumbnailPolicy } from "./image-policy";
import { convertImage, formatLabel, needsConversion } from "./convert/client";
import { importIssue, importSummary, type ImportIssue } from "./import-report";
import { matchingDimensions } from "./image-decode";
import { mediaIds, mediaReference, obsoleteMedia } from "./editor/references";
import { validateRecipe } from "./editor/geometry";
import type { Chapter, Panel, Project, Strip, StripFormat, PanelEdit } from "@/lib/studio/types";
import { cleanTitle, uid } from "@/lib/utils";

type Job = { chapterId: string; done: number; total: number; label: string; kind?: "import" };
/** Files that were not imported, kept in memory (never persisted) so they can be retried. */
export type ImportFailure = ImportIssue & { file: File };

type Studio = {
  ready: boolean;
  orderBusy: boolean;
  reorderPanels: (chapterId: string, ids: string[]) => Promise<void>;
  undoReorder: (chapterId: string) => Promise<void>;
  projects: Project[];
  chapters: Chapter[];
  panels: Panel[];
  thumbs: Record<string, string>;
  stripUrls: Record<string, string[]>;
  selected: Record<string, string[] | undefined>;
  job: Job | null;
  banner: string | null;
  hydrate: () => Promise<void>;
  dismissBanner: () => void;
  createProject: (title: string) => Promise<{ projectId: string; chapterId: string }>;
  renameProject: (id: string, title: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  createChapter: (projectId: string) => Promise<string>;
  renameChapter: (id: string, title: string) => Promise<void>;
  deleteChapter: (id: string) => Promise<void>;
  setChapterOptions: (
    id: string,
    patch: Partial<Pick<Chapter, "width" | "seam" | "format">>,
  ) => Promise<void>;
  addImages: (chapterId: string, files: File[]) => Promise<void>;
  importFailures: Record<string, ImportFailure[] | undefined>;
  importNotes: Record<string, string[] | undefined>;
  retryImport: (chapterId: string) => Promise<void>;
  dismissImportReport: (chapterId: string) => void;
  cancelImport: (chapterId: string) => void;
  removePanel: (id: string) => Promise<void>;
  movePanel: (id: string, direction: -1 | 1) => Promise<void>;
  placePanel: (chapterId: string, fromId: string, toId: string) => Promise<void>;
  toggleSelected: (chapterId: string, panelId: string) => void;
  selectAll: (chapterId: string) => void;
  selectNone: (chapterId: string) => void;
  display: (chapterId: string, mode: "replace" | "append") => Promise<boolean>;
  clearStrip: (chapterId: string) => Promise<void>;
  replacePanelImage: (
    id: string,
    blob: Blob,
    options?: { expectedBlobId?: string; edit?: PanelEdit; signal?: AbortSignal },
  ) => Promise<void>;
  restorePanel: (id: string, expectedBlobId?: string) => Promise<void>;
  loadMedia: (chapterId: string) => Promise<void>;
};

const urls = new Map<string, string>();

function blobUrl(id: string, blob: Blob) {
  const existing = urls.get(id);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

function revokeBlobUrl(id: string) {
  const live = useStudio.getState();
  if (
    live.panels.some((p) => mediaIds(p).includes(id)) ||
    live.chapters.some((c) => c.strip?.parts.some((p) => p.blobId === id))
  )
    return;
  const url = urls.get(id);
  if (!url) return;
  URL.revokeObjectURL(url);
  urls.delete(id);
}

let hydratePromise: Promise<void> | null = null;
let importing: { chapterId: string; controller: AbortController } | undefined;
const replacements = new Map<string, AbortController>();

function chapterPanels(panels: Panel[], chapterId: string) {
  return panels
    .filter((panel) => panel.chapterId === chapterId)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function selectedIds(state: Pick<Studio, "panels" | "selected">, chapterId: string) {
  const ids = chapterPanels(state.panels, chapterId).map((panel) => panel.id);
  const explicit = state.selected[chapterId];
  if (!explicit) return ids;
  const known = new Set(ids);
  return explicit.filter((id) => known.has(id));
}

export function stripFreshness(chapter: Chapter, panels: Panel[]) {
  if (!chapter.strip) return "empty" as const;
  const ordered = chapterPanels(panels, chapter.id)
    .filter((panel) => chapter.strip?.panelIds.includes(panel.id))
    .map((panel) => panel.id);
  const samePanels =
    ordered.length === chapter.strip.panelIds.length &&
    ordered.every((id, index) => id === chapter.strip?.panelIds[index]);
  const sameSettings =
    chapter.width === chapter.strip.widthSetting &&
    chapter.seam === chapter.strip.seam &&
    chapter.format === chapter.strip.format;
  const sameMedia = panels
    .filter((panel) => chapter.strip?.panelIds.includes(panel.id))
    .every((panel) =>
      chapter.strip!.mediaRevisions
        ? chapter.strip!.mediaRevisions[panel.id] === panel.blobId
        : !panel.mediaUpdatedAt || panel.mediaUpdatedAt <= chapter.strip!.createdAt,
    );
  return samePanels && sameSettings && sameMedia ? ("current" as const) : ("stale" as const);
}

function nextChapterTitle(chapters: Chapter[]) {
  const numbers = chapters.map((chapter) => {
    const match = /^Chapter (\d+)$/.exec(chapter.title);
    return match ? Number(match[1]) : 0;
  });
  return `Chapter ${Math.max(0, ...numbers, 0) + 1}`;
}

function withTimestamps(
  projects: Project[],
  chapters: Chapter[],
  projectId: string,
  chapterId?: string,
) {
  const now = Date.now();
  return {
    now,
    projects: projects.map((project) =>
      project.id === projectId ? { ...project, updatedAt: now } : project,
    ),
    chapters: chapters.map((chapter) =>
      chapter.id === chapterId ? { ...chapter, updatedAt: now } : chapter,
    ),
  };
}

export const useStudio = create<Studio>((set, get) => ({
  ready: false,
  orderBusy: false,
  projects: [],
  chapters: [],
  panels: [],
  thumbs: {},
  stripUrls: {},
  selected: {},
  job: null,
  banner: null,

  hydrate: () => {
    if (get().ready) return Promise.resolve();
    if (!hydratePromise) {
      hydratePromise = (async () => {
        try {
          const library = await loadLibrary();
          set({
            ...library,
            ready: true,
          });
        } catch (error) {
          set({ ready: true, banner: storageMessage(error) });
        }
      })();
    }
    return hydratePromise;
  },

  dismissBanner: () => set({ banner: null }),

  createProject: async (title) => {
    const now = Date.now();
    const project: Project = {
      id: uid(),
      title: cleanTitle(title, "Untitled project"),
      createdAt: now,
      updatedAt: now,
    };
    const chapter: Chapter = {
      id: uid(),
      projectId: project.id,
      title: "Chapter 1",
      createdAt: now,
      updatedAt: now,
      width: 800,
      seam: 0,
      format: "image/jpeg",
      strip: null,
    };
    await putRecords({ projects: [project], chapters: [chapter] });
    set((state) => ({
      projects: [project, ...state.projects],
      chapters: [...state.chapters, chapter],
    }));
    return { projectId: project.id, chapterId: chapter.id };
  },

  renameProject: async (id, title) => {
    const project = get().projects.find((item) => item.id === id);
    if (!project) return;
    const next = { ...project, title: cleanTitle(title, project.title), updatedAt: Date.now() };
    await putRecords({ projects: [next] });
    set((state) => ({
      projects: state.projects.map((item) => (item.id === id ? next : item)),
    }));
  },

  deleteProject: async (id) => {
    const chapters = get().chapters.filter((chapter) => chapter.projectId === id);
    const chapterIds = new Set(chapters.map((chapter) => chapter.id));
    if (importing && chapterIds.has(importing.chapterId)) get().cancelImport(importing.chapterId);
    const panels = get().panels.filter((panel) => chapterIds.has(panel.chapterId));
    const blobs = [
      ...panels.flatMap(mediaIds),
      ...chapters.flatMap((chapter) => chapter.strip?.parts.map((part) => part.blobId) ?? []),
    ];
    await removeRecords({
      projects: [id],
      chapters: chapters.map((chapter) => chapter.id),
      panels: panels.map((panel) => panel.id),
      blobs,
    });
    set((state) => ({
      projects: state.projects.filter((project) => project.id !== id),
      chapters: state.chapters.filter((chapter) => chapter.projectId !== id),
      panels: state.panels.filter((panel) => !chapterIds.has(panel.chapterId)),
    }));
    blobs.forEach(revokeBlobUrl);
  },

  createChapter: async (projectId) => {
    const project = get().projects.find((item) => item.id === projectId);
    if (!project) throw new Error("That project is gone.");
    const now = Date.now();
    const siblings = get().chapters.filter((chapter) => chapter.projectId === projectId);
    const chapter: Chapter = {
      id: uid(),
      projectId,
      title: nextChapterTitle(siblings),
      createdAt: now,
      updatedAt: now,
      width: 800,
      seam: 0,
      format: "image/jpeg",
      strip: null,
    };
    const nextProject = { ...project, updatedAt: now };
    await putRecords({ projects: [nextProject], chapters: [chapter] });
    set((state) => ({
      projects: state.projects.map((item) => (item.id === projectId ? nextProject : item)),
      chapters: [...state.chapters, chapter],
    }));
    return chapter.id;
  },

  renameChapter: async (id, title) => {
    const chapter = get().chapters.find((item) => item.id === id);
    if (!chapter) return;
    const next = { ...chapter, title: cleanTitle(title, chapter.title), updatedAt: Date.now() };
    const project = get().projects.find((item) => item.id === chapter.projectId);
    const nextProject = project ? { ...project, updatedAt: next.updatedAt } : null;
    await putRecords({ chapters: [next], projects: nextProject ? [nextProject] : [] });
    set((state) => ({
      chapters: state.chapters.map((item) => (item.id === id ? next : item)),
      projects: nextProject
        ? state.projects.map((item) => (item.id === nextProject.id ? nextProject : item))
        : state.projects,
    }));
  },

  deleteChapter: async (id) => {
    get().cancelImport(id);
    const chapter = get().chapters.find((item) => item.id === id);
    if (!chapter) return;
    const panels = get().panels.filter((panel) => panel.chapterId === id);
    const blobs = [
      ...panels.flatMap(mediaIds),
      ...(chapter.strip?.parts.map((part) => part.blobId) ?? []),
    ];
    await removeRecords({
      chapters: [id],
      panels: panels.map((panel) => panel.id),
      blobs,
    });
    const touched = withTimestamps(get().projects, get().chapters, chapter.projectId);
    const project = touched.projects.find((item) => item.id === chapter.projectId);
    if (project) await putRecords({ projects: [project] });
    set((state) => ({
      projects: touched.projects,
      chapters: state.chapters.filter((item) => item.id !== id),
      panels: state.panels.filter((panel) => panel.chapterId !== id),
      selected: { ...state.selected, [id]: undefined },
    }));
    blobs.forEach(revokeBlobUrl);
  },

  setChapterOptions: async (id, patch) => {
    const chapter = get().chapters.find((item) => item.id === id);
    if (!chapter) return;
    const next = { ...chapter, ...patch, updatedAt: Date.now() };
    await putRecords({ chapters: [next] });
    set((state) => ({
      chapters: state.chapters.map((item) => (item.id === id ? next : item)),
    }));
  },

  cancelImport: (chapterId) => {
    if (importing?.chapterId !== chapterId) return;
    importing.controller.abort(new DOMException("Import cancelled", "AbortError"));
    importing = undefined;
    set({ job: null, banner: "Image import cancelled. Uncommitted images were not added." });
  },

  addImages: async (chapterId, files) => {
    if (get().job) {
      set({ banner: "Wait for the current operation to finish." });
      return;
    }
    if (!get().chapters.some((c) => c.id === chapterId)) return;
    if (!files.length) {
      set({ banner: "Choose one or more images." });
      return;
    }
    const run = { chapterId, controller: new AbortController() };
    importing = run;
    const signal = run.controller.signal,
      policy = browserImagePolicy(),
      total = files.length;
    const progress = (done: number, label: string) =>
      set({ job: { chapterId, done, total, label, kind: "import" } });
    set({
      job: { chapterId, done: 0, total, label: "Checking image resources…", kind: "import" },
      banner: null,
    });
    const failures: ImportFailure[] = [],
      notes: string[] = [];
    // Every file ends up in exactly one place: committed, or in `failures` (retryable).
    const handled = new Set<number>();
    const fail = (index: number, error: unknown) => {
      if (handled.has(index)) return;
      handled.add(index);
      const file = files[index]!;
      failures.push({ ...importIssue(file.name || "Image", error), file });
    };
    // Each file is validated, decoded (or converted) and staged one at a time. Staged
    // files are published in budget-sized chunks: each chunk is one atomic transaction,
    // so a cancelled or failed chunk adds nothing and earlier chunks stay intact.
    let pending: {
        index: number;
        panel: Panel;
        blobs: { id: string; blob: Blob }[];
        thumb: Blob;
      }[] = [],
      chunkBytes = 0,
      chunkPixels = 0,
      headers = 0,
      added = 0,
      converted = 0,
      cursor = 0;
    const flush = async () => {
      if (!pending.length) return;
      const chunk = pending,
        bytes = chunk.reduce((n, item) => n + item.blobs.reduce((m, b) => m + b.blob.size, 0), 0);
      if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate().catch(() => undefined);
        if (
          estimate?.quota !== undefined &&
          estimate.usage !== undefined &&
          bytes + 2_000_000 > estimate.quota - estimate.usage
        )
          throw Object.assign(
            Error(
              added
                ? `Not enough browser storage for the remaining images. ${added} were added; the rest were not imported.`
                : "Not enough browser storage for this batch. Nothing was imported; choose fewer images.",
            ),
            { storage: true },
          );
      }
      const expected = chapterPanels(get().panels, chapterId).map(({ id, blobId, order }) => ({
        id,
        blobId,
        order,
      }));
      const committed = await commitChapterImages(
        chapterId,
        expected,
        chunk.map((item) => item.panel),
        chunk.flatMap((item) => item.blobs),
        signal,
      );
      pending = [];
      chunkBytes = chunkPixels = 0;
      added += committed.panels.length;
      for (const item of chunk) handled.add(item.index);
      const thumbs = { ...get().thumbs };
      for (const p of committed.panels) {
        try {
          thumbs[p.id] = blobUrl(p.thumbId, chunk.find((c) => c.panel.id === p.id)!.thumb);
        } catch {
          notes.push(`${p.name}: image saved; thumbnail display is unavailable. Reload to retry.`);
        }
      }
      set((state) => ({
        panels: [...state.panels, ...committed.panels],
        chapters: state.chapters.map((c) => (c.id === chapterId ? committed.chapter : c)),
        projects: state.projects.map((p) =>
          p.id === committed.project.id ? committed.project : p,
        ),
        thumbs,
        selected: {
          ...state.selected,
          [chapterId]: state.selected[chapterId]
            ? [...state.selected[chapterId]!, ...committed.panels.map((p) => p.id)]
            : undefined,
        },
      }));
    };
    try {
      for (; cursor < files.length; cursor++) {
        signal.throwIfAborted();
        const file = files[cursor]!,
          step = `${cursor + 1} of ${total}`;
        if (cursor >= policy.maxFiles) {
          fail(
            cursor,
            Error(`Import at most ${policy.maxFiles} images at a time. Retry this file.`),
          );
          continue;
        }
        if (headers > policy.maxBatchHeaders) {
          fail(
            cursor,
            Error("This batch reached its metadata-checking budget. Retry this file separately."),
          );
          continue;
        }
        progress(cursor, `Checking ${step}`);
        let info;
        try {
          info = await preflightImage(file, policy, signal);
          headers += info.headerBytes;
        } catch (error) {
          signal.throwIfAborted();
          headers += (error as { headerBytes?: number }).headerBytes ?? 0;
          fail(cursor, error);
          continue;
        }
        try {
          let stored: Blob = file.type === info.mime ? file : file.slice(0, file.size, info.mime),
            mime = info.mime,
            note = "";
          if (needsConversion(info)) {
            const label = formatLabel(info.type);
            // Decoder working memory plus the PNG encoder: refuse before allocating.
            if (info.pixels * 16 > policy.maxMemory)
              throw Error(
                `This ${label} image (${(info.pixels / 1e6).toFixed(1)} MP) is too large to convert safely on this device. Export a PNG or JPEG copy, or import it on a computer.`,
              );
            progress(cursor, `Converting ${label} ${step} to lossless PNG`);
            const result = await convertImage(stored, info, signal);
            stored = result.blob;
            mime = "image/png";
            note = `${file.name}: ${label} converted to lossless PNG${result.notes.length ? ` (${result.notes.join("; ")})` : ""}.`;
          }
          progress(cursor, `Adding ${step}`);
          const decoded = await decodeBlob(stored, { signal, policy });
          try {
            const thumb = await makeThumb(decoded.source, decoded.width, decoded.height);
            signal.throwIfAborted();
            const pixels = decoded.width * decoded.height;
            if (
              pending.length &&
              (chunkBytes + stored.size > policy.maxBatchBytes ||
                chunkPixels + pixels > policy.maxBatchPixels)
            )
              await flush().catch((error) => {
                throw Object.assign(error, { publish: true });
              });
            const blobId = uid(),
              thumbId = uid();
            pending.push({
              index: cursor,
              thumb,
              blobs: [
                { id: blobId, blob: stored },
                { id: thumbId, blob: thumb },
              ],
              panel: {
                id: uid(),
                chapterId,
                name: file.name || "Panel",
                mime,
                width: decoded.width,
                height: decoded.height,
                blobId,
                thumbId,
                order: 0,
                createdAt: Date.now(),
              },
            });
            chunkBytes += stored.size;
            chunkPixels += pixels;
            if (note) {
              converted++;
              notes.push(note);
            }
          } finally {
            decoded.close();
          }
        } catch (error) {
          signal.throwIfAborted();
          if (
            (error as { storage?: boolean; publish?: boolean }).storage ||
            (error as { publish?: boolean }).publish
          )
            throw error;
          fail(cursor, error);
        }
      }
      signal.throwIfAborted();
      await flush();
    } catch (error) {
      if (signal.aborted) {
        if (importing === run && added)
          set({
            banner: `Import cancelled. ${added} already added ${added === 1 ? "image was" : "images were"} kept.`,
          });
      } else {
        // Storage or transaction failure: everything not yet published is reported, retryable.
        for (let i = 0; i < files.length; i++) fail(i, error);
        pending = [];
        if (importing === run)
          set({ banner: importSummary(added, failures, converted) || storageMessage(error) });
      }
    } finally {
      if (importing === run) {
        importing = undefined;
        // Retry keeps the user's original selection order.
        failures.sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file));
        if (!signal.aborted) {
          set((state) => ({
            job: null,
            banner: state.banner ?? importSummary(added, failures, converted),
            importFailures: {
              ...state.importFailures,
              [chapterId]: failures.length ? failures : undefined,
            },
            importNotes: { ...state.importNotes, [chapterId]: notes.length ? notes : undefined },
          }));
        } else set({ job: null });
      }
    }
  },

  importFailures: {},
  importNotes: {},
  retryImport: async (chapterId) => {
    const files = (get().importFailures[chapterId] ?? []).map((f) => f.file);
    if (!files.length || get().job) return;
    set((state) => ({ importFailures: { ...state.importFailures, [chapterId]: undefined } }));
    await get().addImages(chapterId, files);
  },
  dismissImportReport: (chapterId) =>
    set((state) => ({
      importFailures: { ...state.importFailures, [chapterId]: undefined },
      importNotes: { ...state.importNotes, [chapterId]: undefined },
    })),

  removePanel: async (id) => {
    replacements.get(id)?.abort(new DOMException("Image deleted", "AbortError"));
    const panel = get().panels.filter((item) => item.id === id)[0];
    if (!panel) return;
    await removeRecords({
      panels: [panel.id],
      blobs: mediaIds(panel),
    });
    const remaining = chapterPanels(
      get().panels.filter((item) => item.id !== id),
      panel.chapterId,
    ).map((item, index) => ({ ...item, order: index }));
    const chapter = get().chapters.find((item) => item.id === panel.chapterId);
    const touched = chapter
      ? withTimestamps(get().projects, get().chapters, chapter.projectId, chapter.id)
      : null;
    const nextChapter = touched?.chapters.find((item) => item.id === panel.chapterId);
    const nextProject = chapter
      ? touched?.projects.find((item) => item.id === chapter.projectId)
      : undefined;
    await putRecords({
      panels: remaining,
      chapters: nextChapter ? [nextChapter] : [],
      projects: nextProject ? [nextProject] : [],
    });
    set((state) => {
      const panels = state.panels
        .filter((item) => item.id !== id)
        .map((item) => remaining.find((next) => next.id === item.id) ?? item);
      const thumbs = { ...state.thumbs };
      delete thumbs[id];
      const explicit = state.selected[panel.chapterId];
      return {
        panels,
        thumbs,
        chapters: nextChapter
          ? state.chapters.map((item) => (item.id === panel.chapterId ? nextChapter : item))
          : state.chapters,
        projects: nextProject
          ? state.projects.map((item) => (item.id === nextProject.id ? nextProject : item))
          : state.projects,
        selected: {
          ...state.selected,
          [panel.chapterId]: explicit?.filter((panelId) => panelId !== id),
        },
      };
    });
    mediaIds(panel).forEach(revokeBlobUrl);
    // A page whose every photo was deleted would keep showing removed artwork: clear it
    // so Display returns to its empty state. Pages that still contain photos stay (stale).
    const strip = get().chapters.find((c) => c.id === panel.chapterId)?.strip;
    if (strip && !get().panels.some((p) => strip.panelIds.includes(p.id)))
      await get().clearStrip(panel.chapterId);
  },

  movePanel: async (id, direction) => {
    const panel = get().panels.find((item) => item.id === id);
    if (!panel) return;
    const list = chapterPanels(get().panels, panel.chapterId);
    const index = list.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    const [item] = list.splice(index, 1);
    if (!item) return;
    list.splice(target, 0, item);
    await commitOrder(panel.chapterId, list, set, get);
  },

  placePanel: async (chapterId, fromId, toId) => {
    if (fromId === toId) return;
    const list = chapterPanels(get().panels, chapterId);
    const from = list.findIndex((item) => item.id === fromId);
    const to = list.findIndex((item) => item.id === toId);
    if (from < 0 || to < 0) return;
    const [item] = list.splice(from, 1);
    if (!item) return;
    list.splice(to, 0, item);
    await commitOrder(chapterId, list, set, get);
  },

  reorderPanels: async (chapterId, ids) => {
    const map = new Map(get().panels.map((p) => [p.id, p]));
    if (ids.some((id) => !map.has(id))) return;
    await commitOrder(
      chapterId,
      ids.map((id) => map.get(id)!),
      set,
      get,
    );
  },
  undoReorder: async (chapterId) => {
    const h = get()
      .chapters.find((c) => c.id === chapterId)
      ?.orderHistory?.at(-1);
    if (!h) return;
    const map = new Map(get().panels.map((p) => [p.id, p]));
    if (h.before.some((id) => !map.has(id))) {
      set({ banner: "Images changed. The previous reorder cannot be restored." });
      return;
    }
    await commitOrder(
      chapterId,
      h.before.map((id) => map.get(id)!),
      set,
      get,
      true,
    );
  },
  toggleSelected: (chapterId, panelId) => {
    const current = selectedIds(get(), chapterId);
    const next = current.includes(panelId)
      ? current.filter((id) => id !== panelId)
      : [...current, panelId];
    set((state) => ({ selected: { ...state.selected, [chapterId]: next } }));
  },

  selectAll: (chapterId) => {
    set((state) => ({ selected: { ...state.selected, [chapterId]: undefined } }));
  },

  selectNone: (chapterId) => {
    set((state) => ({ selected: { ...state.selected, [chapterId]: [] } }));
  },

  display: async (chapterId, mode) => {
    if (get().job) {
      set({ banner: "Wait for the current stitch to finish." });
      return false;
    }
    const chapter = get().chapters.find((item) => item.id === chapterId);
    if (!chapter) return false;
    const panels = chapterPanels(get().panels, chapterId);
    const checked = new Set(selectedIds(get(), chapterId));
    const idSet =
      mode === "append" && chapter.strip
        ? new Set([...chapter.strip.panelIds, ...checked])
        : checked;
    const chosen = panels.filter((panel) => idSet.has(panel.id));
    // One photo is a valid page: it is displayed on its own; two or more are stitched.
    if (!chosen.length) {
      set({
        banner: panels.length
          ? "Check at least one photo, then press Display."
          : "Add an image first, then press Display.",
      });
      return false;
    }

    set({
      job: { chapterId, done: 0, total: chosen.length, label: "Preparing the page" },
      banner: null,
    });

    try {
      const frames = [];
      for (const panel of chosen) {
        const blob = await getBlob(panel.blobId);
        if (!blob) throw new Error(`Missing photo: ${panel.name}`);
        frames.push({ id: panel.id, sw: panel.width, sh: panel.height, blob });
      }
      const result = await stitchChapter(
        frames,
        { width: chapter.width, gap: chapter.seam, format: chapter.format },
        (done, total, label) => set({ job: { chapterId, done, total, label } }),
      );
      const partRecords = result.parts.map((part) => ({
        blobId: uid(),
        height: part.height,
        blob: part.blob,
      }));
      const strip: Strip = {
        mediaRevisions: Object.fromEntries(chosen.map((p) => [p.id, p.blobId])),
        width: result.width,
        totalHeight: result.totalHeight,
        parts: partRecords.map((part) => ({ blobId: part.blobId, height: part.height })),
        panelIds: chosen.map((panel) => panel.id),
        widthSetting: chapter.width,
        seam: chapter.seam,
        format: chapter.format,
        createdAt: Date.now(),
      };
      const oldParts = chapter.strip?.parts ?? [];
      const committed = await commitChapterStrip(
        chapterId,
        oldParts.map((part) => part.blobId),
        strip,
        partRecords.map((part) => ({ id: part.blobId, blob: part.blob })),
        chosen.map((panel) => ({ id: panel.id, blobId: panel.blobId })),
      );
      const saved = committed.chapter;
      const nextProject = committed.project;
      oldParts.forEach((part) => revokeBlobUrl(part.blobId));
      const urlsForStrip = partRecords.map((part) => blobUrl(part.blobId, part.blob));
      const widthNote =
        result.width === chapter.width
          ? ""
          : ` Drawn at ${result.width}px wide so the full height fits this device.`;
      const partNote =
        result.parts.length > 1 ? ` Saved as ${result.parts.length} continuous parts.` : "";
      set((state) => ({
        chapters: state.chapters.map((item) => (item.id === chapterId ? saved : item)),
        projects: nextProject
          ? state.projects.map((item) => (item.id === nextProject.id ? nextProject : item))
          : state.projects,
        stripUrls: { ...state.stripUrls, [chapterId]: urlsForStrip },
        banner: `${chosen.length === 1 ? "Displaying 1 photo." : `Stitched ${chosen.length} photos.`}${partNote}${widthNote}`,
      }));
      return true;
    } catch (error) {
      set({ banner: storageMessage(error) });
      return false;
    } finally {
      set({ job: null });
    }
  },

  clearStrip: async (chapterId) => {
    const chapter = get().chapters.find((item) => item.id === chapterId);
    if (!chapter?.strip) return;
    const parts = chapter.strip.parts;
    try {
      const committed = await commitChapterStrip(
        chapterId,
        parts.map((part) => part.blobId),
        null,
        [],
      );
      set((state) => ({
        chapters: state.chapters.map((item) => (item.id === chapterId ? committed.chapter : item)),
        projects: committed.project
          ? state.projects.map((item) =>
              item.id === committed.project!.id ? committed.project! : item,
            )
          : state.projects,
        stripUrls: { ...state.stripUrls, [chapterId]: [] },
      }));
      parts.forEach((part) => revokeBlobUrl(part.blobId));
    } catch (error) {
      set({ banner: storageMessage(error) });
    }
  },

  replacePanelImage: async (id, blob, options) => {
    const panel = get().panels.find((item) => item.id === id);
    if (!panel) throw new Error("This panel is no longer available.");
    if (options?.expectedBlobId && panel.blobId !== options.expectedBlobId)
      throw new Error("This image changed. Reopen the editor to try again.");
    if (options?.edit)
      validateRecipe(options.edit.recipe, options.edit.source.width, options.edit.source.height);
    replacements.get(id)?.abort(new DOMException("Image replacement superseded", "AbortError"));
    const controller = new AbortController();
    replacements.set(id, controller);
    const abort = () => controller.abort(options?.signal?.reason);
    options?.signal?.addEventListener("abort", abort, { once: true });
    let decoded: Awaited<ReturnType<typeof decodeBlob>> | undefined;
    try {
      options?.signal?.throwIfAborted();
      const info = await preflightImage(blob, undefined, controller.signal);
      const canonical = blob.type === info.mime ? blob : blob.slice(0, blob.size, info.mime);
      decoded = await decodeBlob(canonical, { signal: controller.signal });
      if (
        options?.edit &&
        (decoded.width !== options.edit.recipe.width ||
          decoded.height !== options.edit.recipe.height)
      )
        throw new Error("Rendered dimensions do not match the editing recipe.");
      const thumb = await makeThumb(decoded.source, decoded.width, decoded.height);
      controller.signal.throwIfAborted();
      const next: Panel = {
        ...panel,
        original: panel.original ?? mediaReference(panel),
        draft: undefined,
        edit: options?.edit,
        blobId: uid(),
        thumbId: uid(),
        mime: info.mime,
        width: decoded.width,
        height: decoded.height,
        mediaUpdatedAt: Date.now(),
      };
      const obsolete = obsoleteMedia(panel, next);
      const committed = await commitPanelMedia(
        next,
        options?.expectedBlobId ?? panel.blobId,
        [
          { id: next.blobId, blob: canonical },
          { id: next.thumbId, blob: thumb },
        ],
        obsolete,
        controller.signal,
      );
      set((state) => ({
        panels: state.panels.map((item) => (item.id === id ? committed.panel : item)),
        chapters: state.chapters.map((item) =>
          item.id === committed.chapter.id ? committed.chapter : item,
        ),
        projects: committed.project
          ? state.projects.map((item) =>
              item.id === committed.project!.id ? committed.project! : item,
            )
          : state.projects,
        thumbs: { ...state.thumbs, [id]: blobUrl(next.thumbId, thumb) },
      }));
      obsolete.forEach(revokeBlobUrl);
    } finally {
      decoded?.close();
      options?.signal?.removeEventListener("abort", abort);
      if (replacements.get(id) === controller) replacements.delete(id);
    }
  },

  restorePanel: async (id, expectedBlobId) => {
    const panel = get().panels.find((item) => item.id === id);
    if (!panel?.original) return;
    const original = panel.original;
    const [blob, thumb] = await Promise.all([getBlob(original.blobId), getBlob(original.thumbId)]);
    if (!blob || !thumb)
      throw new Error("The original image is unavailable. Current image unchanged.");
    const info = await preflightImage(blob);
    if (!matchingDimensions(original.width, original.height, info))
      throw Error(
        "The original dimensions disagree with its image header. Current image unchanged.",
      );
    const thumbnail = await preflightImage(thumb, thumbnailPolicy());
    const safeThumb =
      thumb.type === thumbnail.mime ? thumb : thumb.slice(0, thumb.size, thumbnail.mime);
    const next = {
      ...panel,
      ...original,
      original: undefined,
      edit: undefined,
      draft: undefined,
      mediaUpdatedAt: Date.now(),
    };
    const obsolete = obsoleteMedia(panel, next);
    const committed = await commitPanelMedia(next, expectedBlobId ?? panel.blobId, [], obsolete);
    set((state) => ({
      panels: state.panels.map((item) => (item.id === id ? committed.panel : item)),
      chapters: state.chapters.map((item) =>
        item.id === committed.chapter.id ? committed.chapter : item,
      ),
      projects: committed.project
        ? state.projects.map((item) =>
            item.id === committed.project!.id ? committed.project! : item,
          )
        : state.projects,
      thumbs: { ...state.thumbs, [id]: blobUrl(original.thumbId, safeThumb) },
    }));
    obsolete.forEach(revokeBlobUrl);
  },

  loadMedia: async (chapterId) => {
    const panels = chapterPanels(get().panels, chapterId);
    const thumbs = { ...get().thumbs };
    for (const panel of panels) {
      if (thumbs[panel.id]) continue;
      const blob = await getImageBlob(panel.thumbId, true).catch((error) => {
        set({ banner: storageMessage(error) });
        return undefined;
      });
      if (blob) thumbs[panel.id] = blobUrl(panel.thumbId, blob);
    }
    const chapter = get().chapters.find((item) => item.id === chapterId);
    const stripUrls: string[] = [];
    if (chapter?.strip) {
      for (const part of chapter.strip.parts) {
        // Saved page parts are shown by <img>, not decoded into canvases here: validate
        // them against the standard header policy so a page stitched on a computer still
        // appears on a phone with a smaller import budget.
        const blob = await getImageBlob(part.blobId, false, imagePolicy()).catch((error) => {
          set({ banner: storageMessage(error) });
          return undefined;
        });
        if (blob) stripUrls.push(blobUrl(part.blobId, blob));
      }
    }
    set((state) => ({
      thumbs,
      stripUrls: { ...state.stripUrls, [chapterId]: stripUrls },
    }));
  },
}));

async function commitOrder(
  chapterId: string,
  list: Panel[],
  set: (partial: Partial<Studio> | ((state: Studio) => Partial<Studio>)) => void,
  get: () => Studio,
  undo = false,
) {
  if (get().orderBusy) return;
  const expected = chapterPanels(get().panels, chapterId).map((p) => p.id),
    next = list.map((p) => p.id);
  if (expected.join("\0") === next.join("\0")) return;
  set({ orderBusy: true });
  try {
    const saved = await commitPanelOrder(chapterId, expected, next, undo),
      byId = new Map(saved.panels.map((p) => [p.id, p]));
    set((s) => ({
      panels: s.panels.map((p) => byId.get(p.id) ?? p),
      chapters: s.chapters.map((c) => (c.id === chapterId ? saved.chapter : c)),
      projects: saved.project
        ? s.projects.map((p) => (p.id === saved.project!.id ? saved.project! : p))
        : s.projects,
      banner: undo ? "Reorder undone." : "Image order saved.",
    }));
  } catch (error) {
    set({ banner: storageMessage(error) });
  } finally {
    set({ orderBusy: false });
  }
}

export function extensionFor(format: StripFormat) {
  return format === "image/png" ? "png" : "jpg";
}
