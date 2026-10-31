import { Modal } from "@/components/ui/modal";
import {
  formatBytes,
  isInsideNativeApp,
  loadNativeRelease,
  NATIVE_APPS_RELEASES_PAGE,
  suggestedPlatform,
  type NativeDownload,
  type NativePlatform,
  type NativeRelease,
} from "@/lib/native-apps/releases";
import { ArrowUpRight, Download, MonitorDown, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; release: NativeRelease | null }
  | { status: "error"; message: string };

const PLATFORMS: Record<
  NativePlatform,
  {
    title: string;
    action: string;
    requirement: string;
    icon: typeof Smartphone;
    install: string;
    unsignedNote: string;
  }
> = {
  android: {
    title: "Android",
    action: "Download APK",
    requirement: "Android 7.0 or newer",
    icon: Smartphone,
    install: "Open the downloaded APK and allow your browser to install apps when Android asks.",
    unsignedNote:
      "Test build signed with a development key. Uninstall it before installing a future signed release.",
  },
  windows: {
    title: "Windows",
    action: "Download EXE installer",
    requirement: "Windows 10 or 11, 64-bit",
    icon: MonitorDown,
    install:
      "Run the installer. It installs for your user account only, no administrator rights needed.",
    unsignedNote:
      "Test build without a code-signing certificate. Windows SmartScreen may warn: choose More info → Run anyway.",
  },
};

/** "Download App" entry point for the homepage. Hidden inside the Android/Windows apps themselves. */
export function DownloadAppButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(isInsideNativeApp()), []);
  if (hidden) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Download className="size-4" />
        Download App
      </button>
      <DownloadAppDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function DownloadAppDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [suggested, setSuggested] = useState<NativePlatform | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setSuggested(suggestedPlatform(navigator.userAgent));
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    loadNativeRelease().then(
      (release) => live && setState({ status: "ready", release }),
      (error: unknown) =>
        live &&
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      live = false;
    };
  }, [open]);

  const order: NativePlatform[] =
    suggested === "windows" ? ["windows", "android"] : ["android", "windows"];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Download Inkstrip"
      description="Install Inkstrip as an app on your phone or PC. Your projects stay on each device."
    >
      <div className="download-app-grid" aria-busy={state.status === "loading"}>
        {order.map((platform) => (
          <PlatformCard
            key={platform}
            platform={platform}
            suggested={platform === suggested}
            state={state}
            download={state.status === "ready" ? state.release?.downloads[platform] : undefined}
          />
        ))}
      </div>
      <p className="download-app-footer">
        {state.status === "ready" && state.release ? (
          <>
            Version {state.release.version}
            {state.release.publishedAt
              ? ` · ${new Date(state.release.publishedAt).toLocaleDateString()}`
              : ""}{" "}
            ·{" "}
          </>
        ) : null}
        <a
          href={
            state.status === "ready" && state.release
              ? state.release.pageUrl
              : NATIVE_APPS_RELEASES_PAGE
          }
          target="_blank"
          rel="noreferrer"
          className="focus-ring"
        >
          Release notes and all versions
          <ArrowUpRight className="inline size-3" />
        </a>
      </p>
    </Modal>
  );
}

function PlatformCard({
  platform,
  suggested,
  state,
  download,
}: {
  platform: NativePlatform;
  suggested: boolean;
  state: LoadState;
  download: NativeDownload | undefined;
}) {
  const info = PLATFORMS[platform];
  const Icon = info.icon;
  return (
    <section
      className="download-app-card"
      data-suggested={suggested || undefined}
      aria-label={info.title}
    >
      <header>
        <Icon className="size-5" aria-hidden />
        <h3>{info.title}</h3>
        {suggested ? <span className="download-app-tag">This device</span> : null}
      </header>
      <p className="download-app-req">{info.requirement}</p>
      {state.status === "loading" ? (
        <p className="download-app-status">Checking the latest release…</p>
      ) : state.status === "error" ? (
        <p className="download-app-status">
          Couldn't reach GitHub ({state.message}). Use “Release notes and all versions” below.
        </p>
      ) : !download ? (
        <p className="download-app-status">No {info.title} installer has been published yet.</p>
      ) : (
        <>
          <a
            className="download-app-action focus-ring"
            href={download.url}
            download={download.fileName}
          >
            <Download className="size-4" />
            {info.action}
          </a>
          <p className="download-app-meta">
            {download.fileName}
            {download.bytes ? ` · ${formatBytes(download.bytes)}` : ""}
          </p>
          <span
            className={download.signed ? "download-app-badge signed" : "download-app-badge test"}
          >
            {download.signed ? "Signed release" : "Test build · unsigned"}
          </span>
          {!download.signed ? <p className="download-app-note">{info.unsignedNote}</p> : null}
          <p className="download-app-note">{info.install}</p>
          {download.sha256 ? (
            <details className="download-app-hash">
              <summary>SHA-256 checksum</summary>
              <code>{download.sha256}</code>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
