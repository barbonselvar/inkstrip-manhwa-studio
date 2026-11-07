/**
 * Owner-approved GitHub Releases → installed app updates (electron-updater, NSIS).
 *
 * Trust rules:
 * - Only `desktop-v<semver>` releases that are published, stable, newer, and carry
 *   complete updater metadata are considered (see update-feed.ts). No downgrades.
 * - Metadata and installers come over HTTPS from github.com. electron-updater verifies
 *   the SHA-512 in latest.yml, and verifies the downloaded installer's Authenticode
 *   signature against the publisher recorded in app-update.yml at build time.
 * - Automatic download/installation is enabled only when the running application is
 *   itself validly signed and that publisher is pinned. Unsigned (test) builds can still
 *   tell the user a release exists and open its page, but never install it.
 * - Installation happens only after the user clicks "Install and Restart" and the
 *   renderer has saved/preserved all open work.
 */
import { app, net } from "electron";
import { CancellationToken, autoUpdater, type ProgressInfo } from "electron-updater";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppInfo, DesktopSettings, UpdateState } from "../../../../src/lib/desktop/contract.ts";
import { isLoopbackFeed, isNetworkFailure, pickRelease, type EligibleRelease } from "./update-feed.ts";
import { log } from "./logger.ts";

export const RELEASE_REPO = "barbonselvar/inkstrip-manhwa-studio";
const CHECK_EVERY = 6 * 60 * 60 * 1000;

export async function executableSignature(): Promise<AppInfo["signed"]> {
  if (process.platform !== "win32" || !app.isPackaged) return "unknown";
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-AuthenticodeSignature -LiteralPath $env:INKSTRIP_EXE).Status.ToString()",
      ],
      { env: { ...process.env, INKSTRIP_EXE: process.execPath }, timeout: 20_000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve("unknown");
        const status = stdout.trim();
        resolve(status === "Valid" ? "valid" : status === "NotSigned" ? "unsigned" : "invalid");
      },
    );
  });
}

async function pinnedPublisher(): Promise<boolean> {
  try {
    const yml = await readFile(join(process.resourcesPath, "app-update.yml"), "utf8");
    return /^publisherName:\s*\S/m.test(yml) || /^publisherName:\s*\n\s+-\s*\S/m.test(yml);
  } catch {
    return false;
  }
}

export class UpdateService {
  private state: UpdateState = { status: "idle", lastCheckedAt: null };
  private installable = false;
  private reason = "";
  private release: EligibleRelease | null = null;
  private cancel: CancellationToken | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly testFeed: string | null;

  constructor(
    private readonly options: {
      settings: () => Promise<DesktopSettings>;
      emit: (state: UpdateState) => void;
      signature: Promise<AppInfo["signed"]>;
    },
  ) {
    const feed = process.env.INKSTRIP_UPDATE_TEST_FEED ?? "";
    this.testFeed = feed && isLoopbackFeed(feed) ? feed : null;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.fullChangelog = false;
    // Only complete, verified NSIS installers are accepted (no web-installer packages).
    if ("disableWebInstaller" in autoUpdater) (autoUpdater as { disableWebInstaller: boolean }).disableWebInstaller = true;
    autoUpdater.logger = { info: (m) => log.info(`[updater] ${m}`), warn: (m) => log.warn(`[updater] ${m}`), error: (m) => log.error(`[updater] ${m}`), debug: () => {} };
    autoUpdater.on("download-progress", (p: ProgressInfo) => {
      if (this.state.status !== "downloading") return;
      this.set({
        ...this.state,
        percent: Math.max(0, Math.min(100, p.percent)),
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond,
      });
    });
  }

  get current() {
    return this.state;
  }

  private set(state: UpdateState) {
    this.state = state;
    this.options.emit(state);
  }

