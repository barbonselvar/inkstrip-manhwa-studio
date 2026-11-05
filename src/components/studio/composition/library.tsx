import { memo, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";
import {
  FADE_TYPES,
  fade,
  transitionActive,
  TRANSITION_TYPES,
  type CompositionDocument,
  type CompositionObject,
  type CompositionPreferences,
  type CompositionPreset,
  type Sfx,
  type Fx,
  type Transition,
} from "@/lib/studio/composition/model";
import {
  SFX_CATEGORIES,
  SFX_STYLES,
  FX_CATEGORIES,
  sfx,
  fx,
  common,
  effectDescription,
  unavailableStyle,
} from "@/lib/studio/composition/library";
import { reparent, objectFlags } from "@/lib/studio/composition/geometry";
import { layout } from "@/lib/studio/composition/model";
import { renderObjectThumbnail } from "@/lib/studio/composition/render";
import type { Controller, Session } from "@/lib/studio/composition/controller";
import { NumberField } from "../editor/number-field";
import { CompositionLayers } from "./layers";
import { Choice } from "./properties";
import type { Panel } from "@/lib/studio/types";
import { ArrowDown, ArrowUp, Star, Group, Ungroup, Focus } from "lucide-react";
const Thumbnail = memo(function Thumbnail({ object }: { object: CompositionObject }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    void document.fonts.ready
      .then(() => renderObjectThumbnail(object))
      .then((url) => {
        if (alive) setSrc(url);
      });
    return () => {
      alive = false;
    };
  }, [object]);
  return src ? (
    <img alt="" src={src} loading="lazy" width={180} height={100} />
  ) : (
    <span className="composition-thumbnail-loading" />
  );
});
export function CompositionLibrary({
  controller,
  session,
  document: d,
  panels,
  preferences,
  onPreferences,
  onApplyPreset,
  onOverlay,
  onDuplicate,
  onDelete,
}: {
  controller: Controller;
  session: Session;
  document: CompositionDocument;
  panels: Panel[];
  preferences: CompositionPreferences;
  onPreferences: (next: CompositionPreferences) => void;
  onApplyPreset: (preset: CompositionPreset) => void;
  onOverlay: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("All"),
    [text, setText] = useState("SWISH"),
    [favoritesOnly, setFavoritesOnly] = useState(false),
    [fadeType, setFadeType] = useState<(typeof FADE_TYPES)[number]>("Bottom Fade"),
    [transitionType, setTransitionType] =
      useState<(typeof TRANSITION_TYPES)[number]>("White Transition");
  const styleItems = useMemo(
    () => SFX_STYLES.map((style) => ({ style, object: sfx(text, style) })),
    [text],
  );
  const fxItems = useMemo(
    () =>
      Object.entries(FX_CATEGORIES).flatMap(([cat, names]) =>
        names.map((name) => ({ cat, name, object: fx(name, d.width, 500) })),
      ),
    [d.width],
  );
  const thumbs = useStudio((s) => s.thumbs),
    owner = session.selectedPanels[0] ?? panels[0]?.id;
  const insert = (object: Sfx | Fx) => {
    const y = owner ? 0 : 60;
    const next = { ...object, owner, y };
    controller.change((doc) => ({ ...doc, objects: [...doc.objects, next] }));
    controller.select({ kind: "object", id: next.id });
  };
  const move = (id: string, direction: number) => {
    const order = [...session.history.present.order],
      i = order.indexOf(id),
      target = i + direction;
    if (i < 0 || target < 0 || target >= order.length) return;
    [order[i], order[target]] = [order[target], order[i]];
    controller.reorder(order);
  };
  const favorite = (key: string) =>
    onPreferences({
      ...preferences,
      favorites: preferences.favorites.includes(key)
        ? preferences.favorites.filter((x) => x !== key)
        : [...preferences.favorites, key],
    });
  const matches = (name: string, cat: string, key: string) =>
    name.toLowerCase().includes(search.toLowerCase()) &&
    (category === "All" || category === cat) &&
    (!favoritesOnly || preferences.favorites.includes(key));
  const object =
    session.selection?.kind === "object"
      ? d.objects.find((o) => o.id === session.selection?.id)
      : undefined;
  const tool = session.tool;
  return (
    <div className="composition-library-content">
      <h3>{tool}</h3>
      {tool === "Panels" && (
        <>
          <p className="composition-hint">In reading order. Double-click a panel to focus.</p>
          <div className="composition-actions">
            <Button
              variant="ghost"
              onClick={() => controller.setState({ selectedPanels: panels.map((p) => p.id) })}
            >
              Select all
            </Button>
            <Button variant="ghost" onClick={() => controller.setState({ selectedPanels: [] })}>
              Clear
            </Button>
          </div>
          {panels.map((p, index) => (
            <div
              key={p.id}
              className={`composition-panel-card ${session.selectedPanels.includes(p.id) ? "is-selected" : ""}`}
            >
              <label className="composition-check">
                <input
                  aria-label={`Select panel ${index + 1}`}
                  type="checkbox"
                  checked={session.selectedPanels.includes(p.id)}
                  onChange={(e) =>
                    controller.setState({
                      selectedPanels: e.target.checked
                        ? [...session.selectedPanels, p.id]
                        : session.selectedPanels.filter((id) => id !== p.id),
                      selection: { kind: "panel", id: p.id },
                    })
                  }
                />
                <span>{index + 1}</span>
              </label>
              <button
                className="composition-panel-select"
                onClick={() => {
                  controller.select({ kind: "panel", id: p.id });
                  controller.setState({ selectedPanels: [p.id] });
                }}
              >
                {thumbs[p.id] && <img src={thumbs[p.id]} alt="" loading="lazy" />}
                <span>
                  {p.name}
                  <small>
                    {p.width} × {p.height}
                  </small>
                </span>
              </button>
              <div className="composition-panel-actions">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move panel ${index + 1} up`}
                  disabled={index === 0 || d.panels[p.id]?.locked}
                  onClick={() => move(p.id, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move panel ${index + 1} down`}
                  disabled={index === panels.length - 1 || d.panels[p.id]?.locked}
                  onClick={() => move(p.id, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Focus panel ${index + 1}`}
                  onClick={() => {
                    controller.setState({ focus: p.id, selectedPanels: [p.id] });
                    controller.select({ kind: "panel", id: p.id });
                  }}
                >
                  <Focus />
                </Button>
              </div>
            </div>
          ))}
        </>
      )}
      {tool === "Spacing" && (
        <>
          <p>Click a gap or choose a region.</p>
          <NumberField
            label="Default gap for new panels"
            value={d.defaultGap}
            max={100000}
            onChange={(defaultGap) => controller.change((doc) => ({ ...doc, defaultGap }))}
          />
          {owner &&
            (["top", "bottom", "after"] as const).map((slot) => (
              <Button
                key={slot}
                variant="secondary"
                onClick={() => controller.select({ kind: "space", id: owner, slot })}
              >
                {slot === "after" ? "Between panels" : `${slot} extension`} ·{" "}
                {d.panels[owner]?.[slot].height ?? 0} px
              </Button>
            ))}
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
        </>
      )}
      {tool === "Fades" && (
        <>
          <p className="composition-hint">
            Fade the selected artwork into its extension or chapter background.
          </p>
          <Choice
            label="New fade"
            value={fadeType}
            options={FADE_TYPES}
            onChange={(v) => setFadeType(v as typeof fadeType)}
          />
          <Button
            disabled={!owner || d.panels[owner]?.locked}
            onClick={() => {
              const f = fade(fadeType);
              controller.change((doc) => ({
                ...doc,
                panels: {
                  ...doc.panels,
                  [owner]: { ...doc.panels[owner], fades: [...doc.panels[owner].fades, f] },
                },
              }));
              controller.select({ kind: "fade", id: f.id, panelId: owner });
            }}
          >
            Add fade
          </Button>
          {owner &&
            d.panels[owner]?.fades.map((f) => (
              <Button
                key={f.id}
                variant="secondary"
                onClick={() => controller.select({ kind: "fade", id: f.id, panelId: owner })}
              >
                {f.name} · {f.length} px {f.visible ? "" : "(hidden)"}
              </Button>
            ))}
        </>
      )}
      {tool === "Transitions" && (
        <>
          <Choice
            label="New transition"
            value={transitionType}
            options={TRANSITION_TYPES}
            onChange={(v) => setTransitionType(v as typeof transitionType)}
          />
          <Button
            disabled={!owner || panels.findIndex((p) => p.id === owner) === panels.length - 1}
            onClick={() => {
              const next = panels[panels.findIndex((p) => p.id === owner) + 1];
              if (!next) return;
              const t: Transition = {
                id: crypto.randomUUID(),
                a: owner,
                b: next.id,
                type: transitionType,
                height: 350,
                softness: 0.6,
                opacity: 1,
                angle: 0,
                color: "#ffffff",
                visible: true,
                locked: false,
                seed: 1234,
                stops: [
                  { position: 0, opacity: 0 },
                  { position: 1, opacity: 1 },
                ],
              };
              controller.change((doc) => ({ ...doc, transitions: [...doc.transitions, t] }));
              controller.select({ kind: "transition", id: t.id });
            }}
          >
            Connect to next panel
          </Button>
          {d.transitions.map((t) => (
            <div className="composition-card" key={t.id}>
              <Button
                variant="secondary"
                onClick={() => controller.select({ kind: "transition", id: t.id })}
              >
                {t.type}
              </Button>
              {!transitionActive(t, panels) && (
                <>
                  <p role="status">Inactive: panels are no longer adjacent.</p>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const a = panels.findIndex((p) => p.id === t.a);
                      if (panels[a + 1])
                        controller.change((doc) => ({
                          ...doc,
                          transitions: doc.transitions.map((x) =>
                            x.id === t.id ? { ...x, b: panels[a + 1].id } : x,
                          ),
                        }));
                    }}
                  >
                    Reconnect to next panel
                  </Button>
                </>
              )}
            </div>
          ))}
        </>
      )}
      {(tool === "SFX Library" || tool === "Effects Library") && (
        <>
          <label className="editor-field-label">
            Search presets
            <input
              className="field"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name…"
            />
          </label>
          <Choice
            label="Preset category"
            value={category}
            options={[
              "All",
              ...Object.keys(tool === "SFX Library" ? SFX_CATEGORIES : FX_CATEGORIES),
            ]}
            onChange={setCategory}
          />
          <label className="composition-check">
            <input
              type="checkbox"
              checked={favoritesOnly}
              onChange={(e) => setFavoritesOnly(e.target.checked)}
            />
            Favorites only
          </label>
          {tool === "SFX Library" ? (
            <>
              <label className="editor-field-label">
                Custom sound effect
                <input
                  className="field"
                  value={text}
                  maxLength={10000}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <div className="composition-word-list">
                {Object.entries(SFX_CATEGORIES).flatMap(([cat, words]) =>
                  words
                    .filter((name) => matches(name, cat, `word:${name}`))
                    .map((name) => (
                      <button key={name} onClick={() => setText(name)}>
                        {name}
                      </button>
                    )),
                )}
              </div>
              <p className="composition-hint">
                Choose text, then a style to insert. Use a script-specific font in properties.
              </p>
              <div className="composition-preset-grid">
                {styleItems
                  .filter(
                    ({ style }) =>
                      !search ||
                      style.toLowerCase().includes(search.toLowerCase()) ||
                      text.toLowerCase().includes(search.toLowerCase()),
                  )
                  .filter(
                    ({ style }) => !favoritesOnly || preferences.favorites.includes(`sfx:${style}`),
                  )
                  .map(({ style, object }) => (
                    <div className="composition-preset-card" key={style}>
                      <button
                        disabled={!!unavailableStyle(style)}
                        onClick={() => insert(object)}
                        title={unavailableStyle(style) ?? `Insert ${style}`}
                      >
                        <Thumbnail object={object} />
                        <strong>{style}</strong>
                        <small>{unavailableStyle(style) ?? "Editable lettering style"}</small>
                      </button>
                      <button
                        className="composition-favorite"
                        aria-label={`Favorite ${style}`}
                        aria-pressed={preferences.favorites.includes(`sfx:${style}`)}
                        onClick={() => favorite(`sfx:${style}`)}
                      >
                        <Star />
                      </button>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <div className="composition-preset-grid">
              {fxItems
                .filter(({ name, cat }) => matches(name, cat, `fx:${name}`))
                .map(({ cat, name, object }) => (
                  <div className="composition-preset-card" key={name}>
                    <button onClick={() => insert(object)}>
                      <Thumbnail object={object} />
                      <strong>{name}</strong>
                      <small>
                        {cat} · {effectDescription(name)}
                      </small>
                    </button>
                    <button
                      className="composition-favorite"
                      aria-label={`Favorite ${name}`}
                      aria-pressed={preferences.favorites.includes(`fx:${name}`)}
                      onClick={() => favorite(`fx:${name}`)}
                    >
                      <Star />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
      {tool === "Layers" && (
        <div className="composition-actions">
          <Button
            variant="secondary"
            disabled={!object || objectFlags(object, d.objects).locked}
            onClick={() => {
              if (!object) return;
              const group = {
                ...common("Group", d.width, 1000),
                kind: "group" as const,
                x: 0,
                y: 0,
                owner: object.owner,
                parentId: object.parentId,
              };
              controller.change((doc) => ({
                ...doc,
                objects: [
                  ...doc.objects.map((o) =>
                    o.id === object.id ? { ...o, parentId: group.id } : o,
                  ),
                  group,
                ],
              }));
              controller.select({ kind: "object", id: group.id });
            }}
          >
            <Group />
            Group selected layer
          </Button>
          <Button
            variant="ghost"
            disabled={object?.kind !== "group" || objectFlags(object, d.objects).locked}
            onClick={() => {
              if (!object) return;
              controller.change((doc) => ({
                ...doc,
                objects: doc.objects
                  .filter((x) => x.id !== object.id)
                  .map((x) =>
                    x.parentId === object.id
                      ? reparent(
                          x,
                          object.parentId,
                          x.owner,
                          layout(doc, panels).frames,
                          doc.objects,
                        )
                      : x,
                  ),
              }));
              controller.select(null);
            }}
          >
            <Ungroup />
            Ungroup
          </Button>
          <Button
            variant="danger"
            disabled={!object || objectFlags(object, d.objects).locked}
            onClick={onDelete}
          >
            Delete selected layer
          </Button>
        </div>
      )}
      {tool === "Layers" && (
        <CompositionLayers
          document={d}
          panels={panels}
          controller={controller}
          onDuplicate={onDuplicate}
          onOverlay={onOverlay}
        />
      )}
      {tool === "Presets" && (
        <>
          <p className="composition-hint">
            Saved with this project and included in editable backups.
          </p>
          {preferences.presets.length === 0 && (
            <p>Use “Save preset” in properties to keep a reusable setting.</p>
          )}
          {preferences.presets.map((p) => (
            <div key={p.id} className="composition-card">
              <strong>{p.name}</strong>
              <small>{p.category}</small>
              <Button variant="secondary" onClick={() => onApplyPreset(p)}>
                Apply preset
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  onPreferences({
                    ...preferences,
                    presets: preferences.presets.filter((x) => x.id !== p.id),
                  })
                }
              >
                Delete preset
              </Button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
