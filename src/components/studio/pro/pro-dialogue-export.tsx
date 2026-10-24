import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToolSection } from "../design/tool-section";
import { ProRenderer } from "@/lib/studio/pro/client";
import { nativeFile, vectorSvg } from "@/lib/studio/pro/files";
import type { ProDocument, ProSession } from "@/lib/studio/pro/model";
import { cleanView } from "@/lib/studio/dialogue/operations";
import { zipStore, safeAssetName, type ZipEntry } from "@/lib/studio/dialogue/zip";
function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
export function ProDialogueExport({
  document: d,
  session,
  maxArea,
  mime,
  quality,
  disabled,
  onError,
  onPending,
}: {
  document: ProDocument;
  session: ProSession;
  maxArea: number;
  mime: string;
  quality: number;
  disabled: boolean;
  onError: (s: string) => void;
  onPending: (s: boolean) => void;
}) {
  const [cleaned, setCleaned] = useState(true),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const job = useRef<{ controller: AbortController; renderer: ProRenderer } | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const pending = job;
    return () => {
      alive.current = false;
      pending.current?.controller.abort();
      pending.current?.renderer.dispose();
      onPending(false);
    };
  }, [onPending]);
  const cancel = () => {
    job.current?.controller.abort();
    job.current?.renderer.dispose();
  };
  async function run(kind: "clean" | "layers") {
    if (busy || disabled) return;
    const controller = new AbortController(),
      renderer = new ProRenderer();
    job.current = { controller, renderer };
    setBusy(true);
    onPending(true);
    onError("");
    const check = () => controller.signal.throwIfAborted();
    try {
      await renderer.init({ ...session, document: d }, maxArea);
      check();
      const render = async (document: ProDocument, type: string) => {
        const result = await renderer.export(document, maxArea, type, quality, (n, t) => {
          if (alive.current) setStatus(`Rendering layer ${n}/${t}`);
        });
        check();
        if (!result.blob) throw Error("Image export failed.");
        return result.blob;
      };
      const base = safeAssetName(d.name);
      if (kind === "clean") {
        const image = await render(cleanView(d, cleaned), mime);
        check();
        download(
          image,
          `${base}-${cleaned ? "cleaned" : "without-dialogue"}.${mime.split("/")[1]}`,
        );
      } else {
        const entries: ZipEntry[] = [
          { name: "project.inkstrip", blob: await nativeFile({ ...session, document: d }) },
          {
            name: "document.json",
            blob: new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
          },
        ];
        let assetNumber = 0;
        const assets: Record<string, string> = {};
        for (const [id, blob] of Object.entries(session.assets)) {
          const name = `assets/${String(++assetNumber).padStart(4, "0")}.${blob.type.split("/")[1] ?? "bin"}`;
          assets[id] = name;
          entries.push({ name, blob });
        }
        const manifest: {
          id: string;
          name: string;
          file: string;
          visible: boolean;
          note?: string;
        }[] = [];
        for (const [i, l] of d.layers.entries()) {
          check();
          if (l.kind === "group" || l.kind === "adjustment") continue;
          // Standalone extraction would misrepresent clipping, backdrop blend or group masks.
          // Those layers stay fully editable in the native file with an explicit manifest note.
          const ancestors = [];
          let parent = d.layers.find((p) => p.id === l.parentId);
          while (parent) {
            ancestors.push(parent);
            parent = d.layers.find((p) => p.id === parent!.parentId);
          }
          const dependent =
            l.clipped ||
            l.blend !== "source-over" ||
            ancestors.some(
              (p) =>
                p.mask ||
                p.effects?.some((e) => e.enabled) ||
                p.opacity !== 1 ||
                p.blend !== "source-over" ||
                !p.visible,
            );
          if (dependent) {
            manifest.push({
              id: l.id,
              name: l.name,
              file: "project.inkstrip",
              visible: l.visible,
              note: "Backdrop, clipping or ancestor appearance dependency; preserved in native project rather than an inaccurate isolated PNG.",
            });
            continue;
          }
          const imageDoc = {
            ...d,
            background: "transparent",
            layers: [{ ...l, parentId: undefined, visible: true }],
          };
          const file = `layers/${String(i + 1).padStart(4, "0")}-${safeAssetName(l.name)}.png`;
          entries.push({ name: file, blob: await render(imageDoc, "image/png") });
          manifest.push({ id: l.id, name: l.name, file, visible: l.visible });
        }
        try {
          entries.push({
            name: "vectors.svg",
            blob: new Blob([vectorSvg(d)], { type: "image/svg+xml" }),
          });
        } catch (e) {
          entries.push({ name: "SVG-LIMITATIONS.txt", blob: new Blob([(e as Error).message]) });
        }
        entries.push({
          name: "manifest.json",
          blob: new Blob(
            [
              JSON.stringify(
                {
                  format: "inkstrip-layered-assets",
                  version: 1,
                  coordinates: "native document pixels",
                  width: d.width,
                  height: d.height,
                  assets,
                  layers: manifest,
                },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
        });
        const zip = await zipStore(entries, controller.signal, (n, t) => {
          if (alive.current) setStatus(`Packaging ${n}/${t}`);
        });
        check();
        download(zip, `${base}-layers.zip`);
      }
      if (alive.current) setStatus("Export complete. Native project and source artwork unchanged.");
    } catch (e) {
      if (alive.current) {
        if (controller.signal.aborted) setStatus("Export cancelled; document unchanged.");
        else onError((e as Error).message);
      }
    } finally {
      renderer.dispose();
      job.current = null;
      if (alive.current) {
        setBusy(false);
        onPending(false);
      }
    }
  }
  return (
    <ToolSection title="Dialogue & layered exports" defaultOpen>
      <p className="pro-help">
        Uses native document dimensions and committed crop boundaries. Existing composite export
        includes visible approved dialogue layers.
      </p>
      <label className="pro-check">
        <input
          type="checkbox"
          checked={cleaned}
          onChange={(e) => setCleaned(e.target.checked)}
          disabled={busy}
        />
        Include cleanup in export without dialogue
      </label>
      <Button disabled={disabled || busy} onClick={() => void run("clean")}>
        Export image without dialogue
      </Button>
      <Button disabled={disabled || busy} onClick={() => void run("layers")}>
        Export layered assets ZIP
      </Button>
      {busy && (
        <Button variant="ghost" onClick={cancel}>
          Cancel dialogue export
        </Button>
      )}
      <p role="status" className="pro-help">
        {status}
      </p>
      <p className="pro-help">
        ZIP contains native editable project, immutable assets, document metadata and independent
        layer PNGs. Backdrop-dependent layers remain in the native project with an explicit manifest
        note. SVG omits raster artwork and rejects unsupported effects; no PSD compatibility is
        claimed.
      </p>
    </ToolSection>
  );
}
