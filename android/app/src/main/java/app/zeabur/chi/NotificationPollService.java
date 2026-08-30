package app.zeabur.chi;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

import org.json.JSONArray;
import org.json.JSONObject;

public class NotificationPollService extends Service {

    private static final String TAG = "ChiPoll";
    private static final String FG_CHANNEL_ID = "chi_foreground";
    private static final String MSG_CHANNEL_ID = "chi_notifications";
    private static final String PREFS_NAME = "chi_notif_prefs";
    private static final String KEY_LAST_ID = "last_poll_notif_id";
    private static final String NOTIF_API = "https://chi.zeabur.app/api/data/pool_notification_queue";
    private static final long POLL_INTERVAL_MS = 30_000; // 30 seconds

    private Handler handler;
    private boolean running = false;

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(1, buildForegroundNotification());
        if (!running) {
            running = true;
            handler.post(pollRunnable);
            Log.d(TAG, "Polling service started");
        }
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(pollRunnable);
        Log.d(TAG, "Polling service stopped");
        super.onDestroy();
    }

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            new Thread(() -> pollNotifications()).start();
            handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    private void pollNotifications() {
        try {
            URL url = new URL(NOTIF_API);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            int code = conn.getResponseCode();
            if (code != 200) {
                conn.disconnect();
                return;
            }

            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();
            conn.disconnect();

            JSONObject data = new JSONObject(sb.toString());
            // The /api/data/[key] endpoint returns { value: "..." }
            String valueStr = data.optString("value", "[]");
            JSONArray queue;
            try {
                queue = new JSONArray(valueStr);
            } catch (Exception e) {
                Object val = data.opt("value");
                if (val instanceof JSONArray) {
                    queue = (JSONArray) val;
                } else {
                    return;
                }
            }

            if (queue.length() == 0) return;

            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String lastId = prefs.getString(KEY_LAST_ID, "");

            boolean foundLast = lastId.isEmpty();
            String newestId = lastId;

            for (int i = 0; i < queue.length(); i++) {
                JSONObject n = queue.getJSONObject(i);
                String id = n.optString("id", String.valueOf(i));

                if (!foundLast) {
                    if (id.equals(lastId)) foundLast = true;
                    continue;
                }

                String title = n.optString("title", "池的小手机");
                String body = n.optString("body", "");

                if (!body.isEmpty()) {
                    showMessageNotification(title, body, (int) (System.currentTimeMillis() % 100000));
                }
                newestId = id;
            }

            if (!newestId.equals(lastId)) {
                prefs.edit().putString(KEY_LAST_ID, newestId).apply();
            }

        } catch (Exception e) {
            Log.e(TAG, "Poll failed: " + e.getMessage());
        }
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager mgr = getSystemService(NotificationManager.class);

            // Foreground service channel (low priority, silent)
            NotificationChannel fgChannel = new NotificationChannel(
                    FG_CHANNEL_ID, "后台运行", NotificationManager.IMPORTANCE_LOW);
            fgChannel.setDescription("保持消息接收服务运行");
            fgChannel.setShowBadge(false);
            mgr.createNotificationChannel(fgChannel);

            // Message notification channel (high priority)
            NotificationChannel msgChannel = new NotificationChannel(
                    MSG_CHANNEL_ID, "池的消息", NotificationManager.IMPORTANCE_HIGH);
            msgChannel.setDescription("来自池的小手机的消息通知");
            msgChannel.enableVibration(true);
            mgr.createNotificationChannel(msgChannel);
        }
    }

    private Notification buildForegroundNotification() {
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, FG_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("池的小手机")
                .setContentText("消息接收中…")
                .setContentIntent(pending)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void showMessageNotification(String title, String body, int notifId) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, notifId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, MSG_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setVibrate(new long[]{0, 300, 200, 300});

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(notifId, builder.build());
    }
}
