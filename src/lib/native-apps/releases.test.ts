import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBytes, pickNativeRelease, suggestedPlatform } from "./releases.ts";

const base = "https://github.com/barbonselvar/inkstrip-manhwa-studio/releases/download/app-v1.0.0/";
const sha = "a".repeat(64);
const asset = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  browser_download_url: base + name,
  size: 5_242_880,
  digest: `sha256:${sha}`,
  state: "uploaded",
  ...extra,
});

test("picks the newest stable app release and labels test builds", () => {
  const release = pickNativeRelease([
    {
      tag_name: "app-v2.0.0-beta.1",
      prerelease: true,
      assets: [asset("Inkstrip-2.0.0-beta.1-android.apk")],
    },
    { tag_name: "app-v1.1.0", draft: true, assets: [asset("Inkstrip-1.1.0-android.apk")] },
    { tag_name: "v9.9.9", assets: [asset("Inkstrip-9.9.9-android.apk")] },
    {
      tag_name: "app-v1.0.0",
      html_url: "https://github.com/barbonselvar/inkstrip-manhwa-studio/releases/tag/app-v1.0.0",
      published_at: "2026-10-31T00:00:00Z",
      assets: [
        asset("SHA256SUMS.txt"),
        asset("Inkstrip-1.0.0-android-test.apk"),
        asset("Inkstrip-1.0.0-windows-x64-setup-unsigned.exe", { digest: null }),
      ],
    },
  ]);
  assert.ok(release);
  assert.equal(release.version, "1.0.0");
  assert.equal(release.downloads.android?.signed, false);
  assert.equal(release.downloads.android?.sha256, sha);
  assert.equal(release.downloads.android?.url, base + "Inkstrip-1.0.0-android-test.apk");
  assert.equal(release.downloads.windows?.signed, false);
  assert.equal(release.downloads.windows?.sha256, null);
});

test("prefers signed assets and rejects foreign or incomplete uploads", () => {
  const release = pickNativeRelease([
    {
      tag_name: "app-v1.2.0",
      assets: [
        asset("Inkstrip-1.2.0-android-test.apk"),
        asset("Inkstrip-1.2.0-android.apk"),
        asset("Inkstrip-1.2.0-windows-x64-setup.exe", {
          browser_download_url: "https://evil.example/x.exe",
        }),
        asset("Inkstrip-1.2.0-windows-x64-setup-unsigned.exe", { state: "starter" }),
      ],
    },
  ]);
  assert.equal(release?.downloads.android?.fileName, "Inkstrip-1.2.0-android.apk");
  assert.equal(release?.downloads.android?.signed, true);
  assert.equal(release?.downloads.windows, undefined);
});

test("returns null when no published installer exists", () => {
  assert.equal(pickNativeRelease([]), null);
  assert.equal(pickNativeRelease({ message: "rate limited" }), null);
  assert.equal(pickNativeRelease([{ tag_name: "app-v1.0.0", assets: [asset("notes.txt")] }]), null);
});

test("suggests a platform and formats sizes", () => {
  assert.equal(suggestedPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "android");
  assert.equal(suggestedPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "windows");
  assert.equal(suggestedPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"), null);
  assert.equal(formatBytes(5_242_880), "5.0 MB");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(0), "");
});
