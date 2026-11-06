import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { MANHWA_WORDS, INK_STYLES } from "@/lib/studio/composition/ink-catalog";
import { inkObject } from "@/lib/studio/composition/ink-presets";
import type { CompositionPreset, CompositionObject } from "@/lib/studio/composition/model";
import { Thumbnail } from "./thumbnail";
import { Choice } from "./properties";
export function ManhwaGallery({ insert }: { insert: (o: CompositionObject) => void }) {
  const [language, setLanguage] = useState("Hangul"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(0);
  const word = MANHWA_WORDS[selected],
    text = word[language === "Hangul" ? 1 : 2];
  const styles = useMemo(
    () => INK_STYLES.map((style) => ({ style, object: inkObject(text, style) })),
    [text],
  );
  return (
    <>
      <p className="composition-hint">
        Original angular vector lettering. Click to insert, or drag a card onto the chapter. Text
        stays editable.
      </p>
      <Choice
        label="SFX language"
        value={language}
        options={["Hangul", "English"]}
        onChange={setLanguage}
      />
      <label className="editor-field-label">
        Find an action
        <input
          className="field"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="composition-preset-grid">
        {MANHWA_WORDS.map((word, i) => ({
          word,
          i,
          object: inkObject(word[language === "Hangul" ? 1 : 2], INK_STYLES[0]),
        }))
          .filter(({ word }) => word.join(" ").toLowerCase().includes(search.toLowerCase()))
          .map(({ word, i, object }) => (
            <button
              className="composition-shape-card"
              key={word[0]}
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData(
                  "application/x-inkstrip-composition",
                  JSON.stringify({
                    kind: "manhwa",
                    index: i,
                    style: INK_STYLES[0],
                    english: language === "English",
                  }),
                )
              }
              onClick={() => {
                setSelected(i);
                insert(object);
              }}
            >
              <Thumbnail object={object} />
              <strong>{word[0]}</strong>
              <small>
                {word[1]} · {word[2]}
              </small>
            </button>
          ))}
      </div>
      <h4>Lettering styles · {text}</h4>
      <div className="composition-preset-grid">
        {styles.map(({ style, object }) => (
          <button
            className="composition-shape-card"
            key={style}
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData(
                "application/x-inkstrip-composition",
                JSON.stringify({
                  kind: "manhwa",
                  index: selected,
                  style,
                  english: language === "English",
                }),
              )
            }
            onClick={() => insert(object)}
          >
            <Thumbnail object={object} />
            <strong>{style}</strong>
            <small>Original vector geometry</small>
          </button>
        ))}
      </div>
    </>
  );
}
export function AssetGallery({
  presets,
  insert,
  onImport,
}: {
  presets: CompositionPreset[];
  insert: (p: CompositionPreset) => void;
  onImport: () => void;
}) {
  const [category, setCategory] = useState("All"),
    [search, setSearch] = useState("");
  const assets = presets.filter((p) => p.category === "asset"),
    categories = ["All", ...new Set(assets.map((p) => p.collection ?? "Custom"))];
  return (
    <>
      <Button variant="secondary" onClick={onImport}>
        Import SFX artwork
      </Button>
      <p className="composition-hint">
        Transparent PNG, WebP and sanitized SVG. Assets are saved with this project and can be
        reused in any chapter.
      </p>
      <Choice label="Asset category" value={category} options={categories} onChange={setCategory} />
      <label className="editor-field-label">
        Search assets
        <input
          className="field"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="composition-preset-grid">
        {assets
          .filter(
            (p) =>
              (category === "All" || (p.collection ?? "Custom") === category) &&
              p.name.toLowerCase().includes(search.toLowerCase()),
          )
          .map((p) => (
            <button
              className="composition-shape-card"
              key={p.id}
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData(
                  "application/x-inkstrip-composition",
                  JSON.stringify({ kind: "asset", id: p.id }),
                )
              }
              onClick={() => insert(p)}
            >
              <Thumbnail object={p.value as CompositionObject} />
              <strong>{p.name}</strong>
              <small>{p.collection ?? "Custom"} · reusable artwork</small>
            </button>
          ))}
      </div>
      {!assets.length && (
        <p className="composition-hint">
          Import your first sound-effect asset. Its transparency and original chapter images stay
          intact.
        </p>
      )}
    </>
  );
}
