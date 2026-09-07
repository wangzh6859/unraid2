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

export default function FilesScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

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
  const activeTasksRef = useRef({}); // taskId -> FileSystem.UploadTask

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
      const url = `${baseUrl}/api.php?token=${token}&action=file_list&path=${encodeURIComponent(path)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.status === 'success') {
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
          speed: '正在准备...',
        };

        setTransfers(prev => [newTask, ...prev]);
        setIsTransferVisible(true);
        startUploadTask(newTask);
      }
    } catch (e) {
      Alert.alert('选择文件异常', e.message);
    }
  };

  const startUploadTask = async (taskItem) => {
    const uploadUrl = `${serverUrl}/api.php?token=${apiToken}&action=file_upload&path=${encodeURIComponent(taskItem.targetPath)}&filename=${encodeURIComponent(taskItem.name)}`;
    try {
      const uploadTask = FileSystem.createUploadTask(
        uploadUrl,
        taskItem.uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          parameters: {
            filename: taskItem.name,
            path: taskItem.targetPath,
          },
        },
        (progressEvent) => {
          const sent = progressEvent.totalBytesSent;
          const total = progressEvent.totalBytesExpectedToSend;
          const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
          setTransfers(prev => prev.map(t => {
            if (t.id === taskItem.id) {
              return { ...t, progress: pct, speed: `${formatBytes(sent)} / ${formatBytes(total)} (${pct}%)` };
            }
            return t;
          }));
        }
      );

      activeTasksRef.current[taskItem.id] = uploadTask;
      const res = await uploadTask.uploadAsync();
      delete activeTasksRef.current[taskItem.id];

      let isSuccess = false;
      let respMsg = '';
      try {
        const bodyJson = JSON.parse(res.body);
        if (bodyJson.status === 'success') {
          isSuccess = true;
        } else {
          respMsg = bodyJson.message || '服务器保存失败';
        }
      } catch (e) {
        isSuccess = res.status >= 200 && res.status < 300;
      }

      if (isSuccess) {
        setTransfers(prev => prev.map(t => (t.id === taskItem.id ? { ...t, status: 'success', progress: 100, speed: '上传成功' } : t)));
        // Refresh directory if still viewing destination
        if (currentPath === taskItem.targetPath) {
          loadDirectory(serverUrl, apiToken, currentPath);
        }
      } else {
        setTransfers(prev => prev.map(t => (t.id === taskItem.id ? { ...t, status: 'error', speed: respMsg || `上传失败 (HTTP ${res.status})` } : t)));
      }
    } catch (err) {
      delete activeTasksRef.current[taskItem.id];
      const isCancelled = err.message && err.message.includes('cancel');
      setTransfers(prev => prev.map(t => {
        if (t.id === taskItem.id) {
          return isCancelled
            ? { ...t, status: 'paused', speed: '已中断 / 暂停' }
            : { ...t, status: 'error', speed: `错误: ${err.message}` };
        }
        return t;
      }));
    }
  };

  // Pause / Cancel active upload
  const pauseUploadTask = async (taskId) => {
    const task = activeTasksRef.current[taskId];
    if (task) {
      try {
        await task.cancelAsync();
      } catch (e) {}
      delete activeTasksRef.current[taskId];
    }
    setTransfers(prev => prev.map(t => (t.id === taskId ? { ...t, status: 'paused', speed: '已暂停' } : t)));
  };

  // Resume / Retry upload
  const resumeUploadTask = (taskItem) => {
    setTransfers(prev => prev.map(t => (t.id === taskItem.id ? { ...t, status: 'running', speed: '继续传输中...' } : t)));
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
        speed: '正在下载...',
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
      setTransfers(prev => prev.map(t => (t.id === taskId ? { ...t, status: 'success', progress: 100, speed: '下载完成' } : t)));
    } catch (e) {
      console.log('[FilesScreen] Download error:', e);
      Alert.alert('下载失败', e.message);
      setTransfers(prev => prev.map(t => (t.name === item.name && t.status === 'running' ? { ...t, status: 'error', speed: '下载中断' } : t)));
    }
  };

  const handleBatchDownload = async () => {
    const items = fileList.filter(f => selected.has(f.path) && !f.isFolder);
    if (items.length === 0) {
      Alert.alert('提示', '请选择要下载的文件（文件夹暂不支持批量打包下载）');
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
    Alert.alert(
      '确认删除',
      `确定彻底删除 ${item.isFolder ? '文件夹' : '文件'} \n"${item.name}" 吗？\n此操作不可撤销！`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '彻底删除',
          style: 'destructive',
          onPress: async () => {
            const ok = await doDelete(item);
            if (ok) {
              setDetailItem(null);
              loadDirectory(serverUrl, apiToken, currentPath);
            } else {
              Alert.alert('删除失败', '服务器拒绝删除，请检查权限');
            }
          }
        }
      ]
    );
  };

  const handleBatchDelete = () => {
    const items = fileList.filter(f => selected.has(f.path));
    if (items.length === 0) return;
    Alert.alert(
      '批量删除',
      `确定要删除选中的 ${items.length} 个项目吗？\n此操作不可恢复！`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '全部删除',
          style: 'destructive',
          onPress: async () => {
            for (const item of items) {
              await doDelete(item);
            }
            exitMultiSelect();
            loadDirectory(serverUrl, apiToken, currentPath);
          }
        }
      ]
    );
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
    Alert.alert('操作完成', `${pickerMode === 'move' ? '移动' : '复制'}成功 ${count} 个项目`);
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
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.renameBox}>
            <Text style={styles.renameTitle}>新建文件夹</Text>
            <TextInput
              style={styles.renameInput}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
              placeholder="请输入文件夹名称"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.renameBtns}>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.input }]} onPress={() => setMkdirVisible(false)}>
                <Text style={styles.renameBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.accent }]} onPress={confirmCreateFolder}>
                <Text style={[styles.renameBtnText, { color: '#ffffff' }]}>创建</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={!!renameItem} transparent animationType="fade" onRequestClose={() => setRenameItem(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.renameBox}>
            <Text style={styles.renameTitle}>重命名</Text>
            <TextInput
              style={styles.renameInput}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              selectTextOnFocus
              placeholder="输入新名称"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.renameBtns}>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.input }]} onPress={() => setRenameItem(null)}>
                <Text style={styles.renameBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.accent }]} onPress={confirmRename}>
                <Text style={[styles.renameBtnText, { color: '#ffffff' }]}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Item Details Sheet */}
      <Modal visible={!!detailItem} transparent animationType="fade" onRequestClose={() => setDetailItem(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setDetailItem(null)}>
          <View style={styles.actionSheet}>
            <View style={styles.detailHeader}>
              {detailItem?.isFolder ? (
                <Folder color={colors.accent} size={40} fill="rgba(59, 130, 246, 0.2)" />
              ) : (
                <File color={colors.sub} size={40} />
              )}
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
                    <View style={styles.transferIconBox}>
                      {item.type === '上传' ? (
                        <UploadCloud color={colors.amber} size={22} />
                      ) : (
                        <DownloadCloud color={colors.green} size={22} />
                      )}
                    </View>

                    <View style={styles.transferInfo}>
                      <Text style={styles.transferName} numberOfLines={1}>{item.name}</Text>
                      <Text style={[
                        styles.transferStatus,
                        { color: isSuccess ? colors.green : isError ? colors.red : isPaused ? colors.amber : colors.accent }
                      ]}>
                        {item.type} · {item.speed}
                      </Text>

                      {/* Progress Bar */}
                      {item.type === '上传' && (
                        <View style={styles.transferProgressBar}>
                          <View style={[styles.transferProgressFill, { width: `${item.progress || 0}%`, backgroundColor: isSuccess ? colors.green : isError ? colors.red : isPaused ? colors.amber : colors.accent }]} />
                        </View>
                      )}
                    </View>

                    {/* Action buttons (Pause / Resume / Delete record) */}
                    <View style={styles.transferActions}>
                      {item.type === '上传' && isRunning && (
                        <TouchableOpacity style={styles.transferActionBtn} onPress={() => pauseUploadTask(item.id)}>
                          <Pause color={colors.sub} size={18} />
                        </TouchableOpacity>
                      )}

                      {item.type === '上传' && (isPaused || isError) && (
                        <TouchableOpacity style={styles.transferActionBtn} onPress={() => resumeUploadTask(item)}>
                          <Play color={colors.accent} size={18} />
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity style={styles.transferActionBtn} onPress={() => deleteTransferRecord(item.id)}>
                        <Trash2 color={colors.sub} size={18} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>
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

  // Overlays
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  dropdownMenu: { position: 'absolute', top: Platform.OS === 'ios' ? 100 : 60, right: 16, backgroundColor: colors.card, borderRadius: 12, padding: 8, width: 190, elevation: 5 },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  menuText: { color: colors.text, fontSize: 15, marginLeft: 12, fontWeight: '500' },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },

  // Action sheet details
  actionSheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20 },
  detailHeader: { alignItems: 'center', marginBottom: 16 },
  detailName: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginTop: 10 },
  detailRows: { backgroundColor: colors.input, borderRadius: 12, padding: 12, marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  detailLabel: { color: colors.sub, fontSize: 13, width: 64 },
  detailValue: { color: colors.text, fontSize: 13, flex: 1, textAlign: 'right' },
  detailActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.input, borderRadius: 12, paddingVertical: 12 },
  detailActionText: { color: colors.textStrong, fontSize: 14, fontWeight: 'bold' },
  actionSheetCancel: { alignItems: 'center', backgroundColor: colors.input, borderRadius: 12, paddingVertical: 14 },
  actionSheetCancelText: { color: colors.textStrong, fontSize: 15, fontWeight: 'bold' },

  // Rename & Mkdir
  renameBox: { backgroundColor: colors.card, borderRadius: 16, padding: 20, margin: 24 },
  renameTitle: { color: colors.textStrong, fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },
  renameInput: { backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 12, height: 48, color: colors.textStrong, fontSize: 16, marginBottom: 16 },
  renameBtns: { flexDirection: 'row', justifyContent: 'space-between' },
  renameBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginHorizontal: 6 },
  renameBtnText: { color: colors.text, fontSize: 15, fontWeight: 'bold' },

  // Target Picker
  pickerContainer: { flex: 1, backgroundColor: colors.bg },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: Platform.OS === 'ios' ? 60 : 16, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.divider },
  pickerUpBtn: { flexDirection: 'row', alignItems: 'center' },
  pickerUpText: { color: colors.textStrong, fontSize: 14, marginLeft: 4 },
  pickerTitle: { color: colors.textStrong, fontSize: 17, fontWeight: 'bold' },
  pickerPath: { color: colors.accent, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(59,130,246,0.08)' },
  pickerList: { padding: 12 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 8 },
  pickerFolderName: { color: colors.text, fontSize: 15, marginLeft: 10, flex: 1 },
  pickerFooter: { padding: 16, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.divider, paddingBottom: Platform.OS === 'ios' ? 28 : 16 },
  pickerConfirmBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  pickerConfirmText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },

  // Transfer Modal
  transferModal: { flex: 1, backgroundColor: colors.bg },
  transferHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 20, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.divider },
  transferTitle: { color: colors.textStrong, fontSize: 18, fontWeight: 'bold' },
  closeText: { color: colors.accent, fontSize: 15, fontWeight: 'bold' },
  transferContent: { padding: 16 },
  transferRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, padding: 14, borderRadius: 14, marginBottom: 12 },
  transferIconBox: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.input, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  transferInfo: { flex: 1 },
  transferName: { color: colors.text, fontSize: 15, fontWeight: '500', marginBottom: 4 },
  transferStatus: { fontSize: 12, fontWeight: 'bold' },
  transferProgressBar: { height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  transferProgressFill: { height: '100%', borderRadius: 2 },
  transferActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 10 },
  transferActionBtn: { padding: 8, borderRadius: 8, backgroundColor: colors.input },
});