import { useEffect, useRef } from "react";
import { Pencil, Sparkles, Paintbrush, PenTool, MoreHorizontal, Rows3 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { LONG_PRESS_MS, withinPress } from "@/lib/studio/editor/gestures";
import type { Panel } from "@/lib/studio/types";
import { useLegacyVector } from "@/lib/studio/legacy-vector";

export function PanelImageActions({
  panel,
  thumb,
  disabled,
  selected,
  menu,
  onMenu,
  onToggle,
  onEdit,
  onEnhance,
  onStudio,
  splitParts,
  onSplit,
}: {
  panel: Panel;
  thumb?: string;
  disabled: boolean;
  selected: boolean;
  /** The image tools menu is controlled so the row's explicit options button can open it. */
  menu: boolean;
  onMenu: (open: boolean) => void;
  onToggle: () => void;
  onEdit: () => void;
  onEnhance: () => void;
  onStudio: (mode: "raster" | "vector") => void;
  /** Parts a lossless split would create when the image is over Raster's limit. */
  splitParts?: number;
  onSplit?: () => void;
}) {
  const setMenu = onMenu;
  const legacyVector = useLegacyVector();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const suppress = useRef(false);
  const ignoreOutsideUntil = useRef(0);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => {
    const stop = () => cancel();
    // Opening a menu under a held finger must not activate an action on release.
    const blockOpeningClick = (event: MouseEvent) => {
      if (event.detail && Date.now() < ignoreOutsideUntil.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        ignoreOutsideUntil.current = 0;
      }
    };
    const nextPress = () => {
      if (ignoreOutsideUntil.current !== Infinity) ignoreOutsideUntil.current = 0;
    };
    window.addEventListener("click", blockOpeningClick, true);
    window.addEventListener("pointerdown", nextPress, true);
    const release = () => {
      if (ignoreOutsideUntil.current === Infinity) ignoreOutsideUntil.current = Date.now() + 300;
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("scroll", stop, true);
    window.addEventListener("dragstart", stop);
    return () => {
      cancel();
      window.removeEventListener("click", blockOpeningClick, true);
      window.removeEventListener("pointerdown", nextPress, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("scroll", stop, true);
      window.removeEventListener("dragstart", stop);
    };
  }, []);
  return (
    <>
      <button
        type="button"
        className="panel-image-target focus-ring min-w-0 flex-1 text-left"
        disabled={disabled}
        // A click toggles selection, so the target is named and exposed as a selection
        // toggle; image options have their own button (PanelOptionsButton, INK-AUD-006).
        // Context menu, Shift+F10 and long press still open the options here too.
        aria-label={`Select image ${panel.name}`}
        aria-pressed={selected}
        aria-keyshortcuts="E Shift+F10"
        onClick={() => {
          if (!suppress.current) onToggle();
        }}
        onDoubleClick={() => {
          cancel();
          if (!disabled) onEdit();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          cancel();
          if (!disabled) setMenu(true);
        }}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() === "e" && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            onEdit();
          } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            event.preventDefault();
            setMenu(true);
          }
        }}
        onPointerDown={(event) => {
          suppress.current = false;
          if (disabled || event.pointerType === "mouse") return;
          if (start.current) {
            cancel();
            return;
          }
          start.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
          timer.current = setTimeout(() => {
            if (start.current) {
              suppress.current = true;
              ignoreOutsideUntil.current = Infinity;
              cancel();
              navigator.vibrate?.(12);
              setMenu(true);
            }
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(event) => {
          if (
            start.current?.pointer === event.pointerId &&
            !withinPress(start.current, { x: event.clientX, y: event.clientY })
          )
            cancel();
        }}
        onPointerUp={(event) => {
          if (start.current?.pointer === event.pointerId) cancel();
        }}
        onPointerCancel={(event) => {
          if (start.current?.pointer === event.pointerId) cancel();
        }}
        onPointerLeave={(event) => {
          if (start.current?.pointer === event.pointerId) cancel();
        }}
      >
        <span className="flex items-center gap-2">
          {thumb ? (
            <img
              draggable={false}
              src={thumb}
              alt=""
              className="h-16 w-12 shrink-0 rounded-sm bg-paper object-cover object-top"
            />
          ) : (
            <span className="h-16 w-12 shrink-0 rounded-sm bg-paper" />
          )}
          <span className="panel-image-info min-w-0">
            <span className="panel-image-name block truncate text-sm text-fg" title={panel.name}>
              {panel.name}
            </span>
            <span className="mt-1 block text-xs text-subtle tabular-nums">
              {panel.width} × {panel.height}
              {panel.edit ? " · edited" : ""}
            </span>
          </span>
        </span>
      </button>
      <div className="panel-quick-actions flex shrink-0 flex-col">
        <button
          type="button"
          aria-label={`Edit Image ${panel.name}`}
          title="Edit image (E)"
          className="focus-ring grid size-11 place-items-center rounded-sm text-fg hover:bg-bg-subtle"
          disabled={disabled}
          onClick={onEdit}
        >
          <Pencil className="size-4" />
        </button>
        <button
          type="button"
          aria-label={`AI Enhance ${panel.name}`}
          title="AI Enhance"
          className="focus-ring grid size-11 place-items-center rounded-sm text-accent hover:bg-accent/10"
          disabled={disabled}
          onClick={onEnhance}
        >
          <Sparkles className="size-4" />
        </button>
      </div>
      <Modal open={menu} onOpenChange={setMenu} title="Image tools" description={panel.name}>
        <div className="flex flex-col gap-2">
          <Button
            onClick={() => {
              setMenu(false);
              onEdit();
            }}
          >
            <Pencil className="size-4" />
            Edit Image
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setMenu(false);
              onStudio("raster");
            }}
          >
            <Paintbrush className="size-4" />
            Open in Raster Studio
          </Button>
          {!!splitParts && onSplit && (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setMenu(false);
                  onSplit();
                }}
              >
                <Rows3 className="size-4" />
                Split into {splitParts} editable pages
              </Button>
              <p className="text-xs text-muted">
                This image is over Raster Studio&apos;s limit on this device. Splitting adds{" "}
                {splitParts} full-width PNG pages below it, pixel for pixel; the original stays
                unchanged.
              </p>
            </>
          )}
          {legacyVector && (
            <Button
              variant="secondary"
              onClick={() => {
                setMenu(false);
                onStudio("vector");
              }}
            >
              <PenTool className="size-4" />
              Open in Vector Studio
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              setMenu(false);
              onEnhance();
            }}
          >
            <Sparkles className="size-4" />
            AI Enhance
          </Button>
          <p className="mt-2 text-xs text-muted">
            Edit without changing the imported original. Use the chapter arrows or desktop drag to
            reorder.
          </p>
        </div>
      </Modal>
    </>
  );
}

/** The explicit, accurately named trigger for an image's tools menu (INK-AUD-006). */
export function PanelOptionsButton({
  name,
  open,
  disabled,
  onOpen,
}: {
  name: string;
  open: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Image options for ${name}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Image options (Shift+F10)"
      className="focus-ring grid size-11 place-items-center rounded-sm text-fg hover:bg-bg-subtle"
      disabled={disabled}
      onClick={onOpen}
    >
      <MoreHorizontal className="size-4" />
    </button>
  );
}
