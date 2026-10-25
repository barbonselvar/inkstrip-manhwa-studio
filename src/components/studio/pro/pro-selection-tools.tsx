import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ToolSection } from "../design/tool-section";
import { MODIFY_LIMITS, type ModifyOperation } from "@/lib/studio/pro/selection-tools";
import { ProNumber } from "./pro-properties";

/** Selection modify, mask, clipboard and Quick Mask commands. Every action runs on the
 * document selection (the single source of truth); none of them is a visual overlay. */
export function ProSelectionTools({
  hasSelection,
  canMask,
  hasMask,
  canLift,
  clipboard,
  quickMask,
  quickMaskOpacity,
  disabled,
  onModify,
  onAddToMask,
  onSelectionFromMask,
  onCopy,
  onCut,
  onPaste,
  onLayerViaCopy,
  onLayerViaCut,
  onQuickMask,
  onQuickMaskOpacity,
}: {
  hasSelection: boolean;
  canMask: boolean;
  hasMask: boolean;
  canLift: boolean;
  clipboard: string | null;
  quickMask: boolean;
  quickMaskOpacity: number;
  disabled: boolean;
  onModify: (operation: ModifyOperation, amount: number) => void;
  onAddToMask: () => void;
  onSelectionFromMask: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onLayerViaCopy: () => void;
  onLayerViaCut: () => void;
  onQuickMask: () => void;
  onQuickMaskOpacity: (opacity: number) => void;
}) {
  const [amount, setAmount] = useState(4);
  return (
    <ToolSection title="Selection tools" defaultOpen>
      <div className="pro-actions">
        <Button
          variant={quickMask ? "secondary" : "ghost"}
          aria-pressed={quickMask}
          disabled={disabled}
          onClick={onQuickMask}
        >
          {quickMask ? "Exit Quick Mask" : "Quick Mask"}
        </Button>
      </div>
      {quickMask && (
        <>
          <ProNumber
            label="Quick Mask overlay opacity"
            value={Math.round(quickMaskOpacity * 100)}
            min={10}
            max={90}
            onChange={(n) => onQuickMaskOpacity(n / 100)}
          />
          <p className="pro-help" role="status">
            Quick Mask: paint (Brush/Pencil) to add to the selection and erase to remove it. Hardness,
            opacity, flow and pen pressure set partial coverage. The tinted area is selected.
            Exit to turn it back into a selection; export is paused until then.
          </p>
        </>
      )}
      <ToolSection title="Modify selection" defaultOpen={false}>
        <ProNumber
          label="Modify amount (px)"
          value={amount}
          min={1}
          max={MODIFY_LIMITS.border[1]}
          onChange={setAmount}
        />
        <div className="pro-actions">
          {(["expand", "contract", "border", "smooth"] as const).map((op) => (
            <Button
              key={op}
              variant="ghost"
              disabled={disabled || !hasSelection || amount > MODIFY_LIMITS[op][1]}
              onClick={() => onModify(op, amount)}
            >
              {op === "expand"
                ? "Expand"
                : op === "contract"
                  ? "Contract"
                  : op === "border"
                    ? "Border"
                    : "Smooth"}
            </Button>
          ))}
        </div>
        <p className="pro-help">
          Expand/Contract by up to 100 px, Border up to 200 px wide, Smooth up to 100 px. Computed
          at document resolution; the selection feather stays a separate setting.
        </p>
      </ToolSection>
      <ToolSection title="Selection and masks" defaultOpen={false}>
        <div className="pro-actions">
          <Button
            variant="ghost"
            disabled={disabled || !hasSelection || !canMask || !hasMask}
            onClick={onAddToMask}
          >
            Add selection to mask
          </Button>
          <Button variant="ghost" disabled={disabled || !hasMask} onClick={onSelectionFromMask}>
            Selection from mask
          </Button>
        </div>
        <p className="pro-help">
          Mask from selection (Layer mask section) creates or replaces the mask. Add selection to
          mask keeps the existing mask and reveals the selection too; Selection from mask loads
          the mask as a selection using the current selection mode. Masks themselves are never
          changed by loading.
        </p>
      </ToolSection>
      <ToolSection title="Copy, cut and paste" defaultOpen={false}>
        <div className="pro-actions">
          <Button variant="ghost" disabled={disabled || !canLift} onClick={onCopy}>
            Copy pixels
          </Button>
          <Button variant="ghost" disabled={disabled || !canLift} onClick={onCut}>
            Cut pixels
          </Button>
          <Button variant="ghost" disabled={disabled || !clipboard} onClick={onPaste}>
            Paste as layer
          </Button>
          <Button variant="ghost" disabled={disabled || !canLift} onClick={onLayerViaCopy}>
            Layer via copy
          </Button>
          <Button variant="ghost" disabled={disabled || !canLift} onClick={onLayerViaCut}>
            Layer via cut
          </Button>
        </div>
        <p className="pro-help">
          {clipboard ? `Clipboard: ${clipboard}. ` : ""}Works on one visible, unlocked raster or
          paint layer (canvas up to 4MP). Cut keeps the original hidden and editable. Ctrl/Cmd+C,
          X, V, J (layer via copy) and Shift+J (layer via cut).
        </p>
      </ToolSection>
    </ToolSection>
  );
}
