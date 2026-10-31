import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/** Starts downloading the Chapter workspace code before a create flow navigates there,
 * so the click does not wait on the route chunk. Code only: the route has no loader,
 * no data is fetched and nothing renders. A failed preload is retried on navigation. */
export function usePreloadChapterRoute(when = true) {
  const router = useRouter();
  useEffect(() => {
    if (!when) return;
    const route = router.routesById["/p/$projectId/c/$chapterId"];
    if (route) void Promise.resolve(router.loadRouteChunk(route)).catch(() => undefined);
  }, [router, when]);
}
