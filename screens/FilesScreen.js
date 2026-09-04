import React, { useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, ScrollView, Modal, BackHandler, Pressable, RefreshControl, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Folder, Save, Server, Key, User, File, ChevronLeft, LogOut, HardDrive, Plus, ArrowDownUp,
  FolderPlus, FilePlus, UploadCloud, DownloadCloud, X, Download, Pencil, Copy, MoveRight,
  Trash2, Check, Circle, CheckCircle, ArrowUp, FolderUp, FolderOpen,
} from 'lucide-react-native';
import base64 from 'base-64';
import { XMLParser } from 'fast-xml-parser';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../ThemeContext';

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

  // 弹窗与传输状态
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isTransferVisible, setIsTransferVisible] = useState(false);
  const [transfers, setTransfers] = useState([]);

  // 💡 预览控件状态
  const [previewItem, setPreviewItem] = useState(null);

  // ============================================
  // 💡 新增：多选模式
  // ============================================
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState(new Set());

  // 💡 新增：长按操作菜单（单文件）
  const [actionItem, setActionItem] = useState(null);

  // 💡 新增：重命名
  const [renameItem, setRenameItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // 💡 新增：目标目录选择器（用于复制 / 移动）
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState(null); // 'copy' | 'move'
  const [pickerItems, setPickerItems] = useState([]); // 要操作的文件列表
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

  const testConnection = async () => {
    if (!davUrl || !username || !password) { Alert.alert('提示', '请完整填写信息'); return; }
    let cleanUrl = davUrl.trim();
    if (!cleanUrl.endsWith('/')) cleanUrl += '/';

    setIsTesting(true);
    try {
      const credentials = base64.encode(`${username}:${password}`);
      const headers = { 'Authorization': `Basic ${credentials}`, 'Depth': '1', 'Content-Type': 'application/xml' };
      let response = await fetch(cleanUrl, { method: 'PROPFIND', headers });

      if (response.status === 405 && !cleanUrl.endsWith('/dav/')) {
        const alistUrl = cleanUrl + 'dav/';
        let retryResponse = await fetch(alistUrl, { method: 'PROPFIND', headers });
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
      const originMatch = davUrl.match(/^(https?:\/\/[^\/]+)/);
      const fullUrl = (originMatch ? originMatch[1] : '') + targetPath;
      const credentials = base64.encode(`${username}:${password}`);
      const response = await fetch(fullUrl, {
        method: 'PROPFIND',
        headers: { 'Authorization': `Basic ${credentials}`, 'Depth': '1', 'Content-Type': 'application/xml' },
      });

      const xmlText = await response.text();
      const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
      const result = parser.parse(xmlText);

      let responses = result?.multistatus?.response;
      if (!responses) { setFileList([]); setCurrentPath(targetPath); return; }
      if (!Array.isArray(responses)) responses = [responses];

      let parsedFiles = [];
      responses.forEach((res) => {
        let href = res.href;
        if (href.startsWith('http')) {
          const hMatch = href.match(/^https?:\/\/[^\/]+(.*)$/);
          href = hMatch ? hMatch[1] : href;
        }
        if (href === targetPath || href === targetPath + '/') return;

        const props = res.propstat?.prop || (Array.isArray(res.propstat) ? res.propstat[0].prop : {});
        const isFolder = props.resourcetype && props.resourcetype.collection === '';
        let displayName = props.displayname;

        if (!displayName) {
          const parts = href.split('/').filter(p => p !== '');
          displayName = parts[parts.length - 1];
          try { displayName = decodeURIComponent(displayName); } catch(e){}
        }

        parsedFiles.push({ name: displayName, href: href, isFolder: isFolder, size: props.getcontentlength || 0 });
      });

      parsedFiles.sort((a, b) => {
        if (a.isFolder === b.isFolder) return a.name.localeCompare(b.name);
        return a.isFolder ? -1 : 1;
      });

      setFileList(parsedFiles);
      setCurrentPath(targetPath);
    } catch (error) { Alert.alert('错误', '读取目录失败'); } finally { setIsLoadingList(false); }
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

  useEffect(() => {
    const onBackPress = () => {
      // 💡 如果预览开着，按返回键先关预览
      if (previewItem) { setPreviewItem(null); return true; }
      // 💡 多选模式优先退出多选
      if (multiSelect) { exitMultiSelect(); return true; }
      if (pickerVisible) { setPickerVisible(false); return true; }
      if (renameItem) { setRenameItem(null); return true; }
      if (actionItem) { setActionItem(null); return true; }
      if (isConnected && !isAtRoot) { goBack(); return true; }
      return false;
    };
    BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => BackHandler.removeEventListener('hardwareBackPress', onBackPress);
  }, [isConnected, isAtRoot, goBack, previewItem, multiSelect, pickerVisible, renameItem, actionItem]);

  const disconnect = async () => {
    await AsyncStorage.removeItem('@dav_pass');
    setIsMenuVisible(false);
    setIsConnected(false);
    exitMultiSelect();
  };

  // ============================================
  // 💡 多选相关
  // ============================================
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

  const handleFileClick = (item) => {
    // 💡 多选模式下：点击行切换选中状态
    if (multiSelect) { toggleSelect(item); return; }
    if (item.isFolder) {
      fetchDirectory(item.href);
    } else {
      setPreviewItem(item); // 直接预览
    }
  };

  // ============================================
  // 💡 长按操作菜单（单文件）
  // ============================================
  const openActionMenu = (item) => {
    // 长按：如果尚未多选，进入多选并选中；同时弹出操作菜单
    if (!multiSelect) {
      setMultiSelect(true);
      setSelected(new Set([item.href]));
    }
    setActionItem(item);
  };

  // ============================================
  // 💡 上传 / 下载 / 删除
  // ============================================
  const handleUpload = async () => {
    setIsMenuVisible(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];

        const newTransfer = { id: Date.now(), name: file.name, type: '上传', status: '正在传输...' };
        setTransfers(prev => [newTransfer, ...prev]);
        setIsTransferVisible(true);

        const originMatch = davUrl.match(/^(https?:\/\/[^\/]+)/);
        const origin = originMatch ? originMatch[1] : '';
        const targetDir = currentPath.endsWith('/') ? currentPath : currentPath + '/';
        const uploadUrl = origin + targetDir + encodeURIComponent(file.name);

        const credentials = base64.encode(`${username}:${password}`);

        const uploadRes = await FileSystem.uploadAsync(uploadUrl, file.uri, {
          httpMethod: 'PUT',
          headers: { 'Authorization': `Basic ${credentials}` },
        });

        if (uploadRes.status === 201 || uploadRes.status === 204 || uploadRes.status === 200) {
          setTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: '✅ 成功' } : t));
          fetchDirectory(currentPath);
        } else {
          setTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: `❌ 失败 (${uploadRes.status})` } : t));
        }
      }
    } catch (error) {
      Alert.alert('上传失败', error.message);
    }
  };

  const handleDownload = async (item) => {
    try {
      const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) {
        Alert.alert('已取消', '你需要授权一个文件夹才能保存文件');
        return;
      }
      setPreviewItem(null); // 关闭预览界面

      const newTransfer = { id: Date.now(), name: item.name, type: '下载', status: '正在传输...' };
      setTransfers(prev => [newTransfer, ...prev]);
      setIsTransferVisible(true);

      const originMatch = davUrl.match(/^(https?:\/\/[^\/]+)/);
      const downloadUrl = (originMatch ? originMatch[1] : '') + item.href;
      const credentials = base64.encode(`${username}:${password}`);

      const localUri = FileSystem.cacheDirectory + encodeURIComponent(item.name);
      const downloadRes = await FileSystem.downloadAsync(downloadUrl, localUri, {
        headers: { 'Authorization': `Basic ${credentials}` }
      });

      const base64Data = await FileSystem.readAsStringAsync(downloadRes.uri, { encoding: FileSystem.EncodingType.Base64 });
      const newFileUri = await FileSystem.StorageAccessFramework.createFileAsync(permissions.directoryUri, item.name, 'application/octet-stream');
      await FileSystem.writeAsStringAsync(newFileUri, base64Data, { encoding: FileSystem.EncodingType.Base64 });

      setTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: '✅ 成功' } : t));
    } catch (error) {
      Alert.alert('下载失败', '网络连接中断');
      setTransfers(prev => prev.map(t => t.name === item.name && t.status === '正在传输...' ? { ...t, status: '❌ 失败' } : t));
    }
  };

  const doDelete = async (item) => {
    try {
      const originMatch = davUrl.match(/^(https?:\/\/[^\/]+)/);
      const origin = originMatch ? originMatch[1] : '';
      const deleteUrl = origin + item.href;
      const credentials = base64.encode(`${username}:${password}`);

      const res = await fetch(deleteUrl, { method: 'DELETE', headers: { 'Authorization': `Basic ${credentials}` } });

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
          if (ok) setActionItem(null);
        }
      }
    ]);
  };

  // 💡 多选批量删除
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

  // ============================================
  // 💡 重命名（WebDAV MOVE 到同目录新名）
  // ============================================
  const openRename = (item) => {
    setActionItem(null);
    setRenameItem(item);
    setRenameValue(item.name);
  };

  const confirmRename = async () => {
    const newName = renameValue.trim();
    if (!newName) return;
    if (newName === renameItem.name) { setRenameItem(null); return; }

    try {
      const originMatch = davUrl.match(/^(https?:\/\/[^\/]+)/);
      const origin = originMatch ? originMatch[1] : '';
      const sourceUrl = origin + renameItem.href;

      // 目标 = 源文件所在目录 + 新文件名
      const srcPath = renameItem.href.endsWith('/') ? renameItem.href.slice(0, -1) : renameItem.href;
      const parentDir = srcPath.substring(0, srcPath.lastIndexOf('/') + 1);
      const destUrl = origin + parentDir + encodeURIComponent(newName);

      const credentials = base64.encode(`${username}:${password}`);
      const res = await fetch(sourceUrl, {
        method: 'MOVE',
        headers: { 'Destination': destUrl, 'Authorization': `Basic ${credentials}` },
      });

      if (res.status === 201 || res.status === 204 || res.status === 200) {
        setRenameItem(null);
        fetchDirectory(currentPath);
      } else {
        Alert.alert('重命名失败', `服务器拒绝执行 (HTTP ${res.status})`);
      }
    } catch (error) { Alert.alert('重命名出错', error.message); }
  };

  // ============================================
  // 💡 目标目录选择器（用于复制 / 移动）
  // ============================================
  const openPicker = async (mode, items) => {
    setPickerMode(mode);
    setPickerItems(items);
    setActionItem(null);
    exitMultiSelect();
    setPickerVisible(true);
    setPickerPath(rootPath);
    await loadPickerFolders(rootPath);
  };

  const loadPickerFolders = async (path) => {
    setPickerLoading(true);
    try {
      const originMatch = davUrl.match(/^(https?:\/\/[^\/]+)/);
      const fullUrl = (originMatch ? originMatch[1] : '') + path;
      const credentials = base64.encode(`${username}:${password}`);
      const response = await fetch(fullUrl, {
        method: 'PROPFIND',
        headers: { 'Authorization': `Basic ${credentials}`, 'Depth': '1', 'Content-Type': 'application/xml' },
      });
      const xmlText = await response.text();
      const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
      const result = parser.parse(xmlText);
      let responses = result?.multistatus?.response;
      if (!responses) { setPickerFolders([]); setPickerPath(path); return; }
      if (!Array.isArray(responses)) responses = [responses];

      const folders = [];
      responses.forEach((res) => {
        let href = res.href;
        if (href.startsWith('http')) {
          const hMatch = href.match(/^https?:\/\/[^\/]+(.*)$/);
          href = hMatch ? hMatch[1] : href;
        }
        if (href === path || href === path + '/') return;
        const props = res.propstat?.prop || (Array.isArray(res.propstat) ? res.propstat[0].prop : {});
        const isFolder = props.resourcetype && props.resourcetype.collection === '';
        if (!isFolder) return;
        let displayName = props.displayname;
        if (!displayName) {
          const parts = href.split('/').filter(p => p !== '');
          displayName = parts[parts.length - 1];
          try { displayName = decodeURIComponent(displayName); } catch(e){}
        }
        folders.push({ name: displayName, href: href });
      });
      folders.sort((a, b) => a.name.localeCompare(b.name));
      setPickerFolders(folders);
      setPickerPath(path);
    } catch (error) {
      Alert.alert('错误', '读取目录失败');
    } finally { setPickerLoading(false); }
  };

  const pickerGoUp = () => {
    if (pickerPath === rootPath || pickerPath === rootPath + '/') return;
    let p = pickerPath.endsWith('/') ? pickerPath.slice(0, -1) : pickerPath;
    loadPickerFolders(p.substring(0, p.lastIndexOf('/') + 1));
  };

  const pickerEnter = (folder) => {
    loadPickerFolders(folder.href);
  };

  // 判断目标目录是否等于某个源文件所在目录（禁止原地移动/复制）
  const isSameDir = (item) => {
    const srcPath = item.href.endsWith('/') ? item.href.slice(0, -1) : item.href;
    const parentDir = srcPath.substring(0, srcPath.lastIndexOf('/') + 1);
    const target = pickerPath.endsWith('/') ? pickerPath : pickerPath + '/';
    return parentDir === target;
  };

  const confirmPicker = async () => {
    const targetPath = pickerPath.endsWith('/') ? pickerPath : pickerPath + '/';
    // 检查是否有源文件与被选目录相同（原地操作冲突）
    const conflict = pickerItems.filter(it => isSameDir(it));
    if (conflict.length > 0) {
      Alert.alert('无法操作', `目标目录与部分文件的当前位置相同，请先选择其他目录或重命名后再试。`);
      return;
    }
    setPickerVisible(false);
    setPickerLoading(true);
    try {
      const originMatch = davUrl.match(/^(https?:\/\/[^\/]+)/);
      const origin = originMatch ? originMatch[1] : '';
      const credentials = base64.encode(`${username}:${password}`);
      const method = pickerMode === 'move' ? 'MOVE' : 'COPY';
      let successCount = 0;
      for (const item of pickerItems) {
        const sourceUrl = origin + item.href;
        const destUrl = origin + targetPath + encodeURIComponent(item.name);
        try {
          const res = await fetch(sourceUrl, {
            method,
            headers: { 'Destination': destUrl, 'Authorization': `Basic ${credentials}` },
          });
          if (res.status === 201 || res.status === 204 || res.status === 200) successCount++;
        } catch (e) {}
      }
      if (successCount > 0) {
        Alert.alert('操作完成', `${pickerMode === 'move' ? '移动' : '复制'}完成 ${successCount} 个项`);
        fetchDirectory(currentPath);
      } else {
        Alert.alert('操作失败', '服务器拒绝了所有请求，请检查权限。');
      }
    } catch (error) {
      Alert.alert('操作失败', error.message);
    } finally { setPickerLoading(false); }
  };

  // 💡 辅助函数：判断是不是图片
  const isImageFile = (filename) => {
    return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);
  };

  // 💡 辅助函数：获取文件的直链下载地址
  const getDirectUrl = (href) => {
    const originMatch = davUrl.match(/^(https?:\/\/[^\/]+)/);
    return (originMatch ? originMatch[1] : '') + href;
  };

  useLayoutEffect(() => {
    if (!isConnected) {
      navigation.setOptions({ title: '连接文件库', headerLeft: null, headerRight: null });
      return;
    }

    const pathParts = currentPath.split('/').filter(Boolean);
    const titleName = isAtRoot ? '根目录' : decodeURIComponent(pathParts[pathParts.length - 1]);

    // 💡 多选模式下标题显示选中数，并隐藏右上角菜单
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
                  onLongPress={() => openActionMenu(item)}
                  delayLongPress={450}
                >
                  {/* 💡 左侧多选框 */}
                  <TouchableOpacity
                    style={styles.checkbox}
                    onPress={() => { if (!multiSelect) setMultiSelect(true); toggleSelect(item); }}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                  >
                    {sel
                      ? <CheckCircle color={colors.accent} size={22} />
                      : <Circle color={multiSelect ? colors.accent : colors.muted} size={22} />}
                  </TouchableOpacity>

                  <View style={styles.fileIconBox}>
                    {item.isFolder ? <Folder color={colors.accent} size={24} fill="rgba(59, 130, 246, 0.2)" /> : <File color={colors.sub} size={24} />}
                  </View>
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                    {!item.isFolder && <Text style={styles.fileSize}>{formatBytes(item.size)}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* 💡 多选底部操作栏 */}
      {multiSelect && (
        <View style={styles.bottomBar}>
          <View style={styles.bottomBarTop}>
            <Text style={styles.bottomBarCount}>已选 {selected.size} 项</Text>
            <TouchableOpacity onPress={toggleSelectAll}>
              <Text style={styles.bottomBarSelectAll}>{selected.size === fileList.length ? '取消全选' : '全选'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.bottomBarBtns}>
            <TouchableOpacity style={styles.bottomBarBtn} onPress={() => openPicker('move', fileList.filter(f => selected.has(f.href)))}>
              <MoveRight color={colors.accent} size={22} />
              <Text style={styles.bottomBarBtnText}>移动</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottomBarBtn} onPress={() => openPicker('copy', fileList.filter(f => selected.has(f.href)))}>
              <Copy color={colors.accent} size={22} />
              <Text style={styles.bottomBarBtnText}>复制</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottomBarBtn} onPress={handleBatchDelete}>
              <Trash2 color={colors.red} size={22} />
              <Text style={[styles.bottomBarBtnText, { color: colors.red }]}>删除</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ========================================== */}
      {/* 🚀 全屏沉浸式预览控件 */}
      {/* ========================================== */}
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
            {previewItem && isImageFile(previewItem.name) ? (
              <Image
                source={{
                  uri: getDirectUrl(previewItem.href),
                  headers: { 'Authorization': `Basic ${base64.encode(`${username}:${password}`)}` }
                }}
                style={styles.previewImage}
                resizeMode="contain"
              />
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

      {/* --- 右上角下拉菜单 --- */}
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

      {/* --- 长按操作菜单（单文件：删除/下载/重命名/复制/移动） --- */}
      <Modal visible={!!actionItem} transparent={true} animationType="fade" onRequestClose={() => setActionItem(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setActionItem(null)}>
          <View style={styles.actionSheet}>
            <Text style={styles.actionSheetTitle} numberOfLines={1}>{actionItem?.name}</Text>
            <View style={styles.actionGrid}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => { setActionItem(null); handleDownload(actionItem); }}>
                <Download color={colors.accent} size={22} /><Text style={styles.actionBtnText}>下载</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => openRename(actionItem)}>
                <Pencil color={colors.amber} size={22} /><Text style={styles.actionBtnText}>重命名</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => openPicker('copy', [actionItem])}>
                <Copy color={colors.accent} size={22} /><Text style={styles.actionBtnText}>复制</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => openPicker('move', [actionItem])}>
                <MoveRight color={colors.accent} size={22} /><Text style={styles.actionBtnText}>移动</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={() => handleDelete(actionItem)}>
                <Trash2 color={colors.red} size={22} /><Text style={[styles.actionBtnText, { color: colors.red }]}>删除</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.actionSheetCancel} onPress={() => setActionItem(null)}>
              <Text style={styles.actionSheetCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* --- 重命名对话框 --- */}
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

      {/* --- 目标目录选择器（复制 / 移动） --- */}
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
                <FolderUp color={colors.accent} size={20} />
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
              <Text style={styles.pickerConfirmText}>确认{`${pickerMode === 'move' ? '移动' : '复制'}`}到此目录</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* --- 传输任务中心 --- */}
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
  listContent: { padding: 12, paddingBottom: 90 },
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, padding: 12, borderRadius: 12, marginBottom: 8 },
  fileRowSelected: { borderWidth: 1.5, borderColor: colors.accent },
  checkbox: { marginRight: 10, justifyContent: 'center', alignItems: 'center' },
  fileIconBox: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.input, borderRadius: 8, marginRight: 12 },
  fileInfo: { flex: 1, justifyContent: 'center' },
  fileName: { color: colors.text, fontSize: 15, fontWeight: '500' },
  fileSize: { color: colors.sub, fontSize: 12, marginTop: 4 },

  // 💡 多选底部操作栏
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 24 : 12, paddingHorizontal: 12, elevation: 8 },
  bottomBarTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginBottom: 8 },
  bottomBarCount: { color: colors.text, fontSize: 13, fontWeight: 'bold' },
  bottomBarSelectAll: { color: colors.accent, fontSize: 14, fontWeight: 'bold' },
  bottomBarBtns: { flexDirection: 'row', justifyContent: 'space-around' },
  bottomBarBtn: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 18 },
  bottomBarBtnText: { color: colors.text, fontSize: 12, marginTop: 4, fontWeight: 'bold' },

  // 预览控件专属样式
  previewContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 20, paddingHorizontal: 16, paddingBottom: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
  previewCloseBtn: { padding: 8 },
  previewDownloadBtn: { padding: 8 },
  previewTitle: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', flex: 1, textAlign: 'center', paddingHorizontal: 10 },
  previewContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  previewImage: { width: '100%', height: '100%' },

  previewFallback: { alignItems: 'center', padding: 40, width: '100%' },
  previewFallbackName: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  previewFallbackSize: { color: '#9ca3af', fontSize: 14, marginBottom: 40 },
  previewBigDownloadBtn: { flexDirection: 'row', backgroundColor: '#3b82f6', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 30, alignItems: 'center' },
  previewBigDownloadText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', marginLeft: 8 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  dropdownMenu: { position: 'absolute', top: Platform.OS === 'ios' ? 100 : 60, right: 16, backgroundColor: colors.card, borderRadius: 12, padding: 8, width: 200, elevation: 5 },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  menuText: { color: colors.text, fontSize: 16, marginLeft: 12 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },

  // 💡 长按操作菜单（底部 action sheet）
  actionSheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20 },
  actionSheetTitle: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  actionBtn: { width: '30%', alignItems: 'center', backgroundColor: colors.input, borderRadius: 12, paddingVertical: 14, marginBottom: 10 },
  actionBtnDanger: { backgroundColor: 'rgba(239, 68, 68, 0.12)' },
  actionBtnText: { color: colors.text, fontSize: 12, marginTop: 6, fontWeight: 'bold' },
  actionSheetCancel: { alignItems: 'center', backgroundColor: colors.input, borderRadius: 12, paddingVertical: 14, marginTop: 6 },
  actionSheetCancelText: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold' },

  // 💡 重命名对话框
  renameBox: { backgroundColor: colors.card, borderRadius: 16, padding: 20, margin: 24 },
  renameTitle: { color: colors.textStrong, fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },
  renameInput: { backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 12, height: 48, color: colors.textStrong, fontSize: 16, marginBottom: 16 },
  renameBtns: { flexDirection: 'row', justifyContent: 'space-between' },
  renameBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginHorizontal: 6 },
  renameBtnText: { color: colors.text, fontSize: 15, fontWeight: 'bold' },

  // 💡 目标目录选择器
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