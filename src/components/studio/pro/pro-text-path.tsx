import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import type { Layer } from "@/lib/studio/pro/model";
import { measureTextPath, type TextPath } from "@/lib/studio/pro/text-path";
export function ProTextPath({
  layer: l,
  onCreate,
  onPatch,
  onDirect,
}: {
  layer?: Layer;
  onCreate: () => void;
  onPatch: (p: Partial<Layer>, group?: string) => void;
  onDirect: () => void;
}) {
  const p = l?.textPath;
  return (
    <fieldset className="pro-layout-panel" disabled={l?.locked}>
      <h3>Text on path</h3>
      <p className="pro-help">
        Choose a shape and its active contour in Properties, then create text. The new text owns an
        editable copy of that baseline; the original artwork stays intact.
      </p>
      <Button disabled={l?.kind !== "shape"} onClick={onCreate}>
        Create text on selected contour
      </Button>
      {l && p ? (
        <>
          <label className="pro-field">
            Text content
            <input
              className="field"
              aria-label="Path text content"
              value={l.text}
              maxLength={5000}
              onChange={(e) => onPatch({ text: e.target.value }, "path-text")}
            />
          </label>
          <label className="pro-field">
            Font
            <select
              className="field"
              aria-label="Path text font"
              value={l.fontFamily}
              onChange={(e) => onPatch({ fontFamily: e.target.value as Layer["fontFamily"] })}
            >
              {["Arial", "Georgia", "monospace"].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <ProNumber
            label="Path text font size"
            value={l.fontSize}
            min={1}
            max={1000}
            onChange={(fontSize) => onPatch({ fontSize }, "path-font")}
          />
          <ProNumber
            label="Path text letter spacing"
            value={l.letterSpacing}
            min={-20}
            max={100}
            step={0.1}
            onChange={(letterSpacing) => onPatch({ letterSpacing }, "path-spacing")}
          />
          {(["start", "end", "baseline"] as const).map((k) => (
            <ProNumber
              key={k}
              label={`Path text ${k} offset`}
              value={p[k]}
              min={k === "baseline" ? -10000 : 0}
              max={k === "baseline" ? 10000 : 100000}
              step={0.1}
              onChange={(n) => onPatch({ textPath: { ...p, [k]: n } }, "path-offset-" + k)}
            />
          ))}
          <label className="pro-field">
            Alignment
            <select
              className="field"
              aria-label="Path text alignment"
              value={l.align}
              onChange={(e) => onPatch({ align: e.target.value as Layer["align"] })}
            >
              {["left", "center", "right"].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="pro-check">
            <input
              type="checkbox"
              checked={p.reverse}
              onChange={(e) => onPatch({ textPath: { ...p, reverse: e.target.checked } })}
            />
            Reverse path text direction
          </label>
          <ProNumber
            label="Path text position"
            value={p.offset ?? 0}
            onChange={(offset) => onPatch({ textPath: { ...p, offset } }, "path-position")}
          />
          <Button variant="secondary" onClick={onDirect}>
            Edit text baseline anchors · A
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              onPatch({
                textPath: { start: 0, end: 0, baseline: 0, reverse: false } satisfies TextPath,
              })
            }
          >
            Reset path text offsets
          </Button>
          <p className="pro-help">
            Baseline length: {Math.round(measureTextPath(l).length * 100) / 100}px. Glyph centers
            outside start/end bounds are hidden. LTR Latin/Greek/Cyrillic, CJK and emoji graphemes
            are supported; contextual/RTL scripts are rejected explicitly. No outlines or source
            rasterization are required.
          </p>
        </>
      ) : (
        <p className="pro-help">Select a text-on-path object to edit its typography and offsets.</p>
      )}
    </fieldset>
  );
}
