import { Button } from "@/components/ui/button";
import { Copy, Eye, EyeOff, Lock, Unlock, ArrowUp, ArrowDown } from "lucide-react";
import {
  layerStack,
  moveLayer,
  type CompositionDocument,
  type CompositionObject,
  type Space,
  type PanelComposition,
  type Transition,
} from "@/lib/studio/composition/model";
import type { Controller, Selection } from "@/lib/studio/composition/controller";
import type { Panel } from "@/lib/studio/types";
type Row = {
  key: string;
  name: string;
  kind: string;
  visible: boolean;
  locked: boolean;
  selection: Selection;
  patch: (d: CompositionDocument, p: Record<string, unknown>) => CompositionDocument;
  object?: CompositionObject;
};
export function CompositionLayers({
  document: d,
  panels,
  controller,
  onDuplicate,
  onOverlay,
}: {
  document: CompositionDocument;
  panels: Panel[];
  controller: Controller;
  onDuplicate: () => void;
  onOverlay: () => void;
}) {
  const rows: Row[] = [];
  const addSpace = (
    key: string,
    name: string,
    value: Space,
    id: string,
    slot: "top" | "bottom" | "after" | "opening" | "ending",
  ) =>
    rows.push({
      key: `space:${key}`,
      name: value.name ?? name,
      kind: `Spacing · ${value.height}px`,
      visible: value.visible,
      locked: value.locked,
      selection: { kind: "space", id, slot },
      patch: (doc, p) =>
        slot === "opening" || slot === "ending"
          ? { ...doc, [slot]: { ...doc[slot], ...p } }
          : {
              ...doc,
              panels: {
                ...doc.panels,
                [id]: { ...doc.panels[id], [slot]: { ...doc.panels[id][slot], ...p } },
              },
            },
    });
  addSpace("opening", "Chapter opening", d.opening, "opening", "opening");
  addSpace("ending", "Chapter ending", d.ending, "ending", "ending");
  for (const panel of panels) {
    const p = d.panels[panel.id];
    if (!p) continue;
    rows.push({
      key: `source:${panel.id}`,
      name: p.name ?? panel.name,
      kind: "Source image",
      visible: p.visible,
      locked: p.locked,
      selection: { kind: "panel", id: panel.id },
      patch: (doc, patch) => ({
        ...doc,
        panels: {
          ...doc.panels,
          [panel.id]: { ...doc.panels[panel.id], ...patch } as PanelComposition,
        },
      }),
    });
    for (const slot of ["top", "bottom", "after"] as const)
      addSpace(
        `${panel.id}:${slot}`,
        `${slot === "after" ? "Gap after" : `${slot} extension`} · ${p.name ?? panel.name}`,
        p[slot],
        panel.id,
        slot,
      );
  }
  d.transitions.forEach((t) =>
    rows.push({
      key: `transition:${t.id}`,
      name: t.name ?? t.type,
      kind: "Panel transition",
      visible: t.visible,
      locked: t.locked,
      selection: { kind: "transition", id: t.id },
      patch: (doc, p) => ({
        ...doc,
        transitions: doc.transitions.map((x) =>
          x.id === t.id ? ({ ...x, ...p } as Transition) : x,
        ),
      }),
    }),
  );
  d.objects.forEach((o) =>
    rows.push({
      key: `object:${o.id}`,
      name: o.name,
      kind: `${o.owner ? "Panel local" : "Chapter global"} · ${o.kind}`,
      visible: o.visible,
      locked: o.locked,
      selection: { kind: "object", id: o.id },
      object: o,
      patch: (doc, p) => ({
        ...doc,
        objects: doc.objects.map((x) =>
          x.id === o.id ? ({ ...x, ...p } as CompositionObject) : x,
        ),
      }),
    }),
  );
  const byKey = new Map(rows.map((r) => [r.key, r])),
    order = layerStack(
      d,
      panels.map((p) => p.id),
    );
  const select = (row: Row) => {
    controller.select(row.selection);
    if (row.selection?.kind === "space") controller.setState({ tool: "Spacing" });
    if (row.selection?.kind === "panel")
      controller.setState({ selectedPanels: [row.selection.id] });
  };
  const shift = (row: Row, direction: -1 | 1) =>
    controller.change((doc) => {
      if (row.object?.parentId) {
        const siblings = doc.objects.filter((o) => o.parentId === row.object!.parentId),
          index = siblings.findIndex((o) => o.id === row.object!.id),
          other = siblings[index + direction];
        if (!other) return doc;
        const list = [...doc.objects],
          a = list.findIndex((o) => o.id === row.object!.id),
          b = list.findIndex((o) => o.id === other.id);
        [list[a], list[b]] = [list[b], list[a]];
        return { ...doc, objects: list };
      }
      return moveLayer(
        doc,
        row.key,
        direction,
        panels.map((p) => p.id),
      );
    });
  const render = (row: Row, depth = 0, inheritedLock = false): React.ReactNode => {
    const key = row.key,
      object = row.object,
      siblings = object?.parentId
        ? d.objects.filter((o) => o.parentId === object.parentId).map((o) => `object:${o.id}`)
        : order,
      index = siblings.indexOf(key),
      locked = row.locked || inheritedLock;
    const selected = controller.getState().selection;
    return (
      <div key={key} className="composition-layer-tree" style={{ paddingLeft: depth ? 8 : 0 }}>
        <div
          className={`composition-layer-row ${JSON.stringify(selected) === JSON.stringify(row.selection) ? "is-selected" : ""}`}
          data-layer-key={key}
        >
          <button className="composition-layer-name" onClick={() => select(row)}>
            <span>
              {depth ? "↳ " : ""}
              {row.name}
            </span>
            <small>{row.kind}</small>
          </button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Toggle ${row.name} visibility`}
            onClick={() => controller.change((doc) => row.patch(doc, { visible: !row.visible }))}
          >
            {row.visible ? <Eye /> : <EyeOff />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Toggle ${row.name} lock`}
            onClick={() => controller.change((doc) => row.patch(doc, { locked: !row.locked }))}
          >
            {row.locked ? <Lock /> : <Unlock />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={locked || index === siblings.length - 1}
            aria-label={`Raise ${row.name}`}
            onClick={() => shift(row, 1)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={locked || index <= 0}
            aria-label={`Lower ${row.name}`}
            onClick={() => shift(row, -1)}
          >
            <ArrowDown />
          </Button>
          {object && (
            <Button
              variant="ghost"
              size="icon"
              disabled={locked}
              aria-label={`Duplicate ${row.name}`}
              onClick={() => {
                select(row);
                onDuplicate();
              }}
            >
              <Copy />
            </Button>
          )}
        </div>
        {row.selection?.kind === "panel" &&
          d.panels[row.selection.id].fades.map((f) => (
            <button
              className="composition-mask-layer"
              key={f.id}
              onClick={() => {
                controller.select({ kind: "fade", id: f.id, panelId: row.selection!.id });
                controller.setState({ tool: "Fades" });
              }}
            >
              ↳ {f.name} · mask {f.visible ? "" : "(hidden)"}
            </button>
          ))}
        {object?.kind === "group" &&
          d.objects
            .filter((o) => o.parentId === object.id)
            .reverse()
            .map((o) => render(byKey.get(`object:${o.id}`)!, depth + 1, locked))}
      </div>
    );
  };
  return (
    <>
      <p className="composition-hint">
        Top layers draw last. Raise or lower artwork, spaces, transitions and effects together.
      </p>
      <Button variant="secondary" onClick={onOverlay}>
        Add image overlay
      </Button>
      {[...order]
        .reverse()
        .map((key) => byKey.get(key))
        .filter((r): r is Row => !!r)
        .map((row) => render(row))}
    </>
  );
}
