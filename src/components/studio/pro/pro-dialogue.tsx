import { isLocked } from "@/lib/studio/pro/operations";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToolSection } from "../design/tool-section";
import { ProNumber } from "./pro-properties";
import type { ProTool } from "./pro-canvas";
import type { Layer, ProDocument } from "@/lib/studio/pro/model";
import { contours } from "@/lib/studio/pro/model";
import type { Frame } from "@/lib/studio/pro/artboards";
import {
  BUBBLE_PRESETS,
  presetStyles,
  DEFAULT_LETTERING,
  type DialogueRegion,
  type Lettering,
  type BubbleTail,
  type DialoguePreset,
} from "@/lib/studio/dialogue/types";
import {
  bubbleFor,
  textFor,
  createBubble,
  createText,
  updateBubble,
  updateLettering,
  dialogueData,
  cleanView,
} from "@/lib/studio/dialogue/operations";
import { flatBackground, cleanupProposal } from "@/lib/studio/dialogue/cleanup";
import { LocalOcr } from "@/lib/studio/dialogue/ocr";
import type { OcrLanguage } from "@/lib/studio/dialogue/ocr-models";
import { defaultEffect } from "@/lib/studio/pro/effects";

const LANGUAGES = {
  en: "English",
  ar: "العربية · Arabic",
  ko: "한국어 · Korean",
  ja: "日本語 · Japanese",
} as const;
const LANGUAGE_CODES: Record<OcrLanguage, keyof typeof LANGUAGES> = {
  eng: "en",
  ara: "ar",
  kor: "ko",
  jpn: "ja",
  jpn_vert: "ja",
};
function Choice({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="pro-field">
      {label}
      <select
        className="field"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {Object.entries(values).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <label className="pro-field">
      {label}
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function ProDialogue({
  document: d,
  selectedId,
  onDocument,
  onSelect,
  onTool,
  onRegion,
  onPreview,
  onError,
  disabled,
  onPending,
  sharedPresets,
  onSharedPresets,
  onPresentation,
  quick,
}: {
  document: ProDocument;
  selectedId: string;
  onDocument: (d: ProDocument, label: string) => void;
  onSelect: (id: string) => void;
  onTool: (t: ProTool) => void;
  onRegion: (d: ProDocument, frame: Frame, signal?: AbortSignal) => Promise<ImageData>;
  onPreview: (d: ProDocument | null) => void;
  onError: (s: string) => void;
  disabled: boolean;
  onPending: (pending: boolean) => void;
  sharedPresets: DialoguePreset[];
  onSharedPresets: (update: (presets: DialoguePreset[]) => DialoguePreset[]) => Promise<void>;
  onPresentation?: () => void;
  quick?: boolean;
}) {
  const body = bubbleFor(d, selectedId),
    text = textFor(d, selectedId),
    settings = text?.lettering ?? DEFAULT_LETTERING,
    data = dialogueData(d);
  const [language, setLanguage] = useState<OcrLanguage>("eng"),
    [regionId, setRegionId] = useState(""),
    [status, setStatus] = useState(""),
    [processing, setProcessing] = useState(false),
    [presetName, setPresetName] = useState("My bubble"),
    [proposal, setProposal] = useState<{
      doc: ProDocument;
      base: string;
      label: string;
      selectId?: string;
    } | null>(null);
  const [area, setArea] = useState<Frame>({
    x: 0,
    y: 0,
    width: Math.min(d.width, 1000),
    height: Math.min(d.height, 1000),
  });
  const regionJob = useRef<AbortController | null>(null);
  const latest = useRef(d),
    ocr = useRef<LocalOcr | null>(null),
    run = useRef(0),
    mounted = useRef(true);
  latest.current = d;
  useEffect(() => {
    onPending(processing || !!proposal);
    return () => onPending(false);
  }, [processing, proposal, onPending]);
  useEffect(() => {
    mounted.current = true;
    const operation = run,
      engine = ocr,
      life = mounted,
      region = regionJob;
    return () => {
      life.current = false;
      operation.current++;
      engine.current?.cancel();
      region.current?.abort();
      onPreview(null);
    };
  }, [onPreview]);
  const safe = (fn: () => void) => {
    onError("");
    try {
      fn();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const commit = (next: ProDocument, label: string) => {
    if (disabled || processing || proposal) return;
    onDocument(next, label);
  };
  const patchBody = (patch: Partial<Layer>, spec?: Parameters<typeof updateBubble>[3]) =>
    safe(() => commit(updateBubble(d, selectedId, patch, spec), "Edit speech bubble"));
  const patchText = (patch: Partial<Layer>, spec?: Partial<Lettering>) =>
    safe(() => commit(updateLettering(d, selectedId, patch, spec), "Edit dialogue lettering"));
  const tail = (id: string, patch: Partial<BubbleTail>) =>
    patchBody(
      {},
      { tails: body!.bubble!.tails.map((t) => (t.id === id ? { ...t, ...patch } : t)) },
    );
  const region = data.regions.find((r) => r.id === regionId);
  const patchRegion = (patch: Partial<DialogueRegion>) =>
    commit(
      {
        ...d,
        dialogue: {
          ...data,
          regions: data.regions.map((r) => (r.id === regionId ? { ...r, ...patch } : r)),
        },
      },
      "Edit OCR review",
    );
  const preview = (next: ProDocument, label: string, selectId?: string) => {
    onPending(true);
    setProposal({ doc: next, base: JSON.stringify(d), label, selectId });
    onPreview(next);
  };
  const cancel = () => {
    run.current++;
    ocr.current?.cancel();
    regionJob.current?.abort();
    setProcessing(false);
    onPending(false);
    setStatus("Cancelled; source artwork unchanged.");
    setProposal(null);
    onPreview(null);
  };
  async function recognize() {
    const source = latest.current,
      signature = JSON.stringify(source),
      serial = ++run.current;
    regionJob.current?.abort();
    const regionController = new AbortController();
    regionJob.current = regionController;
    onPending(true);
    setProcessing(true);
    setStatus("Preparing source-resolution region…");
    onError("");
    try {
      const pixels = await onRegion(cleanView(source, true), area, regionController.signal);
      if (serial !== run.current) return;
      ocr.current ??= new LocalOcr();
      const result = await ocr.current.recognize(pixels, language, area, (p) => {
        if (mounted.current && serial === run.current)
          setStatus(`${p.stage} · ${Math.round(p.progress * 100)}%`);
      });
      if (!mounted.current || serial !== run.current) return;
      if (JSON.stringify(latest.current) !== signature)
        throw Error(
          "The source document changed during OCR. Review was not applied; run OCR again.",
        );
      const old = dialogueData(source);
      if (old.regions.length + result.regions.length > 200)
        throw Error("The review queue limit is200 regions. Remove reviewed regions first.");
      onDocument(
        { ...source, dialogue: { ...old, regions: [...old.regions, ...result.regions] } },
        "Detect dialogue locally",
      );
      setRegionId(result.regions[0]?.id ?? "");
      setStatus(
        `${result.regions.length} regions detected in ${(result.elapsedMs / 1000).toFixed(2)}s. Human correction required.`,
      );
    } catch (e) {
      if (mounted.current && serial === run.current && (e as Error).name !== "AbortError")
        onError((e as Error).message);
    } finally {
      if (mounted.current && serial === run.current) setProcessing(false);
    }
  }
  async function clean() {
    if (!region) return;
    const source = d,
      signature = JSON.stringify(d),
      serial = ++run.current;
    regionJob.current?.abort();
    const regionController = new AbortController();
    regionJob.current = regionController;
    onPending(true);
    setProcessing(true);
    setStatus("Checking opaque background boundary…");
    onError("");
    try {
      const frame = {
        x: Math.floor(region.x),
        y: Math.floor(region.y),
        width: Math.ceil(region.width),
        height: Math.ceil(region.height),
      };
      const pixels = await onRegion(cleanView(source, true), frame, regionController.signal),
        estimate = flatBackground(pixels);
      if (!mounted.current || serial !== run.current) return;
      if (JSON.stringify(latest.current) !== signature)
        throw Error("Document changed; cleanup discarded.");
      const result = cleanupProposal(source, frame, estimate.color, source.selection);
      const meta = dialogueData(result.document);
      preview(
        {
          ...result.document,
          dialogue: {
            ...meta,
            regions: meta.regions.map((r) =>
              r.id === region.id ? { ...r, status: "cleaned", cleanupLayerId: result.id } : r,
            ),
          },
        },
        "Approve flat background cleanup",
      );
      setStatus(
        `Solid-background proposal · ${Math.round(estimate.boundaryInliers * 100)}% boundary agreement. Inspect before approval.`,
      );
    } catch (e) {
      if (mounted.current && serial === run.current) onError((e as Error).message);
    } finally {
      if (mounted.current && serial === run.current) setProcessing(false);
    }
  }
  const blocked = disabled || processing || !!proposal;
  return (
    <div className="pro-dialogue" aria-label="Dialogue controls">
      <p className="pro-help">
        Editable lettering in source-image pixels. Original artwork is retained. Save the draft for
        recovery; apply to Chapter to update its preview.
      </p>
      {onPresentation && (
        <Button onClick={onPresentation} disabled={processing || !!proposal}>
          {quick ? "Open Professional Dialogue Editor" : "Return to Quick Edit"}
        </Button>
      )}
      <fieldset disabled={blocked} className="dialogue-fieldset">
        <ToolSection title="Bubble library" defaultOpen>
          <div className="dialogue-presets">
            {BUBBLE_PRESETS.map((p) => (
              <Button
                variant="ghost"
                key={p}
                onClick={() =>
                  safe(() => {
                    const r = createBubble(d, p);
                    commit(r.document, `Add ${p} bubble`);
                    onSelect(r.id);
                    onTool("move");
                  })
                }
              >
                {p[0]!.toUpperCase() + p.slice(1)}
              </Button>
            ))}
          </div>
          <Button
            onClick={() =>
              safe(() => {
                const r = createText(d);
                commit(r.document, "Add dialogue text");
                onSelect(r.id);
                onTool("move");
              })
            }
          >
            Add independent text
          </Button>
          <p className="pro-help">
            Move selects a whole bubble group. Layers selects its text or body separately. Free
            Transform resizes and rotates. Direct anchors edits real Bézier geometry.
          </p>
          <div className="dialogue-actions">
            <Button variant="ghost" onClick={() => onTool("move")}>
              Move
            </Button>
            <Button variant="ghost" onClick={() => onTool("transform")}>
              Free Transform
            </Button>
            <Button
              variant="ghost"
              disabled={!body || body.kind !== "shape"}
              onClick={() => {
                onSelect(body!.id);
                onTool("direct");
              }}
            >
              Edit bubble anchors
            </Button>
          </div>
        </ToolSection>
        {body?.bubble && (
          <ToolSection title="Bubble & tails" defaultOpen>
            <fieldset className="dialogue-fieldset" disabled={isLocked(d, body.id)}>
              <div className="pro-field-grid">
                <ProNumber
                  label="Bubble width"
                  value={body.width}
                  min={1}
                  max={16384}
                  onChange={(width) => patchBody({ width })}
                />
                <ProNumber
                  label="Bubble height"
                  value={body.height}
                  min={1}
                  max={16384}
                  onChange={(height) => patchBody({ height })}
                />
              </div>
              <ProNumber
                label="Bubble fill opacity"
                value={body.fillOpacity ?? 1}
                min={0}
                max={1}
                step={0.05}
                onChange={(fillOpacity) => patchBody({ fillOpacity })}
              />
              <ProNumber
                label="Bubble border opacity"
                value={body.strokeOpacity ?? 1}
                min={0}
                max={1}
                step={0.05}
                onChange={(strokeOpacity) => patchBody({ strokeOpacity })}
              />
              <Color
                label="Bubble fill"
                value={body.fill}
                onChange={(fill) => patchBody({ fill })}
              />
              <Color
                label="Bubble border"
                value={body.stroke}
                onChange={(stroke) => patchBody({ stroke })}
              />
              <ProNumber
                label="Bubble opacity"
                value={body.opacity}
                min={0}
                max={1}
                step={0.05}
                onChange={(opacity) => patchBody({ opacity })}
              />
              <ProNumber
                label="Border width"
                value={body.strokeWidth}
                min={0}
                max={100}
                onChange={(strokeWidth) => patchBody({ strokeWidth })}
              />
              <Choice
                label="Border style"
                value={body.dash?.length ? "dash" : "solid"}
                values={{ solid: "Solid", dash: "Dashed" }}
                onChange={(v) => patchBody({ dash: v === "dash" ? [6, 4] : [] })}
              />
              <ProNumber
                label="Bubble padding"
                value={body.bubble.padding}
                min={0}
                max={1000}
                onChange={(padding) => patchBody({}, { padding })}
              />
              <label className="pro-check">
                <input
                  type="checkbox"
                  checked={!!body.effects?.some((e) => e.kind === "dropShadow" && e.enabled)}
                  onChange={(e) =>
                    patchBody({ effects: e.target.checked ? [defaultEffect("dropShadow")] : [] })
                  }
                />
                Bubble shadow (raster/native export)
              </label>
              {body.bubble.tails.map((t, i) => (
                <div className="dialogue-tail" key={t.id}>
                  <h3>Tail {i + 1}</h3>
                  <ProNumber
                    label={`Tail ${i + 1} attachment`}
                    value={t.attachment}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(attachment) => tail(t.id, { attachment })}
                  />
                  <ProNumber
                    label={`Tail ${i + 1} width`}
                    value={t.width}
                    min={1}
                    max={10000}
                    onChange={(width) => tail(t.id, { width })}
                  />
                  <div className="pro-field-grid">
                    <ProNumber
                      label={`Tail ${i + 1} tip X`}
                      value={t.tip.x}
                      onChange={(x) => tail(t.id, { tip: { ...t.tip, x } })}
                    />
                    <ProNumber
                      label={`Tail ${i + 1} tip Y`}
                      value={t.tip.y}
                      onChange={(y) => tail(t.id, { tip: { ...t.tip, y } })}
                    />
                  </div>
                  <ProNumber
                    label={`Tail ${i + 1} curvature`}
                    value={t.curvature}
                    min={-1}
                    max={1}
                    step={0.05}
                    onChange={(curvature) => tail(t.id, { curvature })}
                  />
                  <Choice
                    label={`Tail ${i + 1} shape`}
                    value={t.kind}
                    values={{ point: "Curved point", dots: "Thought trail" }}
                    onChange={(kind) => tail(t.id, { kind: kind as BubbleTail["kind"] })}
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      patchBody({}, { tails: body.bubble!.tails.filter((v) => v.id !== t.id) })
                    }
                  >
                    Remove tail {i + 1}
                  </Button>
                </div>
              ))}
              <Button
                disabled={body.bubble.tails.length >= 8}
                onClick={() =>
                  patchBody(
                    {},
                    {
                      tails: [
                        ...body.bubble!.tails,
                        {
                          id: crypto.randomUUID(),
                          attachment: (0.42 + body.bubble!.tails.length * 0.14) % 1,
                          width: Math.max(2, body.width * 0.08),
                          tip: { x: body.width * 0.8, y: body.height * 1.3 },
                          curvature: 0,
                          kind: "point",
                        },
                      ],
                    },
                  )
                }
              >
                Add connected tail
              </Button>
            </fieldset>
          </ToolSection>
        )}
        {text && (
          <ToolSection title="Lettering" defaultOpen>
            <fieldset className="dialogue-fieldset" disabled={isLocked(d, text.id)}>
              <label className="pro-field">
                Dialogue text
                <textarea
                  className="field"
                  aria-label="Dialogue text"
                  dir={settings.direction}
                  value={text.text}
                  maxLength={5000}
                  rows={4}
                  onChange={(e) => patchText({ text: e.target.value })}
                />
              </label>
              <Choice
                label="Text language"
                value={settings.language}
                values={LANGUAGES}
                onChange={(v) =>
                  patchText(
                    {},
                    {
                      language: v as Lettering["language"],
                      direction: v === "ar" ? "rtl" : "ltr",
                      writing: "horizontal",
                    },
                  )
                }
              />
              <Choice
                label="Font family"
                value={settings.font}
                values={{
                  Arial: "Arial / system sans",
                  Georgia: "Georgia / serif",
                  "Noto Sans CJK JP": "Noto CJK / system fallback",
                  "Noto Sans Arabic": "Noto Arabic / system fallback",
                  "Courier New": "Courier / monospace",
                }}
                onChange={(font) => patchText({}, { font })}
              />
              <div className="pro-field-grid">
                <ProNumber
                  label="Lettering size"
                  value={text.fontSize}
                  min={1}
                  max={1000}
                  onChange={(fontSize) => patchText({ fontSize })}
                />
                <ProNumber
                  label="Lettering weight"
                  value={text.fontWeight}
                  min={100}
                  max={900}
                  step={100}
                  onChange={(fontWeight) => patchText({ fontWeight })}
                />
              </div>
              <Color
                label="Text color"
                value={text.fill}
                onChange={(fill) => patchText({ fill })}
              />
              <ProNumber
                label="Text opacity"
                value={text.opacity}
                min={0}
                max={1}
                step={0.05}
                onChange={(opacity) => patchText({ opacity })}
              />
              <Choice
                label="Text alignment"
                value={text.align}
                values={{ left: "Left", center: "Center", right: "Right" }}
                onChange={(align) => patchText({ align: align as Layer["align"] })}
              />
              <Choice
                label="Text direction"
                value={settings.direction}
                values={{ ltr: "Left to right", rtl: "Right to left" }}
                onChange={(direction) =>
                  patchText({}, { direction: direction as Lettering["direction"] })
                }
              />
              {settings.language === "ja" && (
                <Choice
                  label="Japanese writing"
                  value={settings.writing}
                  values={{ horizontal: "Horizontal", vertical: "Vertical · upright CJK" }}
                  onChange={(writing) =>
                    patchText({}, { writing: writing as Lettering["writing"] })
                  }
                />
              )}
              <div className="pro-field-grid">
                <ProNumber
                  label="Text box width"
                  value={text.width}
                  min={1}
                  max={16384}
                  onChange={(width) => patchText({ width })}
                />
                <ProNumber
                  label="Text box height"
                  value={text.height}
                  min={1}
                  max={16384}
                  onChange={(height) => patchText({ height })}
                />
              </div>
              <ProNumber
                label="Line height"
                value={text.lineHeight}
                min={0.5}
                max={3}
                step={0.05}
                onChange={(lineHeight) => patchText({ lineHeight })}
              />
              <ProNumber
                label="Letter spacing"
                value={text.letterSpacing}
                min={-20}
                max={100}
                step={0.5}
                onChange={(letterSpacing) => patchText({ letterSpacing })}
              />
              <ProNumber
                label="Paragraph spacing"
                value={settings.paragraphSpacing}
                min={0}
                max={1000}
                onChange={(paragraphSpacing) => patchText({}, { paragraphSpacing })}
              />
              <ProNumber
                label="Text padding"
                value={settings.padding}
                min={0}
                max={1000}
                onChange={(padding) => patchText({}, { padding })}
              />
              {(["italic", "wrap", "fit"] as const).map((k) => (
                <label className="pro-check" key={k}>
                  <input
                    type="checkbox"
                    checked={settings[k]}
                    onChange={(e) => patchText({}, { [k]: e.target.checked })}
                  />
                  {k === "fit"
                    ? "Fit text within box"
                    : k === "wrap"
                      ? "Automatic wrapping"
                      : "Italic"}
                </label>
              ))}
              <Color
                label="Text outline"
                value={text.stroke}
                onChange={(stroke) => patchText({ stroke })}
              />
              <ProNumber
                label="Outline width"
                value={text.strokeWidth}
                min={0}
                max={100}
                onChange={(strokeWidth) => patchText({ strokeWidth })}
              />
              <label className="pro-check">
                <input
                  type="checkbox"
                  checked={!!text.effects?.some((e) => e.kind === "dropShadow" && e.enabled)}
                  onChange={(e) =>
                    patchText({ effects: e.target.checked ? [defaultEffect("dropShadow")] : [] })
                  }
                />
                Text shadow (raster/native export)
              </label>
              <p className="pro-help">
                Fonts use installed system fallbacks. SVG recipients need matching fonts. Japanese
                vertical uses upright CJK and rotated Latin; advanced font-specific vertical shaping
                is limited.
              </p>
            </fieldset>
          </ToolSection>
        )}
        <ToolSection title="Reusable presets">
          <label className="pro-field">
            Preset name
            <input
              className="field"
              aria-label="Dialogue preset name"
              maxLength={100}
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
          </label>
          <Button
            disabled={
              !body ||
              body.kind !== "shape" ||
              !text ||
              !presetName.trim() ||
              data.presets.length >= 100
            }
            onClick={() =>
              safe(() => {
                const preset = {
                  id: crypto.randomUUID(),
                  name: presetName.trim(),
                  bubble: body!.bubble
                    ? { ...structuredClone(body!.bubble), textId: undefined }
                    : { version: 1 as const, preset: "custom" as const, tails: [], padding: 0 },
                  width: body!.width,
                  height: body!.height,
                  contours: body!.bubble ? undefined : structuredClone(contours(body!)),
                  fill: body!.fill,
                  stroke: body!.stroke,
                  strokeWidth: body!.strokeWidth,
                  textColor: text!.fill,
                  fontSize: text!.fontSize,
                  lettering: structuredClone(settings),
                  ...presetStyles(body!, text!),
                };
                commit(
                  { ...d, dialogue: { ...data, presets: [...data.presets, preset] } },
                  "Save bubble preset",
                );
              })
            }
          >
            Save selected bubble preset
          </Button>
          {data.presets.map((p) => (
            <div className="dialogue-tail" key={p.id}>
              <input
                className="field"
                aria-label={`Rename preset ${p.name}`}
                value={p.name}
                maxLength={100}
                onChange={(e) => {
                  if (e.target.value.trim())
                    commit(
                      {
                        ...d,
                        dialogue: {
                          ...data,
                          presets: data.presets.map((v) =>
                            v.id === p.id ? { ...v, name: e.target.value } : v,
                          ),
                        },
                      },
                      "Rename dialogue preset",
                    );
                }}
              />
              <div className="dialogue-actions">
                <Button
                  onClick={() =>
                    safe(() => {
                      const r = createBubble(d, p.bubble.preset, p);
                      commit(r.document, "Apply dialogue preset");
                      onSelect(r.id);
                      onTool("move");
                    })
                  }
                >
                  Use preset
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    commit(
                      {
                        ...d,
                        dialogue: {
                          ...data,
                          presets: [
                            ...data.presets,
                            {
                              ...structuredClone(p),
                              id: crypto.randomUUID(),
                              name: `${p.name.slice(0, 90)} copy`,
                            },
                          ],
                        },
                      },
                      "Duplicate dialogue preset",
                    )
                  }
                >
                  Duplicate
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    commit(
                      {
                        ...d,
                        dialogue: { ...data, presets: data.presets.filter((v) => v.id !== p.id) },
                      },
                      "Delete dialogue preset",
                    )
                  }
                >
                  Delete
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void onSharedPresets((items) => [
                      ...items.filter((v) => v.id !== p.id),
                      structuredClone(p),
                    ]).catch((e) => onError((e as Error).message))
                  }
                >
                  Share across project
                </Button>
              </div>
            </div>
          ))}
          <p className="pro-help">
            Native presets travel with this document. Shared project presets are available on every
            Chapter page and included in project backups.
          </p>
          {sharedPresets.map((p) => (
            <div className="dialogue-tail" key={`shared-${p.id}`}>
              <p className="pro-help">Project · {p.name}</p>
              <div className="dialogue-actions">
                <Button
                  onClick={() =>
                    safe(() => {
                      const r = createBubble(d, p.bubble.preset, p);
                      commit(r.document, "Use shared bubble preset");
                      onSelect(r.id);
                      onTool("move");
                    })
                  }
                >
                  Use shared {p.name}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void onSharedPresets((items) => items.filter((v) => v.id !== p.id)).catch((e) =>
                      onError((e as Error).message),
                    )
                  }
                >
                  Remove shared {p.name}
                </Button>
              </div>
            </div>
          ))}
        </ToolSection>
      </fieldset>
      <ToolSection title="Smart Assisted · human approved" defaultOpen>
        <p className="pro-help">
          Real Tesseract OCR runs locally. First use downloads verified open-source language data;
          artwork stays on this device. Detection and confidence are suggestions, never verified
          translations.
        </p>
        <fieldset disabled={blocked} className="dialogue-fieldset">
          <Choice
            label="OCR language"
            value={language}
            values={{
              eng: "English",
              ara: "Arabic · horizontal",
              kor: "Korean · horizontal",
              jpn: "Japanese · horizontal",
              jpn_vert: "Japanese · vertical",
            }}
            onChange={(v) => setLanguage(v as OcrLanguage)}
          />
          <div className="pro-field-grid">
            {(["x", "y", "width", "height"] as const).map((k) => (
              <ProNumber
                key={k}
                label={`OCR region ${k}`}
                value={area[k]}
                min={k === "width" || k === "height" ? 3 : 0}
                max={k === "x" || k === "width" ? d.width : d.height}
                onChange={(n) => setArea({ ...area, [k]: Math.round(n) })}
              />
            ))}
          </div>
          <Button variant="ghost" onClick={() => onTool("select-rect")}>
            Draw source selection
          </Button>
          <Button
            variant="ghost"
            disabled={!d.selection?.regions.length || d.selection.inverted}
            onClick={() =>
              safe(() => {
                const regions = d.selection!.regions;
                const points = regions.flatMap((r) => r.points);
                if (!points.length) throw Error("Draw a selection first.");
                if (d.selection!.frame)
                  throw Error("Use numeric OCR bounds for transformed selections.");
                const x = Math.max(0, Math.floor(Math.min(...points.map((r) => r.x)))),
                  y = Math.max(0, Math.floor(Math.min(...points.map((r) => r.y))));
                const right = Math.min(d.width, Math.ceil(Math.max(...points.map((r) => r.x)))),
                  bottom = Math.min(d.height, Math.ceil(Math.max(...points.map((r) => r.y))));
                if (right - x < 3 || bottom - y < 3) throw Error("Select a region at least3×3px.");
                setArea({ x, y, width: right - x, height: bottom - y });
              })
            }
          >
            Use selection bounds for OCR
          </Button>
          <Button onClick={() => void recognize()}>Detect text locally</Button>
          <Button
            variant="ghost"
            onClick={() =>
              safe(() => {
                if (area.x + area.width > d.width || area.y + area.height > d.height)
                  throw Error("Review region must fit within the source image.");
                const r: DialogueRegion = {
                  ...area,
                  id: crypto.randomUUID(),
                  sourceLanguage: LANGUAGE_CODES[language],
                  targetLanguage: "en",
                  original: "",
                  corrected: "",
                  replacement: "",
                  status: "corrected",
                };
                commit(
                  { ...d, dialogue: { ...data, regions: [...data.regions, r] } },
                  "Add manual dialogue review region",
                );
                setRegionId(r.id);
              })
            }
          >
            Add manual review region
          </Button>
          <Choice
            label="Review region"
            value={regionId}
            values={{
              "": "Choose a detected region",
              ...Object.fromEntries(
                data.regions.map((r, i) => [
                  r.id,
                  `${i + 1} · ${r.status} · ${r.corrected.slice(0, 24)}`,
                ]),
              ),
            }}
            onChange={setRegionId}
          />
          {region && (
            <>
              <p className="pro-help">
                Confidence{" "}
                {region.confidence === undefined
                  ? "not reported"
                  : `${region.confidence.toFixed(0)}%`}{" "}
                · {region.status}. This is an engine estimate.
              </p>
              <div className="pro-field-grid">
                {(["x", "y", "width", "height"] as const).map((k) => (
                  <ProNumber
                    key={k}
                    label={`Review ${k}`}
                    value={region[k]}
                    min={k === "width" || k === "height" ? 1 : 0}
                    max={k === "x" || k === "width" ? d.width : d.height}
                    onChange={(n) => patchRegion({ [k]: Math.round(n) })}
                  />
                ))}
              </div>
              <Choice
                label="Source language"
                value={region.sourceLanguage}
                values={LANGUAGES}
                onChange={(v) =>
                  patchRegion({ sourceLanguage: v as DialogueRegion["sourceLanguage"] })
                }
              />
              <label className="pro-field">
                Original OCR
                <textarea
                  className="field"
                  aria-label="Original OCR"
                  readOnly
                  value={region.original}
                />
              </label>
              <label className="pro-field">
                Corrected original
                <textarea
                  className="field"
                  aria-label="Corrected original"
                  dir={region.sourceLanguage === "ar" ? "rtl" : "auto"}
                  value={region.corrected}
                  maxLength={5000}
                  onChange={(e) => patchRegion({ corrected: e.target.value, status: "corrected" })}
                />
              </label>
              <Button variant="ghost" onClick={() => patchRegion({ status: "corrected" })}>
                Confirm corrected text
              </Button>
              <Choice
                label="Target language"
                value={region.targetLanguage}
                values={LANGUAGES}
                onChange={(v) =>
                  patchRegion({ targetLanguage: v as DialogueRegion["targetLanguage"] })
                }
              />
              <label className="pro-field">
                Replacement text · manual translation
                <textarea
                  className="field"
                  aria-label="Replacement text"
                  dir={region.targetLanguage === "ar" ? "rtl" : "auto"}
                  value={region.replacement}
                  maxLength={5000}
                  onChange={(e) => patchRegion({ replacement: e.target.value })}
                />
              </label>
              <Button disabled={region.status === "detected"} onClick={() => void clean()}>
                Preview flat background cleanup
              </Button>
              <p className="pro-help">
                Non-generative solid-background fill, restricted to this region and the current
                selection. Textured artwork is rejected; use Raster Clone/Healing. No advanced
                restoration backend is configured.
              </p>
              <Button
                disabled={!region.replacement.trim()}
                onClick={() =>
                  safe(() => {
                    if (region.layerId && d.layers.some((l) => l.id === region.layerId)) {
                      const candidate = updateLettering(
                        d,
                        region.layerId,
                        { text: region.replacement },
                        {
                          language: region.targetLanguage,
                          direction: region.targetLanguage === "ar" ? "rtl" : "ltr",
                        },
                      );
                      preview(
                        {
                          ...candidate,
                          dialogue: {
                            ...data,
                            regions: data.regions.map((v) =>
                              v.id === region.id ? { ...v, status: "lettered" as const } : v,
                            ),
                          },
                        },
                        "Approve replacement lettering",
                        region.layerId,
                      );
                      return;
                    }
                    const r = createText(d, region.replacement),
                      l = r.document.layers.find((v) => v.id === r.id)!;
                    const placed = {
                      ...r.document,
                      layers: r.document.layers.map((v) =>
                        v.id === r.id
                          ? {
                              ...l,
                              width: region.width,
                              height: region.height,
                              fontSize: Math.max(6, Math.min(48, region.height * 0.45)),
                              transform: { ...l.transform, x: region.x, y: region.y },
                              lettering: {
                                ...l.lettering!,
                                language: region.targetLanguage,
                                direction:
                                  region.targetLanguage === "ar"
                                    ? ("rtl" as const)
                                    : ("ltr" as const),
                              },
                            }
                          : v,
                      ),
                      dialogue: {
                        ...data,
                        regions: data.regions.map((v) =>
                          v.id === region.id
                            ? { ...v, status: "lettered" as const, layerId: r.id }
                            : v,
                        ),
                      },
                    };
                    preview(placed, "Approve replacement lettering", r.id);
                  })
                }
              >
                Preview replacement lettering
              </Button>
              <Button
                variant="secondary"
                disabled={!region.layerId}
                onClick={() => patchRegion({ status: "approved" })}
              >
                Approve reviewed region
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  commit(
                    {
                      ...d,
                      dialogue: { ...data, regions: data.regions.filter((r) => r.id !== regionId) },
                    },
                    "Remove OCR review region",
                  )
                }
              >
                Remove review entry (retain artwork)
              </Button>
            </>
          )}
        </fieldset>
        {(processing || proposal) && (
          <Button variant="ghost" onClick={cancel}>
            Cancel dialogue operation
          </Button>
        )}
        {proposal && (
          <>
            <p className="pro-help">
              Preview only. Accept adds editable layers; Cancel leaves the document unchanged.
            </p>
            <Button
              onClick={() =>
                safe(() => {
                  if (JSON.stringify(latest.current) !== proposal.base) {
                    onPreview(null);
                    setProposal(null);
                    throw Error("The document changed. Preview discarded; generate again.");
                  }
                  onPreview(null);
                  setProposal(null);
                  onPending(false);
                  onDocument(proposal.doc, proposal.label);
                  if (proposal.selectId) onSelect(proposal.selectId);
                })
              }
            >
              Approve dialogue preview
            </Button>
          </>
        )}
        <p role="status" className="pro-help">
          {status}
        </p>
        <p className="pro-help">
          Selected OCR engine: {LANGUAGES[LANGUAGE_CODES[language]]}. No automatic language
          detection or machine translation is claimed.
        </p>
      </ToolSection>
    </div>
  );
}
