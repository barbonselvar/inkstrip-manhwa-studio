import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Controller, Session } from "@/lib/studio/composition/controller";
import {
  layout,
  type CompositionDocument,
  type CompositionObject,
  type CompositionPreferences,
  type CompositionPreset,
} from "@/lib/studio/composition/model";
import { objectBounds, objectMatrix } from "@/lib/studio/composition/geometry";
import { applyMatrix } from "@/lib/studio/pro/transform";
import {
  placeBubble,
  BUBBLE_CATEGORIES,
  BUBBLE_PRESETS,
  bubble as newBubble,
  applyStyle,
  TEXT_STYLE_KEYS,
} from "@/lib/studio/composition/bubble-presets";
import type { Bubble } from "@/lib/studio/composition/bubble";
import { renderRegion, RenderResources } from "@/lib/studio/composition/render";
import { detailGrid, suggestPlacements, type Rect } from "@/lib/studio/composition/placement";
import { getImageBlob } from "@/lib/studio/db";
import { detectFaces } from "@/lib/studio/faces/client";
import type { Panel } from "@/lib/studio/types";
import { Thumbnail } from "./thumbnail";
import { Check, Choice } from "./properties";
import { CompositionLayers } from "./layers";
import { Star, Sparkles, X, Crosshair } from "lucide-react";

