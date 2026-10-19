import { create } from "zustand";
import {
  commitPanelMedia,
  commitPanelOrder,
  commitChapterStrip,
  getBlob,
  loadLibrary,
  putBlobs,
  putRecords,
  removeRecords,
  storageMessage,
} from "@/lib/studio/db";
import { decodeBlob, isImageFile, makeThumb, stitchChapter } from "@/lib/studio/images";
import { mediaIds, mediaReference, obsoleteMedia } from "./editor/references";
import { validateRecipe } from "./editor/geometry";
import type { Chapter, Panel, Project, Strip, StripFormat, PanelEdit } from "@/lib/studio/types";
import { cleanTitle, uid } from "@/lib/utils";

type Job = { chapterId: string; done: number; total: number; label: string };

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
    options?: { expectedBlobId?: string; edit?: PanelEdit },
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
    const panels = get().panels.filter((panel) => chapterIds.has(panel.chapterId));
    const blobs = [
      ...panels.flatMap(mediaIds),
      ...chapters.flatMap((chapter) => chapter.strip?.parts.map((part) => part.blobId) ?? []),
    ];
    blobs.forEach(revokeBlobUrl);
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
    const chapter = get().chapters.find((item) => item.id === id);
    if (!chapter) return;
    const panels = get().panels.filter((panel) => panel.chapterId === id);
    const blobs = [
      ...panels.flatMap(mediaIds),
      ...(chapter.strip?.parts.map((part) => part.blobId) ?? []),
    ];
    blobs.forEach(revokeBlobUrl);
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

  addImages: async (chapterId, files) => {
    if (get().job) {
      set({ banner: "Wait for the current stitch to finish." });
      return;
    }
    const chapter = get().chapters.find((item) => item.id === chapterId);
    if (!chapter) return;
    const images = files.filter(isImageFile);
    const rejected = files.length - images.length;
    if (images.length === 0) {
      set({
        banner:
          rejected > 0
            ? "Those files are not images. Choose JPG, PNG, WEBP, or another photo format."
            : "Choose one or more photos.",
      });
      return;
    }

    set({
      job: { chapterId, done: 0, total: images.length, label: "Adding photos" },
      banner: null,
    });
    const failed: string[] = [];
    const made: Panel[] = [];
    const existing = chapterPanels(get().panels, chapterId);
    let order = existing.reduce((max, panel) => Math.max(max, panel.order), -1) + 1;

    try {
      for (let index = 0; index < images.length; index += 1) {
        const file = images[index];
        if (!file) continue;
        set({
          job: {
            chapterId,
            done: index,
            total: images.length,
            label: `Adding ${index + 1} of ${images.length}`,
          },
        });
        try {
          const decoded = await decodeBlob(file);
          try {
            const thumb = await makeThumb(decoded.source, decoded.width, decoded.height);
            const blobId = uid();
            const thumbId = uid();
            await putBlobs([
              { id: blobId, blob: file },
              { id: thumbId, blob: thumb },
            ]);
            made.push({
              id: uid(),
              chapterId,
              name: file.name || "Panel",
              mime: file.type || "application/octet-stream",
              width: decoded.width,
              height: decoded.height,
              blobId,
              thumbId,
              order,
              createdAt: Date.now(),
            });
            order += 1;
          } finally {
            decoded.close();
          }
        } catch {
          failed.push(file.name || "a photo");
        }
      }

      if (made.length > 0) {
        const touched = withTimestamps(
          get().projects,
          get().chapters,
          chapter.projectId,
          chapterId,
        );
        const nextChapter = touched.chapters.find((item) => item.id === chapterId);
        const nextProject = touched.projects.find((item) => item.id === chapter.projectId);
        await putRecords({
          panels: made,
          chapters: nextChapter ? [nextChapter] : [],
          projects: nextProject ? [nextProject] : [],
        });
        const thumbs = { ...get().thumbs };
        for (const panel of made) {
          const thumb = await getBlob(panel.thumbId);
          if (thumb) thumbs[panel.id] = blobUrl(panel.thumbId, thumb);
        }
        set((state) => {
          const explicit = state.selected[chapterId];
          const selected = explicit ? [...explicit, ...made.map((panel) => panel.id)] : undefined;
          return {
            panels: [...state.panels, ...made],
            chapters: nextChapter
              ? state.chapters.map((item) => (item.id === chapterId ? nextChapter : item))
              : state.chapters,
            projects: nextProject
              ? state.projects.map((item) => (item.id === nextProject.id ? nextProject : item))
              : state.projects,
            thumbs,
            selected: { ...state.selected, [chapterId]: selected },
          };
        });
      }

      const notes: string[] = [];
      if (made.length > 0)
        notes.push(`Added ${made.length} ${made.length === 1 ? "photo" : "photos"}.`);
      if (failed.length > 0) {
        notes.push(
          `Could not read ${failed.slice(0, 3).join(", ")}. Export HEIC or unusual files as JPG or PNG.`,
        );
      }
      if (rejected > 0) notes.push("Skipped files that were not images.");
      set({ banner: notes.join(" ") || null });
    } catch (error) {
      set({ banner: storageMessage(error) });
    } finally {
      set({ job: null });
    }
  },

  removePanel: async (id) => {
    const panel = get().panels.filter((item) => item.id === id)[0];
    if (!panel) return;
    revokeBlobUrl(panel.blobId);
    revokeBlobUrl(panel.thumbId);
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
    if (mode === "replace" && chosen.length < 2) {
      set({ banner: "Check at least two photos, then press Display." });
      return false;
    }
    if (chosen.length < 2) {
      set({ banner: "Add another photo before stitching." });
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
        banner: `Stitched ${chosen.length} photos.${partNote}${widthNote}`,
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
      parts.forEach((part) => revokeBlobUrl(part.blobId));
      set((state) => ({
        chapters: state.chapters.map((item) => (item.id === chapterId ? committed.chapter : item)),
        projects: committed.project
          ? state.projects.map((item) =>
              item.id === committed.project!.id ? committed.project! : item,
            )
          : state.projects,
        stripUrls: { ...state.stripUrls, [chapterId]: [] },
      }));
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
    const decoded = await decodeBlob(blob);
    try {
      if (
        options?.edit &&
        (decoded.width !== options.edit.recipe.width ||
          decoded.height !== options.edit.recipe.height)
      )
        throw new Error("Rendered dimensions do not match the editing recipe.");
      const thumb = await makeThumb(decoded.source, decoded.width, decoded.height);
      const next: Panel = {
        ...panel,
        original: panel.original ?? mediaReference(panel),
        draft: undefined,
        edit: options?.edit,
        blobId: uid(),
        thumbId: uid(),
        mime: blob.type,
        width: decoded.width,
        height: decoded.height,
        mediaUpdatedAt: Date.now(),
      };
      const obsolete = obsoleteMedia(panel, next);
      const committed = await commitPanelMedia(
        next,
        options?.expectedBlobId ?? panel.blobId,
        [
          { id: next.blobId, blob },
          { id: next.thumbId, blob: thumb },
        ],
        obsolete,
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
      decoded.close();
    }
  },

  restorePanel: async (id, expectedBlobId) => {
    const panel = get().panels.find((item) => item.id === id);
    if (!panel?.original) return;
    const original = panel.original;
    const [blob, thumb] = await Promise.all([getBlob(original.blobId), getBlob(original.thumbId)]);
    if (!blob || !thumb)
      throw new Error("The original image is unavailable. Current image unchanged.");
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
      thumbs: { ...state.thumbs, [id]: blobUrl(original.thumbId, thumb) },
    }));
    obsolete.forEach(revokeBlobUrl);
  },

  loadMedia: async (chapterId) => {
    const panels = chapterPanels(get().panels, chapterId);
    const thumbs = { ...get().thumbs };
    for (const panel of panels) {
      if (thumbs[panel.id]) continue;
      const blob = await getBlob(panel.thumbId);
      if (blob) thumbs[panel.id] = blobUrl(panel.thumbId, blob);
    }
    const chapter = get().chapters.find((item) => item.id === chapterId);
    const stripUrls: string[] = [];
    if (chapter?.strip) {
      for (const part of chapter.strip.parts) {
        const blob = await getBlob(part.blobId);
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
