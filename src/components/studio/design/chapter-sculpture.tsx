import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowDown, Layers3 } from "lucide-react";
import { DepthSurface } from "./depth-surface";
const RobotCompanion = lazy(() =>
  import("./robot-companion").then((module) => ({ default: module.RobotCompanion })),
);
type DeviceHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
};

/** The 3D companion is decorative and costs ~0.5 MB of three.js, so it is only fetched
 * where motion is welcome and the device can comfortably afford it. */
function canAffordCompanion() {
  const nav = navigator as DeviceHints;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (document.documentElement.dataset.studioMotion === "quiet") return false;
  if (nav.connection?.saveData) return false;
  if ((nav.deviceMemory ?? 8) < 4) return false;
  if ((nav.hardwareConcurrency ?? 8) < 4) return false;
  return window.matchMedia("(min-width: 640px)").matches;
}

function useCompanionAllowed() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => setAllowed(canAffordCompanion()), []);
  return allowed;
}

/** Hero artwork and its animated companion; neither represents a stored project. */
export function ChapterSculpture() {
  const companion = useCompanionAllowed();
  return (
    <DepthSurface className="chapter-sculpture">
      {companion ? (
        <Suspense fallback={null}>
          <RobotCompanion />
        </Suspense>
      ) : null}
      <div className="sculpture-halo" />
      <div className="sculpture-orbit" />
      <div className="sculpture-sheet sheet-back">
        <span>THE ART OF</span>
        <strong>
          what
          <br />
          comes
          <br />
          next.
        </strong>
      </div>
      <div className="sculpture-sheet sheet-mid">
        <Layers3 />
        <div className="ink-lines" />
      </div>
      <div className="sculpture-sheet sheet-front">
        <div className="print-topline">
          <span>INKSTRIP</span>
          <span>VOL. 01</span>
        </div>
        <div className="print-composition">
          <div className="print-eclipse" />
          <div className="print-horizon" />
          <span className="print-index">01</span>
        </div>
        <div className="print-bottomline">
          <span>
            ONE FRAME.
            <br />
            ENDLESS POSSIBILITY.
          </span>
          <ArrowDown className="size-5" />
        </div>
      </div>
      <span className="sculpture-caption">A SPACE FOR YOUR NEXT WORLD</span>
    </DepthSurface>
  );
}
