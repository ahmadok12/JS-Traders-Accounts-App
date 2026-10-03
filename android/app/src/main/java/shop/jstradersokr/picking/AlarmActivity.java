package shop.jstradersokr.picking;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;

/** Full-screen red alarm screen (shows over the lock screen). ACCEPT stops the siren and opens the task. */
public class AlarmActivity extends Activity {
    static final String ACTION_CLOSE = "shop.jstradersokr.picking.CLOSE_ALARM";
    private TextView title, body;
    private ArrayList<String> ids;
    private String task;
    private final BroadcastReceiver closer = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { finish(); }
    };

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#B91C1C"));
        int pad = dp(28);
        root.setPadding(pad, pad, pad, pad);

        TextView bell = new TextView(this);
        bell.setText("🔔");
        bell.setTextSize(72);
        bell.setGravity(Gravity.CENTER);
        root.addView(bell);

        title = new TextView(this);
        title.setTextColor(Color.WHITE);
        title.setTextSize(28);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(16), 0, dp(8));
        root.addView(title);

        body = new TextView(this);
        body.setTextColor(Color.parseColor("#FEE2E2"));
        body.setTextSize(19);
        body.setGravity(Gravity.CENTER);
        root.addView(body);

        Button accept = new Button(this);
        accept.setText("ACCEPT");
        accept.setTextSize(28);
        accept.setTypeface(Typeface.DEFAULT_BOLD);
        accept.setTextColor(Color.parseColor("#B91C1C"));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(18));
        accept.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(96));
        lp.topMargin = dp(48);
        root.addView(accept, lp);
        accept.setOnClickListener(v -> accept());

        setContentView(root);
        bind(getIntent());
        IntentFilter f = new IntentFilter(ACTION_CLOSE);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(closer, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(closer, f);
    }

    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); bind(intent); }

    private void bind(Intent i) {
        title.setText(i.getStringExtra("title") == null ? "New picking task" : i.getStringExtra("title"));
        body.setText(i.getStringExtra("body") == null ? "" : i.getStringExtra("body"));
        ids = i.getStringArrayListExtra("ids");
        task = i.getStringExtra("task");
    }

    private void accept() {
        DutyService.send(this, DutyService.ACTION_ACCEPT, ids);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (task != null) open.putExtra("task", task);
        startActivity(open);
        finish();
    }

    @Override public void onBackPressed() { /* must ACCEPT */ }

    @Override protected void onDestroy() {
        try { unregisterReceiver(closer); } catch (Exception ignored) {}
        super.onDestroy();
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
