const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to configure Android Foreground Service with dataSync
 * for react-native-background-actions on Android 14+ (API 34+).
 */
module.exports = function withForegroundService(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;

    // 1. Ensure uses-permission array exists
    if (!androidManifest['uses-permission']) {
      androidManifest['uses-permission'] = [];
    }

    const requiredPermissions = [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.WAKE_LOCK',
    ];

    for (const perm of requiredPermissions) {
      const alreadyPresent = androidManifest['uses-permission'].some(
        (p) => p.$ && p.$['android:name'] === perm
      );
      if (!alreadyPresent) {
        androidManifest['uses-permission'].push({
          $: { 'android:name': perm },
        });
      }
    }

    // 2. Ensure service declaration inside <application>
    if (!androidManifest.application || !androidManifest.application[0]) {
      return config;
    }

    const app = androidManifest.application[0];
    if (!app.service) {
      app.service = [];
    }

    const serviceName = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    const existingService = app.service.find(
      (s) => s.$ && s.$['android:name'] === serviceName
    );

    if (!existingService) {
      app.service.push({
        $: {
          'android:name': serviceName,
          'android:foregroundServiceType': 'dataSync',
          'android:exported': 'false',
        },
      });
    } else {
      existingService.$['android:foregroundServiceType'] = 'dataSync';
      existingService.$['android:exported'] = 'false';
    }

    // 3. Ensure MainActivity has launchMode="singleTask" and exported="true" for direct notification jump
    if (app.activity && app.activity.length > 0) {
      const mainAct = app.activity.find(
        (a) => a.$ && (a.$['android:name'] === '.MainActivity' || a.$['android:name'] === 'com.yourname.unraidmanager.MainActivity')
      ) || app.activity[0];

      if (mainAct && mainAct.$) {
        mainAct.$['android:launchMode'] = 'singleTask';
        mainAct.$['android:exported'] = 'true';

        if (!mainAct['intent-filter']) {
          mainAct['intent-filter'] = [];
        }

        const hasUnraidScheme = mainAct['intent-filter'].some(
          (filter) => filter.data && filter.data.some((d) => d.$ && d.$['android:scheme'] === 'unraid')
        );

        if (!hasUnraidScheme) {
          mainAct['intent-filter'].push({
            action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
            category: [
              { $: { 'android:name': 'android.intent.category.DEFAULT' } },
              { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
            ],
            data: [{ $: { 'android:scheme': 'unraid' } }],
          });
        }
      }
    }

    // 4. Ensure background actions library is patched
    try {
      const path = require('path');
      const fs = require('fs');
      const patchScript = path.resolve(__dirname, '../scripts/patch-background-actions.js');
      if (fs.existsSync(patchScript)) {
        require(patchScript);
      }
    } catch (_) {}

    return config;
  });
};

