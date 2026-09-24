package app.zeabur.chi;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.SortedMap;
import java.util.TreeMap;

public class OverlayService extends Service {
    private static final String TAG = "OverlayPeek";
    private static final String CHANNEL_ID = "chi_overlay";
    private static final int NOTIF_ID = 9001;
    private static final long PEEK_THRESHOLD_MS = 3 * 60 * 1000;
    private static final long PEEK_COOLDOWN_MS = 8 * 60 * 1000;
    private static final long POLL_INTERVAL_MS = 30 * 1000;

    private WindowManager windowManager;
    private View bubbleView;
    private View commentCard;
    private TextView commentText;
    private boolean commentVisible = false;

    private Handler handler;
    private String lastForegroundPkg = "";
    private long lastPkgStartTime = 0;
    private long lastPeekTime = 0;

    private MediaProjection mediaProjection;
    private static int sResultCode;
    private static Intent sResultData;
    private ImageReader imageReader;
    private VirtualDisplay virtualDisplay;

    public static void setMediaProjectionResult(int resultCode, Intent data) {
        sResultCode = resultCode;
        sResultData = data;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        createNotificationChannel();
        startForeground(NOTIF_ID, buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        createBubble();
        createCommentCard();
        initMediaProjection();
        startMonitoring();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        super.onDestroy();
        handler.removeCallbacksAndMessages(null);
        if (bubbleView != null) windowManager.removeView(bubbleView);
        if (commentCard != null) windowManager.removeView(commentCard);
        if (virtualDisplay != null) virtualDisplay.release();
        if (imageReader != null) imageReader.close();
        if (mediaProjection != null) mediaProjection.stop();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "\u60ac\u6d6e\u7a97\u670d\u52a1", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("\u6c60\u5c7f\u60ac\u6d6e\u7a97\u540e\u53f0\u670d\u52a1");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(this, CHANNEL_ID);
        } else {
            b = new Notification.Builder(this);
        }
        return b.setContentTitle("\u6c60\u5c7f")
                .setContentText("\u60ac\u6d6e\u7a97\u8fd0\u884c\u4e2d")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .build();
    }

