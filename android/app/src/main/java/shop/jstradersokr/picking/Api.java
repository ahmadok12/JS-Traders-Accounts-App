package shop.jstradersokr.picking;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collection;

/** Talks to the ERP database with the phone's device key (no login session needed in the background). */
final class Api {
    private Api() {}

    static final class NotRegistered extends Exception { NotRegistered(String m) { super(m); } }

    static JSONArray poll(String url, String key, String token) throws Exception {
        JSONObject body = new JSONObject().put("p_token", token);
        String res = post(url, key, "device_poll", body.toString());
        return new JSONArray(res);
    }

    static void ack(String url, String key, String token, Collection<String> ids) throws Exception {
        JSONObject body = new JSONObject().put("p_token", token);
        if (ids != null) {
            JSONArray a = new JSONArray();
            for (String id : ids) a.put(id);
            body.put("p_ids", a);
        }
        post(url, key, "device_ack", body.toString());
    }

    private static String post(String base, String key, String fn, String json) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/rest/v1/rpc/" + fn).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("apikey", key);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("Accept", "application/json");
        try (OutputStream o = c.getOutputStream()) { o.write(json.getBytes(StandardCharsets.UTF_8)); }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String text = "";
        if (in != null) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            in.close();
            text = b.toString("UTF-8");
        }
        c.disconnect();
        if (code >= 400) {
            if (text.contains("42501")) throw new NotRegistered(text);
            throw new Exception("HTTP " + code + " " + text);
        }
        return text.isEmpty() ? "[]" : text;
    }
}
