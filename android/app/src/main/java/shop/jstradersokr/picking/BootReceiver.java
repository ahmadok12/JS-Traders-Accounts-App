package shop.jstradersokr.picking;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Phone restarted or app updated: if the picker was on duty, switch the alarm service back on. */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        if (Prefs.onDuty(c)) DutyService.start(c);
    }
}
