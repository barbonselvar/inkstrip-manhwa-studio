/** Per-file Chapter import outcomes: specific, user-facing reasons and retry eligibility. */
export type ImportIssueKind =
  | "unsupported"
  | "corrupted"
  | "too-large"
  | "dimensions"
  | "storage"
  | "decode"
  | "conversion"
  | "access"
  | "deferred";

export type ImportIssue = { name: string; reason: string; kind: ImportIssueKind };

const RULES: [ImportIssueKind, RegExp][] = [
  ["access", /could not be read|NotReadable|NotFound|permission/i],
  ["storage", /storage|out of space|quota/i],
  ["conversion", /conversion|converting|convert/i],
  ["dimensions", /dimension|megapixel|per side/i],
  ["too-large", /budget|too large|exceeds/i],
  ["unsupported", /not supported|unsupported|format/i],
  ["corrupted", /truncated|malformed|corrupt|invalid|header|termination/i],
  ["decode", /decode|decoding|timed out|busy/i],
];

/** Turn any thrown value into a specific reason. Browser file-access errors (Android
 * revoked content URIs, deleted/moved files) get an actionable message. */
export function importIssue(name: string, error: unknown): ImportIssue {
  const e = error as { name?: string; message?: string } | undefined;
  if (e?.name === "NotReadableError" || e?.name === "NotFoundError" || e?.name === "SecurityError")
    return {
      name,
      kind: "access",
      reason:
        "The browser could not read this file. It may have been moved or deleted, or access was revoked. Select it again.",
    };
  if (e?.name === "QuotaExceededError" || e?.name === "NS_ERROR_DOM_QUOTA_REACHED")
    return {
      name,
      kind: "storage",
      reason: "Browser storage is full. Remove a chapter or free space, then retry.",
    };
  const reason = (e?.message || String(error) || "The image could not be imported.").replace(
    / Image was not decoded or imported\.$/,
    "",
  );
  const kind = RULES.find(([, re]) => re.test(reason))?.[0] ?? "decode";
  return { name, reason, kind };
}

/** One line for the banner; the full per-file list is shown separately. */
export function importSummary(added: number, issues: ImportIssue[], converted: number) {
  const parts = [
    added
      ? `Added ${added} ${added === 1 ? "photo" : "photos"}.`
      : issues.length
        ? "No images were imported."
        : "",
    converted ? `${converted} converted to lossless PNG.` : "",
    issues.length
      ? `${issues.length} ${issues.length === 1 ? "file was" : "files were"} not imported: ${issues
          .slice(0, 2)
          .map((i) => `${i.name}: ${i.reason}`)
          .join(" ")}${issues.length > 2 ? ` (+${issues.length - 2} more below)` : ""}`
      : "",
  ];
  return parts.filter(Boolean).join(" ");
}
