import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Plus, Trash2, ArrowUp, ArrowDown, Scan, Download } from "lucide-react";
import { ProNumber } from "./pro-properties";
import {
  addArtboard,
  artboards,
  artboardRange,
  changeArtboard,
  layout,
  PRESETS,
  presetSize,
  removeArtboard,
  reorderArtboard,
  unionFrames,
  type Artboard,
  type Frame,
} from "@/lib/studio/pro/artboards";
import type { ProDocument } from "@/lib/studio/pro/model";
export function ProArtboards({
  doc,
  activeId,
  onActive,
  onCommit,
  onError,
  onTool,
  onFit,
  moveArtwork,
  onMoveArtwork,
  disabled,
  onExport,
}: {
  doc: ProDocument;
  activeId: string;
  onActive: (id: string) => void;
  onCommit: (d: ProDocument, label: string, group?: string) => void;
  onError: (s: string) => void;
  onTool: () => void;
  onFit: (frame: Frame, id?: string) => void;
  moveArtwork: boolean;
  onMoveArtwork: (b: boolean) => void;
  disabled: boolean;
  onExport: (boards: Artboard[], format: string, scale: number) => void;
}) {
  const boards = artboards(doc),
    b = boards.find((b) => b.id === activeId),
    s = layout(doc);
  const [range, setRange] = useState("all"),
    [format, setFormat] = useState("image/png"),
    [scale, setScale] = useState(1);
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const patch = (patch: Partial<Artboard>, label = "Edit artboard") =>
    attempt(() => {
      if (b)
        onCommit(
          changeArtboard(doc, b.id, patch, moveArtwork),
          label,
          `board:${b.id}:${Object.keys(patch).join()}`,
        );
    });
  return (
    <fieldset className="pro-layout-panel" disabled={disabled}>
      <h3>Artboards</h3>
      <p className="pro-help">
        Shared artwork stays intact. Deleting a board removes only its export boundary. Duplicate
        copies the boundary, not the artwork.
      </p>
      <div className="pro-layout-actions">
        <Button
          onClick={() =>
            attempt(() => {
              const n = addArtboard(doc);
              onCommit(n.document, "Create artboard");
              onActive(n.id);
              onTool();
              onFit(
                n.document.artboards!.find((b) => b.id === n.id)!,
                n.id,
              );
            })
          }
        >
          <Plus />
          New artboard
        </Button>
        <Button
          disabled={!b}
          variant="secondary"
          onClick={() =>
            attempt(() => {
              const n = addArtboard(doc, b!.id);
              onCommit(n.document, "Duplicate artboard");
              onActive(n.id);
              onFit(
                n.document.artboards!.find((b) => b.id === n.id)!,
                n.id,
              );
            })
          }
        >
          <Copy />
          Duplicate board
        </Button>
      </div>
      <label className="pro-field">
        Active artboard
        <select
          className="field"
          aria-label="Active artboard"
          value={b?.id ?? ""}
          onChange={(e) => onActive(e.target.value)}
        >
          <option value="" disabled>
            Select artboard
          </option>
          {boards.map((b, i) => (
            <option key={b.id} value={b.id}>
              {i + 1}. {b.name}
            </option>
          ))}
        </select>
      </label>
      {b && (
        <>
          <label className="pro-field">
            Artboard name
            <input
              className="field"
              aria-label="Artboard name"
              value={b.name}
              maxLength={100}
              onChange={(e) =>
                e.target.value.trim() && patch({ name: e.target.value }, "Rename artboard")
              }
            />
          </label>
          <div className="pro-layout-actions">
            {(["x", "y", "width", "height"] as const).map((k) => (
              <ProNumber
                key={k}
                label={`Artboard ${k}`}
                value={b[k]}
                min={k === "width" || k === "height" ? 1 : -100000}
                max={k === "width" || k === "height" ? 16384 : 100000}
                onChange={(n) =>
                  patch({ [k]: k === "width" || k === "height" ? Math.round(n) : n })
                }
              />
            ))}
          </div>
          <label className="pro-field">
            Preset
            <select
              className="field"
              aria-label="Artboard preset"
              value=""
              onChange={(e) =>
                attempt(() => patch(presetSize(e.target.value, s.dpi), "Artboard preset"))
              }
            >
              <option value="" disabled>
                Custom size · pixels
              </option>
              {PRESETS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <ProNumber
            label="Document DPI"
            min={36}
            max={1200}
            value={s.dpi}
            onChange={(dpi) =>
              onCommit({ ...doc, layout: { ...s, dpi } }, "Set preset DPI", "layout:dpi")
            }
          />
          <p className="pro-help">
            DPI converts physical presets to pixels. Changing DPI leaves existing geometry
            unchanged.
          </p>
          <Button
            variant="secondary"
            onClick={() => patch({ width: b.height, height: b.width }, "Swap artboard orientation")}
          >
            Swap portrait / landscape
          </Button>
          <label className="pro-field">
            Artboard background
            <select
              className="field"
              aria-label="Artboard background"
              value={b.background === "transparent" ? "transparent" : "color"}
              onChange={(e) =>
                patch({ background: e.target.value === "transparent" ? "transparent" : "#ffffff" })
              }
            >
              <option value="transparent">Transparent</option>
              <option value="color">Color</option>
            </select>
            {b.background !== "transparent" && (
              <input
                type="color"
                aria-label="Artboard background color"
                value={b.background}
                onChange={(e) => patch({ background: e.target.value })}
              />
            )}
          </label>
          <div className="pro-layout-actions">
            <Button
              variant="secondary"
              disabled={boards[0]?.id === b.id}
              onClick={() => onCommit(reorderArtboard(doc, b.id, -1), "Reorder artboard")}
            >
              <ArrowUp />
              Earlier
            </Button>
            <Button
              variant="secondary"
              disabled={boards.at(-1)?.id === b.id}
              onClick={() => onCommit(reorderArtboard(doc, b.id, 1), "Reorder artboard")}
            >
              <ArrowDown />
              Later
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                onTool();
                onFit(b, b.id);
              }}
            >
              <Scan />
              Fit selected board
            </Button>
            <Button
              variant="secondary"
              onClick={() => onCommit(removeArtboard(doc, b.id), "Delete artboard boundary")}
            >
              <Trash2 />
              Delete boundary
            </Button>
          </div>
        </>
      )}
      <Button
        disabled={!boards.length}
        variant="secondary"
        onClick={() => onFit(unionFrames(boards))}
      >
        Fit all artboards
      </Button>
      <label className="pro-check">
        <input
          type="checkbox"
          checked={s.boundaries}
          onChange={(e) =>
            onCommit(
              { ...doc, layout: { ...s, boundaries: e.target.checked } },
              "Show artboard boundaries",
            )
          }
        />
        Show artboard boundaries
      </label>
      <label className="pro-check">
        <input
          type="checkbox"
          checked={moveArtwork}
          onChange={(e) => onMoveArtwork(e.target.checked)}
        />
        Move contained artwork with artboard
      </label>
      <p className="pro-help">
        Move artwork includes fully contained root groups and linked members; locked artwork blocks
        the entire move. Resizing never scales artwork. Drag commits on release; Escape or touch
        cancellation restores the starting document.
      </p>
      <h3>Artboard exports</h3>
      <label className="pro-field">
        Format
        <select
          className="field"
          aria-label="Artboard export format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          {["image/png", "image/jpeg", "image/webp", "image/svg+xml"].map((f) => (
            <option key={f} value={f}>
              {f === "image/svg+xml" ? "SVG · vectors only" : f.split("/")[1]!.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <ProNumber
        label="Artboard raster export scale"
        value={scale}
        min={0.1}
        max={8}
        step={0.1}
        onChange={setScale}
      />
      <Button disabled={!b} onClick={() => b && onExport([b], format, scale)}>
        <Download />
        Export selected artboard
      </Button>
      <label className="pro-field">
        Artboard range
        <input
          className="field"
          aria-label="Artboard export range"
          value={range}
          onChange={(e) => setRange(e.target.value)}
          placeholder="all or 1,3-5"
        />
      </label>
      <Button
        disabled={!boards.length}
        variant="secondary"
        onClick={() => attempt(() => onExport(artboardRange(doc, range), format, scale))}
      >
        Export range / all artboards
      </Button>
      <p className="pro-help">
        Each board downloads separately in panel order. Allow multiple downloads in your browser.
        SVG keeps supported vectors/text; raster, masks and unsupported effects require PNG or
        native. Apply to Chapter uses the original canvas/crop; artboards export separately.
        Whole-document exports remain in Save & export.
      </p>
    </fieldset>
  );
}
