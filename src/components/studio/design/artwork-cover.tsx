import { useEffect, useRef, useState } from "react";
import { Layers3, Image as ImageIcon } from "lucide-react";
import { getBlob } from "@/lib/studio/db";
/** Lazy thumbnails only. Each component owns and releases its URL; no storage writes. */
export function ArtworkCover({
  thumbId,
  label = "No artwork yet",
  index = 0,
}: {
  thumbId?: string;
  label?: string;
  index?: number;
}) {
  const root = useRef<HTMLSpanElement>(null),
    [src, setSrc] = useState("");
  useEffect(() => {
    let active = true,
      url = "",
      started = false;
    setSrc("");
    const load = () => {
      if (started || !thumbId) return;
      started = true;
      void getBlob(thumbId)
        .then((blob) => {
          if (!active || !blob) return;
          url = URL.createObjectURL(blob);
          setSrc(url);
        })
        .catch(() => {});
    };
    let observer: IntersectionObserver | undefined;
    if (root.current && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            load();
            observer?.disconnect();
          }
        },
        { rootMargin: "200px" },
      );
      observer.observe(root.current);
    } else load();
    return () => {
      active = false;
      observer?.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [thumbId]);
  return (
    <span ref={root} className="artwork-cover" data-loaded={!!src}>
      {src ? (
        <img src={src} alt="" decoding="async" loading="lazy" draggable={false} />
      ) : (
        <span className="cover-placeholder" aria-hidden="true">
          <span className="cover-orbit" />
          <Layers3 />
          <span className="cover-number">{String(index + 1).padStart(2, "0")}</span>
          <span className="cover-rule" />
        </span>
      )}
      <span className="cover-caption">
        <ImageIcon className="size-3" />
        {src ? "Chapter artwork" : label}
      </span>
    </span>
  );
}
