import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertCircle,
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileStack,
  FolderOpen,
  ImageIcon,
  Images,
  Layers,
  Maximize2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { defaultValidate, type PickerValidation } from "@/lib/studio/picker/validate";
import {
  canConfirm,
  clearRecent,
  createPickerState,
  gridMove,
  pickerReducer,
  recentFiles,
  rememberRecent,
  selectedFiles,
  type PickerItem,
  type PickerMode,
  type PickerSource,
} from "@/lib/studio/picker/selection";
import { renderThumbnail, UrlCache } from "@/lib/studio/picker/thumbnails";

export type ImagePickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PickerMode;
  title: string;
  /** Full accept list used by the "Files" source and for validating drops. */
  accept: string;
  /** Narrower list for the "Photos" source so phones show their system photo picker. */
  photoAccept?: string;
  confirmLabel?: (count: number) => string;
  onConfirm: (files: File[]) => void;
  /** Defaults to the shared header preflight (type, file size, dimensions, memory). */
  validate?: (file: File, signal: AbortSignal) => Promise<PickerValidation>;
  /** Extra advisory note for a validated image, e.g. a lossless split hint. */
  annotate?: (width: number, height: number) => string | undefined;
  maxFiles?: number;
  description?: string;
  disabled?: boolean;
};

const THUMB = 320;
const PREVIEW = 1600;
let counter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const sourceLabel: Record<PickerSource, string> = {
  photos: "Photo library",
  files: "Files",
  drop: "Dropped",
  paste: "Pasted",
  recent: "Recent",
};

type Tab = "photos" | "collections" | "recent" | "selected";

