import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Anchor, Layer, ProDocument } from "@/lib/studio/pro/model";
import { editAnchor, reverseAnchors, type AnchorEdit } from "@/lib/studio/pro/anchor-edit";
import {
  anchorCurve,
  cubicLength,
  parameterAtLength,
  splitAnchorSegment,
} from "@/lib/studio/pro/bezier";
import { ProNumber } from "./pro-properties";

export function ProAnchors({
  doc,
  layer,
  index,
  onSelect,
  onChange,
  onError,
}: {
  doc: ProDocument;
  layer: Layer;
  index: number;
  onSelect: (index: number) => void;
  onChange: (d: ProDocument, label: string, group?: string) => void;
  onError: (message: string) => void;
}) {
  const [parameter, setParameter] = useState(50),
    [measure, setMeasure] = useState("parameter"),
    a = layer.anchors[index],
    segment = Math.min(index, layer.anchors.length - (layer.closed ? 1 : 2));
  const metric = useMemo(() => {
    if (segment < 0 || layer.pathData) return null;
    try {
      const curve = anchorCurve(
        layer.anchors[segment]!,
        layer.anchors[(segment + 1) % layer.anchors.length]!,
      );
      return { curve, ...cubicLength(curve) };
    } catch {
      return null;
    }
  }, [layer.anchors, layer.pathData, segment]);
  const run = (fn: () => ProDocument, label: string, group?: string) => {
    try {
      onChange(fn(), label, group ? `${layer.id}:anchor-${index}-${group}` : undefined);
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    }
  };
  const edit = (edit: AnchorEdit, label: string, group?: string) =>
    run(() => editAnchor(doc, layer.id, index, edit), label, group);
  if (layer.pathData)
    return (
      <p className="pro-help">
        Imported SVG geometry is preserved. Native anchor editing requires path conversion, which is
        not yet supported.
      </p>
    );
  if (!a) return <p className="pro-help">Use the Pen tool to add anchors to this path.</p>;
  return (
    <section aria-label="Bézier anchor editing">
      <p className="pro-help">
        Direct select: drag an anchor or handle. Smooth keeps opposite handle length; symmetric
        mirrors it. Alt/Option-drag breaks coupling. Tap the curve’s diamond to insert an exact
        midpoint.
      </p>
      <ProNumber
        label="Selected anchor"
        value={index + 1}
        min={1}
        max={layer.anchors.length}
        onChange={(n) => onSelect(Math.round(n) - 1)}
      />
      <div className="pro-number-grid">
        {(["x", "y"] as const).map((axis) => (
          <ProNumber
            key={axis}
            label={`Anchor ${axis.toUpperCase()}`}
            value={a[axis]}
            step={0.1}
            onChange={(n) =>
              edit(
                { kind: "move", point: { x: a.x, y: a.y, [axis]: n } },
                "Move Bézier anchor",
                `point-${axis}`,
              )
            }
          />
        ))}
      </div>
      <label className="pro-field">
        Anchor handles
        <select
          className="field"
          aria-label="Anchor handle mode"
          value={a.mode ?? "corner"}
          onChange={(e) =>
            edit(
              { kind: "mode", mode: e.target.value as NonNullable<Anchor["mode"]> },
              "Change anchor handle mode",
            )
          }
        >
          <option value="corner">Corner · independent handles</option>
          <option value="smooth">Smooth · aligned handles</option>
          <option value="symmetric">Symmetric · mirrored handles</option>
        </select>
      </label>
      {(["incoming", "outgoing"] as const).map((part) => (
        <div className="pro-number-grid" key={part}>
          {(["x", "y"] as const).map((axis) => (
            <ProNumber
              key={axis}
              label={`${part === "incoming" ? "Incoming" : "Outgoing"} handle ${axis.toUpperCase()}`}
              value={(a[part] ?? a)[axis]}
              step={0.1}
              onChange={(n) =>
                edit(
                  {
                    kind: "handle",
                    part,
                    point: { x: (a[part] ?? a).x, y: (a[part] ?? a).y, [axis]: n },
                  },
                  "Edit Bézier handle",
                  `${part}-${axis}`,
                )
              }
            />
          ))}
        </div>
      ))}
      <div className="pro-actions">
        <Button variant="ghost" onClick={() => edit({ kind: "clear" }, "Remove Bézier handles")}>
          Remove handles
        </Button>
        <Button
          variant="ghost"
          disabled={layer.anchors.length <= (layer.closed ? 3 : 2)}
          onClick={() => {
            if (
              run(
                () => editAnchor(doc, layer.id, index, { kind: "delete" }),
                "Delete Bézier anchor",
              )
            )
              onSelect(Math.max(0, index - 1));
          }}
        >
          Delete anchor
        </Button>
      </div>
      <p className="pro-help">
        Deleting anchors or removing handles changes the curve. Undo restores it. Coordinates use
        source-layer pixels.
      </p>
      <label className="pro-field">
        Insertion measurement
        <select
          className="field"
          aria-label="Anchor insertion measurement"
          value={measure}
          onChange={(e) => setMeasure(e.target.value)}
        >
          <option value="parameter">Cubic parameter</option>
          <option value="distance">Distance along curve</option>
        </select>
      </label>
      <ProNumber
        label={
          measure === "parameter" ? "Segment insertion parameter %" : "Segment insertion distance %"
        }
        value={parameter}
        min={1}
        max={99}
        step={1}
        onChange={setParameter}
      />
      <p className="pro-help">
        Segment {segment + 1} → {((segment + 1) % layer.anchors.length) + 1}
        {metric ? ` · ${metric.length.toFixed(2)} source px long` : ""}. Cubic parameter and
        percentage of traveled distance can produce different positions.
      </p>
      <div className="pro-actions">
        <Button
          variant="secondary"
          disabled={segment < 0 || layer.anchors.length >= 1000}
          onClick={() => {
            const changed = run(() => {
              if (measure === "distance" && !metric)
                throw new Error("This segment exceeds the arc-length precision budget.");
              const t =
                measure === "distance" && metric
                  ? parameterAtLength(metric.curve, (metric.length * parameter) / 100)
                  : parameter / 100;
              if (t <= 0 || t >= 1)
                throw new Error("Choose an interior position on a nonzero-length segment.");
              return splitAnchorSegment(doc, layer.id, segment, t);
            }, "Insert Bézier anchor");
            if (changed) onSelect(segment + 1);
          }}
        >
          Insert anchor without changing curve
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const changed = run(() => reverseAnchors(doc, layer.id), "Reverse Bézier path");
            if (changed)
              onSelect(
                layer.closed
                  ? (layer.anchors.length - index) % layer.anchors.length
                  : layer.anchors.length - 1 - index,
              );
          }}
        >
          Reverse path direction
        </Button>
      </div>
    </section>
  );
}
