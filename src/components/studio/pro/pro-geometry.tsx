import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToolSection } from "../design/tool-section";
import { ProNumber } from "./pro-properties";
import { outputMatrix, outputSize, type Crop, type Resampling } from "@/lib/studio/pro/geometry";
import type { ProDocument } from "@/lib/studio/pro/model";
export function ProGeometry({
  doc,
  draft,
  ratio,
  onRatio,
  onDraft,
  onStart,
  onApply,
  onCancel,
  onReset,
  onCommit,
  canvasRef,
  renderVersion,
  disabled,
}: {
  doc: ProDocument;
  draft: Crop | null;
  ratio: number;
  onRatio: (n: number) => void;
  onDraft: (c: Crop) => void;
  onStart: () => void;
  onApply: () => void;
  onCancel: () => void;
  onReset: () => void;
  onCommit: (d: ProDocument, label: string) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  renderVersion: number;
  disabled: boolean;
}) {
  const size = outputSize(doc),
    preview = useRef<HTMLCanvasElement>(null),
    [canvasWidth, setCanvasWidth] = useState(doc.width),
    [canvasHeight, setCanvasHeight] = useState(doc.height),
    [width, setWidth] = useState(size.width),
    [height, setHeight] = useState(size.height),
    [lock, setLock] = useState(true),
    [method, setMethod] = useState<Resampling>(doc.imageSize?.resampling ?? "bicubic");
  useEffect(() => {
    setCanvasWidth(doc.width);
    setCanvasHeight(doc.height);
  }, [doc.width, doc.height]);
  useEffect(() => {
    setWidth(size.width);
    setHeight(size.height);
    setMethod(doc.imageSize?.resampling ?? "bicubic");
  }, [size.width, size.height, doc.imageSize?.resampling]);
  useEffect(() => {
    const source = canvasRef.current,
      target = preview.current;
    if (!source || !target) return;
    const d = draft ? { ...doc, crop: draft } : doc,
      output = outputSize(d),
      scale = Math.min(300 / output.width, 220 / output.height);
    target.width = Math.max(1, Math.round(output.width * scale));
    target.height = Math.max(1, Math.round(output.height * scale));
    const ctx = target.getContext("2d")!;
    ctx.imageSmoothingEnabled = d.imageSize?.resampling !== "nearest";
    ctx.scale(target.width / output.width, target.height / output.height);
    ctx.transform(...outputMatrix(d));
    ctx.drawImage(source, 0, 0, doc.width, doc.height);
  }, [doc, draft, canvasRef, renderVersion]);
  const changeCrop = (p: Partial<Crop>) => {
    if (!draft) return;
    if (ratio && p.width !== undefined) p.height = Math.max(1, Math.round(p.width / ratio));
    else if (ratio && p.height !== undefined) p.width = Math.max(1, Math.round(p.height * ratio));
    onDraft({ ...draft, ...p });
  };
  return (
    <fieldset className="pro-geometry" disabled={disabled}>
      <ToolSection title="Non-destructive crop" defaultOpen>
        <p className="pro-help">
          Drag a new rectangle, its edges or corners. Drag inside to move. The full canvas stays
          editable; only output is cropped. Original pixels are retained.
        </p>
        {!draft && <Button onClick={onStart}>Edit crop boundaries</Button>}
        {draft && (
          <>
            <label className="pro-field">
              Crop aspect ratio
              <select
                className="field"
                aria-label="Crop aspect ratio"
                value={ratio}
                onChange={(e) => {
                  const r = Number(e.target.value);
                  onRatio(r);
                  if (r) onDraft({ ...draft, height: Math.max(1, Math.round(draft.width / r)) });
                }}
              >
                <option value={0}>Freeform</option>
                <option value={1}>1 : 1</option>
                <option value={4 / 3}>4 : 3</option>
                <option value={3 / 4}>3 : 4</option>
                <option value={16 / 9}>16 : 9</option>
                <option value={9 / 16}>9 : 16</option>
                <option value={doc.width / doc.height}>Canvas ratio</option>
              </select>
            </label>
            <div className="pro-field-grid">
              <ProNumber label="Crop X" value={draft.x} onChange={(x) => changeCrop({ x })} />
              <ProNumber label="Crop Y" value={draft.y} onChange={(y) => changeCrop({ y })} />
              <ProNumber
                label="Crop width"
                value={draft.width}
                min={1}
                max={16384}
                onChange={(n) => changeCrop({ width: Math.round(n) })}
              />
              <ProNumber
                label="Crop height"
                value={draft.height}
                min={1}
                max={16384}
                onChange={(n) => changeCrop({ height: Math.round(n) })}
              />
            </div>
            <ProNumber
              label="Straighten angle"
              value={draft.rotation}
              min={-180}
              max={180}
              step={0.1}
              onChange={(rotation) => changeCrop({ rotation })}
            />
            <p className="pro-help">
              Angle rotates the crop frame clockwise; export straightens its contents. Areas beyond
              the canvas stay transparent in PNG/WebP.
            </p>
            <div className="pro-actions">
              <Button onClick={onApply}>Apply crop</Button>
              <Button variant="secondary" onClick={onCancel}>
                Cancel crop
              </Button>
            </div>
          </>
        )}
        <Button variant="secondary" disabled={!doc.crop} onClick={onReset}>
          Reset crop
        </Button>
        <div className="pro-output-preview">
          <canvas ref={preview} aria-label="Crop and output preview" />
        </div>
        <p className="pro-help">
          Output preview · {size.width} × {size.height} px{draft ? " · unapplied crop shown" : ""}.
          Geometry preview; full-resolution filters run at export. Editing overlays are excluded.
        </p>
      </ToolSection>
      <ToolSection title="Image size · resample" defaultOpen>
        <p className="pro-help">
          Resample the cropped composite at export. Layer, text, mask and source coordinates remain
          editable at full canvas resolution. Undo or reset restores the original output grid.
        </p>
        <label className="pro-check">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          Lock image aspect ratio
        </label>
        <div className="pro-field-grid">
          <ProNumber
            label="Image width"
            value={width}
            min={1}
            max={16384}
            onChange={(n) => {
              setWidth(Math.round(n));
              if (lock) setHeight(Math.max(1, Math.round((n * size.height) / size.width)));
            }}
          />
          <ProNumber
            label="Image height"
            value={height}
            min={1}
            max={16384}
            onChange={(n) => {
              setHeight(Math.round(n));
              if (lock) setWidth(Math.max(1, Math.round((n * size.width) / size.height)));
            }}
          />
        </div>
        <label className="pro-field">
          Resampling
          <select
            className="field"
            aria-label="Image resampling"
            value={method}
            onChange={(e) => setMethod(e.target.value as Resampling)}
          >
            <option value="nearest">Nearest neighbor · pixel art</option>
            <option value="bilinear">Bilinear</option>
            <option value="bicubic">Bicubic</option>
            <option value="lanczos">Lanczos 3</option>
          </select>
        </label>
        <Button
          disabled={!!draft}
          onClick={() =>
            onCommit(
              { ...doc, imageSize: { width, height, resampling: method } },
              "Resize output image",
            )
          }
        >
          Apply image size
        </Button>
        <Button
          variant="secondary"
          disabled={!doc.imageSize || !!draft}
          onClick={() => onCommit({ ...doc, imageSize: undefined }, "Reset output image size")}
        >
          Reset image size
        </Button>
      </ToolSection>
      <ToolSection title="Canvas size · no resampling">
        <p className="pro-help">
          Extend or trim the canvas from its top-left origin. Artwork outside its boundaries is
          retained in the layers. Existing crop boundaries and output size remain independent.
        </p>
        <ProNumber
          label="Document width"
          value={canvasWidth}
          min={1}
          max={16384}
          onChange={(n) => setCanvasWidth(Math.round(n))}
        />
        <ProNumber
          label="Document height"
          value={canvasHeight}
          min={1}
          max={16384}
          onChange={(n) => setCanvasHeight(Math.round(n))}
        />
        <Button
          variant="secondary"
          disabled={!!draft}
          onClick={() =>
            onCommit({ ...doc, width: canvasWidth, height: canvasHeight }, "Resize canvas")
          }
        >
          Resize canvas
        </Button>
      </ToolSection>
    </fieldset>
  );
}
