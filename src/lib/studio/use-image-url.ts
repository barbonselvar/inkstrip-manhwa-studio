import { useEffect, useState } from "react";
import { preflightImage } from "./image-policy";

/** Blob URLs consumed by <img> are also decode boundaries (including old drafts). */
export function useImageUrl(blob: Blob) {
  const [result, setResult] = useState<{ blob: Blob; url: string; error: string }>();
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    void preflightImage(blob, undefined, controller.signal)
      .then((info) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(
          blob.type === info.mime ? blob : blob.slice(0, blob.size, info.mime),
        );
        setResult({ blob, url, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ blob, url: "", error: (error as Error).message });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob]);
  return result?.blob === blob ? result : { url: "", error: "" };
}
