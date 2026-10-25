import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import { ProRenderer } from "@/lib/studio/pro/client";
import {
  CHANNELS,
  COLOR_OPERATIONS,
  HUE_RANGES,
  curveLut,
  defaultOperation,
  type Channel,
  type ColorOperation,
  type CurvePoint,
} from "@/lib/studio/pro/color-engine";
import {
  COLOR_PRESETS,
  loadColorPresets,
  storeColorPresets,
  type ColorPreset,
} from "@/lib/studio/pro/color-presets";
import {
  EMPTY_SELECTION,
  toLocalSelection,
  type ProDocument,
  type ProSession,
} from "@/lib/studio/pro/model";
function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
function Control({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="r6-control">
      <ProNumber label={label} value={value} min={min} max={max} step={step} onChange={onChange} />
      <input
        type="range"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </div>
  );
}
export function ColorHistogramView({ bins }: { bins: number[] | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !bins) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 72);
    ctx.fillStyle = getComputedStyle(c).color;
    const max = Math.max(...bins, 1);
    for (let i = 0; i < 256; i++) ctx.fillRect(i, 72, 1, (-bins[i]! / max) * 70);
  }, [bins]);
  return (
    <figure className="r6-histogram">
      <canvas ref={canvas} width={256} height={72} aria-label="Source histogram" role="img" />
      <figcaption>Alpha-weighted native source histogram</figcaption>
    </figure>
  );
}
function CurveEditor({
  points,
  onChange,
  bins,
}: {
  points: CurvePoint[];
  onChange: (v: CurvePoint[]) => void;
  bins: number[] | undefined;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drag = useRef<number | null>(null),
    [selected, setSelected] = useState(0);
  const index = Math.min(selected, points.length - 1),
    point = points[index]!;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!,
      color = getComputedStyle(c).color;
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < 256; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
    if (bins) {
      const max = Math.max(...bins, 1);
      ctx.fillStyle = color;
      for (let x = 0; x < 256; x++) ctx.fillRect(x, 256, 1, (-bins[x]! / max) * 256);
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    curveLut(points).forEach((y, x) => {
      if (x === 0) ctx.moveTo(x, 255 - y);
      else ctx.lineTo(x, 255 - y);
    });
    ctx.stroke();
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, 255 - p.y, i === index ? 5 : 3, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }, [points, bins, index]);
  const patch = (i: number, p: Partial<CurvePoint>) =>
    onChange(points.map((v, j) => (i === j ? { ...v, ...p } : v)));
  return (
    <div className="r6-curve">
      <canvas
        ref={canvas}
        width={256}
        height={256}
        aria-label="Curves graph: tap to add or drag points"
        role="img"
        onPointerDown={(e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect(),
            x = Math.round(Math.max(0, Math.min(255, ((e.clientX - r.left) / r.width) * 255))),
            y = Math.max(0, Math.min(255, 255 - ((e.clientY - r.top) / r.height) * 255));
          let i = points.findIndex((p) => Math.hypot(p.x - x, p.y - y) < 12);
          if (i < 0) {
            if (points.length >= 16 || points.some((p) => Math.abs(p.x - x) < 2)) return;
            const next = [...points, { x, y }].sort((a, b) => a.x - b.x);
            i = next.findIndex((p) => p.x === x);
            onChange(next);
          }
          drag.current = i;
          setSelected(i);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const i = drag.current;
          if (i === null) return;
          const r = e.currentTarget.getBoundingClientRect(),
            x =
              i === 0
                ? 0
                : i === points.length - 1
                  ? 255
                  : Math.max(
                      points[i - 1]!.x + 1,
                      Math.min(
                        points[i + 1]!.x - 1,
                        Math.round(((e.clientX - r.left) / r.width) * 255),
                      ),
                    ),
            y = Math.max(0, Math.min(255, 255 - ((e.clientY - r.top) / r.height) * 255));
          patch(i, { x, y });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      <label className="pro-field">
        Curve control point
        <select
          className="field"
          aria-label="Curve control point"
          value={index}
          onChange={(e) => setSelected(+e.target.value)}
        >
          {points.map((p, i) => (
            <option key={i} value={i}>
              {i + 1}: {p.x}, {Math.round(p.y)}
            </option>
          ))}
        </select>
      </label>
      <div className="pro-number-grid">
        <ProNumber
          label="Curve input"
          value={point.x}
          min={index ? points[index - 1]!.x + 1 : 0}
          max={index < points.length - 1 ? points[index + 1]!.x - 1 : 255}
          disabled={index === 0 || index === points.length - 1}
          onChange={(x) => patch(index, { x: Math.round(x) })}
        />
        <ProNumber
          label="Curve output"
          value={point.y}
          min={0}
          max={255}
          onChange={(y) => patch(index, { y })}
        />
      </div>
      <div className="pro-actions">
        <Button
          variant="secondary"
          disabled={points.length >= 16}
          onClick={() => {
            let i = 0;
            for (let j = 1; j < points.length - 1; j++)
              if (points[j + 1]!.x - points[j]!.x > points[i + 1]!.x - points[i]!.x) i = j;
            const x = Math.round((points[i]!.x + points[i + 1]!.x) / 2);
            if (x === points[i]!.x || x === points[i + 1]!.x) return;
            const next = [...points];
            next.splice(i + 1, 0, { x, y: curveLut(points)[x]! });
            onChange(next);
            setSelected(i + 1);
          }}
        >
          Add curve point
        </Button>
        <Button
          variant="ghost"
          disabled={index === 0 || index === points.length - 1}
          onClick={() => {
            onChange(points.filter((_, i) => i !== index));
            setSelected(index - 1);
          }}
        >
          Remove curve point
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onChange([
              { x: 0, y: 0 },
              { x: 255, y: 255 },
            ]);
            setSelected(0);
          }}
        >
          Reset channel curve
        </Button>
      </div>
    </div>
  );
}
export function ColorOperationFields({
  operation,
  setOperation,
  channel,
  setChannel,
  hist,
  onEdit,
  allowedKinds,
}: {
  operation: ColorOperation;
  setOperation: React.Dispatch<React.SetStateAction<ColorOperation>>;
  channel: Channel;
  setChannel: (c: Channel) => void;
  hist: Record<Channel, number[]> | null;
  onEdit?: () => void;
  allowedKinds?: readonly ColorOperation["kind"][];
}) {
  // Typed generic patch stays local to this validated discriminated operation.
  const patch = (p: Record<string, unknown>) =>
    setOperation((v) => ({ ...v, ...p }) as ColorOperation);
  const control = (
    label: string,
    field: string,
    value: number,
    min: number,
    max: number,
    step = 1,
  ) => (
    <Control
      key={field}
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(v) => patch({ [field]: v })}
    />
  );
  let controls: React.ReactNode;
  switch (operation.kind) {
    case "brightnessContrast":
      controls = (
        <>
          {control("Brightness", "brightness", operation.brightness, -100, 100)}
          {control("Contrast", "contrast", operation.contrast, -100, 100)}
        </>
      );
      break;
    case "levels": {
      const v = operation.channels[channel];
      controls = (
        <>
          {Object.entries({
            black: ["Input black", 0, v.white - 1, 1],
            white: ["Input white", v.black + 1, 255, 1],
            gamma: ["Midtone gamma", 0.1, 5, 0.1],
            outBlack: ["Output black", 0, v.outWhite - 1, 1],
            outWhite: ["Output white", v.outBlack + 1, 255, 1],
          }).map(([field, [label, min, max, step]]) => (
            <Control
              key={field}
              label={String(label)}
              value={v[field as keyof typeof v]}
              min={+min!}
              max={+max!}
              step={+step!}
              onChange={(n) =>
                setOperation({
                  ...operation,
                  channels: { ...operation.channels, [channel]: { ...v, [field]: n } },
                })
              }
            />
          ))}
        </>
      );
      break;
    }
    case "curves":
      controls = (
        <CurveEditor
          key={channel}
          points={operation.channels[channel]}
          bins={hist?.[channel]}
          onChange={(p) =>
            setOperation({ ...operation, channels: { ...operation.channels, [channel]: p } })
          }
        />
      );
      break;
    case "hsl":
      controls = (
        <>
          <label className="pro-field">
            Color range
            <select
              className="field"
              aria-label="Color range"
              value={operation.range}
              onChange={(e) => patch({ range: e.target.value })}
            >
              {HUE_RANGES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          {control("Hue shift", "hue", operation.hue, -180, 180)}
          {control("Saturation", "saturation", operation.saturation, -100, 100)}
          {control("Lightness", "lightness", operation.lightness, -100, 100)}
        </>
      );
      break;
    case "balance":
      controls = (
        <>
          {(["shadows", "midtones", "highlights"] as const).map((range) => (
            <details key={range} open={range === "midtones"}>
              <summary>{range}</summary>
              {["Cyan / Red", "Magenta / Green", "Yellow / Blue"].map((axis, c) => (
                <Control
                  key={axis}
                  label={`${range} ${axis}`}
                  value={operation[range][c]!}
                  min={-100}
                  max={100}
                  onChange={(n) =>
                    patch({ [range]: operation[range].map((v, j) => (c === j ? n : v)) })
                  }
                />
              ))}
            </details>
          ))}
          <label className="pro-check">
            <input
              type="checkbox"
              checked={operation.preserveLuminance}
              onChange={(e) => patch({ preserveLuminance: e.target.checked })}
            />
            Preserve encoded luma
          </label>
        </>
      );
      break;
    case "exposure":
      controls = (
        <>
          {control("Exposure stops", "stops", operation.stops, -5, 5, 0.1)}
          {control("Gamma", "gamma", operation.gamma, 0.1, 5, 0.1)}
          <p className="pro-help">
            Exposure multiplies linear-light sRGB by 2^stops; gamma follows encoding.
          </p>
        </>
      );
      break;
    case "vibrance":
      controls = (
        <>
          {control("Vibrance", "vibrance", operation.vibrance, -100, 100)}
          {control("Saturation", "saturation", operation.saturation, -100, 100)}
        </>
      );
      break;
    case "blackWhite":
      controls = (
        <>
          {(["red", "green", "blue"] as const).map((c) =>
            control(`${c} mix (%)`, c, operation[c], -200, 200, 0.01),
          )}
          <p className="pro-help">
            Default Rec.709 coefficients on encoded sRGB. Channel mixes are additive percentages;
            clipped to the output gamut.
          </p>
        </>
      );
      break;
    case "threshold":
      controls = control("Threshold cutoff", "level", operation.level, 0, 255);
      break;
    case "posterize":
      controls = control("Discrete levels", "levels", operation.levels, 2, 256);
      break;
    case "gaussian":
    case "highPass":
      controls = control("Gaussian sigma", "radius", operation.radius, 0.1, 32, 0.1);
      break;
    case "box":
    case "median":
      controls = control(
        "Filter radius",
        "radius",
        operation.radius,
        1,
        operation.kind === "median" ? 3 : 32,
      );
      break;
    case "motion":
      controls = (
        <>
          {control("Motion length", "length", operation.length, 1, 63)}
          {control("Motion angle", "angle", operation.angle, -180, 180)}
        </>
      );
      break;
    case "sharpen":
    case "denoise":
      controls = control(
        "Filter amount (%)",
        "amount",
        operation.amount,
        0,
        operation.kind === "denoise" ? 100 : 300,
      );
      break;
    case "unsharp":
      controls = (
        <>
          {control("Gaussian sigma", "radius", operation.radius, 0.1, 32, 0.1)}
          {control("Unsharp amount (%)", "amount", operation.amount, 0, 300)}
          {control("Unsharp threshold", "threshold", operation.threshold, 0, 255)}
        </>
      );
      break;
    case "noise":
      controls = (
        <>
          {control("Noise amount (%)", "amount", operation.amount, 0, 100)}
          {control("Noise seed", "seed", operation.seed, 0, 0xffffffff)}
          <label className="pro-check">
            <input
              type="checkbox"
              checked={operation.monochrome}
              onChange={(e) => patch({ monochrome: e.target.checked })}
            />
            Monochrome noise
          </label>
        </>
      );
      break;
    default:
      controls = (
        <p className="pro-help">
          {operation.kind === "invert"
            ? "Invert visible RGB channels; keep alpha unchanged."
            : "Sobel gradient magnitude of encoded luma. Black means no edge."}
        </p>
      );
  }
  return (
    <>
      <label className="pro-field">
        Adjustment or filter
        <select
          className="field"
          aria-label="Adjustment or filter"
          value={operation.kind}
          onChange={(e) => {
            setOperation(defaultOperation(e.target.value as ColorOperation["kind"]));
            onEdit?.();
          }}
        >
          {Object.entries(COLOR_OPERATIONS)
            .filter(([k]) => !allowedKinds || allowedKinds.includes(k as ColorOperation["kind"]))
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
      </label>
      {(operation.kind === "levels" || operation.kind === "curves") && (
        <label className="pro-field">
          Channel
          <select
            className="field"
            aria-label="Color channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c === "rgb" ? "RGB composite" : c}
              </option>
            ))}
          </select>
        </label>
      )}
      {controls}
    </>
  );
}
export function ColorPresetControls({
  operation,
  onChange,
  allowedKinds,
}: {
  operation: ColorOperation;
  onChange: (a: ColorOperation, name?: string) => void;
  allowedKinds?: readonly ColorOperation["kind"][];
}) {
  const [custom, setCustom] = useState<ColorPreset[]>(() => loadColorPresets(storage())),
    [presetName, setPresetName] = useState(""),
    [presetStatus, setPresetStatus] = useState("");
  const choices = [...COLOR_PRESETS, ...custom].filter(
    (p) => !allowedKinds || allowedKinds.includes(p.operation.kind),
  );
  return (
    <details>
      <summary>Presets</summary>
      <label className="pro-field">
        Color preset
        <select
          className="field"
          aria-label="Color preset"
          value=""
          onChange={(e) => {
            const p = choices[+e.target.value];
            if (p) {
              onChange(structuredClone(p.operation), p.name);
            }
          }}
        >
          <option value="" disabled>
            Choose preset
          </option>
          {choices.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="pro-field">
        Custom preset name
        <input
          className="field"
          aria-label="Custom color preset name"
          value={presetName}
          maxLength={80}
          onChange={(e) => setPresetName(e.target.value)}
        />
      </label>
      <Button
        variant="secondary"
        onClick={() => {
          try {
            const next = [
              ...custom,
              { name: presetName.trim(), operation: structuredClone(operation) },
            ];
            storeColorPresets(storage(), next);
            setCustom(next);
            setPresetName("");
            setPresetStatus("Custom preset saved on this device.");
          } catch (e) {
            setPresetStatus((e as Error).message);
          }
        }}
      >
        Save color preset
      </Button>
      {custom.map((p) => (
        <Button
          variant="ghost"
          key={p.name}
          onClick={() => {
            try {
              const next = custom.filter((v) => v.name !== p.name);
              storeColorPresets(storage(), next);
              setCustom(next);
              setPresetStatus("Preset removed.");
            } catch (e) {
              setPresetStatus((e as Error).message);
            }
          }}
        >
          Delete {p.name}
        </Button>
      ))}
      <p className="pro-help" role="status">
        {presetStatus}
      </p>
    </details>
  );
}
export function ProColorLab({
  origin,
  layerId,
  session,
  maxArea,
  onCancel,
  onApply,
}: {
  origin: ProDocument;
  layerId: string;
  session: ProSession;
  maxArea: number;
  onCancel: () => void;
  onApply: (blob: Blob) => true | string;
}) {
  const snapshot = useRef(session).current;
  const target = origin.layers.find((l) => l.id === layerId)!;
  const [operation, setOperation] = useState<ColorOperation>(() =>
      defaultOperation("brightnessContrast"),
    ),
    [channel, setChannel] = useState<Channel>("rgb"),
    [source, setSource] = useState<Blob | null>(null),
    [result, setResult] = useState<{ blob: Blob; key: string } | null>(null),
    [displayedKey, setDisplayedKey] = useState(""),
    [before, setBefore] = useState(false),
    [selectionOnly, setSelectionOnly] = useState(false),
    [hist, setHist] = useState<Record<Channel, number[]> | null>(null),
    [error, setError] = useState(""),
    [processing, setProcessing] = useState(true),
    [timing, setTiming] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify({ operation, selectionOnly }),
    latestKey = useRef(key);
  latestKey.current = key;
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  useEffect(() => {
    let alive = true;
    const renderer = new ProRenderer();
    void renderer
      .init({ ...snapshot, document: origin }, maxArea)
      .then(() => renderer.colorSource(origin, maxArea, layerId))
      .then((r) => {
        if (alive && r.blob) setSource(r.blob);
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setProcessing(false);
        }
      })
      .finally(() => renderer.dispose());
    return () => {
      alive = false;
      renderer.dispose();
    };
  }, [origin, snapshot, maxArea, layerId]);
  useEffect(() => {
    if (!source) return;
    let active = true;
    let worker: Worker | undefined;
    setProcessing(true);
    setError("");
    setResult(null);
    const timer = setTimeout(() => {
      worker = new Worker(new URL("../../../lib/studio/pro/color-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => {
        data.bitmap?.close();
        if (!active) return;
        if (data.error) {
          setError(data.error);
          setProcessing(false);
          worker?.terminate();
          return;
        }
        setResult({ blob: data.blob, key });
        setHist(data.histogram);
        setTiming(data.milliseconds);
        setProcessing(false);
        worker?.terminate();
      };
      worker.onerror = () => {
        if (active) {
          setError("Color processing worker stopped. Reduce the filter radius or layer size.");
          setProcessing(false);
        }
        worker?.terminate();
      };
      worker.postMessage({
        source,
        operation,
        selection: selectionOnly
          ? toLocalSelection(origin.selection ?? EMPTY_SELECTION, target, {
              width: origin.width,
              height: origin.height,
            })
          : undefined,
        maxArea,
      });
    }, 100);
    return () => {
      clearTimeout(timer);
      active = false;
      worker?.terminate();
    };
  }, [source, key, operation, selectionOnly, origin, target, maxArea]);
  useEffect(() => {
    let valid = true;
    const blob = before ? source : result?.key === key ? result.blob : null;
    if (blob)
      void createImageBitmap(blob)
        .then((b) => {
          if (valid && canvas.current) {
            canvas.current.width = b.width;
            canvas.current.height = b.height;
            canvas.current.getContext("2d")!.drawImage(b, 0, 0);
            if (!before) setDisplayedKey(key);
          }
          b.close();
        })
        .catch((e) => {
          if (valid) setError(`Preview decode failed: ${e.message}`);
        });
    else if (canvas.current)
      canvas.current.getContext("2d")!.clearRect(0, 0, canvas.current.width, canvas.current.height);
    return () => {
      valid = false;
    };
  }, [source, result, key, before]);
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
          onKeyDown={(e) => {
            if (e.key !== "Escape") e.stopPropagation();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          <header>
            <div>
              <Dialog.Title>Color & Filters</Dialog.Title>
              <Dialog.Description>
                {target.name} · {target.width} × {target.height} native pixels
              </Dialog.Description>
            </div>
            <Button variant="ghost" onClick={onCancel}>
              Cancel color
            </Button>
          </header>
          <p className="pro-help">
            Pixel operation on this layer. The editable original stays hidden after Apply. Preview
            shows layer-local pixels before masks, clipping, blend, opacity and effects; those
            remain editable in the document. Use Properties for existing editable adjustment layers.
          </p>
          <div className="r6-lab-grid">
            <div className="r6-preview-column">
              <div className="r6-preview">
                <canvas ref={canvas} aria-label="Native color preview" />
              </div>
              <label className="pro-check">
                <input
                  type="checkbox"
                  aria-label="Compare original color"
                  checked={before}
                  onChange={(e) => setBefore(e.target.checked)}
                />
                Before / after
              </label>
              <ColorHistogramView bins={hist?.[channel]} />
              <p role="status" className="pro-help">
                {processing
                  ? "Processing stable source…"
                  : error
                    ? "Preview unavailable"
                    : `${before ? "Before" : "After"} · ${timing.toFixed(1)} ms pixel processing`}
              </p>
            </div>
            <div className="r6-controls">
              <ColorOperationFields
                operation={operation}
                setOperation={setOperation}
                channel={channel}
                setChannel={setChannel}
                hist={hist}
                onEdit={() => setBefore(false)}
              />
              <label className="pro-check">
                <input
                  type="checkbox"
                  aria-label="Process captured selection only"
                  checked={selectionOnly}
                  disabled={!origin.selection?.regions.length && !origin.selection?.inverted}
                  onChange={(e) => setSelectionOnly(e.target.checked)}
                />
                Limit operation to captured selection
              </label>
              <ColorPresetControls
                operation={operation}
                onChange={(value) => {
                  setOperation(value);
                  setBefore(false);
                }}
              />
            </div>
          </div>
          {error && (
            <p className="pro-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <Button
              variant="secondary"
              onClick={() => {
                setOperation(defaultOperation(operation.kind));
                setSelectionOnly(false);
                setBefore(false);
              }}
            >
              Reset color settings
            </Button>
            <Button
              disabled={
                processing || !!error || !result || result.key !== key || displayedKey !== key
              }
              onClick={() => {
                if (result && result.key === latestKey.current) {
                  const accepted = applyRef.current(result.blob);
                  if (accepted === true) onCancel();
                  else setError(accepted);
                }
              }}
            >
              Apply color
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
