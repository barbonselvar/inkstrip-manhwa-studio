import { layer, validateAssets, type ProSession, type Selection } from "./model.ts";
import { maskFromSelection } from "./masks.ts";
import { documentSources } from "./raster-budget.ts";
import { validateAiReceipt, type AiReceipt } from "./ai-receipt.ts";
/** Returns a new session only after every guard passes; existing layer/mask identities stay intact. */
export function acceptAiResult(
  session: ProSession,
  receipt: AiReceipt,
  result: Blob,
  source: Blob,
  maxArea: number,
  selection?: Selection,
) {
  validateAiReceipt(receipt);
  if (result.type !== "image/png" || source.type !== "image/png" || !result.size || !source.size)
    throw Error("AI assets must be validated PNG images.");
  const d = session.document,
    l = layer("raster", receipt.region.width, receipt.region.height);
  l.assetId = crypto.randomUUID();
  l.name = "AI · Swin2SR restoration";
  l.ai = structuredClone(receipt);
  l.transform.x = receipt.region.x;
  l.transform.y = receipt.region.y;
  if (selection && (selection.regions.length || selection.inverted))
    l.mask = maskFromSelection(selection, l, d);
  const next = {
    ...session,
    document: { ...d, layers: [...d.layers, l] },
    assets: { ...session.assets, [receipt.sourceAssetId]: source, [l.assetId]: result },
  };
  validateAssets(next);
  documentSources(next.document, maxArea);
  return { session: next, layerId: l.id };
}
