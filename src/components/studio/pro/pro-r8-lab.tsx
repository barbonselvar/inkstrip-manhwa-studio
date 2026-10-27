import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProAppearance } from "./pro-appearance";
import { ProSmartFilters } from "./pro-smart-filters";
import { ProNumber } from "./pro-properties";
import { ProRenderer } from "@/lib/studio/pro/client";
import { canonicalNative } from "@/lib/studio/pro/adjustment-schema";
import {
  r8Document,
  r8Settings,
  type R8Draft,
  type R8Settings,
} from "@/lib/studio/pro/r8-document";
import {
  factoryR8Presets,
  readR8Presets,
  validateR8Presets,
  type R8Preset,
} from "@/lib/studio/pro/r8-presets";
import { EMPTY_SELECTION, toLocalSelection, type ProSession } from "@/lib/studio/pro/model";
import "./r8-properties.css";
const PRESETS = "inkstrip-r8-presets-v1",
  CLIPBOARD = "inkstrip-r8-style-clipboard-v1";
export function ProR8Lab({
  draft,
  session,
  maxArea,
  onCancel,
  onApply,
}: {
  draft: R8Draft;
  session: ProSession;
  maxArea: number;
  onCancel: () => void;
  onApply: (s: R8Settings) => true | string;
}) {
  const [base] = useState(() => {
    const layer = (draft.created ?? draft.origin).layers.find((l) => l.id === draft.layerId)!;
    return { layer, settings: r8Settings(layer, draft.origin.styleLight ?? 135), session };
  });
  const [settings, setSettings] = useState<R8Settings>(() => structuredClone(base.settings)),
    [tab, setTab] = useState("styles"),
    [before, setBefore] = useState(false),
    [ready, setReady] = useState(false),
    [processing, setProcessing] = useState(true),
    [error, setError] = useState(""),
    [displayed, setDisplayed] = useState(""),
    [message, setMessage] = useState(""),
    [name, setName] = useState("");
  const [maskEditing, setMaskEditing] = useState(false);
  const [saved, setSaved] = useState<R8Preset[]>(() => {
    try {
      return readR8Presets(localStorage.getItem(PRESETS));
    } catch {
      return [];
    }
  });
  const worker = useRef<ProRenderer | null>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    generation = useRef(0);
  const proposed = useMemo(() => {
    try {
      return { document: r8Document(draft, settings, maxArea), error: "" };
    } catch (e) {
      return { document: draft.origin, error: (e as Error).message };
    }
  }, [draft, settings, maxArea]);
  const key = canonicalNative({ settings, before }),
    latest = useRef(key);
  useLayoutEffect(() => {
    latest.current = key;
  }, [key]);
  useEffect(() => {
    let active = true;
    let renderer: ProRenderer;
    try {
      renderer = new ProRenderer();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    worker.current = renderer;
    void renderer
      .init({ ...base.session, document: draft.origin }, maxArea)
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      renderer.dispose();
      worker.current = null;
    };
  }, [base, draft, maxArea]);
  useEffect(() => {
    if (!ready || proposed.error) return;
    const id = ++generation.current,
      renderer = worker.current!;
    let active = true;
    setProcessing(true);
    setError("");
    const timer = setTimeout(() => {
      void renderer
        .renderLatest(before ? draft.origin : proposed.document, maxArea)
        .then((result) => {
          if (!result.bitmap) return;
          try {
            if (!active || id !== generation.current || latest.current !== key) return;
            const c = canvas.current;
            if (!c) return;
            c.width = result.bitmap.width;
            c.height = result.bitmap.height;
            c.getContext("2d")!.drawImage(result.bitmap, 0, 0);
            setDisplayed(key);
            setProcessing(false);
          } finally {
            result.bitmap.close();
          }
        })
        .catch((e) => {
          if (active && id === generation.current && latest.current === key) {
            setProcessing(false);
            if (e.name !== "AbortError") setError(e.message);
          }
        });
    }, 70);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ready, proposed, before, draft, maxArea, key]);
  const waiting = !ready || processing || displayed !== key,
    target = proposed.document.layers.find((l) => l.id === draft.layerId) ?? base.layer;
  const disabledReason =
    base.layer.kind === "group"
      ? "Smart Filters cannot process groups. Choose a bounded artwork layer inside the group."
      : base.layer.vectorOverflow || base.layer.textPath || base.layer.appearance
        ? "Smart Filters need a bounded source plane; extended vector appearance and path text stay editable without filters."
        : base.layer.width * base.layer.height > 4_000_000
          ? "Smart Filters support native source layers up to4MP. This layer was not resized."
          : undefined;
  const save = (next: R8Preset[]) => {
    try {
      validateR8Presets(next);
      const raw = JSON.stringify(next);
      if (raw.length > 1_000_000) throw Error("Preset storage exceeds1MB.");
      localStorage.setItem(PRESETS, raw);
      setSaved(next);
      setMessage("Preset saved on this device.");
    } catch (e) {
      setMessage((e as Error).message);
    }
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
          className="r6-lab r8-lab"
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
              <Dialog.Title>Layer styles and Smart Filters</Dialog.Title>
              <Dialog.Description>
                {base.layer.name} · editable properties · {draft.origin.width} ×{" "}
                {draft.origin.height}
              </Dialog.Description>
            </div>
            <Button variant="ghost" onClick={onCancel}>
              Cancel layer properties
            </Button>
          </header>
          <p className="pro-help">
            Live composite preview. Apply saves editable settings, never replacement artwork. This
            uses native format9; older editors safely reject it.
          </p>
          <div className="r6-lab-grid">
            <div className="r6-preview-column">
              <div className="r6-preview">
                <canvas
                  ref={canvas}
                  aria-label="Layer properties composite preview"
                  aria-busy={waiting && !error}
                />
              </div>
              <label className="pro-check">
                <input
                  type="checkbox"
                  aria-label="Compare committed layer properties"
                  checked={before}
                  onChange={(e) => setBefore(e.target.checked)}
                />
                Before / after
              </label>
              <p className="pro-help" role="status">
                {error || proposed.error
                  ? "Preview unavailable"
                  : waiting
                    ? "Rendering layer properties…"
                    : before
                      ? "Committed document"
                      : "Editable composite preview"}
              </p>
            </div>
            <div className="r6-controls">
              <div className="r8-tabs" role="tablist" aria-label="Layer property sections">
                {[
                  ["styles", "Layer Styles"],
                  ["filters", "Smart Filters"],
                  ["gradient", "Gradient"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    disabled={maskEditing || (id === "gradient" && base.layer.kind !== "gradient")}
                    onClick={() => setTab(id!)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "styles" && (
                <>
                  <ProNumber
                    label="Shared light angle"
                    min={-360}
                    max={360}
                    value={settings.light ?? 135}
                    onChange={(light) => {
                      setSettings((s) => ({ ...s, light }));
                      setBefore(false);
                    }}
                  />
                  <ProAppearance
                    advanced
                    showGradient={false}
                    layer={target}
                    onPatch={(p) => {
                      setSettings((s) => ({ ...s, effects: p.effects }));
                      setBefore(false);
                    }}
                  />
                  <div className="pro-actions">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        try {
                          localStorage.setItem(
                            CLIPBOARD,
                            JSON.stringify([
                              {
                                version: 1,
                                name: "Clipboard",
                                settings: { effects: settings.effects ?? [] },
                              },
                            ]),
                          );
                          setMessage("Layer style copied.");
                        } catch (e) {
                          setMessage((e as Error).message);
                        }
                      }}
                    >
                      Copy layer style
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        try {
                          const p = readR8Presets(localStorage.getItem(CLIPBOARD))[0];
                          if (!p) throw Error("Copy a layer style first.");
                          setSettings((s) => ({
                            ...s,
                            effects: structuredClone(p.settings.effects),
                          }));
                          setBefore(false);
                          setMessage("Layer style pasted into this draft.");
                        } catch (e) {
                          setMessage((e as Error).message);
                        }
                      }}
                    >
                      Paste layer style
                    </Button>
                  </div>
                </>
              )}
              {tab === "filters" && (
                <ProSmartFilters
                  value={settings.smartFilters ?? []}
                  onChange={(smartFilters) => {
                    setSettings((s) => ({ ...s, smartFilters }));
                    setBefore(false);
                  }}
                  disabledReason={disabledReason}
                  maskSize={{ width: base.layer.width, height: base.layer.height }}
                  maskClip={
                    draft.origin.selection?.regions.length || draft.origin.selection?.inverted
                      ? toLocalSelection(draft.origin.selection, base.layer, {
                          width: draft.origin.width,
                          height: draft.origin.height,
                        })
                      : undefined
                  }
                  onEditingChange={setMaskEditing}
                  captureMask={() => ({
                    selection: toLocalSelection(
                      draft.origin.selection?.regions.length || draft.origin.selection?.inverted
                        ? draft.origin.selection
                        : { ...EMPTY_SELECTION, inverted: true },
                      base.layer,
                      { width: draft.origin.width, height: draft.origin.height },
                    ),
                    enabled: true,
                    inverted: false,
                    density: 1,
                  })}
                />
              )}
              {tab === "gradient" && (
                <ProAppearance
                  advanced
                  showEffects={false}
                  layer={target}
                  onPatch={(p) => {
                    setSettings((s) => ({ ...s, gradient: p.gradient }));
                    setBefore(false);
                  }}
                />
              )}
              <details className="r8-presets" hidden={maskEditing}>
                <summary>Reusable presets</summary>
                <label className="pro-field">
                  Layer property preset
                  <select
                    className="field"
                    aria-label="Layer property preset"
                    value=""
                    onChange={(e) => {
                      const p = [...factoryR8Presets(), ...saved].find(
                        (p) => p.name === e.target.value,
                      );
                      if (p) {
                        setSettings((s) => ({ ...s, ...structuredClone(p.settings) }));
                        setBefore(false);
                        setName(p.name);
                      }
                    }}
                  >
                    <option value="" disabled>
                      Choose a preset
                    </option>
                    {[...factoryR8Presets(), ...saved].map((p) => (
                      <option
                        key={p.name}
                        value={p.name}
                        disabled={
                          (!!p.settings.gradient && base.layer.kind !== "gradient") ||
                          (!!p.settings.smartFilters?.length && !!disabledReason)
                        }
                      >
                        {p.name}
                        {p.settings.gradient && base.layer.kind !== "gradient"
                          ? " (Gradient Fill only)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pro-field">
                  Preset name
                  <input
                    className="field"
                    aria-label="Layer property preset name"
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <div className="pro-actions">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if ([...factoryR8Presets(), ...saved].some((p) => p.name === name.trim())) {
                        setMessage("A preset with that name already exists.");
                        return;
                      }
                      save([
                        ...saved,
                        { version: 1, name: name.trim(), settings: structuredClone(settings) },
                      ]);
                    }}
                  >
                    Save layer property preset
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      let next = (name.trim() || "Layer style").slice(0, 65) + " copy",
                        i = 2;
                      while ([...factoryR8Presets(), ...saved].some((p) => p.name === next))
                        next = (name.trim() || "Layer style").slice(0, 65) + ` copy${i++}`;
                      save([
                        ...saved,
                        { version: 1, name: next, settings: structuredClone(settings) },
                      ]);
                      setName(next);
                    }}
                  >
                    Duplicate style preset
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!saved.some((p) => p.name === name)}
                    onClick={() => save(saved.filter((p) => p.name !== name))}
                  >
                    Delete layer property preset
                  </Button>
                </div>
              </details>
              {message && (
                <p className="pro-help" role="status">
                  {message}
                </p>
              )}
            </div>
          </div>
          {(error || proposed.error) && (
            <p className="pro-error" role="alert">
              {proposed.error || error}
            </p>
          )}
          <footer>
            <Button
              variant="secondary"
              disabled={maskEditing}
              onClick={() => {
                setSettings(structuredClone(base.settings));
                setBefore(false);
              }}
            >
              Reset layer properties
            </Button>
            <Button
              disabled={maskEditing || waiting || before || !!error || !!proposed.error}
              onClick={() => {
                if (displayed !== latest.current) return;
                const result = onApply(settings);
                if (result === true) onCancel();
                else setError(result);
              }}
            >
              Apply layer properties
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
