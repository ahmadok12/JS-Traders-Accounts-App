package shop.jstradersokr.picking;

import android.content.Context;
import android.content.SharedPreferences;

/** Small settings store: the device key and Supabase address handed over by the web app when the picker starts duty. */
final class Prefs {
    private Prefs() {}
    private static SharedPreferences p(Context c) { return c.getSharedPreferences("duty", Context.MODE_PRIVATE); }

    static void startDuty(Context c, String token, String url, String key) {
        p(c).edit().putBoolean("on", true).putString("token", token).putString("url", url).putString("key", key).apply();
    }
    static void stopDuty(Context c) { p(c).edit().putBoolean("on", false).remove("token").apply(); }
    static boolean onDuty(Context c) { return p(c).getBoolean("on", false) && token(c) != null; }
    static String token(Context c) { return p(c).getString("token", null); }
    static String url(Context c) { return p(c).getString("url", null); }
    static String key(Context c) { return p(c).getString("key", null); }
    static boolean asked(Context c, String what) { return p(c).getBoolean("asked." + what, false); }
    static void resetAsked(Context c) { p(c).edit().remove("asked.notif").remove("asked.battery").remove("asked.fullscreen").apply(); }
    static void setAsked(Context c, String what) { p(c).edit().putBoolean("asked." + what, true).apply(); }
}
