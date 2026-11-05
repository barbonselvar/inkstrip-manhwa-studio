import { Button } from "@/components/ui/button";
import { NumberField } from "../editor/number-field";
import { BLEND_MODES, type BlendMode } from "@/lib/studio/pro/blend";
import {
  AI_EXTENSION,
  FADE_TYPES,
  TRANSITION_TYPES,
  transitionActive,
  fade as newFade,
  mergeGap,
  layout,
  type CompositionDocument,
  type PanelComposition,
  type Space,
  type Fade,
  type Transition,
  type CompositionObject,
  type Sfx,
  type Fx,
} from "@/lib/studio/composition/model";
import { common } from "@/lib/studio/composition/library";
import { reparent, objectFlags } from "@/lib/studio/composition/geometry";
import {
  copySettings,
  clipboard,
  type Controller,
  type Session,
} from "@/lib/studio/composition/controller";
import type { Panel } from "@/lib/studio/types";
import { Copy, ClipboardPaste, RotateCcw, Plus, Trash2 } from "lucide-react";
export function Check({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="composition-check">
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
export function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="editor-field-label">
      {label}
      <select
        className="field"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="editor-field-label composition-color">
      {label}
      <input
        aria-label={label}
        type="color"
        value={value === "transparent" ? "#ffffff" : value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span>{value}</span>
    </label>
  );
}
function Masks({
  stops,
  onChange,
}: {
  stops: Fade["stops"];
  onChange: (s: Fade["stops"]) => void;
}) {
  return (
    <div>
      <p className="composition-hint">
        Custom gradient mask · black conceals, white reveals the transition.
      </p>
      {stops.map((s, i) => (
        <div className="composition-two" key={i}>
          <NumberField
            label={`Stop ${i + 1} position`}
            value={s.position}
            min={i === 0 ? 0 : stops[i - 1].position + 0.01}
            max={i === stops.length - 1 ? 1 : stops[i + 1].position - 0.01}
            step={0.01}
            onChange={(v) => onChange(stops.map((p, j) => (i === j ? { ...p, position: v } : p)))}
          />
          <NumberField
            label={`Stop ${i + 1} opacity`}
            value={s.opacity}
            max={1}
            step={0.01}
            onChange={(v) => onChange(stops.map((p, j) => (i === j ? { ...p, opacity: v } : p)))}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        disabled={stops.length >= 8}
        onClick={() => {
          let index = 0;
          for (let i = 1; i < stops.length - 1; i++)
            if (
              stops[i + 1].position - stops[i].position >
              stops[index + 1].position - stops[index].position
            )
              index = i;
          const a = stops[index],
            b = stops[index + 1];
          onChange([
            ...stops.slice(0, index + 1),
            { position: (a.position + b.position) / 2, opacity: (a.opacity + b.opacity) / 2 },
            ...stops.slice(index + 1),
          ]);
        }}
      >
        <Plus />
        Add mask stop
      </Button>
    </div>
  );
}
function SpaceControls({
  value,
  onChange,
  controller,
}: {
  value: Space;
  onChange: (patch: Partial<Space>) => void;
  controller: Controller;
}) {
  return (
    <>
      <label className="editor-field-label">
        Spacing layer name
        <input
          className="field"
          maxLength={200}
          value={value.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <Choice
        label="Spacing blend mode"
        value={value.blend ?? "source-over"}
        options={BLEND_MODES}
        onChange={(blend) => onChange({ blend: blend as BlendMode })}
      />
      <NumberField
        label="Height (chapter px)"
        value={value.height}
        max={100000}
        onChange={(height) => onChange({ height })}
        onEnd={() => controller.setState((s) => ({ history: { ...s.history, group: undefined } }))}
      />
      <div className="composition-presets-row">
        {[0, 100, 150, 200, 300, 500].map((height) => (
          <Button key={height} variant="ghost" onClick={() => onChange({ height })}>
            {height}
          </Button>
        ))}
      </div>
      <Choice
        label="Background"
        value={value.fill}
        options={["solid", "transparent", "gradient", "blur", "mirror"]}
        onChange={(fill) => onChange({ fill: fill as Space["fill"] })}
      />
      {value.fill === "solid" || value.fill === "gradient" ? (
        <Color label="Space color" value={value.color} onChange={(color) => onChange({ color })} />
      ) : null}
      {value.fill === "gradient" && (
        <Color
          label="Gradient end"
          value={value.color2}
          onChange={(color2) => onChange({ color2 })}
        />
      )}{" "}
      {value.fill === "blur" && (
        <NumberField
          label="Extension blur"
          value={value.blur}
          max={100}
          onChange={(blur) => onChange({ blur })}
        />
      )}
      <NumberField
        label="Space opacity"
        value={value.opacity}
        max={1}
        step={0.01}
        onChange={(opacity) => onChange({ opacity })}
      />
      <Check
        label="Show background"
        value={value.visible}
        onChange={(visible) => onChange({ visible })}
      />
      <Check
        label="Lock spacing"
        value={value.locked}
        onChange={(locked) => onChange({ locked })}
      />
      <p className="composition-hint">
        Transparent regions retain their height. AI extension is unavailable: {AI_EXTENSION.reason}
      </p>
    </>
  );
}
export function CompositionProperties({
  controller,
  session,
  document: d,
  panels,
  onPreset,
  onNative,
  onOverlay,
}: {
  controller: Controller;
  session: Session;
  document: CompositionDocument;
  panels: Panel[];
  onPreset: (
    category: "spacing" | "fade" | "transition" | "sfx" | "fx",
    value: Space | Fade | Transition | Sfx | Fx,
  ) => void;
  onNative: (id: string) => void;
  onOverlay: () => void;
}) {
  const selection = session.selection,
    selectedPanel =
      selection?.kind === "panel"
        ? selection.id
        : selection?.kind === "fade"
          ? selection.panelId
          : session.selectedPanels[0];
  const p = selectedPanel ? d.panels[selectedPanel] : undefined;
  const setPanel = (id: string, patch: Partial<PanelComposition>, group?: string) =>
    controller.change(
      (doc) => ({ ...doc, panels: { ...doc.panels, [id]: { ...doc.panels[id], ...patch } } }),
      group,
    );
  const selectedSpace = selection?.kind === "space" ? selection : null;
  const slot = selectedSpace?.slot ?? "bottom",
    spaceId = selectedSpace?.id ?? selectedPanel;
  const space =
    slot === "opening" || slot === "ending"
      ? d[slot]
      : spaceId
        ? d.panels[spaceId]?.[slot]
        : undefined;
  const setSpace = (patch: Partial<Space>) => {
    controller.change(
      (doc) =>
        slot === "opening" || slot === "ending"
          ? { ...doc, [slot]: { ...doc[slot], ...patch } }
          : !spaceId
            ? doc
            : {
                ...doc,
                panels: {
                  ...doc.panels,
                  [spaceId]: {
                    ...doc.panels[spaceId],
                    [slot]: { ...doc.panels[spaceId][slot], ...patch },
                  },
                },
              },
      `space-${spaceId}-${slot}`,
    );
  };
  const f =
    selection?.kind === "fade"
      ? d.panels[selection.panelId]?.fades.find((f) => f.id === selection.id)
      : undefined;
  const setFade = (patch: Partial<Fade>) => {
    if (selection?.kind !== "fade" || !f) return;
    setPanel(
      selection.panelId,
      {
        fades: d.panels[selection.panelId].fades.map((x) =>
          x.id === f.id ? { ...x, ...patch } : x,
        ),
      },
      `fade-${f.id}-${Object.keys(patch).join()}`,
    );
  };
  const t =
    selection?.kind === "transition" ? d.transitions.find((t) => t.id === selection.id) : undefined;
  const setTransition = (patch: Partial<Transition>) => {
    if (!t) return;
    controller.change(
      (doc) => ({
        ...doc,
        transitions: doc.transitions.map((x) => (x.id === t.id ? { ...x, ...patch } : x)),
      }),
      `transition-${t.id}-${Object.keys(patch).join()}`,
    );
  };
  const o = selection?.kind === "object" ? d.objects.find((o) => o.id === selection.id) : undefined;
  const setObject = (patch: Partial<CompositionObject>) => {
    if (!o) return;
    controller.change(
      (doc) => ({
        ...doc,
        objects: doc.objects.map((x) =>
          x.id === o.id ? ({ ...x, ...patch } as CompositionObject) : x,
        ),
      }),
      `object-${o.id}-${Object.keys(patch).join()}`,
    );
  };
  const batchFade = () => {
    if (!f) return;
    controller.change((doc) => ({
      ...doc,
      panels: Object.fromEntries(
        Object.entries(doc.panels).map(([id, p]) => [
          id,
          session.selectedPanels.includes(id) && !p.locked
            ? { ...p, fades: [...p.fades, { ...structuredClone(f), id: crypto.randomUUID() }] }
            : p,
        ]),
      ),
    }));
  };
  const locked = !!(
    (o ? objectFlags(o, d.objects).locked : false) ||
    f?.locked ||
    t?.locked ||
    (session.tool === "Spacing" ? space?.locked : selection?.kind === "panel" ? p?.locked : false)
  );
  const unlock = () => {
    if (o) {
      let target = o;
      while (!target.locked && target.parentId) {
        const parent = d.objects.find((p) => p.id === target.parentId);
        if (!parent) break;
        target = parent;
      }
      controller.change((doc) => ({
        ...doc,
        objects: doc.objects.map((p) => (p.id === target.id ? { ...p, locked: false } : p)),
      }));
    } else if (f) setFade({ locked: false });
    else if (t) setTransition({ locked: false });
    else if (session.tool === "Spacing") setSpace({ locked: false });
    else if (selectedPanel) setPanel(selectedPanel, { locked: false });
  };
  return (
    <div className="composition-properties-content">
      {locked && (
        <Button variant="secondary" onClick={unlock}>
          Unlock selected layer
        </Button>
      )}
      <fieldset disabled={locked}>
        {session.tool === "Spacing" ? (
          <>
            <h3>Spacing</h3>
            {spaceId && (
              <p className="composition-hint">
                {slot === "opening"
                  ? "Chapter opening"
                  : slot === "ending"
                    ? "Chapter ending"
                    : `${panels.find((p) => p.id === spaceId)?.name ?? "Selected panel"} · ${slot === "after" ? "between-panel gap" : `${slot} extension`}`}
              </p>
            )}
            <p className="composition-hint">Exact pixels at {d.width}px chapter width.</p>
            <div className="composition-actions">
              <Button
                variant="ghost"
                onClick={() => controller.select({ kind: "space", id: "opening", slot: "opening" })}
              >
                Chapter opening
              </Button>
              <Button
                variant="ghost"
                onClick={() => controller.select({ kind: "space", id: "ending", slot: "ending" })}
              >
                Chapter ending
              </Button>
            </div>
            {spaceId && slot !== "opening" && slot !== "ending" && (
              <Choice
                label="Spacing region"
                value={slot}
                options={["top", "bottom", "after"]}
                onChange={(v) =>
                  controller.select({
                    kind: "space",
                    id: spaceId,
                    slot: v as "top" | "bottom" | "after",
                  })
                }
              />
            )}
            {space ? (
              <>
                <SpaceControls value={space} controller={controller} onChange={setSpace} />
                <div className="composition-actions">
                  <Button variant="ghost" onClick={() => copySettings(space)}>
                    <Copy />
                    Copy
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (
                        clipboard &&
                        "fill" in clipboard &&
                        "height" in clipboard &&
                        "color2" in clipboard &&
                        !("kind" in clipboard)
                      )
                        setSpace(clipboard as Space);
                    }}
                  >
                    <ClipboardPaste />
                    Paste
                  </Button>
                  <Button variant="ghost" onClick={() => setSpace({ height: 0 })}>
                    <RotateCcw />
                    Reset
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={space.height > 50000}
                    title="Maximum spacing height is 100000px per region"
                    onClick={() => setSpace({ height: space.height * 2 })}
                  >
                    Double height
                  </Button>
                </div>
                <Button variant="secondary" onClick={() => onPreset("spacing", space)}>
                  Save spacing preset
                </Button>
                {slot !== "opening" && slot !== "ending" && (
                  <div className="composition-actions">
                    <Button
                      variant="secondary"
                      disabled={!session.selectedPanels.length}
                      onClick={() =>
                        controller.change((doc) => ({
                          ...doc,
                          panels: Object.fromEntries(
                            Object.entries(doc.panels).map(([id, p]) => [
                              id,
                              session.selectedPanels.includes(id) && !p.locked && !p[slot].locked
                                ? { ...p, [slot]: structuredClone(space) }
                                : p,
                            ]),
                          ),
                        }))
                      }
                    >
                      Apply to selected ({session.selectedPanels.length})
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        controller.change((doc) => ({
                          ...doc,
                          panels: Object.fromEntries(
                            Object.entries(doc.panels).map(([id, p]) => [
                              id,
                              p.locked || p[slot].locked
                                ? p
                                : { ...p, [slot]: structuredClone(space) },
                            ]),
                          ),
                        }))
                      }
                    >
                      Apply to all panels
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p>Select a panel or click a gap to adjust spacing.</p>
            )}
            {spaceId &&
              panels.findIndex((p) => p.id === spaceId) >= 0 &&
              panels[panels.findIndex((p) => p.id === spaceId) + 1] &&
              (() => {
                const b = panels[panels.findIndex((p) => p.id === spaceId) + 1],
                  a = d.panels[spaceId],
                  total = a.bottom.height + a.after.height + d.panels[b.id].top.height;
                return (
                  <div className="composition-card">
                    <strong>Gap to next panel: {total} px</strong>
                    <p>
                      {a.bottom.height} bottom + {a.after.height} gap + {d.panels[b.id].top.height}{" "}
                      top
                    </p>
                    <p className="composition-hint">
                      {total > 100000
                        ? "This total exceeds the shared-region limit. The separate regions retain every pixel."
                        : "Merge uses the selected space color and preserves the total."}
                    </p>
                    <Button
                      variant="secondary"
                      disabled={total > 100000}
                      onClick={() =>
                        controller.change((doc) =>
                          mergeGap(doc, spaceId, b.id, space?.color ?? "#ffffff"),
                        )
                      }
                    >
                      Merge into shared gap
                    </Button>
                  </div>
                );
              })()}
          </>
        ) : f ? (
          <>
            <h3>{f.name}</h3>
            <label className="editor-field-label">
              Fade name
              <input
                className="field"
                maxLength={200}
                value={f.name}
                onChange={(e) => setFade({ name: e.target.value })}
              />
            </label>
            <Choice
              label="Fade type"
              value={f.type}
              options={FADE_TYPES}
              onChange={(type) =>
                setFade({
                  type: type as Fade["type"],
                  name: f.name === f.type ? type : f.name,
                  edges: newFade(type as Fade["type"]).edges,
                })
              }
            />
            <div className="composition-actions">
              <Button
                variant="ghost"
                onClick={() => {
                  if (selection?.kind !== "fade") return;
                  setPanel(selection.panelId, {
                    fades: [
                      ...p!.fades,
                      {
                        ...structuredClone(f),
                        id: crypto.randomUUID(),
                        name: `${f.name} copy`.slice(0, 200),
                      },
                    ],
                  });
                }}
              >
                Duplicate fade
              </Button>
              <Button
                variant="ghost"
                disabled={p!.fades.at(-1)?.id === f.id}
                onClick={() => {
                  const list = [...p!.fades],
                    i = list.findIndex((x) => x.id === f.id);
                  [list[i], list[i + 1]] = [list[i + 1], list[i]];
                  setPanel(selectedPanel!, { fades: list });
                }}
              >
                Raise fade
              </Button>
              <Button
                variant="ghost"
                disabled={p!.fades[0]?.id === f.id}
                onClick={() => {
                  const list = [...p!.fades],
                    i = list.findIndex((x) => x.id === f.id);
                  [list[i], list[i - 1]] = [list[i - 1], list[i]];
                  setPanel(selectedPanel!, { fades: list });
                }}
              >
                Lower fade
              </Button>
            </div>
            <NumberField
              label="Fade length (px)"
              value={f.length}
              min={1}
              max={100000}
              onChange={(length) => setFade({ length })}
            />
            <NumberField
              label="Start position (px)"
              value={f.start}
              max={100000}
              onChange={(start) => setFade({ start })}
            />
            <NumberField
              label="End position (px)"
              value={f.start + f.length}
              min={f.start + 1}
              max={100000}
              onChange={(end) => setFade({ length: end - f.start })}
            />
            <NumberField
              label="Fade opacity"
              value={f.opacity}
              max={1}
              step={0.01}
              onChange={(opacity) => setFade({ opacity })}
            />
            <NumberField
              label="Gradient curve"
              value={f.curve}
              min={0.1}
              max={10}
              step={0.1}
              onChange={(curve) => setFade({ curve })}
            />
            <NumberField
              label="Feather radius"
              value={f.feather}
              max={1000}
              onChange={(feather) => setFade({ feather })}
            />
            <NumberField
              label="Blur intensity"
              value={f.blur}
              max={100}
              onChange={(blur) => setFade({ blur })}
            />
            {/Linear|Directional/.test(f.type) && (
              <NumberField
                label="Fade direction"
                value={f.angle}
                min={-360}
                max={360}
                onChange={(angle) => setFade({ angle })}
              />
            )}
            <Color
              label="Fade target color"
              value={f.color}
              onChange={(color) => setFade({ color })}
            />
            <Check
              label="Fade to transparency"
              value={f.color === "transparent"}
              onChange={(checked) => setFade({ color: checked ? "transparent" : "#ffffff" })}
            />
            <Choice
              label="Fade blend mode"
              value={f.blend}
              options={BLEND_MODES}
              onChange={(blend) => setFade({ blend: blend as BlendMode })}
            />
            {f.type === "Multi-edge Fade" && (
              <div>
                {(["top", "bottom", "left", "right"] as const).map((edge) => (
                  <Check
                    key={edge}
                    label={`${edge} edge`}
                    value={f.edges.includes(edge)}
                    onChange={(checked) =>
                      setFade({
                        edges: checked
                          ? [...f.edges, edge]
                          : f.edges.length > 1
                            ? f.edges.filter((e) => e !== edge)
                            : f.edges,
                      })
                    }
                  />
                ))}
              </div>
            )}
            {f.type === "Custom Gradient Fade" && (
              <Masks stops={f.stops} onChange={(stops) => setFade({ stops })} />
            )}
            <Check
              label="Fade visible"
              value={f.visible}
              onChange={(visible) => setFade({ visible })}
            />
            <Check
              label="Fade locked"
              value={f.locked}
              onChange={(locked) => setFade({ locked })}
            />
            <Button variant="secondary" onClick={() => onPreset("fade", f)}>
              Save fade preset
            </Button>
            <Button
              variant="secondary"
              disabled={!session.selectedPanels.length}
              onClick={batchFade}
            >
              Copy fade to selected
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setPanel(selection!.kind === "fade" ? selection!.panelId : "", {
                  fades: p!.fades.filter((x) => x.id !== f.id),
                });
                controller.select({ kind: "panel", id: selectedPanel! });
              }}
            >
              <Trash2 />
              Delete fade
            </Button>
          </>
        ) : t ? (
          <>
            <h3>Panel transition</h3>
            <p className="composition-hint">
              {panels.find((p) => p.id === t.a)?.name} → {panels.find((p) => p.id === t.b)?.name}
              {transitionActive(t, panels) ? "" : " · inactive: panels are no longer adjacent"}
            </p>
            <label className="editor-field-label">
              Transition name
              <input
                className="field"
                maxLength={200}
                value={t.name ?? t.type}
                onChange={(e) => setTransition({ name: e.target.value })}
              />
            </label>
            <Choice
              label="Transition blend mode"
              value={t.blend ?? "source-over"}
              options={BLEND_MODES}
              onChange={(blend) => setTransition({ blend: blend as BlendMode })}
            />
            <Button
              variant="ghost"
              onClick={() =>
                controller.change((doc) => ({
                  ...doc,
                  transitions: [
                    ...doc.transitions,
                    {
                      ...structuredClone(t),
                      id: crypto.randomUUID(),
                      name: `${t.name ?? t.type} copy`.slice(0, 200),
                    },
                  ],
                }))
              }
            >
              Duplicate transition
            </Button>
            <Choice
              label="Transition type"
              value={t.type}
              options={TRANSITION_TYPES}
              onChange={(type) => setTransition({ type: type as Transition["type"] })}
            />
            <NumberField
              label="Transition height"
              value={t.height}
              min={1}
              max={100000}
              onChange={(height) => setTransition({ height })}
            />
            <NumberField
              label="Transition softness"
              value={t.softness}
              min={0.01}
              max={1}
              step={0.01}
              onChange={(softness) => setTransition({ softness })}
            />
            <NumberField
              label="Transition opacity"
              value={t.opacity}
              max={1}
              step={0.01}
              onChange={(opacity) => setTransition({ opacity })}
            />
            <NumberField
              label="Transition direction"
              value={t.angle}
              min={-360}
              max={360}
              onChange={(angle) => setTransition({ angle })}
            />
            <Color
              label="Transition color"
              value={t.color}
              onChange={(color) => setTransition({ color })}
            />
            {t.type === "Custom Mask Transition" && (
              <Masks stops={t.stops} onChange={(stops) => setTransition({ stops })} />
            )}
            <Check
              label="Transition visible"
              value={t.visible}
              onChange={(visible) => setTransition({ visible })}
            />
            <Check
              label="Transition locked"
              value={t.locked}
              onChange={(locked) => setTransition({ locked })}
            />
            <div className="composition-actions">
              <Button variant="ghost" onClick={() => copySettings(t)}>
                Copy
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  if (clipboard && "a" in clipboard && "b" in clipboard)
                    setTransition({ ...clipboard, id: t.id, a: t.a, b: t.b });
                }}
              >
                Paste settings
              </Button>
            </div>
            <Button variant="secondary" onClick={() => onPreset("transition", t)}>
              Save transition preset
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                controller.change((doc) => ({
                  ...doc,
                  transitions: doc.transitions.filter((x) => x.id !== t.id),
                }));
                controller.select(null);
              }}
            >
              Delete transition
            </Button>
          </>
        ) : o ? (
          <>
            <h3>
              {o.kind === "sfx"
                ? "Sound effect"
                : o.kind === "group"
                  ? "Layer group"
                  : "Visual layer"}
            </h3>
            <label className="editor-field-label">
              Layer name
              <input
                className="field"
                maxLength={200}
                value={o.name}
                onChange={(e) => setObject({ name: e.target.value })}
              />
            </label>
            <div className="composition-two">
              {(["x", "y", "width", "height", "rotation", "scaleX", "scaleY", "skew"] as const).map(
                (key) => (
                  <NumberField
                    key={key}
                    label={key === "x" ? "X position" : key === "y" ? "Y position" : key}
                    value={o[key]}
                    min={
                      key === "x" || key === "y"
                        ? -1e8
                        : key === "rotation"
                          ? -360
                          : key === "skew"
                            ? -75
                            : key === "scaleX" || key === "scaleY"
                              ? 0.01
                              : 1
                    }
                    max={
                      key === "x" || key === "y"
                        ? 1e8
                        : key === "rotation"
                          ? 360
                          : key === "skew"
                            ? 75
                            : key === "scaleX" || key === "scaleY"
                              ? 20
                              : 100000
                    }
                    step={key.startsWith("scale") ? 0.01 : 1}
                    onChange={(v) => setObject({ [key]: v })}
                  />
                ),
              )}
            </div>
            <label className="editor-field-label">
              Coordinate scope
              <select
                className="field"
                value={o.owner ?? ""}
                disabled={!!o.parentId || o.kind === "group"}
                onChange={(e) => {
                  const owner = e.target.value || undefined,
                    frames = layout(d, panels).frames;
                  const oldY = o.owner
                      ? (frames.find((f) => f.panel.id === o.owner)?.imageY ?? 0)
                      : 0,
                    newY = owner ? (frames.find((f) => f.panel.id === owner)?.imageY ?? 0) : 0;
                  setObject({ owner, y: o.y + oldY - newY });
                }}
              >
                <option value="">Chapter global</option>
                {panels.map((p) => (
                  <option key={p.id} value={p.id}>
                    Panel · {p.name}
                  </option>
                ))}
              </select>
            </label>
            {o.kind !== "group" && (
              <label className="editor-field-label">
                Layer group
                <select
                  className="field"
                  value={o.parentId ?? ""}
                  onChange={(e) =>
                    setObject(
                      reparent(
                        o,
                        e.target.value || undefined,
                        o.owner,
                        layout(d, panels).frames,
                        d.objects,
                      ),
                    )
                  }
                >
                  <option value="">No group</option>
                  {d.objects
                    .filter((g) => g.kind === "group" && g.owner === o.owner)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <NumberField
              label="Layer opacity"
              value={o.opacity}
              max={1}
              step={0.01}
              onChange={(opacity) => setObject({ opacity })}
            />
            <Choice
              label="Layer blend mode"
              value={o.blend}
              options={BLEND_MODES}
              onChange={(blend) => setObject({ blend: blend as BlendMode })}
            />
            <Check
              label="Layer visible"
              value={o.visible}
              onChange={(visible) => setObject({ visible })}
            />
            <Check
              label="Layer locked"
              value={o.locked}
              onChange={(locked) => setObject({ locked })}
            />
            {o.owner && (
              <Check
                label="Clip to owning panel"
                value={o.clip}
                onChange={(clip) => setObject({ clip })}
              />
            )}
            {o.kind === "sfx" && (
              <>
                <label className="editor-field-label">
                  SFX text
                  <textarea
                    className="field"
                    value={o.text}
                    maxLength={10000}
                    dir={o.direction}
                    onChange={(e) => setObject({ text: e.target.value })}
                  />
                </label>
                <Choice
                  label="Lettering font"
                  value={o.font}
                  options={[
                    'Bangers, "Noto Sans", sans-serif',
                    '"Noto Sans", sans-serif',
                    '"Noto Sans KR", sans-serif',
                    '"Noto Sans JP", sans-serif',
                    '"Noto Sans Arabic", sans-serif',
                  ]}
                  onChange={(font) => setObject({ font })}
                />
                <p className="composition-hint">
                  Use Korean, Japanese or Arabic fonts for those scripts. Decorative Latin fonts use
                  script fallback.
                </p>
                <Choice
                  label="Text direction"
                  value={o.direction}
                  options={["ltr", "rtl"]}
                  onChange={(direction) => setObject({ direction: direction as Sfx["direction"] })}
                />
                <NumberField
                  label="Font size"
                  value={o.size}
                  min={1}
                  max={2000}
                  onChange={(size) => setObject({ size })}
                />
                <NumberField
                  label="Font weight"
                  value={o.weight}
                  min={100}
                  max={900}
                  step={100}
                  onChange={(weight) => setObject({ weight })}
                />
                <NumberField
                  label="Letter spacing"
                  value={o.spacing}
                  min={-100}
                  max={500}
                  step={0.5}
                  onChange={(spacing) => setObject({ spacing })}
                />
                <NumberField
                  label="Line spacing"
                  value={o.lineHeight}
                  min={0.5}
                  max={5}
                  step={0.1}
                  onChange={(lineHeight) => setObject({ lineHeight })}
                />
                <Check
                  label="Italic lettering"
                  value={o.italic}
                  onChange={(italic) => setObject({ italic })}
                />
                <Color label="Text fill" value={o.fill} onChange={(fill) => setObject({ fill })} />
                <Check
                  label="Gradient text"
                  value={o.gradient}
                  onChange={(gradient) => setObject({ gradient })}
                />
                {o.gradient && (
                  <Color
                    label="Text gradient end"
                    value={o.fill2}
                    onChange={(fill2) => setObject({ fill2 })}
                  />
                )}
                <h4>Outlines</h4>
                {o.strokes.map((stroke, index) => (
                  <div className="composition-card" key={index}>
                    <Color
                      label={`Stroke ${index + 1} color`}
                      value={stroke.color}
                      onChange={(color) =>
                        setObject({
                          strokes: o.strokes.map((s, i) => (i === index ? { ...s, color } : s)),
                        } as Partial<Sfx>)
                      }
                    />
                    <NumberField
                      label={`Stroke ${index + 1} width`}
                      value={stroke.width}
                      max={100}
                      onChange={(width) =>
                        setObject({
                          strokes: o.strokes.map((s, i) => (i === index ? { ...s, width } : s)),
                        } as Partial<Sfx>)
                      }
                    />
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setObject({
                          strokes: o.strokes.filter((_, i) => i !== index),
                        } as Partial<Sfx>)
                      }
                    >
                      Remove stroke
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  disabled={o.strokes.length >= 8}
                  onClick={() =>
                    setObject({
                      strokes: [...o.strokes, { color: "#000000", width: 3 }],
                    } as Partial<Sfx>)
                  }
                >
                  Add stroke
                </Button>
                <NumberField
                  label="Shadow radius"
                  value={o.shadow}
                  max={100}
                  onChange={(shadow) => setObject({ shadow } as Partial<Sfx>)}
                />
                <NumberField
                  label="Glow radius"
                  value={o.glow}
                  max={100}
                  onChange={(glow) => setObject({ glow } as Partial<Sfx>)}
                />
                <NumberField
                  label="Brush texture"
                  value={o.texture}
                  max={1}
                  step={0.01}
                  onChange={(texture) => setObject({ texture } as Partial<Sfx>)}
                />
                <p className="composition-hint">
                  Four-corner perspective and per-letter distortion are unavailable. Rotation, scale
                  and skew are editable and exported.
                </p>
                <Button variant="secondary" onClick={() => onPreset("sfx", o)}>
                  Save SFX preset
                </Button>
              </>
            )}
            {o.kind === "fx" && (
              <>
                {!/Blur|Bloom/.test(o.effect) && (
                  <Color
                    label="Effect color"
                    value={o.color}
                    onChange={(color) => setObject({ color } as Partial<Fx>)}
                  />
                )}
                {/Trail|Arc|Regression|Flare|Overlay|Sequence|Haze|Blackout/.test(o.effect) && (
                  <Color
                    label="Effect accent"
                    value={o.color2}
                    onChange={(color2) => setObject({ color2 } as Partial<Fx>)}
                  />
                )}
                <NumberField
                  label="Effect intensity"
                  value={o.amount}
                  max={1}
                  step={0.01}
                  onChange={(amount) => setObject({ amount } as Partial<Fx>)}
                />
                {!/Blur|Glow|Bloom|Flash|Flare|Vignette|Shadow|Aura|Overlay|Sequence|Haze|Blackout|Trail|Arc|Shockwave/.test(
                  o.effect,
                ) && (
                  <NumberField
                    label="Effect density"
                    value={o.density}
                    min={1}
                    max={500}
                    onChange={(density) => setObject({ density } as Partial<Fx>)}
                  />
                )}{" "}
                {!/Glow|Bloom|Flash|Flare|Vignette|Shadow|Aura|Overlay|Sequence|Haze|Blackout|Fog|Mist|Smoke|Snow|Dust|Particles/.test(
                  o.effect,
                ) && (
                  <NumberField
                    label="Effect direction"
                    value={o.angle}
                    min={-360}
                    max={360}
                    onChange={(angle) => setObject({ angle } as Partial<Fx>)}
                  />
                )}{" "}
                {!/Overlay|Sequence|Haze|Blackout|Regression/.test(o.effect) && (
                  <NumberField
                    label="Effect radius"
                    value={o.radius}
                    max={100}
                    onChange={(radius) => setObject({ radius } as Partial<Fx>)}
                  />
                )}{" "}
                {!/Blur|Glow|Bloom|Flash|Flare|Vignette|Shadow|Aura|Overlay|Sequence|Haze|Blackout|Trail|Arc|Shockwave/.test(
                  o.effect,
                ) && (
                  <NumberField
                    label="Random seed"
                    value={o.seed}
                    max={0xffffffff}
                    onChange={(seed) => setObject({ seed } as Partial<Fx>)}
                  />
                )}
                <Button variant="secondary" onClick={() => onPreset("fx", o)}>
                  Save FX preset
                </Button>
              </>
            )}
          </>
        ) : p ? (
          <>
            <h3>{panels.find((x) => x.id === selectedPanel)?.name}</h3>
            <p className="composition-hint">
              {session.selectedPanels.length} selected · original image preserved.
            </p>
            <Button
              variant="secondary"
              onClick={() => controller.setState({ focus: selectedPanel! })}
            >
              Edit Panel
            </Button>
            <div className="composition-two">
              <NumberField
                label="Top extension (px)"
                value={p.top.height}
                max={100000}
                onChange={(height) =>
                  setPanel(selectedPanel!, { top: { ...p.top, height } }, `top-${selectedPanel}`)
                }
              />
              <NumberField
                label="Bottom extension (px)"
                value={p.bottom.height}
                max={100000}
                onChange={(height) =>
                  setPanel(
                    selectedPanel!,
                    { bottom: { ...p.bottom, height } },
                    `bottom-${selectedPanel}`,
                  )
                }
              />
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                controller.setState({ tool: "Spacing" });
                controller.select({ kind: "space", id: selectedPanel!, slot: "bottom" });
              }}
            >
              Spacing backgrounds & batch tools
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const f = newFade();
                setPanel(selectedPanel!, { fades: [...p.fades, f] });
                controller.select({ kind: "fade", id: f.id, panelId: selectedPanel! });
                controller.setState({ tool: "Fades" });
              }}
            >
              Add bottom fade
            </Button>
            <label className="editor-field-label">
              Source layer name
              <input
                className="field"
                maxLength={200}
                value={p.name ?? panels.find((x) => x.id === selectedPanel)?.name ?? ""}
                onChange={(e) => setPanel(selectedPanel!, { name: e.target.value })}
              />
            </label>
            <Choice
              label="Source blend mode"
              value={p.blend ?? "source-over"}
              options={BLEND_MODES}
              onChange={(blend) => setPanel(selectedPanel!, { blend: blend as BlendMode })}
            />
            <Button
              variant="secondary"
              onClick={() => {
                const frame = layout(d, panels).frames.find((f) => f.panel.id === selectedPanel)!;
                const o = {
                  ...common(`${p.name ?? frame.panel.name} copy`, d.width, frame.imageHeight),
                  kind: "overlay" as const,
                  x: 0,
                  y: 0,
                  owner: selectedPanel!,
                  blobId: p.snapshot?.blobId ?? frame.panel.blobId,
                };
                controller.change((doc) => ({ ...doc, objects: [...doc.objects, o] }));
                controller.select({ kind: "object", id: o.id });
              }}
            >
              Duplicate source as overlay
            </Button>
            <NumberField
              label="Source opacity"
              value={p.opacity}
              max={1}
              step={0.01}
              onChange={(opacity) => setPanel(selectedPanel!, { opacity })}
            />
            <Check
              label="Source visible"
              value={p.visible}
              onChange={(visible) => setPanel(selectedPanel!, { visible })}
            />
            <Check
              label="Source locked"
              value={p.locked}
              onChange={(locked) => setPanel(selectedPanel!, { locked })}
            />
            <Button variant="secondary" onClick={() => onNative(selectedPanel!)}>
              Use saved Raster / dialogue draft
            </Button>
            {p.snapshot && (
              <>
                <p>Using native revision {p.snapshot.revision}.</p>
                <Button
                  variant="ghost"
                  onClick={() => setPanel(selectedPanel!, { snapshot: undefined })}
                >
                  Use accepted chapter image
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={onOverlay}>
              Add image overlay
            </Button>
          </>
        ) : (
          <>
            <h3>Composition properties</h3>
            <p>Select a panel, gap, fade or effect to edit it.</p>
            <Color
              label="Chapter background"
              value={d.background}
              onChange={(background) => controller.change((doc) => ({ ...doc, background }))}
            />
            <Check
              label="Transparent chapter"
              value={d.background === "transparent"}
              onChange={(checked) =>
                controller.change((doc) => ({
                  ...doc,
                  background: checked ? "transparent" : "#ffffff",
                }))
              }
            />
          </>
        )}
      </fieldset>
    </div>
  );
}
