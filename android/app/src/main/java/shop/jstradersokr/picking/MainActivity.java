package shop.jstradersokr.picking;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.File;

/**
 * The staff picking app. Shows the ERP phone screen (/m) in a WebView — so it always runs the latest version —
 * and gives the page a small bridge (window.JSTNative) to switch the background alarm service on and off.
 */
public class MainActivity extends Activity {
    private static final int REQ_FILES = 41;
    private WebView web;
    private boolean loaded;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        DutyService.channels(this);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " JSPickingApp/" + BuildConfig.VERSION_NAME);
        web.addJavascriptInterface(new Bridge(), "JSTNative");
        web.setWebChromeClient(new WebChromeClient() {
            // <input type="file"> in the page: camera (capture) or gallery / files
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                cameraUri = null;
                try {
                    boolean images = false;
                    for (String t : p.getAcceptTypes()) if (t != null && t.startsWith("image")) images = true;
                    Intent camera = null;
                    if (images) {
                        File f = new File(PhotoProvider.dir(MainActivity.this), "pick-" + System.currentTimeMillis() + ".jpg");
                        cameraUri = PhotoProvider.uriFor(f);
                        camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                        camera.setClipData(ClipData.newRawUri("photo", cameraUri));
                        camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    }
                    Intent intent;
                    if (p.isCaptureEnabled() && camera != null) {
                        intent = camera;
                    } else {
                        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                        pick.addCategory(Intent.CATEGORY_OPENABLE);
                        pick.setType(images ? "image/*" : "*/*");
                        if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                        intent = Intent.createChooser(pick, images ? "Choose photos" : "Choose files");
                        if (camera != null) intent.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
                    }
                    startActivityForResult(intent, REQ_FILES);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    cameraUri = null;
                    return false;
                }
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (u.getHost() != null && u.getHost().equals(Uri.parse(BuildConfig.APP_URL).getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }
        });
        setContentView(web);
        open(getIntent());
        if (Prefs.onDuty(this)) DutyService.start(this);
    }

    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); open(intent); }

    private void open(Intent i) {
        String task = i == null ? null : i.getStringExtra("task");
        if (task != null) web.loadUrl(BuildConfig.APP_URL + "/m?task=" + Uri.encode(task));
        else if (!loaded) web.loadUrl(BuildConfig.APP_URL + "/m");
        loaded = true;
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILES || fileCallback == null) return;
        Uri[] out = null;
        if (result == RESULT_OK) {
            if (data != null && data.getClipData() != null && data.getClipData().getItemCount() > 0
                    && !(cameraUri != null && cameraUri.equals(data.getClipData().getItemAt(0).getUri()))) {
                ClipData c = data.getClipData();
                out = new Uri[c.getItemCount()];
                for (int i = 0; i < c.getItemCount(); i++) out[i] = c.getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                out = new Uri[]{data.getData()};
            } else if (cameraUri != null) {
                File f = new File(PhotoProvider.dir(this), cameraUri.getLastPathSegment());
                if (f.exists() && f.length() > 0) out = new Uri[]{cameraUri};
            }
        }
        fileCallback.onReceiveValue(out);
        fileCallback = null;
        cameraUri = null;
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
    }

    @Override protected void onResume() {
        super.onResume();
        if (Prefs.onDuty(this)) askNextPermission();
    }

    /** One permission at a time: notifications → ignore battery optimisation → full-screen alarm. */
    private void askNextPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (!Prefs.asked(this, "notif")) { Prefs.setAsked(this, "notif"); requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7); }
            return;
        }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (!pm.isIgnoringBatteryOptimizations(getPackageName())) {
            if (!Prefs.asked(this, "battery")) {
                Prefs.setAsked(this, "battery");
                try { startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) {}
            }
            return;
        }
        if (Build.VERSION.SDK_INT >= 34 && !((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).canUseFullScreenIntent()) {
            if (!Prefs.asked(this, "fullscreen")) {
                Prefs.setAsked(this, "fullscreen");
                try { startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) {}
            }
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] p, int[] r) {
        super.onRequestPermissionsResult(code, p, r);
        askNextPermission();
    }

    private JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            o.put("onDuty", Prefs.onDuty(this));
            o.put("notifications", nm.areNotificationsEnabled());
            o.put("battery", pm.isIgnoringBatteryOptimizations(getPackageName()));
            o.put("fullScreen", Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent());
            o.put("version", BuildConfig.VERSION_NAME);
        } catch (Exception ignored) {}
        return o;
    }

    /** window.JSTNative in the web page */
    final class Bridge {
        @JavascriptInterface public boolean isApp() { return true; }
        @JavascriptInterface public boolean isOnDuty() { return Prefs.onDuty(MainActivity.this); }
        @JavascriptInterface public String status() { return MainActivity.this.status().toString(); }
        @JavascriptInterface public void startDuty(String token, String url, String key) {
            Prefs.startDuty(MainActivity.this, token, url, key);
            runOnUiThread(() -> {
                DutyService.start(MainActivity.this);
                askNextPermission();
            });
        }
        @JavascriptInterface public void stopDuty() {
            Prefs.stopDuty(MainActivity.this);
            runOnUiThread(() -> DutyService.stop(MainActivity.this));
        }
        @JavascriptInterface public void stopAlarm() {
            if (Prefs.onDuty(MainActivity.this)) DutyService.send(MainActivity.this, DutyService.ACTION_STOP_ALARM, null);
        }
        @JavascriptInterface public void fixSettings() {
            runOnUiThread(() -> {
                Prefs.resetAsked(MainActivity.this);
                JSONObject st = MainActivity.this.status();
                if (!st.optBoolean("notifications") && Build.VERSION.SDK_INT < 33) {
                    try { startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())); } catch (Exception ignored) {}
                } else askNextPermission();
            });
        }
    }
}
