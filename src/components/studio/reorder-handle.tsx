import { useEffect, useRef } from "react";
import { GripVertical } from "lucide-react";
import { insertPanel } from "@/lib/studio/order";
export type DragPosition = { from: string; to: string; after: boolean; x: number; y: number };
/** Pointer capture belongs only to the visible handle. Ordinary image scrolling remains native. */
export function ReorderHandle({
  id,
  name,
  ids,
  disabled,
  onPosition,
  onCommit,
}: {
  id: string;
  name: string;
  ids: string[];
  disabled: boolean;
  onPosition: (p: DragPosition | null) => void;
  onCommit: (ids: string[]) => void;
}) {
  const active = useRef<{
      pointer: number;
      x: number;
      y: number;
      moved: boolean;
      position: DragPosition | null;
    } | null>(null),
    frame = useRef(0);
  const callbacks = useRef({ onPosition, onCommit });
  callbacks.current = { onPosition, onCommit };
  const cancel = () => {
    active.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    callbacks.current.onPosition(null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      cancelAnimationFrame(frame.current);
    };
  }, []);
  const update = (x: number, y: number) => {
    const rows = [...document.querySelectorAll<HTMLElement>("[data-order-panel]")].filter(
      (el) => el.dataset.orderPanel !== id,
    );
    let row = rows.find((el) => {
      const r = el.getBoundingClientRect();
      return y >= r.top && y <= r.bottom;
    });
    if (!row)
      row = rows.reduce<HTMLElement | undefined>(
        (best, el) =>
          !best ||
          Math.abs(el.getBoundingClientRect().top - y) <
            Math.abs(best.getBoundingClientRect().top - y)
            ? el
            : best,
        undefined,
      );
    if (!row || !active.current) return;
    const r = row.getBoundingClientRect(),
      position = { from: id, to: row.dataset.orderPanel!, after: y > r.top + r.height / 2, x, y };
    active.current.position = position;
    callbacks.current.onPosition(position);
  };
  const tick = () => {
    const a = active.current;
    if (!a?.moved || !a.position) return;
    const p = a.position;
    const sidebar = document.querySelector<HTMLElement>(".studio-aside");
    if (sidebar) {
      const r = sidebar.getBoundingClientRect(),
        top = Math.max(0, r.top),
        bottom = Math.min(innerHeight, r.bottom);
      const dy = p.y < top + 72 ? -14 : p.y > bottom - 72 ? 14 : 0;
      if (dy) {
        if (sidebar.scrollHeight > sidebar.clientHeight) sidebar.scrollTop += dy;
        else window.scrollBy(0, dy);
        update(p.x, p.y);
      }
    }
    frame.current = requestAnimationFrame(tick);
  };
  return (
    <button
      type="button"
      className="reorder-handle focus-ring"
      aria-label={`Drag to reorder ${name}`}
      title="Drag handle; Escape cancels. Use arrows to reorder with a keyboard."
      disabled={disabled}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        active.current = {
          pointer: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          moved: false,
          position: null,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const a = active.current;
        if (!a || a.pointer !== e.pointerId) return;
        if (!a.moved && Math.hypot(e.clientX - a.x, e.clientY - a.y) < 8) return;
        if (!a.moved) {
          a.moved = true;
          navigator.vibrate?.(12);
          frame.current = requestAnimationFrame(tick);
        }
        update(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        const a = active.current;
        if (!a || a.pointer !== e.pointerId) return;
        const pos = a.position;
        if (a.moved && pos) callbacks.current.onCommit(insertPanel(ids, id, pos.to, pos.after));
        cancel();
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      <GripVertical className="size-4" />
    </button>
  );
}
