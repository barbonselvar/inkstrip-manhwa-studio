import { memo, useState, useEffect } from "react";
import type { CompositionObject } from "@/lib/studio/composition/model";
import { renderObjectThumbnail } from "@/lib/studio/composition/render";
export const Thumbnail = memo(function Thumbnail({ object }: { object: CompositionObject }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    void document.fonts.ready
      .then(() => renderObjectThumbnail(object))
      .then((url) => {
        if (alive) setSrc(url);
      });
    return () => {
      alive = false;
    };
  }, [object]);
  return src ? (
    <img alt="" src={src} loading="lazy" width={180} height={100} />
  ) : (
    <span className="composition-thumbnail-loading" />
  );
});
