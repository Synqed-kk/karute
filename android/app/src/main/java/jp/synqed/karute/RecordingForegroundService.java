package jp.synqed.karute;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

// Keeps microphone capture alive while the screen is locked or the app is
// backgrounded mid-recording.
//
// Why this exists: recording is WebView getUserMedia/MediaRecorder (shared web
// code). Capacitor keeps the WebView's JS running when the Activity pauses
// (Bridge KeepRunning defaults true), but since Android 9 the OS silently
// MUTES microphone input for any app that is neither visible nor running a
// microphone-type foreground service — no error, the recording continues and
// captures silence. iOS records through a locked screen via
// UIBackgroundModes:audio (ios/App/App/Info.plist); this service is the
// Android counterpart. While it runs, the mic stays live because capture
// began while the app was in the foreground (the staff taps 録音開始 in-app),
// which grants continued while-in-use access to a microphone FGS.
//
// Lifecycle is owned by MainActivity's AudioManager recording callback: the
// service starts when the app's own audio capture begins and stops when it
// ends or the Activity is destroyed. It holds no state and does no work — its
// only job is existing, plus the mandatory user-visible notification (a
// transparency feature for a counseling recorder, not just an OS requirement).
public class RecordingForegroundService extends Service {

    private static final String CHANNEL_ID = "recording";
    private static final int NOTIFICATION_ID = 1;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // IMPORTANCE_LOW: silent, no heads-up — the staff initiated this
            // recording seconds ago; the notification is a status row, not an alert.
            manager.createNotificationChannel(
                new NotificationChannel(CHANNEL_ID, "録音", NotificationManager.IMPORTANCE_LOW)
            );
        }

        // Tap returns to the app (same singleTask instance — launchMode in the
        // manifest — so this never stacks a second MainActivity).
        PendingIntent tap = PendingIntent.getActivity(
            this,
            0,
            new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        Notification notification = builder
            .setContentTitle("録音中")
            .setContentText("画面がロックされても録音は継続されます")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(tap)
            .setOngoing(true)
            .build();

        // The 3-arg overload exists since API 29 but the MICROPHONE type
        // constant only since API 30; below that the 2-arg call is the correct
        // form (pre-29 has no FGS types at all, and 29 takes the type from the
        // manifest declaration). targetSdk 34+ devices REQUIRE the type to be
        // resolvable at startForeground time — it is, both here and in the
        // manifest's android:foregroundServiceType.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // NOT_STICKY: if the process dies, the WebView (and the recording with
        // it) is already gone — a resurrected empty service would just show a
        // zombie 録音中 notification over no recording.
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