export function ImagePicker({
  open,
  onOpenChange,
  mode,
  title,
  accept,
  photoAccept = "image/*",
  confirmLabel,
  onConfirm,
  validate = defaultValidate,
  annotate,
  maxFiles = 250,
  description,
  disabled,
}: ImagePickerProps) {
  const [state, dispatch] = useReducer(pickerReducer, createPickerState(mode, maxFiles));
  const [tab, setTab] = useState<Tab>("photos");
  const [collection, setCollection] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const cache = useRef<UrlCache | null>(null);
  const previewCache = useRef<UrlCache | null>(null);
  const controller = useRef<AbortController | null>(null);
  const requested = useRef(new Set<string>());
  const photosInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [columns, setColumns] = useState(3);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; at: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const validateRef = useRef(validate);
  validateRef.current = validate;
  const annotateRef = useRef(annotate);
  annotateRef.current = annotate;

  const itemsRef = useRef(state.items);
  itemsRef.current = state.items;
  const getCache = () => (cache.current ??= new UrlCache());
  const getPreviewCache = () => (previewCache.current ??= new UrlCache());

  const releaseAll = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    cache.current?.clear();
    previewCache.current?.clear();
    requested.current.clear();
    setThumbs({});
    setPreviewUrl(null);
  }, []);

  // Fresh session on every open; every temporary URL is released on close/unmount.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    controller.current = new AbortController();
    dispatch({ type: "reset" });
    setTab("photos");
    setCollection(null);
    setPreview(null);
    setFocusIndex(0);
    setDragOffset(0);
    const recent = recentFiles();
    if (recent.length) addFiles(recent, "recent", { select: false });
    return releaseAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addFiles = (files: File[], source: PickerSource, options: { select?: boolean } = {}) => {
    if (!files.length) return;
    const batchId = uid("batch");
    const at = Date.now();
    const time = new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    dispatch({
      type: "add",
      files,
      source,
      batchId,
      at,
      label: source === "recent" ? "Recently chosen" : `${sourceLabel[source]} · ${time}`,
      ids: files.map(() => uid("img")),
      accept,
      select: options.select,
    });
  };

  // Header-only validation, one file at a time (no pixels are decoded here).
  const checkingId = state.items.find((item) => item.status === "checking")?.id;
  useEffect(() => {
    const checking = itemsRef.current.find((item) => item.id === checkingId);
    if (!open || !checking) return;
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) return;
    let live = true;
    void validateRef.current(checking.file, signal).then(
      (result) => {
        if (!live) return;
        const note =
          result.ok && result.width && result.height
            ? (result.note ?? annotateRef.current?.(result.width, result.height))
            : undefined;
        dispatch(
          result.ok
            ? { ...result, type: "validated", id: checking.id, ok: true, note }
            : { type: "validated", id: checking.id, ok: false, reason: result.reason },
        );
      },
      (error: Error) => {
        if (!live || error.name === "AbortError") return;
        dispatch({ type: "validated", id: checking.id, ok: false, reason: error.message });
      },
    );
    return () => {
      live = false;
    };
  }, [open, checkingId]);

  // Revoke thumbnails for removed items.
  useEffect(() => {
    const ids = state.items.map((item) => item.id);
    cache.current?.retain(ids);
    previewCache.current?.retain(ids);
    for (const id of [...requested.current]) if (!ids.includes(id)) requested.current.delete(id);
  }, [state.items]);

  const requestThumb = useCallback((item: PickerItem) => {
    if (item.status !== "ready" || item.kind !== "image" || requested.current.has(item.id)) return;
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) return;
    requested.current.add(item.id);
    const size = { width: item.width ?? THUMB, height: item.height ?? THUMB };
    void renderThumbnail(item.file, size, THUMB, signal).then(
      (blob) => {
        if (signal.aborted || !requested.current.has(item.id)) return;
        const url = blob ? getCache().set(item.id, blob) : null;
        setThumbs((current) => ({ ...current, [item.id]: url }));
      },
      () => undefined,
    );
  }, []);

  // Lazy thumbnails: only tiles scrolled near the viewport are rendered.
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    if (!open || typeof IntersectionObserver === "undefined") return;
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.itemId;
          const item = itemsRef.current.find((candidate) => candidate.id === id);
          if (item) requestThumb(item);
        }
      },
      { rootMargin: "240px" },
    );
    return () => {
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [open, requestThumb]);
  // Re-observe tiles once validation turns them "ready".
  const readyKey = state.items.map((item) => `${item.id}:${item.status}`).join("|");
  useEffect(() => {
    const io = observer.current;
    if (!io) {
      itemsRef.current.forEach(requestThumb);
      return;
    }
    io.disconnect();
    gridRef.current
      ?.querySelectorAll<HTMLElement>("[data-item-id]")
      .forEach((el) => io.observe(el));
  }, [readyKey, tab, collection, requestThumb]);

  // Larger preview, generated on demand and released when the preview closes.
  useEffect(() => {
    if (!preview) {
      previewCache.current?.clear();
      setPreviewUrl(null);
      return;
    }
    const item = state.items.find((entry) => entry.id === preview);
    if (!item || item.status !== "ready" || item.kind !== "image") {
      setPreviewUrl(null);
      return;
    }
    const signal = controller.current?.signal;
    let live = true;
    setPreviewUrl(previewCache.current?.get(item.id) ?? null);
    void renderThumbnail(
      item.file,
      { width: item.width ?? PREVIEW, height: item.height ?? PREVIEW },
      PREVIEW,
      signal,
    ).then(
      (blob) => {
        if (!live || !blob) return;
        getPreviewCache().retain([]);
        setPreviewUrl(getPreviewCache().set(item.id, blob));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  // Grid column count drives arrow-key movement.
  const hasItems = state.items.length > 0;
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const template = getComputedStyle(grid).gridTemplateColumns;
      setColumns(Math.max(1, template.split(" ").filter(Boolean).length));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [open, tab, collection, hasItems]);

  const byId = useMemo(() => new Map(state.items.map((item) => [item.id, item])), [state.items]);
  const recentBatchIds = useMemo(
    () => new Set(state.batches.filter((b) => b.source === "recent").map((b) => b.id)),
    [state.batches],
  );
  const visible = useMemo(() => {
    if (tab === "recent") return state.items.filter((item) => recentBatchIds.has(item.batchId));
    if (tab === "selected") return state.selected.map((id) => byId.get(id)!).filter(Boolean);
    if (tab === "collections" && collection)
      return state.items.filter((item) => item.batchId === collection);
    // Newest choices first, keeping each batch's own order.
    const order = new Map(state.batches.map((batch, index) => [batch.id, index]));
    return [...state.items].sort(
      (a, b) => (order.get(b.batchId) ?? 0) - (order.get(a.batchId) ?? 0),
    );
  }, [tab, collection, state.items, state.selected, state.batches, byId, recentBatchIds]);

  const ready = canConfirm(state);
  const invalidCount = state.items.filter((item) => item.status === "invalid").length;
  const pending = state.items.some((item) => item.status === "checking");
  const count = state.selected.length;

  const confirm = () => {
    if (!ready) return;
    const files = selectedFiles(state);
    rememberRecent(files);
    onConfirm(files);
    onOpenChange(false);
  };

  const close = () => {
    // Files the user chose stay available under Recent, even when cancelled.
    const chosen = state.items.filter(
      (item) => item.status === "ready" && !recentBatchIds.has(item.batchId),
    );
    if (chosen.length) rememberRecent(chosen.map((item) => item.file));
    onOpenChange(false);
  };

  const fromInput = (source: PickerSource) => (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    addFiles(files, source);
    if (files.length) {
      setTab("photos");
      setCollection(null);
    }
  };

  const onGridKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    const item = visible[focusIndex];
    if (keys.includes(event.key)) {
      event.preventDefault();
      const next = gridMove(focusIndex, event.key, columns, visible.length);
      setFocusIndex(next);
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-index="${next}"] [data-role="toggle"]`)
        ?.focus();
    } else if ((event.key === "Delete" || event.key === "Backspace") && item) {
      event.preventDefault();
      dispatch({ type: "remove", id: item.id });
    } else if ((event.key === "p" || event.key === "P") && item) {
      event.preventDefault();
      setPreview(item.id);
    }
  };
  useEffect(() => {
    if (focusIndex >= visible.length) setFocusIndex(Math.max(0, visible.length - 1));
  }, [visible.length, focusIndex]);

  // Drag the handle down to dismiss on touch screens.
  const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    drag.current = { y: event.clientY, at: performance.now() };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setDragOffset(Math.max(0, event.clientY - drag.current.y));
  };
  const onHandleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const distance = event.clientY - drag.current.y;
    const velocity = distance / Math.max(1, performance.now() - drag.current.at);
    drag.current = null;
    const height = sheetRef.current?.offsetHeight ?? 600;
    if (distance > Math.min(160, height * 0.25) || velocity > 0.6) close();
    else setDragOffset(0);
  };

  const previewItem = preview ? byId.get(preview) : undefined;
  const previewIndex = previewItem ? visible.findIndex((item) => item.id === previewItem.id) : -1;
  const label =
    confirmLabel?.(count) ??
    (mode === "single" ? "Use image" : count ? `Import ${count}` : "Import");

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="picker-overlay" />
        <Dialog.Content
          ref={sheetRef}
          className={cn("picker-sheet", dragging && "is-dragging")}
          data-mode={mode}
          data-dragging={dragOffset ? "" : undefined}
          style={{ "--picker-drag": `${dragOffset}px` } as CSSProperties}
          onCloseAutoFocus={(event) => {
            // Return focus to whatever opened the picker.
            const target = opener.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          onEscapeKeyDown={(event) => {
            // Escape closes the preview before the picker.
            if (preview) {
              event.preventDefault();
              setPreview(null);
            }
          }}
          onDragOver={(event) => {
            if (![...event.dataTransfer.types].includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragging(false);
            const files = [...event.dataTransfer.files];
            addFiles(mode === "single" ? files.slice(0, 1) : files, "drop");
            if (files.length) setTab("photos");
          }}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (!files.length) return;
            event.preventDefault();
            event.stopPropagation();
            addFiles(mode === "single" ? files.slice(0, 1) : files, "paste");
          }}
          aria-describedby="picker-description"
        >
          <div
            className="picker-handle-zone"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={() => {
              drag.current = null;
              setDragOffset(0);
            }}
          >
            <span className="picker-handle" aria-hidden />
          </div>
          <header className="picker-header">
            <div className="min-w-0">
              <Dialog.Title className="picker-title">{title}</Dialog.Title>
              <Dialog.Description id="picker-description" className="picker-subtitle">
                {description ??
                  (mode === "single"
                    ? "Choose one image. Only the file you pick is shared with Inkstrip."
                    : "Choose images in reading order. Only files you pick are shared with Inkstrip.")}
              </Dialog.Description>
            </div>
            <button
              type="button"
              className="picker-icon-button press focus-ring"
              aria-label="Close image picker"
              onClick={close}
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="picker-tabs" role="tablist" aria-label="Picker views">
            {(
              [
                ["photos", "Photos", Images],
                ["collections", "Collections", Layers],
                ["recent", "Recent", Clock3],
                ["selected", count ? `Selected · ${count}` : "Selected", Check],
              ] as const
            ).map(([id, text, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`picker-tab-${id}`}
                aria-controls="picker-panel"
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                className="picker-tab press focus-ring"
                onClick={() => {
                  setTab(id);
                  setCollection(null);
                  setFocusIndex(0);
                }}
                onKeyDown={(event) => {
                  const order: Tab[] = ["photos", "collections", "recent", "selected"];
                  const at = order.indexOf(tab);
                  const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                  if (!delta) return;
                  event.preventDefault();
                  const next = order[(at + delta + order.length) % order.length]!;
                  setTab(next);
                  setCollection(null);
                  (
                    event.currentTarget.parentElement?.querySelector(
                      `#picker-tab-${next}`,
                    ) as HTMLElement | null
                  )?.focus();
                }}
              >
                <Icon className="size-4" aria-hidden />
                <span>{text}</span>
              </button>
            ))}
          </div>

          <div className="picker-sources">
            <button
              type="button"
              className="picker-source press focus-ring"
              disabled={disabled}
              onClick={() => photosInput.current?.click()}
            >
              <ImageIcon className="size-4" aria-hidden /> Photo library
            </button>
            <button
              type="button"
              className="picker-source press focus-ring"
              disabled={disabled}
              onClick={() => filesInput.current?.click()}
            >
              <FolderOpen className="size-4" aria-hidden /> Browse files
            </button>
            <input
              ref={photosInput}
              type="file"
              accept={photoAccept}
              multiple={mode === "multiple"}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose from photo library"
              data-picker-input="photos"
              onChange={fromInput("photos")}
            />
            <input
              ref={filesInput}
              type="file"
              accept={accept}
              multiple={mode === "multiple"}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose image files"
              data-picker-input="files"
              onChange={fromInput("files")}
            />
          </div>

          {state.notice ? (
            <p className="picker-notice" role="status">
              {state.notice}
            </p>
          ) : null}

          <div
            id="picker-panel"
            role="tabpanel"
            aria-labelledby={`picker-tab-${tab}`}
            className="picker-body"
          >
            {dragging ? (
              <div className="picker-drop" aria-hidden>
                <Images className="size-8" />
                <p>Drop to add {mode === "single" ? "an image" : "images"}</p>
              </div>
            ) : null}

            {tab === "collections" && !collection ? (
              <CollectionList
                batches={state.batches}
                items={state.items}
                thumbs={thumbs}
                onOpen={(id) => {
                  setCollection(id);
                  setFocusIndex(0);
                }}
                onSelectAll={(id) =>
                  dispatch({
                    type: "select",
                    ids: state.items.filter((i) => i.batchId === id).map((i) => i.id),
                  })
                }
                mode={mode}
                onBrowse={() => photosInput.current?.click()}
              />
            ) : tab === "selected" ? (
              <SelectedList
                items={visible}
                thumbs={thumbs}
                mode={mode}
                onMove={(id, delta) => dispatch({ type: "move", id, delta })}
                onDeselect={(id) => dispatch({ type: "deselect", id })}
                onPreview={setPreview}
                onSort={() => dispatch({ type: "sortByName" })}
                onClear={() => dispatch({ type: "clear" })}
                request={requestThumb}
              />
            ) : (
              <>
                {tab === "collections" && collection ? (
                  <div className="picker-crumb">
                    <button
                      type="button"
                      className="picker-link press focus-ring"
                      onClick={() => setCollection(null)}
                    >
                      <ChevronLeft className="size-4" aria-hidden /> Collections
                    </button>
                    <span>{state.batches.find((b) => b.id === collection)?.label}</span>
                  </div>
                ) : null}
                {tab === "recent" && visible.length ? (
                  <div className="picker-crumb">
                    <span>Kept for this tab only — nothing is stored.</span>
                    <button
                      type="button"
                      className="picker-link press focus-ring"
                      onClick={() => {
                        clearRecent();
                        for (const item of visible) dispatch({ type: "remove", id: item.id });
                      }}
                    >
                      Clear recent
                    </button>
                  </div>
                ) : null}
                {visible.length ? (
                  <div
                    ref={gridRef}
                    className="picker-grid"
                    role="group"
                    aria-label={`${visible.length} images`}
                    onKeyDown={onGridKey}
                  >
                    {visible.map((item, index) => (
                      <Tile
                        key={item.id}
                        item={item}
                        index={index}
                        focusable={index === focusIndex}
                        thumb={thumbs[item.id]}
                        order={state.selected.indexOf(item.id)}
                        mode={mode}
                        onToggle={() => {
                          setFocusIndex(index);
                          dispatch({ type: "toggle", id: item.id });
                        }}
                        onPreview={() => setPreview(item.id)}
                        onRemove={() => dispatch({ type: "remove", id: item.id })}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    tab={tab}
                    mode={mode}
                    onPhotos={() => photosInput.current?.click()}
                    onFiles={() => filesInput.current?.click()}
                  />
                )}
              </>
            )}
          </div>

          <footer className="picker-footer">
            <div className="picker-count" aria-live="polite">
              {count ? (
                <>
                  <strong>{count}</strong> selected
                  {mode === "multiple" ? (
                    <button
                      type="button"
                      className="picker-link press focus-ring"
                      onClick={() => dispatch({ type: "clear" })}
                    >
                      Clear
                    </button>
                  ) : null}
                </>
              ) : pending ? (
                "Checking images…"
              ) : invalidCount ? (
                <span className="picker-count-warn">
                  <AlertCircle className="size-4" aria-hidden /> {invalidCount} can't be imported
                </span>
              ) : (
                <span className="picker-privacy">
                  <ShieldCheck className="size-4" aria-hidden /> Only chosen files are used
                </span>
              )}
            </div>
            <div className="picker-actions">
              <button type="button" className="picker-cancel press focus-ring" onClick={close}>
                Cancel
              </button>
              <Button disabled={!ready || disabled} onClick={confirm} data-picker-confirm>
                {label}
              </Button>
            </div>
          </footer>

          {previewItem ? (
            <div
              className="picker-preview"
              role="dialog"
              aria-modal="true"
              aria-label={`Preview ${previewItem.file.name}`}
            >
              <div className="picker-preview-bar">
                <button
                  type="button"
                  className="picker-icon-button press focus-ring"
                  aria-label="Close preview"
                  autoFocus
                  onClick={() => setPreview(null)}
                >
                  <ChevronLeft className="size-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{previewItem.file.name}</p>
                  <p className="truncate text-xs text-subtle">
                    {previewItem.width && previewItem.height
                      ? `${previewItem.width} × ${previewItem.height} · `
                      : ""}
                    {formatBytes(previewItem.file.size)}
                  </p>
                </div>
                {previewItem.status === "ready" ? (
                  <Button
                    variant={state.selected.includes(previewItem.id) ? "secondary" : "primary"}
                    size="sm"
                    onClick={() => dispatch({ type: "toggle", id: previewItem.id })}
                  >
                    <Check className="size-4" />
                    {state.selected.includes(previewItem.id) ? "Selected" : "Select"}
                  </Button>
                ) : null}
              </div>
              <div className="picker-preview-stage">
                {previewItem.status === "invalid" ? (
                  <p className="picker-preview-msg">
                    <AlertCircle className="size-5" aria-hidden /> {previewItem.reason}
                  </p>
                ) : previewItem.kind === "document" ? (
                  <p className="picker-preview-msg">
                    <FileStack className="size-5" aria-hidden /> Native Inkstrip document
                  </p>
                ) : previewUrl ? (
                  <img src={previewUrl} alt={previewItem.file.name} />
                ) : thumbs[previewItem.id] === null ? (
                  <p className="picker-preview-msg">
                    Preview isn't available in this browser. The file is converted when imported.
                  </p>
                ) : (
                  <span className="picker-spinner" aria-label="Loading preview" />
                )}
                {previewIndex > 0 ? (
                  <button
                    type="button"
                    className="picker-nav prev press focus-ring"
                    aria-label="Previous image"
                    onClick={() => setPreview(visible[previewIndex - 1]!.id)}
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                ) : null}
                {previewIndex >= 0 && previewIndex < visible.length - 1 ? (
                  <button
                    type="button"
                    className="picker-nav next press focus-ring"
                    aria-label="Next image"
                    onClick={() => setPreview(visible[previewIndex + 1]!.id)}
                  >
                    <ChevronRight className="size-5" />
                  </button>
                ) : null}
              </div>
              {previewItem.note ? <p className="picker-preview-note">{previewItem.note}</p> : null}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Tile({
  item,
  index,
  focusable,
  thumb,
  order,
  mode,
  onToggle,
  onPreview,
  onRemove,
}: {
  item: PickerItem;
  index: number;
  focusable: boolean;
  thumb: string | null | undefined;
  order: number;
  mode: PickerMode;
  onToggle: () => void;
  onPreview: () => void;
  onRemove: () => void;
}) {
  const selected = order >= 0;
  const invalid = item.status === "invalid";
  const name = item.file.name || "Image";
  const state = invalid
    ? `cannot be imported: ${item.reason}`
    : item.status === "checking"
      ? "checking"
      : selected
        ? mode === "multiple"
          ? `selected, number ${order + 1}`
          : "selected"
        : "not selected";
  return (
    <div
      className="picker-tile"
      data-item-id={item.id}
      data-index={index}
      data-selected={selected || undefined}
      data-status={item.status}
    >
      <button
        type="button"
        data-role="toggle"
        className="picker-tile-main focus-ring"
        tabIndex={focusable ? 0 : -1}
        aria-pressed={selected}
        aria-disabled={invalid || undefined}
        aria-label={`${name}, ${state}`}
        onClick={onToggle}
      >
        {item.status === "checking" ? (
          <span className="picker-skeleton" aria-hidden />
        ) : item.kind === "document" ? (
          <span className="picker-placeholder" aria-hidden>
            <FileStack className="size-7" />
            <span>.inkstrip</span>
          </span>
        ) : thumb ? (
          <img src={thumb} alt="" draggable={false} decoding="async" />
        ) : thumb === null || invalid ? (
          <span className="picker-placeholder" aria-hidden>
            {invalid ? <AlertCircle className="size-6" /> : <ImageIcon className="size-6" />}
            <span>{name.split(".").pop()?.toUpperCase().slice(0, 5)}</span>
          </span>
        ) : (
          <span className="picker-skeleton" aria-hidden />
        )}
        {invalid ? (
          <span className="picker-tile-error" aria-hidden>
            {item.reason}
          </span>
        ) : item.note ? (
          <span className="picker-tile-note" aria-hidden title={item.note}>
            {/* Full note is in the preview and Selected list; tiles show the headline. */}
            {item.note.split(":")[0]}
          </span>
        ) : null}
        <span className="picker-check" aria-hidden>
          {selected ? mode === "multiple" ? order + 1 : <Check className="size-4" /> : null}
        </span>
      </button>
      <button
        type="button"
        className="picker-tile-action press focus-ring"
        tabIndex={-1}
        aria-label={invalid ? `Remove ${name}` : `Preview ${name}`}
        onClick={invalid ? onRemove : onPreview}
      >
        {invalid ? <Trash2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  );
}

function SelectedList({
  items,
  thumbs,
  mode,
  onMove,
  onDeselect,
  onPreview,
  onSort,
  onClear,
  request,
}: {
  items: PickerItem[];
  thumbs: Record<string, string | null>;
  mode: PickerMode;
  onMove: (id: string, delta: number) => void;
  onDeselect: (id: string) => void;
  onPreview: (id: string) => void;
  onSort: () => void;
  onClear: () => void;
  request: (item: PickerItem) => void;
}) {
  useEffect(() => items.forEach(request), [items, request]);
  if (!items.length)
    return (
      <div className="picker-empty">
        <Check className="size-8" aria-hidden />
        <p className="picker-empty-title">Nothing selected yet</p>
        <p>Tap images in Photos to select them.</p>
      </div>
    );
  return (
    <>
      {mode === "multiple" ? (
        <div className="picker-crumb">
          <span>Imported top to bottom in this order.</span>
          <span className="flex gap-1">
            <button type="button" className="picker-link press focus-ring" onClick={onSort}>
              <ArrowDownAZ className="size-4" aria-hidden /> Sort by name
            </button>
            <button type="button" className="picker-link press focus-ring" onClick={onClear}>
              Clear
            </button>
          </span>
        </div>
      ) : null}
      <ol className="picker-selected" aria-label="Selected images in import order">
        {items.map((item, index) => (
          <li key={item.id} className="picker-row">
            <span className="picker-row-index" aria-hidden>
              {index + 1}
            </span>
            <button
              type="button"
              className="picker-row-thumb press focus-ring"
              aria-label={`Preview ${item.file.name}`}
              onClick={() => onPreview(item.id)}
            >
              {thumbs[item.id] ? (
                <img src={thumbs[item.id]!} alt="" decoding="async" />
              ) : (
                <ImageIcon className="size-5" aria-hidden />
              )}
            </button>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg">{item.file.name}</span>
              <span className="block truncate text-xs text-subtle">
                {item.width && item.height ? `${item.width} × ${item.height} · ` : ""}
                {formatBytes(item.file.size)}
                {item.note ? ` · ${item.note}` : ""}
              </span>
            </span>
            {mode === "multiple" ? (
              <>
                <button
                  type="button"
                  className="picker-icon-button press focus-ring"
                  aria-label={`Move ${item.file.name} up`}
                  disabled={index === 0}
                  onClick={() => onMove(item.id, -1)}
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  className="picker-icon-button press focus-ring"
                  aria-label={`Move ${item.file.name} down`}
                  disabled={index === items.length - 1}
                  onClick={() => onMove(item.id, 1)}
                >
                  <ArrowDown className="size-4" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="picker-icon-button press focus-ring"
              aria-label={`Remove ${item.file.name} from selection`}
              onClick={() => onDeselect(item.id)}
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

function CollectionList({
  batches,
  items,
  thumbs,
  onOpen,
  onSelectAll,
  mode,
  onBrowse,
}: {
  batches: { id: string; label: string; source: PickerSource }[];
  items: PickerItem[];
  thumbs: Record<string, string | null>;
  onOpen: (id: string) => void;
  onSelectAll: (id: string) => void;
  mode: PickerMode;
  onBrowse: () => void;
}) {
  if (!batches.length)
    return (
      <div className="picker-empty">
        <Layers className="size-8" aria-hidden />
        <p className="picker-empty-title">No collections yet</p>
        <p>Each set of images you choose, drop or paste becomes a collection here.</p>
        <Button variant="secondary" onClick={onBrowse}>
          <ImageIcon className="size-4" /> Choose images
        </Button>
      </div>
    );
  return (
    <ul className="picker-collections">
      {[...batches].reverse().map((batch) => {
        const members = items.filter((item) => item.batchId === batch.id);
        const covers = members
          .map((item) => thumbs[item.id])
          .filter(Boolean)
          .slice(0, 3);
        return (
          <li key={batch.id} className="picker-collection">
            <button
              type="button"
              className="picker-collection-main press focus-ring"
              onClick={() => onOpen(batch.id)}
            >
              <span className="picker-mosaic" aria-hidden>
                {covers.length ? (
                  covers.map((url) => <img key={url} src={url!} alt="" />)
                ) : (
                  <Images className="size-6" />
                )}
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm text-fg">{batch.label}</span>
                <span className="block text-xs text-subtle">
                  {members.length} {members.length === 1 ? "image" : "images"}
                </span>
              </span>
              <ChevronRight className="size-4 text-subtle" aria-hidden />
            </button>
            {mode === "multiple" ? (
              <Button variant="ghost" size="sm" onClick={() => onSelectAll(batch.id)}>
                Select all
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({
  tab,
  mode,
  onPhotos,
  onFiles,
}: {
  tab: Tab;
  mode: PickerMode;
  onPhotos: () => void;
  onFiles: () => void;
}) {
  if (tab === "recent")
    return (
      <div className="picker-empty">
        <Clock3 className="size-8" aria-hidden />
        <p className="picker-empty-title">No recent images</p>
        <p>Images you choose are listed here until you close this tab. Nothing is stored.</p>
      </div>
    );
  return (
    <div className="picker-empty picker-empty-hero">
      <span className="picker-empty-art" aria-hidden>
        <Images className="size-9" />
      </span>
      <p className="picker-empty-title">
        {mode === "single" ? "Choose an image" : "Add your pages"}
      </p>
      <p>
        Pick from your photo library or files. Inkstrip only sees what you choose — originals are
        imported at full quality.
      </p>
      <div className="picker-empty-actions">
        <Button onClick={onPhotos}>
          <ImageIcon className="size-4" /> Photo library
        </Button>
        <Button variant="secondary" onClick={onFiles}>
          <FolderOpen className="size-4" /> Browse files
        </Button>
      </div>
      <p className="picker-drop-hint">or drop / paste images here</p>
    </div>
  );
}
