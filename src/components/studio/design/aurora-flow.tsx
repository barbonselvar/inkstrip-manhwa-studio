import { useEffect, useRef } from "react";
/** Bounded CSS light ribbons. Uses no WebGL context, animation loop or per-frame state. */
export function AuroraFlow() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const hints = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean };
    };
    element.dataset.quality =
      hints.connection?.saveData ||
      (hints.deviceMemory ?? 8) < 4 ||
      (hints.hardwareConcurrency ?? 8) < 4
        ? "quiet"
        : "full";
    const observer = new IntersectionObserver(([entry]) => {
      element.dataset.inView = String(!!entry?.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={root}
      className="studio-atmosphere aurora-flow"
      aria-hidden="true"
      data-in-view="true"
    >
      <span className="aurora-ribbon ambient-one" />
      <span className="aurora-ribbon aurora-second" />
      <span className="aurora-vignette" />
    </div>
  );
}
