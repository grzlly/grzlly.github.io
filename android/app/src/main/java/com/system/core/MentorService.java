package com.system.core;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

import java.net.URI;

import io.socket.client.IO;
import io.socket.client.Socket;

public class MentorService extends Service {

    private static final String TAG = "SVC";
    private static final String CH_FG = "fg";
    private static final String CH_HINT = "hint";
    private static final int FG_ID = 1;

    private Socket socket;
    private PowerManager.WakeLock wakeLock;
    private int hintId = 100;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(FG_ID, buildFgNotification());
        connectSocket();
        return START_STICKY;
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);

            // Foreground channel — invisible
            NotificationChannel fg = new NotificationChannel(CH_FG, "Система", NotificationManager.IMPORTANCE_MIN);
            fg.setShowBadge(false);
            fg.setDescription("Системная служба");
            nm.createNotificationChannel(fg);

            // Hints channel — loud, vibrating for Mi Band
            NotificationChannel hint = new NotificationChannel(CH_HINT, "Сообщения", NotificationManager.IMPORTANCE_HIGH);
            hint.enableVibration(true);
            hint.setVibrationPattern(new long[]{0, 400, 200, 400});
            hint.enableLights(true);
            hint.setLightColor(0xFF7C6AEF);
            nm.createNotificationChannel(hint);
        }
    }

    private Notification buildFgNotification() {
        return new NotificationCompat.Builder(this, CH_FG)
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setContentTitle("")
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setSilent(true)
                .setOngoing(true)
                .build();
    }

    private void connectSocket() {
        try {
            if (socket != null) {
                socket.disconnect();
                socket.close();
            }

            IO.Options opts = new IO.Options();
            opts.query = "role=watcher";
            opts.reconnection = true;
            opts.reconnectionDelay = 3000;
            opts.reconnectionDelayMax = 10000;
            opts.timeout = 20000;

            socket = IO.socket(URI.create("https://grzly.ru"), opts);

            socket.on(Socket.EVENT_CONNECT, args -> {
                Log.d(TAG, "Connected");
            });

            socket.on("hint-notification", args -> {
                try {
                    JSONObject data = (JSONObject) args[0];
                    String text = data.optString("text", "");
                    String idStr = data.optString("id", "");
                    if (!text.isEmpty()) {
                        int notifId = idStr.isEmpty() ? hintId++ : Math.abs(idStr.hashCode());
                        showNotification(text, notifId);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Parse error", e);
                }
            });

            socket.on("hint-deleted", args -> {
                try {
                    String idStr = String.valueOf(args[0]);
                    if (idStr != null && !idStr.isEmpty()) {
                        int notifId = Math.abs(idStr.hashCode());
                        NotificationManagerCompat nm = NotificationManagerCompat.from(MentorService.this);
                        nm.cancel(notifId);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Parse error delete", e);
                }
            });

            socket.on(Socket.EVENT_DISCONNECT, args -> {
                Log.d(TAG, "Disconnected, will reconnect...");
            });

            socket.on(Socket.EVENT_CONNECT_ERROR, args -> {
                Log.e(TAG, "Connection error, retrying...");
            });

            socket.connect();
        } catch (Exception e) {
            Log.e(TAG, "Socket init error", e);
        }
    }

    private void showNotification(String text, int notifId) {
        try {
            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CH_HINT)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("")
                    .setContentText(text)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setAutoCancel(true)
                    .setVibrate(new long[]{0, 400, 200, 400});

            NotificationManagerCompat nm = NotificationManagerCompat.from(this);
            nm.notify(notifId, builder.build());
        } catch (SecurityException e) {
            Log.e(TAG, "No notification permission", e);
        }
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mentorlink::wakelock");
        wakeLock.acquire();
    }

    @Override
    public void onDestroy() {
        if (socket != null) {
            socket.disconnect();
            socket.close();
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        // Restart self
        Intent restart = new Intent(this, MentorService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restart);
        } else {
            startService(restart);
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
