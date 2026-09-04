import React, { useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, ScrollView, Modal, BackHandler, Pressable, RefreshControl, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Folder, Save, Server, Key, User, File, ChevronLeft, LogOut, HardDrive, Plus, ArrowDownUp,
  FolderPlus, UploadCloud, DownloadCloud, X, Download, Pencil, Copy, MoveRight,
  Trash2, CheckCircle, Circle, ArrowUp, FolderOpen, Info,
} from 'lucide-react-native';
import base64 from 'base-64';
import { XMLParser } from 'fast-xml-parser';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Video } from 'expo-av';
import { useTheme } from '../ThemeContext';
import { getDownloadDir, ensureCacheDir, enforceCacheLimit } from '../utils/cacheManager';

const isImageFile = (name) => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
const isVideoFile = (name) => /\.(mp4|mkv|webm|mov|avi|3gp|flv)$/i.test(name);
const isTextFile = (name) => /\.(txt|md|log|json|xml|html|htm|css|js|jsx|ts|tsx|py|sh|c|h|cpp|java|go|rb|yml|yaml|ini|conf|cfg|nfo)$/i.test(name);

export default function FilesScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [davUrl, setDavUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [isConnected, setIsConnected] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [currentPath, setCurrentPath] = useState('');
  const [fileList, setFileList] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isTransferVisible, setIsTransferVisible] = useState(false);
  const [transfers, setTransfers] = useState([]);

  // 预览控件状态
  const [previewItem, setPreviewItem] = useState(null);
  // 文本预览状态（即时阅读器）
  const [textState, setTextState] = useState(null);
  // 视频预览状态（即时阅读器）
  const [videoState, setVideoState] = useState({ loading: false, uri: null });

  // 多选模式
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState(new Set());

  // 详情弹窗目标（复用原 actionItem 状态）
  const [detailItem, setDetailItem] = useState(null);

  // 重命名
  const [renameItem, setRenameItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // 目标目录选择器（复制 / 移动）
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState(null);
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerPath, setPickerPath] = useState('');
  const [pickerFolders, setPickerFolders] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const savedUrl = await AsyncStorage.getItem('@dav_url');
        const savedUser = await AsyncStorage.getItem('@dav_user');
        const savedPass = await AsyncStorage.getItem('@dav_pass');
        if (savedUrl) setDavUrl(savedUrl);
        if (savedUser) setUsername(savedUser);
        if (savedPass) setPassword(savedPass);
        if (savedUrl && savedUser && savedPass) {
          setIsConnected(true);
          const urlObj = savedUrl.match(/^(https?:\/\/[^\/]+)(.*)$/);
          setCurrentPath(urlObj && urlObj[2] ? urlObj[2] : '/');
        }
      } catch (e) { console.log(e); } finally { setIsLoading(false); }
    };
    loadConfig();
  }, []);

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0 || bytes === '0') return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getDirectUrl = (href) => {
    const originMatch = davUrl.match(/^(https?:\/\/[^\/]+)/);
    return (originMatch ? originMatch[1] : '') + href;
  };

  const authHeaders = () => ({ 'Authorization': `Basic ${base64.encode(`${username}:${password}`)}` });

  const testConnection = async () => {
    if (!davUrl || !username || !password) { Alert.alert('提示', '请完整填写信息'); return; }
    let cleanUrl = davUrl.trim();
    if (!cleanUrl.endsWith('/')) cleanUrl += '/';
    setIsTesting(true);
    try {
      const headers = { ...authHeaders(), 'Depth': '1', 'Content-Type': 'application/xml' };
      let response = await fetch(cleanUrl, { method: 'PROPFIND', headers });
      if (response.status === 405 && !cleanUrl.endsWith('/dav/')) {
        const alistUrl = cleanUrl + 'dav/';
        const retryResponse = await fetch(alistUrl, { method: 'PROPFIND', headers });
        if (retryResponse.status === 200 || retryResponse.status === 207) {
          response = retryResponse;
          cleanUrl = alistUrl;
        }
      }
      if (response.status === 200 || response.status === 207) {
        await AsyncStorage.setItem('@dav_url', cleanUrl);
        await AsyncStorage.setItem('@dav_user', username);
        await AsyncStorage.setItem('@dav_pass', password);
        const urlObj = cleanUrl.match(/^(https?:\/\/[^\/]+)(.*)$/);
        setCurrentPath(urlObj && urlObj[2] ? urlObj[2] : '/');
        setIsConnected(true);
      } else { Alert.alert('连接失败', `状态码：${response.status}`); }
    } catch (error) { Alert.alert('网络错误', '无法连接'); } finally { setIsTesting(false); }
  };

  const fetchDirectory = useCallback(async (targetPath) => {
    setIsLoadingList(true);
    try {
      const fullUrl = getDirectUrl(targetPath);
      const response = await fetch(fullUrl, {
        method: 'PROPFIND',
        headers: { ...authHeaders(), 'Depth': '1', 'Content-Type': 'application/xml' },
      });
      const xmlText = await response.text();
      const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
      const result = parser.parse(xmlText);
      let responses = result?.multistatus?.response;
      if (!responses) { setFileList([]); setCurrentPath(targetPath); return; }
      if (!Array.isArray(responses)) responses = [responses];

      const parsedFiles = [];
      responses.forEach((res) => {
        let href = typeof res.href === 'string' ? res.href : (res.href && res.href['#text']) || '';
        if (href.startsWith('http')) {
          const hMatch = href.match(/^https?:\/\/[^\/]+(.*)$/);
          href = hMatch ? hMatch[1] : href;
        }
        if (href === targetPath || href === targetPath + '/') return;
        const props = res.propstat?.prop || (Array.isArray(res.propstat) ? res.propstat[0].prop : {});
        const rt = props.resourcetype;
        // 兼容不同服务器对 <collection/> 的解析形式（'' 或 true 或空对象）
        const isFolder = !!rt && (rt.collection === '' || rt.collection === true || (typeof rt === 'object' && rt.collection !== undefined));
        let displayName = props.displayname;
        if (!displayName) {
          const parts = href.split('/').filter(p => p !== '');
          displayName = parts[parts.length - 1] || '未命名';
          try { displayName = decodeURIComponent(displayName); } catch (e) {}
        }
        // 记录最后修改时间（getlastmodified）用于详情展示
        parsedFiles.push({
          name: displayName, href, isFolder,
          size: props.getcontentlength || 0,
          mtime: props.getlastmodified || '',
        });
      });
      parsedFiles.sort((a, b) => {
        if (a.isFolder === b.isFolder) return a.name.localeCompare(b.name);
        return a.isFolder ? -1 : 1;
      });
      setFileList(parsedFiles);
      setCurrentPath(targetPath);
    } catch (error) {
      // 区分错误类型，给出更具体的提示
      Alert.alert('读取目录失败', error.message || '无法读取该目录，请检查网络或目录权限。');
    } finally { setIsLoadingList(false); }
  }, [davUrl, username, password]);

  useEffect(() => {
    if (isConnected && currentPath) fetchDirectory(currentPath);
  }, [isConnected]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchDirectory(currentPath);
    setIsRefreshing(false);
  }, [currentPath, fetchDirectory]);

  const rootPathMatch = davUrl.match(/^(https?:\/\/[^\/]+)(.*)$/);
  const rootPath = rootPathMatch && rootPathMatch[2] ? rootPathMatch[2] : '/';
  const isAtRoot = currentPath === rootPath || currentPath === rootPath + '/';

  const goBack = useCallback(() => {
    if (isAtRoot) return;
    let p = currentPath.endsWith('/') ? currentPath.slice(0, -1) : currentPath;
    fetchDirectory(p.substring(0, p.lastIndexOf('/') + 1));
  }, [currentPath, isAtRoot, fetchDirectory]);

  // 多选
  const enterMultiSelect = (item) => {
    setMultiSelect(true);
    setSelected(new Set([item.href]));
  };
  const exitMultiSelect = () => {
    setMultiSelect(false);
    setSelected(new Set());
  };
  const toggleSelect = (item) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(item.href)) next.delete(item.href);
      else next.add(item.href);
      return next;
    });
  };
  const isSelected = (href) => selected.has(href);
  const toggleSelectAll = () => {
    if (selected.size === fileList.length) setSelected(new Set());
    else setSelected(new Set(fileList.map(f => f.href)));
  };

  // 长按：进入多选模式（可继续点选多个）
  const handleLongPress = (item) => {
    if (!multiSelect) enterMultiSelect(item);
    else toggleSelect(item);
  };

  // 点击：文件夹进入；文件按类型即时预览
  const handleFileClick = (item) => {
    if (multiSelect) { toggleSelect(item); return; }
    if (item.isFolder) { fetchDirectory(item.href); return; }
    if (isVideoFile(item.name)) { loadVideoPreview(item); return; }
    if (isTextFile(item.name)) { loadTextPreview(item); return; }
    setVideoState({ loading: false, uri: null });
    setTextState(null);
    setPreviewItem(item);
  };

  // 文本即时阅读：下载到缓存读取内容（可编辑）
  const loadTextPreview = async (item) => {
    setTextState({ loading: true, content: '', saving: false });
    setVideoState({ loading: false, uri: null });
    setPreviewItem(item);
    try {
      const dir = await ensureCacheDir();
      const localUri = dir + encodeURIComponent(item.name);
      const res = await FileSystem.downloadAsync(getDirectUrl(item.href), localUri, { headers: authHeaders() });
      const content = await FileSystem.readAsStringAsync(res.uri);
      await enforceCacheLimit();
      setTextState({ loading: false, content, saving: false });
    } catch (e) {
      setTextState({ loading: false, content: '⚠️ 无法读取文本内容：' + e.message, saving: false });
    }
  };

  // 保存编辑后的文本回服务器（WebDAV PUT）
  const saveTextPreview = async () => {
    if (!previewItem || !textState) return;
    setTextState(prev => (prev ? { ...prev, saving: true } : prev));
    try {
      const res = await fetch(getDirectUrl(previewItem.href), {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'text/plain' },
        body: textState.content,
      });
      if (res.status === 201 || res.status === 204 || res.status === 200) {
        Alert.alert('保存成功', '文件已写回服务器');
      } else { Alert.alert('保存失败', `HTTP ${res.status}`); }
    } catch (e) { Alert.alert('保存失败', e.message); }
    finally { setTextState(prev => (prev ? { ...prev, saving: false } : prev)); }
  };

  // 视频即时预览：下载到缓存后用播放器播放
  const loadVideoPreview = async (item) => {
    setVideoState({ loading: true, uri: null });
    setTextState(null);
    setPreviewItem(item);
    try {
      const dir = await ensureCacheDir();
      const localUri = dir + encodeURIComponent(item.name);
      const res = await FileSystem.downloadAsync(getDirectUrl(item.href), localUri, { headers: authHeaders() });
      await enforceCacheLimit();
      setVideoState({ loading: false, uri: res.uri });
    } catch (e) {
      setVideoState({ loading: false, uri: null });
      Alert.alert('预览失败', '视频加载失败，请先下载后查看。');
    }
  };

  const disconnect = async () => {
    await AsyncStorage.removeItem('@dav_pass');
    setIsMenuVisible(false);
    setIsConnected(false);
    exitMultiSelect();
  };

  // 上传：调用手机原生文件管理器，上传后清理临时缓存（释放访问）
  const handleUpload = async () => {
    setIsMenuVisible(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const newTransfer = { id: Date.now(), name: file.name, type: '上传', status: '正在传输...' };
        setTransfers(prev => [newTransfer, ...prev]);
        setIsTransferVisible(true);
        const targetDir = currentPath.endsWith('/') ? currentPath : currentPath + '/';
        const uploadUrl = getDirectUrl(targetDir) + encodeURIComponent(file.name);
        const uploadRes = await FileSystem.uploadAsync(uploadUrl, file.uri, {
          httpMethod: 'PUT',
          headers: authHeaders(),
        });
        if (uploadRes.status === 201 || uploadRes.status === 204 || uploadRes.status === 200) {
          setTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: '✅ 成功' } : t));
          fetchDirectory(currentPath);
        } else {
          setTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: `❌ 失败 (${uploadRes.status})` } : t));
        }
        // 上传完成：清理临时缓存副本，即时释放文件访问权限
        if (file.uri) await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => {});
      }
    } catch (error) { Alert.alert('上传失败', error.message); }
  };

  // 下载：写入设置中配置的下载目录
  const handleDownload = async (item) => {
    try {
      const dir = await getDownloadDir();
      setPreviewItem(null);
      const newTransfer = { id: Date.now(), name: item.name, type: '下载', status: '正在传输...' };
      setTransfers(prev => [newTransfer, ...prev]);
      setIsTransferVisible(true);
      const localUri = FileSystem.cacheDirectory + 'dl_' + Date.now() + '_' + encodeURIComponent(item.name);
      const downloadRes = await FileSystem.downloadAsync(getDirectUrl(item.href), localUri, { headers: authHeaders() });
      if (dir.uri.startsWith('content://')) {
        const base64Data = await FileSystem.readAsStringAsync(downloadRes.uri, { encoding: FileSystem.EncodingType.Base64 });
        const newFileUri = await FileSystem.StorageAccessFramework.createFileAsync(dir.uri, item.name, 'application/octet-stream');
        await FileSystem.writeAsStringAsync(newFileUri, base64Data, { encoding: FileSystem.EncodingType.Base64 });
      } else {
        const destUri = dir.uri + encodeURIComponent(item.name);
        await FileSystem.copyAsync({ from: downloadRes.uri, to: destUri });
      }
      await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
      setTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: '✅ 成功' } : t));
    } catch (error) {
      Alert.alert('下载失败', '网络连接中断或目录不可写');
      setTransfers(prev => prev.map(t => t.name === item.name && t.status === '正在传输...' ? { ...t, status: '❌ 失败' } : t));
    }
  };

  // 批量下载（仅文件）
  const handleBatchDownload = async () => {
    const items = fileList.filter(f => selected.has(f.href) && !f.isFolder);
    if (items.length === 0) { Alert.alert('提示', '请选择要下载的文件（文件夹不可下载）'); return; }
    setPreviewItem(null);
    for (const item of items) await handleDownload(item);
    exitMultiSelect();
  };

  const doDelete = async (item) => {
    try {
      const res = await fetch(getDirectUrl(item.href), { method: 'DELETE', headers: authHeaders() });
      if (res.status === 200 || res.status === 204) { fetchDirectory(currentPath); return true; }
      Alert.alert('删除失败', `服务器拒绝执行 (HTTP ${res.status})`);
      return false;
    } catch (error) { Alert.alert('删除出错', error.message); return false; }
  };

  const handleDelete = (item) => {
    Alert.alert('确认删除', `确定要彻底删除 ${item.isFolder ? '文件夹' : '文件'} \n"${item.name}" 吗？\n此操作不可恢复！`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
          const ok = await doDelete(item);
          if (ok) setDetailItem(null);
        }
      }
    ]);
  };

  const handleBatchDelete = () => {
    const items = fileList.filter(f => selected.has(f.href));
    if (items.length === 0) return;
    Alert.alert('批量删除', `确定要删除选中的 ${items.length} 个${items.every(i => i.isFolder) ? '文件夹' : '项目'}吗？\n此操作不可恢复！`, [
      { text: '取消', style: 'cancel' },
      { text: '全部删除', style: 'destructive', onPress: async () => {
          let ok = true;
          for (const item of items) {
            if (!(await doDelete(item))) { ok = false; break; }
          }
          if (ok) exitMultiSelect();
        }
      }
    ]);
  };

  // 详情：底部操作栏「详情」，单选一个


  // 统计文件夹内的条目数量（用于详情展示）
  const countChildren = async (href) => {
    try {
      const response = await fetch(getDirectUrl(href), {
        method: 'PROPFIND',
        headers: { ...authHeaders(), 'Depth': '1', 'Content-Type': 'application/xml' },
      });
      const xmlText = await response.text();
      const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
      const result = parser.parse(xmlText);
      let responses = result?.multistatus?.response;
      if (!responses) return 0;
      if (!Array.isArray(responses)) responses = [responses];
      return responses.filter(r => (r.href !== href && r.href !== href + '/')).length;
    } catch (e) { return 0; }
  };

  const openDetail = () => {
    const items = fileList.filter(f => selected.has(f.href));
    if (items.length !== 1) { Alert.alert('提示', '详情操作仅支持单选一个文件/文件夹'); return; }
    exitMultiSelect();
    const target = items[0];
    setDetailItem(target);
    // 计算文件夹的下级数量
    if (target.isFolder) {
      setDetailInfo({ childCount: null, isCounting: true });
      countChildren(target.href).then(c => setDetailInfo({ childCount: c, isCounting: false }));
    } else {
      setDetailInfo({ childCount: null, isCounting: false });
    }
  };

  // 重命名（WebDAV MOVE 到同目录新名）
  const openRename = (item) => {
    setDetailItem(null);
    setRenameItem(item);
    setRenameValue(item.name);
  };
  const confirmRename = async () => {
    const newName = renameValue.trim();
    if (!newName) return;
    if (newName === renameItem.name) { setRenameItem(null); return; }
    try {
      const srcPath = renameItem.href.endsWith('/') ? renameItem.href.slice(0, -1) : renameItem.href;
      const parentDir = srcPath.substring(0, srcPath.lastIndexOf('/') + 1);
      const destUrl = getDirectUrl(parentDir) + encodeURIComponent(newName);
      const res = await fetch(getDirectUrl(renameItem.href), {
        method: 'MOVE',
        headers: { ...authHeaders(), 'Destination': destUrl },
      });
      if (res.status === 201 || res.status === 204 || res.status === 200) {
        setRenameItem(null);
        fetchDirectory(currentPath);
      } else { Alert.alert('重命名失败', `服务器拒绝执行 (HTTP ${res.status})`); }
    } catch (error) { Alert.alert('重命名出错', error.message); }
  };

  // 目标目录选择器（复制 / 移动）
  const openPicker = async (mode, items) => {
    setPickerMode(mode);
    setPickerItems(items);
    setDetailItem(null);
    exitMultiSelect();
    setPickerVisible(true);
    setPickerPath(rootPath);
    await loadPickerFolders(rootPath);
  };
  const loadPickerFolders = async (path) => {
    setPickerLoading(true);
    try {
      const response = await fetch(getDirectUrl(path), {
        method: 'PROPFIND',
        headers: { ...authHeaders(), 'Depth': '1', 'Content-Type': 'application/xml' },
      });
      const xmlText = await response.text();
      const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
      const result = parser.parse(xmlText);
      let responses = result?.multistatus?.response;
      if (!responses) { setPickerFolders([]); setPickerPath(path); return; }
      if (!Array.isArray(responses)) responses = [responses];
      const folders = [];
      responses.forEach((res) => {
        let href = typeof res.href === 'string' ? res.href : (res.href && res.href['#text']) || '';
        if (href.startsWith('http')) {
          const hMatch = href.match(/^https?:\/\/[^\/]+(.*)$/);
          href = hMatch ? hMatch[1] : href;
        }
        if (href === path || href === path + '/') return;
        const props = res.propstat?.prop || (Array.isArray(res.propstat) ? res.propstat[0].prop : {});
        const rt = props.resourcetype;
        const isFolder = !!rt && (rt.collection === '' || rt.collection === true || (typeof rt === 'object' && rt.collection !== undefined));
        if (!isFolder) return;
        let displayName = props.displayname;
        if (!displayName) {
          const parts = href.split('/').filter(p => p !== '');
          displayName = parts[parts.length - 1] || '未命名';
          try { displayName = decodeURIComponent(displayName); } catch (e) {}
        }
        folders.push({ name: displayName, href });
      });
      folders.sort((a, b) => a.name.localeCompare(b.name));
      setPickerFolders(folders);
      setPickerPath(path);
    } catch (error) {
      Alert.alert('读取目录失败', error.message || '无法读取该目录，请检查网络或目录权限。');
    } finally { setPickerLoading(false); }
  };
  const pickerGoUp = () => {
    if (pickerPath === rootPath || pickerPath === rootPath + '/') return;
    let p = pickerPath.endsWith('/') ? pickerPath.slice(0, -1) : pickerPath;
    loadPickerFolders(p.substring(0, p.lastIndexOf('/') + 1));
  };
  const pickerEnter = (folder) => loadPickerFolders(folder.href);
  const isSameDir = (item) => {
    const srcPath = item.href.endsWith('/') ? item.href.slice(0, -1) : item.href;
    const parentDir = srcPath.substring(0, srcPath.lastIndexOf('/') + 1);
    const target = pickerPath.endsWith('/') ? pickerPath : pickerPath + '/';
    return parentDir === target;
  };
  const confirmPicker = async () => {
    const targetPath = pickerPath.endsWith('/') ? pickerPath : pickerPath + '/';
    const conflict = pickerItems.filter(it => isSameDir(it));
    if (conflict.length > 0) {
      Alert.alert('无法操作', '目标目录与部分文件的当前位置相同，请选择其他目录或重命名后再试。');
      return;
    }
    setPickerVisible(false);
    setPickerLoading(true);
    try {
      const method = pickerMode === 'move' ? 'MOVE' : 'COPY';
      let successCount = 0;
      for (const item of pickerItems) {
        const destUrl = getDirectUrl(targetPath) + encodeURIComponent(item.name);
        try {
          const res = await fetch(getDirectUrl(item.href), {
            method,
            headers: { ...authHeaders(), 'Destination': destUrl },
          });
          if (res.status === 201 || res.status === 204 || res.status === 200) successCount++;
        } catch (e) {}
      }
      if (successCount > 0) {
        Alert.alert('操作完成', `${pickerMode === 'move' ? '移动' : '复制'}完成 ${successCount} 个项`);
        fetchDirectory(currentPath);
      } else { Alert.alert('操作失败', '服务器拒绝了所有请求，请检查权限。'); }
    } catch (error) { Alert.alert('操作失败', error.message); } finally { setPickerLoading(false); }
  };

  useEffect(() => {
    const onBackPress = () => {
      if (previewItem) { setPreviewItem(null); return true; }
      if (multiSelect) { exitMultiSelect(); return true; }
      if (pickerVisible) { setPickerVisible(false); return true; }
      if (renameItem) { setRenameItem(null); return true; }
      if (detailItem) { setDetailItem(null); return true; }
      if (isConnected && !isAtRoot) { goBack(); return true; }
      return false;
    };
    BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => BackHandler.removeEventListener('hardwareBackPress', onBackPress);
  }, [isConnected, isAtRoot, goBack, previewItem, multiSelect, pickerVisible, renameItem, detailItem]);

  useLayoutEffect(() => {
    if (!isConnected) {
      navigation.setOptions({ title: '连接文件库', headerLeft: null, headerRight: null });
      return;
    }
    const pathParts = currentPath.split('/').filter(Boolean);
    const titleName = isAtRoot ? '根目录' : decodeURIComponent(pathParts[pathParts.length - 1]);
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
      )
    });
  }, [navigation, isConnected, currentPath, isAtRoot, goBack, multiSelect, selected.size, colors, styles]);

  if (isLoading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View>;

  if (!isConnected) {
    return (
      <KeyboardAvoidingView style={styles.center} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.setupCard}>
          <HardDrive color={colors.accent} size={48} style={{ alignSelf: 'center', marginBottom: 16 }} />
          <Text style={styles.setupTitle}>连接 WebDAV</Text>
          <Text style={styles.setupSub}>请输入 Unraid AList 的 WebDAV 服务详情</Text>
          <View style={styles.inputContainer}><Server color={colors.sub} size={20} style={styles.inputIcon} /><TextInput style={styles.input} placeholder="https://alist.bbb.ccc:123" placeholderTextColor={colors.muted} value={davUrl} onChangeText={setDavUrl} autoCapitalize="none" keyboardType="url" /></View>
          <View style={styles.inputContainer}><User color={colors.sub} size={20} style={styles.inputIcon} /><TextInput style={styles.input} placeholder="用户名" placeholderTextColor={colors.muted} value={username} onChangeText={setUsername} autoCapitalize="none" /></View>
          <View style={styles.inputContainer}><Key color={colors.sub} size={20} style={styles.inputIcon} /><TextInput style={styles.input} placeholder="密码" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword} secureTextEntry={true} /></View>
          <TouchableOpacity style={styles.saveBtn} onPress={testConnection} disabled={isTesting}>{isTesting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveBtnText}>测试并连接</Text>}</TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.fileContainer}>
      {isLoadingList && !isRefreshing ? (
        <View style={styles.listCenter}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <ScrollView
          style={styles.listScroll}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
        >
          {fileList.length === 0 ? (
            <View style={styles.listCenter}><Text style={styles.emptyText}>空文件夹，下拉可刷新</Text></View>
          ) : (
            fileList.map((item, index) => {
              const sel = isSelected(item.href);
              return (
                <TouchableOpacity
                  key={index}
                  style={[styles.fileRow, sel && styles.fileRowSelected]}
                  onPress={() => handleFileClick(item)}
                  onLongPress={() => handleLongPress(item)}
                  delayLongPress={450}
                >
                  <View style={styles.fileIconBox}>
                    {item.isFolder ? <Folder color={colors.accent} size={24} fill="rgba(59, 130, 246, 0.2)" /> : <File color={colors.sub} size={24} />}
                  </View>
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                    {!item.isFolder && <Text style={styles.fileSize}>{formatBytes(item.size)}</Text>}
                  </View>
                  {/* 💡 右侧多选框（仅多选模式显示） */}
                  {multiSelect && (
                    <TouchableOpacity
                      style={styles.checkbox}
                      onPress={() => toggleSelect(item)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                    >
                      {sel ? <CheckCircle color={colors.accent} size={24} /> : <Circle color={colors.muted} size={24} />}
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* 💡 多选底部操作栏：下载/删除/移动/复制/详情 */}
      {multiSelect && (
        <View style={styles.bottomBar}>
          <View style={styles.bottomBarTop}>
            <Text style={styles.bottomBarCount}>已选 {selected.size} 项</Text>
            <TouchableOpacity onPress={toggleSelectAll}>
              <Text style={styles.bottomBarSelectAll}>{selected.size === fileList.length ? '取消全选' : '全选'}</Text>
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
            <TouchableOpacity style={styles.bottomBarBtn} onPress={() => openPicker('move', fileList.filter(f => selected.has(f.href)))}>
              <MoveRight color={colors.accent} size={22} />
              <Text style={styles.bottomBarBtnText}>移动</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottomBarBtn} onPress={() => openPicker('copy', fileList.filter(f => selected.has(f.href)))}>
              <Copy color={colors.accent} size={22} />
              <Text style={styles.bottomBarBtnText}>复制</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottomBarBtn} onPress={openDetail}>
              <Info color={colors.amber} size={22} />
              <Text style={styles.bottomBarBtnText}>详情</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 全屏沉浸式预览控件（即时阅读器） */}
      <Modal visible={!!previewItem} transparent={true} animationType="fade" onRequestClose={() => setPreviewItem(null)}>
        <View style={styles.previewContainer}>
          <View style={styles.previewHeader}>
            <TouchableOpacity onPress={() => setPreviewItem(null)} style={styles.previewCloseBtn}>
              <X color="#ffffff" size={24} />
            </TouchableOpacity>
            <Text style={styles.previewTitle} numberOfLines={1}>{previewItem?.name}</Text>
            <TouchableOpacity onPress={() => handleDownload(previewItem)} style={styles.previewDownloadBtn}>
              <DownloadCloud color="#3b82f6" size={24} />
            </TouchableOpacity>
          </View>

          <View style={styles.previewContent}>
            {previewItem && videoState.uri ? (
              <Video source={{ uri: videoState.uri }} style={styles.previewVideo} useNativeControls resizeMode="contain" shouldPlay />
            ) : previewItem && videoState.loading ? (
              <View style={styles.previewFallback}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.previewFallbackName}>正在加载视频…</Text>
              </View>
            ) : previewItem && isImageFile(previewItem.name) ? (
              <Image source={{ uri: getDirectUrl(previewItem.href), headers: authHeaders() }} style={styles.previewImage} resizeMode="contain" />
            ) : previewItem && textState ? (
              textState.loading ? (
                <View style={styles.previewFallback}>
                  <ActivityIndicator size="large" color={colors.accent} />
                  <Text style={styles.previewFallbackName}>正在加载文本…</Text>
                </View>
              ) : (
                <View style={styles.textEditorWrap}>
                  <ScrollView style={styles.textScroll} keyboardShouldPersistTaps="handled">
                    <TextInput
                      style={styles.textEditor}
                      multiline
                      value={textState.content}
                      onChangeText={(t) => setTextState(prev => (prev ? { ...prev, content: t } : prev))}
                      editable={!textState.saving}
                      textAlignVertical="top"
                      placeholder="文本内容"
                      placeholderTextColor={colors.muted}
                    />
                  </ScrollView>
                  <TouchableOpacity style={[styles.previewBigDownloadBtn, { backgroundColor: colors.accent, marginTop: 12 }]} onPress={saveTextPreview}>
                    <Save color="#ffffff" size={20} />
                    <Text style={styles.previewBigDownloadText}>{textState.saving ? '保存中…' : '保存到服务器'}</Text>
                  </TouchableOpacity>
                </View>
              )
            ) : (
              <View style={styles.previewFallback}>
                <File color="#4b5563" size={80} style={{ marginBottom: 20 }} />
                <Text style={styles.previewFallbackName}>{previewItem?.name}</Text>
                <Text style={styles.previewFallbackSize}>{formatBytes(previewItem?.size)}</Text>
                <TouchableOpacity style={styles.previewBigDownloadBtn} onPress={() => handleDownload(previewItem)}>
                  <Download color="#ffffff" size={20} />
                  <Text style={styles.previewBigDownloadText}>下载到手机查看</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* 右上角下拉菜单 */}
      <Modal visible={isMenuVisible} transparent={true} animationType="fade" onRequestClose={() => setIsMenuVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setIsMenuVisible(false)}>
          <View style={styles.dropdownMenu}>
            <TouchableOpacity style={styles.menuItem} onPress={handleUpload}>
              <UploadCloud color={colors.text} size={20} /><Text style={styles.menuText}>上传文件</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); Alert.alert('提示', '新建功能开发中'); }}>
              <FolderPlus color={colors.text} size={20} /><Text style={styles.menuText}>新建文件夹</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.menuItem} onPress={disconnect}>
              <LogOut color={colors.red} size={20} /><Text style={[styles.menuText, { color: colors.red }]}>断开 WebDAV</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* 文件详情（底部操作栏「详情」触发） */}
      <Modal visible={!!detailItem} transparent={true} animationType="fade" onRequestClose={() => setDetailItem(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setDetailItem(null)}>
          <View style={styles.actionSheet}>
            <View style={styles.detailHeader}>
              {detailItem?.isFolder
                ? <Folder color={colors.accent} size={40} fill="rgba(59, 130, 246, 0.2)" />
                : <File color={colors.sub} size={40} />}
              <Text style={styles.detailName} numberOfLines={2}>{detailItem?.name}</Text>
            </View>
            <View style={styles.detailRows}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>类型</Text>
                <Text style={styles.detailValue}>{detailItem?.isFolder ? '文件夹' : '文件'}</Text>
              </View>
              {!detailItem?.isFolder && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>大小</Text>
                  <Text style={styles.detailValue}>{formatBytes(detailItem?.size)}</Text>
                </View>
              )}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>路径</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{detailItem?.href}</Text>
              </View>
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
                <Text style={styles.detailLabel}>下级数量</Text>
                <Text style={styles.detailValue}>
                  {detailItem?.isFolder
                    ? (detailInfo?.isCounting ? '统计中…' : (detailInfo?.childCount ?? 0) + ' 项')
                    : '-'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>修改时间</Text>
                <Text style={styles.detailValue}>{detailItem?.mtime || '未知'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>路径</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{detailItem?.href}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.actionSheetCancel} onPress={() => setDetailItem(null)}>
              <Text style={styles.actionSheetCancelText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* 重命名对话框 */}
      <Modal visible={!!renameItem} transparent={true} animationType="fade" onRequestClose={() => setRenameItem(null)}>
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
                <Text style={[styles.renameBtnText, { color: '#ffffff' }]}>确定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 目标目录选择器（复制 / 移动） */}
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
                <Text style={styles.pickerFolderName}>返回上级</Text>
              </TouchableOpacity>
              {pickerFolders.length === 0 ? (
                <View style={styles.listCenter}><Text style={styles.emptyText}>此目录下没有子文件夹</Text></View>
              ) : (
                pickerFolders.map((folder, index) => (
                  <TouchableOpacity key={index} style={styles.pickerRow} onPress={() => pickerEnter(folder)}>
                    <FolderOpen color={colors.accent} size={20} />
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

      {/* 传输任务中心 */}
      <Modal visible={isTransferVisible} animationType="slide" onRequestClose={() => setIsTransferVisible(false)}>
        <View style={styles.transferModal}>
          <View style={styles.transferHeader}>
            <Text style={styles.transferTitle}>传输任务</Text>
            <TouchableOpacity onPress={() => setIsTransferVisible(false)}><Text style={styles.closeText}>关闭</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.transferContent}>
            {transfers.length === 0 ? (
              <View style={[styles.listCenter, { marginTop: 100 }]}><ArrowDownUp color={colors.divider} size={48} style={{ marginBottom: 16 }} /><Text style={styles.emptyText}>没有传输任务</Text></View>
            ) : (
              transfers.map((item) => (
                <View key={item.id} style={styles.transferRow}>
                  <View style={styles.transferIconBox}>{item.type === '上传' ? <UploadCloud color={colors.amber} size={20} /> : <DownloadCloud color={colors.green} size={20} />}</View>
                  <View style={styles.transferInfo}>
                    <Text style={styles.transferName} numberOfLines={1}>{item.name}</Text>
                    <Text style={[styles.transferStatus, { color: item.status.includes('成功') ? colors.green : item.status.includes('失败') ? colors.red : colors.accent }]}>{item.type} - {item.status}</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 20 },
  setupCard: { backgroundColor: colors.card, borderRadius: 16, padding: 24, elevation: 5 },
  setupTitle: { color: colors.textStrong, fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  setupSub: { color: colors.sub, fontSize: 13, textAlign: 'center', marginBottom: 24 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderRadius: 8, marginBottom: 16, paddingHorizontal: 12 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: colors.textStrong, height: 50, fontSize: 16 },
  saveBtn: { backgroundColor: colors.accent, height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },

  headerBtnLeft: { marginLeft: 8, padding: 4 },
  headerBtnGroupRight: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  transferIconBtn: { backgroundColor: 'rgba(59, 130, 246, 0.15)', padding: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.3)' },

  fileContainer: { flex: 1, backgroundColor: colors.bg },
  listCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 300 },
  emptyText: { color: colors.muted, fontSize: 16 },
  listScroll: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 110 },
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, padding: 12, borderRadius: 12, marginBottom: 8 },
  fileRowSelected: { borderWidth: 1.5, borderColor: colors.accent },
  checkbox: { marginLeft: 10, justifyContent: 'center', alignItems: 'center' },
  fileIconBox: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.input, borderRadius: 8, marginRight: 12 },
  fileInfo: { flex: 1, justifyContent: 'center' },
  fileName: { color: colors.text, fontSize: 15, fontWeight: '500' },
  fileSize: { color: colors.sub, fontSize: 12, marginTop: 4 },

  // 多选底部操作栏
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 24 : 12, paddingHorizontal: 12, elevation: 8 },
  bottomBarTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginBottom: 8 },
  bottomBarCount: { color: colors.text, fontSize: 13, fontWeight: 'bold' },
  bottomBarSelectAll: { color: colors.accent, fontSize: 14, fontWeight: 'bold' },
  bottomBarBtns: { flexDirection: 'row', justifyContent: 'space-around' },
  bottomBarBtn: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  bottomBarBtnText: { color: colors.text, fontSize: 12, marginTop: 4, fontWeight: 'bold' },

  // 预览控件
  previewContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 20, paddingHorizontal: 16, paddingBottom: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
  previewCloseBtn: { padding: 8 },
  previewDownloadBtn: { padding: 8 },
  previewTitle: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', flex: 1, textAlign: 'center', paddingHorizontal: 10 },
  previewContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  previewVideo: { width: '100%', height: '100%' },
  previewImage: { width: '100%', height: '100%' },
  previewFallback: { alignItems: 'center', padding: 40, width: '100%' },
  previewFallbackName: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  previewFallbackSize: { color: '#9ca3af', fontSize: 14, marginBottom: 40 },
  previewBigDownloadBtn: { flexDirection: 'row', backgroundColor: '#3b82f6', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 30, alignItems: 'center' },
  previewBigDownloadText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  textEditorWrap: { flex: 1, width: '100%', padding: 16 },
  textScroll: { flex: 1 },
  textEditor: { color: colors.text, fontSize: 14, lineHeight: 22, minHeight: 300, textAlignVertical: 'top' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  dropdownMenu: { position: 'absolute', top: Platform.OS === 'ios' ? 100 : 60, right: 16, backgroundColor: colors.card, borderRadius: 12, padding: 8, width: 200, elevation: 5 },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  menuText: { color: colors.text, fontSize: 16, marginLeft: 12 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },

  // 详情弹窗
  actionSheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20 },
  detailHeader: { alignItems: 'center', marginBottom: 16 },
  detailName: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginTop: 10 },
  detailRows: { backgroundColor: colors.input, borderRadius: 12, padding: 12, marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  detailLabel: { color: colors.sub, fontSize: 13, width: 56 },
  detailValue: { color: colors.text, fontSize: 13, flex: 1, textAlign: 'right' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  actionBtn: { width: '30%', alignItems: 'center', backgroundColor: colors.input, borderRadius: 12, paddingVertical: 14, marginBottom: 10 },
  actionBtnDanger: { backgroundColor: 'rgba(239, 68, 68, 0.12)' },
  actionBtnText: { color: colors.text, fontSize: 12, marginTop: 6, fontWeight: 'bold' },
  actionSheetCancel: { alignItems: 'center', backgroundColor: colors.input, borderRadius: 12, paddingVertical: 14, marginTop: 6 },
  actionSheetCancelText: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold' },

  // 重命名
  renameBox: { backgroundColor: colors.card, borderRadius: 16, padding: 20, margin: 24 },
  renameTitle: { color: colors.textStrong, fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },
  renameInput: { backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 12, height: 48, color: colors.textStrong, fontSize: 16, marginBottom: 16 },
  renameBtns: { flexDirection: 'row', justifyContent: 'space-between' },
  renameBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginHorizontal: 6 },
  renameBtnText: { color: colors.text, fontSize: 15, fontWeight: 'bold' },

  // 目标目录选择器
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

  transferModal: { flex: 1, backgroundColor: colors.bg },
  transferHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 20, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.divider },
  transferTitle: { color: colors.textStrong, fontSize: 18, fontWeight: 'bold' },
  closeText: { color: colors.accent, fontSize: 16 },
  transferContent: { padding: 16 },
  transferRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, padding: 16, borderRadius: 12, marginBottom: 12 },
  transferIconBox: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.input, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  transferInfo: { flex: 1 },
  transferName: { color: colors.text, fontSize: 16, fontWeight: '500', marginBottom: 4 },
  transferStatus: { fontSize: 13, fontWeight: 'bold' },
});