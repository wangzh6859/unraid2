const { withAndroidManifest, withMainApplication, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Expo Config Plugin to implement a true native Android System Overlay Dynamic Island
 * using SYSTEM_ALERT_WINDOW and WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY.
 */
module.exports = function withDynamicIslandOverlay(config) {
  // 1. Add SYSTEM_ALERT_WINDOW permission to AndroidManifest.xml
  config = withAndroidManifest(config, async (modConfig) => {
    const androidManifest = modConfig.modResults.manifest;
    if (!androidManifest['uses-permission']) {
      androidManifest['uses-permission'] = [];
    }

    const permission = 'android.permission.SYSTEM_ALERT_WINDOW';
    const exists = androidManifest['uses-permission'].some(
      (p) => p.$ && p.$['android:name'] === permission
    );
    if (!exists) {
      androidManifest['uses-permission'].push({
        $: { 'android:name': permission },
      });
    }
    return modConfig;
  });

  // 2. Generate Native Java Source Files for the Overlay in android project
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const packageDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        'com',
        'yourname',
        'unraidmanager'
      );
      fs.mkdirSync(packageDir, { recursive: true });

      // File 1: DynamicIslandOverlayPackage.java
      const packageJava = `package com.yourname.unraidmanager;

import androidx.annotation.NonNull;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class DynamicIslandOverlayPackage implements ReactPackage {
    @NonNull
    @Override
    public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new DynamicIslandOverlayModule(reactContext));
        return modules;
    }

    @NonNull
    @Override
    public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
`;
      fs.writeFileSync(path.join(packageDir, 'DynamicIslandOverlayPackage.java'), packageJava, 'utf8');

      // File 2: DynamicIslandOverlayModule.java
      const moduleJava = `package com.yourname.unraidmanager;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;

public class DynamicIslandOverlayModule extends ReactContextBaseJavaModule {
    private final ReactApplicationContext reactContext;

    public DynamicIslandOverlayModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "DynamicIslandOverlay";
    }

    @ReactMethod
    public void canDrawOverlays(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                promise.resolve(Settings.canDrawOverlays(reactContext));
            } else {
                promise.resolve(true);
            }
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void requestOverlayPermission() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + reactContext.getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(intent);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void showIsland(ReadableMap options) {
        try {
            String name = options.hasKey("name") ? options.getString("name") : "文件";
            int progress = options.hasKey("progress") ? options.getInt("progress") : 0;
            String speed = options.hasKey("speed") ? options.getString("speed") : "";
            String size = options.hasKey("size") ? options.getString("size") : "";
            String status = options.hasKey("status") ? options.getString("status") : "running";

            DynamicIslandOverlayManager.getInstance(reactContext).show(name, progress, speed, size, status);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void updateProgress(ReadableMap options) {
        try {
            int progress = options.hasKey("progress") ? options.getInt("progress") : 0;
            String speed = options.hasKey("speed") ? options.getString("speed") : "";
            String size = options.hasKey("size") ? options.getString("size") : "";
            String status = options.hasKey("status") ? options.getString("status") : "running";

            DynamicIslandOverlayManager.getInstance(reactContext).update(progress, speed, size, status);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void hideIsland() {
        try {
            DynamicIslandOverlayManager.getInstance(reactContext).hide();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
`;
      fs.writeFileSync(path.join(packageDir, 'DynamicIslandOverlayModule.java'), moduleJava, 'utf8');

      // File 3: DynamicIslandOverlayManager.java
      const managerJava = `package com.yourname.unraidmanager;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public class DynamicIslandOverlayManager {
    private static DynamicIslandOverlayManager instance;
    private final Context context;
    private final WindowManager windowManager;
    private final Handler mainHandler;

    private View rootView;
    private LinearLayout pillLayout;
    private LinearLayout cardLayout;

    private View pillPulseDot;
    private TextView pillTextProgress;
    private TextView pillTextName;

    private TextView cardTitle;
    private TextView cardBigPct;
    private TextView cardSpeed;
    private TextView cardSize;
    private View cardProgressFill;
    private FrameLayout cardProgressTrack;

    private boolean isShowing = false;
    private boolean isExpanded = false;
    private int currentProgress = 0;
    private String currentStatus = "idle";
    private Runnable autoDismissRunnable = null;

    private DynamicIslandOverlayManager(Context context) {
        this.context = context.getApplicationContext();
        this.windowManager = (WindowManager) this.context.getSystemService(Context.WINDOW_SERVICE);
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    public static synchronized DynamicIslandOverlayManager getInstance(Context context) {
        if (instance == null) {
            instance = new DynamicIslandOverlayManager(context);
        }
        return instance;
    }

    private int dp(float dpValue) {
        DisplayMetrics dm = context.getResources().getDisplayMetrics();
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dpValue, dm);
    }

    private int getStatusBarHeight() {
        int result = dp(32);
        int resourceId = context.getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (resourceId > 0) {
            result = context.getResources().getDimensionPixelSize(resourceId);
        }
        return result;
    }

    private WindowManager.LayoutParams createLayoutParams() {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                flags,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;

        int sbHeight = getStatusBarHeight();
        int pillHeight = dp(36);
        params.y = Math.max(dp(2), (sbHeight - pillHeight) / 2);
        return params;
    }

    private void buildViews() {
        FrameLayout root = new FrameLayout(context);

        // --- 1. Compact Pill View ---
        pillLayout = new LinearLayout(context);
        pillLayout.setOrientation(LinearLayout.HORIZONTAL);
        pillLayout.setGravity(Gravity.CENTER_VERTICAL);
        pillLayout.setPadding(dp(12), dp(4), dp(12), dp(4));

        GradientDrawable pillBg = new GradientDrawable();
        pillBg.setShape(GradientDrawable.RECTANGLE);
        pillBg.setColor(Color.parseColor("#0a0d14"));
        pillBg.setCornerRadius(dp(18));
        pillBg.setStroke(dp(1), Color.parseColor("#3b82f6"));
        pillLayout.setBackground(pillBg);

        pillPulseDot = new View(context);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(7), dp(7));
        dotLp.rightMargin = dp(6);
        pillPulseDot.setLayoutParams(dotLp);
        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(Color.parseColor("#3b82f6"));
        pillPulseDot.setBackground(dotBg);
        pillLayout.addView(pillPulseDot);

        pillTextProgress = new TextView(context);
        pillTextProgress.setTextColor(Color.parseColor("#ffffff"));
        pillTextProgress.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        pillTextProgress.setTypeface(null, android.graphics.Typeface.BOLD);
        pillLayout.addView(pillTextProgress);

        pillTextName = new TextView(context);
        pillTextName.setTextColor(Color.parseColor("#94a3b8"));
        pillTextName.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        pillTextName.setSingleLine(true);
        pillTextName.setEllipsize(TextUtils.TruncateAt.END);
        pillTextName.setMaxWidth(dp(110));
        LinearLayout.LayoutParams nameLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        nameLp.leftMargin = dp(5);
        pillTextName.setLayoutParams(nameLp);
        pillLayout.addView(pillTextName);

        TextView pillChevron = new TextView(context);
        pillChevron.setText(" ▼");
        pillChevron.setTextColor(Color.parseColor("#64748b"));
        pillChevron.setTextSize(TypedValue.COMPLEX_UNIT_SP, 9);
        pillLayout.addView(pillChevron);

        pillLayout.setOnClickListener(v -> expandIsland(true));
        root.addView(pillLayout);

        // --- 2. Expanded Card View ---
        cardLayout = new LinearLayout(context);
        cardLayout.setOrientation(LinearLayout.VERTICAL);
        cardLayout.setPadding(dp(14), dp(12), dp(14), dp(12));
        cardLayout.setVisibility(View.GONE);

        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setShape(GradientDrawable.RECTANGLE);
        cardBg.setColor(Color.parseColor("#0a0d14"));
        cardBg.setCornerRadius(dp(20));
        cardBg.setStroke(dp(1.2f), Color.parseColor("#1e293b"));
        cardLayout.setBackground(cardBg);

        // Header
        LinearLayout headRow = new LinearLayout(context);
        headRow.setOrientation(LinearLayout.HORIZONTAL);
        headRow.setGravity(Gravity.CENTER_VERTICAL);

        cardTitle = new TextView(context);
        cardTitle.setTextColor(Color.parseColor("#ffffff"));
        cardTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        cardTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        cardTitle.setSingleLine(true);
        cardTitle.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams ctLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        cardTitle.setLayoutParams(ctLp);
        headRow.addView(cardTitle);

        TextView btnClose = new TextView(context);
        btnClose.setText(" ▲ 收起");
        btnClose.setTextColor(Color.parseColor("#94a3b8"));
        btnClose.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        btnClose.setPadding(dp(8), dp(4), dp(4), dp(4));
        btnClose.setOnClickListener(v -> expandIsland(false));
        headRow.addView(btnClose);
        cardLayout.addView(headRow);

        // Metrics
        LinearLayout metricRow = new LinearLayout(context);
        metricRow.setOrientation(LinearLayout.HORIZONTAL);
        metricRow.setGravity(Gravity.BOTTOM);
        metricRow.setPadding(0, dp(6), 0, dp(4));

        cardBigPct = new TextView(context);
        cardBigPct.setText("0%");
        cardBigPct.setTextColor(Color.parseColor("#3b82f6"));
        cardBigPct.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        cardBigPct.setTypeface(null, android.graphics.Typeface.BOLD);
        metricRow.addView(cardBigPct);

        cardSpeed = new TextView(context);
        cardSpeed.setTextColor(Color.parseColor("#94a3b8"));
        cardSpeed.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        spLp.leftMargin = dp(8);
        spLp.bottomMargin = dp(3);
        cardSpeed.setLayoutParams(spLp);
        metricRow.addView(cardSpeed);

        cardSize = new TextView(context);
        cardSize.setTextColor(Color.parseColor("#64748b"));
        cardSize.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        LinearLayout.LayoutParams szLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        szLp.bottomMargin = dp(3);
        cardSize.setGravity(Gravity.RIGHT);
        cardSize.setLayoutParams(szLp);
        metricRow.addView(cardSize);
        cardLayout.addView(metricRow);

        // Progress Track & Fill
        cardProgressTrack = new FrameLayout(context);
        LinearLayout.LayoutParams trackLp = new LinearLayout.LayoutParams(dp(300), dp(4));
        trackLp.topMargin = dp(4);
        trackLp.bottomMargin = dp(8);
        cardProgressTrack.setLayoutParams(trackLp);
        GradientDrawable trackBg = new GradientDrawable();
        trackBg.setShape(GradientDrawable.RECTANGLE);
        trackBg.setColor(Color.parseColor("#1e293b"));
        trackBg.setCornerRadius(dp(2));
        cardProgressTrack.setBackground(trackBg);

        cardProgressFill = new View(context);
        FrameLayout.LayoutParams fillLp = new FrameLayout.LayoutParams(dp(10), dp(4));
        cardProgressFill.setLayoutParams(fillLp);
        GradientDrawable fillBg = new GradientDrawable();
        fillBg.setShape(GradientDrawable.RECTANGLE);
        fillBg.setColor(Color.parseColor("#3b82f6"));
        fillBg.setCornerRadius(dp(2));
        cardProgressFill.setBackground(fillBg);
        cardProgressTrack.addView(cardProgressFill);
        cardLayout.addView(cardProgressTrack);

        // Bottom Open App Button
        LinearLayout btnRow = new LinearLayout(context);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.RIGHT);

        TextView btnOpen = new TextView(context);
        btnOpen.setText("打开应用");
        btnOpen.setTextColor(Color.parseColor("#ffffff"));
        btnOpen.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        btnOpen.setTypeface(null, android.graphics.Typeface.BOLD);
        btnOpen.setPadding(dp(12), dp(4), dp(12), dp(4));
        GradientDrawable openBg = new GradientDrawable();
        openBg.setColor(Color.parseColor("#3b82f6"));
        openBg.setCornerRadius(dp(6));
        btnOpen.setBackground(openBg);
        btnOpen.setOnClickListener(v -> {
            try {
                Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                    context.startActivity(launchIntent);
                }
            } catch (Exception ignored) {}
        });
        btnRow.addView(btnOpen);
        cardLayout.addView(btnRow);

        root.addView(cardLayout);
        this.rootView = root;
    }

    private void expandIsland(boolean expand) {
        if (!isShowing || rootView == null) return;
        isExpanded = expand;
        mainHandler.post(() -> {
            try {
                if (expand) {
                    pillLayout.setVisibility(View.GONE);
                    cardLayout.setVisibility(View.VISIBLE);
                } else {
                    cardLayout.setVisibility(View.GONE);
                    pillLayout.setVisibility(View.VISIBLE);
                }
                if (rootView.isAttachedToWindow()) {
                    windowManager.updateViewLayout(rootView, createLayoutParams());
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    public void show(String name, int progress, String speed, String size, String status) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            return;
        }

        mainHandler.post(() -> {
            try {
                if (autoDismissRunnable != null) {
                    mainHandler.removeCallbacks(autoDismissRunnable);
                    autoDismissRunnable = null;
                }

                if (!isShowing) {
                    buildViews();
                    windowManager.addView(rootView, createLayoutParams());
                    isShowing = true;
                    isExpanded = false;
                }
                applyData(name, progress, speed, size, status);
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    public void update(int progress, String speed, String size, String status) {
        if (!isShowing || rootView == null) return;
        mainHandler.post(() -> {
            try {
                applyData(null, progress, speed, size, status);
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    private void applyData(String name, int progress, String speed, String size, String status) {
        this.currentProgress = Math.min(100, Math.max(0, progress));
        this.currentStatus = status != null ? status : "running";

        int themeColor = Color.parseColor("#3b82f6");
        if ("success".equals(currentStatus)) {
            themeColor = Color.parseColor("#10b981");
        } else if ("error".equals(currentStatus)) {
            themeColor = Color.parseColor("#ef4444");
        } else if ("paused".equals(currentStatus)) {
            themeColor = Color.parseColor("#f59e0b");
        }

        // Apply to pill
        if (name != null && pillTextName != null) {
            pillTextName.setText(name);
        }
        if (pillTextProgress != null) {
            if ("success".equals(currentStatus)) {
                pillTextProgress.setText("已完成");
            } else if ("paused".equals(currentStatus)) {
                pillTextProgress.setText("已暂停");
            } else if ("error".equals(currentStatus)) {
                pillTextProgress.setText("异常");
            } else {
                pillTextProgress.setText(currentProgress + "%" + (TextUtils.isEmpty(speed) ? "" : " · " + speed));
            }
        }
        if (pillPulseDot != null) {
            GradientDrawable d = (GradientDrawable) pillPulseDot.getBackground();
            if (d != null) d.setColor(themeColor);
        }
        if (pillLayout != null) {
            GradientDrawable bg = (GradientDrawable) pillLayout.getBackground();
            if (bg != null) bg.setStroke(dp(1), themeColor);
        }

        // Apply to card
        if (name != null && cardTitle != null) {
            cardTitle.setText(name);
        }
        if (cardBigPct != null) {
            cardBigPct.setText(currentProgress + "%");
            cardBigPct.setTextColor(themeColor);
        }
        if (cardSpeed != null) {
            cardSpeed.setText("success".equals(currentStatus) ? "传输已顺利完成" : (TextUtils.isEmpty(speed) ? "" : speed));
        }
        if (cardSize != null && !TextUtils.isEmpty(size)) {
            cardSize.setText(size);
        }
        if (cardProgressFill != null) {
            int totalTrackWidth = dp(300);
            int fillWidth = Math.max(dp(6), (totalTrackWidth * currentProgress) / 100);
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) cardProgressFill.getLayoutParams();
            lp.width = fillWidth;
            cardProgressFill.setLayoutParams(lp);
            GradientDrawable fillBg = (GradientDrawable) cardProgressFill.getBackground();
            if (fillBg != null) fillBg.setColor(themeColor);
        }

        // Auto dismiss celebration
        if ("success".equals(currentStatus)) {
            if (autoDismissRunnable != null) {
                mainHandler.removeCallbacks(autoDismissRunnable);
            }
            autoDismissRunnable = this::hide;
            mainHandler.postDelayed(autoDismissRunnable, 3500);
        }
    }

    public void hide() {
        mainHandler.post(() -> {
            try {
                if (autoDismissRunnable != null) {
                    mainHandler.removeCallbacks(autoDismissRunnable);
                    autoDismissRunnable = null;
                }
                if (isShowing && rootView != null && rootView.isAttachedToWindow()) {
                    windowManager.removeView(rootView);
                }
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                isShowing = false;
                isExpanded = false;
                rootView = null;
            }
        });
    }
}
`;
      fs.writeFileSync(path.join(packageDir, 'DynamicIslandOverlayManager.java'), managerJava, 'utf8');

      return modConfig;
    },
  ]);

  // 3. Inject DynamicIslandOverlayPackage into MainApplication.kt
  config = withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    const importStmt = 'import com.yourname.unraidmanager.DynamicIslandOverlayPackage';
    const addPackageStmt = 'add(DynamicIslandOverlayPackage())';

    if (!contents.includes(importStmt)) {
      contents = contents.replace(
        'package com.yourname.unraidmanager',
        `package com.yourname.unraidmanager\n\n${importStmt}`
      );
    }

    if (!contents.includes(addPackageStmt)) {
      if (contents.includes('// add(MyReactNativePackage())')) {
        contents = contents.replace(
          '// add(MyReactNativePackage())',
          `// add(MyReactNativePackage())\n              ${addPackageStmt}`
        );
      } else if (contents.includes('PackageList(this).packages.apply {')) {
        contents = contents.replace(
          'PackageList(this).packages.apply {',
          `PackageList(this).packages.apply {\n              ${addPackageStmt}`
        );
      } else if (contents.includes('PackageList(this).packages')) {
        contents = contents.replace(
          'PackageList(this).packages',
          `PackageList(this).packages.toMutableList().apply { ${addPackageStmt} }`
        );
      }
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

  return config;
};
