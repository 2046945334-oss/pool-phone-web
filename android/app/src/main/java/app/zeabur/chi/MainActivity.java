package app.zeabur.chi;
import android.os.Bundle;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import com.getcapacitor.BridgeActivity;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UsageStatsPlugin.class);
        super.onCreate(savedInstanceState);
        createNotificationChannels();
        scheduleNotificationWorker();
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
}
