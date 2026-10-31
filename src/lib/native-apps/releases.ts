/**
 * Native app downloads (Android APK / Windows installer) published as GitHub Release
 * assets by `.github/workflows/native-apps.yml`. Only real, published release assets
 * are ever offered; when none exist the UI says so instead of showing a dead link.
 */

export const NATIVE_APPS_REPO = "barbonselvar/inkstrip-manhwa-studio";
export const NATIVE_APPS_RELEASES_PAGE = `https://github.com/${NATIVE_APPS_REPO}/releases`;
const RELEASES_API = `https://api.github.com/repos/${NATIVE_APPS_REPO}/releases?per_page=30`;
/** Native app releases are tagged `app-v<semver>`; other repository releases are ignored. */
export const NATIVE_APP_TAG_PREFIX = "app-v";

export type NativePlatform = "android" | "windows";

export interface NativeDownload {
  platform: NativePlatform;
  fileName: string;
  url: string;
  bytes: number;
  /** Lowercase hex SHA-256 when GitHub reports an asset digest. */
  sha256: string | null;
  /** False for clearly labelled development/test builds (debug-signed APK, unsigned EXE). */
  signed: boolean;
}

export interface NativeRelease {
  version: string;
  tag: string;
  pageUrl: string;
  publishedAt: string | null;
  downloads: Partial<Record<NativePlatform, NativeDownload>>;
}

interface GithubAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  digest?: unknown;
  state?: unknown;
}

interface GithubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

const ASSET_PATTERNS: Record<NativePlatform, RegExp> = {
  // Inkstrip-1.2.0-android.apk | Inkstrip-1.2.0-android-test.apk
  android: /^Inkstrip-[\w.+-]+-android(-test)?\.apk$/,
  // Inkstrip-1.2.0-windows-x64-setup.exe | Inkstrip-1.2.0-windows-x64-setup-unsigned.exe
  windows: /^Inkstrip-[\w.+-]+-windows-x64-setup(-unsigned)?\.exe$/,
};

const DOWNLOAD_HOST = "https://github.com/";

function toDownload(platform: NativePlatform, asset: GithubAsset): NativeDownload | null {
  if (typeof asset.name !== "string" || typeof asset.browser_download_url !== "string") return null;
  if (asset.state !== undefined && asset.state !== "uploaded") return null;
  const match = ASSET_PATTERNS[platform].exec(asset.name);
  if (!match) return null;
  // Only accept downloads served from this repository's release storage.
  if (
    !asset.browser_download_url.startsWith(`${DOWNLOAD_HOST}${NATIVE_APPS_REPO}/releases/download/`)
  )
    return null;
  const digest =
    typeof asset.digest === "string" && /^sha256:[0-9a-f]{64}$/i.test(asset.digest)
      ? asset.digest.slice(7).toLowerCase()
      : null;
  return {
    platform,
    fileName: asset.name,
    url: asset.browser_download_url,
    bytes: typeof asset.size === "number" && asset.size > 0 ? asset.size : 0,
    sha256: digest,
    signed: !match[1],
  };
}

/** Picks the newest published, non-prerelease `app-v*` release that carries at least one installer. */
export function pickNativeRelease(payload: unknown): NativeRelease | null {
  if (!Array.isArray(payload)) return null;
  for (const raw of payload as GithubRelease[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.draft === true || raw.prerelease === true) continue;
    if (typeof raw.tag_name !== "string" || !raw.tag_name.startsWith(NATIVE_APP_TAG_PREFIX))
      continue;
    const assets = Array.isArray(raw.assets) ? (raw.assets as GithubAsset[]) : [];
    const downloads: NativeRelease["downloads"] = {};
    for (const platform of ["android", "windows"] as const) {
      for (const asset of assets) {
        const download = asset && typeof asset === "object" ? toDownload(platform, asset) : null;
        // Prefer a signed build when a release carries both.
        if (
          download &&
          (!downloads[platform] || (download.signed && !downloads[platform]!.signed))
        ) {
          downloads[platform] = download;
        }
      }
    }
    if (!downloads.android && !downloads.windows) continue;
    return {
      version: raw.tag_name.slice(NATIVE_APP_TAG_PREFIX.length),
      tag: raw.tag_name,
      pageUrl:
        typeof raw.html_url === "string" &&
        raw.html_url.startsWith(`${DOWNLOAD_HOST}${NATIVE_APPS_REPO}/`)
          ? raw.html_url
          : NATIVE_APPS_RELEASES_PAGE,
      publishedAt: typeof raw.published_at === "string" ? raw.published_at : null,
      downloads,
    };
  }
  return null;
}

let cached: Promise<NativeRelease | null> | null = null;

/** Fetches the latest native release once per page load (GitHub's anonymous API allows 60 requests/hour/IP). */
export function loadNativeRelease(fetcher: typeof fetch = fetch): Promise<NativeRelease | null> {
  cached ??= fetcher(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
      return pickNativeRelease(await response.json());
    })
    .catch((error: unknown) => {
      cached = null; // allow a retry
      throw error;
    });
  return cached;
}

/** True inside the Inkstrip Android (Capacitor) or Windows (Tauri) app. */
export function isInsideNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    __INKSTRIP_DESKTOP__?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return (
    Boolean(w.__INKSTRIP_DESKTOP__) ||
    Boolean(w.Capacitor?.isNativePlatform?.()) ||
    /\bInkstripApp\//.test(navigator.userAgent)
  );
}

/** The platform to highlight for this visitor, if any. */
export function suggestedPlatform(userAgent: string): NativePlatform | null {
  if (/Android/i.test(userAgent)) return "android";
  if (/Windows NT/i.test(userAgent)) return "windows";
  return null;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
