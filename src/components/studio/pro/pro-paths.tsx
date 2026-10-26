import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToolSection } from "../design/tool-section";
import { ProNumber } from "./pro-properties";
import { ProPathfinder } from "./pro-pathfinder";
import type { PathfinderOperation, PathfinderOptions } from "@/lib/studio/pro/pathfinder";
import type { Layer, ProDocument } from "@/lib/studio/pro/model";
import type { SelectionMode } from "@/lib/studio/pro/selection-tools";
import { hasActiveSelection } from "@/lib/studio/pro/fill";

export type PathMaskOptions = { targetId: string; feather: number; hideSource: boolean };

/** Raster Studio Paths panel: Pathfinder plus the path ↔ selection ↔ mask bridge. Every
 * action is one undo step; source paths are kept (optionally hidden). */
export function ProPaths({
  doc,
  ids,
  disabled,
  onPathfinder,
  onLoadSelection,
  onMakePath,
  onLayerMask,
  onVectorMask,
  onClip,
}: {
  doc: ProDocument;
  ids: string[];
  disabled: boolean;
  onPathfinder: (operation: PathfinderOperation, options: PathfinderOptions) => void;
  onLoadSelection: (mode: SelectionMode, feather: number) => void;
  onMakePath: (tolerance: number) => void;
  onLayerMask: (options: PathMaskOptions) => void;
  onVectorMask: (options: PathMaskOptions) => void;
  onClip: (index: number, action: "toggle" | "remove" | "release") => void;
}) {
  const [feather, setFeather] = useState(0),
    [tolerance, setTolerance] = useState(0.75),
    [hideSource, setHideSource] = useState(true),
    [target, setTarget] = useState("");
  const paths = useMemo(
    () =>
      ids
        .map((id) => doc.layers.find((l) => l.id === id))
        .filter((l): l is Layer => l?.kind === "shape"),
    [doc, ids],
  );
  const pathIds = new Set(paths.map((l) => l.id)),
    candidates = doc.layers
      .filter((l) => !pathIds.has(l.id) && l.kind !== "group" && l.kind !== "adjustment")
      .reverse(),
    // Default target: the nearest layer below the first selected path.
    below = (() => {
      const first = paths[0];
      if (!first) return undefined;
      const index = doc.layers.indexOf(first);
      return doc.layers
        .slice(0, index)
        .reverse()
        .find((l) => !pathIds.has(l.id) && l.kind !== "group" && l.kind !== "adjustment");
    })(),
    targetId = candidates.some((l) => l.id === target) ? target : (below?.id ?? ""),
    targetLayer = doc.layers.find((l) => l.id === targetId),
    active = doc.layers.find((l) => l.id === ids[0]),
    hasPath = paths.length > 0 && paths.length === ids.length,
    selection = hasActiveSelection(doc.selection);
  const pathHelp = hasPath
    ? `${paths.length} path${paths.length === 1 ? "" : "s"} selected.`
    : "Select one or more vector paths or shapes in Layers (rectangle, ellipse, polygon or Pen path).";
  return (
    <section aria-label="Paths" className="pro-paths">
      <ToolSection title="Path ↔ Selection" defaultOpen>
        <p className="pro-help" role="status">
          {pathHelp}
        </p>
        <ProNumber
          label="Path feather (px)"
          value={feather}
          min={0}
          max={100}
          step={0.5}
          onChange={setFeather}
        />
        <div className="pro-actions pro-paths-actions">
          {(
            [
              ["replace", "New selection from path"],
              ["add", "Add path to selection"],
              ["subtract", "Subtract path from selection"],
              ["intersect", "Intersect path with selection"],
            ] as const
          ).map(([mode, label]) => (
            <Button
              key={mode}
              variant={mode === "replace" ? "primary" : "secondary"}
              disabled={
                disabled || !hasPath || (mode !== "replace" && mode !== "add" && !selection)
              }
              onClick={() => onLoadSelection(mode, feather)}
            >
              {label}
            </Button>
          ))}
        </div>
        <p className="pro-help">
          The path fill area (with its fill rule) becomes anti-aliased selection coverage at
          document resolution. Feather sets the selection feather.
        </p>
        <ProNumber
          label="Path tolerance (px)"
          value={tolerance}
          min={0.25}
          max={8}
          step={0.25}
          onChange={setTolerance}
        />
        <Button
          variant="secondary"
          disabled={disabled || !selection}
          onClick={() => onMakePath(tolerance)}
        >
          Make path from selection
        </Button>
        <p className="pro-help">
          Traces the selection edge into an editable path (Direct select edits its anchors). Lower
          tolerance keeps more detail.
        </p>
      </ToolSection>

      <ToolSection title="Mask from path" defaultOpen>
        <label className="pro-field">
          Mask target layer
          <select
            className="field"
            aria-label="Mask target layer"
            value={targetId}
            disabled={disabled || !hasPath}
            onChange={(e) => setTarget(e.target.value)}
          >
            {!targetId && <option value="">Choose a layer</option>}
            {candidates.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="pro-check">
          <input
            type="checkbox"
            checked={hideSource}
            onChange={(e) => setHideSource(e.target.checked)}
          />
          Hide source path after masking (kept in Layers)
        </label>
        <div className="pro-actions pro-paths-actions">
          <Button
            variant="secondary"
            disabled={disabled || !hasPath || !targetLayer || !!targetLayer.mask}
            title={targetLayer?.mask ? "This layer already has a layer mask." : undefined}
            onClick={() => onLayerMask({ targetId, feather, hideSource })}
          >
            Add layer mask from path
          </Button>
          <Button
            variant="secondary"
            disabled={
              disabled ||
              paths.length !== 1 ||
              ids.length !== 1 ||
              !targetLayer ||
              !["shape", "text"].includes(targetLayer.kind)
            }
            onClick={() => onVectorMask({ targetId, feather: 0, hideSource })}
          >
            Add vector mask from path
          </Button>
        </div>
        <p className="pro-help">
          A layer mask is pixel coverage (any layer; uses the feather above) and stays paintable. A
          vector mask keeps the path’s curves on a shape or text layer.
        </p>
      </ToolSection>

      {!!active?.vectorClips?.length && (
        <ToolSection title={`Vector masks · ${active.name}`} defaultOpen>
          {active.vectorClips.map((c, index) => (
            <div className="pro-layout-actions" key={index}>
              <label className="pro-check">
                <input
                  type="checkbox"
                  aria-label={`Vector mask ${index + 1} enabled`}
                  checked={c.enabled}
                  disabled={disabled}
                  onChange={() => onClip(index, "toggle")}
                />
                Vector mask {index + 1}
              </label>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => onClip(index, "release")}
              >
                Edit vector mask {index + 1} as path
              </Button>
              <Button variant="ghost" disabled={disabled} onClick={() => onClip(index, "remove")}>
                Remove vector mask {index + 1}
              </Button>
            </div>
          ))}
          <p className="pro-help">
            “Edit as path” turns the mask into an editable path above the layer. Reshape it, then
            apply it again with “Add vector mask from path”.
          </p>
        </ToolSection>
      )}

      <ToolSection title="Pathfinder" defaultOpen>
        <ProPathfinder doc={doc} ids={ids} disabled={disabled} onRun={onPathfinder} />
      </ToolSection>
    </section>
  );
}
