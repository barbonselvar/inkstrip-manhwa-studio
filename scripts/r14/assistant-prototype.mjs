/** Research-only deterministic intent routing. It proposes existing controls;
 * it is not an LLM and never executes edits, uploads pixels or calls a provider. */
export function proposeEditingPlan(text) {
  if (typeof text !== "string" || text.length > 1000 || !text.trim())
    throw Error("Use a request of 1–1000 characters.");
  const request = text.normalize("NFKC").toLowerCase();
  const erase =
    /(remove|erase|supprim|effac|احذف|إزالة|ازالة)/u.test(request) &&
    /(bubble|object|bulle|objet|فقاعة|عنصر)/u.test(request);
  const line =
    /(clean|restore|nettoy|restaur|تنظيف|نظف)/u.test(request) &&
    /(line|ink|trait|encre|خط|حبر)/u.test(request);
  const face = /(face|character|visage|personnage|وجه|شخصية)/u.test(request);
  const base = {
    prototype: true,
    method: "rules, not AI inference",
    executesEdits: false,
    requiresUserReview: true,
  };
  if ([erase, line, face].filter(Boolean).length !== 1)
    return {
      ...base,
      status: "needs-clarification",
      reason: "Choose one supported editing operation and its target.",
    };
  if (face)
    return {
      ...base,
      status: "deferred",
      reason:
        "Free reference-guided identity conditioning is not validated. Open the existing Character Library to review references; no face edit is performed.",
    };
  if (erase)
    return {
      ...base,
      status: "proposal",
      tool: "Object Eraser & Retouch",
      requiresSelection: true,
      steps: [
        "Select the region",
        "Preview local texture repair",
        "Review unchanged surroundings",
        "Accept and save explicitly",
      ],
      limitation: "Cannot recover the original hidden artwork or guarantee reconstructed geometry.",
    };
  return {
    ...base,
    status: "proposal",
    tool: "AI Enhance",
    settings: { scale: 1, denoise: 10, sharpen: 5, color: false, artifacts: false, inkGaps: false },
    steps: [
      "Review line-art settings",
      "Run real local inference",
      "Compare at 100%",
      "Apply explicitly",
    ],
    limitation:
      "Color boost is disabled; neural restoration can still change RGB pixels and lettering.",
  };
}
