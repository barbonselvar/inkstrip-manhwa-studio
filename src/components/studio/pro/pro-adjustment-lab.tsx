import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ColorOperationFields, ColorPresetControls, ColorHistogramView } from "./pro-color-lab";
import {
  ADJUSTMENT_KINDS,
  isAdjustmentOperation,
  type AdjustmentLayerSettings,
} from "@/lib/studio/pro/adjustment-schema";
import { adjustmentDocument, type AdjustmentDraft } from "@/lib/studio/pro/adjustment-layer";
import { defaultOperation, type Channel, type ColorOperation } from "@/lib/studio/pro/color-engine";
import { ProRenderer } from "@/lib/studio/pro/client";
import type { ColorHistogram } from "@/lib/studio/pro/adjustment-tiles";
import type { ProSession } from "@/lib/studio/pro/model";

export function ProAdjustmentLab({
  draft,
  session,
  maxArea,
  onCancel,
  onApply,
}: {
  draft: AdjustmentDraft;
  session: ProSession;
  maxArea: number;
  onCancel: () => void;
  onApply: (a: AdjustmentLayerSettings) => true | string;
}) {
  const [base] = useState(() => {
    const settings = draft.created
      ? { version: 1 as const, operation: defaultOperation("brightnessContrast") }
      : draft.origin.layers.find((l) => l.id === draft.layerId)!.adjustmentLayer!;
    if (!isAdjustmentOperation(settings.operation))
      throw Error("Unsupported persistent color adjustment.");
    const initial: AdjustmentLayerSettings = { ...settings, operation: settings.operation };
    return { settings: initial, document: adjustmentDocument(draft, initial, maxArea), session };
  });
  const [operation, setOperation] = useState<ColorOperation>(() =>
      structuredClone(base.settings.operation),
    ),
    [preset, setPreset] = useState(base.settings.preset?.name),
    [channel, setChannel] = useState<Channel>("rgb"),
    [before, setBefore] = useState(false),
    [hist, setHist] = useState<ColorHistogram | null>(null),
    [histDone, setHistDone] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [processing, setProcessing] = useState(true),
    [displayed, setDisplayed] = useState(""),
    [displayedView, setDisplayedView] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<ProRenderer | null>(null),
    generation = useRef(0);
  const settings = useMemo<AdjustmentLayerSettings>(() => {
    if (!isAdjustmentOperation(operation)) throw Error("Unsupported persistent color adjustment.");
    return { version: 1, operation, ...(preset ? { preset: { name: preset } } : {}) };
  }, [operation, preset]);
  const proposed = useMemo(() => {
    try {
      return { document: adjustmentDocument(draft, settings, maxArea), error: "" };
    } catch (e) {
      return { document: draft.origin, error: (e as Error).message };
    }
  }, [draft, settings, maxArea]);
  const key = JSON.stringify(settings),
    latest = useRef(key);
  latest.current = key;
  const viewKey = `${before ? "before" : "after"}:${key}`;
  const waiting = processing || displayedView !== viewKey;
  useEffect(() => {
    let active = true;
    const worker = new ProRenderer();
    renderer.current = worker;
    void worker
      .init({ ...base.session, document: base.document }, maxArea)
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setProcessing(false);
        }
      });
    return () => {
      active = false;
      renderer.current = null;
      worker.dispose();
    };
  }, [base, maxArea]);
  useEffect(() => {
    let active = true;
    const worker = new ProRenderer();
    void worker
      .init({ ...base.session, document: base.document }, maxArea)
      .then(() => worker.adjustmentHistogram(base.document, maxArea, draft.layerId))
      .then((r) => {
        if (active) {
          setHist(r.histogram ?? null);
          setHistDone(true);
        }
      })
      .catch((e) => {
        if (active && e.name !== "AbortError") {
          setHistDone(true);
          setError(e.message);
        }
      })
      .finally(() => worker.dispose());
    return () => {
      active = false;
      worker.dispose();
    };
  }, [base, maxArea, draft.layerId]);
  useEffect(() => {
    if (!ready || !renderer.current) return;
    const run = ++generation.current;
    setProcessing(true);
    setError(proposed.error);
    if (proposed.error) {
      setProcessing(false);
      return;
    }
    const timer = setTimeout(() => {
      void renderer
        .current!.render(before ? draft.origin : proposed.document, maxArea)
        .then((r) => {
          if (!r.bitmap) return;
          if (generation.current !== run) {
            r.bitmap.close();
            return;
          }
          const c = canvas.current;
          if (c) {
            c.width = r.bitmap.width;
            c.height = r.bitmap.height;
            c.getContext("2d")!.drawImage(r.bitmap, 0, 0);
            if (!before) setDisplayed(key);
            setDisplayedView(viewKey);
          }
          r.bitmap.close();
          setProcessing(false);
        })
        .catch((e) => {
          if (generation.current === run && e.name !== "AbortError") {
            setError(e.message);
            setProcessing(false);
          }
        });
    }, 70);
    return () => {
      clearTimeout(timer);
      if (generation.current === run) generation.current = run + 1;
    };
  }, [ready, proposed, draft, before, key, viewKey, maxArea]);
  const edit: React.Dispatch<React.SetStateAction<ColorOperation>> = (value) => {
    setOperation(value);
    setPreset(undefined);
    setBefore(false);
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="r6-overlay" />
        <Dialog.Content
          className="r6-lab"
          onInteractOutside={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key !== "Escape") e.stopPropagation();
          }}
          onEscapeKeyDown={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          <header>
            <div>
              <Dialog.Title>Color adjustment layer</Dialog.Title>
              <Dialog.Description>
                {draft.created ? "New editable adjustment" : "Edit saved adjustment"} ·{" "}
                {draft.origin.width} × {draft.origin.height} canvas
              </Dialog.Description>
            </div>
            <Button variant="ghost" onClick={onCancel}>
              Cancel adjustment
            </Button>
          </header>
          <p className="pro-help">
            Live composite preview. Apply saves editable settings in this layer; original artwork
            stays unchanged. Masks, opacity, clipping and layer order control its coverage.
          </p>
          <div className="r6-lab-grid">
            <div className="r6-preview-column">
              <div className="r6-preview">
                <canvas
                  ref={canvas}
                  aria-label="Adjustment composite preview"
                  aria-busy={waiting && !error}
                />
              </div>
              <label className="pro-check">
                <input
                  type="checkbox"
                  aria-label="Compare committed adjustment"
                  checked={before}
                  onChange={(e) => setBefore(e.target.checked)}
                />
                Before / after
              </label>
              <ColorHistogramView bins={hist?.[channel]} />
              {histDone && !hist && (
                <p className="pro-help">
                  Show the adjustment and its parent group to inspect the source histogram.
                </p>
              )}
              <p className="pro-help" role="status">
                {error
                  ? "Preview unavailable"
                  : waiting
                    ? "Rendering adjustment…"
                    : before
                      ? "Committed document"
                      : "Editable composite preview"}
              </p>
              {preset && <p className="pro-help">Preset: {preset}</p>}
            </div>
            <div className="r6-controls">
              <ColorOperationFields
                operation={operation}
                setOperation={edit}
                channel={channel}
                setChannel={setChannel}
                hist={hist}
                allowedKinds={ADJUSTMENT_KINDS}
              />
              <ColorPresetControls
                operation={operation}
                allowedKinds={ADJUSTMENT_KINDS}
                onChange={(a, name) => {
                  setOperation(a);
                  setPreset(name);
                  setBefore(false);
                }}
              />
            </div>
          </div>
          {(error || proposed.error) && (
            <p className="pro-error" role="alert">
              {error || proposed.error}
            </p>
          )}
          <footer>
            <Button
              variant="secondary"
              onClick={() => {
                setOperation(defaultOperation(operation.kind));
                setPreset(undefined);
                setBefore(false);
              }}
            >
              Reset adjustment
            </Button>
            <Button
              disabled={waiting || !!error || !!proposed.error || displayed !== key}
              onClick={() => {
                if (displayed !== latest.current) return;
                const accepted = onApply(settings);
                if (accepted === true) onCancel();
                else setError(accepted);
              }}
            >
              Apply adjustment
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
