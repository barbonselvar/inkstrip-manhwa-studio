import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  contourAt,
  contours,
  withContour,
  type Anchor,
  type Layer,
  type ProDocument,
} from "@/lib/studio/pro/model";
import { convertPath, fitVectorFrame } from "@/lib/studio/pro/compound";
import { editAnchor, reverseAnchors, type AnchorEdit } from "@/lib/studio/pro/anchor-edit";
import {
  anchorCurve,
  cubicLength,
  parameterAtLength,
  splitAnchorSegment,
} from "@/lib/studio/pro/bezier";
import { joinPaths, simplifyPath, smoothPath, splitPathAt } from "@/lib/studio/pro/path-ops";
import { ProNumber } from "./pro-properties";

export function ProAnchors({
  doc,
  layer: sourceLayer,
  contour = 0,
  onSelectContour,
  index,
  onSelect,
  onChange,
  onError,
  joinWith,
  onSelectLayers,
}: {
  doc: ProDocument;
  layer: Layer;
  contour?: number;
  onSelectContour: (index: number) => void;
  index: number;
  onSelect: (index: number) => void;
  onChange: (d: ProDocument, label: string, group?: string) => void;
  onError: (message: string) => void;
  /** Second selected open path, offered for Join. */
  joinWith?: Layer;
  onSelectLayers?: (ids: string[]) => void;
}) {
  const layer = { ...sourceLayer, ...contourAt(sourceLayer, contour) };
  const [parameter, setParameter] = useState(50),
    [tolerance, setTolerance] = useState(1),
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
      onChange(
        fn(),
        label,
        group ? `${layer.id}:contour-${contour}-anchor-${index}-${group}` : undefined,
      );
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    }
  };
  const edit = (edit: AnchorEdit, label: string, group?: string) =>
    run(() => editAnchor(doc, layer.id, index, edit, contour), label, group);
  if (layer.pathData)
    return (
      <>
        <p className="pro-help">
          Convert SVG data into editable cubic contours. Lines and Béziers stay exact; arcs use
          bounded cubic interpolation. Undo restores the preserved SVG path.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            if (run(() => convertPath(doc, layer.id), "Convert SVG path to native contours"))
              onSelectContour(0);
          }}
        >
          Convert SVG path to editable contours
        </Button>
      </>
    );
  const subpathSelect = (
    <label className="pro-field">
      Selected subpath
      <select
        className="field"
        aria-label="Selected subpath"
        value={contour}
        onChange={(e) => onSelectContour(+e.target.value)}
      >
        {contours(sourceLayer).map((c, i) => (
          <option key={i} value={i}>
            Subpath {i + 1} · {c.closed ? "closed" : "open"} · {c.anchors.length} anchors
          </option>
        ))}
      </select>
    </label>
  );
  if (!a)
    return (
      <>
        {subpathSelect}
        <p className="pro-help">
          This subpath has no anchors. Select another subpath or use the Pen tool to create a path.
        </p>
      </>
    );
  return (
    <section aria-label="Bézier anchor editing">
      {subpathSelect}
      <label className="pro-check">
        <input
          type="checkbox"
          aria-label="Close Bézier path"
          checked={layer.closed}
          onChange={(e) =>
            run(
              () => ({
                ...doc,
                layers: doc.layers.map((l) =>
                  l.id === layer.id
                    ? withContour(l, contour, { anchors: layer.anchors, closed: e.target.checked })
                    : l,
                ),
              }),
              "Change subpath closure",
            )
          }
        />
        Closed subpath
      </label>
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
        <Button
          variant="ghost"
          disabled={layer.kind !== "shape"}
          onClick={() => run(() => fitVectorFrame(doc, layer.id), "Fit vector source frame")}
        >
          Fit vector frame to content
        </Button>
        <Button variant="ghost" onClick={() => edit({ kind: "clear" }, "Remove Bézier handles")}>
          Remove handles
        </Button>
        <Button
          variant="ghost"
          disabled={layer.anchors.length <= (layer.closed ? 3 : 2)}
          onClick={() => {
            if (
              run(
                () => editAnchor(doc, layer.id, index, { kind: "delete" }, contour),
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
          disabled={
            segment < 0 || contours(sourceLayer).reduce((n, c) => n + c.anchors.length, 0) >= 1000
          }
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
              return splitAnchorSegment(doc, layer.id, segment, t, contour);
            }, "Insert Bézier anchor");
            if (changed) onSelect(segment + 1);
          }}
        >
          Insert anchor without changing curve
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const changed = run(
              () => reverseAnchors(doc, layer.id, contour),
              "Reverse Bézier path",
            );
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
      <h4>Path operations</h4>
      <div className="pro-actions">
        <Button
          variant="secondary"
          disabled={!layer.closed && (index === 0 || index === layer.anchors.length - 1)}
          title={
            layer.closed
              ? "Open the closed path at this anchor."
              : "Cut the open path into two paths at this anchor."
          }
          onClick={() => {
            let ids: string[] = [];
            if (
              run(() => {
                const result = splitPathAt(doc, layer.id, index, contour);
                ids = result.ids;
                return result.document;
              }, "Split path at anchor")
            ) {
              onSelectLayers?.(ids);
              onSelect(0);
            }
          }}
        >
          Split path at anchor
        </Button>
        <Button
          variant="secondary"
          disabled={!joinWith}
          title={
            joinWith
              ? `Join with ${joinWith.name} at the nearest endpoints.`
              : "Select a second open path in Layers to join."
          }
          onClick={() => {
            if (joinWith && run(() => joinPaths(doc, layer.id, joinWith.id).document, "Join paths"))
              onSelectLayers?.([layer.id]);
          }}
        >
          {joinWith ? `Join with ${joinWith.name}` : "Join paths"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => run(() => smoothPath(doc, layer.id, contour, [index]), "Smooth anchor")}
        >
          Smooth anchor
        </Button>
        <Button
          variant="ghost"
          onClick={() => run(() => smoothPath(doc, layer.id, contour), "Smooth path")}
        >
          Smooth all anchors
        </Button>
      </div>
      <ProNumber
        label="Simplify tolerance (px)"
        value={tolerance}
        min={0.1}
        max={100}
        step={0.1}
        onChange={setTolerance}
      />
      <Button
        variant="secondary"
        onClick={() => {
          if (
            run(() => {
              const result = simplifyPath(doc, layer.id, tolerance, contour);
              if (!result.removed)
                throw new Error("No anchor can be removed within this tolerance.");
              return result.document;
            }, "Simplify path")
          )
            onSelect(0);
        }}
      >
        Simplify path
      </Button>
      <p className="pro-help">
        Split, Join, Smooth and Simplify keep editable Bézier geometry; each is one Undo step.
        Simplify removes anchors only where the curve stays within the tolerance.
      </p>
    </section>
  );
}