export function LetteringTools({
  tool,
  controller,
  session,
  document: d,
  panels,
  preferences,
  onPreferences,
  onApplyPreset,
  onDuplicate,
  onOverlay,
  legacy,
  onError,
}: {
  tool: string;
  controller: Controller;
  session: Session;
  document: CompositionDocument;
  panels: Panel[];
  preferences: CompositionPreferences;
  onPreferences: (next: CompositionPreferences) => void;
  onApplyPreset: (preset: CompositionPreset) => void;
  onDuplicate: () => void;
  onOverlay: () => void;
  legacy?: ReactNode;
  onError: (message: string) => void;
}) {
  const [category, setCategory] = useState<string>("All"),
    [placementPreset, setPlacementPreset] = useState("Standard dialogue"),
    [avoidFaces, setAvoidFaces] = useState(true),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("");
  const job = useRef<AbortController | null>(null);
  const owner = session.focus ?? session.selectedPanels[0] ?? panels[0]?.id;
  const items = useMemo(() => BUBBLE_PRESETS.map((p) => ({ preset: p, object: newBubble(p) })), []);
  const selected = d.objects.find(
    (o): o is Bubble => o.id === session.selection?.id && o.kind === "bubble",
  );
  const favorite = (key: string) =>
    onPreferences({
      ...preferences,
      favorites: preferences.favorites.includes(key)
        ? preferences.favorites.filter((x) => x !== key)
        : [...preferences.favorites, key],
    });
  const insert = (b: Bubble) => {
    const next = placeBubble(d, panels, { ...b, id: crypto.randomUUID() }, owner);
    controller.change((doc) => ({ ...doc, objects: [...doc.objects, next] }));
    controller.select({ kind: "object", id: next.id });
  };
  const frames = useMemo(() => layout(d, panels).frames, [d, panels]);
  const dialogue = useMemo(
    () =>
      d.objects
        .filter((o): o is Bubble => o.kind === "bubble")
        .map((o) => ({ o, b: objectBounds(o, frames, d.objects) }))
        .sort((a, b) => a.b.y - b.b.y || a.b.x - b.b.x),
    [d.objects, frames],
  );
  const reveal = (o: CompositionObject) => {
    controller.setState({ focus: null, selection: { kind: "object", id: o.id } });
    requestAnimationFrame(() => {
      const viewport = document.querySelector<HTMLElement>(".composition-viewport");
      if (!viewport) return;
      const b = objectBounds(o, layout(d, panels).frames, d.objects),
        scale = Math.max(0.05, (viewport.clientWidth - 32) / d.width) * session.zoom;
      viewport.scrollTop = Math.max(0, b.y * scale - viewport.clientHeight / 3);
    });
  };
  const analyze = async () => {
    const frame = frames.find((f) => f.panel.id === owner);
    if (!frame) {
      onError("Select a panel to analyze.");
      return;
    }
    job.current?.abort();
    const abort = new AbortController();
    job.current = abort;
    setBusy(true);
    setStatus("Analyzing artwork…");
    const resources = new RenderResources();
    try {
      const region = { x: 0, y: frame.top, width: d.width, height: frame.end - frame.top };
      const bubbleIds = new Set(d.objects.filter((o) => o.kind === "bubble").map((o) => o.id));
      const sampleWidth = 200,
        image = await renderRegion(
          d,
          panels,
          { y: region.y, height: region.height },
          sampleWidth,
          resources,
          { signal: abort.signal, excluded: bubbleIds },
        );
      const ctx = image.getContext("2d")!,
        pixels = ctx.getImageData(0, 0, image.width, image.height);
      const grid = detailGrid(pixels.data, image.width, image.height, region, 4);
      image.width = image.height = 0;
      let faces: Rect[] = [];
      if (avoidFaces) {
        setStatus("Looking for faces on this device…");
        const blob = await getImageBlob(frame.settings.snapshot?.blobId ?? frame.panel.blobId);
        if (blob)
          faces = (
            await detectFaces(blob, abort.signal, (label) => setStatus(label)).catch(() => [])
          ).map((f) => ({
            x: f.x * d.width,
            y: frame.imageY + f.y * frame.imageHeight,
            width: f.width * d.width,
            height: f.height * frame.imageHeight,
          }));
      }
      const occupied = d.objects
        .filter((o) => o.visible && (o.kind === "bubble" || o.kind === "sfx"))
        .map((o) => {
          // Include tails, which extend beyond the bubble box.
          const b = objectBounds(o, frames, d.objects);
          if (o.kind !== "bubble" || !o.tails.length) return b;
          const m = objectMatrix(o, frames, d.objects),
            tips = o.tails.map((t) => applyMatrix(m, t.tip)),
            x0 = Math.min(b.x, ...tips.map((p) => p.x)),
            y0 = Math.min(b.y, ...tips.map((p) => p.y)),
            x1 = Math.max(b.x + b.width, ...tips.map((p) => p.x)),
            y1 = Math.max(b.y + b.height, ...tips.map((p) => p.y));
          return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        })
        .filter((b) => b.y + b.height > region.y && b.y < region.y + region.height);
      const sample = newBubble(placementPreset);
      const found = suggestPlacements(
        grid,
        { width: sample.width, height: sample.height },
        { faces, occupied, rtl: sample.direction === "rtl" },
      );
      controller.setState({
        suggestions: found.map((r) => ({
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          reason: r.reason,
          preset: placementPreset,
        })),
      });
      setStatus(
        found.length
          ? `${found.length} suggestions · ${faces.length} face${faces.length === 1 ? "" : "s"} avoided. Nothing was moved.`
          : "No space fits this bubble here. Try a smaller preset or a spacing region.",
      );
    } catch (error) {
      if (!abort.signal.aborted)
        setStatus(error instanceof Error ? error.message : "Analysis failed.");
    } finally {
      resources.clear();
      if (job.current === abort) job.current = null;
      setBusy(false);
    }
  };
  const savedStyles = preferences.presets.filter((p) => p.category === "bubble");
  return (
    <div className="composition-library-content">
      <h3>{tool}</h3>
      {tool === "Bubbles" && (
        <>
          <p className="composition-hint">
            Click to add to the selected panel, or drag a bubble anywhere in the chapter — including
            gaps and extensions. Double-click a bubble to type.
          </p>
          <div className="composition-subtabs" role="tablist" aria-label="Bubble categories">
            {["All", "Favorites", ...BUBBLE_CATEGORIES].map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="composition-preset-grid">
            {items
              .filter(
                ({ preset }) =>
                  category === "All" ||
                  preset.category === category ||
                  (category === "Favorites" &&
                    preferences.favorites.includes(`bubble:${preset.name}`)),
              )
              .map(({ preset, object }) => (
                <div className="composition-preset-card" key={preset.name}>
                  <button
                    draggable
                    aria-label={`Add ${preset.name} bubble`}
                    onDragStart={(e) =>
                      e.dataTransfer.setData(
                        "application/x-inkstrip-composition",
                        JSON.stringify({ kind: "bubble", preset: preset.name }),
                      )
                    }
                    onClick={() => insert(newBubble(preset))}
                  >
                    <Thumbnail object={object} />
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </button>
                  <button
                    className="composition-favorite"
                    aria-label={`Favorite ${preset.name}`}
                    aria-pressed={preferences.favorites.includes(`bubble:${preset.name}`)}
                    onClick={() => favorite(`bubble:${preset.name}`)}
                  >
                    <Star />
                  </button>
                </div>
              ))}
          </div>
          {savedStyles.length > 0 && <h4>My bubble &amp; text styles</h4>}
          <div className="composition-preset-grid">
            {savedStyles.map((p) => (
              <div className="composition-preset-card" key={p.id}>
                <button
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      "application/x-inkstrip-composition",
                      JSON.stringify({ kind: "bubble", id: p.id }),
                    )
                  }
                  onClick={() => onApplyPreset(p)}
                  title={
                    selected
                      ? "Apply to the selected bubble"
                      : "Insert a new bubble with this style"
                  }
                >
                  <Thumbnail object={p.value as Bubble} />
                  <strong>{p.name}</strong>
                  <small>
                    {p.collection ?? "Style"} · {selected ? "apply to selection" : "insert"}
                  </small>
                </button>
                <button
                  className="composition-favorite"
                  aria-label={`Delete style ${p.name}`}
                  onClick={() =>
                    onPreferences({
                      ...preferences,
                      presets: preferences.presets.filter((x) => x.id !== p.id),
                    })
                  }
                >
                  <X />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {tool === "Text" && (
        <>
          <p className="composition-hint">
            Free lettering without a balloon, and script-ready presets. Korean, Japanese (including
            vertical), Arabic right-to-left and other Unicode text are shaped by the browser&apos;s
            text engine with bundled Noto fonts.
          </p>
          <div className="composition-preset-grid">
            {items
              .filter(({ preset }) => preset.category === "Text" || preset.category === "Narration")
              .map(({ preset, object }) => (
                <div className="composition-preset-card" key={preset.name}>
                  <button
                    draggable
                    aria-label={`Add ${preset.name} text`}
                    onDragStart={(e) =>
                      e.dataTransfer.setData(
                        "application/x-inkstrip-composition",
                        JSON.stringify({ kind: "bubble", preset: preset.name }),
                      )
                    }
                    onClick={() => insert(newBubble(preset))}
                  >
                    <Thumbnail object={object} />
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </button>
                </div>
              ))}
          </div>
          <h4>Batch typography</h4>
          <p className="composition-hint">
            {selected
              ? `Copies the font, size, color and outline of “${selected.name}”.`
              : "Select a bubble to use its typography as the source."}
          </p>
          <Button
            variant="secondary"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              controller.change((doc) => ({
                ...doc,
                objects: doc.objects.map((o) =>
                  o.kind === "bubble" && o.id !== selected.id && !o.locked
                    ? applyStyle(o, selected, TEXT_STYLE_KEYS)
                    : o,
                ),
              }));
            }}
          >
            Apply text style to every bubble in the chapter
          </Button>
        </>
      )}
      {tool === "Dialogue" && (
        <>
          <p className="composition-hint">
            Every bubble in reading order across the whole chapter. Edit text here or on the canvas.
          </p>
          <label className="editor-field-label">
            Filter dialogue
            <input
              className="field"
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          {!dialogue.length && <p>No bubbles yet. Add one from Bubbles.</p>}
          <div className="composition-dialogue-list">
            {dialogue
              .filter(({ o }) => o.text.toLowerCase().includes(filter.toLowerCase()))
              .map(({ o }, i) => {
                const panelIndex = panels.findIndex((p) => p.id === o.owner);
                return (
                  <div
                    key={o.id}
                    className={`composition-dialogue-item ${session.selection?.id === o.id ? "is-selected" : ""}`}
                  >
                    <header>
                      <span>
                        {i + 1}. {o.preset ?? o.name} ·{" "}
                        {panelIndex >= 0 ? `panel ${panelIndex + 1}` : "chapter"}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Show bubble ${i + 1} on canvas`}
                        onClick={() => reveal(o)}
                      >
                        <Crosshair />
                      </Button>
                    </header>
                    <textarea
                      className="field"
                      dir="auto"
                      aria-label={`Bubble ${i + 1} text`}
                      value={o.text}
                      disabled={o.locked}
                      maxLength={10000}
                      onFocus={() =>
                        controller.setState({ selection: { kind: "object", id: o.id } })
                      }
                      onChange={(e) => {
                        const text = e.target.value;
                        controller.change(
                          (doc) => ({
                            ...doc,
                            objects: doc.objects.map((x) => (x.id === o.id ? { ...x, text } : x)),
                          }),
                          `object-${o.id}-text`,
                        );
                      }}
                    />
                  </div>
                );
              })}
          </div>
        </>
      )}
      {tool === "Smart placement" && (
        <>
          <p className="composition-hint">
            Suggests open, readable spots in the selected panel and its spacing: low-detail areas
            first, away from detected faces and existing lettering, following reading order.
            Suggestions are only outlines — nothing moves until you place one.
          </p>
          <p>
            Panel: <strong>{panels.find((p) => p.id === owner)?.name ?? "none selected"}</strong>
          </p>
          <Choice
            label="Bubble to place"
            value={placementPreset}
            options={BUBBLE_PRESETS.map((p) => p.name)}
            onChange={setPlacementPreset}
          />
          <Check
            label="Avoid faces (on-device detector)"
            value={avoidFaces}
            onChange={setAvoidFaces}
          />
          <div className="composition-actions">
            <Button disabled={busy || !owner} onClick={() => void analyze()}>
              <Sparkles />
              Suggest positions
            </Button>
            {!!session.suggestions?.length && (
              <Button variant="ghost" onClick={() => controller.setState({ suggestions: [] })}>
                Clear suggestions
              </Button>
            )}
          </div>
          {status && <p role="status">{status}</p>}
          <p className="composition-hint">
            Detection is heuristic. Always check that faces and key artwork stay visible.
          </p>
        </>
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
      {tool === "Panel documents" && (
        <>
          <p className="composition-hint">
            Per-panel native dialogue documents with OCR, cleanup and translation review. They stay
            available alongside chapter lettering.
          </p>
          {legacy}
        </>
      )}
    </div>
  );
}