  async init() {
    if (!app.isPackaged && !this.testFeed) {
      this.reason = "Updates are delivered to the installed app.";
      this.set({ status: "disabled", reason: this.reason, canCheckManually: false });
      return;
    }
    const signed = await this.options.signature;
    if (this.testFeed) {
      this.installable = true;
      log.warn(`[updater] Using loopback test feed ${this.testFeed}`);
    } else if (signed === "valid" && (await pinnedPublisher())) {
      this.installable = true;
    } else {
      this.installable = false;
      this.reason =
        "This is an unsigned test build, so automatic installation is turned off. You can still check for releases and download them from GitHub.";
    }
    const settings = await this.options.settings();
    if (settings.updates.autoCheck) {
      setTimeout(() => void this.check(false), 8000);
      this.timer = setInterval(() => void this.check(false), CHECK_EVERY);
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.cancel?.cancel();
  }

  async check(manual: boolean): Promise<UpdateState> {
    if (this.state.status === "checking" || this.state.status === "downloading") return this.state;
    if (this.state.status === "downloaded") return this.state;
    if (!app.isPackaged && !this.testFeed) return this.state;
    this.set({ status: "checking" });
    try {
      if (this.testFeed) {
        autoUpdater.setFeedURL({ provider: "generic", url: this.testFeed });
        const result = await autoUpdater.checkForUpdates();
        const info = result?.updateInfo;
        if (!info || !result.isUpdateAvailable) {
          this.set({ status: "not-available", lastCheckedAt: Date.now() });
          return this.state;
        }
        this.release = {
          tag: `desktop-v${info.version}`,
          version: info.version,
          notes: typeof info.releaseNotes === "string" ? info.releaseNotes : "",
          pageUrl: this.testFeed,
          publishedAt: info.releaseDate,
          feedUrl: this.testFeed,
          installer: "",
        };
      } else {
        const response = await net.fetch(
          `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`,
          {
            headers: { accept: "application/vnd.github+json", "user-agent": "Inkstrip-Desktop-Updater" },
            // Always ask GitHub (a cached answer could hide a new release or a lost connection).
            cache: "no-store",
            signal: AbortSignal.timeout(20_000),
          },
        );
        if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
        this.release = pickRelease(await response.json(), app.getVersion(), RELEASE_REPO);
        if (!this.release) {
          this.set({ status: "not-available", lastCheckedAt: Date.now() });
          return this.state;
        }
        if (this.installable) {
          autoUpdater.setFeedURL({ provider: "generic", url: this.release.feedUrl });
          const result = await autoUpdater.checkForUpdates();
          if (!result?.isUpdateAvailable || result.updateInfo.version !== this.release.version)
            throw new Error("The release metadata does not match the published version.");
        }
      }
      const release = this.release!;
      this.set({
        status: "available",
        version: release.version,
        notes: release.notes,
        releaseDate: release.publishedAt,
        pageUrl: release.pageUrl,
        installable: this.installable,
      });
      if (this.installable && (await this.options.settings()).updates.autoDownload && !manual)
        void this.download();
      return this.state;
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      const offline = isNetworkFailure(message, net.isOnline());
      log.warn("[updater] check failed", message);
      this.set({
        status: "error",
        offline,
        message: offline
          ? "Can't reach GitHub right now (offline or blocked). Inkstrip works fully offline and will check for updates later."
          : `Could not check for updates: ${message}`,
      });
      return this.state;
    }
  }

  async download(): Promise<UpdateState> {
    if (this.state.status !== "available" || !this.installable || !this.release) return this.state;
    const { version, notes } = this.release;
    this.set({ status: "downloading", version, notes, percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
    this.cancel = new CancellationToken();
    try {
      await autoUpdater.downloadUpdate(this.cancel);
      this.set({ status: "downloaded", version, notes, releaseDate: this.release.publishedAt });
    } catch (error) {
      const cancelled = this.cancel?.cancelled;
      log.warn("[updater] download failed", error);
      this.set(
        cancelled
          ? {
              status: "available",
              version,
              notes,
              releaseDate: this.release.publishedAt,
              pageUrl: this.release.pageUrl,
              installable: true,
            }
          : {
              status: "error",
              offline: !net.isOnline(),
              message: `The update download failed and was discarded (${(error as Error).message}). Your installed version is unchanged; try again later.`,
            },
      );
    } finally {
      this.cancel = null;
    }
    return this.state;
  }

  cancelDownload() {
    this.cancel?.cancel();
    return this.state;
  }

  /** Only after the renderer confirmed that all work is saved or preserved. */
  install() {
    if (this.state.status !== "downloaded") throw new Error("No verified update is ready to install.");
    log.info(`[updater] Installing ${this.state.version}`);
    // Silent NSIS update (same install mode/folder), then relaunch Inkstrip.
    autoUpdater.quitAndInstall(true, true);
  }
}
