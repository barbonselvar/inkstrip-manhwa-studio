import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import type { ProDocument, Selection } from "@/lib/studio/pro/model";
import { REFINE_DEFAULTS, type RefineOptions } from "@/lib/studio/pro/refine-selection";
import { ProNumber } from "./pro-properties";
export type SelectionView = "overlay" | "mask" | "ants";
export function ProRefine({
  document,
  disabled,
  canMask,
  onGenerate,
  onPreview,
  onView,
  onApply,
  onDocument,
  sample,
  onArmSample,
}: {
  sample: { key: "foreground" | "background"; color: [number, number, number] } | null;
  onArmSample: (key: "foreground" | "background" | null) => void;
  document: ProDocument;
  disabled: boolean;
  canMask: boolean;
  onGenerate: (options: RefineOptions) => Promise<Selection | undefined>;
  onPreview: (selection: Selection | null) => void;
  onView: (view: SelectionView) => void;
  onApply: (selection: Selection, mask: boolean) => void;
  onDocument: (document: ProDocument, label: string) => void;
}) {
  const [options, setOptions] = useState<RefineOptions>(REFINE_DEFAULTS),
    [draft, setDraft] = useState<Selection | null>(null),
    [name, setName] = useState("Selection 1"),
    [outputMask, setOutputMask] = useState(false),
    [live, setLive] = useState(true);
  const previewed = useRef(false);
  const sequence = useRef(0),
    generate = useRef<() => Promise<void>>(async () => {});
  generate.current = async () => {
    if (disabled) return;
    const run = ++sequence.current,
      next = await onGenerate(options);
    if (next && run === sequence.current) {
      setDraft(next);
      onPreview(next);
      previewed.current = true;
    }
  };
  useEffect(() => {
    if (!live || !previewed.current) return;
    const timer = setTimeout(() => {
      if (previewed.current) void generate.current();
    }, 350);
    return () => clearTimeout(timer);
  }, [options, live]);
  const invalidate = useCallback(() => {
    ++sequence.current;
  }, []);
  useEffect(() => {
    invalidate();
    previewed.current = false;
    setDraft(null);
    onPreview(null);
    return () => {
      invalidate();
      onPreview(null);
      onArmSample(null);
    };
  }, [document, onPreview, onArmSample, invalidate]);
  useEffect(() => {
    if (sample) {
      setOptions((o) => ({ ...o, [sample.key]: sample.color }));
      setDraft(null);
      onPreview(null);
    }
  }, [sample, onPreview]);
  const cancel = (reset = true) => {
    if (reset) previewed.current = false;
    ++sequence.current;
    setDraft(null);
    onPreview(null);
  };
  const change = (p: Partial<RefineOptions>) => {
    cancel(false);
    setOptions((o) => ({ ...o, ...p }));
  };
  return (
    <div className="pro-properties-content">
      <h3>Select and Mask</h3>
      <p className="pro-help">
        Native-resolution morphology and local color-line matting. Use a rough selection first.
        Similar foreground/background colors and complex hair may need manual mask painting. This
        tool does not use AI.
      </p>
      <fieldset disabled={disabled}>
        <ProNumber
          label="Clean islands smaller than pixels"
          value={options.cleanup ?? 0}
          min={0}
          max={4096}
          onChange={(n) => change({ cleanup: Math.round(n) })}
        />
        <label className="pro-check">
          <input
            type="checkbox"
            checked={options.fillHoles ?? false}
            onChange={(e) => change({ fillHoles: e.target.checked })}
          />
          Also fill small enclosed holes
        </label>
        <div className="pro-number-grid">
          {(
            [
              ["radius", "Edge radius", 0, 64, 1],
              ["smooth", "Refine smoothing", 0, 32, 1],
              ["feather", "Refine feather", 0, 100, 1],
              ["contrast", "Edge contrast", 0, 1, 0.05],
              ["shift", "Expand / contract pixels", -64, 64, 1],
            ] as const
          ).map(([key, label, min, max, step]) => (
            <ProNumber
              key={key}
              label={label}
              value={options[key]}
              min={min}
              max={max}
              step={step}
              onChange={(n) => change({ [key]: n })}
            />
          ))}
        </div>
        <label className="pro-check">
          <input
            type="checkbox"
            aria-label="Edge-aware color refinement"
            checked={options.edgeAware}
            onChange={(e) => change({ edgeAware: e.target.checked })}
          />
          Edge-aware color refinement
        </label>
        {(["foreground", "background"] as const).map((key) => (
          <div key={key}>
            <Button
              variant="secondary"
              onClick={() => {
                cancel();
                onArmSample(key);
              }}
            >
              Sample {key} from canvas
            </Button>
            <label className="pro-check">
              <input
                type="checkbox"
                aria-label={`Use ${key} color sample`}
                checked={!!options[key]}
                onChange={(e) =>
                  change({
                    [key]: e.target.checked
                      ? key === "foreground"
                        ? [0, 0, 0]
                        : [255, 255, 255]
                      : undefined,
                  })
                }
              />
              Use {key} color sample
            </label>
            {options[key] && (
              <label className="pro-field">
                {key} reference color
                <input
                  aria-label={`${key} reference color`}
                  type="color"
                  value={`#${options[key]!.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`}
                  onChange={(e) =>
                    change({
                      [key]: [1, 3, 5].map((i) => parseInt(e.target.value.slice(i, i + 2), 16)),
                    })
                  }
                />
              </label>
            )}
          </div>
        ))}
        <label className="pro-field">
          Selection preview
          <select
            className="field"
            aria-label="Selection preview"
            onChange={(e) => onView(e.target.value as SelectionView)}
          >
            <option value="overlay">Coverage overlay</option>
            <option value="mask">Black / white mask</option>
            <option value="ants">Marching ants</option>
          </select>
        </label>
        <label className="pro-check">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Update preview when settings change
        </label>
        <div className="pro-actions">
          <Button
            variant="secondary"
            onClick={() => {
              void generate.current();
            }}
          >
            Preview refinement
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              cancel();
              setOptions(REFINE_DEFAULTS);
            }}
          >
            Reset refinement
          </Button>
        </div>
        <label className="pro-check">
          <input
            type="checkbox"
            aria-label="Output refinement to mask"
            checked={outputMask}
            disabled={!canMask}
            onChange={(e) => setOutputMask(e.target.checked)}
          />
          Output to layer mask
        </label>
        <div className="pro-actions">
          <Button
            disabled={!draft || (outputMask && !canMask)}
            onClick={() => {
              if (draft) onApply(draft, outputMask);
              cancel();
            }}
          >
            Apply refinement
          </Button>
          <Button variant="ghost" disabled={!draft} onClick={() => cancel()}>
            Cancel refinement
          </Button>
        </div>
        <h3>Saved selections</h3>
        <label className="pro-field">
          Selection name
          <input
            className="field"
            aria-label="Selection name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button
          variant="secondary"
          disabled={
            !name.trim() ||
            ((document.savedSelections?.length ?? 0) >= 16 &&
              !document.savedSelections?.some((s) => s.name === name.trim()))
          }
          onClick={() =>
            onDocument(
              {
                ...document,
                savedSelections: [
                  ...(document.savedSelections ?? []).filter((s) => s.name !== name.trim()),
                  {
                    name: name.trim(),
                    selection: structuredClone(
                      document.selection ?? { regions: [], inverted: false, feather: 0 },
                    ),
                  },
                ],
              },
              "Save selection",
            )
          }
        >
          Save selection
        </Button>
        {(document.savedSelections ?? []).map((s) => (
          <div className="pro-actions" key={s.name}>
            <Button
              variant="secondary"
              onClick={() => onApply(structuredClone(s.selection), false)}
            >
              Load {s.name}
            </Button>
            <Button
              variant="ghost"
              aria-label={`Delete selection ${s.name}`}
              onClick={() =>
                onDocument(
                  {
                    ...document,
                    savedSelections: document.savedSelections!.filter((v) => v.name !== s.name),
                  },
                  "Delete saved selection",
                )
              }
            >
              Delete
            </Button>
          </div>
        ))}
      </fieldset>
    </div>
  );
}
