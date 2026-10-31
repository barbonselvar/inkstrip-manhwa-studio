/*
 * Inkstrip Android bridge shim.
 *
 * Injected by the InkstripNative plugin before the production page's own
 * scripts run. Android System WebView silently ignores `<a download>` clicks
 * on blob:/data: URLs, which is how every Inkstrip export works (PNG/JPEG,
 * chapter ZIPs, backups, native files). This shim routes those clicks to the
 * native plugin, which streams the bytes into the public Downloads folder.
 * It does nothing outside the Android app.
 */
(function () {
  "use strict";
  if (window.__inkstripNativeShim) return;
  window.__inkstripNativeShim = true;

  var CHUNK = 512 * 1024; // bytes per bridge call (base64 is ~1.33x larger)

  function plugin() {
    var cap = window.Capacitor;
    return cap && cap.Plugins && cap.Plugins.InkstripNative;
  }

  function isDownloadable(anchor) {
    if (!anchor || !anchor.hasAttribute || !anchor.hasAttribute("download")) return false;
    var href = anchor.href || "";
    return href.indexOf("blob:") === 0 || href.indexOf("data:") === 0;
  }

  function bytesToBase64(bytes) {
    var binary = "";
    var step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(binary);
  }

  async function save(href, filename) {
    var native = plugin();
    if (!native) throw new Error("Native download bridge unavailable");
    // fetch() resolves the blob URL synchronously, so later revokeObjectURL calls are safe.
    var response = await fetch(href);
    var blob = await response.blob();
    // The native side sanitizes names again (including control characters).
    var name = (filename || "inkstrip-export").replace(/[\\/:*?"<>|]/g, "-");
    var begin = await native.downloadBegin({
      filename: name,
      mimeType: blob.type || "application/octet-stream",
      size: blob.size,
    });
    try {
      for (var offset = 0; offset < blob.size; offset += CHUNK) {
        var part = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
        await native.downloadChunk({ id: begin.id, data: bytesToBase64(part) });
      }
      return await native.downloadFinish({ id: begin.id });
    } catch (error) {
      try {
        await native.downloadAbort({ id: begin.id });
      } catch {
        /* already cleaned up */
      }
      throw error;
    }
  }

  function intercept(anchor) {
    var href = anchor.href;
    var name = anchor.getAttribute("download");
    save(href, name).catch(function (error) {
      console.error("[Inkstrip] download failed", error);
      var native = plugin();
      if (native)
        native.toast({
          text: "Download failed: " + (error && error.message ? error.message : error),
        });
    });
  }

  // Programmatic `anchor.click()` (used by every export path, often on detached anchors).
  var originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (plugin() && isDownloadable(this)) {
      intercept(this);
      return;
    }
    return originalClick.apply(this, arguments);
  };

  // Real taps on download links.
  document.addEventListener(
    "click",
    function (event) {
      if (!plugin()) return;
      var target = event.target;
      var anchor = target && target.closest ? target.closest("a[download]") : null;
      if (isDownloadable(anchor)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        intercept(anchor);
      }
    },
    true,
  );
})();
