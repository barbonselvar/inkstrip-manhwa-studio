/**
 * Chooses which GitHub Release the desktop updater may use. Pure logic, unit-tested.
 *
 * The repository also publishes Android (`app-v*`) releases, so electron-updater's
 * "repository latest release" lookup is not safe here. Only a published, non-draft,
 * non-prerelease release tagged `desktop-v<major.minor.patch>` that carries the complete
 * electron-updater metadata is eligible, and only when it is newer than the running app
 * (no downgrades).
 */

export const DESKTOP_TAG_PREFIX = "desktop-v";

export type GithubReleaseLike = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  assets?: unknown;
};

export type EligibleRelease = {
  tag: string;
  version: string;
  notes: string;
  pageUrl: string;
  publishedAt: string;
  feedUrl: string;
  installer: string;
};

export function parseVersion(value: string): [number, number, number] | null {
  const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: string, b: string) {
  const x = parseVersion(a),
    y = parseVersion(b);
  if (!x || !y) throw new Error("Invalid version.");
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

const REQUIRED_ASSETS = [/^latest\.yml$/, /^Inkstrip-Manhwa-Studio-Setup-[\d.]+\.exe$/, /\.exe\.blockmap$/];

export function pickRelease(
  releases: unknown,
  currentVersion: string,
  repo: string,
): EligibleRelease | null {
  if (!Array.isArray(releases)) return null;
  let best: EligibleRelease | null = null;
  for (const raw of releases as GithubReleaseLike[]) {
    if (!raw || raw.draft !== false || raw.prerelease !== false) continue;
    if (typeof raw.tag_name !== "string" || !raw.tag_name.startsWith(DESKTOP_TAG_PREFIX)) continue;
    const version = raw.tag_name.slice(DESKTOP_TAG_PREFIX.length);
    if (!parseVersion(version) || compareVersions(version, currentVersion) <= 0) continue;
    const names = Array.isArray(raw.assets)
      ? (raw.assets as { name?: unknown; state?: unknown }[])
          .filter((a) => a && typeof a.name === "string" && (a.state === undefined || a.state === "uploaded"))
          .map((a) => a.name as string)
      : [];
    if (!REQUIRED_ASSETS.every((re) => names.some((n) => re.test(n)))) continue;
    const installer = names.find((n) => REQUIRED_ASSETS[1]!.test(n))!;
    if (installer !== `Inkstrip-Manhwa-Studio-Setup-${version}.exe`) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = {
      tag: raw.tag_name,
      version,
      notes: typeof raw.body === "string" ? raw.body.slice(0, 20_000) : "",
      pageUrl:
        typeof raw.html_url === "string" && raw.html_url.startsWith(`https://github.com/${repo}/releases/`)
          ? raw.html_url
          : `https://github.com/${repo}/releases/tag/${raw.tag_name}`,
      publishedAt: typeof raw.published_at === "string" ? raw.published_at : "",
      feedUrl: `https://github.com/${repo}/releases/download/${raw.tag_name}/`,
      installer,
    };
  }
  return best;
}

/** A local test feed is accepted only from the loopback interface (controlled update tests). */
export function isLoopbackFeed(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Network-level failures (no connection, DNS, proxy, timeout, refused) mean "can't reach
 * the release server": shown calmly as offline. Anything else (HTTP errors, bad metadata)
 * is a real update error.
 */
export function isNetworkFailure(message: string, online: boolean) {
  return (
    !online ||
    /net::ERR_|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|TimeoutError|timed out|Failed to fetch/i.test(message)
  );
}
