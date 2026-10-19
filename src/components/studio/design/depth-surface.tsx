import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
/** Event-driven CSS depth. No idle animation loop and never used on artwork editing planes. */
export function DepthSurface({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const root = useRef<HTMLDivElement>(null),
    frame = useRef(0),
    point = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const allowed = () =>
      matchMedia("(hover:hover) and (pointer:fine)").matches &&
      !matchMedia("(prefers-reduced-motion:reduce)").matches &&
      document.documentElement.dataset.studioMotion !== "quiet";
    const move = (event: PointerEvent) => {
      if (!allowed() || event.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      point.current = {
        x: (event.clientX - r.left) / r.width - 0.5,
        y: (event.clientY - r.top) / r.height - 0.5,
      };
      if (!frame.current)
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          el.style.setProperty("--depth-x", `${point.current.x * 5}deg`);
          el.style.setProperty("--depth-y", `${-point.current.y * 4}deg`);
          el.style.setProperty("--light-shift", `${point.current.x * 12}px`);
        });
    };
    const reset = () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      el.style.setProperty("--depth-x", "0deg");
      el.style.setProperty("--depth-y", "0deg");
      el.style.setProperty("--light-shift", "0px");
    };
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerleave", reset);
    window.addEventListener("blur", reset);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", reset);
      window.removeEventListener("blur", reset);
      reset();
    };
  }, []);
  return (
    <div ref={root} className={`depth-surface ${className}`} style={style}>
      {children}
    </div>
  );
}
