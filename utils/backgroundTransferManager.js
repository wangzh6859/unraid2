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
    this.currentType = '上传';
    this.isEnabled = true;
    this.isServiceRunning = false;
    this.listeners = new Set();
    this.islandState = {
      active: false,
      status: 'idle', // 'running' | 'success' | 'paused' | 'error' | 'idle'
      name: '',
      progress: 0,
      speedStr: '',
      sizeText: '',
      type: '上传',
    };
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

  // --- Dynamic Island Observer Pattern ---
  subscribe(callback) {
    this.listeners.add(callback);
    // Immediately emit current state
    try {
      callback(this.islandState);
    } catch (_) {}
    return () => {
      this.listeners.delete(callback);
    };
  }

  notifyIsland(changes) {
    this.islandState = {
      ...this.islandState,
      ...changes,
    };
    for (const listener of this.listeners) {
      try {
        listener(this.islandState);
      } catch (err) {
        console.log('[BTM] Island listener error:', err);
      }
    }
  }

  getIslandState() {
    return this.islandState;
  }

  // Request Android 13+ POST_NOTIFICATIONS runtime permission
  async requestNotificationPermission() {
    if (Platform.OS !== 'android') return true;
    try {
      if (Platform.Version >= 33) {
        const checkResult = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        if (checkResult) return true;

        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Unraid 传输与灵动岛权限',
            message: '允许展示后台传输动态进度条与灵动胶囊，保证切后台或锁屏传输大文件不被中断。',
            buttonPositive: '立即开启',
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
   * Starts both the Android Foreground Service notification and the Dynamic Island capsule.
   */
  async notifyTransferStarted(taskItem) {
    this.activeTaskCount = Math.max(0, this.activeTaskCount) + 1;
    this.currentTaskName = taskItem?.name || '文件';
    this.currentType = taskItem?.type || '上传';

    const initialPct = taskItem?.progress || 0;
    const initialSpeed = taskItem?.speedDisplay || '准备传输...';
    const initialSize = taskItem?.sizeText || '';

    // Update in-app Dynamic Island immediately
    this.notifyIsland({
      active: true,
      status: 'running',
      name: this.currentTaskName,
      progress: initialPct,
      speedStr: initialSpeed,
      sizeText: initialSize,
      type: this.currentType,
    });

    if (Platform.OS !== 'android' || !this.isEnabled) return;

    if (this.isServiceRunning && BackgroundService.isRunning()) {
      // Already running, update notification content immediately
      await this.updateForegroundProgress({
        name: this.currentTaskName,
        progress: initialPct,
        speedStr: initialSpeed,
        sizeText: initialSize,
        force: true,
      });
      return;
    }

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
        parameters: {
          delay: 1000,
        },
        progressBar: {
          max: 100,
          value: Math.min(100, Math.max(0, Math.round(initialPct))),
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
   * Update progress with 400ms throttle for Android notifications,
   * while updating Dynamic Island smoothly.
   */
  async updateForegroundProgress({ name, progress, speedStr, sizeText, force = false, status = 'running' }) {
    const fileName = name || this.currentTaskName || '文件';
    const pct = Math.min(100, Math.max(0, Math.round(progress || 0)));

    // 1. Update in-app Dynamic Island immediately for smooth UI
    this.notifyIsland({
      active: true,
      status,
      name: fileName,
      progress: pct,
      speedStr: speedStr || '',
      sizeText: sizeText || '',
    });

    // 2. Update Android Foreground Service (throttled)
    if (Platform.OS !== 'android' || !this.isEnabled || !this.isServiceRunning) return;

    const now = Date.now();
    if (!force && now - this.lastUpdateTime < 400 && pct < 100) {
      return;
    }
    this.lastUpdateTime = now;

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
  async notifyTransferEnded(taskId, result = 'success', fileInfo = {}) {
    this.activeTaskCount = Math.max(0, this.activeTaskCount - 1);

    if (result === 'success') {
      // Show celebration in Dynamic Island
      this.notifyIsland({
        active: true,
        status: 'success',
        name: fileInfo.name || this.currentTaskName,
        progress: 100,
        speedStr: '传输完成',
        sizeText: fileInfo.sizeText || '',
      });

      // Update Android notification to 100% completed
      if (this.isServiceRunning && BackgroundService.isRunning()) {
        try {
          await BackgroundService.updateNotification({
            taskTitle: `Unraid: ${this.truncateName(fileInfo.name || this.currentTaskName)} 传输完成`,
            taskDesc: '100% · 传输已顺利完成',
            progressBar: {
              max: 100,
              value: 100,
              indeterminate: false,
            },
          });
        } catch (_) {}
      }

      // Auto dismiss celebration after 3.5 seconds if no more active tasks
      setTimeout(async () => {
        if (this.activeTaskCount <= 0) {
          this.notifyIsland({ active: false, status: 'idle' });
          await this.stopService();
        }
      }, 3500);
    } else if (result === 'error') {
      this.notifyIsland({
        active: true,
        status: 'error',
        name: fileInfo.name || this.currentTaskName,
        speedStr: '传输异常',
      });
      setTimeout(async () => {
        if (this.activeTaskCount <= 0) {
          this.notifyIsland({ active: false, status: 'idle' });
          await this.stopService();
        }
      }, 4000);
    } else if (result === 'paused') {
      this.notifyIsland({
        active: true,
        status: 'paused',
        name: fileInfo.name || this.currentTaskName,
        speedStr: '已暂停',
      });
      if (this.activeTaskCount <= 0) {
        setTimeout(async () => {
          if (this.activeTaskCount <= 0) {
            this.notifyIsland({ active: false, status: 'idle' });
            await this.stopService();
          }
        }, 3000);
      }
    } else {
      if (this.activeTaskCount <= 0) {
        this.notifyIsland({ active: false, status: 'idle' });
        await this.stopService();
      }
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
