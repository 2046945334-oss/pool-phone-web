package app.zeabur.chi;

import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.app.usage.UsageEvents;

import java.util.Calendar;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@CapacitorPlugin(name = "UsageStats")
public class UsageStatsPlugin extends Plugin {

    @PluginMethod()
    public void hasPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", checkPermission());
        call.resolve(ret);
    }

    @PluginMethod()
    public void requestPermission(PluginCall call) {
        if (!checkPermission()) {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        JSObject ret = new JSObject();
        ret.put("granted", checkPermission());
        call.resolve(ret);
    }

    @PluginMethod()
    public void query(PluginCall call) {
        if (!checkPermission()) {
            call.reject("USAGE_STATS permission not granted");
            return;
        }

        int days = call.getInt("days", 1);

        UsageStatsManager usm = (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) {
            call.reject("UsageStatsManager not available");
            return;
        }

        Calendar cal = Calendar.getInstance();
        long endTime = cal.getTimeInMillis();
        cal.add(Calendar.DAY_OF_YEAR, -days);
        long startTime = cal.getTimeInMillis();

        List<UsageStats> stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startTime, endTime);
        if (stats == null || stats.isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("apps", new JSArray());
            call.resolve(ret);
            return;
        }

        // Merge by package name
        Map<String, long[]> merged = new TreeMap<>();
        for (UsageStats s : stats) {
            String pkg = s.getPackageName();
            long total = s.getTotalTimeInForeground();
            long last = s.getLastTimeUsed();
            if (total <= 0) continue;
            long[] prev = merged.get(pkg);
            if (prev == null) {
                merged.put(pkg, new long[]{total, last});
            } else {
                prev[0] += total;
                if (last > prev[1]) prev[1] = last;
            }
        }

        PackageManager pm = getContext().getPackageManager();
        JSArray arr = new JSArray();
        for (Map.Entry<String, long[]> e : merged.entrySet()) {
            String pkg = e.getKey();
            long totalMs = e.getValue()[0];
            long lastUsed = e.getValue()[1];
            if (totalMs < 60000) continue; // skip < 1min

            JSObject item = new JSObject();
            item.put("packageName", pkg);
            item.put("totalTimeMs", totalMs);
            item.put("lastUsed", lastUsed);

            // Try to get app label
            try {
                ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                item.put("appName", pm.getApplicationLabel(ai).toString());
            } catch (PackageManager.NameNotFoundException ex) {
                item.put("appName", pkg);
            }

            arr.put(item);
        }

        JSObject ret = new JSObject();
        ret.put("apps", arr);
        ret.put("startTime", startTime);
        ret.put("endTime", endTime);
        call.resolve(ret);
    }

    @PluginMethod()
    public void queryDaily(PluginCall call) {
        if (!checkPermission()) {
            call.reject("USAGE_STATS permission not granted");
            return;
        }

        int days = call.getInt("days", 7);

        UsageStatsManager usm = (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) {
            call.reject("UsageStatsManager not available");
            return;
        }

        Calendar cal = Calendar.getInstance();
        long endTime = cal.getTimeInMillis();
        cal.add(Calendar.DAY_OF_YEAR, -days);
        long startTime = cal.getTimeInMillis();

        // Query daily intervals
        List<UsageStats> stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startTime, endTime);
        if (stats == null || stats.isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("daily", new JSArray());
            call.resolve(ret);
            return;
        }

        // Group by day -> package -> totalTime
        Map<String, Map<String, Long>> dailyMap = new TreeMap<>();
        PackageManager pm = getContext().getPackageManager();
        Map<String, String> nameCache = new TreeMap<>();

        Calendar dayCal = Calendar.getInstance();
        for (UsageStats s : stats) {
            long total = s.getTotalTimeInForeground();
            if (total <= 0) continue;
            String pkg = s.getPackageName();

            // Determine which day this stat belongs to (using lastTimeUsed as proxy)
            dayCal.setTimeInMillis(s.getLastTimeUsed());
            String dayKey = String.format("%04d-%02d-%02d",
                    dayCal.get(Calendar.YEAR),
                    dayCal.get(Calendar.MONTH) + 1,
                    dayCal.get(Calendar.DAY_OF_MONTH));

            Map<String, Long> dayData = dailyMap.get(dayKey);
            if (dayData == null) {
                dayData = new TreeMap<>();
                dailyMap.put(dayKey, dayData);
            }
            Long prev = dayData.get(pkg);
            dayData.put(pkg, (prev == null ? 0 : prev) + total);

            if (!nameCache.containsKey(pkg)) {
                try {
                    ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                    nameCache.put(pkg, pm.getApplicationLabel(ai).toString());
                } catch (PackageManager.NameNotFoundException ex) {
                    nameCache.put(pkg, pkg);
                }
            }
        }

        JSArray dailyArr = new JSArray();
        for (Map.Entry<String, Map<String, Long>> dayEntry : dailyMap.entrySet()) {
            JSObject dayObj = new JSObject();
            dayObj.put("date", dayEntry.getKey());
            JSArray appsArr = new JSArray();
            long dayTotal = 0;
            for (Map.Entry<String, Long> appEntry : dayEntry.getValue().entrySet()) {
                if (appEntry.getValue() < 60000) continue;
                JSObject appObj = new JSObject();
                appObj.put("packageName", appEntry.getKey());
                appObj.put("appName", nameCache.getOrDefault(appEntry.getKey(), appEntry.getKey()));
                appObj.put("totalTimeMs", appEntry.getValue());
                appsArr.put(appObj);
                dayTotal += appEntry.getValue();
            }
            dayObj.put("apps", appsArr);
            dayObj.put("totalMs", dayTotal);
            dailyArr.put(dayObj);
        }

        JSObject ret = new JSObject();
        ret.put("daily", dailyArr);
        call.resolve(ret);
    }

    @PluginMethod()
    public void getCurrentApp(PluginCall call) {
        if (!checkPermission()) {
            call.reject("USAGE_STATS permission not granted");
            return;
        }

        UsageStatsManager usm = (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) {
            call.reject("UsageStatsManager not available");
            return;
        }

        // Query events from the last 5 minutes to find the most recent foreground app
        long endTime = System.currentTimeMillis();
        long startTime = endTime - 5 * 60 * 1000;

        UsageEvents events = usm.queryEvents(startTime, endTime);
        String lastPkg = null;
        long lastTime = 0;

        while (events.hasNextEvent()) {
            UsageEvents.Event event = new UsageEvents.Event();
            events.getNextEvent(event);
            if (event.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                if (event.getTimeStamp() > lastTime) {
                    lastTime = event.getTimeStamp();
                    lastPkg = event.getPackageName();
                }
            }
        }

        JSObject ret = new JSObject();
        if (lastPkg != null) {
            ret.put("packageName", lastPkg);
            ret.put("timestamp", lastTime);
            // Get app label
            PackageManager pm = getContext().getPackageManager();
            try {
                ApplicationInfo ai = pm.getApplicationInfo(lastPkg, 0);
                ret.put("appName", pm.getApplicationLabel(ai).toString());
            } catch (PackageManager.NameNotFoundException ex) {
                ret.put("appName", lastPkg);
            }
        } else {
            ret.put("packageName", "");
            ret.put("appName", "unknown");
            ret.put("timestamp", 0);
        }
        call.resolve(ret);
    }

    @PluginMethod()
    public void getRecentApps(PluginCall call) {
        if (!checkPermission()) {
            call.reject("USAGE_STATS permission not granted");
            return;
        }

        UsageStatsManager usm = (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) {
            call.reject("UsageStatsManager not available");
            return;
        }

        int minutes = call.getInt("minutes", 30);
        long endTime = System.currentTimeMillis();
        long startTime = endTime - (long) minutes * 60 * 1000;

        UsageEvents events = usm.queryEvents(startTime, endTime);
        PackageManager pm = getContext().getPackageManager();

        // Collect foreground events in order
        JSArray arr = new JSArray();
        Map<String, String> nameCache = new TreeMap<>();
        String prevPkg = null;

        while (events.hasNextEvent()) {
            UsageEvents.Event event = new UsageEvents.Event();
            events.getNextEvent(event);
            if (event.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                String pkg = event.getPackageName();
                if (pkg.equals(prevPkg)) continue;
                prevPkg = pkg;

                if (!nameCache.containsKey(pkg)) {
                    try {
                        ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                        nameCache.put(pkg, pm.getApplicationLabel(ai).toString());
                    } catch (PackageManager.NameNotFoundException ex) {
                        nameCache.put(pkg, pkg);
                    }
                }

                JSObject item = new JSObject();
                item.put("packageName", pkg);
                item.put("appName", nameCache.get(pkg));
                item.put("timestamp", event.getTimeStamp());
                arr.put(item);
            }
        }

        JSObject ret = new JSObject();
        ret.put("apps", arr);
        ret.put("startTime", startTime);
        ret.put("endTime", endTime);
        call.resolve(ret);
    }

    private boolean checkPermission() {
        AppOpsManager appOps = (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
        int mode;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            mode = appOps.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(),
                    getContext().getPackageName()
            );
        } else {
            mode = appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(),
                    getContext().getPackageName()
            );
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }
}
