const fs = require('fs');
const path = require('path');

// 1. Patch RNBackgroundActionsTask.java
const taskFile = path.resolve(
  __dirname,
  '../node_modules/react-native-background-actions/android/src/main/java/com/asterinet/react/bgactions/RNBackgroundActionsTask.java'
);

if (fs.existsSync(taskFile)) {
  let content = fs.readFileSync(taskFile, 'utf8');

  // A. Target notificationIntent creation to enforce package and singleTop
  const originalIntentBlock = `        Intent notificationIntent;
        if (linkingURI != null) {
            notificationIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(linkingURI));
        } else {
            //as RN works on single activity architecture - we don't need to find current activity on behalf of react context
            notificationIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (notificationIntent == null) {
                notificationIntent = new Intent(Intent.ACTION_MAIN)
                        .addCategory(Intent.CATEGORY_LAUNCHER)
                        .setPackage(context.getPackageName());
            }
        }`;

  const replacementIntentBlock = `        Intent notificationIntent;
        if (linkingURI != null) {
            notificationIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(linkingURI));
            notificationIntent.setPackage(context.getPackageName());
        } else {
            notificationIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (notificationIntent == null) {
                notificationIntent = new Intent(Intent.ACTION_MAIN)
                        .addCategory(Intent.CATEGORY_LAUNCHER);
            }
            notificationIntent.setPackage(context.getPackageName());
        }
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED | Intent.FLAG_ACTIVITY_SINGLE_TOP);`;

  if (content.includes(originalIntentBlock)) {
    content = content.replace(originalIntentBlock, replacementIntentBlock);
  }

  // B. Target ServiceCompat.startForeground to guarantee FOREGROUND_SERVICE_TYPE_DATA_SYNC and catch-all Throwable
  const originalStartForegroundRegex = /try\s*\{\s*ServiceCompat\.startForeground\([\s\S]*?throw\s+e;\s*\}/m;
  const replacementStartForeground = `try {
            int fgsType = bgOptions.getForegroundServiceType();
            if (fgsType == 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                fgsType = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
            }
            ServiceCompat.startForeground(
                this,
                SERVICE_NOTIFICATION_ID,
                notification,
                fgsType
            );
        } catch (Throwable t) {
            android.util.Log.e("RNBackgroundActions", "ServiceCompat.startForeground caught throwable: " + t.getMessage(), t);
            stopSelf(startId);
            return START_NOT_STICKY;
        }`;

  if (originalStartForegroundRegex.test(content)) {
    content = content.replace(originalStartForegroundRegex, replacementStartForeground);
    console.log('[patch-background-actions] Patched startForeground with dataSync fallback & Throwable catch in RNBackgroundActionsTask.java.');
  }

  fs.writeFileSync(taskFile, content, 'utf8');
  console.log('[patch-background-actions] Successfully written RNBackgroundActionsTask.java.');
} else {
  console.log('[patch-background-actions] RNBackgroundActionsTask.java not found at:', taskFile);
}

// 2. Patch BackgroundActionsModule.java to prevent startForegroundService crashes
const moduleFile = path.resolve(
  __dirname,
  '../node_modules/react-native-background-actions/android/src/main/java/com/asterinet/react/bgactions/BackgroundActionsModule.java'
);

if (fs.existsSync(moduleFile)) {
  let modContent = fs.readFileSync(moduleFile, 'utf8');

  // Replace start() method body with bulletproof try-catch
  const originalStartMethodRegex = /public\s+void\s+start\(@NonNull\s+final\s+ReadableMap\s+options,\s*@NonNull\s+final\s+Promise\s+promise\)\s*\{[\s\S]*?promise\.resolve\(null\);\s*\}\s*catch\s*\(Exception\s+e\)\s*\{\s*promise\.reject\(e\);\s*\}\s*\}/m;

  const replacementStartMethod = `public void start(@NonNull final ReadableMap options, @NonNull final Promise promise) {
        try {
            if (currentServiceIntent != null) {
                try {
                    reactContext.stopService(currentServiceIntent);
                } catch (Throwable ignored) {}
            }
            currentServiceIntent = new Intent(reactContext, RNBackgroundActionsTask.class);
            final BackgroundTaskOptions bgOptions = new BackgroundTaskOptions(reactContext, options);
            currentServiceIntent.putExtras(bgOptions.getExtras());
            try {
                ContextCompat.startForegroundService(reactContext, currentServiceIntent);
            } catch (Throwable t) {
                android.util.Log.e(TAG, "ContextCompat.startForegroundService failed: " + t.getMessage(), t);
            }
            promise.resolve(null);
        } catch (Throwable e) {
            android.util.Log.e(TAG, "BackgroundActionsModule.start error: " + e.getMessage(), e);
            promise.resolve(null);
        }
    }`;

  if (originalStartMethodRegex.test(modContent)) {
    modContent = modContent.replace(originalStartMethodRegex, replacementStartMethod);
    fs.writeFileSync(moduleFile, modContent, 'utf8');
    console.log('[patch-background-actions] Successfully patched BackgroundActionsModule.java with bulletproof startForegroundService guard.');
  }
} else {
  console.log('[patch-background-actions] BackgroundActionsModule.java not found at:', moduleFile);
}
