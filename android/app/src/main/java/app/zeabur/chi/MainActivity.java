package app.zeabur.chi;
import android.os.Bundle;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.net.Uri;
import android.Manifest;
import android.content.pm.PackageManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import android.view.Window;
import android.view.WindowManager;
import android.graphics.Color;
import android.view.View;
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
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
public class MainActivity extends BridgeActivity {
    private static final String TAG = "ChiFcm";
    private static final int AUDIO_PERMISSION_REQUEST_CODE = 1001;
    private ValueCallback<Uri[]> fileUploadCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UsageStatsPlugin.class);
        super.onCreate(savedInstanceState);
        // Set status bar to pink/transparent
        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#f8e0ef"));
        // Light status bar (dark icons on light bg)
        View decorView = window.getDecorView();
        decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        createNotificationChannels();
        scheduleNotificationWorker();
        startPollService();
        uploadFcmToken();
        // Request audio permission early so it's ready for voice calls
        requestAudioPermission();
        // Register file chooser launcher before configuring WebView
        fileChooserLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (fileUploadCallback == null) return;
                Uri[] results = null;
                if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                    String dataString = result.getData().getDataString();
                    if (dataString != null) {
                        results = new Uri[]{Uri.parse(dataString)};
                    }
                }
                fileUploadCallback.onReceiveValue(results);
                fileUploadCallback = null;
            }
        );
        // Configure WebView for audio playback and microphone access
        configureWebView();
    }
    private void configureWebView() {
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                // Allow audio/video to autoplay without user gesture
                settings.setMediaPlaybackRequiresUserGesture(false);
                // Handle WebView permission requests (microphone, camera) and file upload
                webView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        // Auto-grant audio capture permission to our own domain
                        runOnUiThread(() -> {
                            String[] resources = request.getResources();
                            for (String r : resources) {
                                if (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                                    request.grant(resources);
                                    return;
                                }
                            }
                            request.deny();
                        });
                    }
                    @Override
                    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                        // Cancel any existing callback
                        if (fileUploadCallback != null) {
                            fileUploadCallback.onReceiveValue(null);
                        }
                        fileUploadCallback = callback;
                        try {
                            Intent intent = params.createIntent();
                            fileChooserLauncher.launch(intent);
                        } catch (Exception e) {
                            Log.e(TAG, "File chooser failed: " + e.getMessage());
                            fileUploadCallback.onReceiveValue(null);
                            fileUploadCallback = null;
                            return false;
                        }
                        return true;
                    }
                });
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to configure WebView: " + e.getMessage());
        }
    }
    private void requestAudioPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.RECORD_AUDIO},
                    AUDIO_PERMISSION_REQUEST_CODE);
        }
    }
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager mgr = getSystemService(NotificationManager.class);
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
    private void startPollService() {
        Intent serviceIntent = new Intent(this, NotificationPollService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
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
