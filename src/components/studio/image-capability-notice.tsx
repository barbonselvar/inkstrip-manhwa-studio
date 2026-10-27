import { useEffect, useState } from "react";
import { browserCapabilityBudgets, imageCapabilities } from "@/lib/studio/image-capabilities";
export function ImageCapabilityNotice({ width, height }: { width?: number; height?: number }) {
  const [budgets, setBudgets] = useState<ReturnType<typeof browserCapabilityBudgets> | null>(null);
  useEffect(() => setBudgets(browserCapabilityBudgets()), []);
  if (!budgets) return null;
  const selected = width && height ? imageCapabilities(width, height, budgets) : undefined,
    mp = (n: number) => `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}MP`;
  return (
    <details className="image-capability-notice tool-section">
      <summary>Image limits on this device</summary>
      <div className="tool-section-body">
        <ul className="pro-help">
          <li>
            Chapter import: {mp(budgets.import.maxPixels)} · {budgets.import.maxSide}px per side ·{" "}
            {Math.floor(budgets.import.maxBytes / 1048576)}MiB per file.
          </li>
          <li>
            Raster editing and image export: {mp(budgets.raster)} · {budgets.rasterSide}px per side.
          </li>
          <li>
            Smart Filters: {mp(Math.min(budgets.smart, budgets.raster))}; filter radius and layer
            count also affect availability.
          </li>
          <li>
            On-device AI enhancement: {mp(budgets.enhance)} · {budgets.enhanceSide}px per side.
            Cloud repair uses a selected context up to1024px; it does not process a whole long page.
          </li>
        </ul>
        {selected && (
          <p className="pro-help" role="status">
            {width} × {height}:{" "}
            {selected.rasterEdit ? "within Raster's pixel limit" : "above Raster's pixel limit"};{" "}
            {selected.smartFilters
              ? "within Smart Filter's pixel limit"
              : "above Smart Filter's pixel limit"}
            . Base RGBA plane: {(selected.baseRgbaBytes / 1048576).toFixed(1)}MiB.
          </p>
        )}
        <p className="pro-help">
          Layer, mask, file-size and memory checks still apply. Source images are never silently
          reduced. Large chapter images can remain readable even when Raster editing is unavailable.
        </p>
      </div>
    </details>
  );
}
