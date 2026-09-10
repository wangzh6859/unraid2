import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundService from 'react-native-background-actions';

// Storage key for user preference
export const BG_TRANSFER_STORAGE_KEY = '@transfer_foreground_service_enabled';

class BackgroundTransferManager {
  constructor() {
    this.activeTaskCount = 0;
    this.lastUpdateTime = 0;
    this.currentTaskName = '';
    this.isEnabled = true;
    this.isServiceRunning = false;
    this.initPreference();
  }

  async initPreference() {
    try {
      const val = await AsyncStorage.getItem(BG_TRANSFER_STORAGE_KEY);
      this.isEnabled = val !== 'false'; // Default enabled
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
    await this.initPreference();
    return this.isEnabled;
  }

  // Request Android 13+ POST_NOTIFICATIONS runtime permission
  async requestNotificationPermission() {
    if (Platform.OS !== 'android') return true;
    try {
      if (Platform.Version >= 33) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Unraid 传输通知权限',
            message: '允许展示后台传输进度条与实时速率通知，确保锁屏时大文件不被系统中断。',
            buttonPositive: '允许',
            buttonNegative: '稍后',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
      return true;
    } catch (err) {
      console.log('[BTM] requestNotificationPermission err:', err);
      return false;
    }
  }

  // Daemon task kept alive by BackgroundService
  backgroundDaemonTask = async (taskData) => {
    await new Promise(async (resolve) => {
      while (BackgroundService.isRunning()) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      resolve();
    });
  };

  /**
   * Notify that a transfer task has started.
   * If not already running, starts the Android Foreground Service.
   */
  async notifyTransferStarted(taskItem) {
    if (Platform.OS !== 'android' || !this.isEnabled) return;

    this.activeTaskCount = Math.max(0, this.activeTaskCount) + 1;
    this.currentTaskName = taskItem?.name || '文件';

    if (this.isServiceRunning && BackgroundService.isRunning()) {
      // Already running, update header
      await this.updateForegroundProgress({
        name: this.currentTaskName,
        progress: taskItem?.progress || 0,
        speedStr: '传输中...',
        sizeText: taskItem?.sizeText || '',
        force: true,
      });
      return;
    }

    try {
      await this.requestNotificationPermission();

      const options = {
        taskName: 'UnraidTransferDaemon',
        taskTitle: `Unraid 传输中: ${this.truncateName(this.currentTaskName)}`,
        taskDesc: '正在后台传输文件，保持锁屏传输不中断...',
        taskIcon: {
          name: 'ic_launcher',
          type: 'mipmap',
        },
        color: '#3b82f6',
        linkingURI: 'unraidmanager://transfers',
        parameters: {
          delay: 1000,
        },
        progressBar: {
          max: 100,
          value: Math.min(100, Math.max(0, Math.round(taskItem?.progress || 0))),
          indeterminate: false,
        },
      };

      await BackgroundService.start(this.backgroundDaemonTask, options);
      this.isServiceRunning = true;
      this.lastUpdateTime = Date.now();
    } catch (err) {
      console.log('[BTM] Failed to start BackgroundService:', err);
    }
  }

  /**
   * Update notification progress with 600ms throttle.
   */
  async updateForegroundProgress({ name, progress, speedStr, sizeText, force = false }) {
    if (Platform.OS !== 'android' || !this.isEnabled || !this.isServiceRunning) return;

    const now = Date.now();
    // Throttle updates to at most once per 600ms unless forced
    if (!force && now - this.lastUpdateTime < 600) {
      return;
    }
    this.lastUpdateTime = now;

    const fileName = name || this.currentTaskName || '文件';
    const pct = Math.min(100, Math.max(0, Math.round(progress || 0)));
    const descParts = [];
    if (pct !== undefined) descParts.push(`${pct}%`);
    if (speedStr && speedStr !== '计算中...') descParts.push(speedStr);
    if (sizeText) descParts.push(sizeText);

    try {
      if (BackgroundService.isRunning()) {
        await BackgroundService.updateNotification({
          taskTitle: `Unraid 传输中: ${this.truncateName(fileName)}`,
          taskDesc: descParts.join(' · ') || '正在持续传输...',
          progressBar: {
            max: 100,
            value: pct,
            indeterminate: false,
          },
        });
      }
    } catch (err) {
      console.log('[BTM] updateNotification err:', err);
    }
  }

  /**
   * Notify that a transfer task has finished, paused, or errored.
   */
  async notifyTransferEnded(taskId) {
    if (Platform.OS !== 'android') return;

    this.activeTaskCount = Math.max(0, this.activeTaskCount - 1);

    if (this.activeTaskCount <= 0) {
      await this.stopService();
    }
  }

  /**
   * Force stop foreground service and clear notification.
   */
  async stopService() {
    this.activeTaskCount = 0;
    this.currentTaskName = '';
    if (this.isServiceRunning || BackgroundService.isRunning()) {
      try {
        await BackgroundService.stop();
      } catch (err) {
        console.log('[BTM] stopService err:', err);
      } finally {
        this.isServiceRunning = false;
      }
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
