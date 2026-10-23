import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProNumber } from "./pro-properties";
import { ToolSection } from "../design/tool-section";
import { CANDIDATES, SWIN, localCapability } from "@/lib/studio/ai/registry";
import { discoverGpu, type GpuCapabilities } from "@/lib/studio/ai/connector";
import { LocalRestoration, digest, validateResult } from "@/lib/studio/ai/execution";
import { planRegion, type Region } from "@/lib/studio/ai/plan";
import { selectionCanvas } from "@/lib/studio/pro/render";
import { blendClippedPixels } from "@/lib/studio/pro/clipping";
import type { AiReceipt } from "@/lib/studio/pro/ai-receipt";
import type { ProDocument } from "@/lib/studio/pro/model";
export type AiPreview = {
  receipt: AiReceipt;
  result: Blob;
  source: Blob;
  documentJson: string;
  acceptedBlobId: string;
};
function PreviewImage({ blob, label }: { blob: Blob; label: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <figure>
      <img src={url} alt={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
export function ProAiStudio({
  document: doc,
  disabled,
  prepare,
  onAccept,
  onSelection,
  onRaster,
}: {
  document: ProDocument;
  disabled: boolean;
  prepare: (
    doc: ProDocument,
    signal: AbortSignal,
  ) => Promise<{ blob: Blob; acceptedBlobId: string }>;
  onAccept: (result: AiPreview) => Promise<void>;
  onSelection: () => void;
  onRaster: () => void;
}) {
  const [advanced, setAdvanced] = useState(false),
    [settings, setSettings] = useState({ denoise: 0, sharpen: 0, color: false, artifacts: false }),
    [stage, setStage] = useState(""),
    [running, setRunning] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<(AiPreview & { before: Blob; after: Blob }) | null>(null),
    [accepting, setAccepting] = useState(false),
    [endpoint, setEndpoint] = useState(""),
    [token, setToken] = useState(""),
    [discovering, setDiscovering] = useState(false),
    [networkConsent, setNetworkConsent] = useState(false),
    [gpu, setGpu] = useState<GpuCapabilities | null>(null),
    [gpuError, setGpuError] = useState("");
  const run = useRef(0),
    abort = useRef<AbortController | null>(null),
    engine = useRef<LocalRestoration | null>(null),
    discovery = useRef<AbortController | null>(null);
  const capable = localCapability({
    worker: typeof Worker !== "undefined",
    canvas: typeof OffscreenCanvas !== "undefined",
    wasm: typeof WebAssembly !== "undefined",
  });
  useEffect(
    () => () => {
      ++run.current;
      abort.current?.abort();
      engine.current?.cancel();
      discovery.current?.abort();
    },
    [],
  );
  const cancel = () => {
    ++run.current;
    abort.current?.abort();
    engine.current?.cancel();
    setRunning(false);
    setStage("Cancelled. Document and Chapter unchanged.");
  };
  const generate = async () => {
    abort.current?.abort();
    engine.current?.cancel();
    const serial = ++run.current,
      controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError("");
    setPreview(null);
    setStage("Preparing immutable document snapshot…");
    const snapshot = structuredClone(doc),
      documentJson = JSON.stringify(doc),
      chosen = { ...settings },
      started = performance.now();
    let bitmap: ImageBitmap | undefined, execution: LocalRestoration | undefined;
    const surfaces: OffscreenCanvas[] = [];
    try {
      // Selection uses the established native-resolution coverage engine, including holes/frames.
      let bounds: Region | undefined, mask: OffscreenCanvas | undefined;
      if (
        snapshot.selection &&
        (snapshot.selection.regions.length || snapshot.selection.inverted)
      ) {
        mask = selectionCanvas(snapshot.selection, snapshot.width, snapshot.height);
        surfaces.push(mask);
        const alpha = mask.getContext("2d")!.getImageData(0, 0, mask.width, mask.height).data;
        let left = snapshot.width,
          top = snapshot.height,
          right = 0,
          bottom = 0;
        for (let y = 0; y < snapshot.height; y++)
          for (let x = 0; x < snapshot.width; x++)
            if (alpha[(y * snapshot.width + x) * 4 + 3]) {
              left = Math.min(left, x);
              top = Math.min(top, y);
              right = Math.max(right, x + 1);
              bottom = Math.max(bottom, y + 1);
            }
        if (right <= left || bottom <= top)
          throw Error("The selection is empty. Select visible artwork or clear the selection.");
        bounds = { x: left, y: top, width: right - left, height: bottom - top };
      }
      const region = planRegion(snapshot.width, snapshot.height, bounds, bounds ? 16 : 0);
      const captured = await prepare(snapshot, controller.signal);
      controller.signal.throwIfAborted();
      bitmap = await createImageBitmap(captured.blob);
      if (bitmap.width !== snapshot.width || bitmap.height !== snapshot.height)
        throw Error("The snapshot dimensions changed. No inference started.");
      const input = new OffscreenCanvas(region.width, region.height),
        ctx = input.getContext("2d", { willReadFrequently: true })!;
      surfaces.push(input);
      ctx.drawImage(
        bitmap,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        region.width,
        region.height,
      );
      bitmap.close();
      bitmap = undefined;
      const before = await input.convertToBlob({ type: "image/png" });
      execution = new LocalRestoration();
      engine.current = execution;
      const result = await execution.run(before, { ...chosen, scale: 1 }, (s, n, t) => {
        if (serial === run.current) setStage(t ? `${s} · ${n} / ${t}` : s);
      });
      controller.signal.throwIfAborted();
      await validateResult(result.blob, region.width, region.height);
      const receipt: AiReceipt = {
        version: 1,
        task: "restoration",
        composite: "preserve-alpha",
        modelId: SWIN.id,
        modelRevision: SWIN.revision,
        weightsSha256: SWIN.sha256,
        backend: "browser-wasm",
        sourceAssetId: "ai-source-" + (await digest(captured.blob)),
        sourceWidth: snapshot.width,
        sourceHeight: snapshot.height,
        sourceDocumentSha256: await digest(documentJson),
        region,
        selection: snapshot.selection,
        settings: chosen,
        createdAt: Date.now(),
        elapsedMs: performance.now() - started,
      };
      // Show the same masked, alpha-preserving color overlay that Accept will render.
      const output = await createImageBitmap(result.blob),
        afterCanvas = new OffscreenCanvas(region.width, region.height),
        afterCtx = afterCanvas.getContext("2d")!;
      surfaces.push(afterCanvas);
      afterCtx.drawImage(output, 0, 0);
      output.close();
      const overlay = afterCtx.getImageData(0, 0, region.width, region.height),
        original = ctx.getImageData(0, 0, region.width, region.height);
      if (mask) {
        const alpha = mask
          .getContext("2d")!
          .getImageData(region.x, region.y, region.width, region.height).data;
        for (let i = 3; i < overlay.data.length; i += 4)
          overlay.data[i] = (overlay.data[i]! * alpha[i]!) / 255;
        mask.width = mask.height = 1;
      }
      original.data.set(blendClippedPixels(original.data, overlay.data, 1, "source-over"));
      afterCtx.putImageData(original, 0, 0);
      const after = await afterCanvas.convertToBlob({ type: "image/png" });
      input.width = input.height = afterCanvas.width = afterCanvas.height = 1;
      if (serial === run.current) {
        setPreview({
          receipt,
          result: result.blob,
          source: captured.blob,
          documentJson,
          acceptedBlobId: captured.acceptedBlobId,
          before,
          after,
        });
        setStage("Preview ready. Nothing has been added to your document.");
      }
    } catch (e) {
      if (serial === run.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Inference failed; original unchanged.");
    } finally {
      bitmap?.close();
      execution?.cancel();
      for (const surface of surfaces) surface.width = surface.height = 1;
      if (serial === run.current) setRunning(false);
    }
  };
  const stale = preview && preview.documentJson !== JSON.stringify(doc);
  return (
    <section className="pro-ai-studio" aria-label="AI Studio controls">
      <div className="pro-section-heading">
        <h3>Inkstrip AI Studio</h3>
        <span className="pro-help">Local · preview first</span>
      </div>
      <p className="pro-help">
        Restore visible artwork into a new editable layer. Original layers and Chapter images stay
        unchanged until you apply.
      </p>
      <div className="flex gap-2" role="group" aria-label="AI interface mode">
        <Button
          variant={!advanced ? "secondary" : "ghost"}
          aria-pressed={!advanced}
          onClick={() => setAdvanced(false)}
        >
          Simple
        </Button>
        <Button
          variant={advanced ? "secondary" : "ghost"}
          aria-pressed={advanced}
          onClick={() => setAdvanced(true)}
        >
          Advanced
        </Button>
      </div>
      <p className="pro-help">
        <strong>Task:</strong> Gentle detail restoration · Swin2SR
      </p>
      <p className="pro-help">
        {capable.reason} First use downloads 54.4 MB and can take a few minutes. Neural restoration
        keeps the original resolution; generative repair is unavailable.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onSelection} disabled={running || accepting}>
          Edit selection / mask
        </Button>
        <Button variant="ghost" onClick={onRaster}>
          Return to Raster
        </Button>
      </div>
      <p className="pro-help">
        {doc.selection && (doc.selection.regions.length || doc.selection.inverted)
          ? "Current selection limits the result; 16px context is included for inference."
          : "No selection: process the full image within local model limits."}{" "}
        Layer masks and transparency are preserved.
      </p>
      {advanced && (
        <fieldset disabled={running || accepting} className="pro-ai-settings">
          <legend>Supported restoration settings</legend>
          <p className="pro-help">
            Swin2SR settings are fixed. These optional traditional pre/post filters surround neural
            inference; they do not provide generative repair.
          </p>
          <ProNumber
            label="Denoise prefilter"
            value={settings.denoise}
            min={0}
            max={100}
            onChange={(denoise) => setSettings((s) => ({ ...s, denoise }))}
          />
          <ProNumber
            label="Sharpen finish"
            value={settings.sharpen}
            min={0}
            max={100}
            onChange={(sharpen) => setSettings((s) => ({ ...s, sharpen }))}
          />
          <label>
            <input
              type="checkbox"
              checked={settings.artifacts}
              onChange={(e) => setSettings((s) => ({ ...s, artifacts: e.target.checked }))}
            />{" "}
            Traditional artifact prefilter
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.color}
              onChange={(e) => setSettings((s) => ({ ...s, color: e.target.checked }))}
            />{" "}
            Traditional color finish
          </label>
          <Button
            variant="ghost"
            onClick={() => setSettings({ denoise: 0, sharpen: 0, color: false, artifacts: false })}
          >
            Reset to Gentle Restoration
          </Button>
        </fieldset>
      )}
      <Button
        intent="ai"
        disabled={disabled || !capable.available || running || accepting}
        onClick={() => void generate()}
      >
        Generate restoration preview
      </Button>
      {running && (
        <Button variant="secondary" onClick={cancel}>
          Cancel AI processing
        </Button>
      )}
      <p role="status" className="pro-help">
        {stage}
      </p>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <div className="pro-ai-preview">
          <PreviewImage blob={preview.before} label="Before · processing region" />
          <PreviewImage blob={preview.after} label="After · masked restoration preview" />
          <p className="pro-help">
            {preview.receipt.region.width} × {preview.receipt.region.height}px at (
            {preview.receipt.region.x}, {preview.receipt.region.y}) ·{" "}
            {(preview.receipt.elapsedMs / 1000).toFixed(2)}s including preparation/download. Full
            source resolution retained.
          </p>
          {stale && <p role="alert">Document changed. Discard and generate a new preview.</p>}
          <Button
            disabled={disabled || !!stale || accepting}
            onClick={() => {
              setAccepting(true);
              void onAccept(preview)
                .then(() => {
                  setPreview(null);
                  setStage("Accepted as an editable AI result layer.");
                })
                .catch((e) => setError(e instanceof Error ? e.message : "Acceptance failed."))
                .finally(() => setAccepting(false));
            }}
          >
            Accept AI result layer
          </Button>
          <Button
            variant="ghost"
            disabled={accepting}
            onClick={() => {
              setPreview(null);
              setStage("Preview discarded. Document unchanged.");
            }}
          >
            Discard AI preview
          </Button>
        </div>
      )}
      <ToolSection title="Models and qualification">
        <p className="pro-help">
          {SWIN.name} · {SWIN.revision.slice(0, 12)} · {SWIN.codeLicense} code;{" "}
          {SWIN.weightsLicense}. Model provenance is retained in accepted native documents;
          reprocessing may differ across runtimes.
        </p>
        {CANDIDATES.map((m) => (
          <p className="pro-help" key={m.id}>
            <strong>{m.name}</strong> — {m.reason}
          </p>
        ))}
      </ToolSection>
      <ToolSection title="Optional self-hosted GPU discovery">
        <p className="pro-help">
          Connection check only. No job submission or image upload is enabled. A server
          advertisement does not qualify a model. Tokens stay in this workspace's memory and are
          cleared when it closes. Server compute may cost money.
        </p>
        <label className="pro-field">
          HTTPS origin
          <input
            type="url"
            aria-label="GPU HTTPS origin"
            value={endpoint}
            onChange={(e) => {
              setEndpoint(e.target.value);
              setGpu(null);
              setNetworkConsent(false);
            }}
            placeholder="https://gpu.example.org"
          />
        </label>
        <label className="pro-field">
          Session token
          <input
            type="password"
            autoComplete="off"
            aria-label="GPU session token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={networkConsent}
            onChange={(e) => setNetworkConsent(e.target.checked)}
          />{" "}
          Allow this capability request and session credential to the configured origin; no artwork
          is sent.
        </label>
        <Button
          variant="secondary"
          disabled={!networkConsent || discovering}
          onClick={() => {
            discovery.current = new AbortController();
            setDiscovering(true);
            setGpuError("");
            void discoverGpu(endpoint, token, discovery.current.signal)
              .then(setGpu)
              .catch((e) => setGpuError(e instanceof Error ? e.message : "GPU discovery failed."))
              .finally(() => setDiscovering(false));
          }}
        >
          Check GPU capabilities
        </Button>
        {discovering && (
          <Button variant="ghost" onClick={() => discovery.current?.abort()}>
            Cancel GPU discovery
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            discovery.current?.abort();
            setToken("");
            setGpu(null);
            setNetworkConsent(false);
          }}
        >
          Disconnect and clear credential
        </Button>
        {gpuError && <p role="alert">{gpuError}</p>}
        {gpu && (
          <div role="status">
            <p className="pro-help">
              Connected protocol {gpu.protocol}. Server-reported retention: {gpu.retention}
            </p>
            {gpu.models.map((m) => (
              <p className="pro-help" key={m.id}>
                {m.id} · {m.revision} · {m.task} · {m.weightsLicense} (unqualified; execution
                disabled)
              </p>
            ))}
          </div>
        )}
      </ToolSection>
    </section>
  );
}
