package shop.jstradersokr.picking;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * "On duty" background service. Runs as a foreground service (permanent "On duty" notification) so Android keeps it
 * alive while the app is closed or the screen is off. Every few seconds it asks the ERP for new notifications:
 *  - urgent (new picking work) -> loud looping alarm on the ALARM volume + vibration + full-screen alarm screen
 *  - others (task removed, cancelled...) -> normal notification
 * The alarm stops when the picker taps ACCEPT here, or when the notification is acknowledged in the app.
 */
public class DutyService extends Service {
    static final String TAG = "JSPicking";
    static final String ACTION_STOP_ALARM = "stop_alarm";
    static final String ACTION_ACCEPT = "accept";
    static final String CH_DUTY = "duty", CH_ALARM = "picking_alarm", CH_INFO = "info";
    static final int ID_DUTY = 1, ID_ALARM = 2;

    private volatile boolean running;
    private Thread loop;
    private PowerManager.WakeLock wakeLock;
    private MediaPlayer player;
    private int savedAlarmVolume = -1;
    private final Set<String> ringing = new LinkedHashSet<>();   // urgent ids currently alarming
    private final Set<String> handled = new HashSet<>();         // accepted here, waiting for the server to confirm
    private final Set<String> shown = new HashSet<>();           // info notifications already shown

    static void start(Context c) {
        Intent i = new Intent(c, DutyService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }
    static void stop(Context c) { c.stopService(new Intent(c, DutyService.class)); }
    static void send(Context c, String action, ArrayList<String> ids) {
        Intent i = new Intent(c, DutyService.class).setAction(action);
        if (ids != null) i.putStringArrayListExtra("ids", ids);
        c.startService(i);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        channels(this);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        goForeground();
        if (!Prefs.onDuty(this)) { stopSelf(); return START_NOT_STICKY; }
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP_ALARM.equals(action)) {
            synchronized (ringing) { handled.addAll(ringing); }
            stopAlarm();
        } else if (ACTION_ACCEPT.equals(action)) {
            ArrayList<String> ids = intent.getStringArrayListExtra("ids");
            synchronized (ringing) { if (ids != null) handled.addAll(ids); handled.addAll(ringing); }
            stopAlarm();
            final ArrayList<String> ack = ids;
            new Thread(() -> {
                try { Api.ack(Prefs.url(this), Prefs.key(this), Prefs.token(this), ack); }
                catch (Exception e) { Log.w(TAG, "ack failed", e); }
            }).start();
        }
        if (!running) startLoop();
        return START_STICKY;
    }

