import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  RotateCcw,
  ShieldCheck,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { EnhancementEngine } from "@/lib/studio/enhance/client";
import {
  DEFAULT_ENHANCE,
  ENHANCE_PRESETS,
  enhancementSize,
  enhancementSettingsKey,
  type EnhanceOptions,
  type EnhanceProgress,
  type EnhanceResult,
} from "@/lib/studio/enhance/types";
import { ENHANCE_MODELS, type EnhanceModel } from "@/lib/studio/enhance/models";
import { getBlob, storageMessage } from "@/lib/studio/db";
import { useStudio } from "@/lib/studio/store";
import type { Panel } from "@/lib/studio/types";

type Preview = { panel: Panel; before: Blob; after: EnhanceResult; options: EnhanceOptions };

export function EnhanceDialog({ panels, onClose }: { panels: Panel[]; onClose: () => void }) {
  const [options, setOptions] = useState<EnhanceOptions>(DEFAULT_ENHANCE);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<EnhanceProgress>({ stage: "", done: 0, total: 0 });
  const [current, setCurrent] = useState(0);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [index, setIndex] = useState(0);
  const [split, setSplit] = useState(50);
  const [actualSize, setActualSize] = useState(false);
  const [urls, setUrls] = useState<{ before: string; after: string } | null>(null);
  const [message, setMessage] = useState("");
  const engine = useRef<EnhancementEngine | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const preview = previews[index];
  const settingsChanged = previews.some(
    (item) => enhancementSettingsKey(item.options) !== enhancementSettingsKey(options),
  );
  const replace = useStudio((state) => state.replacePanelImage);
  const restore = useStudio((state) => state.restorePanel);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true;
      engine.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (!preview) {
      setUrls(null);
      return;
    }
    const before = URL.createObjectURL(preview.before),
      after = URL.createObjectURL(preview.after.blob);
    setUrls({ before, after });
    return () => {
      URL.revokeObjectURL(before);
      URL.revokeObjectURL(after);
    };
  }, [preview]);

  async function run() {
    if (running || saving) return;
    setMessage("");
    setPreviews([]);
    setIndex(0);
    setRunning(true);
    cancelled.current = false;
    engine.current = new EnhancementEngine();
    let completed = 0;
    try {
      // Bound retained batch previews on memory-constrained phones.
      if (panels.length > 12) throw new Error("Select up to 12 images per batch.");
      let pixels = 0,
        outputPixels = 0;
      for (const panel of panels) {
        const source = panel;
        const planned = enhancementSize(source.width, source.height, options.scale);
        outputPixels += planned.width * planned.height;
        pixels += source.width * source.height;
      }
      if (pixels > 8_000_000 || outputPixels > 32_000_000)
        throw new Error(
          "This batch exceeds 8 source or 32 output megapixels. Select fewer images to keep memory bounded.",
        );
      for (let i = 0; i < panels.length; i++) {
        if (cancelled.current) break;
        const panel = panels[i]!;
        setCurrent(i + 1);
        setProgress({ stage: "Reading accepted image", done: 0, total: 0 });
        const before = await getBlob(panel.blobId);
        if (!before) throw new Error(`Image missing: ${panel.name}. Current image unchanged.`);
        if (cancelled.current) break;
        const after = await engine.current!.run(before, options, (value) => {
          if (mounted.current) setProgress(value);
        });
        if (cancelled.current) break;
        completed++;
        setPreviews((items) => [...items, { panel, before, after, options: { ...options } }]);
      }
      if (mounted.current)
        setMessage(
          cancelled.current
            ? `Cancelled. ${completed} completed preview(s) kept. No images were changed.`
            : "Ready to compare. Zoom in on lettering and faces before applying.",
        );
    } catch (error) {
      if (mounted.current)
        setMessage(
          cancelled.current
            ? `Cancelled. ${completed} completed preview(s) kept. Originals unchanged.`
            : `${storageMessage(error)} ${completed ? `${completed} completed preview(s) kept.` : ""}`,
        );
    } finally {
      engine.current?.dispose();
      engine.current = null;
      if (mounted.current) setRunning(false);
    }
  }

  async function apply() {
    if (settingsChanged) {
      setMessage("Settings changed. Regenerate before applying these previews.");
      return;
    }
    setSaving(true);
    setMessage("");
    let applied = 0;
    try {
      for (const item of previews) {
        const current = useStudio.getState().panels.find((panel) => panel.id === item.panel.id);
        if (!current || current.blobId !== item.panel.blobId)
          throw new Error("An image changed while previewing. Close and reopen enhancement.");
        await replace(item.panel.id, item.after.blob, { expectedBlobId: item.panel.blobId });
        applied++;
      }
      setPreviews([]);
      setMessage(
        `Applied ${applied} image(s). Originals retained. Press Display again to rebuild the chapter.`,
      );
    } catch (error) {
      setPreviews((items) => items.slice(applied));
      setIndex(0);
      setMessage(`${applied} image(s) applied. ${storageMessage(error)} Originals retained.`);
    } finally {
      setSaving(false);
    }
  }

  async function recover() {
    setSaving(true);
    try {
      let count = 0;
      for (const panel of panels) {
        if (useStudio.getState().panels.find((item) => item.id === panel.id)?.original) {
          await restore(panel.id);
          count++;
        }
      }
      setPreviews([]);
      setMessage(`Restored ${count} original image(s). Press Display to refresh the chapter.`);
    } catch (error) {
      setMessage(storageMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const locked = running || saving;
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
      title="AI Enhance"
      description="Restore detail. Keep the story yours."
      wide
    >
      <div className="ai-intro">
        <Sparkles className="size-5 text-accent" />
        <p>Real, local neural restoration. No image uploads or API keys.</p>
      </div>
      <p className="mt-3 text-xs text-muted">
        {options.model === "realesrgan-anime"
          ? "Fast Anime downloads about 14 MB of model/runtime assets."
          : "Swin2SR downloads about 65 MB of model/runtime assets and can be slow on a phone."}{" "}
        Review faces and fine text: neural enhancement can change small details. Identity
        preservation is not guaranteed. Your original is always kept. Fast Anime favors speed; use
        Swin2SR for color fidelity.
      </p>
      <fieldset disabled={locked} className="enhance-options mt-5 grid grid-cols-2 gap-4">
        <label className="text-sm text-muted">
          AI model
          <select
            aria-label="Enhancement model"
            className="field mt-2"
            value={options.model ?? "swin2sr"}
            onChange={(e) => setOptions({ ...options, model: e.target.value as EnhanceModel })}
          >
            {Object.entries(ENHANCE_MODELS).map(([id, model]) => (
              <option key={id} value={id}>
                {model.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted">
          Restoration preset
          <select
            aria-label="Restoration preset"
            className="field mt-2"
            value={
              Object.entries(ENHANCE_PRESETS).find(
                ([, p]) =>
                  p.denoise === options.denoise &&
                  p.sharpen === options.sharpen &&
                  p.color === options.color &&
                  p.artifacts === options.artifacts &&
                  (p.inkGaps ?? false) === (options.inkGaps ?? false),
              )?.[0] ?? "custom"
            }
            onChange={(e) => {
              const p = ENHANCE_PRESETS[e.target.value as keyof typeof ENHANCE_PRESETS];
              if (p) setOptions({ ...options, ...p });
            }}
          >
            <option value="fidelity">Fidelity · preserve colors and edges</option>
            <option value="gentle-cleanup">Gentle line cleanup</option>
            <option value="manga-ink">Manga ink · repair tiny gaps</option>
            <option value="legacy-cleanup">Legacy cleanup</option>
            <option value="custom" disabled>
              Custom
            </option>
          </select>
        </label>
        <label className="text-sm text-muted">
          Output size
          <select
            aria-label="Output size"
            className="field mt-2"
            value={options.scale}
            onChange={(e) => setOptions({ ...options, scale: Number(e.target.value) as 1 | 2 | 4 })}
          >
            <option value={2}>2× upscale</option>
            <option value={4}>4× upscale · up to 1 MP source</option>
            <option value={1}>Original size · restore</option>
          </select>
        </label>
        <label className="text-sm text-muted">
          Noise reduction · {options.denoise}%
          <input
            aria-label="Noise reduction"
            className="mt-4 w-full"
            type="range"
            min="0"
            max="40"
            value={options.denoise}
            onChange={(e) => setOptions({ ...options, denoise: +e.target.value })}
          />
        </label>
        <label className="text-sm text-muted">
          Sharpening · {options.sharpen}%
          <input
            aria-label="Sharpening"
            className="mt-3 w-full"
            type="range"
            min="0"
            max="40"
            value={options.sharpen}
            onChange={(e) => setOptions({ ...options, sharpen: +e.target.value })}
          />
        </label>
        <div className="flex flex-col gap-2 text-sm text-muted">
          <label className="check-row">
            <input
              type="checkbox"
              checked={options.artifacts}
              onChange={(e) => setOptions({ ...options, artifacts: e.target.checked })}
            />
            Artifact cleanup
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={options.color}
              onChange={(e) => setOptions({ ...options, color: e.target.checked })}
            />
            Gentle color boost
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              aria-label="Repair tiny ink gaps"
              checked={options.inkGaps ?? false}
              onChange={(e) => setOptions({ ...options, inkGaps: e.target.checked })}
            />
            Repair 1px monochrome ink gaps
          </label>
        </div>
      </fieldset>
      <p className="mt-3 text-xs text-subtle">
        Runs on the current accepted image, including saved crops. Neural reconstruction with
        edge-aware noise/artifact cleanup and conservative sharpening. Color boost is optional; no
        automatic character identity matching.
      </p>
      {options.scale === 4 && (
        <p className="mt-3 text-xs text-muted">
          4× stays within 16 output megapixels. Swin2SR uses two real model passes; Fast Anime uses
          one native 4× pass. Review artifacts before applying.
        </p>
      )}
      {running ? (
        <div className="ai-progress mt-5" role="status" aria-live="polite">
          <div className="flex justify-between gap-3 text-sm">
            <span>
              Image {current} / {panels.length}
            </span>
            <span>
              {progress.total > 0
                ? `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`
                : "Working…"}
            </span>
          </div>
          <progress
            className="mt-3 w-full"
            aria-label="AI enhancement progress"
            max={progress.total || 1}
            value={progress.total > 0 ? progress.done : undefined}
          />
          <p className="mt-2 text-xs text-muted">{progress.stage}</p>
        </div>
      ) : null}
      {preview && urls ? (
        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm">{preview.panel.name}</p>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous preview"
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs text-muted">
                {index + 1}/{previews.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next preview"
                disabled={index >= previews.length - 1}
                onClick={() => setIndex(index + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          <Button
            variant="ghost"
            aria-pressed={actualSize}
            onClick={() => setActualSize(!actualSize)}
          >
            {actualSize ? "Fit comparison" : "100% comparison"}
          </Button>
          <div className="ai-compare-scroll">
            <div
              className="compare-view"
              style={{
                aspectRatio: `${preview.after.width} / ${preview.after.height}`,
                ...(actualSize
                  ? {
                      width: preview.after.width,
                      height: preview.after.height,
                      maxWidth: "none",
                      maxHeight: "none",
                      boxSizing: "content-box" as const,
                    }
                  : {}),
              }}
            >
              <img src={urls.before} alt="Original artwork" />
              <img
                src={urls.after}
                alt="AI enhanced artwork"
                style={{ clipPath: `inset(0 0 0 ${split}%)` }}
              />
              <div className="compare-line" style={{ left: `${split}%` }} />
              <span className="compare-label compare-before">Original</span>
              <span className="compare-label compare-after">Enhanced</span>
            </div>
          </div>
          <label className="mt-3 block text-xs text-muted">
            Before / after · drag to compare
            <input
              aria-label="Before and after comparison"
              className="mt-2 w-full"
              type="range"
              min="0"
              max="100"
              value={split}
              onChange={(e) => setSplit(+e.target.value)}
            />
          </label>
          <p className="mt-1 text-xs text-subtle">
            Output: {preview.after.width} × {preview.after.height} · PNG
          </p>
        </div>
      ) : null}
      {settingsChanged && (
        <p className="ai-message mt-4 text-sm" role="status">
          Settings changed. Regenerate before applying these previews.
        </p>
      )}
      {message ? (
        <p className="ai-message mt-4 text-sm" role="status">
          {message}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        {running ? (
          <Button
            variant="secondary"
            onClick={() => {
              cancelled.current = true;
              engine.current?.dispose();
            }}
          >
            <X className="size-4" />
            Cancel processing
          </Button>
        ) : (
          <Button intent="ai" disabled={saving} onClick={() => void run()}>
            <Sparkles className="size-4" />
            {previews.length
              ? "Regenerate"
              : `Enhance ${panels.length === 1 ? "image" : `${panels.length} images`}`}
          </Button>
        )}
        {previews.length ? (
          <Button
            disabled={locked || settingsChanged}
            variant="secondary"
            onClick={() => void apply()}
          >
            <Check className="size-4" />
            {saving ? "Saving…" : `Apply ${previews.length} preview(s)`}
          </Button>
        ) : null}
        {panels.some(
          (panel) => useStudio.getState().panels.find((item) => item.id === panel.id)?.original,
        ) ? (
          <Button disabled={locked} variant="ghost" onClick={() => void recover()}>
            <RotateCcw className="size-4" />
            Recover originals
          </Button>
        ) : null}
      </div>
      <p className="mt-4 flex items-center gap-2 text-xs text-subtle">
        <ShieldCheck className="size-4 shrink-0" />
        Nothing replaces your images until you apply previews.
      </p>
    </Modal>
  );
}
