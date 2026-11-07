/**
 * Storage locations, kept apart from the installation folder so updates, reinstalls
 * and uninstalls never touch user data.
 *
 *   %APPDATA%\Inkstrip Manhwa Studio\        settings\  metadata\  recovery\  backups\
 *   %LOCALAPPDATA%\Inkstrip Manhwa Studio\   Workspace\ (Chromium profile: the working
 *                                            copy of every project in IndexedDB, AI model
 *                                            cache)  logs\  temp\  models\
 *
 * `.inkstrip` project files live wherever the user saves them (default: Documents\Inkstrip).
 */
import { app } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const PRODUCT_NAME = "Inkstrip Manhwa Studio";

export type AppPaths = ReturnType<typeof computePaths>;

function computePaths() {
  // Automated tests run each scenario in its own throw-away profile.
  const testProfile = process.env.INKSTRIP_PROFILE_DIR;
  const roaming = join(testProfile ? join(testProfile, "Roaming") : app.getPath("appData"), PRODUCT_NAME);
  const local = join(
    testProfile ? join(testProfile, "Local") : process.env.LOCALAPPDATA || app.getPath("appData"),
    PRODUCT_NAME,
  );
  return {
    roaming,
    local,
    settings: join(roaming, "settings"),
    metadata: join(roaming, "metadata"),
    recovery: join(roaming, "recovery"),
    backups: join(roaming, "backups"),
    workspace: join(local, "Workspace"),
    logs: join(local, "logs"),
    temp: join(local, "temp"),
    models: join(local, "models"),
    cache: join(local, "cache"),
    documents: join(testProfile ? join(testProfile, "Documents") : app.getPath("documents"), "Inkstrip"),
  };
}

let paths: AppPaths | null = null;

/** Must run before `app.ready` (session data location is fixed at startup). */
export function configurePaths(): AppPaths {
  paths = computePaths();
  for (const dir of [
    paths.settings,
    paths.metadata,
    paths.recovery,
    paths.backups,
    paths.workspace,
    paths.logs,
    paths.temp,
    paths.models,
    paths.cache,
  ])
    mkdirSync(dir, { recursive: true });
  app.setPath("userData", paths.roaming);
  app.setPath("sessionData", paths.workspace);
  app.setPath("temp", paths.temp);
  app.setPath("crashDumps", join(paths.local, "crashes"));
  app.setAppLogsPath(paths.logs);
  return paths;
}

export function appPaths(): AppPaths {
  if (!paths) throw new Error("Paths not configured.");
  return paths;
}
