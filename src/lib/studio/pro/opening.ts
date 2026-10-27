import { validateAssets, type ProSession } from "./model.ts";
import { documentSources } from "./raster-budget.ts";

/** The opening state must use the renderer's device budget before installing
 * history/autosave. A globally valid native document can still be too large for
 * this device. Refusal leaves both the accepted artwork and existing draft intact. */
export function validateOpeningSession(session: ProSession, maxArea: number) {
  if (!Number.isSafeInteger(maxArea) || maxArea < 1 || maxArea > 16_777_216)
    throw Error("Invalid Raster device pixel budget.");
  validateAssets(session);
  const doc = session.document;
  if ([doc, doc.crop, doc.imageSize].some((s) => s && s.width * s.height > maxArea))
    throw Error(
      "Canvas, crop or output exceeds this device’s memory budget. The original artwork and saved draft are unchanged.",
    );
  documentSources(doc, maxArea);
}
