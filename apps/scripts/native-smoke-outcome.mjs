/** Optional warnings remain visible and are never included in the pass count. */
export function smokeOutcome(results) {
  return {
    passed: results.filter((result) => result.ok).length,
    total: results.length,
    failed: results.filter((result) => result.required && !result.ok).length,
    warnings: results.filter((result) => !result.required && !result.ok).length,
  };
}

// The chapter's "Open in Raster Studio" button also contains the editor's name.
// Only the mounted editor dialog establishes that the editor is still open.
export const rasterDialogSelector = '[role="dialog"].pro-studio';
