#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner (see native-apps.yml).
# Installs the built APK on the emulator, launches it and runs native-smoke.mjs
# against the app's own WebView, then restarts the app to check persistence.
set -uo pipefail
PKG=app.inkstrip.studio
OUT=native-smoke
mkdir -p "$OUT"
status=0

shipped=$(ls dist/*.apk | head -1)
# A release-signed APK has WebView debugging off, so the CDP smoke test runs on the
# debug build of the same commit and the signed APK gets an install/launch check.
if [[ "$shipped" == *-test.apk ]]; then testapk="$shipped"; else testapk=$(ls dist/test/*.apk | head -1); fi
echo "Shipped APK: $shipped"; echo "Smoke-test APK: $testapk"

launch() {
  adb shell am force-stop "$PKG" || true
  adb shell am start -W -n "$PKG/.MainActivity" | tee -a "$OUT/android-am-start.txt"
  for _ in $(seq 1 30); do
    pid=$(adb shell pidof "$PKG" | tr -d '\r')
    [ -n "$pid" ] && break
    sleep 1
  done
  echo "pid=$pid"
  # The WebView creates its DevTools socket lazily; keep re-forwarding to the current
  # pid until the endpoint answers.
  for _ in $(seq 1 90); do
    pid=$(adb shell pidof "$PKG" | tr -d '\r')
    adb forward --remove-all >/dev/null 2>&1 || true
    if [ -n "$pid" ] && adb forward tcp:9222 "localabstract:webview_devtools_remote_$pid" >/dev/null 2>&1 \
      && curl -sf -m 3 http://127.0.0.1:9222/json/version >/dev/null; then
      echo "DevTools ready for pid $pid"
      return 0
    fi
    sleep 2
  done
  echo "DevTools socket never appeared"
  adb shell cat /proc/net/unix | grep -i devtools || true
}

adb logcat -c || true
adb install -r "$testapk" || exit 1
adb shell getprop ro.build.version.release | sed 's/^/Android /' | tee "$OUT/android-device.txt"
adb shell dumpsys package com.google.android.webview | grep -m1 versionName | sed 's/^ */WebView /' | tee -a "$OUT/android-device.txt"

launch
node apps/scripts/native-smoke.mjs --platform android --phase main --out "$OUT" --timeout 240 || status=1
adb shell dumpsys meminfo "$PKG" | grep -E "TOTAL PSS|TOTAL RSS|TOTAL:" | tee "$OUT/android-memory.txt" || true

launch
node apps/scripts/native-smoke.mjs --platform android --phase verify-restart --out "$OUT" --timeout 240 || status=1
adb exec-out screencap -p > "$OUT/android-screen.png" || true

if [ "$testapk" != "$shipped" ]; then
  echo "Install/launch check for the signed release APK"
  adb uninstall "$PKG" || true
  adb install "$shipped" || status=1
  adb shell am start -W -n "$PKG/.MainActivity" | tee "$OUT/android-release-start.txt"
  sleep 15
  if adb shell pidof "$PKG" >/dev/null && adb shell dumpsys activity activities | grep -q "mResumedActivity.*$PKG"; then
    echo "PASS  Signed APK installs and stays in the foreground"
  else
    echo "FAIL  Signed APK did not stay in the foreground"; status=1
  fi
  adb exec-out screencap -p > "$OUT/android-release-screen.png" || true
fi

adb logcat -d > "$OUT/android-logcat.txt" || true
if grep -E "FATAL EXCEPTION.*|AndroidRuntime: Process: $PKG" "$OUT/android-logcat.txt"; then
  echo "FAIL  App crashed (see android-logcat.txt)"; status=1
fi
exit $status
