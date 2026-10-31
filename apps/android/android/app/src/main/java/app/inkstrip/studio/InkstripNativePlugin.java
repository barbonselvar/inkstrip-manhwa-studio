package app.inkstrip.studio;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import android.widget.Toast;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Native helpers for the Inkstrip Android shell.
 *
 * Android System WebView ignores {@code <a download>} on blob: URLs, so the injected
 * {@code inkstrip-native.js} shim streams each export here in base64 chunks. Chunks are
 * spooled to the app cache and then published to the public Downloads folder:
 * MediaStore on Android 10+ (no permission needed), legacy external storage on
 * Android 7–9 (WRITE_EXTERNAL_STORAGE, declared with maxSdkVersion=28).
 */
@CapacitorPlugin(
    name = "InkstripNative",
    permissions = { @Permission(alias = "legacyStorage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class InkstripNativePlugin extends Plugin {

    private static final long MAX_DOWNLOAD_BYTES = 2L * 1024 * 1024 * 1024; // 2 GiB safety cap

    private static final class Pending {

        final String filename;
        final String mimeType;
        final File spool;
        long written;

        Pending(String filename, String mimeType, File spool) {
            this.filename = filename;
            this.mimeType = mimeType;
            this.spool = spool;
        }
    }

    private final Map<String, Pending> pending = new ConcurrentHashMap<>();

    @Override
    public void load() {
        // Runs before the bridge builds its injector, so the shim lands in every page
        // (including the remote production page) ahead of the page's own scripts.
        getBridge().injectScriptBeforeLoad("inkstrip-native.js");
        File dir = spoolDir();
        File[] stale = dir.listFiles();
        if (stale != null) for (File f : stale) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    private File spoolDir() {
        File dir = new File(getContext().getCacheDir(), "inkstrip-downloads");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    @PluginMethod
    public void downloadBegin(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("legacyStorage") != PermissionState.GRANTED) {
            requestPermissionForAlias("legacyStorage", call, "legacyStorageResult");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void legacyStorageResult(PluginCall call) {
        if (getPermissionState("legacyStorage") == PermissionState.GRANTED) {
            begin(call);
        } else {
            call.reject("Storage permission is required to save downloads on this Android version.");
        }
    }

    private void begin(PluginCall call) {
        String filename = sanitize(call.getString("filename", "inkstrip-export"));
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String id = UUID.randomUUID().toString();
        pending.put(id, new Pending(filename, mimeType, new File(spoolDir(), id)));
        JSObject ret = new JSObject();
        ret.put("id", id);
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadChunk(PluginCall call) {
        Pending p = pending.get(call.getString("id", ""));
        if (p == null) {
            call.reject("Unknown download");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Corrupt download chunk");
            return;
        }
        if (p.written + bytes.length > MAX_DOWNLOAD_BYTES) {
            abort(p);
            call.reject("Download is too large");
            return;
        }
        try (FileOutputStream out = new FileOutputStream(p.spool, true)) {
            out.write(bytes);
            p.written += bytes.length;
            call.resolve();
        } catch (IOException e) {
            abort(p);
            call.reject("Could not write download: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadFinish(PluginCall call) {
        String id = call.getString("id", "");
        Pending p = pending.remove(id);
        if (p == null) {
            call.reject("Unknown download");
            return;
        }
        try {
            String savedAs = publish(p);
            toast("Saved to Downloads: " + savedAs);
            JSObject ret = new JSObject();
            ret.put("filename", savedAs);
            ret.put("bytes", p.written);
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("Could not save download: " + e.getMessage());
        } finally {
            //noinspection ResultOfMethodCallIgnored
            p.spool.delete();
        }
    }

    @PluginMethod
    public void downloadAbort(PluginCall call) {
        Pending p = pending.remove(call.getString("id", ""));
        if (p != null) abort(p);
        call.resolve();
    }

    @PluginMethod
    public void toast(PluginCall call) {
        toast(call.getString("text", ""));
        call.resolve();
    }

    private void toast(String text) {
        getActivity().runOnUiThread(() -> Toast.makeText(getContext(), text, Toast.LENGTH_LONG).show());
    }

    private void abort(Pending p) {
        pending.values().remove(p);
        //noinspection ResultOfMethodCallIgnored
        p.spool.delete();
    }

    private String publish(Pending p) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, p.filename);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeFor(p));
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Inkstrip");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("MediaStore refused the file");
            try (InputStream in = new FileInputStream(p.spool); OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IOException("Cannot open destination");
                copy(in, out);
            } catch (IOException e) {
                resolver.delete(uri, null, null);
                throw e;
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return "Inkstrip/" + p.filename;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Inkstrip");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create Downloads/Inkstrip");
        File target = unique(dir, p.filename);
        try (InputStream in = new FileInputStream(p.spool); OutputStream out = new FileOutputStream(target)) {
            copy(in, out);
        }
        MediaScannerConnection.scanFile(getContext(), new String[] { target.getAbsolutePath() }, new String[] { mimeFor(p) }, null);
        return "Inkstrip/" + target.getName();
    }

    private static String mimeFor(Pending p) {
        if (p.mimeType != null && !p.mimeType.isEmpty() && !"application/octet-stream".equals(p.mimeType)) return p.mimeType;
        int dot = p.filename.lastIndexOf('.');
        if (dot >= 0) {
            String guess = MimeTypeMap.getSingleton().getMimeTypeFromExtension(p.filename.substring(dot + 1).toLowerCase());
            if (guess != null) return guess;
        }
        return "application/octet-stream";
    }

    private static File unique(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; ; i++) {
            f = new File(dir, stem + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
    }

    static String sanitize(String name) {
        String clean = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "-").trim();
        if (clean.isEmpty() || clean.equals(".") || clean.equals("..")) clean = "inkstrip-export";
        return clean.length() > 120 ? clean.substring(clean.length() - 120) : clean;
    }
}
