import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { NumberField } from "../editor/number-field";
import {
  BUBBLE_FONTS,
  BUBBLE_LANGUAGES,
  BUBBLE_SHAPES,
  TAIL_STYLES,
  detectDirection,
  detectLanguage,
  fontForLanguage,
  type Bubble,
  type BubbleTail,
} from "@/lib/studio/composition/bubble";
import {
  bubble as newBubble,
  applyStyle,
  BUBBLE_STYLE_KEYS,
  TEXT_STYLE_KEYS,
} from "@/lib/studio/composition/bubble-presets";
import { Check, Choice, Color } from "./properties";
import { Thumbnail } from "./thumbnail";
import { Plus, Trash2, Wand2, AlignLeft, AlignCenter, AlignRight } from "lucide-react";

const LANGUAGE_LABELS: Record<(typeof BUBBLE_LANGUAGES)[number], string> = {
  en: "English / Latin",
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese",
  ar: "Arabic",
  other: "Other Unicode",
};
let styleClipboard: Bubble | null = null;

export function BubbleProperties({
  bubble: b,
  onChange,
  onSaveStyle,
}: {
  bubble: Bubble;
  onChange: (patch: Partial<Bubble>) => void;
  onSaveStyle: (kind: "Bubble style" | "Text style", value: Bubble) => void;
}) {
  const shapes = useMemo(
    () =>
      BUBBLE_SHAPES.map((shape) => ({
        shape,
        object: {
          ...newBubble("Standard dialogue", 200, 120),
          id: `shape-${shape}`,
          shape,
          spikes: shape === "Electronic" ? 24 : 16,
          roughness: shape === "Wobbly" ? 0.5 : 0,
          tails: [],
          text: shape === "None" ? "Text" : "",
          textStroke: "#000000",
          textStrokeWidth: shape === "None" ? 3 : 0,
          textColor: shape === "None" ? "#ffffff" : "#111111",
        } as Bubble,
      })),
    [],
  );
  const setTail = (id: string, patch: Partial<BubbleTail>) =>
    onChange({ tails: b.tails.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const vertical = b.language === "ja" || b.language === "zh" || b.language === "ko";
  const spiky = ["Burst", "Jagged", "Scream", "Cloud", "Electronic"].includes(b.shape);
  return (
    <div className="composition-bubble-properties">
      <label className="editor-field-label">
        Dialogue text
        <textarea
          className="field"
          aria-label="Dialogue text"
          dir="auto"
          rows={3}
          value={b.text}
          maxLength={10000}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      </label>
      <Button
        variant="ghost"
        onClick={() => {
          const language = detectLanguage(b.text);
          onChange({
            language,
            direction: detectDirection(b.text),
            font: fontForLanguage(language),
            writing: language === "ja" || language === "zh" ? b.writing : "horizontal",
          });
        }}
      >
        <Wand2 />
        Match font &amp; direction to script
      </Button>
      <details open>
        <summary>Typography</summary>
        <div className="composition-font-gallery" role="group" aria-label="Font">
          {BUBBLE_FONTS.map((f) => (
            <button
              key={f.family}
              aria-pressed={b.font === f.family}
              onClick={() => onChange({ font: f.family })}
            >
              <span style={{ fontFamily: `"${f.family}", ${f.family}, sans-serif` }}>
                {b.text.trim() ? b.text.slice(0, 22) : f.sample}
              </span>
              <small>{f.label}</small>
            </button>
          ))}
        </div>
        <div className="composition-two">
          <NumberField
            label="Font size"
            value={b.size}
            min={4}
            max={2000}
            onChange={(size) => onChange({ size })}
          />
          <NumberField
            label="Font weight"
            value={b.weight}
            min={100}
            max={900}
            step={100}
            onChange={(weight) => onChange({ weight })}
          />
          <NumberField
            label="Letter spacing"
            value={b.letterSpacing}
            min={-100}
            max={500}
            step={0.5}
            onChange={(letterSpacing) => onChange({ letterSpacing })}
          />
          <NumberField
            label="Line spacing"
            value={b.lineHeight}
            min={0.5}
            max={5}
            step={0.05}
            onChange={(lineHeight) => onChange({ lineHeight })}
          />
        </div>
        <div className="composition-segmented" role="group" aria-label="Text alignment">
          {(
            [
              ["left", AlignLeft],
              ["center", AlignCenter],
              ["right", AlignRight],
            ] as const
          ).map(([align, Icon]) => (
            <button
              key={align}
              aria-label={`Align text ${align}`}
              aria-pressed={b.align === align}
              onClick={() => onChange({ align })}
            >
              <Icon className="mx-auto size-4" />
            </button>
          ))}
        </div>
        <Color
          label="Text color"
          value={b.textColor}
          onChange={(textColor) => onChange({ textColor })}
        />
        <Check label="Italic" value={b.italic} onChange={(italic) => onChange({ italic })} />
        <Check
          label="Shrink text to fit bubble"
          value={b.fit}
          onChange={(fit) => onChange({ fit })}
        />
        <Choice
          label="Language"
          value={LANGUAGE_LABELS[b.language]}
          options={BUBBLE_LANGUAGES.map((l) => LANGUAGE_LABELS[l])}
          onChange={(label) => {
            const language = BUBBLE_LANGUAGES.find((l) => LANGUAGE_LABELS[l] === label)!;
            onChange({
              language,
              writing: ["ja", "zh", "ko"].includes(language) ? b.writing : "horizontal",
              direction: language === "ar" ? "rtl" : b.direction,
            });
          }}
        />
        <Choice
          label="Text direction"
          value={b.direction === "rtl" ? "Right to left" : "Left to right"}
          options={["Left to right", "Right to left"]}
          onChange={(v) => onChange({ direction: v === "Right to left" ? "rtl" : "ltr" })}
        />
        <Choice
          label="Writing mode"
          value={b.writing === "vertical" ? "Vertical (columns)" : "Horizontal"}
          options={vertical ? ["Horizontal", "Vertical (columns)"] : ["Horizontal"]}
          onChange={(v) => onChange({ writing: v === "Horizontal" ? "horizontal" : "vertical" })}
        />
        {!vertical && (
          <p className="composition-hint">
            Vertical columns are available for Japanese, Chinese and Korean text.
          </p>
        )}
        <div className="composition-two">
          <Color
            label="Text outline"
            value={b.textStroke}
            onChange={(textStroke) => onChange({ textStroke })}
          />
          <NumberField
            label="Outline width"
            value={b.textStrokeWidth}
            max={100}
            step={0.5}
            onChange={(textStrokeWidth) => onChange({ textStrokeWidth })}
          />
        </div>
        <NumberField
          label="Text shadow"
          value={b.textShadow}
          max={100}
          onChange={(textShadow) => onChange({ textShadow })}
        />
      </details>
      <details open>
        <summary>Bubble shape</summary>
        <div className="composition-shape-grid" role="group" aria-label="Bubble shape">
          {shapes.map(({ shape, object }) => (
            <button
              key={shape}
              aria-pressed={b.shape === shape}
              aria-label={`Bubble shape ${shape}`}
              onClick={() => onChange({ shape })}
            >
              <Thumbnail object={object} />
              {shape}
            </button>
          ))}
        </div>
        <div className="composition-two">
          <Color label="Fill" value={b.fill} onChange={(fill) => onChange({ fill })} />
          <NumberField
            label="Fill opacity"
            value={b.fillOpacity}
            max={1}
            step={0.05}
            onChange={(fillOpacity) => onChange({ fillOpacity })}
          />
          <Color label="Border" value={b.stroke} onChange={(stroke) => onChange({ stroke })} />
          <NumberField
            label="Border thickness"
            value={b.strokeWidth}
            max={200}
            step={0.5}
            onChange={(strokeWidth) => onChange({ strokeWidth })}
          />
          <NumberField
            label="Dashed border"
            value={b.dash}
            max={500}
            onChange={(dash) => onChange({ dash })}
          />
          <NumberField
            label="Text padding"
            value={b.padding}
            max={2000}
            onChange={(padding) => onChange({ padding })}
          />
          <NumberField
            label="Irregular outline"
            value={b.roughness}
            max={1}
            step={0.05}
            onChange={(roughness) => onChange({ roughness })}
          />
          {b.shape === "Rounded" && (
            <NumberField
              label="Corner radius"
              value={b.radius}
              max={0.5}
              step={0.01}
              onChange={(radius) => onChange({ radius })}
            />
          )}
          {spiky && (
            <NumberField
              label="Spikes / bumps"
              value={b.spikes}
              min={4}
              max={128}
              onChange={(spikes) => onChange({ spikes })}
            />
          )}
        </div>
        <Check
          label="Transparent bubble fill"
          value={b.fill === "transparent"}
          onChange={(clear) => onChange({ fill: clear ? "transparent" : "#ffffff" })}
        />
        {b.roughness > 0 && (
          <Button
            variant="ghost"
            onClick={() => onChange({ seed: Math.floor(Math.random() * 0xffffffff) })}
          >
            New irregular variation
          </Button>
        )}
        <h4>Bubble shadow</h4>
        <div className="composition-two">
          <Color
            label="Shadow color"
            value={b.shadowColor}
            onChange={(shadowColor) => onChange({ shadowColor })}
          />
          <NumberField
            label="Shadow blur"
            value={b.shadowBlur}
            max={200}
            onChange={(shadowBlur) => onChange({ shadowBlur })}
          />
          <NumberField
            label="Shadow X"
            value={b.shadowX}
            min={-1000}
            max={1000}
            onChange={(shadowX) => onChange({ shadowX })}
          />
          <NumberField
            label="Shadow Y"
            value={b.shadowY}
            min={-1000}
            max={1000}
            onChange={(shadowY) => onChange({ shadowY })}
          />
        </div>
      </details>
      <details open>
        <summary>Tails ({b.tails.length})</summary>
        <p className="composition-hint">
          Drag the cyan tip and ring anchor on the canvas, or enter exact values.
        </p>
        {b.tails.map((t, i) => (
          <div className="composition-tail-card" key={t.id}>
            <Choice
              label={`Tail ${i + 1} style`}
              value={t.style}
              options={TAIL_STYLES}
              onChange={(style) => setTail(t.id, { style: style as BubbleTail["style"] })}
            />
            <div className="composition-two">
              <NumberField
                label="Base width"
                value={t.width}
                min={1}
                max={10000}
                onChange={(width) => setTail(t.id, { width })}
              />
              <NumberField
                label="Curvature"
                value={t.curvature}
                min={-1}
                max={1}
                step={0.05}
                onChange={(curvature) => setTail(t.id, { curvature })}
              />
              <NumberField
                label="Anchor (0–1)"
                value={t.attachment}
                max={1}
                step={0.01}
                onChange={(attachment) => setTail(t.id, { attachment })}
              />
              <NumberField
                label="Tip X"
                value={t.tip.x}
                min={-1e6}
                max={1e6}
                onChange={(x) => setTail(t.id, { tip: { ...t.tip, x } })}
              />
              <NumberField
                label="Tip Y"
                value={t.tip.y}
                min={-1e6}
                max={1e6}
                onChange={(y) => setTail(t.id, { tip: { ...t.tip, y } })}
              />
            </div>
            <Button
              variant="ghost"
              aria-label={`Remove tail ${i + 1}`}
              onClick={() => onChange({ tails: b.tails.filter((x) => x.id !== t.id) })}
            >
              <Trash2 />
              Remove tail
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          disabled={b.tails.length >= 8 || b.shape === "None"}
          onClick={() =>
            onChange({
              tails: [
                ...b.tails,
                {
                  id: crypto.randomUUID(),
                  attachment: b.tails.length ? (b.tails.at(-1)!.attachment + 0.3) % 1 : 0.56,
                  width: 50,
                  tip: { x: b.width * 0.3, y: b.height + 80 },
                  curvature: 0.3,
                  style: "Curved",
                },
              ],
            })
          }
        >
          <Plus />
          Add tail
        </Button>
      </details>
      <details>
        <summary>Reusable styles</summary>
        <div className="composition-actions">
          <Button variant="secondary" onClick={() => onSaveStyle("Bubble style", b)}>
            Save bubble style
          </Button>
          <Button variant="secondary" onClick={() => onSaveStyle("Text style", b)}>
            Save text style
          </Button>
          <Button variant="ghost" onClick={() => (styleClipboard = structuredClone(b))}>
            Copy style
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (styleClipboard)
                onChange(applyStyle(b, styleClipboard, [...BUBBLE_STYLE_KEYS, ...TEXT_STYLE_KEYS]));
            }}
          >
            Paste style
          </Button>
        </div>
      </details>
    </div>
  );
}
