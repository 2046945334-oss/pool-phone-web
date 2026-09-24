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
import android.graphics.BitmapFactory;
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
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Random;
import java.util.SortedMap;
import java.util.TreeMap;

public class OverlayService extends Service {
    private static final String TAG = "OverlayPeek";
    private static final String CHANNEL_ID = "chi_overlay";
    private static final int NOTIF_ID = 9001;
    // Min time on same app before eligible
    private static final long PEEK_MIN_MS = 2 * 60 * 1000; // 2 min
    // Each poll after min has this chance to trigger
    private static final double PEEK_CHANCE = 0.30; // 30%
    // Cooldown between peeks
    private static final long PEEK_COOLDOWN_MS = 10 * 60 * 1000; // 10 min
    // Poll interval
    private static final long POLL_INTERVAL_MS = 30 * 1000; // 30s

    private WindowManager windowManager;
    private View bubbleView;
    private ImageView bubbleImage;
    private View commentCard;
    private TextView commentText;
    private boolean commentVisible = false;
    private WindowManager.LayoutParams bubbleParams;
    private WindowManager.LayoutParams commentParams;
    private long lastTapTime = 0;
    private Runnable singleTapRunnable;

    private Handler handler;
    private Random random = new Random();
    private String lastForegroundPkg = "";
    private long lastPkgStartTime = 0;
    private long lastPeekTime = 0;

    private MediaProjection mediaProjection;
    private static int sResultCode;
    private static Intent sResultData;
    private int screenW, screenH;

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
        loadBubbleAvatar();
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

