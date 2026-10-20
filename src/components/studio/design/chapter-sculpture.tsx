import { lazy, Suspense } from "react";
import { ArrowDown, Layers3 } from "lucide-react";
import { DepthSurface } from "./depth-surface";
const RobotCompanion = lazy(() =>
  import("./robot-companion").then((module) => ({ default: module.RobotCompanion })),
);
/** Hero artwork and its animated companion; neither represents a stored project. */
export function ChapterSculpture() {
  return (
    <DepthSurface className="chapter-sculpture">
      <Suspense fallback={null}>
        <RobotCompanion />
      </Suspense>
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
