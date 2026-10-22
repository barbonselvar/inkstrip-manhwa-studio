import { pathfinderSelection } from "@/lib/studio/pro/pathfinder-selection";
import { useMemo, useState } from "react";
import { Combine, Minus, Scan, Split, Scissors, Layers3, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type PathfinderOperation, type PathfinderOptions } from "@/lib/studio/pro/pathfinder";
import type { ProDocument } from "@/lib/studio/pro/model";
import { ProNumber } from "./pro-properties";
const operations = [
  ["unite", "Unite", Combine, "Combine all filled regions; use the back object’s appearance."],
  ["subtract", "Subtract", Minus, "Subtract all front objects from the back object."],
  ["intersect", "Intersect", Scan, "Keep the region shared by every object."],
  ["exclude", "Exclude", Split, "Keep regions covered by an odd number of objects."],
  [
    "divide",
    "Divide",
    Scissors,
    "Split at every overlap boundary; front fills own overlaps. Remove strokes.",
  ],
  [
    "trim",
    "Trim",
    Layers3,
    "Remove geometry hidden by front objects. Keep visible fill pieces; remove strokes.",
  ],
  [
    "merge",
    "Merge",
    Merge,
    "Trim hidden geometry and unite touching regions with matching fills. Remove strokes.",
  ],
] as const;
export function ProPathfinder({
  doc,
  ids,
  disabled,
  onRun,
}: {
  doc: ProDocument;
  ids: string[];
  disabled: boolean;
  onRun: (operation: PathfinderOperation, options: PathfinderOptions) => void;
}) {
  const [tolerance, setTolerance] = useState(0.1),
    [allowEmpty, setAllowEmpty] = useState(false);
  const eligibility = useMemo(() => {
    try {
      const result = pathfinderSelection(doc, ids);
      return { count: result.leaves.length, error: "" };
    } catch (error) {
      return { count: 0, error: (error as Error).message };
    }
  }, [doc, ids]);
  return (
    <section
      aria-label="Vector Pathfinder"
      onKeyDown={(e) => {
        if (e.code === "Space" && (e.target as HTMLElement).closest("button")) e.stopPropagation();
      }}
    >
      <div className="pro-section-heading">
        <h3>Pathfinder</h3>
        <span>{ids.length} selected</span>
      </div>
      <p className="pro-help">
        Select filled objects in Layers. Top row is front. Each operation is one Undo step; Chapter
        artwork is unchanged.
      </p>
      <p className="pro-help" role="status">
        {eligibility.error ||
          `${eligibility.count} filled objects ready. Results are editable paths.`}
      </p>
      <div className="pro-pathfinder-actions">
        {operations.map(([operation, label, Icon, description]) => (
          <Button
            key={operation}
            variant="secondary"
            disabled={disabled || !!eligibility.error}
            aria-label={`Pathfinder ${label}`}
            title={description}
            onClick={() => onRun(operation, { tolerance, allowEmpty })}
          >
            <Icon />
            {label}
          </Button>
        ))}
      </div>
      <fieldset disabled={disabled} className="pro-pathfinder-settings">
        <ProNumber
          label="Pathfinder curve tolerance (px)"
          value={tolerance}
          min={0.02}
          max={1}
          step={0.01}
          onChange={setTolerance}
        />
        <label className="pro-check">
          <input
            aria-label="Allow empty Pathfinder result"
            type="checkbox"
            checked={allowEmpty}
            onChange={(e) => setAllowEmpty(e.target.checked)}
          />
          Allow empty result: remove selected objects (undoable)
        </label>
      </fieldset>
      <p className="pro-help">
        Curves become line anchors within the chosen tolerance. Save a native backup first to retain
        source vectors after closing.
      </p>
      <p className="pro-help">
        Unite, Subtract, Intersect and Exclude use the back object’s fill/stroke. Divide, Trim and
        Merge preserve the visible front fills and remove strokes. Filled regions define geometry;
        strokes are not expanded.
      </p>
      <p className="pro-help">
        Affine shapes and neutral nested groups are supported. Close open contours and release
        masks, clipping, links, effects or translucent fills first. Results retain ordinary anchor,
        compound, transform, native and SVG editing.
      </p>
    </section>
  );
}
