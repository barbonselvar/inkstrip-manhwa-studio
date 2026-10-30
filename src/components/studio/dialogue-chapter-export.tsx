import { browserDialogueBudget, boundedEntries } from "@/lib/studio/dialogue/budget";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToolSection } from "./design/tool-section";
import type { Panel } from "@/lib/studio/types";
import { getBlob } from "@/lib/studio/db";
import { loadSession } from "@/lib/studio/pro/storage";
import { ProRenderer } from "@/lib/studio/pro/client";
import { nativeFile } from "@/lib/studio/pro/files";
import { fromPanel } from "@/lib/studio/pro/model";
import { cleanView } from "@/lib/studio/dialogue/operations";
import { pageRange } from "@/lib/studio/dialogue/ranges";
import { safeAssetName, zipStore } from "@/lib/studio/dialogue/zip";
export function DialogueChapterExport({ panels, title }: { panels: Panel[]; title: string }) {
  const [range, setRange] = useState(""),
    [mode, setMode] = useState("dialogue"),
    [mime, setMime] = useState("image/png"),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const job = useRef<{ controller: AbortController; renderer?: ProRenderer } | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const active = job;
    return () => {
      alive.current = false;
      active.current?.controller.abort();
      active.current?.renderer?.dispose();
    };
  }, []);
  async function exportPages() {
    if (busy) return;
    const controller = new AbortController();
    job.current = { controller };
    setBusy(true);
    setError("");
    try {
      const { maxArea, archiveBytes } = browserDialogueBudget(),
        { entries, add } = boundedEntries(archiveBytes);
      const ordered = [...panels].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
        pages = pageRange(range, ordered.length);
      for (const [i, index] of pages.entries()) {
        controller.signal.throwIfAborted();
        const panel = ordered[index]!;
        if (alive.current) setStatus(`Preparing page ${i + 1}/${pages.length} · ${panel.name}`);
        let session = await loadSession(panel.id);
        if (session && session.acceptedBlobId !== panel.blobId)
          throw Error(
            `Page ${index + 1} changed outside its native draft. Reconcile it in the editor before exporting.`,
          );
        if (!session) {
          const blob = await getBlob(panel.blobId);
          if (!blob) throw Error(`Page ${index + 1} artwork is missing.`);
          session = {
            document: fromPanel(panel),
            assets: { source: blob },
            revision: 0,
            acceptedBlobId: panel.blobId,
            updatedAt: 0,
          };
        }
        const name = `${String(index + 1).padStart(4, "0")}-${safeAssetName(panel.name)}`;
        if (mode === "layered")
          add({ name: `${name}/project.inkstrip`, blob: await nativeFile(session) });
        else {
          const renderer = new ProRenderer();
          job.current!.renderer = renderer;
          try {
            await renderer.init(session, maxArea);
            controller.signal.throwIfAborted();
            const d =
              mode === "dialogue"
                ? session.document
                : cleanView(session.document, mode === "cleaned");
            const result = await renderer.export(d, maxArea, mime, 0.95, (n, t) => {
              if (alive.current) setStatus(`Page ${i + 1}/${pages.length} · layer ${n}/${t}`);
            });
            controller.signal.throwIfAborted();
            if (!result.blob) throw Error("Page export returned no image.");
            add({ name: `${name}.${mime.split("/")[1]}`, blob: result.blob });
          } finally {
            renderer.dispose();
          }
        }
      }
      add({
        name: "manifest.json",
        blob: new Blob(
          [
            JSON.stringify(
              {
                format: "inkstrip-chapter-export",
                version: 1,
                title,
                mode,
                pages: pages.map((index) => ({
                  page: index + 1,
                  id: ordered[index]!.id,
                  name: ordered[index]!.name,
                })),
                note:
                  mode === "layered"
                    ? "Each native document preserves editable layers and original assets. No PSD compatibility is claimed."
                    : "Images rendered from native layers in Chapter reading order.",
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
      controller.signal.throwIfAborted();
      const u = URL.createObjectURL(zip),
        a = document.createElement("a");
      a.href = u;
      a.download = `${safeAssetName(title)}-${mode}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      if (alive.current)
        setStatus(`Exported ${pages.length} pages in reading order. Chapter unchanged.`);
    } catch (e) {
      if (alive.current) {
        if (controller.signal.aborted) setStatus("Export cancelled; Chapter unchanged.");
        else setError((e as Error).message);
      }
    } finally {
      job.current?.renderer?.dispose();
      job.current = null;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <ToolSection title="Professional Chapter export">
      <fieldset disabled={busy} className="dialogue-fieldset">
        <label className="pro-field">
          Page ranges
          <input
            className="field"
            aria-label="Dialogue export page ranges"
            placeholder="All pages, or 1-3,5"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          />
        </label>
        <label className="pro-field">
          Page content
          <select
            className="field"
            aria-label="Dialogue export content"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="dialogue">With visible dialogue</option>
            <option value="source">Without dialogue or cleanup</option>
            <option value="cleaned">Cleaned pages without dialogue</option>
            <option value="layered">Editable native layered pages</option>
          </select>
        </label>
        {mode !== "layered" && (
          <label className="pro-field">
            Image format
            <select
              className="field"
              aria-label="Dialogue Chapter format"
              value={mime}
              onChange={(e) => setMime(e.target.value)}
            >
              {["image/png", "image/jpeg", "image/webp"].map((m) => (
                <option key={m} value={m}>
                  {m.split("/")[1]!.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button disabled={!panels.length} onClick={() => void exportPages()}>
          Export Chapter ZIP
        </Button>
      </fieldset>
      {busy && (
        <Button
          variant="ghost"
          onClick={() => {
            job.current?.controller.abort();
            job.current?.renderer?.dispose();
          }}
        >
          Cancel Chapter export
        </Button>
      )}
      <p className="pro-help" role="status">
        {status}
      </p>
      {error && <p role="alert">{error}</p>}
      <p className="pro-help">
        Native dimensions and committed crop. Up to250 pages;128MB /4MP on touch or low-memory
        devices,512MB /16.8MP on desktop. Saves are never modified. Save or apply open editors
        before exporting.
      </p>
    </ToolSection>
  );
}
