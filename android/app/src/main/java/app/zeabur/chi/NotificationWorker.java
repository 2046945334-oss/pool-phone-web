package app.zeabur.chi;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

import org.json.JSONArray;
import org.json.JSONObject;

public class NotificationWorker extends Worker {

    private static final String CHANNEL_ID = "chi_notifications";
    private static final String PREFS_NAME = "chi_notif_prefs";
    private static final String KEY_LAST_ID = "last_notif_id";
    // Backend URL - points to Zeabur deployment
    private static final String NOTIF_API = "https://chi.zeabur.app/api/data/pool_notification_queue";

    public NotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            // Fetch notification queue from backend
            URL url = new URL(NOTIF_API);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            int code = conn.getResponseCode();
            if (code != 200) return Result.retry();

            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();
            conn.disconnect();

            JSONObject data = new JSONObject(sb.toString());
            String valueStr = data.optString("value", "[]");
            JSONArray queue;
            try {
                queue = new JSONArray(valueStr);
            } catch (Exception e) {
                // value might be already an object
                Object val = data.opt("value");
                if (val instanceof JSONArray) {
                    queue = (JSONArray) val;
                } else {
                    return Result.success();
                }
            }

            if (queue.length() == 0) return Result.success();

            // Get last delivered notification ID
            SharedPreferences prefs = getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String lastId = prefs.getString(KEY_LAST_ID, "");

            // Create notification channel
            createChannel();

            boolean foundLast = lastId.isEmpty();
            for (int i = 0; i < queue.length(); i++) {
                JSONObject n = queue.getJSONObject(i);
                String id = n.optString("id", String.valueOf(i));

                if (!foundLast) {
                    if (id.equals(lastId)) foundLast = true;
                    continue;
                }

                String title = n.optString("title", "池的小手机");
                String body = n.optString("body", "");

                showNotification(title, body, i + 1000);

                // Save this as last delivered
                prefs.edit().putString(KEY_LAST_ID, id).apply();
            }

            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "池的消息", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("来自池的小手机的消息通知");
            channel.enableVibration(true);
            NotificationManager manager = getApplicationContext().getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void showNotification(String title, String body, int notifId) {
        Context ctx = getApplicationContext();
        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(ctx, notifId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setVibrate(new long[]{0, 300, 200, 300});

        NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(notifId, builder.build());
    }
}
