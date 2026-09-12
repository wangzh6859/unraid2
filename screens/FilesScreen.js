import React, { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, ScrollView, Modal, BackHandler,
  Pressable, RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import {
  Folder, Server, Key, File, ChevronLeft, HardDrive, Plus, ArrowDownUp,
  FolderPlus, UploadCloud, DownloadCloud, X, Download, Pencil, Copy, MoveRight,
  Trash2, CheckCircle, Circle, ArrowUp, FolderOpen, Info, Pause, Play,
  RefreshCw, Settings, Check, Search, Filter, Archive,
} from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../ThemeContext';
import { getDownloadDir, formatBytes } from '../utils/cacheManager';
import FilePreviewer from '../components/FilePreviewer';
import ModernConfirmDialog from '../components/ModernConfirmDialog';
import backgroundTransferManager from '../utils/backgroundTransferManager';

// Formats bytes with fixed 1 decimal place to prevent layout shift
const formatBytesFixed = (bytes) => {
  if (!bytes || bytes <= 0) return '0.0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i === 0) return `${bytes} B`;
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const isArchiveFile = (name) => {
  return /\.(zip|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|7z|rar)$/i.test(name || '');
};

export default function FilesScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Modern confirmation & result dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    visible: false,
    type: 'info',
    title: '',
    message: '',
    confirmText: '',
    cancelText: '取消',
    showCancel: true,
    onConfirm: null,
  });

  const showConfirm = ({
    type = 'info',
    title,
    message,
    confirmText,
    cancelText = '取消',
    showCancel = true,
    onConfirm,
  }) => {
    setConfirmDialog({
      visible: true,
      type,
      title,
      message,
      confirmText,
      cancelText,
      showCancel,
      onConfirm: () => {
        setConfirmDialog(prev => ({ ...prev, visible: false }));
        if (onConfirm) onConfirm();
      },
    });
  };

  // Server credentials synced from Settings / AsyncStorage
  const [serverUrl, setServerUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // File browser state
  const DEFAULT_ROOT = '/mnt/user';
  const [currentPath, setCurrentPath] = useState(DEFAULT_ROOT);
  const [fileList, setFileList] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name'); // 'name' | 'date' | 'size'

  // Selection & UI Modals
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [previewItem, setPreviewItem] = useState(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);

  // Create folder modal
  const [mkdirVisible, setMkdirVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Rename modal
  const [renameItem, setRenameItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // Item details modal
  const [detailItem, setDetailItem] = useState(null);

  // Server-side Extract & Compress
  const [extractItem, setExtractItem] = useState(null);
  const [extractCreateSubfolder, setExtractCreateSubfolder] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);

  const [compressVisible, setCompressVisible] = useState(false);
  const [compressZipName, setCompressZipName] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);

  // Picker modal (Copy / Move destination)
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState(null); // 'move' | 'copy'
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerPath, setPickerPath] = useState(DEFAULT_ROOT);
  const [pickerFolders, setPickerFolders] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Transfer Manager (Uploads & Downloads)
  const [isTransferVisible, setIsTransferVisible] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const [csrfToken, setCsrfToken] = useState('');
  const csrfTokenRef = useRef('');
  const activeTasksRef = useRef({}); // taskId -> FileSystem.UploadTask

  // Transfer Queue Persistence Key & Reference
  const QUEUE_STORAGE_KEY = '@transfers_queue_v1';
  const transfersRef = useRef([]);
  useEffect(() => {
    transfersRef.current = transfers;
  }, [transfers]);

  const saveTransfersQueue = async (list) => {
    try {
      const sanitized = (list || []).map(t => ({
        id: t.id,
        name: t.name,
        uri: t.uri,
        size: t.size,
        targetPath: t.targetPath,
        type: t.type,
        status: t.status === 'running' ? 'paused' : t.status,
        progress: t.progress || 0,
        transferredBytes: t.transferredBytes || 0,
        totalBytes: t.totalBytes || 0,
        sizeText: t.sizeText || '',
        speedDisplay: t.status === 'running' ? '已暂停' : (t.speedDisplay || ''),
        chunkIndex: t.chunkIndex || 0,
      }));
      await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(sanitized));
    } catch (err) {
      console.log('[FilesScreen] Failed to save transfers queue:', err);
    }
  };

  // Restore persistent transfer queue on cold boot
  useEffect(() => {
    const loadPersistedTransfers = async () => {
      try {
        const savedQueueJson = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
        if (savedQueueJson) {
          const parsed = JSON.parse(savedQueueJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const restored = parsed.map(t => ({
              ...t,
              status: t.status === 'running' ? 'paused' : t.status,
              speedDisplay: t.status === 'running' ? '已暂停 (可继续)' : (t.speedDisplay || ''),
            }));
            setTransfers(restored);
          }
        }
      } catch (err) {
        console.log('[FilesScreen] Failed to load persisted transfers:', err);
      }
    };
    loadPersistedTransfers();
  }, []);

  const ensureCsrfToken = async (baseUrl, token) => {
    if (csrfTokenRef.current) return csrfTokenRef.current;
    const cleanUrl = (baseUrl || '').replace(/\/+$/, '');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${cleanUrl}/api.php?token=${encodeURIComponent(token)}&action=csrf_token`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data && data.csrf_token) {
        setCsrfToken(data.csrf_token);
        csrfTokenRef.current = data.csrf_token;
        return data.csrf_token;
      }
    } catch (_) {}
    return '';
  };

  /**
   * 💡 Real-Time Sync on Screen Focus:
   * Whenever user navigates to Files tab, check if server URL or token changed in Settings.
   */
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      // Proactively check/request notification permission for transfers
      backgroundTransferManager.requestNotificationPermission();

      const checkAndSyncConfig = async () => {
        try {
          const savedUrl = await AsyncStorage.getItem('@server_url');
          const savedToken = await AsyncStorage.getItem('@api_token');

          if (!savedUrl || !savedToken) {
            if (isMounted) {
              setServerUrl('');
              setApiToken('');
              setIsConfigured(false);
              setCheckingAuth(false);
            }
            return;
          }

          // If changed or first load
          if (savedUrl !== serverUrl || savedToken !== apiToken || !isConfigured) {
            if (isMounted) {
              setServerUrl(savedUrl);
              setApiToken(savedToken);
              setIsConfigured(true);
              setCheckingAuth(false);
              // Fetch file list with updated credentials
              loadDirectory(savedUrl, savedToken, currentPath || DEFAULT_ROOT);
            }
          }
        } catch (e) {
          console.log('[FilesScreen] Error syncing config:', e);
          if (isMounted) setCheckingAuth(false);
        }
      };

      checkAndSyncConfig();
      return () => { isMounted = false; };
    }, [serverUrl, apiToken, isConfigured, currentPath])
  );

  /**
   * Fetch directory items via Unraid api.php
   */
  const loadDirectory = async (baseUrl, token, path) => {
    if (!baseUrl || !token) return;
    setIsLoadingList(true);
    try {
      const cleanUrl = baseUrl.replace(/\/+$/, '');
      const url = `${cleanUrl}/api.php?token=${encodeURIComponent(token)}&action=file_list&path=${encodeURIComponent(path)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.status === 'success') {
        if (data.csrf_token) {
          setCsrfToken(data.csrf_token);
          csrfTokenRef.current = data.csrf_token;
        }
        const items = (data.items || []).map(it => ({
          ...it,
          href: it.path, // compatibility with previewUtils
        }));
        setFileList(items);
        setCurrentPath(data.current_path || path);
      } else {
        // Fallback to /mnt if /mnt/user was not present
        if (path === DEFAULT_ROOT && path !== '/mnt') {
          loadDirectory(baseUrl, token, '/mnt');
          return;
        }
        Alert.alert('读取目录失败', data.message || '服务器拒绝访问');
      }
    } catch (e) {
      console.log('[FilesScreen] loadDirectory error:', e);
      Alert.alert('网络异常', '无法连接到 Unraid 服务器文件模块');
    } finally {
      setIsLoadingList(false);
      setIsRefreshing(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadDirectory(serverUrl, apiToken, currentPath);
  }, [serverUrl, apiToken, currentPath]);

  // Path navigation helpers
  const isAtRoot = currentPath === '/mnt' || currentPath === DEFAULT_ROOT;

  const goBack = useCallback(() => {
    if (isAtRoot) return;
    const p = currentPath.endsWith('/') ? currentPath.slice(0, -1) : currentPath;
    const parent = p.substring(0, p.lastIndexOf('/')) || '/mnt';
    loadDirectory(serverUrl, apiToken, parent);
  }, [currentPath, isAtRoot, serverUrl, apiToken]);

  // Click & Selection handlers
  const enterMultiSelect = (item) => {
    setMultiSelect(true);
    setSelected(new Set([item.path]));
  };

  const exitMultiSelect = () => {
    setMultiSelect(false);
    setSelected(new Set());
  };

  const toggleSelect = (item) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(item.path)) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
  };

  const isSelected = (path) => selected.has(path);

  const toggleSelectAll = () => {
    if (selected.size === filteredFiles.length) setSelected(new Set());
    else setSelected(new Set(filteredFiles.map(f => f.path)));
  };

  const handleFileClick = (item) => {
    if (multiSelect) {
      toggleSelect(item);
      return;
    }
    if (item.isFolder) {
      loadDirectory(serverUrl, apiToken, item.path);
      return;
    }
    if (isArchiveFile(item.name)) {
      setDetailItem(item);
      return;
    }
    setPreviewItem(item);
  };

  const handleLongPress = (item) => {
    if (!multiSelect) enterMultiSelect(item);
    else toggleSelect(item);
  };

  // Direct URL helper for previewers
  const getDirectUrl = (filePath) => {
    return `${serverUrl}/api.php?token=${apiToken}&action=file_stream&path=${encodeURIComponent(filePath)}`;
  };

  // =========================================================================
  // Advanced Upload Task Manager (Create, Pause/Cancel, Resume, Delete record)
  // =========================================================================
  const handleUpload = async () => {
    setIsMenuVisible(false);
    if (!currentPath || currentPath === '/mnt' || currentPath === '/mnt/user') {
      showConfirm({
        type: 'warning',
        title: '无法直接上传到共享根目录',
        message: 'Unraid 根目录不允许直接存放散装文件。请先进入具体的共享文件夹（例如 downloads、appdata 等）后再点击上传。',
        confirmText: '我知道了',
        showCancel: false,
      });
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const fileUri = file.uri;

        const taskId = 'up_' + Date.now();
        const newTask = {
          id: taskId,
          name: file.name,
          uri: fileUri,
          size: file.size || 0,
          targetPath: currentPath,
          type: '上传',
          status: 'running', // 'running' | 'paused' | 'success' | 'error'
          progress: 0,
          transferredBytes: 0,
          totalBytes: file.size || 0,
          sizeText: `${formatBytesFixed(0)} / ${formatBytesFixed(file.size || 0)}`,
          speedDisplay: '准备中...',
          chunkIndex: 0,
        };

        setTransfers(prev => {
          const next = [newTask, ...prev];
          saveTransfersQueue(next);
          return next;
        });
        setIsTransferVisible(true);
        startUploadTask(newTask);
      }
    } catch (e) {
      showConfirm({
        type: 'warning',
        title: '选择文件异常',
        message: e.message,
        confirmText: '知道了',
        showCancel: false,
      });
    }
  };

  const startUploadTask = async (taskItem) => {
    const taskId = taskItem.id;
    const abortController = new AbortController();
    activeTasksRef.current[taskId] = { abortController, cancelled: false };

    // Register with Android Foreground Service for lockscreen background transfer
    try {
      await backgroundTransferManager.notifyTransferStarted(taskItem);
    } catch (_) {}

    try {
      const fileUri = taskItem.uri;

      // Check if file exists and get real size
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) {
        throw new Error('本地文件无法读取或已丢失');
      }

      const totalSize = (fileInfo.size !== undefined && fileInfo.size !== null) ? fileInfo.size : (taskItem.size || 0);

      const cleanBaseUrl = (serverUrl || '').replace(/\/+$/, '');
      const activeCsrf = await ensureCsrfToken(cleanBaseUrl, apiToken);
      const csrfQuery = activeCsrf ? `&csrf_token=${encodeURIComponent(activeCsrf)}` : '';

      // Immediately set initial running state
      setTransfers(prev => prev.map(t => (t.id === taskId ? {
        ...t,
        status: 'running',
        progress: 0,
        transferredBytes: 0,
        totalBytes: totalSize,
        sizeText: `0 B / ${formatBytesFixed(totalSize)}`,
        speedDisplay: '正在连接...',
      } : t)));

      // -----------------------------------------------------------------------
      // Native High-Speed Binary Streaming via FileSystem.createUploadTask
      // Directly streams raw bytes from native storage to api.php (php://input).
      // Provides real-time native callbacks with zero JS memory overhead.
      // -----------------------------------------------------------------------
      const uploadUrl = `${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}${csrfQuery}&action=file_upload&path=${encodeURIComponent(taskItem.targetPath)}&filename=${encodeURIComponent(taskItem.name)}`;

      let lastReportTime = Date.now();
      let lastReportBytes = 0;
      let lastPositiveSpeedTime = Date.now();
      let smoothedSpeed = 0;
      let currentSpeedDisplay = '正在上传...';

      const uploadTask = FileSystem.createUploadTask(
        uploadUrl,
        fileUri,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-API-Token': apiToken,
            ...(activeCsrf ? { 'X-CSRF-Token': activeCsrf } : {}),
          },
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        },
        (progressData) => {
          const totalSent = progressData.totalBytesSent || 0;
          const totalExp = progressData.totalBytesExpectedToSend || totalSize;
          const now = Date.now();
          const elapsed = (now - lastReportTime) / 1000;

          // 1. Transmission over network finished (all bytes delivered to server)
          if (totalSent >= totalExp && totalExp > 0) {
            const szStr = `${formatBytesFixed(totalSent)} / ${formatBytesFixed(totalExp)} · 传输完毕`;
            const syncMsg = '服务器落盘同步中...';
            currentSpeedDisplay = syncMsg;
            setTransfers(prev => prev.map(t => (t.id === taskId ? {
              ...t,
              status: 'running',
              progress: 99,
              transferredBytes: totalSent,
              totalBytes: totalExp,
              sizeText: szStr,
              speedDisplay: syncMsg,
            } : t)));

            backgroundTransferManager.updateForegroundProgress({
              name: taskItem.name,
              progress: 99,
              speedStr: syncMsg,
              sizeText: szStr,
            });
            return;
          }

          // 2. Sample speed with Exponential Moving Average (EMA) smoothing
          if (elapsed >= 0.4) {
            const bytesDelta = totalSent - lastReportBytes;
            const instantSpeed = bytesDelta > 0 ? (bytesDelta / elapsed) : 0;
            lastReportTime = now;
            lastReportBytes = totalSent;

            if (instantSpeed > 0) {
              // EMA smoothing: 35% new measurement, 65% rolling historical average
              smoothedSpeed = smoothedSpeed > 0 ? (0.35 * instantSpeed + 0.65 * smoothedSpeed) : instantSpeed;
              lastPositiveSpeedTime = now;
            } else {
              // Graceful decay during TCP ACK delays or storage commit pauses
              const stallSec = (now - lastPositiveSpeedTime) / 1000;
              if (stallSec > 2.0) {
                smoothedSpeed = 0;
              } else {
                smoothedSpeed = smoothedSpeed * 0.8;
              }
            }

            const spdStr = smoothedSpeed > 300
              ? `${formatBytesFixed(smoothedSpeed)}/s`
              : (instantSpeed > 0 ? `${formatBytesFixed(instantSpeed)}/s` : (smoothedSpeed > 0 ? `${formatBytesFixed(smoothedSpeed)}/s` : '传输中...'));
            currentSpeedDisplay = spdStr;
            const progressPct = totalExp > 0 ? Math.min(99, Math.round((totalSent / totalExp) * 100)) : 0;
            const szStr = `${formatBytesFixed(totalSent)} / ${formatBytesFixed(totalExp)}`;

            setTransfers(prev => prev.map(t => (t.id === taskId ? {
              ...t,
              status: 'running',
              progress: progressPct,
              transferredBytes: totalSent,
              totalBytes: totalExp,
              sizeText: szStr,
              speedDisplay: spdStr,
            } : t)));

            backgroundTransferManager.updateForegroundProgress({
              name: taskItem.name,
              progress: progressPct,
              speedStr: spdStr,
              sizeText: szStr,
            });
          }
        }
      );

      activeTasksRef.current[taskId].uploadTask = uploadTask;
      const res = await uploadTask.uploadAsync();

      if (res && res.status >= 200 && res.status < 300) {
        let parsed = null;
        try { parsed = JSON.parse(res.body); } catch (_) {}
        if (parsed && parsed.status === 'error') {
          throw new Error(parsed.message || '服务端写入文件失败');
        }
      } else {
        let errorMsg = `HTTP ${res ? res.status : '未知错误'}`;
        try {
          const parsed = JSON.parse(res.body);
          if (parsed && parsed.message) errorMsg = parsed.message;
        } catch (_) {}
        throw new Error(errorMsg);
      }

      delete activeTasksRef.current[taskId];

      if (taskItem.uri && taskItem.uri.startsWith(FileSystem.cacheDirectory + 'up_')) {
        FileSystem.deleteAsync(taskItem.uri, { idempotent: true }).catch(() => {});
      }

      const savedPath = `${taskItem.targetPath}/${taskItem.name}`;
      setTransfers(prev => {
        const next = prev.map(t => (t.id === taskId ? {
          ...t,
          status: 'success',
          progress: 100,
          transferredBytes: totalSize,
          totalBytes: totalSize,
          sizeText: `${formatBytesFixed(totalSize)} / ${formatBytesFixed(totalSize)}`,
          speedDisplay: '已完成',
        } : t));
        saveTransfersQueue(next);
        return next;
      });

      loadDirectory(cleanBaseUrl, apiToken, currentPath);
      await backgroundTransferManager.notifyTransferEnded(taskId, 'success', {
        name: taskItem.name,
        sizeText: formatBytesFixed(totalSize),
      });
      showConfirm({
        type: 'success',
        title: '上传成功',
        message: `文件已成功写入 Unraid 存储：\n${savedPath}`,
        confirmText: '好的',
        showCancel: false,
      });
    } catch (err) {
      delete activeTasksRef.current[taskId];
      const isCancelled = abortController.signal.aborted || err.name === 'AbortError' || (err.message && err.message.includes('abort'));
      await backgroundTransferManager.notifyTransferEnded(taskId, isCancelled ? 'paused' : 'error', {
        name: taskItem.name,
      });
      if (isCancelled) {
        setTransfers(prev => {
          const next = prev.map(t => (t.id === taskId ? {
            ...t,
            status: 'paused',
            speedDisplay: '已暂停',
          } : t));
          saveTransfersQueue(next);
          return next;
        });
      } else {
        setTransfers(prev => {
          const next = prev.map(t => (t.id === taskId ? {
            ...t,
            status: 'error',
            speedDisplay: '上传失败(点击重试)',
          } : t));
          saveTransfersQueue(next);
          return next;
        });
        showConfirm({
          type: 'warning',
          title: '上传中断',
          message: `上传未能完成，可点击列表右侧重试按钮重新传输：\n${err.message || '网络连接超时或中断'}`,
          confirmText: '知道了',
          showCancel: false,
        });
      }
    }
  };

  // Pause / Cancel active upload
  const pauseUploadTask = (taskId) => {
    try {
      const task = activeTasksRef.current[taskId];
      if (task) {
        task.cancelled = true;
        if (task.uploadTask && typeof task.uploadTask.cancelAsync === 'function') {
          task.uploadTask.cancelAsync().catch(() => {});
        }
        try {
          task.abortController.abort();
        } catch (_) {}
      }
    } catch (_) {}
    try {
      backgroundTransferManager.notifyTransferEnded(taskId, 'paused');
    } catch (_) {}
    setTransfers(prev => {
      const next = prev.map(t => {
        if (t.id === taskId) {
          return {
            ...t,
            status: 'paused',
            speedDisplay: '已暂停',
          };
        }
        return t;
      });
      saveTransfersQueue(next);
      return next;
    });
  };

  // Resume / Retry upload
  const resumeUploadTask = (taskItem) => {
    let latestItem = taskItem;
    setTransfers(prev => {
      const found = prev.find(t => t.id === taskItem.id);
      if (found) latestItem = found;
      const next = prev.map(t => (t.id === taskItem.id ? {
        ...t,
        status: 'running',
        speedDisplay: (latestItem.chunkIndex && latestItem.chunkIndex > 0) ? '断点续传中...' : '准备续传...',
      } : t));
      saveTransfersQueue(next);
      return next;
    });
    setTimeout(() => startUploadTask(latestItem), 80);
  };

  // Delete a single transfer record
  const deleteTransferRecord = (taskId) => {
    try {
      pauseUploadTask(taskId);
    } catch (_) {}
    setTransfers(prev => {
      try {
        const itemToDelete = prev.find(t => t.id === taskId);
        if (itemToDelete?.uri && FileSystem?.cacheDirectory && itemToDelete.uri.startsWith(FileSystem.cacheDirectory + 'up_')) {
          FileSystem.deleteAsync(itemToDelete.uri, { idempotent: true }).catch(() => {});
        }
      } catch (_) {}
      const next = prev.filter(t => t.id !== taskId);
      saveTransfersQueue(next);
      return next;
    });
  };

  // Clear completed transfer records
  const clearCompletedTransfers = () => {
    setTransfers(prev => {
      const next = prev.filter(t => t.status !== 'success');
      saveTransfersQueue(next);
      return next;
    });
  };

  // =========================================================================
  // Download Manager
  // =========================================================================
  const handleDownload = async (item) => {
    try {
      const dir = await getDownloadDir();
      setPreviewItem(null);
      const taskId = 'dl_' + Date.now();
      const newTask = {
        id: taskId,
        name: item.name,
        type: '下载',
        status: 'running',
        progress: 0,
        transferredBytes: 0,
        totalBytes: item.size || 0,
        sizeText: `${formatBytesFixed(0)} / ${formatBytesFixed(item.size || 0)}`,
        speedDisplay: '正在下载...',
      };
      setTransfers(prev => {
        const next = [newTask, ...prev];
        saveTransfersQueue(next);
        return next;
      });
      setIsTransferVisible(true);
      await backgroundTransferManager.notifyTransferStarted(newTask);

      const downloadUrl = getDirectUrl(item.path);
      const localUri = FileSystem.cacheDirectory + 'dl_' + Date.now() + '_' + encodeURIComponent(item.name);

      const res = await FileSystem.downloadAsync(downloadUrl, localUri);

      if (dir.uri.startsWith('content://')) {
        const base64Data = await FileSystem.readAsStringAsync(res.uri, { encoding: FileSystem.EncodingType.Base64 });
        const newFileUri = await FileSystem.StorageAccessFramework.createFileAsync(dir.uri, item.name, 'application/octet-stream');
        await FileSystem.writeAsStringAsync(newFileUri, base64Data, { encoding: FileSystem.EncodingType.Base64 });
      } else {
        const destUri = dir.uri + encodeURIComponent(item.name);
        await FileSystem.copyAsync({ from: res.uri, to: destUri });
      }

      await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
      await backgroundTransferManager.notifyTransferEnded(taskId, 'success', {
        name: item.name,
        sizeText: formatBytesFixed(item.size || 0),
      });
      setTransfers(prev => {
        const next = prev.map(t => (t.id === taskId ? {
          ...t,
          status: 'success',
          progress: 100,
          transferredBytes: item.size || 0,
          totalBytes: item.size || 0,
          sizeText: `${formatBytesFixed(item.size || 0)} / ${formatBytesFixed(item.size || 0)}`,
          speedDisplay: '下载完成',
        } : t));
        saveTransfersQueue(next);
        return next;
      });
    } catch (e) {
      console.log('[FilesScreen] Download error:', e);
      await backgroundTransferManager.notifyTransferEnded(taskId, 'error', {
        name: item.name,
      });
      showConfirm({
        type: 'warning',
        title: '下载失败',
        message: e.message || '网络或存储权限异常',
        confirmText: '知道了',
        showCancel: false,
      });
      setTransfers(prev => {
        const next = prev.map(t => ((t.id === taskId || (t.name === item.name && t.status === 'running')) ? {
          ...t,
          status: 'error',
          speedDisplay: '下载中断',
        } : t));
        saveTransfersQueue(next);
        return next;
      });
    }
  };

  const handleBatchDownload = async () => {
    const items = fileList.filter(f => selected.has(f.path) && !f.isFolder);
    if (items.length === 0) {
      showConfirm({
        type: 'info',
        title: '提示',
        message: '请选择要下载的文件（文件夹暂不支持批量打包下载）',
        confirmText: '好的',
        showCancel: false,
      });
      return;
    }
    setPreviewItem(null);
    for (const it of items) {
      await handleDownload(it);
    }
    exitMultiSelect();
  };

  // =========================================================================
  // File & Folder Operations (Mkdir, Rename, Delete, Move, Copy)
  // =========================================================================
  const confirmCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const url = `${serverUrl}/api.php?token=${apiToken}&action=file_mkdir&path=${encodeURIComponent(currentPath)}&name=${encodeURIComponent(name)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'success') {
        setMkdirVisible(false);
        setNewFolderName('');
        loadDirectory(serverUrl, apiToken, currentPath);
      } else {
        Alert.alert('创建失败', data.message || '服务器拒绝创建');
      }
    } catch (e) {
      Alert.alert('异常', e.message);
    }
  };

  const confirmRename = async () => {
    const newName = renameValue.trim();
    if (!newName || !renameItem) return;
    if (newName === renameItem.name) {
      setRenameItem(null);
      return;
    }
    try {
      const url = `${serverUrl}/api.php?token=${apiToken}&action=file_rename&path=${encodeURIComponent(renameItem.path)}&new_name=${encodeURIComponent(newName)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'success') {
        setRenameItem(null);
        loadDirectory(serverUrl, apiToken, currentPath);
      } else {
        Alert.alert('重命名失败', data.message || '服务器拒绝');
      }
    } catch (e) {
      Alert.alert('异常', e.message);
    }
  };

  const doDelete = async (item) => {
    try {
      const url = `${serverUrl}/api.php?token=${apiToken}&action=file_delete&path=${encodeURIComponent(item.path)}`;
      const res = await fetch(url);
      const data = await res.json();
      return data.status === 'success';
    } catch (e) {
      return false;
    }
  };

  const handleDelete = (item) => {
    showConfirm({
      type: 'danger',
      title: '确认删除',
      message: `确定彻底删除 ${item.isFolder ? '文件夹' : '文件'} \n"${item.name}" 吗？\n此操作不可撤销！`,
      confirmText: '彻底删除',
      onConfirm: async () => {
        const ok = await doDelete(item);
        if (ok) {
          setDetailItem(null);
          loadDirectory(serverUrl, apiToken, currentPath);
        } else {
          showConfirm({
            type: 'warning',
            title: '删除失败',
            message: '服务器拒绝删除，请检查操作权限。',
            confirmText: '知道了',
            showCancel: false,
          });
        }
      },
    });
  };

  const handleBatchDelete = () => {
    const items = fileList.filter(f => selected.has(f.path));
    if (items.length === 0) return;
    showConfirm({
      type: 'danger',
      title: '批量删除确认',
      message: `确定要彻底删除选中的 ${items.length} 个项目吗？\n此操作不可恢复！`,
      confirmText: '全部删除',
      onConfirm: async () => {
        for (const item of items) {
          await doDelete(item);
        }
        exitMultiSelect();
        loadDirectory(serverUrl, apiToken, currentPath);
      },
    });
  };

  // Target directory picker for Move / Copy
  const openPicker = async (mode, items) => {
    setPickerMode(mode);
    setPickerItems(items);
    setDetailItem(null);
    exitMultiSelect();
    setPickerVisible(true);
    setPickerPath(DEFAULT_ROOT);
    await loadPickerFolders(DEFAULT_ROOT);
  };

  const loadPickerFolders = async (path) => {
    setPickerLoading(true);
    try {
      const url = `${serverUrl}/api.php?token=${apiToken}&action=file_list&path=${encodeURIComponent(path)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'success') {
        const folders = (data.items || []).filter(it => it.isFolder);
        setPickerFolders(folders);
        setPickerPath(data.current_path || path);
      }
    } catch (e) {
      console.log('[FilesScreen] picker load error:', e);
    } finally {
      setPickerLoading(false);
    }
  };

  const pickerGoUp = () => {
    if (pickerPath === '/mnt' || pickerPath === DEFAULT_ROOT) return;
    const p = pickerPath.endsWith('/') ? pickerPath.slice(0, -1) : pickerPath;
    const parent = p.substring(0, p.lastIndexOf('/')) || '/mnt';
    loadPickerFolders(parent);
  };

  const confirmPicker = async () => {
    setPickerVisible(false);
    setIsLoadingList(true);
    const action = pickerMode === 'move' ? 'file_move' : 'file_copy';
    let count = 0;
    for (const it of pickerItems) {
      try {
        const url = `${serverUrl}/api.php?token=${apiToken}&action=${action}&source=${encodeURIComponent(it.path)}&target=${encodeURIComponent(pickerPath)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.status === 'success') count++;
      } catch (e) {}
    }
    showConfirm({
      type: 'success',
      title: '操作完成',
      message: `已成功将 ${count} 个项目${pickerMode === 'move' ? '移动' : '复制'}至目标目录。`,
      confirmText: '好的',
      showCancel: false,
    });
    loadDirectory(serverUrl, apiToken, currentPath);
  };

  // Server-side archive extract
  const handleExtractArchive = (item) => {
    setDetailItem(null);
    setExtractItem(item);
    setExtractCreateSubfolder(true);
  };

  const confirmExtractArchive = async () => {
    if (!extractItem) return;
    setIsExtracting(true);
    try {
      const url = `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=file_extract&source=${encodeURIComponent(extractItem.path)}&target=${encodeURIComponent(currentPath)}&create_folder=${extractCreateSubfolder ? 'true' : 'false'}`;
      const res = await fetch(url);
      const resText = await res.text();
      let data = null;
      try {
        data = JSON.parse(resText);
      } catch (parseErr) {
        console.log('[confirmExtractArchive] Response parse error:', resText);
      }

      setIsExtracting(false);

      if (!data) {
        const preview = resText ? (resText.length > 200 ? resText.slice(0, 200) + '...' : resText) : '（服务端返回空内容）';
        showConfirm({
          type: 'danger',
          title: '解压异常',
          message: `服务端未返回有效的 JSON 数据 (HTTP ${res.status || '未知'})。\n\n服务端原始返回：\n${preview}\n\n【排查提示】：请确认 Unraid 服务器上的 /usr/local/emhttp/api.php 已同步替换为最新版本！`,
          confirmText: '知道了',
          showCancel: false,
        });
        return;
      }

      if (data.status === 'success') {
        const targetDesc = data.target || currentPath;
        setExtractItem(null);
        showConfirm({
          type: 'success',
          title: '解压成功',
          message: `已成功在服务端解压 "${extractItem.name}"\n保存至：${targetDesc}`,
          confirmText: '好的',
          showCancel: false,
        });
        loadDirectory(serverUrl, apiToken, currentPath);
      } else {
        showConfirm({
          type: 'danger',
          title: '解压失败',
          message: data.message || '服务端解压失败，请确认服务端环境是否支持对应格式。',
          confirmText: '知道了',
          showCancel: false,
        });
      }
    } catch (e) {
      setIsExtracting(false);
      showConfirm({
        type: 'danger',
        title: '解压异常',
        message: e.message || '网络连接超时或服务器异常',
        confirmText: '知道了',
        showCancel: false,
      });
    }
  };

  // Server-side archive compress (Zip)
  const handleBatchCompress = () => {
    const items = fileList.filter(f => selected.has(f.path));
    if (items.length === 0) return;
    let defaultName = 'Archive.zip';
    if (items.length === 1) {
      defaultName = `${items[0].name}.zip`;
    } else {
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      defaultName = `Archive_${dateStr}.zip`;
    }
    setCompressZipName(defaultName);
    setCompressVisible(true);
  };

  const confirmBatchCompress = async () => {
    const items = fileList.filter(f => selected.has(f.path));
    if (items.length === 0) return;
    const name = compressZipName.trim();
    if (!name) return;

    setIsCompressing(true);
    try {
      const sourcePaths = items.map(it => it.path);
      const cleanBaseUrl = (serverUrl || '').replace(/\/+$/, '');
      const activeCsrf = await ensureCsrfToken(cleanBaseUrl, apiToken);
      const csrfParam = activeCsrf ? `&csrf_token=${encodeURIComponent(activeCsrf)}` : '';

      // Prepare GET query (Unraid emhttp handles GET without POST chunking or FastCGI body drop)
      const getQuery = `token=${encodeURIComponent(apiToken)}${csrfParam}&action=file_compress&target_dir=${encodeURIComponent(currentPath)}&zip_name=${encodeURIComponent(name)}&sources=${encodeURIComponent(JSON.stringify(sourcePaths))}`;
      let res;
      if (getQuery.length < 3500) {
        res = await fetch(`${cleanBaseUrl}/api.php?${getQuery}`);
      } else {
        const postUrl = `${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}${csrfParam}&action=file_compress`;
        res = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            sources: sourcePaths,
            target_dir: currentPath,
            zip_name: name,
          }),
        });
      }

      const resText = await res.text();
      let data = null;
      try {
        data = JSON.parse(resText);
      } catch (parseErr) {
        console.log('[confirmBatchCompress] Response parse error:', resText);
      }

      setIsCompressing(false);

      if (!data) {
        const preview = resText ? (resText.length > 200 ? resText.slice(0, 200) + '...' : resText) : '（服务端返回空内容）';
        showConfirm({
          type: 'danger',
          title: '压缩打包异常',
          message: `服务端未返回有效的 JSON 数据 (HTTP ${res?.status || '未知'})。\n\n服务端原始返回：\n${preview}\n\n【排查指引】：\n请确认已执行终端命令将脚本同步至运行目录：\ncp /boot/api.php /usr/local/emhttp/api.php\nchmod 755 /usr/local/emhttp/api.php`,
          confirmText: '知道了',
          showCancel: false,
        });
        return;
      }

      if (data.status === 'success') {
        setCompressVisible(false);
        exitMultiSelect();
        showConfirm({
          type: 'success',
          title: '打包完成',
          message: `已成功在服务端生成压缩包：\n"${data.zip_name || name}"`,
          confirmText: '好的',
          showCancel: false,
        });
        loadDirectory(serverUrl, apiToken, currentPath);
      } else {
        showConfirm({
          type: 'danger',
          title: '打包失败',
          message: data.message || '服务端打包失败，请检查磁盘空间或写入权限。',
          confirmText: '知道了',
          showCancel: false,
        });
      }
    } catch (e) {
      setIsCompressing(false);
      showConfirm({
        type: 'danger',
        title: '打包异常',
        message: e.message || '网络连接超时或服务器异常',
        confirmText: '知道了',
        showCancel: false,
      });
    }
  };

  // Hardware back button navigation (only active when Files tab is focused)
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (extractItem) { if (!isExtracting) setExtractItem(null); return true; }
        if (compressVisible) { if (!isCompressing) setCompressVisible(false); return true; }
        if (previewItem) { setPreviewItem(null); return true; }
        if (multiSelect) { exitMultiSelect(); return true; }
        if (pickerVisible) { setPickerVisible(false); return true; }
        if (renameItem) { setRenameItem(null); return true; }
        if (detailItem) { setDetailItem(null); return true; }
        if (isConfigured && !isAtRoot) { goBack(); return true; }
        return false;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [isConfigured, isAtRoot, goBack, previewItem, multiSelect, pickerVisible, renameItem, detailItem, extractItem, isExtracting, compressVisible, isCompressing])
  );

  // Header configuration
  useLayoutEffect(() => {
    if (!isConfigured) {
      navigation.setOptions({ title: 'Unraid 文件库', headerLeft: null, headerRight: null });
      return;
    }

    const pathSegments = currentPath.split('/').filter(Boolean);
    const titleName = isAtRoot ? '根共享库 (/mnt/user)' : decodeURIComponent(pathSegments[pathSegments.length - 1] || '文件');

    if (multiSelect) {
      navigation.setOptions({
        title: `已选 ${selected.size} 项`,
        headerLeft: () => (
          <TouchableOpacity onPress={exitMultiSelect} style={styles.headerBtnLeft}>
            <X color={colors.textStrong} size={24} />
          </TouchableOpacity>
        ),
        headerRight: null,
      });
      return;
    }

    navigation.setOptions({
      title: titleName,
      headerLeft: () => (
        !isAtRoot ? (
          <TouchableOpacity onPress={goBack} style={styles.headerBtnLeft}>
            <ChevronLeft color={colors.textStrong} size={28} />
          </TouchableOpacity>
        ) : null
      ),
      headerRight: () => (
        <View style={styles.headerBtnGroupRight}>
          <TouchableOpacity onPress={() => setIsTransferVisible(true)} style={styles.transferIconBtn}>
            <ArrowDownUp color={colors.accent} size={20} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsMenuVisible(true)} style={{ marginLeft: 16 }}>
            <Plus color={colors.textStrong} size={28} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, isConfigured, currentPath, isAtRoot, goBack, multiSelect, selected.size, colors, styles]);

  // Filter & Sorting
  const filteredFiles = useMemo(() => {
    let list = [...fileList];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(f => f.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
      if (sortBy === 'date') return (b.mtime || '').localeCompare(a.mtime || '');
      return 0;
    });
    return list;
  }, [fileList, searchQuery, sortBy]);

  // If checking authentication
  if (checkingAuth) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  // If Unraid not configured in settings
  if (!isConfigured) {
    return (
      <View style={styles.center}>
        <View style={styles.setupCard}>
          <Server color={colors.accent} size={52} style={{ alignSelf: 'center', marginBottom: 16 }} />
          <Text style={styles.setupTitle}>未连接 Unraid 服务器</Text>
          <Text style={styles.setupSub}>
            文件管理直接接入 Unraid 统一 API 核心，无需搭建繁琐的 WebDAV 服务。请先在「设置」页配置服务器地址与 API Token。
          </Text>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => navigation.navigate('设置')}
          >
            <Settings color="#ffffff" size={18} style={{ marginRight: 8 }} />
            <Text style={styles.saveBtnText}>前往设置连接</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fileContainer}>
      {/* Path Breadcrumb & Search Bar */}
      <View style={styles.topFilterBar}>
        <View style={styles.searchBox}>
          <Search color={colors.muted} size={18} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="搜索当前目录..."
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X color={colors.muted} size={18} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.sortToggleBtn}
          onPress={() => {
            const modes = ['name', 'date', 'size'];
            const next = modes[(modes.indexOf(sortBy) + 1) % modes.length];
            setSortBy(next);
          }}
        >
          <Text style={styles.sortToggleText}>
            {sortBy === 'name' ? '名称' : sortBy === 'date' ? '时间' : '大小'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* File List */}
      {isLoadingList && !isRefreshing ? (
        <View style={styles.listCenter}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.emptyText, { marginTop: 12 }]}>正在加载文件列表...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.listScroll}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        >
          {filteredFiles.length === 0 ? (
            <View style={styles.listCenter}>
              <FolderOpen color={colors.muted} size={48} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>当前目录无内容，下拉可刷新</Text>
            </View>
          ) : (
            filteredFiles.map((item, index) => {
              const sel = isSelected(item.path);
              return (
                <TouchableOpacity
                  key={index}
                  style={[styles.fileRow, sel && styles.fileRowSelected]}
                  onPress={() => handleFileClick(item)}
                  onLongPress={() => handleLongPress(item)}
                  delayLongPress={350}
                >
                  <View style={styles.fileIconBox}>
                    {item.isFolder ? (
                      <Folder color={colors.accent} size={24} fill="rgba(59, 130, 246, 0.2)" />
                    ) : isArchiveFile(item.name) ? (
                      <Archive color={colors.green} size={24} />
                    ) : (
                      <File color={colors.sub} size={24} />
                    )}
                  </View>

                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                    <View style={styles.fileMetaRow}>
                      <Text style={styles.fileSize}>
                        {item.isFolder ? '文件夹' : formatBytes(item.size)}
                      </Text>
                      {item.mtime ? <Text style={styles.fileDate}>{item.mtime}</Text> : null}
                    </View>
                  </View>

                  {multiSelect && (
                    <TouchableOpacity
                      style={styles.checkbox}
                      onPress={() => toggleSelect(item)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                    >
                      {sel ? (
                        <CheckCircle color={colors.accent} size={24} />
                      ) : (
                        <Circle color={colors.muted} size={24} />
                      )}
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Multi-Select Bottom Action Bar */}
      {multiSelect && (
        <View style={styles.bottomBar}>
          <View style={styles.bottomBarTop}>
            <Text style={styles.bottomBarCount}>已选 {selected.size} 项</Text>
            <TouchableOpacity onPress={toggleSelectAll}>
              <Text style={styles.bottomBarSelectAll}>
                {selected.size === filteredFiles.length ? '取消全选' : '全选'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bottomBarBtns}>
            <TouchableOpacity style={styles.bottomBarBtn} onPress={handleBatchDownload}>
              <Download color={colors.accent} size={22} />
              <Text style={styles.bottomBarBtnText}>下载</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.bottomBarBtn} onPress={handleBatchDelete}>
              <Trash2 color={colors.red} size={22} />
              <Text style={[styles.bottomBarBtnText, { color: colors.red }]}>删除</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bottomBarBtn}
              onPress={() => openPicker('move', fileList.filter(f => selected.has(f.path)))}
            >
              <MoveRight color={colors.accent} size={22} />
              <Text style={styles.bottomBarBtnText}>移动</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bottomBarBtn}
              onPress={() => openPicker('copy', fileList.filter(f => selected.has(f.path)))}
            >
              <Copy color={colors.accent} size={22} />
              <Text style={styles.bottomBarBtnText}>复制</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bottomBarBtn}
              onPress={handleBatchCompress}
            >
              <Archive color={colors.green} size={22} />
              <Text style={[styles.bottomBarBtnText, { color: colors.green }]}>压缩</Text>
            </TouchableOpacity>

            {selected.size === 1 && (
              <TouchableOpacity
                style={styles.bottomBarBtn}
                onPress={() => {
                  const target = fileList.find(f => selected.has(f.path));
                  exitMultiSelect();
                  setDetailItem(target);
                }}
              >
                <Info color={colors.amber} size={22} />
                <Text style={styles.bottomBarBtnText}>详情</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Modernized File Previewer */}
      <FilePreviewer
        item={previewItem}
        serverUrl={serverUrl}
        apiToken={apiToken}
        getDirectUrl={getDirectUrl}
        onClose={() => setPreviewItem(null)}
        onDownload={handleDownload}
      />

      {/* Dropdown Menu (Top-Right Plus) */}
      <Modal visible={isMenuVisible} transparent animationType="fade" onRequestClose={() => setIsMenuVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setIsMenuVisible(false)}>
          <View style={styles.dropdownMenu}>
            <TouchableOpacity style={styles.menuItem} onPress={handleUpload}>
              <UploadCloud color={colors.text} size={20} />
              <Text style={styles.menuText}>上传文件</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setIsMenuVisible(false);
                setNewFolderName('');
                setMkdirVisible(true);
              }}
            >
              <FolderPlus color={colors.text} size={20} />
              <Text style={styles.menuText}>新建文件夹</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setIsMenuVisible(false);
                onRefresh();
              }}
            >
              <RefreshCw color={colors.text} size={20} />
              <Text style={styles.menuText}>刷新目录</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Create Folder Modal */}
      <Modal visible={mkdirVisible} transparent animationType="fade" onRequestClose={() => setMkdirVisible(false)}>
        <KeyboardAvoidingView style={styles.dialogOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMkdirVisible(false)} />
          <View style={styles.dialogCard}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
              <FolderPlus color={colors.accent} size={28} />
            </View>
            <Text style={styles.dialogTitle}>新建文件夹</Text>
            <Text style={styles.dialogSub}>在当前路径下创建一个新的子目录</Text>
            <TextInput
              style={styles.dialogInput}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
              placeholder="请输入文件夹名称"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity style={[styles.dialogBtn, styles.dialogCancelBtn]} onPress={() => setMkdirVisible(false)}>
                <Text style={styles.dialogCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dialogBtn, styles.dialogConfirmBtn]} onPress={confirmCreateFolder}>
                <Text style={styles.dialogConfirmText}>创建</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={!!renameItem} transparent animationType="fade" onRequestClose={() => setRenameItem(null)}>
        <KeyboardAvoidingView style={styles.dialogOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRenameItem(null)} />
          <View style={styles.dialogCard}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(245, 158, 11, 0.12)' }]}>
              <Pencil color={colors.amber} size={26} />
            </View>
            <Text style={styles.dialogTitle}>重命名</Text>
            <Text style={styles.dialogSub}>修改文件或文件夹的名称</Text>
            <TextInput
              style={styles.dialogInput}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              selectTextOnFocus
              placeholder="输入新名称"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity style={[styles.dialogBtn, styles.dialogCancelBtn]} onPress={() => setRenameItem(null)}>
                <Text style={styles.dialogCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dialogBtn, styles.dialogConfirmBtn]} onPress={confirmRename}>
                <Text style={styles.dialogConfirmText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Item Details Sheet */}
      <Modal visible={!!detailItem} transparent animationType="fade" onRequestClose={() => setDetailItem(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setDetailItem(null)}>
          <View style={styles.actionSheet}>
            <View style={styles.sheetGrabPill} />
            <View style={styles.detailHeader}>
              <View style={[styles.detailIconBadge, {
                backgroundColor: detailItem?.isFolder ? 'rgba(59, 130, 246, 0.12)' : isArchiveFile(detailItem?.name) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(156, 163, 175, 0.12)'
              }]}>
                {detailItem?.isFolder ? (
                  <Folder color={colors.accent} size={30} />
                ) : isArchiveFile(detailItem?.name) ? (
                  <Archive color={colors.green} size={30} />
                ) : (
                  <File color={colors.sub} size={30} />
                )}
              </View>
              <Text style={styles.detailName} numberOfLines={2}>{detailItem?.name}</Text>
            </View>

            <View style={styles.detailRows}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>类型</Text>
                <Text style={styles.detailValue}>
                  {detailItem?.isFolder ? '文件夹' : isArchiveFile(detailItem?.name) ? '压缩归档文件' : '文件'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>大小</Text>
                <Text style={styles.detailValue}>{detailItem?.isFolder ? '-' : formatBytes(detailItem?.size)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>修改时间</Text>
                <Text style={styles.detailValue}>{detailItem?.mtime || '未知'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>完整路径</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{detailItem?.path}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              {isArchiveFile(detailItem?.name) && (
                <TouchableOpacity
                  style={[styles.detailActionBtn, { backgroundColor: 'rgba(16, 185, 129, 0.12)', flex: 1, minWidth: '45%' }]}
                  onPress={() => {
                    const it = detailItem;
                    setDetailItem(null);
                    handleExtractArchive(it);
                  }}
                >
                  <Archive color={colors.green} size={18} style={{ marginRight: 6 }} />
                  <Text style={[styles.detailActionText, { color: colors.green }]}>服务端解压</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.detailActionBtn, isArchiveFile(detailItem?.name) ? { flex: 1, minWidth: '45%' } : {}]}
                onPress={() => {
                  const it = detailItem;
                  setDetailItem(null);
                  setRenameItem(it);
                  setRenameValue(it.name);
                }}
              >
                <Pencil color={colors.accent} size={18} style={{ marginRight: 6 }} />
                <Text style={styles.detailActionText}>重命名</Text>
              </TouchableOpacity>

              {!detailItem?.isFolder && (
                <TouchableOpacity
                  style={[styles.detailActionBtn, isArchiveFile(detailItem?.name) ? { flex: 1, minWidth: '45%' } : {}]}
                  onPress={() => {
                    const it = detailItem;
                    setDetailItem(null);
                    handleDownload(it);
                  }}
                >
                  <Download color={colors.accent} size={18} style={{ marginRight: 6 }} />
                  <Text style={styles.detailActionText}>下载</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.detailActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }, isArchiveFile(detailItem?.name) ? { flex: 1, minWidth: '45%' } : {}]}
                onPress={() => handleDelete(detailItem)}
              >
                <Trash2 color={colors.red} size={18} style={{ marginRight: 6 }} />
                <Text style={[styles.detailActionText, { color: colors.red }]}>删除</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.actionSheetCancel} onPress={() => setDetailItem(null)}>
              <Text style={styles.actionSheetCancelText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Server-side Archive Extract Modal */}
      <Modal visible={!!extractItem} transparent animationType="fade" onRequestClose={() => !isExtracting && setExtractItem(null)}>
        <KeyboardAvoidingView style={styles.dialogOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !isExtracting && setExtractItem(null)} />
          <View style={styles.dialogCard}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
              <Archive color={colors.green} size={28} />
            </View>
            <Text style={styles.dialogTitle}>服务端在线解压</Text>
            <Text style={styles.dialogSub}>由 Unraid 服务器原生极速解压，无需耗费手机流量</Text>

            <View style={{ backgroundColor: colors.surface, padding: 12, borderRadius: 10, marginVertical: 12, width: '100%' }}>
              <Text style={{ fontSize: 13, color: colors.sub, marginBottom: 4 }}>待解压归档：</Text>
              <Text style={{ fontSize: 14, color: colors.textStrong, fontWeight: '600' }} numberOfLines={1}>{extractItem?.name}</Text>
              <Text style={{ fontSize: 13, color: colors.sub, marginTop: 8, marginBottom: 4 }}>解压目标目录：</Text>
              <Text style={{ fontSize: 13, color: colors.accent }} numberOfLines={1}>{currentPath}</Text>
            </View>

            {/* Subfolder switch */}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8, width: '100%' }}
              onPress={() => setExtractCreateSubfolder(!extractCreateSubfolder)}
              disabled={isExtracting}
            >
              <View style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                borderWidth: 1.5,
                borderColor: extractCreateSubfolder ? colors.accent : colors.muted,
                backgroundColor: extractCreateSubfolder ? colors.accent : 'transparent',
                justifyContent: 'center',
                alignItems: 'center',
                marginRight: 8,
              }}>
                {extractCreateSubfolder && <Check color="#fff" size={14} />}
              </View>
              <Text style={{ fontSize: 14, color: colors.textStrong }}>解压至新建同名子文件夹</Text>
            </TouchableOpacity>

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogCancelBtn]}
                onPress={() => setExtractItem(null)}
                disabled={isExtracting}
              >
                <Text style={styles.dialogCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, { backgroundColor: colors.green }]}
                onPress={confirmExtractArchive}
                disabled={isExtracting}
              >
                {isExtracting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.dialogConfirmText}>立即解压</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Server-side Archive Compress Modal */}
      <Modal visible={compressVisible} transparent animationType="fade" onRequestClose={() => !isCompressing && setCompressVisible(false)}>
        <KeyboardAvoidingView style={styles.dialogOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !isCompressing && setCompressVisible(false)} />
          <View style={styles.dialogCard}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
              <Archive color={colors.accent} size={28} />
            </View>
            <Text style={styles.dialogTitle}>服务端打包压缩 (Zip)</Text>
            <Text style={styles.dialogSub}>已选 {selected.size} 个项目，将在 Unraid 服务器直接打包</Text>

            <TextInput
              style={[styles.dialogInput, { marginTop: 12 }]}
              value={compressZipName}
              onChangeText={setCompressZipName}
              placeholder="请输入压缩包文件名 (如 archive.zip)"
              placeholderTextColor={colors.muted}
              editable={!isCompressing}
            />

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogCancelBtn]}
                onPress={() => setCompressVisible(false)}
                disabled={isCompressing}
              >
                <Text style={styles.dialogCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogConfirmBtn]}
                onPress={confirmBatchCompress}
                disabled={isCompressing}
              >
                {isCompressing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.dialogConfirmText}>开始打包</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Target Directory Picker (Move / Copy) */}
      <Modal visible={pickerVisible} animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.pickerContainer}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity onPress={pickerGoUp} style={styles.pickerUpBtn}>
              <ArrowUp color={colors.textStrong} size={22} />
              <Text style={styles.pickerUpText}>上级</Text>
            </TouchableOpacity>
            <Text style={styles.pickerTitle}>{pickerMode === 'move' ? '移动到' : '复制到'}：</Text>
            <TouchableOpacity onPress={() => setPickerVisible(false)}>
              <X color={colors.textStrong} size={22} />
            </TouchableOpacity>
          </View>
          <Text style={styles.pickerPath} numberOfLines={1}>{pickerPath}</Text>
          {pickerLoading ? (
            <View style={styles.listCenter}><ActivityIndicator size="large" color={colors.accent} /></View>
          ) : (
            <ScrollView contentContainerStyle={styles.pickerList}>
              <TouchableOpacity style={styles.pickerRow} onPress={pickerGoUp}>
                <FolderOpen color={colors.accent} size={20} />
                <Text style={styles.pickerFolderName}>返回上一级</Text>
              </TouchableOpacity>
              {pickerFolders.length === 0 ? (
                <View style={styles.listCenter}><Text style={styles.emptyText}>无子文件夹</Text></View>
              ) : (
                pickerFolders.map((folder, index) => (
                  <TouchableOpacity key={index} style={styles.pickerRow} onPress={() => loadPickerFolders(folder.path)}>
                    <Folder color={colors.accent} size={20} />
                    <Text style={styles.pickerFolderName} numberOfLines={1}>{folder.name}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          )}
          <View style={styles.pickerFooter}>
            <TouchableOpacity style={styles.pickerConfirmBtn} onPress={confirmPicker} disabled={pickerLoading}>
              <Text style={styles.pickerConfirmText}>确认{pickerMode === 'move' ? '移动' : '复制'}到此目录</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Advanced Transfer Task Center */}
      <Modal visible={isTransferVisible} animationType="slide" onRequestClose={() => setIsTransferVisible(false)}>
        <View style={styles.transferModal}>
          <View style={styles.transferHeader}>
            <Text style={styles.transferTitle}>传输任务中心</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {transfers.some(t => t.status === 'success') && (
                <TouchableOpacity onPress={clearCompletedTransfers}>
                  <Text style={[styles.closeText, { color: colors.sub, fontSize: 13 }]}>清空已完成</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setIsTransferVisible(false)}>
                <Text style={styles.closeText}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.transferContent}>
            {transfers.length === 0 ? (
              <View style={[styles.listCenter, { marginTop: 100 }]}>
                <ArrowDownUp color={colors.divider} size={54} style={{ marginBottom: 16 }} />
                <Text style={styles.emptyText}>暂无传输任务记录</Text>
              </View>
            ) : (
              transfers.map((item) => {
                const isRunning = item.status === 'running';
                const isPaused = item.status === 'paused';
                const isSuccess = item.status === 'success';
                const isError = item.status === 'error';

                return (
                  <View key={item.id} style={styles.transferRow}>
                    {/* Top Row: Icon + Name & Status Tag + Top-Right Actions */}
                    <View style={styles.transferTopRow}>
                      <View style={[
                        styles.transferIconBox,
                        {
                          backgroundColor: isSuccess
                            ? 'rgba(16, 185, 129, 0.12)'
                            : isError
                            ? 'rgba(239, 68, 68, 0.12)'
                            : isPaused
                            ? 'rgba(245, 158, 11, 0.12)'
                            : 'rgba(59, 130, 246, 0.12)'
                        }
                      ]}>
                        {item.type === '上传' ? (
                          <UploadCloud
                            color={isSuccess ? colors.green : isError ? colors.red : isPaused ? colors.amber : colors.accent}
                            size={20}
                          />
                        ) : (
                          <DownloadCloud
                            color={isSuccess ? colors.green : isError ? colors.red : colors.green}
                            size={20}
                          />
                        )}
                      </View>

                      <View style={styles.transferHeaderContent}>
                        <Text style={styles.transferName} numberOfLines={1}>{item.name}</Text>
                        <View style={styles.transferTagRow}>
                          <View style={[
                            styles.transferStatusTag,
                            {
                              backgroundColor: isSuccess
                                ? 'rgba(16, 185, 129, 0.15)'
                                : isError
                                ? 'rgba(239, 68, 68, 0.15)'
                                : isPaused
                                ? 'rgba(245, 158, 11, 0.15)'
                                : 'rgba(59, 130, 246, 0.15)'
                            }
                          ]}>
                            <Text style={[
                              styles.transferStatusTagText,
                              {
                                color: isSuccess
                                  ? colors.green
                                  : isError
                                  ? colors.red
                                  : isPaused
                                  ? colors.amber
                                  : colors.accent
                              }
                            ]}>
                              {item.type} · {isSuccess ? '已完成' : isError ? '传输失败' : isPaused ? '已暂停' : '传输中'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Top-Right Optimized Action Buttons: Distinct, Ergonomic, Pill-shaped */}
                      <View style={styles.transferActionGroup}>
                        {item.type === '上传' && isRunning && (
                          <TouchableOpacity
                            style={[styles.transferActionBtn, { backgroundColor: 'rgba(245, 158, 11, 0.14)' }]}
                            onPress={() => pauseUploadTask(item.id)}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Pause color={colors.amber} size={15} />
                          </TouchableOpacity>
                        )}

                        {item.type === '上传' && (isPaused || isError) && (
                          <TouchableOpacity
                            style={[styles.transferActionBtn, { backgroundColor: 'rgba(59, 130, 246, 0.14)' }]}
                            onPress={() => resumeUploadTask(item)}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Play color={colors.accent} size={15} />
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={[styles.transferActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}
                          onPress={() => deleteTransferRecord(item.id)}
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Trash2 color={colors.red} size={15} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Middle: Full-width Progress Bar */}
                    <View style={styles.transferProgressBar}>
                      <View
                        style={[
                          styles.transferProgressFill,
                          {
                            width: `${Math.max(2, Math.min(100, item.progress || 0))}%`,
                            backgroundColor: isSuccess
                              ? colors.green
                              : isError
                              ? colors.red
                              : isPaused
                              ? colors.amber
                              : colors.accent,
                          }
                        ]}
                      />
                    </View>

                    {/* Bottom: 3 Independent Fixed Anchored Columns (Never shifts/shakes!) */}
                    <View style={styles.transferMetaRow}>
                      {/* Left Anchor: Transferred Size / Total Size */}
                      <View style={styles.transferMetaLeft}>
                        <Text style={[styles.transferSizeText, { color: colors.sub }]} numberOfLines={1}>
                          {item.sizeText || `${formatBytesFixed(item.transferredBytes || 0)} / ${formatBytesFixed(item.totalBytes || item.size || 0)}`}
                        </Text>
                      </View>

                      {/* Center Anchor: Percentage with Tabular Nums */}
                      <View style={styles.transferMetaCenter}>
                        <Text style={[
                          styles.transferPctText,
                          { color: isSuccess ? colors.green : isPaused ? colors.amber : colors.accent }
                        ]}>
                          {item.progress || 0}%
                        </Text>
                      </View>

                      {/* Right Anchor: Fixed Right-Aligned Speed with Tabular Nums */}
                      <View style={styles.transferMetaRight}>
                        <Text style={[
                          styles.transferSpeedText,
                          { color: isRunning ? colors.accent : colors.muted }
                        ]} numberOfLines={1}>
                          {item.speedDisplay || (isRunning ? '计算中...' : isPaused ? '已暂停' : isSuccess ? '完成' : '停止')}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Sleek Modern Confirm & Result Dialog */}
      <ModernConfirmDialog
        visible={confirmDialog.visible}
        type={confirmDialog.type}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        showCancel={confirmDialog.showCancel}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 20 },
  setupCard: { backgroundColor: colors.card, borderRadius: 20, padding: 28, elevation: 5 },
  setupTitle: { color: colors.textStrong, fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  setupSub: { color: colors.sub, fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  saveBtn: { backgroundColor: colors.accent, height: 50, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  saveBtnText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },

  headerBtnLeft: { marginLeft: 8, padding: 4 },
  headerBtnGroupRight: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  transferIconBtn: { backgroundColor: 'rgba(59, 130, 246, 0.15)', padding: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.3)' },

  fileContainer: { flex: 1, backgroundColor: colors.bg },
  topFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
  },
  searchInput: {
    flex: 1,
    color: colors.textStrong,
    fontSize: 14,
    padding: 0,
  },
  sortToggleBtn: {
    backgroundColor: colors.input,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  sortToggleText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: 'bold',
  },

  listCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 320 },
  emptyText: { color: colors.muted, fontSize: 15 },
  listScroll: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 110 },
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, padding: 12, borderRadius: 12, marginBottom: 8 },
  fileRowSelected: { borderWidth: 1.5, borderColor: colors.accent },
  checkbox: { marginLeft: 10, justifyContent: 'center', alignItems: 'center' },
  fileIconBox: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.input, borderRadius: 8, marginRight: 12 },
  fileInfo: { flex: 1, justifyContent: 'center' },
  fileName: { color: colors.text, fontSize: 15, fontWeight: '500' },
  fileMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  fileSize: { color: colors.sub, fontSize: 12 },
  fileDate: { color: colors.muted, fontSize: 11 },

  // Bottom action bar
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 24 : 12, paddingHorizontal: 12, elevation: 8 },
  bottomBarTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginBottom: 8 },
  bottomBarCount: { color: colors.text, fontSize: 13, fontWeight: 'bold' },
  bottomBarSelectAll: { color: colors.accent, fontSize: 14, fontWeight: 'bold' },
  bottomBarBtns: { flexDirection: 'row', justifyContent: 'space-around' },
  bottomBarBtn: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  bottomBarBtnText: { color: colors.text, fontSize: 12, marginTop: 4, fontWeight: 'bold' },

  // Overlays & Dialogs
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: 24,
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
  },
  dialogIconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  dialogTitle: {
    color: colors.textStrong,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  dialogSub: {
    color: colors.sub,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  dialogInput: {
    width: '100%',
    backgroundColor: colors.input,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 50,
    color: colors.textStrong,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: 20,
  },
  dialogActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  dialogBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialogCancelBtn: {
    backgroundColor: colors.input,
  },
  dialogCancelText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  dialogConfirmBtn: {
    backgroundColor: colors.accent,
  },
  dialogConfirmText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },

  // Dropdown Menu
  dropdownMenu: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 60,
    right: 16,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 8,
    width: 196,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  menuText: { color: colors.text, fontSize: 14, marginLeft: 12, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },

  // Action sheet details
  actionSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 22,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  sheetGrabPill: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: 16,
  },
  detailHeader: { alignItems: 'center', marginBottom: 16 },
  detailIconBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  detailName: { color: colors.textStrong, fontSize: 16, fontWeight: '700', textAlign: 'center', paddingHorizontal: 12 },
  detailRows: { backgroundColor: colors.input, borderRadius: 18, padding: 14, marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  detailLabel: { color: colors.sub, fontSize: 13, width: 68 },
  detailValue: { color: colors.text, fontSize: 13, flex: 1, textAlign: 'right', fontWeight: '500' },
  detailActionBtn: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.input,
    borderRadius: 14,
  },
  detailActionText: { color: colors.textStrong, fontSize: 14, fontWeight: '600' },
  actionSheetCancel: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.input, borderRadius: 14, height: 48 },
  actionSheetCancelText: { color: colors.textStrong, fontSize: 15, fontWeight: '700' },

  // Rename & Mkdir backward compatibility aliases
  renameBox: { backgroundColor: colors.card, borderRadius: 24, padding: 22, margin: 24 },
  renameTitle: { color: colors.textStrong, fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  renameInput: { backgroundColor: colors.input, borderRadius: 14, paddingHorizontal: 14, height: 50, color: colors.textStrong, fontSize: 15, marginBottom: 16 },
  renameBtns: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  renameBtn: { flex: 1, borderRadius: 14, height: 46, justifyContent: 'center', alignItems: 'center' },
  renameBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' },

  // Target Picker
  pickerContainer: { flex: 1, backgroundColor: colors.bg },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: Platform.OS === 'ios' ? 60 : 16, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.divider },
  pickerUpBtn: { flexDirection: 'row', alignItems: 'center' },
  pickerUpText: { color: colors.textStrong, fontSize: 14, marginLeft: 4, fontWeight: '600' },
  pickerTitle: { color: colors.textStrong, fontSize: 17, fontWeight: 'bold' },
  pickerPath: { color: colors.accent, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(59,130,246,0.08)' },
  pickerList: { padding: 12 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 8 },
  pickerFolderName: { color: colors.text, fontSize: 15, marginLeft: 10, flex: 1, fontWeight: '500' },
  pickerFooter: { padding: 16, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.divider, paddingBottom: Platform.OS === 'ios' ? 28 : 16 },
  pickerConfirmBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  pickerConfirmText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },

  // Transfer Modal
  transferModal: { flex: 1, backgroundColor: colors.bg },
  transferHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 20, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.divider },
  transferTitle: { color: colors.textStrong, fontSize: 18, fontWeight: 'bold' },
  closeText: { color: colors.accent, fontSize: 15, fontWeight: 'bold' },
  transferContent: { padding: 16 },
  transferRow: {
    backgroundColor: colors.card,
    padding: 14,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  transferTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  transferIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  transferHeaderContent: {
    flex: 1,
    marginRight: 8,
  },
  transferName: {
    color: colors.textStrong,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 3,
  },
  transferTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transferStatusTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  transferStatusTagText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  transferActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  transferActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  transferProgressBar: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  transferProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  transferMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  transferMetaLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  transferSizeText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  transferMetaCenter: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  transferPctText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: 'bold',
  },
  transferMetaRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  transferSpeedText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    textAlign: 'right',
  },
});