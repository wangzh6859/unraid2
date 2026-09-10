import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundService from 'react-native-background-actions';

// Storage key
export const BG_TRANSFER_STORAGE_KEY = '@transfer_foreground_service_enabled';

class BackgroundTransferManager {
  constructor() {
    this.activeTaskIds = new Set();
    this.lastUpdateTime = 0;
    this.currentTaskName = '';
    this.currentType = '上传';
    this.isEnabled = true;
    this.isServiceRunning = false;
    this.isStartingService = false;
    this.notificationQueue = Promise.resolve();
    this.initPreferences();
  }

  async initPreferences() {
    try {
      const val = await AsyncStorage.getItem(BG_TRANSFER_STORAGE_KEY);
      this.isEnabled = val !== 'false';
    } catch (_) {
      this.isEnabled = true;
    }
  }

  async setEnabled(enabled) {
    this.isEnabled = !!enabled;
    try {
      await AsyncStorage.setItem(BG_TRANSFER_STORAGE_KEY, enabled ? 'true' : 'false');
      if (!enabled && this.isServiceRunning) {
        await this.stopService();
      }
    } catch (_) {}
  }

  async getEnabled() {
    try {
      await this.initPreferences();
    } catch (_) {}
    return this.isEnabled;
  }

  // Request Android 13+ POST_NOTIFICATIONS runtime permission
  async requestNotificationPermission() {
    if (Platform.OS !== 'android') return true;
    try {
      if (Platform.Version >= 33) {
        const checkResult = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        if (checkResult) return true;

        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        // Allow Android activity lifecycle to return to RESUMED state after system dialog dismisses
        await new Promise((r) => setTimeout(r, 400));
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
      return true;
    } catch (err) {
      console.log('[BTM] requestNotificationPermission err:', err);
      return false;
    }
  }

  // Serialized notification update queue to prevent overlapping or out-of-order notifications
  queueNotificationUpdate(options) {
    if (Platform.OS !== 'android' || !this.isEnabled) return Promise.resolve();
    this.notificationQueue = this.notificationQueue
      .then(async () => {
        if (this.isServiceRunning && BackgroundService.isRunning()) {
          try {
            await BackgroundService.updateNotification(options);
          } catch (err) {
            console.log('[BTM] BackgroundService.updateNotification err:', err);
          }
        }
      })
      .catch((err) => {
        console.log('[BTM] queueNotificationUpdate queue err:', err);
      });
    return this.notificationQueue;
  }

  // Daemon task kept alive by BackgroundService
  backgroundDaemonTask = async (taskData) => {
    await new Promise(async (resolve) => {
      try {
        while (this.isServiceRunning) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (_) {}
      resolve();
    });
  };

  /**
   * Notify that a transfer task has started.
   * Starts the Android Foreground Service notification for background transfer keep-alive.
   */
  async notifyTransferStarted(taskItem) {
    try {
      const taskId = taskItem?.id || ('task_' + Date.now());
      this.activeTaskIds.add(taskId);
      this.currentTaskName = taskItem?.name || '文件';
      this.currentType = taskItem?.type || '上传';

      const initialPct = taskItem?.progress || 0;
      const initialSpeed = taskItem?.speedDisplay || '准备传输...';
      const initialSize = taskItem?.sizeText || '';

      if (Platform.OS !== 'android' || !this.isEnabled) return;

      if (this.isServiceRunning && BackgroundService.isRunning()) {
        this.updateForegroundProgress({
          name: this.currentTaskName,
          progress: initialPct,
          speedStr: initialSpeed,
          sizeText: initialSize,
          force: true,
        });
        return;
      }

      if (this.isStartingService) return;
      this.isStartingService = true;

      try {
        await this.requestNotificationPermission();

        const options = {
          taskName: 'UnraidTransferDaemon',
          taskTitle: `Unraid 传输中: ${this.truncateName(this.currentTaskName)}`,
          taskDesc: `${initialPct}% · ${initialSpeed} · ${initialSize}`,
          taskIcon: {
            name: 'ic_launcher',
            type: 'mipmap',
          },
          color: '#3b82f6',
          linkingURI: 'unraid://transfer',
          foregroundServiceType: ['dataSync'],
          parameters: {
            delay: 1000,
          },
          progressBar: {
            max: 100,
            value: Math.min(100, Math.max(0, Math.round(initialPct))),
            indeterminate: false,
          },
        };

        this.isServiceRunning = true;
        if (!BackgroundService.isRunning()) {
          try {
            await BackgroundService.start(this.backgroundDaemonTask, options);
          } catch (bsErr) {
            console.log('[BTM] BackgroundService.start caught error:', bsErr);
          }
        }
        this.lastUpdateTime = Date.now();
      } catch (err) {
        console.log('[BTM] Failed to start BackgroundService:', err);
        this.isServiceRunning = false;
      } finally {
        this.isStartingService = false;
      }
    } catch (err) {
      console.log('[BTM] notifyTransferStarted err:', err);
    }
  }

  /**
   * Update progress with throttle for Android notification bar.
   */
  async updateForegroundProgress({ name, progress, speedStr, sizeText, force = false } = {}) {
    try {
      const fileName = name || this.currentTaskName || '文件';
      const pct = Math.min(100, Math.max(0, Math.round(progress || 0)));

      if (Platform.OS !== 'android' || !this.isEnabled || !this.isServiceRunning) return;

      const now = Date.now();
      if (!force && now - this.lastUpdateTime < 350 && pct < 100) {
        return;
      }
      this.lastUpdateTime = now;

      const descParts = [];
      if (pct !== undefined) descParts.push(`${pct}%`);
      if (speedStr && speedStr !== '计算中...') descParts.push(speedStr);
      if (sizeText) descParts.push(sizeText);

      this.queueNotificationUpdate({
        taskTitle: `Unraid 传输中: ${this.truncateName(fileName)}`,
        taskDesc: descParts.join(' · ') || '正在持续传输...',
        progressBar: {
          max: 100,
          value: pct,
          indeterminate: false,
        },
      });
    } catch (err) {
      console.log('[BTM] updateForegroundProgress err:', err);
    }
  }

  /**
   * Notify that a transfer task has finished, paused, or errored.
   */
  async notifyTransferEnded(taskId, result = 'success', fileInfo = {}) {
    try {
      if (taskId) {
        this.activeTaskIds.delete(taskId);
      } else {
        this.activeTaskIds.clear();
      }

      const safeFileInfo = fileInfo || {};

      if (result === 'success') {
        // 1. Queue Android notification to 100% completed
        this.queueNotificationUpdate({
          taskTitle: `Unraid: ${this.truncateName(safeFileInfo.name || this.currentTaskName)} 传输完成`,
          taskDesc: '100% · 传输已顺利完成',
          progressBar: {
            max: 100,
            value: 100,
            indeterminate: false,
          },
        });

        // 2. Auto-dismiss notification after 3.5s
        setTimeout(async () => {
          try {
            if (this.activeTaskIds.size === 0) {
              await this.stopService();
            }
          } catch (_) {}
        }, 3500);
      } else if (result === 'error') {
        this.queueNotificationUpdate({
          taskTitle: `Unraid: ${this.truncateName(safeFileInfo.name || this.currentTaskName)} 传输异常`,
          taskDesc: '传输中断或失败',
          progressBar: {
            max: 100,
            value: 0,
            indeterminate: false,
          },
        });
        setTimeout(async () => {
          try {
            if (this.activeTaskIds.size === 0) {
              await this.stopService();
            }
          } catch (_) {}
        }, 3500);
      } else if (result === 'paused') {
        this.queueNotificationUpdate({
          taskTitle: `Unraid: ${this.truncateName(safeFileInfo.name || this.currentTaskName)} 已暂停`,
          taskDesc: '传输任务已暂停',
          progressBar: {
            max: 100,
            value: 0,
            indeterminate: false,
          },
        });
        if (this.activeTaskIds.size === 0) {
          setTimeout(async () => {
            try {
              if (this.activeTaskIds.size === 0) {
                await this.stopService();
              }
            } catch (_) {}
          }, 3000);
        }
      } else {
        if (this.activeTaskIds.size === 0) {
          await this.stopService();
        }
      }
    } catch (err) {
      console.log('[BTM] notifyTransferEnded err:', err);
    }
  }

  /**
   * Force stop foreground service and clear notification.
   */
  async stopService() {
    try {
      this.activeTaskIds.clear();
      this.currentTaskName = '';
      this.isServiceRunning = false;
      if (BackgroundService.isRunning()) {
        try {
          await BackgroundService.stop();
        } catch (err) {
          console.log('[BTM] stopService err:', err);
        }
      }
    } catch (err) {
      console.log('[BTM] stopService outer err:', err);
    } finally {
      this.isServiceRunning = false;
    }
  }

  truncateName(str, maxLen = 22) {
    if (!str) return '';
    if (str.length <= maxLen) return str;
    const half = Math.floor((maxLen - 3) / 2);
    return `${str.slice(0, half)}...${str.slice(-half)}`;
  }
}

const backgroundTransferManager = new BackgroundTransferManager();
export default backgroundTransferManager;
