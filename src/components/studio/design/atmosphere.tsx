import { useEffect, useRef } from "react";
export function Atmosphere() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      el.dataset.inView = String(!!entry?.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="studio-atmosphere" aria-hidden="true" data-in-view="true">
      <span className="ambient-light ambient-one" />
      <span className="ambient-light ambient-two" />
      <span className="ambient-grid" />
    </div>
  );
}
