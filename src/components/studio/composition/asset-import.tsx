import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { sanitizeSfxSvg, removeCornerMatte } from "@/lib/studio/composition/assets";
import { preflightImage } from "@/lib/studio/image-policy";
import { decodeBlob } from "@/lib/studio/images";
import { NumberField } from "../editor/number-field";
export function AssetImport({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (blob: Blob, name: string, category: string, w: number, h: number) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [name, setName] = useState(""),
    [category, setCategory] = useState("Custom"),
    [matte, setMatte] = useState(false),
    [tolerance, setTolerance] = useState(24),
    [preview, setPreview] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<{ blob: Blob; w: number; h: number } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const g = ++generation.current;
    let url = "",
      canceled = false;
    setResult(null);
    setPreview("");
    setError("");
    if (!file) return;
    void (async () => {
      let blob: Blob = file;
      if (/\.svg$/i.test(file.name) || file.type === "image/svg+xml") {
        const clean = sanitizeSfxSvg(await file.text()),
          u = URL.createObjectURL(new Blob([clean], { type: "image/svg+xml" }));
        try {
          const im = new Image();
          im.src = u;
          await im.decode();
          const c = document.createElement("canvas");
          c.width = im.naturalWidth;
          c.height = im.naturalHeight;
          c.getContext("2d")!.drawImage(im, 0, 0);
          blob = await new Promise<Blob>((resolve, reject) =>
            c.toBlob((b) => (b ? resolve(b) : reject(Error("SVG could not be decoded.")))),
          );
        } finally {
          URL.revokeObjectURL(u);
        }
      } else {
        if (!["image/png", "image/webp"].includes(file.type))
          throw Error("Choose PNG, WebP or SVG.");
        await preflightImage(file);
      }
      const decoded = await decodeBlob(blob);
      try {
        const factor = Math.min(1, 2048 / Math.max(decoded.width, decoded.height)),
          w = Math.max(1, Math.round(decoded.width * factor)),
          h = Math.max(1, Math.round(decoded.height * factor)),
          c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(decoded.source, 0, 0, w, h);
        if (matte) {
          const data = ctx.getImageData(0, 0, w, h);
          data.data.set(removeCornerMatte(data.data, w, h, tolerance));
          ctx.putImageData(data, 0, 0);
        }
        const png = await new Promise<Blob>((resolve, reject) =>
          c.toBlob((b) => (b ? resolve(b) : reject(Error("Artwork could not be encoded.")))),
        );
        if (g === generation.current && !canceled) {
          url = URL.createObjectURL(png);
          setPreview(url);
          setResult({ blob: png, w, h });
        }
      } finally {
        decoded.close();
      }
    })().catch((e) => {
      if (g === generation.current && !canceled) setError(String(e));
    });
    return () => {
      canceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, matte, tolerance]);
  return (
    <Modal
      title="Import SFX artwork"
      description="Artwork is stored independently. SVG is sanitized and rasterized to PNG at up to 2048 pixels; imported paths are not editable."
      open={open}
      onOpenChange={(v) => {
        if (!busy && !v) onClose();
      }}
    >
      <label className="editor-field-label">
        SFX file
        <input
          type="file"
          accept="image/png,image/webp,image/svg+xml,.svg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setFile(f);
              setName(f.name.replace(/\.[^.]+$/, ""));
            }
          }}
        />
      </label>
      <label className="editor-field-label">
        Asset name
        <input
          className="field"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="editor-field-label">
        Asset category name
        <input
          className="field"
          value={category}
          maxLength={80}
          onChange={(e) => setCategory(e.target.value)}
        />
      </label>
      <label className="composition-check">
        <input type="checkbox" checked={matte} onChange={(e) => setMatte(e.target.checked)} />
        Remove corner-connected background
      </label>
      {matte && (
        <NumberField
          label="Background color tolerance"
          value={tolerance}
          min={0}
          max={100}
          onChange={setTolerance}
        />
      )}
      <p className="composition-hint">
        For flat mattes touching an opaque image corner. Interior light lettering is preserved.
        Complex backgrounds require external cleanup.
      </p>
      {preview && (
        <img className="composition-asset-preview" alt="SFX transparency preview" src={preview} />
      )}{" "}
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={!result || !name.trim() || busy}
        onClick={() => {
          if (!result) return;
          setBusy(true);
          void onImport(result.blob, name.trim(), category.trim() || "Custom", result.w, result.h)
            .then(onClose)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        Save asset and insert
      </Button>
    </Modal>
  );
}
