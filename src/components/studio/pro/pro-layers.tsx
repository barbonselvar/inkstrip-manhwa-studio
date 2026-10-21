import { useEffect, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Alert from "@radix-ui/react-alert-dialog";
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  GripVertical,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Link2,
  Layers3,
  Copy,
  Trash2,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProDocument, ProSession } from "@/lib/studio/pro/model";
import { isLocked } from "@/lib/studio/pro/operations";
import {
  clipBase,
  setClipping,
  linkLayers,
  unlinkLayers,
  moveLayers,
  reorderLayers,
  reparentLayers,
  type MergeMode,
} from "@/lib/studio/pro/layers";
import { ProRenderer } from "@/lib/studio/pro/client";
export function ProLayers({
  doc,
  session,
  selectedIds,
  onSelect,
  onChange,
  onError,
  onDuplicate,
  onDelete,
  onGroup,
  onUngroup,
  onCompound,
  onMerge,
  onAdd,
  disabled,
  maxArea,
}: {
  doc: ProDocument;
  session: ProSession;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onChange: (doc: ProDocument, label: string) => void;
  onError: (message: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onCompound: (operation: "create" | "release") => void;
  onMerge: (mode: MergeMode) => void;
  onAdd: (kind: "paint" | "text" | "gradient" | "adjustment") => void;
  disabled: boolean;
  maxArea: number;
}) {
  const [multi, setMulti] = useState(false),
    [collapsed, setCollapsed] = useState(new Set<string>()),
    [menuId, setMenuId] = useState(""),
    [flatten, setFlatten] = useState(false),
    [drop, setDrop] = useState<{ id: string; edge: "before" | "after" } | null>(null),
    [thumbs, setThumbs] = useState<Record<string, string>>({});
  const assets = session.assets;
  const urls = useRef<string[]>([]),
    tree = useRef<HTMLDivElement>(null),
    dragging = useRef<string[]>([]),
    touch = useRef<{ pointer: number; y: number; moved: boolean } | null>(null),
    dragPoint = useRef<{ x: number; y: number } | null>(null),
    scrollFrame = useRef<number | null>(null),
    dropRef = useRef(drop),
    anchor = useRef("");
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    if (disabled) return;
    let active = true,
      worker: ProRenderer | undefined;
    const timer = setTimeout(() => {
      try {
        worker = new ProRenderer();
        void worker
          .init(
            { document: doc, assets, revision: 0, acceptedBlobId: "thumbnail", updatedAt: 0 },
            maxArea,
          )
          .then(() => worker!.thumbnails(doc, maxArea))
          .then((r) => {
            if (!active || !r.thumbnails) return;
            const entries = r.thumbnails.map((t) => [t.id, URL.createObjectURL(t.blob)] as const);
            urls.current.forEach((url) => URL.revokeObjectURL(url));
            urls.current = entries.map(([, url]) => url);
            setThumbs(Object.fromEntries(entries));
          })
          .catch(() => {
            /* Keep previous thumbnails; full rendering owns actionable errors. */
          })
          .finally(() => worker?.dispose());
      } catch {
        /* Unsupported workers retain clear kind icons. */
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
      worker?.dispose();
    };
  }, [doc, assets, maxArea, disabled]);
  const active = doc.layers.find((l) => l.id === selectedIds[0]);
  const run = (task: () => ProDocument, label: string) => {
    if (disabled) return;
    try {
      onChange(task(), label);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const choose = (id: string, toggle = false, range = false) => {
    if (disabled) return;
    if (range && anchor.current) {
      const l = doc.layers.find((l) => l.id === id),
        a = doc.layers.find((l) => l.id === anchor.current);
      if (l && a && l.parentId === a.parentId) {
        const list = doc.layers.filter((c) => c.parentId === l.parentId),
          start = list.indexOf(a),
          end = list.indexOf(l);
        onSelect([
          id,
          ...list
            .slice(Math.min(start, end), Math.max(start, end) + 1)
            .filter((c) => c.id !== id)
            .map((c) => c.id),
        ]);
        return;
      }
    }
    onSelect(
      toggle || multi
        ? selectedIds.includes(id)
          ? selectedIds.filter((i) => i !== id)
          : [...selectedIds, id]
        : [id],
    );
    anchor.current = id;
  };
  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );
  const markDrop = (x: number, y: number) => {
    const scroll = tree.current?.closest<HTMLElement>(".pro-panel-content"),
      bounds = scroll?.getBoundingClientRect();
    const hitY = bounds ? Math.max(bounds.top + 3, Math.min(bounds.bottom - 3, y)) : y;

    const row =
        document.elementFromPoint(x, hitY)?.closest<HTMLElement>("[data-layer-id]") ??
        (bounds && x >= bounds.left && x <= bounds.right
          ? [...(tree.current?.querySelectorAll<HTMLElement>("[data-layer-id]") ?? [])]
              .filter(
                (r) =>
                  r.getBoundingClientRect().bottom > bounds.top &&
                  r.getBoundingClientRect().top < bounds.bottom,
              )
              .sort(
                (a, b) =>
                  Math.abs(a.getBoundingClientRect().top - hitY) -
                  Math.abs(b.getBoundingClientRect().top - hitY),
              )[0]
          : undefined),
      id = row?.dataset.layerId;
    const next =
      row && id
        ? {
            id,
            edge:
              y < row.getBoundingClientRect().top + row.offsetHeight / 2
                ? ("after" as const)
                : ("before" as const),
          }
        : null;
    dropRef.current = next;
    setDrop((old) => (old?.id === next?.id && old?.edge === next?.edge ? old : next));
    if (scroll) {
      const b = scroll.getBoundingClientRect();
      if (y < b.top + 48) scroll.scrollTop -= 10;
      else if (y > b.bottom - 48) scroll.scrollTop += 10;
    }
  };
  const startScroll = () => {
    if (scrollFrame.current !== null) return;
    const tick = () => {
      scrollFrame.current = null;
      if (!dragging.current.length || !dragPoint.current) return;
      if (!touch.current || touch.current.moved) markDrop(dragPoint.current.x, dragPoint.current.y);
      scrollFrame.current = requestAnimationFrame(tick);
    };
    scrollFrame.current = requestAnimationFrame(tick);
  };
  const stopScroll = () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    dragPoint.current = null;
  };
  const finishDrop = () => {
    stopScroll();
    if (dropRef.current && dragging.current.length)
      run(
        () => reorderLayers(doc, dragging.current, dropRef.current!.id, dropRef.current!.edge),
        "Reorder layers",
      );
    dropRef.current = null;
    setDrop(null);
    dragging.current = [];
    touch.current = null;
  };
  const rootMenu = (ids: string[]) => {
    if (!selectedIds.includes(ids[0]!)) onSelect(ids);
  };
  const branch = (parent?: string, depth = 0): React.ReactNode =>
    doc.layers
      .filter((l) => l.parentId === parent)
      .slice()
      .reverse()
      .map((l) => (
        <div key={l.id}>
          <div
            className="pro-layer-row pro-layer-managed"
            data-layer-id={l.id}
            data-active={selectedIds.includes(l.id)}
            data-drop={drop?.id === l.id ? drop.edge : undefined}
            style={{ paddingLeft: 4 + depth * 10 }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!disabled && !touch.current) {
                rootMenu([l.id]);
                setMenuId(l.id);
              }
            }}
            onDragOver={(e) => {
              if (dragging.current.length) {
                dragPoint.current = { x: e.clientX, y: e.clientY };
                e.preventDefault();
                markDrop(e.clientX, e.clientY);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              finishDrop();
            }}
          >
            <div className="pro-layer-line">
              <label className="pro-layer-check">
                <input
                  type="checkbox"
                  aria-label={`Select layer ${l.name}`}
                  checked={selectedIds.includes(l.id)}
                  disabled={disabled}
                  onChange={() => choose(l.id, true)}
                />
              </label>
              <button
                className="pro-layer-select"
                type="button"
                aria-pressed={selectedIds.includes(l.id)}
                disabled={disabled}
                onClick={(e) => choose(l.id, e.ctrlKey || e.metaKey, e.shiftKey)}
              >
                {thumbs[l.id] ? (
                  <img className="pro-layer-thumb" src={thumbs[l.id]} alt="" />
                ) : (
                  <Layers3 className="pro-layer-thumb" />
                )}
                <span>
                  {l.name}
                  <small>
                    {l.kind}
                    {l.mask ? " · masked" : ""}
                    {l.clipped ? " · clipped" : ""}
                  </small>
                </span>
              </button>
              <button
                type="button"
                aria-label={`${l.visible ? "Hide" : "Show"} layer ${l.name}`}
                disabled={disabled || (l.parentId ? isLocked(doc, l.parentId) : false)}
                onClick={() =>
                  run(
                    () => ({
                      ...doc,
                      layers: doc.layers.map((x) =>
                        x.id === l.id ? { ...x, visible: !x.visible } : x,
                      ),
                    }),
                    "Toggle visibility",
                  )
                }
              >
                {l.visible ? <Eye /> : <EyeOff />}
              </button>
              <Menu.Root
                open={menuId === l.id}
                onOpenChange={(v) => {
                  if (v) rootMenu([l.id]);
                  setMenuId(v ? l.id : "");
                }}
              >
                <Menu.Trigger asChild>
                  <button type="button" disabled={disabled} aria-label={`Layer actions ${l.name}`}>
                    <MoreHorizontal />
                  </button>
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content
                    className="pro-layer-menu"
                    sideOffset={6}
                    align="end"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <Menu.Label>Layer actions</Menu.Label>
                    <Menu.Item onSelect={onDuplicate}>Duplicate selected</Menu.Item>
                    <Menu.Item
                      onSelect={() =>
                        run(
                          () => setClipping(doc, selectedIds, !l.clipped),
                          l.clipped ? "Release clipping mask" : "Create clipping mask",
                        )
                      }
                    >
                      {l.clipped ? "Release clipping mask" : "Create clipping mask"}
                    </Menu.Item>
                    <Menu.Item
                      onSelect={() => run(() => linkLayers(doc, selectedIds), "Link layers")}
                    >
                      Link selected
                    </Menu.Item>
                    <Menu.Item
                      onSelect={() => run(() => unlinkLayers(doc, selectedIds), "Unlink layers")}
                    >
                      Unlink selected
                    </Menu.Item>
                    <Menu.Item onSelect={onGroup}>Group selected</Menu.Item>
                    <Menu.Item disabled={active?.kind !== "group"} onSelect={onUngroup}>
                      Ungroup selected
                    </Menu.Item>
                    <Menu.Separator />
                    <Menu.Item onSelect={() => onMerge("selected")}>
                      Merge selected layers
                    </Menu.Item>
                    <Menu.Item onSelect={() => onMerge("visible")}>Merge visible layers</Menu.Item>
                    <Menu.Item onSelect={() => setFlatten(true)}>Flatten image…</Menu.Item>
                    <Menu.Separator />
                    <Menu.Item onSelect={onDelete}>Delete selected</Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
            </div>
            <div className="pro-layer-details">
              {l.kind === "group" && (
                <button
                  type="button"
                  aria-label={`${collapsed.has(l.id) ? "Expand" : "Collapse"} group ${l.name}`}
                  onClick={() =>
                    setCollapsed((old) => {
                      const n = new Set(old);
                      if (n.has(l.id)) n.delete(l.id);
                      else n.add(l.id);
                      return n;
                    })
                  }
                >
                  {collapsed.has(l.id) ? <ChevronRight /> : <ChevronDown />}
                </button>
              )}
              {l.clipped && (
                <span
                  className="pro-layer-indicator"
                  title={`Clipped to ${clipBase(doc, l.id)?.name ?? "no base (hidden)"}`}
                >
                  <CornerDownRight />
                  {clipBase(doc, l.id)?.name ?? "No base"}
                </span>
              )}
              {l.linkId && (
                <span
                  className="pro-layer-indicator"
                  aria-label={`Linked layer ${l.name}`}
                  title="Linked layers move together"
                >
                  <Link2 />
                </span>
              )}
              {selectedIds.includes(l.id) && (
                <>
                  <button
                    type="button"
                    aria-label={`${l.locked ? "Unlock" : "Lock"} layer ${l.name}`}
                    disabled={disabled || (l.parentId ? isLocked(doc, l.parentId) : false)}
                    onClick={() =>
                      run(
                        () => ({
                          ...doc,
                          layers: doc.layers.map((x) =>
                            x.id === l.id ? { ...x, locked: !x.locked } : x,
                          ),
                        }),
                        "Toggle layer lock",
                      )
                    }
                  >
                    {l.locked ? <Lock /> : <Unlock />}
                  </button>
                  <button
                    type="button"
                    className="pro-layer-grip"
                    aria-label={`Drag layer ${l.name}`}
                    title="Drag to reorder; use arrows with a keyboard"
                    disabled={disabled || isLocked(doc, l.id)}
                    draggable={!disabled && !isLocked(doc, l.id)}
                    onDragStart={(e) => {
                      dragging.current = selectedIds.includes(l.id) ? selectedIds : [l.id];
                      dragPoint.current = { x: e.clientX, y: e.clientY };
                      startScroll();
                      e.dataTransfer.setData("text/plain", l.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      stopScroll();
                      dragging.current = [];
                      setDrop(null);
                      dropRef.current = null;
                    }}
                    onPointerDown={(e) => {
                      if (e.pointerType === "mouse") return;
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      dragging.current = selectedIds.includes(l.id) ? selectedIds : [l.id];
                      touch.current = { pointer: e.pointerId, y: e.clientY, moved: false };
                      dragPoint.current = { x: e.clientX, y: e.clientY };
                      startScroll();
                    }}
                    onPointerMove={(e) => {
                      if (!touch.current || touch.current.pointer !== e.pointerId) return;
                      if (Math.abs(e.clientY - touch.current.y) > 6) touch.current.moved = true;
                      dragPoint.current = { x: e.clientX, y: e.clientY };
                      if (touch.current.moved) markDrop(e.clientX, e.clientY);
                    }}
                    onPointerUp={(e) => {
                      if (touch.current?.pointer !== e.pointerId) return;
                      if (touch.current.moved) finishDrop();
                      else {
                        stopScroll();
                        touch.current = null;
                        dragging.current = [];
                      }
                    }}
                    onPointerCancel={() => {
                      stopScroll();
                      touch.current = null;
                      dragging.current = [];
                      dropRef.current = null;
                      setDrop(null);
                    }}
                  >
                    <GripVertical />
                  </button>
                </>
              )}
            </div>
          </div>
          {l.kind === "group" && !collapsed.has(l.id) ? branch(l.id, depth + 1) : null}
        </div>
      ));
  return (
    <div
      className="pro-layer-controls"
      onKeyDown={(e) => {
        if (
          e.code === "Space" &&
          (e.target as HTMLElement).closest('button,[role="menu"],[role="alertdialog"]')
        )
          e.stopPropagation();
      }}
    >
      <div className="pro-section-heading">
        <h3>Document layers</h3>
        <span>{doc.layers.length} / 48</span>
      </div>
      <div className="pro-actions">
        <Button
          variant="ghost"
          aria-pressed={multi}
          disabled={disabled}
          onClick={() => setMulti(!multi)}
        >
          Multi-select
        </Button>
        <span className="pro-help" aria-live="polite">
          {selectedIds.length} selected
        </span>
      </div>
      <p className="pro-help">
        Top row is in front. Use checkboxes, Shift-click a range or Ctrl-click. Drag a grip or use
        arrows. Clipped layers share their base’s alpha.
      </p>
      <div ref={tree} className="pro-layer-tree" role="group" aria-label="Layer stack">
        {branch()}
      </div>
      <div className="pro-actions">
        <Button
          variant="secondary"
          disabled={disabled || selectedIds.length < 2}
          onClick={() => onCompound("create")}
        >
          Create compound path
        </Button>
        <Button
          variant="ghost"
          disabled={disabled || !active?.subpaths?.length}
          onClick={() => onCompound("release")}
        >
          Release compound path
        </Button>
      </div>
      <p className="pro-help">
        Compound paths use the bottom selected shape’s fill and stroke. Releasing fills holes as
        separate shapes. Both operations change appearance and are undoable.
      </p>
      <div className="pro-actions">
        <Button variant="secondary" disabled={disabled} onClick={() => onAdd("paint")}>
          Paint layer
        </Button>
        <Button variant="secondary" disabled={disabled} onClick={() => onAdd("text")}>
          Text layer
        </Button>
        <Button variant="secondary" disabled={disabled} onClick={() => onAdd("gradient")}>
          Gradient layer
        </Button>
        <Button variant="secondary" disabled={disabled} onClick={() => onAdd("adjustment")}>
          Adjustment layer
        </Button>
        <Button
          variant="ghost"
          aria-label="Bring layer forward"
          disabled={disabled || !active}
          onClick={() => run(() => moveLayers(doc, selectedIds, 1), "Bring forward")}
        >
          <ChevronUp />
        </Button>
        <Button
          variant="ghost"
          aria-label="Send layer backward"
          disabled={disabled || !active}
          onClick={() => run(() => moveLayers(doc, selectedIds, -1), "Send backward")}
        >
          <ChevronDown />
        </Button>
        <Button variant="ghost" disabled={disabled || !active} onClick={onDuplicate}>
          <Copy />
          Duplicate
        </Button>
        <Button variant="danger" disabled={disabled || !active} onClick={onDelete}>
          <Trash2 />
          Delete
        </Button>
        <Button variant="secondary" disabled={disabled || selectedIds.length < 2} onClick={onGroup}>
          Group selected
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || active?.kind !== "group"}
          onClick={onUngroup}
        >
          Ungroup
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || !active}
          onClick={() =>
            run(
              () => setClipping(doc, selectedIds, !active?.clipped),
              active?.clipped ? "Release clipping mask" : "Create clipping mask",
            )
          }
        >
          {active?.clipped ? "Release clipping mask" : "Create clipping mask"}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || selectedIds.length < 2}
          onClick={() => run(() => linkLayers(doc, selectedIds), "Link layers")}
        >
          <Link2 />
          Link layers
        </Button>
        <Button
          variant="ghost"
          disabled={disabled || !active?.linkId}
          onClick={() => run(() => unlinkLayers(doc, selectedIds), "Unlink layers")}
        >
          Unlink layers
        </Button>
      </div>
      <label className="pro-field">
        Move selected to group
        <select
          className="field"
          aria-label="Move selected to group"
          value=""
          disabled={disabled || !active}
          onChange={(e) => {
            if (e.target.value)
              run(
                () =>
                  reparentLayers(
                    doc,
                    selectedIds,
                    e.target.value === "root" ? undefined : e.target.value,
                  ),
                "Move layers to group",
              );
          }}
        >
          <option value="">Choose destination…</option>
          <option value="root">Top level</option>
          {doc.layers
            .filter((l) => l.kind === "group")
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
        </select>
      </label>
      <div className="pro-actions">
        <Button
          variant="secondary"
          disabled={disabled || !active}
          onClick={() => onMerge("selected")}
        >
          Merge selected
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || !doc.layers.length}
          onClick={() => onMerge("visible")}
        >
          Merge visible
        </Button>
        <Button
          variant="danger"
          disabled={disabled || !doc.layers.length}
          onClick={() => setFlatten(true)}
        >
          Flatten image…
        </Button>
      </div>
      <p className="pro-help">
        Merges use native resolution and one Undo step. Partial merges require a consecutive,
        complete clipping stack; backdrop-dependent ranges are refused. Merge visible keeps hidden
        content. Linking synchronizes movement.
      </p>
      <Alert.Root open={flatten} onOpenChange={setFlatten}>
        <Alert.Portal>
          <Alert.Overlay className="pro-layer-confirm-overlay" />
          <Alert.Content className="pro-layer-confirm">
            <Alert.Title>Flatten this image?</Alert.Title>
            <Alert.Description>
              All layers, including hidden content, will be replaced by one native-resolution raster
              layer. The retained original is kept. You can Undo during this editing session. Save
              an editable native backup before flattening if you need the old layers after
              reopening.
            </Alert.Description>
            <div className="pro-actions">
              <Alert.Cancel asChild>
                <Button variant="secondary">Keep layers</Button>
              </Alert.Cancel>
              <Alert.Action asChild>
                <Button variant="danger" onClick={() => onMerge("flatten")}>
                  Flatten now
                </Button>
              </Alert.Action>
            </div>
          </Alert.Content>
        </Alert.Portal>
      </Alert.Root>
    </div>
  );
}
