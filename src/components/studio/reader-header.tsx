import { useEffect, useState } from "react";
import { readerScroll } from "@/lib/studio/reader-scroll";

export function ReaderHeader({ chapter, project }: { chapter: string; project: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    let previous = window.scrollY,
      direction = 0,
      distance = 0,
      frame = 0;
    const update = () => {
      const state = readerScroll(previous, window.scrollY, direction, distance);
      previous = state.y;
      direction = state.direction;
      distance = state.distance;
      if (state.visible !== undefined) setVisible(state.visible);
      frame = 0;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    // Remains in normal flow: hiding this metadata never shifts or covers artwork.
    <header className="reader-chapter-info" data-hidden={!visible} aria-hidden={!visible}>
      <div>
        <p className="eyebrow">Now reading</p>
        <h3 className="font-display text-xl">{chapter}</h3>
      </div>
      <p className="truncate text-xs text-muted">{project}</p>
    </header>
  );
}
