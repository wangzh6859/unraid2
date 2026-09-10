const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin to configure Wake-on-LAN native module and permissions
 */
module.exports = function withWakeOnLan(config) {
  // 1. AndroidManifest permissions
  config = withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;

    if (!androidManifest['uses-permission']) {
      androidManifest['uses-permission'] = [];
    }

    const requiredPermissions = [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.CHANGE_WIFI_MULTICAST_STATE',
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

    return config;
  });

  // 2. Dangerous mod to write Java files and hook into MainApplication
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const androidDir = config.modRequest.platformProjectRoot;

      // Run setup script if available
      try {
        const setupScript = path.resolve(__dirname, '../scripts/setup-wake-on-lan.js');
        if (fs.existsSync(setupScript)) {
          require(setupScript);
        }
      } catch (err) {
        console.warn('[withWakeOnLan] Error executing setup-wake-on-lan.js:', err);
      }

      return config;
    },
  ]);

  return config;
};
