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

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;

public class MentorService extends Service {

    private static final String TAG = "SVC";
    private static final String CH_FG = "fg";
    private static final String CH_HINT = "hint";
    private static final int FG_ID = 1;

    private PowerManager.WakeLock wakeLock;
    private int hintId = 100;
    private boolean isRunning = false;
    
    private final String FIREBASE_URL = "https://mentorlink-school-default-rtdb.europe-west1.firebasedatabase.app";

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(FG_ID, buildFgNotification());
        
        if (!isRunning) {
            isRunning = true;
            startFirebasePolling();
        }
        return START_STICKY;
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);

            // Foreground channel
            NotificationChannel fg = new NotificationChannel(CH_FG, "Система", NotificationManager.IMPORTANCE_LOW);
            fg.setShowBadge(false);
            fg.setDescription("Фоновая работа приложения");
            nm.createNotificationChannel(fg);

            // Hints channel
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
                .setContentTitle("MentorLink работает")
                .setContentText("Получение подсказок активно")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setSilent(true)
                .setOngoing(true)
                .build();
    }

    private void startFirebasePolling() {
        new Thread(() -> {
            while (isRunning) {
                try {
                    // Fetch latest messages
                    URL url = new URL(FIREBASE_URL + "/messages/to_android.json");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(5000);
                    
                    if (conn.getResponseCode() == 200) {
                        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) sb.append(line);
                        reader.close();
                        
                        String jsonString = sb.toString();
                        if (!jsonString.equals("null") && jsonString.startsWith("{")) {
                            JSONObject root = new JSONObject(jsonString);
                            Iterator<String> keys = root.keys();
                            
                            while (keys.hasNext()) {
                                String msgId = keys.next();
                                JSONObject msg = root.getJSONObject(msgId);
                                String type = msg.optString("type");
                                
                                if ("new-hint".equals(type)) {
                                    JSONObject data = msg.getJSONObject("data");
                                    String text = data.optString("text", "");
                                    String idStr = data.optString("id", "");
                                    if (!text.isEmpty()) {
                                        int notifId = idStr.isEmpty() ? hintId++ : Math.abs(idStr.hashCode());
                                        showNotification(text, notifId);
                                    }
                                } else if ("delete-hint".equals(type)) {
                                    String idStr = msg.optString("data", "");
                                    if (!idStr.isEmpty()) {
                                        int notifId = Math.abs(idStr.hashCode());
                                        NotificationManagerCompat.from(MentorService.this).cancel(notifId);
                                    }
                                }
                                
                                // Delete the message to acknowledge
                                deleteMessage(msgId);
                            }
                        }
                    }
                    conn.disconnect();
                } catch (Exception e) {
                    Log.e(TAG, "Polling error", e);
                }
                
                // Sleep for 2.5 seconds before next poll
                try { Thread.sleep(2500); } catch (InterruptedException ignore) {}
            }
        }).start();
    }
    
    private void deleteMessage(String msgId) {
        new Thread(() -> {
            try {
                URL url = new URL(FIREBASE_URL + "/messages/to_android/" + msgId + ".json");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("DELETE");
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception e) {
                Log.e(TAG, "Delete error", e);
            }
        }).start();
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

            NotificationManagerCompat.from(this).notify(notifId, builder.build());
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
        isRunning = false;
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