    private void createBubble() {
        int size = dp(48);
        ImageView iv = new ImageView(this);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(Color.parseColor("#e8b4d8"));
        iv.setBackground(circle);
        iv.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        iv.setPadding(dp(4), dp(4), dp(4), dp(4));
        bubbleView = iv;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                size, size,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dp(8);
        params.y = dp(200);

        iv.setOnTouchListener(new View.OnTouchListener() {
            int lastX, lastY, downX, downY;
            boolean dragging = false;
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        lastX = params.x; lastY = params.y;
                        downX = (int) event.getRawX(); downY = (int) event.getRawY();
                        dragging = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) event.getRawX() - downX;
                        int dy = (int) event.getRawY() - downY;
                        if (Math.abs(dx) > dp(5) || Math.abs(dy) > dp(5)) dragging = true;
                        params.x = lastX + dx; params.y = lastY + dy;
                        windowManager.updateViewLayout(bubbleView, params);
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!dragging) toggleComment();
                        return true;
                }
                return false;
            }
        });
        windowManager.addView(bubbleView, params);
    }

    private void createCommentCard() {
        FrameLayout frame = new FrameLayout(this);
        frame.setVisibility(View.GONE);
        TextView tv = new TextView(this);
        tv.setTextSize(13); tv.setTextColor(Color.parseColor("#3d2b3a"));
        tv.setPadding(dp(14), dp(10), dp(14), dp(10));
        tv.setMaxWidth(dp(220)); tv.setText("");
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(14)); bg.setColor(Color.parseColor("#f8f0f5"));
        bg.setStroke(dp(1), Color.parseColor("#e8c8df"));
        tv.setBackground(bg);
        frame.addView(tv);
        commentCard = frame; commentText = tv;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dp(64); params.y = dp(200);
        windowManager.addView(commentCard, params);
    }

    private void toggleComment() {
        commentVisible = !commentVisible;
        commentCard.setVisibility(commentVisible ? View.VISIBLE : View.GONE);
    }

    private void showComment(String text) {
        handler.post(() -> {
            commentText.setText(text);
            commentCard.setVisibility(View.VISIBLE);
            commentVisible = true;
            handler.postDelayed(() -> {
                commentCard.setVisibility(View.GONE);
                commentVisible = false;
            }, 15000);
        });
    }

    private void initMediaProjection() {
        if (sResultData == null) { Log.w(TAG, "No MediaProjection result"); return; }
        MediaProjectionManager mpm = (MediaProjectionManager)
                getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        mediaProjection = mpm.getMediaProjection(sResultCode, sResultData);
        if (mediaProjection == null) Log.e(TAG, "Failed to get MediaProjection");
    }

    private String captureScreen() {
        if (mediaProjection == null) return null;
        try {
            DisplayMetrics metrics = getResources().getDisplayMetrics();
            int w = metrics.widthPixels; int h = metrics.heightPixels;
            int density = metrics.densityDpi;
            int scale = 3; int sw = w / scale; int sh = h / scale;
            imageReader = ImageReader.newInstance(sw, sh, PixelFormat.RGBA_8888, 2);
            virtualDisplay = mediaProjection.createVirtualDisplay(
                    "OverlayCapture", sw, sh, density / scale,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(), null, handler);
            Thread.sleep(500);
            Image image = imageReader.acquireLatestImage();
            if (image == null) { cleanup(); return null; }
            Image.Plane[] planes = image.getPlanes();
            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int rowPadding = rowStride - pixelStride * sw;
            Bitmap bitmap = Bitmap.createBitmap(
                    sw + rowPadding / pixelStride, sh, Bitmap.Config.ARGB_8888);
            bitmap.copyPixelsFromBuffer(buffer);
            image.close();
            if (bitmap.getWidth() > sw)
                bitmap = Bitmap.createBitmap(bitmap, 0, 0, sw, sh);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 50, baos);
            bitmap.recycle(); cleanup();
            return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            Log.e(TAG, "captureScreen error: " + e.getMessage());
            cleanup(); return null;
        }
    }

    private void cleanup() {
        if (virtualDisplay != null) { virtualDisplay.release(); virtualDisplay = null; }
        if (imageReader != null) { imageReader.close(); imageReader = null; }
    }

    private void startMonitoring() {
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                checkAndPeek();
                handler.postDelayed(this, POLL_INTERVAL_MS);
            }
        }, POLL_INTERVAL_MS);
    }

    private void checkAndPeek() {
        String currentPkg = getForegroundPackage();
        if (currentPkg == null || currentPkg.equals("app.zeabur.chi")) return;
        long now = System.currentTimeMillis();
        if (!currentPkg.equals(lastForegroundPkg)) {
            lastForegroundPkg = currentPkg; lastPkgStartTime = now; return;
        }
        long duration = now - lastPkgStartTime;
        long sinceLast = now - lastPeekTime;
        if (duration >= PEEK_THRESHOLD_MS && sinceLast >= PEEK_COOLDOWN_MS) {
            lastPeekTime = now;
            new Thread(() -> doPeek(currentPkg, duration)).start();
        }
    }

    private String getForegroundPackage() {
        try {
            UsageStatsManager usm = (UsageStatsManager)
                    getSystemService(Context.USAGE_STATS_SERVICE);
            long now = System.currentTimeMillis();
            List<UsageStats> stats = usm.queryUsageStats(
                    UsageStatsManager.INTERVAL_DAILY, now - 60000, now);
            if (stats == null || stats.isEmpty()) return null;
            SortedMap<Long, UsageStats> map = new TreeMap<>();
            for (UsageStats us : stats) map.put(us.getLastTimeUsed(), us);
            if (map.isEmpty()) return null;
            return map.get(map.lastKey()).getPackageName();
        } catch (Exception e) { return null; }
    }

    private void doPeek(String pkg, long durationMs) {
        Log.d(TAG, "Peeking at " + pkg + " after " + (durationMs / 1000) + "s");
        String base64Img = captureScreen();
        String appName = getAppName(pkg);
        long minutes = durationMs / 60000;
        String textContent = "[\u60ac\u6d6e\u7a97\u6293\u62cd] \u5979\u5df2\u7ecf\u5728" + appName + "\u4e0a\u5f85\u4e86" + minutes + "\u5206\u949f\u4e86\u3002";
        try {
            SharedPreferences prefs = getSharedPreferences("chi_overlay", MODE_PRIVATE);
            String apiBase = prefs.getString("apiBase", "");
            String apiKey = prefs.getString("apiKey", "");
            String model = prefs.getString("model", "");
            if (apiBase.isEmpty()) {
                fetchAndCacheApiConfig(prefs);
                apiBase = prefs.getString("apiBase", "");
                apiKey = prefs.getString("apiKey", "");
                model = prefs.getString("model", "");
            }
            if (apiBase.isEmpty() || apiKey.isEmpty()) {
                Log.w(TAG, "No API config"); return;
            }
            JSONObject body = new JSONObject();
            JSONArray messages = new JSONArray();
            JSONObject userMsg = new JSONObject();
            userMsg.put("role", "user");
            if (base64Img != null) {
                JSONArray contentParts = new JSONArray();
                JSONObject textPart = new JSONObject();
                textPart.put("type", "text");
                textPart.put("text", textContent + "\n\u8bf7\u6839\u636e\u622a\u56fe\u5185\u5bb9\u7b80\u77ed\u8bc4\u8bba\u4e00\u53e5\uff081-2\u53e5\u8bdd\uff09\uff0c\u50cf\u5e73\u65f6\u804a\u5929\u4e00\u6837\u81ea\u7136\u3002");
                contentParts.put(textPart);
                JSONObject imgPart = new JSONObject();
                imgPart.put("type", "image_url");
                JSONObject imgUrl = new JSONObject();
                imgUrl.put("url", "data:image/jpeg;base64," + base64Img);
                imgPart.put("image_url", imgUrl);
                contentParts.put(imgPart);
                userMsg.put("content", contentParts);
            } else {
                userMsg.put("content", textContent + "\n\u8bf7\u7b80\u77ed\u8bc4\u8bba\u4e00\u53e5\u3002");
            }
            messages.put(userMsg);
            body.put("messages", messages);
            body.put("source", "overlay");

            URL url = new URL("https://chi.zeabur.app/api/chat");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true); conn.setConnectTimeout(30000); conn.setReadTimeout(60000);
            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes(StandardCharsets.UTF_8)); os.close();
            int code = conn.getResponseCode();
            if (code == 200) {
                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line; while ((line = reader.readLine()) != null) sb.append(line);
                reader.close();
                JSONObject resp = new JSONObject(sb.toString());
                String reply = resp.optString("reply", "");
                if (reply.isEmpty()) {
                    JSONArray choices = resp.optJSONArray("choices");
                    if (choices != null && choices.length() > 0)
                        reply = choices.getJSONObject(0).getJSONObject("message").getString("content");
                }
                reply = reply.replaceAll("<think>[\\s\\S]*?</think>", "").trim();
                if (!reply.isEmpty()) {
                    showComment(reply);
                    Log.d(TAG, "Peek reply: " + reply);
                }
            } else { Log.e(TAG, "Chat API returned " + code); }
            conn.disconnect();
        } catch (Exception e) { Log.e(TAG, "doPeek error: " + e.getMessage()); }
    }

    private void fetchAndCacheApiConfig(SharedPreferences prefs) {
        try {
            URL url = new URL("https://chi.zeabur.app/api/data/pool_api_config");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000); conn.setReadTimeout(5000);
            BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line; while ((line = r.readLine()) != null) sb.append(line);
            r.close(); conn.disconnect();
            JSONObject data = new JSONObject(sb.toString());
            String val = data.optString("value", "");
            if (!val.isEmpty()) {
                JSONObject cfg = new JSONObject(val);
                prefs.edit()
                        .putString("apiBase", cfg.optString("apiBase", ""))
                        .putString("apiKey", cfg.optString("apiKey", ""))
                        .putString("model", cfg.optString("model", ""))
                        .apply();
            }
        } catch (Exception e) { Log.e(TAG, "fetchApiConfig error: " + e.getMessage()); }
    }

    private String getAppName(String pkg) {
        try {
            return getPackageManager()
                    .getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0))
                    .toString();
        } catch (Exception e) {
            String[] parts = pkg.split("\\.");
            return parts[parts.length - 1];
        }
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }
}
