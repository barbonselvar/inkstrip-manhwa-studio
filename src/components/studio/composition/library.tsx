import { useMemo, useState } from "react";
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
import { Thumbnail } from "./thumbnail";
import { FadeShapeGallery } from "./shape-gallery";
import { ManhwaGallery, AssetGallery } from "./sfx-gallery";
import type { Controller, Session } from "@/lib/studio/composition/controller";
import { NumberField } from "../editor/number-field";
import { CompositionLayers } from "./layers";
import { Choice } from "./properties";
import type { Panel } from "@/lib/studio/types";
import {
  ArrowDown,
  ArrowUp,
  Star,
  Group,
  Ungroup,
  Focus,
  Eye,
  EyeOff,
  Lock,
  Unlock,
} from "lucide-react";
import { FadeTypeGallery, TransitionGallery } from "./fx-galleries";
import { SfxExtractor } from "./extractor";
import { MANHWA_WORDS, INK_STYLES } from "@/lib/studio/composition/ink-catalog";
import { inkObject } from "@/lib/studio/composition/ink-presets";
import { space } from "@/lib/studio/composition/model";
/** Built-in spacing presets: fill + height applied to the gap after each selected panel. */
const SPACING_PRESETS = [
  { name: "No gap", height: 0, fill: "solid", color: "#ffffff" },
  { name: "Tight white · 40", height: 40, fill: "solid", color: "#ffffff" },
  { name: "Standard white · 120", height: 120, fill: "solid", color: "#ffffff" },
  { name: "Scene break · 600", height: 600, fill: "solid", color: "#ffffff" },
  { name: "Dramatic black · 400", height: 400, fill: "solid", color: "#000000" },
  { name: "Transparent · 200", height: 200, fill: "transparent", color: "#ffffff" },
  { name: "Night gradient · 500", height: 500, fill: "gradient", color: "#0b1a33" },
  { name: "Blurred edge · 300", height: 300, fill: "blur", color: "#ffffff" },
] as const;
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
  onAssetImport,
  onExtractSave,
  tool,
}: {
  tool: string;
  onExtractSave: (
    blob: Blob,
    name: string,
    collection: string,
    width: number,
    height: number,
    place: boolean,
  ) => Promise<void>;
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
  onAssetImport: () => void;
}) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("All"),
    [text, setText] = useState("SWISH"),
    [favoritesOnly, setFavoritesOnly] = useState(false);
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
  const insert = (object: CompositionObject) => {
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
  const [dragPanel, setDragPanel] = useState<string | null>(null),
    [dropPanel, setDropPanel] = useState<string | null>(null);
  const setPanelFlag = (id: string, patch: { visible?: boolean; locked?: boolean }) =>
    controller.change((doc) => ({
      ...doc,
      panels: { ...doc.panels, [id]: { ...doc.panels[id], ...patch } },
    }));
  const presetList = (categories: CompositionPreset["category"][], title = "Saved presets") => {
    const items = preferences.presets.filter((p) => categories.includes(p.category));
    if (!items.length) return null;
    return (
      <>
        <h4>{title}</h4>
        {items.map((p) => (
          <div key={p.id} className="composition-card">
            <strong>{p.name}</strong>
            <small>{p.category}</small>
            <Button variant="secondary" onClick={() => onApplyPreset(p)}>
              Apply preset
            </Button>
            <Button
              variant="ghost"
              aria-label={`Delete preset ${p.name}`}
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
    );
  };
  const addFade = (type: (typeof FADE_TYPES)[number]) => {
    if (!owner || d.panels[owner]?.locked) return;
    const f = fade(type);
    controller.change((doc) => ({
      ...doc,
      panels: {
        ...doc.panels,
        [owner]: { ...doc.panels[owner], fades: [...doc.panels[owner].fades, f] },
      },
    }));
    controller.select({ kind: "fade", id: f.id, panelId: owner });
  };
  const addTransition = (type: (typeof TRANSITION_TYPES)[number]) => {
    const next = panels[panels.findIndex((p) => p.id === owner) + 1];
    if (!owner || !next) return;
    const t: Transition = {
      id: crypto.randomUUID(),
      a: owner,
      b: next.id,
      type,
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
  };
  type FavoriteItem = {
    key: string;
    label: string;
    detail: string;
    object: CompositionObject;
    preset?: CompositionPreset;
  };
  const favoriteItems = preferences.favorites.flatMap((key): FavoriteItem[] => {
    const [kind, ...rest] = key.split(":"),
      name = rest.join(":");
    if (kind === "sfx" && SFX_STYLES.includes(name as never))
      return [{ key, label: name, detail: "Lettering style", object: sfx(text, name) }];
    if (kind === "fx")
      return [{ key, label: name, detail: "Effect", object: fx(name, d.width, 500) }];
    if (kind === "manhwa") {
      const word = MANHWA_WORDS.find((w) => w[0] === name);
      if (word)
        return [{ key, label: name, detail: word[1], object: inkObject(word[1], INK_STYLES[0]) }];
    }
    if (kind === "asset") {
      const preset = preferences.presets.find((p) => p.id === name && p.category === "asset");
      if (preset)
        return [
          {
            key,
            label: preset.name,
            detail: preset.collection ?? "Asset",
            object: preset.value as CompositionObject,
            preset,
          },
        ];
    }
    return [];
  });
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
          <p className="composition-hint">Drag a card to reorder; arrows work on touch.</p>
          {panels.map((p, index) => (
            <div
              key={p.id}
              draggable={!d.panels[p.id]?.locked}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-inkstrip-panel", p.id);
                e.dataTransfer.effectAllowed = "move";
                setDragPanel(p.id);
              }}
              onDragOver={(e) => {
                if (dragPanel && dragPanel !== p.id) {
                  e.preventDefault();
                  setDropPanel(p.id);
                }
              }}
              onDragLeave={() => setDropPanel((x) => (x === p.id ? null : x))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("application/x-inkstrip-panel") || dragPanel;
                setDragPanel(null);
                setDropPanel(null);
                if (!id || id === p.id) return;
                const order = session.history.present.order.filter((x) => x !== id);
                order.splice(
                  order.indexOf(p.id) + (index > panels.findIndex((x) => x.id === id) ? 1 : 0),
                  0,
                  id,
                );
                controller.reorder(order);
              }}
              onDragEnd={() => {
                setDragPanel(null);
                setDropPanel(null);
              }}
              data-panel-card={p.id}
              className={`composition-panel-card ${session.selectedPanels.includes(p.id) ? "is-selected" : ""} ${dropPanel === p.id ? "is-drop-target" : ""}`}
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
                  aria-label={`${d.panels[p.id]?.visible === false ? "Show" : "Hide"} panel ${index + 1}`}
                  aria-pressed={d.panels[p.id]?.visible === false}
                  onClick={() => setPanelFlag(p.id, { visible: d.panels[p.id]?.visible === false })}
                >
                  {d.panels[p.id]?.visible === false ? <EyeOff /> : <Eye />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${d.panels[p.id]?.locked ? "Unlock" : "Lock"} panel ${index + 1}`}
                  aria-pressed={!!d.panels[p.id]?.locked}
                  onClick={() => setPanelFlag(p.id, { locked: !d.panels[p.id]?.locked })}
                >
                  {d.panels[p.id]?.locked ? <Lock /> : <Unlock />}
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
          <h4>Quick gaps</h4>
          <p className="composition-hint">
            Applies to the gap after{" "}
            {session.selectedPanels.length > 1
              ? `${session.selectedPanels.length} selected panels`
              : "the selected panel"}{" "}
            in one undo step.
          </p>
          <div className="composition-swatch-row">
            {SPACING_PRESETS.map((preset) => (
              <button
                key={preset.name}
                disabled={!owner}
                onClick={() => {
                  const ids = (
                    session.selectedPanels.length ? session.selectedPanels : [owner]
                  ).filter((id) => id && id !== panels.at(-1)?.id && !d.panels[id]?.locked);
                  controller.change((doc) => ({
                    ...doc,
                    panels: {
                      ...doc.panels,
                      ...Object.fromEntries(
                        ids.map((id) => [
                          id,
                          {
                            ...doc.panels[id],
                            after: {
                              ...doc.panels[id].after,
                              ...space(preset.height, preset.color),
                              fill: preset.fill,
                              color2:
                                preset.fill === "gradient"
                                  ? "#000000"
                                  : doc.panels[id].after.color2,
                            },
                          },
                        ]),
                      ),
                    },
                  }));
                  if (ids[0]) controller.select({ kind: "space", id: ids[0], slot: "after" });
                }}
              >
                <i
                  style={
                    preset.fill === "transparent"
                      ? undefined
                      : preset.fill === "gradient"
                        ? { background: `linear-gradient(${preset.color}, #000000)` }
                        : preset.fill === "blur"
                          ? { background: "linear-gradient(#bbb, #fff)", filter: "blur(1px)" }
                          : { background: preset.color }
                  }
                />
                {preset.name}
              </button>
            ))}
          </div>
          {presetList(["spacing"])}
        </>
      )}
      {tool === "Fades" && (
        <>
          <p className="composition-hint">
            Fade the selected artwork into its extension or chapter background.
          </p>
          <FadeTypeGallery disabled={!owner || d.panels[owner]?.locked} onPick={addFade} />
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
          {presetList(["fade"])}
        </>
      )}
      {tool === "Transitions" && (
        <>
          <p className="composition-hint">
            Choose a transition to connect the selected panel to the next one.
          </p>
          <TransitionGallery
            disabled={!owner || panels.findIndex((p) => p.id === owner) === panels.length - 1}
            onPick={addTransition}
          />
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
          {presetList(["transition"])}
        </>
      )}
      {tool === "Built-in SFX" && (
        <ManhwaGallery insert={insert} favorites={preferences.favorites} onFavorite={favorite} />
      )}
      {tool === "Built-in SFX" && <h4>Classic lettering styles</h4>}
      {(tool === "Built-in SFX" || tool === "Effects Library") && (
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
              ...Object.keys(tool === "Built-in SFX" ? SFX_CATEGORIES : FX_CATEGORIES),
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
          {tool === "Built-in SFX" ? (
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
      {tool === "Effects Library" && presetList(["fx"])}
      {tool === "Fade Shapes" && <FadeShapeGallery controller={controller} owner={owner} />}
      {tool === "Fade Shapes" && presetList(["fade"])}
      {tool === "My Assets" && (
        <>
          <AssetGallery
            presets={preferences.presets}
            insert={onApplyPreset}
            onImport={onAssetImport}
            favorites={preferences.favorites}
            onFavorite={favorite}
          />
          {presetList(["sfx"], "Saved SFX lettering")}
        </>
      )}
      {tool === "Import" && (
        <>
          <p className="composition-hint">
            Bring finished SFX artwork into this project&apos;s library: transparent PNG, WebP or
            sanitized SVG. To cut lettering out of a page or panel, use Extract.
          </p>
          <Button variant="secondary" onClick={onAssetImport}>
            Import SFX artwork
          </Button>
          <Button variant="ghost" onClick={onOverlay}>
            Place an image overlay without saving it
          </Button>
        </>
      )}
      {tool === "Extract" && <SfxExtractor panels={panels} onSave={onExtractSave} />}
      {tool === "Favorites" && (
        <>
          <p className="composition-hint">
            Star lettering, styles, effects and assets in the other tabs to pin them here.
          </p>
          {!favoriteItems.length && <p>No favorites yet.</p>}
          <div className="composition-preset-grid">
            {favoriteItems.map((item) => (
              <div className="composition-preset-card" key={item.key}>
                <button
                  onClick={() =>
                    "preset" in item && item.preset
                      ? onApplyPreset(item.preset)
                      : insert(item.object)
                  }
                >
                  <Thumbnail object={item.object} />
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </button>
                <button
                  className="composition-favorite"
                  aria-label={`Remove favorite ${item.label}`}
                  aria-pressed
                  onClick={() => favorite(item.key)}
                >
                  <Star />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {tool === "Overlays & Sources" && (
        <>
          <p className="composition-hint">
            Source artwork stays unchanged. Lock, hide or fade a source here; select a panel for
            opacity, blend and saved native drafts in Properties.
          </p>
          <Button variant="secondary" onClick={onOverlay}>
            Add image overlay
          </Button>
          {panels.map((p, index) => (
            <div className="composition-card" key={p.id}>
              <strong>
                {index + 1} · {p.name}
              </strong>
              <small>
                Opacity {Math.round((d.panels[p.id]?.opacity ?? 1) * 100)}% ·{" "}
                {d.panels[p.id]?.snapshot ? "native draft" : "accepted image"}
              </small>
              <div className="composition-actions">
                <Button
                  variant="ghost"
                  onClick={() => setPanelFlag(p.id, { visible: d.panels[p.id]?.visible === false })}
                >
                  {d.panels[p.id]?.visible === false ? "Show source" : "Hide source"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setPanelFlag(p.id, { locked: !d.panels[p.id]?.locked })}
                >
                  {d.panels[p.id]?.locked ? "Unlock source" : "Lock source"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    controller.select({ kind: "panel", id: p.id });
                    controller.setState({ selectedPanels: [p.id] });
                  }}
                >
                  Source properties
                </Button>
              </div>
            </div>
          ))}
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
      {tool === "All presets" && (
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