    private void goForeground() {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CH_DUTY)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("On duty — picking alarm is on")
                .setContentText("You will hear an alarm when new picking work arrives")
                .setOngoing(true)
                .setContentIntent(pi)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID_DUTY, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(ID_DUTY, n);
    }

    private void startLoop() {
        running = true;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "jspicking:duty");
        wakeLock.acquire();
        loop = new Thread(() -> {
            int failures = 0;
            while (running) {
                try {
                    pollOnce();
                    failures = 0;
                } catch (Api.NotRegistered e) {
                    Log.w(TAG, "device not registered — stopping duty", e);
                    Prefs.stopDuty(this);
                    stopAlarm();
                    running = false;
                    stopSelf();
                    break;
                } catch (Exception e) {
                    failures++;
                    Log.w(TAG, "poll failed", e);
                }
                try { Thread.sleep(failures > 3 ? 15000 : 5000); } catch (InterruptedException ignored) { break; }
            }
        }, "duty-poll");
        loop.start();
    }

    private void pollOnce() throws Exception {
        String url = Prefs.url(this), key = Prefs.key(this), token = Prefs.token(this);
        if (url == null || key == null || token == null) throw new Api.NotRegistered("no device key");
        JSONArray arr = Api.poll(url, key, token);
        Set<String> unreadUrgent = new HashSet<>();
        JSONObject firstNew = null;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            String id = o.getString("id");
            if (o.optBoolean("urgent")) {
                unreadUrgent.add(id);
                synchronized (ringing) {
                    if (!handled.contains(id) && !ringing.contains(id)) { ringing.add(id); if (firstNew == null) firstNew = o; }
                }
            } else if (shown.add(id)) {
                info(o);
            }
        }
        synchronized (ringing) {
            handled.retainAll(unreadUrgent);       // forget ids the server no longer reports
            ringing.retainAll(unreadUrgent);       // acknowledged elsewhere (in the app / office)
        }
        if (firstNew != null) alarm(firstNew);
        else if (ringing.isEmpty() && player != null) stopAlarm();
    }

    // ------------------------------------------------------------------ alarm
    private void alarm(JSONObject o) {
        String title = o.optString("title", "New picking task");
        String body = o.isNull("body") ? "" : o.optString("body", "");
        String task = o.isNull("task_id") ? null : o.optString("task_id", null);
        startSound();
        ArrayList<String> ids;
        synchronized (ringing) { ids = new ArrayList<>(ringing); }

        Intent screen = new Intent(this, AlarmActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("title", title).putExtra("body", body).putExtra("task", task).putStringArrayListExtra("ids", ids);
        PendingIntent full = PendingIntent.getActivity(this, 1, screen, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent accept = PendingIntent.getService(this, 2,
                new Intent(this, DutyService.class).setAction(ACTION_ACCEPT).putStringArrayListExtra("ids", ids),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CH_ALARM)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(Notification.CATEGORY_ALARM)
                .setOngoing(true)
                .setFullScreenIntent(full, true)
                .setContentIntent(full)
                .addAction(new Notification.Action.Builder(null, "ACCEPT", accept).build())
                .build();
        nm().notify(ID_ALARM, n);
        try { startActivity(screen); } catch (Exception ignored) { /* background start blocked: the full-screen notification shows it */ }
    }

    private synchronized void startSound() {
        if (player != null) return;
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            savedAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM);
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            player.setDataSource(this, Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.siren));
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            Log.w(TAG, "sound failed", e);
        }
        Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (v != null) v.vibrate(VibrationEffect.createWaveform(new long[]{0, 800, 300, 800, 300, 800, 600}, 0),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
    }

    synchronized void stopAlarm() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) {}
            player.release();
            player = null;
            if (savedAlarmVolume >= 0) {
                try { ((AudioManager) getSystemService(AUDIO_SERVICE)).setStreamVolume(AudioManager.STREAM_ALARM, savedAlarmVolume, 0); } catch (Exception ignored) {}
                savedAlarmVolume = -1;
            }
        }
        Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (v != null) v.cancel();
        nm().cancel(ID_ALARM);
        sendBroadcast(new Intent(AlarmActivity.ACTION_CLOSE).setPackage(getPackageName()));
    }

    private void info(JSONObject o) {
        String task = o.isNull("task_id") ? null : o.optString("task_id", null);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("task", task);
        PendingIntent pi = PendingIntent.getActivity(this, o.optString("id").hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CH_INFO)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(o.optString("title"))
                .setContentText(o.isNull("body") ? "" : o.optString("body"))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
        nm().notify(o.optString("id").hashCode(), n);
    }

    private NotificationManager nm() { return (NotificationManager) getSystemService(NOTIFICATION_SERVICE); }

    static void channels(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel duty = new NotificationChannel(CH_DUTY, "On duty", NotificationManager.IMPORTANCE_LOW);
        duty.setDescription("Shown while the picking alarm is switched on");
        NotificationChannel alarm = new NotificationChannel(CH_ALARM, "New picking work (alarm)", NotificationManager.IMPORTANCE_HIGH);
        alarm.setSound(null, null);          // the service plays the siren itself on the alarm volume
        alarm.enableVibration(false);
        alarm.setBypassDnd(true);
        alarm.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationChannel info = new NotificationChannel(CH_INFO, "Picking updates", NotificationManager.IMPORTANCE_DEFAULT);
        nm.createNotificationChannel(duty);
        nm.createNotificationChannel(alarm);
        nm.createNotificationChannel(info);
    }

    @Override public void onDestroy() {
        running = false;
        if (loop != null) loop.interrupt();
        stopAlarm();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }
}
