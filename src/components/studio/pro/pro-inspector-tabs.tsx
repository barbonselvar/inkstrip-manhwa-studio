import { ImageCapabilityNotice } from "../image-capability-notice";
import { useImageUrl } from "@/lib/studio/use-image-url";
import { Download, Folder, Redo2, Save, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolSection } from "../design/tool-section";
import { ProNumber } from "./pro-properties";
import { outputSize } from "@/lib/studio/pro/geometry";
import type { History } from "@/lib/studio/editor/history";
import type { ProDocument } from "@/lib/studio/pro/model";
import type { CharacterProfile } from "@/lib/studio/characters/types";
import { svgImportHelp } from "@/lib/studio/pro/svg-capabilities";

/** Self-contained inspector tabs of the Pro workspace. State stays in ProWorkspace. */

export function ProHistoryTab({
  history,
  onUndo,
  onRedo,
}: {
  history: History<{ label: string }>;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <>
      <h3>Document history</h3>
      <p className="pro-help">
        Up to 50 metadata states. Brush gestures form one step. Pan and zoom never alter artwork.
      </p>
      <div className="pro-actions">
        <Button disabled={!history.past.length} onClick={onUndo}>
          <Undo2 />
          Undo
        </Button>
        <Button disabled={!history.future.length} onClick={onRedo}>
          <Redo2 />
          Redo
        </Button>
      </div>
      <ol className="pro-history-list">
        {[...history.past, history.present].map((entry, i) => (
          <li key={i} data-current={i === history.past.length}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            {entry.label}
          </li>
        ))}
      </ol>
    </>
  );
}

function ReferenceImage({
  blob,
  name,
  onPlace,
}: {
  blob: Blob;
  name: string;
  onPlace: () => void;
}) {
  const { url, error } = useImageUrl(blob);
  return (
    <div className="pro-reference">
      <img src={url || undefined} title={error || undefined} alt={`${name} character reference`} />
      <div>
        <strong>{name}</strong>
        <Button variant="secondary" onClick={onPlace}>
          Place reference
        </Button>
      </div>
    </div>
  );
}

export function ProAssetsTab({
  size,
  disabled,
  characters,
  onImport,
  onPlace,
}: {
  size?: { width: number; height: number };
  disabled: boolean;
  characters: CharacterProfile[] | undefined;
  onImport: (file: File | undefined) => void;
  onPlace: (blob: Blob, name: string) => void;
}) {
  return (
    <>
      <h3>Assets & characters</h3>
      <ImageCapabilityNotice {...size} />
      <p className="pro-help">
        References belong to this project. Placing one creates a separate raster layer; no identity
        matching or upload occurs.
      </p>
      <label className="pro-import field">
        <Folder />
        Import image / SVG / native
        <input
          aria-label="Import Pro asset"
          disabled={disabled}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,.inkstrip"
          onChange={(e) => {
            onImport(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <p className="pro-help">
        {svgImportHelp()} Native import replaces this draft; Chapter artwork is retained.
      </p>
      {characters?.length ? (
        characters.map((c) => (
          <div key={c.id}>
            <h4>{c.name}</h4>
            <p className="pro-help">{c.notes}</p>
            {c.references.map((r) => (
              <ReferenceImage
                key={r.id}
                blob={r.blob}
                name={`${c.name} · ${r.angle}`}
                onPlace={() => onPlace(r.blob, c.name)}
              />
            ))}
          </div>
        ))
      ) : (
        <div className="pro-empty">
          <Folder />
          <p>No saved character references yet.</p>
          <span>Use the existing image tools to select and save a reference face.</span>
        </div>
      )}
    </>
  );
}

export function ProAiTab({
  disabled,
  onContinue,
}: {
  disabled: boolean;
  onContinue: (mode: "enhance" | "image" | "face") => void;
}) {
  return (
    <>
      <div className="pro-section-heading">
        <h3>Artwork intelligence</h3>
        <Sparkles />
      </div>
      <p className="pro-help">
        Apply the current composite, then continue in the existing tested image workflow. Layered
        Pro drafts remain editable here. These actions change the chapter only after the composite
        succeeds.
      </p>
      <Button intent="ai" disabled={disabled} onClick={() => onContinue("enhance")}>
        Apply + Swin2SR Enhance
      </Button>
      <p className="pro-help">
        Genuine local ONNX/WASM inference. First use downloads model assets; no artwork upload.
      </p>
      <Button variant="secondary" disabled={disabled} onClick={() => onContinue("image")}>
        Apply + Image tools
      </Button>
      <p className="pro-help">
        Crop, adjustments, object masks, traditional local texture repair and trained anime-face
        detection. Cloud generative editing requires the existing server configuration and explicit
        upload consent.
      </p>
      <Button variant="secondary" disabled={disabled} onClick={() => onContinue("face")}>
        Apply + AI Face Fix
      </Button>
      <p className="pro-help">
        Optional reference-guided cloud generation. No local face generator or guaranteed identity
        preservation. Upload consent is requested in that workflow.
      </p>
    </>
  );
}

export function ProExportTab({
  doc,
  cropPending,
  busy,
  ready,
  mime,
  quality,
  onMime,
  onQuality,
  onExport,
  onOpenGeometry,
  onBackground,
}: {
  doc: ProDocument;
  cropPending: boolean;
  busy: boolean;
  ready: boolean;
  mime: string;
  quality: number;
  onMime: (mime: string) => void;
  onQuality: (quality: number) => void;
  onExport: (kind: "raster" | "native" | "svg") => void;
  onOpenGeometry: () => void;
  onBackground: (background: string) => void;
}) {
  const size = outputSize(doc);
  return (
    <>
      <h3>Save & export</h3>
      {cropPending && (
        <p className="pro-help">
          Apply or cancel your crop draft before exporting. Exports use committed boundaries.
        </p>
      )}
      <p className="pro-help">
        Native documents keep layers and source bytes. Raster exports flatten the current document
        at its exact dimensions. JPEG uses a white background for transparency.
      </p>
      <Button onClick={() => onExport("native")}>
        <Save />
        Export editable .inkstrip
      </Button>
      <Button variant="secondary" onClick={() => onExport("svg")}>
        Export SVG · vectors only
      </Button>
      <label className="pro-field">
        Raster format
        <select
          className="field"
          aria-label="Pro export format"
          value={mime}
          onChange={(e) => onMime(e.target.value)}
        >
          {["image/png", "image/jpeg", "image/webp"].map((m) => (
            <option value={m} key={m}>
              {m.split("/")[1]!.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      {mime !== "image/png" && (
        <ProNumber
          label="Export quality"
          value={quality * 100}
          min={10}
          max={100}
          onChange={(n) => onQuality(n / 100)}
        />
      )}
      <Button intent="export" disabled={busy || !ready} onClick={() => onExport("raster")}>
        <Download />
        Export composite · {size.width} × {size.height}
      </Button>
      <Button variant="secondary" onClick={onOpenGeometry}>
        Crop, canvas & image size
      </Button>
      <ToolSection title="Document background">
        <label className="pro-field">
          Background
          <select
            className="field"
            aria-label="Document background"
            value={doc.background}
            onChange={(e) => onBackground(e.target.value)}
          >
            <option value="transparent">Transparent</option>
            <option value="#ffffff">White</option>
            <option value="#172420">Ink</option>
          </select>
        </label>
      </ToolSection>
    </>
  );
}
