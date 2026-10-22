import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import { layout, artboards, type Layout } from "@/lib/studio/pro/artboards";
import { alignObjects, type AlignOperation } from "@/lib/studio/pro/precision";
import type { ProDocument } from "@/lib/studio/pro/model";
export function ProPrecision({
  doc,
  ids,
  boardId,
  onCommit,
  onError,
  disabled,
}: {
  doc: ProDocument;
  ids: string[];
  boardId: string;
  onCommit: (d: ProDocument, label: string, group?: string) => void;
  onError: (s: string) => void;
  disabled: boolean;
}) {
  const s = layout(doc),
    [reference, setReference] = useState<"selection" | "artboard" | "key">("selection"),
    [axis, setAxis] = useState<"x" | "y">("x"),
    [position, setPosition] = useState(0),
    [keyId, setKeyId] = useState("");
  const patch = (p: Partial<Layout>, group?: string) =>
    onCommit({ ...doc, layout: { ...s, ...p } }, "Precision settings", group);
  const checks: [keyof Pick<Layout, "snapping" | "smart" | "grid" | "guidesVisible">, string][] = [
    ["snapping", "Enable precision snapping"],
    ["smart", "Smart Guides"],
    ["grid", "Show grid"],
    ["guidesVisible", "Show guides"],
  ];
  const alignments: [AlignOperation, string][] = [
    ["left", "Align left"],
    ["center-x", "Align horizontal center"],
    ["right", "Align right"],
    ["top", "Align top"],
    ["center-y", "Align vertical center"],
    ["bottom", "Align bottom"],
    ["distribute-x", "Distribute horizontal centers"],
    ["distribute-y", "Distribute vertical centers"],
    ["space-x", "Equal horizontal gaps"],
    ["space-y", "Equal vertical gaps"],
  ];
  return (
    <fieldset className="pro-layout-panel" disabled={disabled}>
      <h3>Precision & guides</h3>
      {!doc.layout && (
        <>
          <p className="pro-help">
            Legacy Direct Select keeps unsnapped anchor editing until you enable precision settings.
            Adding an artboard also enables them.
          </p>
          <Button onClick={() => patch({})}>Enable precision for this document</Button>
        </>
      )}
      {checks.map(([k, name]) => (
        <label className="pro-check" key={k}>
          <input
            type="checkbox"
            checked={s[k]}
            onChange={(e) => patch({ [k]: e.target.checked })}
          />
          {name}
        </label>
      ))}
      <ProNumber
        label="Snapping tolerance · screen px"
        value={s.tolerance}
        min={1}
        max={32}
        onChange={(tolerance) => patch({ tolerance }, "snap:tolerance")}
      />
      <ProNumber
        label="Grid spacing · document px"
        value={s.spacing}
        min={1}
        max={10000}
        onChange={(spacing) => patch({ spacing }, "snap:spacing")}
      />
      {(Object.keys(s.modes) as (keyof Layout["modes"])[]).map((k) => (
        <label className="pro-check" key={k}>
          <input
            type="checkbox"
            checked={s.modes[k]}
            onChange={(e) => patch({ modes: { ...s.modes, [k]: e.target.checked } })}
          />
          Snap to {k}
        </label>
      ))}
      <h3>Document guides</h3>
      <label className="pro-field">
        Guide direction
        <select
          className="field"
          aria-label="New guide direction"
          value={axis}
          onChange={(e) => setAxis(e.target.value as "x" | "y")}
        >
          <option value="x">Vertical</option>
          <option value="y">Horizontal</option>
        </select>
      </label>
      <ProNumber label="New guide position" value={position} onChange={setPosition} />
      <Button
        disabled={s.guides.length >= 128}
        onClick={() =>
          patch({
            guides: [...s.guides, { id: crypto.randomUUID(), axis, position, locked: false }],
          })
        }
      >
        Create guide
      </Button>
      {s.guides.map((g, i) => (
        <div className="pro-guide-row" key={g.id}>
          <ProNumber
            label={`${g.axis === "x" ? "Vertical" : "Horizontal"} guide ${i + 1}`}
            value={g.position}
            disabled={g.locked}
            onChange={(position) =>
              !g.locked &&
              patch(
                { guides: s.guides.map((n) => (n.id === g.id ? { ...n, position } : n)) },
                `guide:${g.id}`,
              )
            }
          />
          <label className="pro-check">
            <input
              type="checkbox"
              checked={g.locked}
              onChange={(e) =>
                patch({
                  guides: s.guides.map((n) =>
                    n.id === g.id ? { ...n, locked: e.target.checked } : n,
                  ),
                })
              }
            />
            Lock guide {i + 1}
          </label>
          <Button
            disabled={g.locked}
            variant="secondary"
            onClick={() => patch({ guides: s.guides.filter((n) => n.id !== g.id) })}
          >
            Delete guide {i + 1}
          </Button>
        </div>
      ))}
      <h3>Align & distribute</h3>
      <label className="pro-field">
        Align relative to
        <select
          className="field"
          aria-label="Align relative to"
          value={reference}
          onChange={(e) => setReference(e.target.value as typeof reference)}
        >
          <option value="selection">Selection</option>
          <option value="key">Key object</option>
          <option value="artboard">
            Active artboard
            {artboards(doc).find((b) => b.id === boardId)
              ? ` · ${artboards(doc).find((b) => b.id === boardId)!.name}`
              : " · choose in Artboards"}
          </option>
        </select>
      </label>
      {reference === "key" && (
        <label className="pro-field">
          Key object
          <select
            className="field"
            aria-label="Alignment key object"
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
          >
            <option value="">Select key object</option>
            {ids.map((id) => (
              <option value={id} key={id}>
                {doc.layers.find((l) => l.id === id)?.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="pro-layout-actions">
        {alignments.map(([operation, name]) => (
          <Button
            variant="secondary"
            key={operation}
            title={name}
            disabled={
              ids.length < (reference === "artboard" ? 1 : 2) ||
              (reference === "artboard" && !artboards(doc).some((b) => b.id === boardId)) ||
              (reference === "key" && !ids.includes(keyId)) ||
              ((operation.startsWith("distribute") || operation.startsWith("space")) &&
                (ids.length < 3 || reference !== "selection"))
            }
            onClick={() => {
              try {
                onCommit(alignObjects(doc, ids, operation, reference, boardId, keyId), name);
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            {name}
          </Button>
        ))}
      </div>
      <p className="pro-help">
        Alignment uses transformed geometric bounds, including Bézier extrema; strokes and effects
        are excluded. Distribution keeps the first and last object fixed. Linked selections must be
        independent. Hold Alt to bypass snapping while dragging.
      </p>
    </fieldset>
  );
}
