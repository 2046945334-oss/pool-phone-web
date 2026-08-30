package app.zeabur.chi;
import android.os.Bundle;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
public class MainActivity extends BridgeActivity {
    private static final String TAG = "ChiFcm";
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UsageStatsPlugin.class);
        super.onCreate(savedInstanceState);
        createNotificationChannels();
        scheduleNotificationWorker();
        uploadFcmToken();
    }
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager mgr = getSystemService(NotificationManager.class);
            // FCM 推送通道
            NotificationChannel pushChannel = new NotificationChannel(
                    "chi_push", "推送通知", NotificationManager.IMPORTANCE_HIGH);
            pushChannel.setDescription("来自池的小手机的推送通知");
            pushChannel.enableVibration(true);
            mgr.createNotificationChannel(pushChannel);
        }
    }
    private void scheduleNotificationWorker() {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        PeriodicWorkRequest workRequest = new PeriodicWorkRequest.Builder(
                NotificationWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
                "chi_notif_poll",
                ExistingPeriodicWorkPolicy.KEEP,
                workRequest);
    }
    private void uploadFcmToken() {
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> {
            Log.d(TAG, "FCM token obtained: " + token.substring(0, Math.min(20, token.length())) + "...");
            new Thread(() -> {
                try {
                    URL url = new URL("https://chi.zeabur.app/api/data/pool_fcm_token");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("PUT");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(10000);
                    String json = "{\"value\":\"" + token + "\"}";
                    OutputStream os = conn.getOutputStream();
                    os.write(json.getBytes(StandardCharsets.UTF_8));
                    os.close();
                    int code = conn.getResponseCode();
                    Log.d(TAG, "Token upload response: " + code);
                    conn.disconnect();
                } catch (Exception e) {
                    Log.e(TAG, "Token upload failed: " + e.getMessage());
                }
            }).start();
        }).addOnFailureListener(e -> {
            Log.e(TAG, "Failed to get FCM token: " + e.getMessage());
        });
    }
}
