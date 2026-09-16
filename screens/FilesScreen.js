import React, { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, ScrollView, Modal, BackHandler,
  Pressable, RefreshControl, AppState,
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
import { apiFetch, apiFetchJson, resetNetworkPool } from '../utils/apiClient';
import { BUNDLED_API_VERSION, BUNDLED_API_CODE } from '../utils/bundledApi';

// Proactively and silently pushes bundled api.php to Unraid server if outdated
async function autoSyncServerApi(cleanBaseUrl, apiToken, serverApiVersionRef) {
  try {
    let srvVer = serverApiVersionRef?.current;
    if (!srvVer) {
      const vData = await apiFetchJson(`${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=version&_t=${Date.now()}`, {}, 3500, 0).catch(() => null);
      if (vData && (vData.api_version || vData.version)) {
        srvVer = vData.api_version || vData.version;
        if (serverApiVersionRef) serverApiVersionRef.current = srvVer;
      }
    }

    if (!srvVer || srvVer < BUNDLED_API_VERSION) {
      console.log(`[AutoSync] Server API (${srvVer || 'unknown'}) < bundled (${BUNDLED_API_VERSION}), pushing update...`);
      const pushRes = await apiFetch(`${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=update_api_file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-API-Token': apiToken,
        },
        body: BUNDLED_API_CODE,
      }, 12000, 0);

      const raw = await pushRes.text().catch(() => '');
      let pushJson = null;
      try { pushJson = JSON.parse(raw); } catch (_) {}
      if (pushJson && pushJson.status === 'success') {
        if (serverApiVersionRef) serverApiVersionRef.current = BUNDLED_API_VERSION;
        console.log(`[AutoSync] Successfully synced server api.php to ${BUNDLED_API_VERSION}`);
        return true;
      }
    }
  } catch (err) {
    console.log('[AutoSync] Non-blocking push error:', err);
  }
  return false;
}

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
    cancelText: '鍙栨秷',
    showCancel: true,
    onConfirm: null,
  });

  const showConfirm = ({
    type = 'info',
    title,
    message,
    confirmText,
    cancelText = '鍙栨秷',
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
  const activeTasksRef = useRef({}); // taskId -> FileSystem.UploadTask or XHR
  const isPickingFileRef = useRef(false);
  const serverApiVersionRef = useRef('');

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
        speedDisplay: t.status === 'running' ? '宸叉殏鍋? : (t.speedDisplay || ''),
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
              speedDisplay: t.status === 'running' ? '宸叉殏鍋?(鍙户缁?' : (t.speedDisplay || ''),
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



  /**
   * 馃挕 Real-Time Sync on Screen Focus:
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
      const data = await apiFetchJson(url, {}, 9000, 1);

      if (data.status === 'success') {

        if (data.api_version) {
          serverApiVersionRef.current = data.api_version;
          if (data.api_version < '2026.09.16.04') {
            autoSyncServerApi(cleanUrl, token, serverApiVersionRef);
          }
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
        Alert.alert('璇诲彇鐩綍澶辫触', data.message || '鏈嶅姟鍣ㄦ嫆缁濊闂?);
      }
    } catch (e) {
      console.log('[FilesScreen] loadDirectory error:', e);
      Alert.alert('缃戠粶寮傚父', '鏃犳硶杩炴帴鍒?Unraid 鏈嶅姟鍣ㄦ枃浠舵ā鍧楋紝璇锋鏌ョ綉缁滄垨浠ｇ悊');
    } finally {
      setIsLoadingList(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        resetNetworkPool();
        if (serverUrl && apiToken && !isPickingFileRef.current) {
          setTimeout(() => {
            loadDirectory(serverUrl, apiToken, currentPath || DEFAULT_ROOT);
          }, 300);
        }
      }
    });
    return () => {
      sub.remove();
    };
  }, [serverUrl, apiToken, currentPath]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    resetNetworkPool();
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
  // Advanced Upload Task Manager (Complete Refactored Version)
  // =========================================================================
  const handleUpload = () => {
    setIsMenuVisible(false);

    if (currentPath === '/mnt' || currentPath === DEFAULT_ROOT) {
      showConfirm({
        type: 'warning',
        title: '鏃犳硶鐩存帴涓婁紶鍒板叡浜牴鐩綍',
        message: 'Unraid 鏍圭洰褰曚笉鍏佽鐩存帴瀛樻斁鏁ｈ鏂囦欢銆傝鍏堣繘鍏ュ叿浣撶殑鍏变韩鏂囦欢澶癸紙渚嬪 downloads銆乤ppdata 绛夛級鍚庡啀鐐瑰嚮涓婁紶銆?,
        confirmText: '鎴戠煡閬撲簡',
        showCancel: false,
      });
      return;
    }

    // 250ms debounce
    isPickingFileRef.current = true;
    setTimeout(async () => {
      try {
        const result = await DocumentPicker.getDocumentAsync({
          type: '*/*',
          copyToCacheDirectory: false, // <-- Crucial FIX for OOM crash! Do not copy large files into cache. Use content:// URI directly.
          multiple: false,
        });

        if (result.canceled || !result.assets || result.assets.length === 0) {
          return;
        }

        const file = result.assets[0];
        const fileUri = file.uri;
        let chosenName = file.name;
        if (!chosenName || chosenName === 'undefined') {
          const u = fileUri || '';
          const slash = u.lastIndexOf('/');
          chosenName = slash >= 0 ? decodeURIComponent(u.substring(slash + 1)) : ('upload_' + Date.now());
        }

        const taskId = 'up_' + Date.now();
        const newTask = {
          id: taskId,
          name: chosenName,
          uri: fileUri,
          size: file.size || 0,
          targetPath: currentPath,
          type: '涓婁紶',
          status: 'running',
          progress: 0,
          transferredBytes: 0,
          totalBytes: file.size || 0,
          sizeText: `0.0 B / ${formatBytesFixed(file.size || 0)}`,
          speedDisplay: '姝ｅ湪杩炴帴浼犺緭...',
          chunkIndex: 0,
        };

        setTransfers(prev => {
          const next = [newTask, ...prev];
          saveTransfersQueue(next);
          return next;
        });

        startUploadTask(newTask);

        setTimeout(() => {
          setIsTransferVisible(true);
        }, 500);
      } catch (e) {
        console.log('[Upload] DocumentPicker error:', e);
        showConfirm({
          type: 'warning',
          title: '閫夋嫨鏂囦欢寮傚父',
          message: e.message || '鎵撳紑鏂囦欢閫夋嫨鍣ㄥけ璐?,
          confirmText: '鐭ラ亾浜?,
          showCancel: false,
        });
      } finally {
        setTimeout(() => {
          isPickingFileRef.current = false;
        }, 1500);
      }
    }, 250);
  };

  const startUploadTask = async (taskItem) => {
    const taskId = taskItem.id;
    const abortController = new AbortController();
    activeTasksRef.current[taskId] = { abortController, cancelled: false };

    try {
      await backgroundTransferManager.notifyTransferStarted(taskItem);
    } catch (_) {}

    const workingUriOriginal = taskItem.uri;
    const tempChunkUri = FileSystem.cacheDirectory + `chunk_${taskId}.tmp`;
    const tempSourceUri = FileSystem.cacheDirectory + `source_${taskId}.tmp`;
    let workingUri = workingUriOriginal;
    let usingTempSource = false;

    try {
      // expo-file-system's readAsStringAsync does not support content:// URIs directly.
      // We safely buffer it to a local file streamingly (which doesn't cause OOM).
      if (workingUriOriginal.startsWith('content://')) {
        setTransfers(prev => prev.map(t => (t.id === taskId ? {
          ...t,
          status: 'running',
          speedDisplay: '姝ｅ湪缂撳啿娴?..',
        } : t)));
        try {
          await FileSystem.copyAsync({ from: workingUriOriginal, to: tempSourceUri });
          workingUri = tempSourceUri;
          usingTempSource = true;
        } catch (copyErr) {
          throw new Error('鏃犳硶璇诲彇绯荤粺鏂囦欢锛岃妫€鏌ュ瓨鍌ㄦ潈闄愭垨鏇存崲閫夋嫨鍣? ' + copyErr.message);
        }
      }

      let totalSize = taskItem.size || 0;
      try {
        const fileInfo = await FileSystem.getInfoAsync(workingUri);
        if (fileInfo && fileInfo.exists && fileInfo.size !== undefined && fileInfo.size !== null) {
          totalSize = fileInfo.size;
        }
      } catch (_) {}

      const cleanBaseUrl = (serverUrl || '').replace(/\/+$/, '');
      await autoSyncServerApi(cleanBaseUrl, apiToken, serverApiVersionRef);

      setTransfers(prev => prev.map(t => (t.id === taskId ? {
        ...t,
        status: 'running',
        speedDisplay: '姝ｅ湪杩炴帴浼犺緭...',
      } : t)));

      // 1MB Chunk Engine: use MULTIPART for absolute proxy/WAF bypass and native OkHttp performance
      const CHUNK_SIZE = 1024 * 1024; // 1MB chunks (faster natively)
      const totalChunks = totalSize > 0 ? Math.ceil(totalSize / CHUNK_SIZE) : 1;
      let startChunk = Number(taskItem.chunkIndex) || 0;
      if (startChunk >= totalChunks) startChunk = 0;

      let lastTime = Date.now();
      let lastLoaded = startChunk * CHUNK_SIZE;
      let smoothedSpeed = 0;
      let finalServerResult = null;
      let savedPath = `${taskItem.targetPath}/${taskItem.name}`;

      for (let i = startChunk; i < totalChunks; i++) {
        if (abortController.signal.aborted || activeTasksRef.current[taskId]?.cancelled) {
          return;
        }

        const offset = i * CHUNK_SIZE;
        const currentChunkLen = totalSize > 0 ? Math.min(CHUNK_SIZE, totalSize - offset) : 0;

        // Extract chunk to a temporary binary file to feed natively into Expo uploadAsync
        if (currentChunkLen > 0) {
          const base64Data = await FileSystem.readAsStringAsync(workingUri, {
            encoding: FileSystem.EncodingType.Base64,
            position: offset,
            length: currentChunkLen,
          });
          await FileSystem.writeAsStringAsync(tempChunkUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } else {
          await FileSystem.writeAsStringAsync(tempChunkUri, '', { encoding: FileSystem.EncodingType.UTF8 });
        }

        const chunkUrl = `${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=file_chunk`;
        let chunkSuccess = false;
        let serverChunkRes = null;

        for (let retry = 0; retry < 3; retry++) {
          if (abortController.signal.aborted || activeTasksRef.current[taskId]?.cancelled) {
            return;
          }
          try {
            // Using FileSystem.uploadAsync with BINARY_CONTENT acts as a raw data stream, 
            // bypassing all WAF JSON payload inspections and Multipart parsing issues.
            // All metadata is safely encoded in HTTP headers.
            const uploadTask = FileSystem.createUploadTask(
              chunkUrl,
              tempChunkUri,
              {
                uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
                headers: {
                  'X-API-Token': apiToken,
                  'X-Chunk-Path': encodeURIComponent(taskItem.targetPath),
                  'X-Chunk-Filename': encodeURIComponent(taskItem.name),
                  'X-Chunk-Index': i.toString(),
                  'X-Chunk-Total': totalChunks.toString(),
                  'X-Chunk-Offset': offset.toString(),
                  'X-Chunk-Size': totalSize.toString(),
                  'Content-Type': 'application/octet-stream'
                }
              }
            );

            // Hook uploadTask to activeTasksRef for cancellation support
            activeTasksRef.current[taskId].uploadTask = uploadTask;
            const res = await uploadTask.uploadAsync();
            activeTasksRef.current[taskId].uploadTask = null;

            const rawText = (res.body || '').trim();
            let resJson = null;
            if (rawText) {
              try {
                resJson = JSON.parse(rawText);
              } catch (_) {
                const sIdx = rawText.indexOf('{');
                const eIdx = rawText.lastIndexOf('}');
                if (sIdx !== -1 && eIdx > sIdx) {
                  try {
                    resJson = JSON.parse(rawText.substring(sIdx, eIdx + 1));
                  } catch (_) {}
                }
              }
            }
            }

            if (res.status === 200 && resJson && resJson.status === 'success') {
              chunkSuccess = true;
              serverChunkRes = resJson;
              if (resJson.path) savedPath = resJson.path;
              break;
            } else {
              // Same empty response fallback check
              if (res.status === 200 && (!resJson || resJson.status !== 'success')) {
                try {
                  const dbgRes = await apiFetchJson(`${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=upload_debug&_t=${Date.now()}`, {}, 4000, 0).catch(() => null);
                  if (dbgRes && dbgRes.log) {
                    const cleanItemName = (taskItem.name || '').replace(/.*[\/\\]/, '');
                    const hasOk = dbgRes.log.includes(`chunk=${i}/${totalChunks}`) ||
                                  dbgRes.log.includes(`chunk_ok: file=${cleanItemName}`);
                    if (hasOk) {
                      chunkSuccess = true;
                      serverChunkRes = { status: 'success', verified_via_debug_log: true };
                      break;
                    }
                  }
                } catch (_) {}
              }

              const preview = rawText ? (rawText.length > 120 ? rawText.substring(0, 120) + '...' : rawText) : '绌哄搷搴?(0瀛楄妭)';
              let errorMsg = resJson?.message || preview;

              if (preview.includes('鏈煡鎿嶄綔') || errorMsg.includes('鏈煡鎿嶄綔') || errorMsg.includes('Unknown action')) {
                await autoSyncServerApi(cleanBaseUrl, apiToken, serverApiVersionRef);
                errorMsg = '宸茶嚜鍔ㄦ帹閫佹渶鏂版湇鍔＄ API 鑴氭湰锛屾鍦ㄩ噸璇?..';
              }

              if (resJson && resJson.status === 'error') {
                throw new Error(errorMsg || `鏈嶅姟绔垎鐗囧啓鍏ュけ璐?(HTTP ${res.status})`);
              }

              if (attempt === 2) {
                let diagInfo = '';
                try {
                  const dbgRes = await apiFetchJson(`${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=upload_debug&_t=${Date.now()}`, {}, 4000, 0).catch(() => null);
                  if (dbgRes) {
                    const lastLines = (dbgRes.log || '').split('\n').filter(Boolean).slice(-8).join(' | ');
                    const sVer = dbgRes.api_version || dbgRes.version || serverApiVersionRef.current || '鏈煡';
                    diagInfo = `\n[鏈嶅姟绔疉PI鐗堟湰: ${sVer}]\n[鏈嶅姟绔姸鎬? ${lastLines || '鏃犳棩蹇?}]`;
                  }
                } catch (_) {}

                throw new Error(`鍒嗙墖 ${i + 1}/${totalChunks} 鍐欏叆澶辫触 (HTTP ${res?.status || 'Unknown'}): ${errorMsg}${diagInfo}`);
              }
              await new Promise(r => setTimeout(r, 1200));
            }
          } catch (chunkErr) {
            if (abortController.signal.aborted || activeTasksRef.current[taskId]?.cancelled) {
              return;
            }
            if (attempt === 2) {
              throw chunkErr;
            }
            await new Promise(r => setTimeout(r, 1200));
          }
        }

        if (!chunkSuccess) {
          if (abortController.signal.aborted || activeTasksRef.current[taskId]?.cancelled) {
            return;
          }
          throw new Error(`鍒嗙墖 ${i + 1}/${totalChunks} 涓婁紶澶辫触锛岃妫€鏌ョ綉缁滆繛鎺);
        }

        finalServerResult = serverChunkRes;

        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        const currentTransferred = Math.min(totalSize, offset + currentChunkLen);
        if (dt >= 0.4) {
          const bytesDiff = currentTransferred - lastLoaded;
          const instSpeed = Math.max(0, bytesDiff / dt);
          smoothedSpeed = smoothedSpeed > 0 ? (smoothedSpeed * 0.6 + instSpeed * 0.4) : instSpeed;
          lastTime = now;
          lastLoaded = currentTransferred;
        }

        const isLastChunk = (i + 1 >= totalChunks);
        const pct = isLastChunk ? 100 : Math.min(99, Math.round((currentTransferred / Math.max(1, totalSize)) * 100));

        setTransfers(prev => {
          const next = prev.map(t => (t.id === taskId ? {
            ...t,
            status: isLastChunk ? 'success' : 'running',
            progress: pct,
            transferredBytes: isLastChunk ? totalSize : currentTransferred,
            totalBytes: totalSize,
            sizeText: `${formatBytesFixed(isLastChunk ? totalSize : currentTransferred)} / ${formatBytesFixed(totalSize)}`,
            speedDisplay: isLastChunk ? '宸插畬鎴? : (smoothedSpeed > 0 ? `${formatBytesFixed(smoothedSpeed)}/s` : '姝ｅ湪浼犺緭...'),
            chunkIndex: isLastChunk ? 0 : (i + 1),
          } : t));
          if (isLastChunk || i % 5 === 0) {
            saveTransfersQueue(next);
          }
          return next;
        });
      }

      // Cleanup temp chunk file
      try {
        await FileSystem.deleteAsync(tempChunkUri, { idempotent: true });
      } catch (_) {}
      if (usingTempSource) {
        try {
          await FileSystem.deleteAsync(tempSourceUri, { idempotent: true });
        } catch (_) {}
      }

      if (!finalServerResult || finalServerResult.status !== 'success') {
        throw new Error(finalServerResult?.message || '鏂囦欢钀界洏纭澶辫触锛岃閲嶈瘯');
      }

      delete activeTasksRef.current[taskId];

      // Mark success in transfer list
      setTransfers(prev => {
        const next = prev.map(t => (t.id === taskId ? {
          ...t,
          status: 'success',
          progress: 100,
          transferredBytes: totalSize,
          totalBytes: totalSize,
          sizeText: `${formatBytesFixed(totalSize)} / ${formatBytesFixed(totalSize)}`,
          speedDisplay: '宸插畬鎴?,
          chunkIndex: 0,
        } : t));
        saveTransfersQueue(next);
        return next;
      });

      // Directly refresh file list of current directory
      const dirToReload = taskItem.targetPath || currentPath;
      await loadDirectory(cleanBaseUrl, apiToken, dirToReload);

      try {
        await backgroundTransferManager.notifyTransferEnded(taskId, 'success', {
          name: taskItem.name,
          sizeText: formatBytesFixed(totalSize),
        });
      } catch (_) {}

      showConfirm({
        type: 'success',
        title: '涓婁紶鎴愬姛',
        message: `鏂囦欢 "${taskItem.name}" 宸叉垚鍔熶笂浼犺嚦 Unraid 瀛樺偍锛歕n${savedPath}`,
        confirmText: '濂界殑',
        showCancel: false,
      });

    } catch (err) {
      delete activeTasksRef.current[taskId];

      // Cleanup temp chunks on error/cancel
      try {
        await FileSystem.deleteAsync(tempChunkUri, { idempotent: true });
      } catch (_) {}
      if (usingTempSource) {
        try {
          await FileSystem.deleteAsync(tempSourceUri, { idempotent: true });
        } catch (_) {}
      }

      const isCancelled = abortController.signal.aborted || (activeTasksRef.current[taskId]?.cancelled) || err.name === 'AbortError' || (err.message && err.message.includes('abort'));

      try {
        await backgroundTransferManager.notifyTransferEnded(taskId, isCancelled ? 'paused' : 'error', {
          name: taskItem.name,
        });
      } catch (_) {}

      if (isCancelled) {
        setTransfers(prev => {
          const next = prev.map(t => (t.id === taskId ? {
            ...t,
            status: 'paused',
            speedDisplay: '宸叉殏鍋?,
          } : t));
          saveTransfersQueue(next);
          return next;
        });
      } else {
        setTransfers(prev => {
          const next = prev.map(t => (t.id === taskId ? {
            ...t,
            status: 'error',
            speedDisplay: '澶辫触',
          } : t));
          saveTransfersQueue(next);
          return next;
        });

        showConfirm({
          type: 'warning',
          title: '涓婁紶澶辫触',
          message: err.message || '缃戠粶涓柇鎴栨湇鍔＄鏈搷搴?,
          confirmText: '鐭ラ亾浜?,
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
        if (task.abortController) {
          try {
            task.abortController.abort();
          } catch (_) {}
        }
        if (task.uploadTask && typeof task.uploadTask.cancelAsync === 'function') {
          try {
            task.uploadTask.cancelAsync();
          } catch (_) {}
        }
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
            speedDisplay: '宸叉殏鍋?鍙画浼?',
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
        speedDisplay: (latestItem.chunkIndex && latestItem.chunkIndex > 0) ? '鏂偣缁紶涓?..' : '鍑嗗缁紶...',
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
        const delUri = itemToDelete?.cachedUri || itemToDelete?.uri;
        if (delUri && FileSystem?.cacheDirectory && delUri.startsWith(FileSystem.cacheDirectory + 'up_')) {
          FileSystem.deleteAsync(delUri, { idempotent: true }).catch(() => {});
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
        type: '涓嬭浇',
        status: 'running',
        progress: 0,
        transferredBytes: 0,
        totalBytes: item.size || 0,
        sizeText: `${formatBytesFixed(0)} / ${formatBytesFixed(item.size || 0)}`,
        speedDisplay: '姝ｅ湪涓嬭浇...',
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
          speedDisplay: '涓嬭浇瀹屾垚',
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
        title: '涓嬭浇澶辫触',
        message: e.message || '缃戠粶鎴栧瓨鍌ㄦ潈闄愬紓甯?,
        confirmText: '鐭ラ亾浜?,
        showCancel: false,
      });
      setTransfers(prev => {
        const next = prev.map(t => ((t.id === taskId || (t.name === item.name && t.status === 'running')) ? {
          ...t,
          status: 'error',
          speedDisplay: '涓嬭浇涓柇',
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
        title: '鎻愮ず',
        message: '璇烽€夋嫨瑕佷笅杞界殑鏂囦欢锛堟枃浠跺す鏆備笉鏀寔鎵归噺鎵撳寘涓嬭浇锛?,
        confirmText: '濂界殑',
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
        Alert.alert('鍒涘缓澶辫触', data.message || '鏈嶅姟鍣ㄦ嫆缁濆垱寤?);
      }
    } catch (e) {
      Alert.alert('寮傚父', e.message);
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
        Alert.alert('閲嶅懡鍚嶅け璐?, data.message || '鏈嶅姟鍣ㄦ嫆缁?);
      }
    } catch (e) {
      Alert.alert('寮傚父', e.message);
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
      title: '纭鍒犻櫎',
      message: `纭畾褰诲簳鍒犻櫎 ${item.isFolder ? '鏂囦欢澶? : '鏂囦欢'} \n"${item.name}" 鍚楋紵\n姝ゆ搷浣滀笉鍙挙閿€锛乣,
      confirmText: '褰诲簳鍒犻櫎',
      onConfirm: async () => {
        const ok = await doDelete(item);
        if (ok) {
          setDetailItem(null);
          loadDirectory(serverUrl, apiToken, currentPath);
        } else {
          showConfirm({
            type: 'warning',
            title: '鍒犻櫎澶辫触',
            message: '鏈嶅姟鍣ㄦ嫆缁濆垹闄わ紝璇锋鏌ユ搷浣滄潈闄愩€?,
            confirmText: '鐭ラ亾浜?,
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
      title: '鎵归噺鍒犻櫎纭',
      message: `纭畾瑕佸交搴曞垹闄ら€変腑鐨?${items.length} 涓」鐩悧锛焅n姝ゆ搷浣滀笉鍙仮澶嶏紒`,
      confirmText: '鍏ㄩ儴鍒犻櫎',
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
      title: '鎿嶄綔瀹屾垚',
      message: `宸叉垚鍔熷皢 ${count} 涓」鐩?{pickerMode === 'move' ? '绉诲姩' : '澶嶅埗'}鑷崇洰鏍囩洰褰曘€俙,
      confirmText: '濂界殑',
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
        const preview = resText ? (resText.length > 200 ? resText.slice(0, 200) + '...' : resText) : '锛堟湇鍔＄杩斿洖绌哄唴瀹癸級';
        showConfirm({
          type: 'danger',
          title: '瑙ｅ帇寮傚父',
          message: `鏈嶅姟绔湭杩斿洖鏈夋晥鐨?JSON 鏁版嵁 (HTTP ${res.status || '鏈煡'})銆俓n\n鏈嶅姟绔師濮嬭繑鍥烇細\n${preview}\n\n銆愭帓鏌ユ彁绀恒€戯細璇风‘璁?Unraid 鏈嶅姟鍣ㄤ笂鐨?/usr/local/emhttp/api.php 宸插悓姝ユ浛鎹负鏈€鏂扮増鏈紒`,
          confirmText: '鐭ラ亾浜?,
          showCancel: false,
        });
        return;
      }

      if (data.status === 'success') {
        const targetDesc = data.target || currentPath;
        setExtractItem(null);
        showConfirm({
          type: 'success',
          title: '瑙ｅ帇鎴愬姛',
          message: `宸叉垚鍔熷湪鏈嶅姟绔В鍘?"${extractItem.name}"\n淇濆瓨鑷筹細${targetDesc}`,
          confirmText: '濂界殑',
          showCancel: false,
        });
        loadDirectory(serverUrl, apiToken, currentPath);
      } else {
        showConfirm({
          type: 'danger',
          title: '瑙ｅ帇澶辫触',
          message: data.message || '鏈嶅姟绔В鍘嬪け璐ワ紝璇风‘璁ゆ湇鍔＄鐜鏄惁鏀寔瀵瑰簲鏍煎紡銆?,
          confirmText: '鐭ラ亾浜?,
          showCancel: false,
        });
      }
    } catch (e) {
      setIsExtracting(false);
      showConfirm({
        type: 'danger',
        title: '瑙ｅ帇寮傚父',
        message: e.message || '缃戠粶杩炴帴瓒呮椂鎴栨湇鍔″櫒寮傚父',
        confirmText: '鐭ラ亾浜?,
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

      // Prepare GET query (Unraid emhttp handles GET without POST chunking or FastCGI body drop)
      const getQuery = `token=${encodeURIComponent(apiToken)}&action=file_compress&target_dir=${encodeURIComponent(currentPath)}&zip_name=${encodeURIComponent(name)}&sources=${encodeURIComponent(JSON.stringify(sourcePaths))}`;
      let res;
      if (getQuery.length < 3500) {
        res = await fetch(`${cleanBaseUrl}/api.php?${getQuery}`);
      } else {
        const postUrl = `${cleanBaseUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=file_compress`;
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
        const preview = resText ? (resText.length > 200 ? resText.slice(0, 200) + '...' : resText) : '锛堟湇鍔＄杩斿洖绌哄唴瀹癸級';
        showConfirm({
          type: 'danger',
          title: '鍘嬬缉鎵撳寘寮傚父',
          message: `鏈嶅姟绔湭杩斿洖鏈夋晥鐨?JSON 鏁版嵁 (HTTP ${res?.status || '鏈煡'})銆俓n\n鏈嶅姟绔師濮嬭繑鍥烇細\n${preview}\n\n銆愭帓鏌ユ寚寮曘€戯細\n璇风‘璁ゅ凡鎵ц缁堢鍛戒护灏嗚剼鏈悓姝ヨ嚦杩愯鐩綍锛歕ncp /boot/api.php /usr/local/emhttp/api.php\nchmod 755 /usr/local/emhttp/api.php`,
          confirmText: '鐭ラ亾浜?,
          showCancel: false,
        });
        return;
      }

      if (data.status === 'success') {
        setCompressVisible(false);
        exitMultiSelect();
        showConfirm({
          type: 'success',
          title: '鎵撳寘瀹屾垚',
          message: `宸叉垚鍔熷湪鏈嶅姟绔敓鎴愬帇缂╁寘锛歕n"${data.zip_name || name}"`,
          confirmText: '濂界殑',
          showCancel: false,
        });
        loadDirectory(serverUrl, apiToken, currentPath);
      } else {
        showConfirm({
          type: 'danger',
          title: '鎵撳寘澶辫触',
          message: data.message || '鏈嶅姟绔墦鍖呭け璐ワ紝璇锋鏌ョ鐩樼┖闂存垨鍐欏叆鏉冮檺銆?,
          confirmText: '鐭ラ亾浜?,
          showCancel: false,
        });
      }
    } catch (e) {
      setIsCompressing(false);
      showConfirm({
        type: 'danger',
        title: '鎵撳寘寮傚父',
        message: e.message || '缃戠粶杩炴帴瓒呮椂鎴栨湇鍔″櫒寮傚父',
        confirmText: '鐭ラ亾浜?,
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
      navigation.setOptions({ title: 'Unraid 鏂囦欢搴?, headerLeft: null, headerRight: null });
      return;
    }

    const pathSegments = currentPath.split('/').filter(Boolean);
    const titleName = isAtRoot ? '鏍瑰叡浜簱 (/mnt/user)' : decodeURIComponent(pathSegments[pathSegments.length - 1] || '鏂囦欢');

    if (multiSelect) {
      navigation.setOptions({
        title: `宸查€?${selected.size} 椤筦,
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
          <Text style={styles.setupTitle}>鏈繛鎺?Unraid 鏈嶅姟鍣?/Text>
          <Text style={styles.setupSub}>
            鏂囦欢绠＄悊鐩存帴鎺ュ叆 Unraid 缁熶竴 API 鏍稿績锛屾棤闇€鎼缓绻佺悙鐨?WebDAV 鏈嶅姟銆傝鍏堝湪銆岃缃€嶉〉閰嶇疆鏈嶅姟鍣ㄥ湴鍧€涓?API Token銆?          </Text>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => navigation.navigate('璁剧疆')}
          >
            <Settings color="#ffffff" size={18} style={{ marginRight: 8 }} />
            <Text style={styles.saveBtnText}>鍓嶅線璁剧疆杩炴帴</Text>
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
            placeholder="鎼滅储褰撳墠鐩綍..."
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
            {sortBy === 'name' ? '鍚嶇О' : sortBy === 'date' ? '鏃堕棿' : '澶у皬'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* File List */}
      {isLoadingList && !isRefreshing ? (
        <View style={styles.listCenter}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.emptyText, { marginTop: 12 }]}>姝ｅ湪鍔犺浇鏂囦欢鍒楄〃...</Text>
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
              <Text style={styles.emptyText}>褰撳墠鐩綍鏃犲唴瀹癸紝涓嬫媺鍙埛鏂?/Text>
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
                        {item.isFolder ? '鏂囦欢澶? : formatBytes(item.size)}
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
            <Text style={styles.bottomBarCount}>宸查€?{selected.size} 椤?/Text>
            <TouchableOpacity onPress={toggleSelectAll}>
              <Text style={styles.bottomBarSelectAll}>
                {selected.size === filteredFiles.length ? '鍙栨秷鍏ㄩ€? : '鍏ㄩ€?}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bottomBarBtns}>
            <TouchableOpacity style={styles.bottomBarBtn} onPress={handleBatchDownload}>
              <Download color={colors.accent} size={22} />
              <Text style={styles.bottomBarBtnText}>涓嬭浇</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.bottomBarBtn} onPress={handleBatchDelete}>
              <Trash2 color={colors.red} size={22} />
              <Text style={[styles.bottomBarBtnText, { color: colors.red }]}>鍒犻櫎</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bottomBarBtn}
              onPress={() => openPicker('move', fileList.filter(f => selected.has(f.path)))}
            >
              <MoveRight color={colors.accent} size={22} />
              <Text style={styles.bottomBarBtnText}>绉诲姩</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bottomBarBtn}
              onPress={() => openPicker('copy', fileList.filter(f => selected.has(f.path)))}
            >
              <Copy color={colors.accent} size={22} />
              <Text style={styles.bottomBarBtnText}>澶嶅埗</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bottomBarBtn}
              onPress={handleBatchCompress}
            >
              <Archive color={colors.green} size={22} />
              <Text style={[styles.bottomBarBtnText, { color: colors.green }]}>鍘嬬缉</Text>
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
                <Text style={styles.bottomBarBtnText}>璇︽儏</Text>
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

      {/* Dropdown Menu (Top-Right Plus) - rendered as in-screen overlay to avoid Dialog WindowManager crash */}
      {isMenuVisible && (
        <View style={styles.menuOverlayContainer} pointerEvents="box-none">
          <Pressable style={styles.menuBackdrop} onPress={() => setIsMenuVisible(false)} />
          <View style={styles.dropdownMenu}>
            <TouchableOpacity style={styles.menuItem} onPress={handleUpload}>
              <UploadCloud color={colors.text} size={20} />
              <Text style={styles.menuText}>涓婁紶鏂囦欢</Text>
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
              <Text style={styles.menuText}>鏂板缓鏂囦欢澶?/Text>
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
              <Text style={styles.menuText}>鍒锋柊鐩綍</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Create Folder Modal */}
      <Modal visible={mkdirVisible} transparent animationType="fade" onRequestClose={() => setMkdirVisible(false)}>
        <KeyboardAvoidingView style={styles.dialogOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMkdirVisible(false)} />
          <View style={styles.dialogCard}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
              <FolderPlus color={colors.accent} size={28} />
            </View>
            <Text style={styles.dialogTitle}>鏂板缓鏂囦欢澶?/Text>
            <Text style={styles.dialogSub}>鍦ㄥ綋鍓嶈矾寰勪笅鍒涘缓涓€涓柊鐨勫瓙鐩綍</Text>
            <TextInput
              style={styles.dialogInput}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
              placeholder="璇疯緭鍏ユ枃浠跺す鍚嶇О"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity style={[styles.dialogBtn, styles.dialogCancelBtn]} onPress={() => setMkdirVisible(false)}>
                <Text style={styles.dialogCancelText}>鍙栨秷</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dialogBtn, styles.dialogConfirmBtn]} onPress={confirmCreateFolder}>
                <Text style={styles.dialogConfirmText}>鍒涘缓</Text>
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
            <Text style={styles.dialogTitle}>閲嶅懡鍚?/Text>
            <Text style={styles.dialogSub}>淇敼鏂囦欢鎴栨枃浠跺す鐨勫悕绉?/Text>
            <TextInput
              style={styles.dialogInput}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              selectTextOnFocus
              placeholder="杈撳叆鏂板悕绉?
              placeholderTextColor={colors.muted}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity style={[styles.dialogBtn, styles.dialogCancelBtn]} onPress={() => setRenameItem(null)}>
                <Text style={styles.dialogCancelText}>鍙栨秷</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dialogBtn, styles.dialogConfirmBtn]} onPress={confirmRename}>
                <Text style={styles.dialogConfirmText}>淇濆瓨</Text>
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
                <Text style={styles.detailLabel}>绫诲瀷</Text>
                <Text style={styles.detailValue}>
                  {detailItem?.isFolder ? '鏂囦欢澶? : isArchiveFile(detailItem?.name) ? '鍘嬬缉褰掓。鏂囦欢' : '鏂囦欢'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>澶у皬</Text>
                <Text style={styles.detailValue}>{detailItem?.isFolder ? '-' : formatBytes(detailItem?.size)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>淇敼鏃堕棿</Text>
                <Text style={styles.detailValue}>{detailItem?.mtime || '鏈煡'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>瀹屾暣璺緞</Text>
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
                  <Text style={[styles.detailActionText, { color: colors.green }]}>鏈嶅姟绔В鍘?/Text>
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
                <Text style={styles.detailActionText}>閲嶅懡鍚?/Text>
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
                  <Text style={styles.detailActionText}>涓嬭浇</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.detailActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }, isArchiveFile(detailItem?.name) ? { flex: 1, minWidth: '45%' } : {}]}
                onPress={() => handleDelete(detailItem)}
              >
                <Trash2 color={colors.red} size={18} style={{ marginRight: 6 }} />
                <Text style={[styles.detailActionText, { color: colors.red }]}>鍒犻櫎</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.actionSheetCancel} onPress={() => setDetailItem(null)}>
              <Text style={styles.actionSheetCancelText}>鍏抽棴</Text>
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
            <Text style={styles.dialogTitle}>鏈嶅姟绔湪绾胯В鍘?/Text>
            <Text style={styles.dialogSub}>鐢?Unraid 鏈嶅姟鍣ㄥ師鐢熸瀬閫熻В鍘嬶紝鏃犻渶鑰楄垂鎵嬫満娴侀噺</Text>

            <View style={{ backgroundColor: colors.surface, padding: 12, borderRadius: 10, marginVertical: 12, width: '100%' }}>
              <Text style={{ fontSize: 13, color: colors.sub, marginBottom: 4 }}>寰呰В鍘嬪綊妗ｏ細</Text>
              <Text style={{ fontSize: 14, color: colors.textStrong, fontWeight: '600' }} numberOfLines={1}>{extractItem?.name}</Text>
              <Text style={{ fontSize: 13, color: colors.sub, marginTop: 8, marginBottom: 4 }}>瑙ｅ帇鐩爣鐩綍锛?/Text>
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
              <Text style={{ fontSize: 14, color: colors.textStrong }}>瑙ｅ帇鑷虫柊寤哄悓鍚嶅瓙鏂囦欢澶?/Text>
            </TouchableOpacity>

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogCancelBtn]}
                onPress={() => setExtractItem(null)}
                disabled={isExtracting}
              >
                <Text style={styles.dialogCancelText}>鍙栨秷</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, { backgroundColor: colors.green }]}
                onPress={confirmExtractArchive}
                disabled={isExtracting}
              >
                {isExtracting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.dialogConfirmText}>绔嬪嵆瑙ｅ帇</Text>
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
            <Text style={styles.dialogTitle}>鏈嶅姟绔墦鍖呭帇缂?(Zip)</Text>
            <Text style={styles.dialogSub}>宸查€?{selected.size} 涓」鐩紝灏嗗湪 Unraid 鏈嶅姟鍣ㄧ洿鎺ユ墦鍖?/Text>

            <TextInput
              style={[styles.dialogInput, { marginTop: 12 }]}
              value={compressZipName}
              onChangeText={setCompressZipName}
              placeholder="璇疯緭鍏ュ帇缂╁寘鏂囦欢鍚?(濡?archive.zip)"
              placeholderTextColor={colors.muted}
              editable={!isCompressing}
            />

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogCancelBtn]}
                onPress={() => setCompressVisible(false)}
                disabled={isCompressing}
              >
                <Text style={styles.dialogCancelText}>鍙栨秷</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogConfirmBtn]}
                onPress={confirmBatchCompress}
                disabled={isCompressing}
              >
                {isCompressing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.dialogConfirmText}>寮€濮嬫墦鍖?/Text>
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
              <Text style={styles.pickerUpText}>涓婄骇</Text>
            </TouchableOpacity>
            <Text style={styles.pickerTitle}>{pickerMode === 'move' ? '绉诲姩鍒? : '澶嶅埗鍒?}锛?/Text>
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
                <Text style={styles.pickerFolderName}>杩斿洖涓婁竴绾?/Text>
              </TouchableOpacity>
              {pickerFolders.length === 0 ? (
                <View style={styles.listCenter}><Text style={styles.emptyText}>鏃犲瓙鏂囦欢澶?/Text></View>
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
              <Text style={styles.pickerConfirmText}>纭{pickerMode === 'move' ? '绉诲姩' : '澶嶅埗'}鍒版鐩綍</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Advanced Transfer Task Center */}
      <Modal visible={isTransferVisible} animationType="slide" onRequestClose={() => setIsTransferVisible(false)}>
        <View style={styles.transferModal}>
          <View style={styles.transferHeader}>
            <Text style={styles.transferTitle}>浼犺緭浠诲姟涓績</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {transfers.some(t => t.status === 'success') && (
                <TouchableOpacity onPress={clearCompletedTransfers}>
                  <Text style={[styles.closeText, { color: colors.sub, fontSize: 13 }]}>娓呯┖宸插畬鎴?/Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setIsTransferVisible(false)}>
                <Text style={styles.closeText}>鍏抽棴</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.transferContent}>
            {transfers.length === 0 ? (
              <View style={[styles.listCenter, { marginTop: 100 }]}>
                <ArrowDownUp color={colors.divider} size={54} style={{ marginBottom: 16 }} />
                <Text style={styles.emptyText}>鏆傛棤浼犺緭浠诲姟璁板綍</Text>
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
                        {item.type === '涓婁紶' ? (
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
                              {item.type} 路 {isSuccess ? '宸插畬鎴? : isError ? '浼犺緭澶辫触' : isPaused ? '宸叉殏鍋? : '浼犺緭涓?}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Top-Right Optimized Action Buttons: Distinct, Ergonomic, Pill-shaped */}
                      <View style={styles.transferActionGroup}>
                        {item.type === '涓婁紶' && isRunning && (
                          <TouchableOpacity
                            style={[styles.transferActionBtn, { backgroundColor: 'rgba(245, 158, 11, 0.14)' }]}
                            onPress={() => pauseUploadTask(item.id)}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Pause color={colors.amber} size={15} />
                          </TouchableOpacity>
                        )}

                        {item.type === '涓婁紶' && (isPaused || isError) && (
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
                          {item.speedDisplay || (isRunning ? '璁＄畻涓?..' : isPaused ? '宸叉殏鍋? : isSuccess ? '瀹屾垚' : '鍋滄')}
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
  menuOverlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  dropdownMenu: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 8,
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
    zIndex: 100000,
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

