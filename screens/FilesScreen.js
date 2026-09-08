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
  RefreshCw, Settings, Check, Search, Filter,
} from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../ThemeContext';
import { getDownloadDir, formatBytes } from '../utils/cacheManager';
import FilePreviewer from '../components/FilePreviewer';
import ModernConfirmDialog from '../components/ModernConfirmDialog';

// Formats bytes with fixed 1 decimal place to prevent layout shift
const formatBytesFixed = (bytes) => {
  if (!bytes || bytes <= 0) return '0.0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i === 0) return `${bytes} B`;
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
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

  const ensureCsrfToken = async (baseUrl, token) => {
    if (csrfTokenRef.current) return csrfTokenRef.current;
    const cleanUrl = (baseUrl || '').replace(/\/+$/, '');
    try {
      const res = await fetch(`${cleanUrl}/api.php?token=${encodeURIComponent(token)}&action=csrf_token`);
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
        const taskId = 'up_' + Date.now();
        const newTask = {
          id: taskId,
          name: file.name,
          uri: file.uri,
          size: file.size || 0,
          targetPath: currentPath,
          type: '上传',
          status: 'running', // 'running' | 'paused' | 'success' | 'error'
          progress: 0,
          transferredBytes: 0,
          totalBytes: file.size || 0,
          sizeText: `${formatBytesFixed(0)} / ${formatBytesFixed(file.size || 0)}`,
          speedDisplay: '准备中...',
        };

        setTransfers(prev => [newTask, ...prev]);
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

    let tempLocalUri = null;
    try {
      let fileUri = taskItem.uri;
      if (fileUri.startsWith('content://')) {
        try {
          tempLocalUri = `${FileSystem.cacheDirectory}up_${Date.now()}_${encodeURIComponent(taskItem.name)}`;
          await FileSystem.copyAsync({ from: fileUri, to: tempLocalUri });
          fileUri = tempLocalUri;
        } catch (copyErr) {
          console.log('[FilesScreen] Cache copy error, fallback to uri:', copyErr);
        }
      }

      // Check if file exists and get real size
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) {
        throw new Error('本地文件无法读取或已丢失');
      }

      const totalSize = (fileInfo.size !== undefined && fileInfo.size !== null) ? fileInfo.size : (taskItem.size || 0);

      const cleanBaseUrl = (serverUrl || '').replace(/\/+$/, '');
      const activeCsrf = await ensureCsrfToken(cleanBaseUrl, apiToken);
      const csrfQuery = activeCsrf ? `&csrf_token=${encodeURIComponent(activeCsrf)}` : '';

      // -----------------------------------------------------------------------
      // Strategy 1: Native Streaming Multipart Upload via FileSystem.uploadAsync
      // ONLY attempt Strategy 1 for files <= 2MB!
      // Unraid emhttp php.ini hard-limits upload_max_filesize = 2M.
      // Any file > 2MB will be rejected by PHP with UPLOAD_ERR_INI_SIZE!
      // Bypassing Strategy 1 for files > 2MB prevents uploading the file twice
      // and eliminates the fake 6MB/s spike and stuck progress delay!
      // -----------------------------------------------------------------------
      let nativeSucceeded = false;
      const MAX_PHP_DIRECT = 2 * 1024 * 1024; // 2 MB limit for direct multipart

      if (totalSize <= MAX_PHP_DIRECT) {
        setTransfers(prev => prev.map(t => (t.id === taskId ? {
          ...t,
          status: 'running',
          progress: (t.progress !== undefined && t.progress > 0) ? t.progress : 25,
          transferredBytes: 0,
          totalBytes: totalSize,
          sizeText: `${formatBytesFixed(0)} / ${formatBytesFixed(totalSize)}`,
          speedDisplay: '原生直传中...',
        } : t)));

        try {
          const nativeUploadUrl = `${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}${csrfQuery}&action=file_upload&path=${encodeURIComponent(taskItem.targetPath)}&filename=${encodeURIComponent(taskItem.name)}`;
          const nativeRes = await FileSystem.uploadAsync(nativeUploadUrl, fileUri, {
            fieldName: 'file',
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.MULTIPART,
            headers: {
              'Accept': 'application/json',
              'X-API-Token': apiToken,
              ...(activeCsrf ? { 'X-CSRF-Token': activeCsrf } : {}),
            },
            parameters: {
              csrf_token: activeCsrf || '',
              token: apiToken,
              action: 'file_upload',
              path: taskItem.targetPath,
              filename: taskItem.name,
            },
          });

          if (nativeRes.status === 200 && nativeRes.body) {
            try {
              const data = JSON.parse(nativeRes.body);
              if (data.status === 'success') {
                nativeSucceeded = true;
              }
            } catch (_) {
              if (nativeRes.body.includes('success')) {
                nativeSucceeded = true;
              }
            }
          }
        } catch (nativeErr) {
          console.log('[FilesScreen] Small file direct upload failed, fallback to chunking:', nativeErr);
        }

        if (nativeSucceeded) {
          delete activeTasksRef.current[taskId];
          if (tempLocalUri) {
            FileSystem.deleteAsync(tempLocalUri, { idempotent: true }).catch(() => {});
          }
          const savedPath = `${taskItem.targetPath}/${taskItem.name}`;
          setTransfers(prev => prev.map(t => (t.id === taskId ? {
            ...t,
            status: 'success',
            progress: 100,
            transferredBytes: totalSize,
            totalBytes: totalSize,
            sizeText: `${formatBytesFixed(totalSize)} / ${formatBytesFixed(totalSize)}`,
            speedDisplay: '已完成',
          } : t)));
          loadDirectory(cleanBaseUrl, apiToken, currentPath);
          showConfirm({
            type: 'success',
            title: '上传成功',
            message: `文件已成功写入 Unraid 存储：\n${savedPath}`,
            confirmText: '好的',
            showCancel: false,
          });
          return;
        }
      }

      // -----------------------------------------------------------------------
      // Strategy 2: High-Throughput Pipelined Chunk Engine (POST)
      // -----------------------------------------------------------------------
      let CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB per chunk
      if (totalSize > 20 * 1024 * 1024) {
        CHUNK_SIZE = 3.5 * 1024 * 1024; // 3.5 MB per chunk for larger files
      }

      const totalChunks = totalSize > 0 ? Math.ceil(totalSize / CHUNK_SIZE) : 1;
      let startChunk = taskItem.chunkIndex || 0;
      if (startChunk >= totalChunks) startChunk = 0;

      const initialBytes = startChunk * CHUNK_SIZE;
      const initialPct = totalSize > 0 ? Math.min(99, Math.round((initialBytes / totalSize) * 100)) : 0;

      setTransfers(prev => prev.map(t => (t.id === taskId ? {
        ...t,
        status: 'running',
        progress: (t.progress !== undefined && t.progress > 0) ? t.progress : initialPct,
        transferredBytes: (t.transferredBytes !== undefined && t.transferredBytes > 0) ? t.transferredBytes : initialBytes,
        totalBytes: totalSize,
        sizeText: `${formatBytesFixed((t.transferredBytes !== undefined && t.transferredBytes > 0) ? t.transferredBytes : initialBytes)} / ${formatBytesFixed(totalSize)}`,
        speedDisplay: startChunk > 0 ? '续传中...' : '传输中...',
      } : t)));

      let lastTime = Date.now();
      let lastBytes = startChunk * CHUNK_SIZE;
      let currentSpeedStr = '';
      let chunkEngineFailed = false;
      let chunkEngineError = '';

      const readChunkAsync = async (chunkIdx) => {
        const off = chunkIdx * CHUNK_SIZE;
        if (off >= totalSize) return '';
        const len = Math.min(CHUNK_SIZE, totalSize - off);
        if (len <= 0) return '';
        try {
          return await FileSystem.readAsStringAsync(fileUri, {
            encoding: FileSystem.EncodingType.Base64,
            position: off,
            length: len,
          });
        } catch (readErr) {
          console.log(`[FilesScreen] Read chunk ${chunkIdx} error:`, readErr);
          return '';
        }
      };

      let nextChunkPromise = readChunkAsync(startChunk);

      for (let i = startChunk; i < totalChunks; i++) {
        if (activeTasksRef.current[taskId]?.cancelled || abortController.signal.aborted) {
          delete activeTasksRef.current[taskId];
          return;
        }

        const offset = i * CHUNK_SIZE;
        const length = Math.min(CHUNK_SIZE, totalSize - offset);

        let base64Chunk = await nextChunkPromise;
        if (!base64Chunk && length > 0) {
          base64Chunk = await readChunkAsync(i);
        }

        if (activeTasksRef.current[taskId]?.cancelled || abortController.signal.aborted) {
          delete activeTasksRef.current[taskId];
          return;
        }

        if (i + 1 < totalChunks) {
          nextChunkPromise = readChunkAsync(i + 1);
        } else {
          nextChunkPromise = null;
        }

        const chunkUrl = `${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}${csrfQuery}&action=file_chunk`;
        const formData = new FormData();
        formData.append('token', apiToken);
        formData.append('action', 'file_chunk');
        formData.append('path', taskItem.targetPath);
        formData.append('filename', taskItem.name);
        formData.append('chunk_index', String(i));
        formData.append('total_chunks', String(totalChunks));
        formData.append('offset', String(offset));
        formData.append('total_size', String(totalSize));
        formData.append('data', base64Chunk);
        if (activeCsrf) formData.append('csrf_token', activeCsrf);

        let chunkSuccess = false;
        let chunkAttempt = 0;
        let lastErr = null;

        while (!chunkSuccess && chunkAttempt < 3) {
          if (activeTasksRef.current[taskId]?.cancelled || abortController.signal.aborted) {
            delete activeTasksRef.current[taskId];
            return;
          }
          chunkAttempt++;
          try {
            const res = await fetch(chunkUrl, {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'X-API-Token': apiToken,
                ...(activeCsrf ? { 'X-CSRF-Token': activeCsrf } : {}),
              },
              body: formData,
              signal: abortController.signal,
            });

            const resText = await res.text();
            if (!res.ok || !resText || !resText.trim()) {
              throw new Error(`HTTP ${res.status}: ${resText ? resText.slice(0, 100) : '服务端返回 0 字节'}`);
            }

            const resData = JSON.parse(resText);
            if (resData.status !== 'success') {
              throw new Error(resData.message || '分片写入失败');
            }
            chunkSuccess = true;
          } catch (err) {
            if (activeTasksRef.current[taskId]?.cancelled || abortController.signal.aborted || err.name === 'AbortError' || (err.message && err.message.includes('abort'))) {
              delete activeTasksRef.current[taskId];
              return;
            }
            lastErr = err;
            if (chunkAttempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }

        if (!chunkSuccess) {
          if (activeTasksRef.current[taskId]?.cancelled || abortController.signal.aborted) {
            delete activeTasksRef.current[taskId];
            return;
          }
          console.log(`[FilesScreen] POST chunk ${i} failed after 3 attempts:`, lastErr);
          chunkEngineFailed = true;
          chunkEngineError = lastErr ? lastErr.message : '分片写入失败';
          break;
        }

        const currentBytes = offset + length;
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;

        if (timeDiff >= 0.35 || !currentSpeedStr) {
          const bytesDiff = currentBytes - lastBytes;
          if (timeDiff > 0 && bytesDiff > 0) {
            const currentSpeed = bytesDiff / timeDiff;
            currentSpeedStr = `${formatBytesFixed(currentSpeed)}/s`;
          }
          lastTime = now;
          lastBytes = currentBytes;
        }

        const pct = totalSize > 0 ? Math.min(99, Math.round((currentBytes / totalSize) * 100)) : 100;

        setTransfers(prev => prev.map(t => {
          if (t.id === taskId) {
            return {
              ...t,
              status: 'running',
              chunkIndex: i + 1,
              progress: pct,
              transferredBytes: currentBytes,
              totalBytes: totalSize,
              sizeText: `${formatBytesFixed(currentBytes)} / ${formatBytesFixed(totalSize)}`,
              speedDisplay: currentSpeedStr || '计算中...',
            };
          }
          return t;
        }));
      }

      // -----------------------------------------------------------------------
      // Strategy 3: 4KB Micro-Chunk GET Fallback Engine
      // -----------------------------------------------------------------------
      if (chunkEngineFailed) {
        setTransfers(prev => prev.map(t => (t.id === taskId ? {
          ...t,
          status: 'running',
          speedDisplay: '容灾传输中...',
        } : t)));

        const MICRO_CHUNK = 4096;
        const microTotal = totalSize > 0 ? Math.ceil(totalSize / MICRO_CHUNK) : 1;
        let microLastTime = Date.now();
        let microLastBytes = 0;
        let microSpeedStr = '';

        for (let m = 0; m < microTotal; m++) {
          if (activeTasksRef.current[taskId]?.cancelled || abortController.signal.aborted) {
            delete activeTasksRef.current[taskId];
            return;
          }

          const mOffset = m * MICRO_CHUNK;
          const mLength = Math.min(MICRO_CHUNK, totalSize - mOffset);

          let mChunkData = '';
          if (totalSize > 0 && mLength > 0) {
            mChunkData = await FileSystem.readAsStringAsync(fileUri, {
              encoding: FileSystem.EncodingType.Base64,
              position: mOffset,
              length: mLength,
            });
          }

          const getChunkUrl = `${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=file_chunk` +
            `&path=${encodeURIComponent(taskItem.targetPath)}` +
            `&filename=${encodeURIComponent(taskItem.name)}` +
            `&chunk_index=${m}` +
            `&total_chunks=${microTotal}` +
            `&offset=${mOffset}` +
            `&total_size=${totalSize}` +
            `&data=${encodeURIComponent(mChunkData)}`;

          const getRes = await fetch(getChunkUrl, {
            method: 'GET',
            signal: abortController.signal,
          });

          const getText = await getRes.text();
          if (!getRes.ok || !getText || !getText.trim()) {
            throw new Error(`微分片上传异常 (HTTP ${getRes.status}): ${getText ? getText.slice(0, 100) : '服务端未响应'}`);
          }

          const getData = JSON.parse(getText);
          if (getData.status !== 'success') {
            throw new Error(getData.message || '微分片写入失败');
          }

          const currentBytes = mOffset + mLength;
          const now = Date.now();
          const timeDiff = (now - microLastTime) / 1000;
          if (timeDiff >= 0.35 || !microSpeedStr) {
            const bytesDiff = currentBytes - microLastBytes;
            if (timeDiff > 0 && bytesDiff > 0) {
              const currentSpeed = bytesDiff / timeDiff;
              microSpeedStr = `${formatBytesFixed(currentSpeed)}/s`;
            }
            microLastTime = now;
            microLastBytes = currentBytes;
          }

          const pct = totalSize > 0 ? Math.min(99, Math.round((currentBytes / totalSize) * 100)) : 100;

          setTransfers(prev => prev.map(t => {
            if (t.id === taskId) {
              return {
                ...t,
                status: 'running',
                chunkIndex: m + 1,
                progress: pct,
                transferredBytes: currentBytes,
                totalBytes: totalSize,
                sizeText: `${formatBytesFixed(currentBytes)} / ${formatBytesFixed(totalSize)}`,
                speedDisplay: microSpeedStr || '容灾中...',
              };
            }
            return t;
          }));
        }
      }

      delete activeTasksRef.current[taskId];

      if (tempLocalUri) {
        FileSystem.deleteAsync(tempLocalUri, { idempotent: true }).catch(() => {});
      }

      const savedPath = `${taskItem.targetPath}/${taskItem.name}`;
      setTransfers(prev => prev.map(t => (t.id === taskId ? {
        ...t,
        status: 'success',
        progress: 100,
        transferredBytes: totalSize,
        totalBytes: totalSize,
        sizeText: `${formatBytesFixed(totalSize)} / ${formatBytesFixed(totalSize)}`,
        speedDisplay: '已完成',
      } : t)));

      // Refresh directory list
      loadDirectory(cleanBaseUrl, apiToken, currentPath);
      showConfirm({
        type: 'success',
        title: '上传成功',
        message: `文件已成功写入 Unraid 存储：\n${savedPath}`,
        confirmText: '好的',
        showCancel: false,
      });
    } catch (err) {
      delete activeTasksRef.current[taskId];
      if (tempLocalUri) {
        FileSystem.deleteAsync(tempLocalUri, { idempotent: true }).catch(() => {});
      }

      const isCancelled = abortController.signal.aborted || err.name === 'AbortError' || (err.message && err.message.includes('abort'));
      if (isCancelled) {
        setTransfers(prev => prev.map(t => (t.id === taskId ? {
          ...t,
          status: 'paused',
          speedDisplay: '已暂停',
        } : t)));
      } else {
        setTransfers(prev => prev.map(t => (t.id === taskId ? {
          ...t,
          status: 'error',
          speedDisplay: '失败',
        } : t)));
        showConfirm({
          type: 'warning',
          title: '上传失败',
          message: err.message || '网络或服务端异常',
          confirmText: '知道了',
          showCancel: false,
        });
      }
    }
  };

  // Pause / Cancel active upload
  const pauseUploadTask = (taskId) => {
    const task = activeTasksRef.current[taskId];
    if (task) {
      task.cancelled = true;
      try {
        task.abortController.abort();
      } catch (_) {}
    }
    setTransfers(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          status: 'paused',
          speedDisplay: '已暂停',
        };
      }
      return t;
    }));
  };

  // Resume / Retry upload
  const resumeUploadTask = (taskItem) => {
    setTransfers(prev => prev.map(t => (t.id === taskItem.id ? {
      ...t,
      status: 'running',
      speedDisplay: '准备续传...',
    } : t)));
    startUploadTask(taskItem);
  };

  // Delete a single transfer record
  const deleteTransferRecord = (taskId) => {
    pauseUploadTask(taskId);
    setTransfers(prev => prev.filter(t => t.id !== taskId));
  };

  // Clear completed transfer records
  const clearCompletedTransfers = () => {
    setTransfers(prev => prev.filter(t => t.status !== 'success'));
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
      setTransfers(prev => [newTask, ...prev]);
      setIsTransferVisible(true);

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
      setTransfers(prev => prev.map(t => (t.id === taskId ? {
        ...t,
        status: 'success',
        progress: 100,
        transferredBytes: item.size || 0,
        totalBytes: item.size || 0,
        sizeText: `${formatBytesFixed(item.size || 0)} / ${formatBytesFixed(item.size || 0)}`,
        speedDisplay: '下载完成',
      } : t)));
    } catch (e) {
      console.log('[FilesScreen] Download error:', e);
      showConfirm({
        type: 'warning',
        title: '下载失败',
        message: e.message || '网络或存储权限异常',
        confirmText: '知道了',
        showCancel: false,
      });
      setTransfers(prev => prev.map(t => ((t.id === taskId || (t.name === item.name && t.status === 'running')) ? {
        ...t,
        status: 'error',
        speedDisplay: '下载中断',
      } : t)));
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

  // Hardware back button navigation (only active when Files tab is focused)
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
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
    }, [isConfigured, isAtRoot, goBack, previewItem, multiSelect, pickerVisible, renameItem, detailItem])
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
              <View style={[styles.detailIconBadge, { backgroundColor: detailItem?.isFolder ? 'rgba(59, 130, 246, 0.12)' : 'rgba(156, 163, 175, 0.12)' }]}>
                {detailItem?.isFolder ? (
                  <Folder color={colors.accent} size={30} />
                ) : (
                  <File color={colors.sub} size={30} />
                )}
              </View>
              <Text style={styles.detailName} numberOfLines={2}>{detailItem?.name}</Text>
            </View>

            <View style={styles.detailRows}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>类型</Text>
                <Text style={styles.detailValue}>{detailItem?.isFolder ? '文件夹' : '文件'}</Text>
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

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <TouchableOpacity
                style={styles.detailActionBtn}
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
                  style={styles.detailActionBtn}
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
                style={[styles.detailActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}
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