import { ReorderHandle, type DragPosition } from "./reorder-handle";
import { FaceQueue } from "./retouch/face-queue";
import { ImageEditor } from "./editor/image-editor";
import { PanelImageActions } from "./editor/panel-image-actions";
import { EnhanceDialog } from "@/components/studio/enhance-dialog";
import { ReaderHeader } from "@/components/studio/reader-header";
import type { Panel } from "@/lib/studio/types";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmButton, InlineTitle, Segment, Wordmark } from "@/components/studio/chrome";
import { FORMAT_HINT, IMAGE_ACCEPT } from "@/lib/studio/images";
import { extensionFor, selectedIds, stripFreshness, useStudio } from "@/lib/studio/store";
import { PAGE_WIDTHS, SEAMS, type StripFormat } from "@/lib/studio/types";
import { cn, countLabel, slugify } from "@/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Download,
  ImagePlus,
  Trash2,
  Sparkles,
  Layers3,
  ScanLine,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const emptyUrls: string[] = [];

export function ChapterStudio({ projectId, chapterId }: { projectId: string; chapterId: string }) {
  const project = useStudio((state) => state.projects.find((item) => item.id === projectId));
  const chapter = useStudio((state) => state.chapters.find((item) => item.id === chapterId));
  const panels = useStudio((state) => state.panels);
  const thumbs = useStudio((state) => state.thumbs);
  const stripUrls = useStudio((state) => state.stripUrls[chapterId] ?? emptyUrls);
  const selectedMap = useStudio((state) => state.selected);
  const job = useStudio((state) => state.job);
  const loadMedia = useStudio((state) => state.loadMedia);
  const addImages = useStudio((state) => state.addImages);
  const renameChapter = useStudio((state) => state.renameChapter);
  const deleteChapter = useStudio((state) => state.deleteChapter);
  const setChapterOptions = useStudio((state) => state.setChapterOptions);
  const removePanel = useStudio((state) => state.removePanel);
  const movePanel = useStudio((state) => state.movePanel);
  const toggleSelected = useStudio((state) => state.toggleSelected);
  const selectAll = useStudio((state) => state.selectAll);
  const selectNone = useStudio((state) => state.selectNone);
  const display = useStudio((state) => state.display);
  const clearStrip = useStudio((state) => state.clearStrip);
  const navigate = useNavigate();

  const [faceTargets, setFaceTargets] = useState<Panel[] | null>(null);
  const [editorPanel, setEditorPanel] = useState<Panel | null>(null);
  const [enhancePanels, setEnhancePanels] = useState<Panel[] | null>(null);
  const [pane, setPane] = useState<"panels" | "page">("panels");
  const [dragOver, setDragOver] = useState(false);
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(null);
  const orderBusy = useStudio((s) => s.orderBusy);
  const reorderPanels = useStudio((s) => s.reorderPanels);
  const undoReorder = useStudio((s) => s.undoReorder);
  const inputRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const busy = job?.chapterId === chapterId;

  const list = useMemo(
    () =>
      panels
        .filter((panel) => panel.chapterId === chapterId)
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
    [panels, chapterId],
  );
  const checked = selectedIds({ panels, selected: selectedMap }, chapterId);
  const checkedSet = useMemo(() => new Set(checked), [checked]);
  const extras = chapter?.strip
    ? checked.filter((id) => !chapter.strip?.panelIds.includes(id))
    : [];
  const freshness = chapter ? stripFreshness(chapter, panels) : "empty";
  const panelKey = list.map((panel) => panel.id).join(",");
  const stripKey = chapter?.strip?.createdAt ?? 0;

  useEffect(() => {
    void loadMedia(chapterId);
  }, [loadMedia, chapterId, panelKey, stripKey]);

  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (editorPanel || enhancePanels || faceTargets) return;
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      void addImages(chapterId, files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImages, chapterId, editorPanel, enhancePanels, faceTargets]);

  if (!project || !chapter || chapter.projectId !== projectId) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 pt-8">
        <Link to="/" className="font-display text-lg">
          Inkstrip
        </Link>
        <h1 className="mt-10 font-display text-3xl">This chapter is gone.</h1>
        <Link to="/" className="mt-6 text-sm text-muted">
          Back to projects
        </Link>
      </main>
    );
  }

  function takeFiles(files: FileList | File[] | null) {
    const list = [...(files ?? [])];
    if (list.length === 0) return;
    void addImages(chapterId, list);
  }

  async function runDisplay(mode: "replace" | "append") {
    const ok = await display(chapterId, mode);
    if (!ok) return;
    setPane("page");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (window.matchMedia("(min-width: 48rem)").matches) {
      pageRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    }
  }

  const progress = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 8;

  return (
    <div className="editor-shell min-h-dvh" onDragEnter={() => setDragOver(true)}>
      <header className="editor-topbar relative z-20 flex h-14 items-center gap-3 border-b border-border bg-bg px-3 sm:px-5">
        <div className="editor-wordmark">
          <Wordmark />
        </div>
        <Link
          to="/p/$projectId"
          params={{ projectId }}
          className="press focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-muted hover:text-fg"
          aria-label={`Back to ${project.title}`}
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <InlineTitle
            value={chapter.title}
            onSave={(value) => void renameChapter(chapter.id, value)}
            className="font-display text-lg text-fg"
          />
          <p className="truncate text-xs text-subtle">{project.title}</p>
        </div>
        <span className="status-pill">
          <span className="status-dot" />
          Studio
        </span>
      </header>

      <div className="editor-tabs sticky top-0 z-10 grid grid-cols-2 gap-1 border-b border-border bg-bg p-2 md:hidden">
        <button
          type="button"
          className={cn(
            "press focus-ring flex h-11 items-center justify-center gap-2 rounded-sm text-sm",
            pane === "panels" ? "bg-bg-subtle text-fg" : "text-muted",
          )}
          onClick={() => setPane("panels")}
        >
          <Layers3 className="size-4" /> Panels
        </button>
        <button
          type="button"
          className={cn(
            "press focus-ring flex h-11 items-center justify-center gap-2 rounded-sm text-sm",
            pane === "page" ? "bg-bg-subtle text-fg" : "text-muted",
          )}
          onClick={() => setPane("page")}
        >
          <ScanLine className="size-4" /> Display
        </button>
      </div>

      <div className="md:flex">
        <aside
          className={cn(
            "studio-aside border-border md:border-r",
            pane === "panels" ? "block" : "hidden md:block",
            dragOver && "bg-bg-elevated",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (event.dataTransfer.files.length > 0) takeFiles(event.dataTransfer.files);
          }}
        >
          <div className="flex flex-col gap-4 p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Chapter workspace</p>
              <span className="status-pill">Local storage</span>
            </div>
            <label
              className={buttonClass({
                className: "w-full",
                variant: busy ? "secondary" : "primary",
              })}
            >
              <ImagePlus className="size-4" />
              Add images
              <input
                ref={inputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                disabled={busy}
                className="sr-only"
                onChange={(event) => {
                  takeFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            <p className="text-sm text-muted">
              Opens the photo library on a phone, or files on a computer. {FORMAT_HINT}. You can
              also drop or paste.
            </p>

            <Button
              variant="secondary"
              disabled={busy || checked.length === 0}
              onClick={() => setEnhancePanels(list.filter((panel) => checkedSet.has(panel.id)))}
            >
              <Sparkles className="size-4 text-accent" />
              AI Enhance{checked.length ? ` · ${checked.length} selected` : ""}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !checked.length}
              onClick={() => setFaceTargets(list.filter((p) => checkedSet.has(p.id)))}
            >
              AI Face Fix · review selected targets
            </Button>
            <Segment
              label="Page width"
              value={chapter.width}
              options={PAGE_WIDTHS.map((width) => ({ value: width, label: String(width) }))}
              onChange={(width) => void setChapterOptions(chapter.id, { width })}
            />
            <Segment
              label="Seam"
              value={chapter.seam}
              options={SEAMS.map((seam) => ({ value: seam.value, label: seam.label }))}
              onChange={(seam) => void setChapterOptions(chapter.id, { seam })}
            />
            <Segment
              label="File"
              value={chapter.format}
              options={[
                { value: "image/jpeg" as StripFormat, label: "JPG" },
                { value: "image/png" as StripFormat, label: "PNG" },
              ]}
              onChange={(format) => void setChapterOptions(chapter.id, { format })}
            />

            <Button
              variant="ghost"
              disabled={busy || orderBusy || !chapter.orderHistory?.length}
              onClick={() => void undoReorder(chapter.id)}
            >
              Undo reorder
            </Button>
            <p className="text-xs text-muted" aria-live="polite">
              {orderBusy
                ? "Saving order…"
                : "Drag the grip to reorder; image long-press opens editing. Arrows work with a keyboard."}
            </p>
            <div className="flex items-center justify-between gap-3 text-sm">
              <p className="text-muted tabular-nums">
                {checked.length} of {list.length} checked
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="focus-ring rounded-sm text-fg"
                  onClick={() => selectAll(chapter.id)}
                >
                  All
                </button>
                <button
                  type="button"
                  className="focus-ring rounded-sm text-muted"
                  onClick={() => selectNone(chapter.id)}
                >
                  None
                </button>
              </div>
            </div>
          </div>

          {list.length === 0 ? (
            <div
              className={cn(
                "mx-4 mb-4 rounded-xl border border-dashed border-border px-4 py-10 text-center",
                dragOver && "border-fg",
              )}
            >
              <p className="font-display text-2xl text-fg">Drop panels here</p>
              <p className="mt-2 text-sm text-muted">Top to bottom becomes the reading order.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2 px-4 pb-4">
              {list.map((panel, index) => {
                const on = checkedSet.has(panel.id);
                return (
                  <li
                    key={panel.id}
                    data-order-panel={panel.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border border-border bg-bg p-2",
                      on && "bg-bg-subtle",
                      dragPosition?.from === panel.id && "opacity-50",
                      dragPosition?.to === panel.id &&
                        (dragPosition.after ? "drop-after" : "drop-before"),
                    )}
                  >
                    <ReorderHandle
                      id={panel.id}
                      name={panel.name}
                      ids={list.map((p) => p.id)}
                      disabled={busy || orderBusy}
                      onPosition={setDragPosition}
                      onCommit={(ids) => void reorderPanels(chapter.id, ids)}
                    />
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={on ? `Uncheck ${panel.name}` : `Check ${panel.name}`}
                      onClick={() => toggleSelected(chapter.id, panel.id)}
                      className={cn(
                        "focus-ring grid size-11 shrink-0 place-items-center rounded-sm border text-sm tabular-nums",
                        on ? "border-accent bg-accent text-accent-fg" : "border-border text-muted",
                      )}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </button>
                    <PanelImageActions
                      panel={panel}
                      thumb={thumbs[panel.id]}
                      disabled={busy}
                      onToggle={() => toggleSelected(chapter.id, panel.id)}
                      onEdit={() => setEditorPanel(panel)}
                      onEnhance={() => setEnhancePanels([panel])}
                    />
                    <div className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        className="focus-ring grid size-11 place-items-center text-muted disabled:opacity-30"
                        aria-label="Move up"
                        disabled={index === 0 || busy || orderBusy}
                        onClick={() => void movePanel(panel.id, -1)}
                      >
                        <ChevronUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="focus-ring grid size-11 place-items-center text-muted disabled:opacity-30"
                        aria-label="Move down"
                        disabled={index === list.length - 1 || busy || orderBusy}
                        onClick={() => void movePanel(panel.id, 1)}
                      >
                        <ChevronDown className="size-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="focus-ring grid size-11 place-items-center text-subtle hover:text-danger"
                      aria-label={`Remove ${panel.name}`}
                      disabled={busy}
                      onClick={() => void removePanel(panel.id)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="safe-b sticky bottom-0 border-t border-border bg-bg p-3">
            {busy ? (
              <div>
                <p className="text-sm text-fg" aria-live="polite">
                  {job?.label}
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg-subtle">
                  <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Button disabled={checked.length < 2} onClick={() => void runDisplay("replace")}>
                  Display{checked.length >= 2 ? ` ${checked.length}` : ""}
                </Button>
                {chapter.strip && extras.length > 0 ? (
                  <Button variant="secondary" onClick={() => void runDisplay("append")}>
                    Add {extras.length} below
                  </Button>
                ) : null}
                <p className="text-xs text-subtle">
                  Display rebuilds the page from the checked photos, in this order. Add below keeps
                  the current page and stitches newly checked photos underneath.
                </p>
              </div>
            )}
          </div>

          <div className="px-4 pb-6">
            <ConfirmButton
              title={`Delete ${chapter.title}?`}
              description="Photos in this chapter are removed from this device."
              confirmLabel="Delete chapter"
              onConfirm={() => {
                void deleteChapter(chapter.id).then(() =>
                  navigate({ to: "/p/$projectId", params: { projectId } }),
                );
              }}
              className="press focus-ring text-sm text-subtle hover:text-danger"
            >
              Delete chapter
            </ConfirmButton>
          </div>
        </aside>

        <section
          ref={pageRef}
          className={cn(
            "display-workspace min-w-0 flex-1",
            pane === "page" ? "block" : "hidden md:block",
          )}
        >
          <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-8">
            <div className="min-w-0 flex-1">
              <p className="eyebrow mb-1">Live chapter preview</p>
              <h2 className="font-display text-2xl text-fg">Display</h2>
              {chapter.strip ? (
                <p className="mt-1 text-sm text-muted tabular-nums">
                  {chapter.strip.width} × {chapter.strip.totalHeight.toLocaleString()} ·{" "}
                  {countLabel(chapter.strip.panelIds.length, "photo")}
                  {chapter.strip.parts.length > 1 ? ` · ${chapter.strip.parts.length} parts` : ""}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">The stitched chapter shows up here.</p>
              )}
            </div>
            {chapter.strip && stripUrls.length > 0 ? (
              <Button
                variant="secondary"
                disabled={freshness === "stale" || !!job}
                title={
                  freshness === "stale"
                    ? "Press Display to include your latest accepted edits before saving."
                    : "Download chapter"
                }
                onClick={() =>
                  downloadStrip(project.title, chapter.title, chapter.strip!.format, stripUrls)
                }
              >
                <Download className="size-4" />
                Save
              </Button>
            ) : null}
          </div>

          {freshness === "stale" ? (
            <p className="px-4 pb-4 text-sm text-muted sm:px-8">
              Images, order, or settings changed. Display again to update the page.
            </p>
          ) : null}

          {chapter.strip && stripUrls.length > 0 ? (
            <div className="bg-bg px-0 pb-16 md:px-8 md:pb-20">
              <article className="reader-sheet mx-auto w-full max-w-md md:sheet-shadow">
                <ReaderHeader chapter={chapter.title} project={project.title} />
                {stripUrls.map((url, index) => (
                  <img
                    key={chapter.strip?.parts[index]?.blobId ?? url}
                    src={url}
                    alt={`${chapter.title}, part ${index + 1} of ${stripUrls.length}`}
                    width={chapter.strip?.width}
                    height={chapter.strip?.parts[index]?.height}
                    className="manhwa-image block h-auto w-full"
                  />
                ))}
              </article>
              <div className="mx-auto mt-4 flex w-full max-w-md justify-end px-4 md:px-0">
                <button
                  type="button"
                  className="focus-ring text-sm text-subtle hover:text-fg"
                  onClick={() => void clearStrip(chapter.id)}
                >
                  Clear page
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 pb-16 sm:px-8">
              <div className="empty-display mx-auto flex min-h-80 w-full max-w-md flex-col justify-end rounded-xl border border-dashed border-border px-5 py-8 text-fg">
                <p className="text-xs tracking-widest uppercase text-subtle">Empty page</p>
                <h3 className="mt-3 font-display text-3xl">Nothing stitched yet.</h3>
                <p className="mt-3 max-w-xs text-sm text-muted">
                  Check at least two photos, then press Display. Add more later and stitch them into
                  the same chapter.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
      {dragPosition ? (
        <div
          className="reorder-preview"
          aria-live="polite"
          style={{
            left: Math.min(dragPosition.x + 12, window.innerWidth - 200),
            top: Math.max(12, dragPosition.y - 50),
          }}
        >
          {list.find((p) => p.id === dragPosition.from)?.name} · release to move
        </div>
      ) : null}
      {faceTargets ? (
        <FaceQueue
          panels={faceTargets}
          projectId={projectId}
          onClose={() => setFaceTargets(null)}
        />
      ) : null}
      {editorPanel ? (
        <ImageEditor
          key={editorPanel.id}
          panel={editorPanel}
          chapterWidth={chapter.width}
          onClose={() => setEditorPanel(null)}
        />
      ) : null}
      {enhancePanels ? (
        <EnhanceDialog panels={enhancePanels} onClose={() => setEnhancePanels(null)} />
      ) : null}
    </div>
  );
}

function downloadStrip(project: string, chapter: string, format: StripFormat, urls: string[]) {
  const base = `${slugify(project)}-${slugify(chapter)}`;
  const ext = extensionFor(format);
  urls.forEach((url, index) => {
    const name =
      urls.length === 1
        ? `${base}.${ext}`
        : `${base}-part-${String(index + 1).padStart(2, "0")}.${ext}`;
    window.setTimeout(() => {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }, index * 400);
  });
}