    // ============ Bubble UI ============
    private void createBubble() {
        int size = dp(48);
        bubbleImage = new ImageView(this);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(Color.parseColor("#e8b4d8"));
        bubbleImage.setBackground(circle);
        bubbleImage.setScaleType(ImageView.ScaleType.CENTER_CROP);
        bubbleImage.setClipToOutline(true);
        bubbleView = bubbleImage;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                size, size,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dp(8);
        params.y = dp(200);

        bubbleImage.setOnTouchListener(new View.OnTouchListener() {
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
                        if (!dragging) {
                            long now = System.currentTimeMillis();
                            if (now - lastTapTime < 300) {
                                // Double tap - cancel pending single tap and do manual peek
                                if (singleTapRunnable != null) handler.removeCallbacks(singleTapRunnable);
                                lastTapTime = 0;
                                doManualPeek();
                            } else {
                                // Maybe single tap - wait to see if double
                                lastTapTime = now;
                                singleTapRunnable = () -> toggleComment();
                                handler.postDelayed(singleTapRunnable, 300);
                            }
                        }
                        return true;
                }
                return false;
            }
        });
        bubbleParams = params;
        windowManager.addView(bubbleView, params);
    }

    private void loadBubbleAvatar() {
        new Thread(() -> {
            try {
                SharedPreferences prefs = getSharedPreferences("chi_overlay", MODE_PRIVATE);
                String avatarUrl = prefs.getString("bubbleAvatar", "");
                if (avatarUrl.isEmpty()) {
                    // Try to fetch from backend KV pool_overlay_config
                    URL url = new URL("https://chi.zeabur.app/api/data/pool_overlay_config");
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
                        avatarUrl = cfg.optString("bubbleAvatar", "");
                        prefs.edit().putString("bubbleAvatar", avatarUrl).apply();
                    }
                }
                if (!avatarUrl.isEmpty()) {
                    if (avatarUrl.startsWith("/")) avatarUrl = "https://chi.zeabur.app" + avatarUrl;
                    prefs.edit().putString("bubbleAvatar", avatarUrl).apply();
                    URL imgUrl = new URL(avatarUrl);
                    InputStream is = imgUrl.openStream();
                    Bitmap bmp = BitmapFactory.decodeStream(is);
                    is.close();
                    if (bmp != null) {
                        // Crop to circle
                        int sz = Math.min(bmp.getWidth(), bmp.getHeight());
                        Bitmap square = Bitmap.createBitmap(bmp, (bmp.getWidth()-sz)/2, (bmp.getHeight()-sz)/2, sz, sz);
                        handler.post(() -> {
                            bubbleImage.setImageBitmap(square);
                            // Make it round via outline
                            bubbleImage.setOutlineProvider(new android.view.ViewOutlineProvider() {
                                @Override
                                public void getOutline(View view, android.graphics.Outline outline) {
                                    outline.setOval(0, 0, view.getWidth(), view.getHeight());
                                }
                            });
                            bubbleImage.setClipToOutline(true);
                        });
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "loadBubbleAvatar error: " + e.getMessage());
            }
        }).start();
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
        commentParams = params;
        windowManager.addView(commentCard, params);
    }

    private void toggleComment() {
        commentVisible = !commentVisible;
        if (commentVisible && bubbleParams != null && commentParams != null) {
            commentParams.x = bubbleParams.x;
            commentParams.y = bubbleParams.y - dp(60);
            windowManager.updateViewLayout(commentCard, commentParams);
        }
        commentCard.setVisibility(commentVisible ? View.VISIBLE : View.GONE);
    }

    private void showComment(String text) {
        handler.post(() -> {
            commentText.setText(text);
            // Position comment card relative to bubble
            if (bubbleParams != null && commentParams != null) {
                commentParams.x = bubbleParams.x;
                commentParams.y = bubbleParams.y - dp(60);
                windowManager.updateViewLayout(commentCard, commentParams);
            }
            commentCard.setVisibility(View.VISIBLE);
            commentVisible = true;
            handler.postDelayed(() -> {
                commentCard.setVisibility(View.GONE);
                commentVisible = false;
            }, 15000);
        });
    }

    // ============ MediaProjection ============
    private void initMediaProjection() {
        if (sResultData == null) { Log.w(TAG, "No MediaProjection result"); return; }
        try {
            MediaProjectionManager mpm = (MediaProjectionManager)
                    getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            mediaProjection = mpm.getMediaProjection(sResultCode, sResultData);
            if (mediaProjection == null) { Log.e(TAG, "Failed to get MediaProjection"); return; }
            DisplayMetrics metrics = getResources().getDisplayMetrics();
            int scale = 3;
            screenW = metrics.widthPixels / scale;
            screenH = metrics.heightPixels / scale;
            Log.d(TAG, "MediaProjection ready, screen: " + screenW + "x" + screenH);
        } catch (Exception e) {
            Log.e(TAG, "initMediaProjection error: " + e.getMessage());
        }
    }

    private String lastCaptureDiag = "";
    private String[] captureScreenDiag() {
        if (mediaProjection == null) {
            return new String[]{null, "mediaProjection=null"};
        }
        if (screenW <= 0 || screenH <= 0) {
            return new String[]{null, "screen=" + screenW + "x" + screenH};
        }
        ImageReader reader = null;
        VirtualDisplay vd = null;
        try {
            DisplayMetrics metrics = getResources().getDisplayMetrics();
            int density = metrics.densityDpi / 3;
            reader = ImageReader.newInstance(screenW, screenH, PixelFormat.RGBA_8888, 2);
            final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
            reader.setOnImageAvailableListener(r -> latch.countDown(), handler);
            try {
                vd = mediaProjection.createVirtualDisplay(
                        "OverlayCapture", screenW, screenH, density,
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                        reader.getSurface(), null, handler);
            } catch (Exception e) {
                return new String[]{null, "createVD:" + e.getClass().getSimpleName()};
            }
            if (vd == null) {
                return new String[]{null, "vd=null"};
            }
            boolean gotFrame = latch.await(3, java.util.concurrent.TimeUnit.SECONDS);
            if (!gotFrame) {
                return new String[]{null, "timeout3s"};
            }
            Thread.sleep(150);
            Image image = reader.acquireLatestImage();
            if (image == null) {
                return new String[]{null, "image=null"};
            }
            Image.Plane[] planes = image.getPlanes();
            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int rowPadding = rowStride - pixelStride * screenW;
            Bitmap bitmap = Bitmap.createBitmap(
                    screenW + rowPadding / pixelStride, screenH, Bitmap.Config.ARGB_8888);
            bitmap.copyPixelsFromBuffer(buffer);
            image.close();
            if (bitmap.getWidth() > screenW)
                bitmap = Bitmap.createBitmap(bitmap, 0, 0, screenW, screenH);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 50, baos);
            bitmap.recycle();
            return new String[]{Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP), "ok:" + baos.size() + "B"};
        } catch (Exception e) {
            return new String[]{null, "ex:" + e.getClass().getSimpleName() + ":" + e.getMessage()};
        } finally {
            if (vd != null) try { vd.release(); } catch (Exception ignored) {}
            if (reader != null) try { reader.close(); } catch (Exception ignored) {}
        }
    }

    // ============ App Monitoring with Random Trigger ============
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
        // Must meet minimum time + cooldown, then random chance each poll
        if (duration >= PEEK_MIN_MS && sinceLast >= PEEK_COOLDOWN_MS) {
            if (random.nextDouble() < PEEK_CHANCE) {
                lastPeekTime = now;
                new Thread(() -> doPeek(currentPkg, duration)).start();
            }
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

    // ============ Peek Logic - calls /api/overlay-chat ============
    private void doPeek(String pkg, long durationMs) {
        Log.d(TAG, "Peeking at " + pkg + " after " + (durationMs / 1000) + "s");
        String[] capResult = captureScreenDiag();
        String base64Img = capResult[0];
        Log.d(TAG, "doPeek capture: " + capResult[1]);
        String appName = getAppName(pkg);
        long minutes = durationMs / 60000;
        String textContent = "[\u60ac\u6d6e\u7a97\u6293\u62cd] \u5979\u5df2\u7ecf\u5728" + appName + "\u4e0a\u5f85\u4e86" + minutes + "\u5206\u949f\u4e86\u3002";
        try {
            JSONObject body = new JSONObject();
            JSONArray messages = new JSONArray();
            JSONObject userMsg = new JSONObject();
            userMsg.put("role", "user");
            if (base64Img != null) {
                JSONArray contentParts = new JSONArray();
                JSONObject textPart = new JSONObject();
                textPart.put("type", "text");
                textPart.put("text", textContent);
                contentParts.put(textPart);
                JSONObject imgPart = new JSONObject();
                imgPart.put("type", "image_url");
                JSONObject imgUrl = new JSONObject();
                imgUrl.put("url", "data:image/jpeg;base64," + base64Img);
                imgPart.put("image_url", imgUrl);
                contentParts.put(imgPart);
                userMsg.put("content", contentParts);
            } else {
                userMsg.put("content", textContent);
            }
            messages.put(userMsg);
            body.put("messages", messages);
            body.put("source", "overlay");

            // Call our backend overlay-chat endpoint (has full context)
            URL url = new URL("https://chi.zeabur.app/api/overlay-chat");
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
                reply = reply.replaceAll("<think>[\\s\\S]*?</think>", "").trim();
                if (!reply.isEmpty()) {
                    showComment(reply);
                    Log.d(TAG, "Peek reply: " + reply);
                }
            } else { Log.e(TAG, "overlay-chat returned " + code); }
            conn.disconnect();
        } catch (Exception e) { Log.e(TAG, "doPeek error: " + e.getMessage()); }
    }

    // ============ Manual Peek (user double-tap) ============
    private void doManualPeek() {
        showComment("截图中..."); // "截图中..."
        new Thread(() -> {
            String[] capResult = captureScreenDiag();
            String base64Img = capResult[0];
            String capDiag = capResult[1];
            Log.d(TAG, "doManualPeek capture: " + capDiag);
            // Show diagnostic on bubble for debugging
            handler.post(() -> showComment("截图: " + capDiag));
            String pkg = getForegroundPackage();
            String appName = (pkg != null) ? getAppName(pkg) : "未知";
            String textContent = "[用户主动分享] 她正在看" + appName + "，想给你看看这个。";
            try {
                JSONObject body = new JSONObject();
                JSONArray messages = new JSONArray();
                JSONObject userMsg = new JSONObject();
                userMsg.put("role", "user");
                if (base64Img != null) {
                    JSONArray contentParts = new JSONArray();
                    JSONObject textPart = new JSONObject();
                    textPart.put("type", "text");
                    textPart.put("text", textContent);
                    contentParts.put(textPart);
                    JSONObject imgPart = new JSONObject();
                    imgPart.put("type", "image_url");
                    JSONObject imgUrl = new JSONObject();
                    imgUrl.put("url", "data:image/jpeg;base64," + base64Img);
                    imgPart.put("image_url", imgUrl);
                    contentParts.put(imgPart);
                    userMsg.put("content", contentParts);
                } else {
                    userMsg.put("content", textContent + " (截图失败)");
                }
                messages.put(userMsg);
                body.put("messages", messages);
                body.put("source", "overlay_manual");

                URL url = new URL("https://chi.zeabur.app/api/overlay-chat");
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
                    reply = reply.replaceAll("<think>[\\s\\S]*?</think>", "").trim();
                    if (!reply.isEmpty()) {
                        showComment(reply);
                        Log.d(TAG, "ManualPeek reply: " + reply);
                    } else {
                        showComment("看到了～");
                    }
                } else {
                    Log.e(TAG, "manual overlay-chat returned " + code);
                    showComment("网络错误 " + code);
                }
                conn.disconnect();
            } catch (Exception e) {
                Log.e(TAG, "doManualPeek error: " + e.getMessage());
                handler.post(() -> showComment("分享失败了"));
            }
        }).start();
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
