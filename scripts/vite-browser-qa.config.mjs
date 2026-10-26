/** Local browser QA only. Production continues to use ../vite.config.ts.
 * OCR's nested worker entry is not discovered by Vite's initial page crawl.
 * Pre-bundle its dependencies at startup so first inference cannot reload a
 * page that is already executing an unchanged browser test. */
import original from "../vite.config.ts";

export default async (env) => {
  const config = await original(env);
  return {
    ...config,
    optimizeDeps: {
      ...config.optimizeDeps,
      include: [
        ...new Set([...(config.optimizeDeps?.include ?? []), "tesseract.js", "idb-keyval"]),
      ],
    },
  };
};
