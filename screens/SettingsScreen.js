import React, { useState, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Switch, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants'; // 💡 引入动态变量库，用于获取真实版本号
import { X, HardDrive, Settings as SettingsIcon, ShieldCheck, Info, Server, LogOut, Moon, Sun, FolderDown, RefreshCw, Trash2 } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import {
  getDownloadDir, setDownloadDir, resetDownloadDir,
  getCacheSize as getPreviewCacheSize, getCacheLimitBytes, setCacheLimitMB,
  clearCache as clearPreviewCache, getCacheDirPath, formatBytes as fmtBytes,
} from '../utils/cacheManager';

export default function SettingsScreen({ navigation }) {
  const [cacheSize, setCacheSize] = useState('计算中...');
  const [isClearing, setIsClearing] = useState(false);

  // 新增设置状态
  const [unraidUrl, setUnraidUrl] = useState('未连接');
  const [apiToken, setApiToken] = useState('');
  // 文件服务器（WebDAV）配置状态
  const [davUrl, setDavUrl] = useState('');
  const [davUser, setDavUser] = useState('');
  const [davPass, setDavPass] = useState('');
  // 下载与缓存设置
  const [downloadDir, setDownloadDirState] = useState(null);
  const [cacheLimitMB, setCacheLimitMBState] = useState(500);
  const [cacheSizeBytes, setCacheSizeBytes] = useState(0);
  const [limitVisible, setLimitVisible] = useState(false);
  const [limitValue, setLimitValue] = useState('');
  const [serverEditVisible, setServerEditVisible] = useState(false);
  const [serverEditField, setServerEditField] = useState('url');
  const [serverInput, setServerInput] = useState('');

  // 💡 全局主题（由 ThemeProvider 管理，切换即时全局生效并自动持久化）
  const { isDark, colors, toggleTheme } = useTheme();

  // 💡 动态生成跟随主题的样式
  const styles = useMemo(() => createStyles(colors), [colors]);

  // 💡 动态获取 app.json 中的真实版本号，获取不到则默认 1.0.0
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getCacheSize = async () => {
    try {
      const cacheDir = FileSystem.cacheDirectory;
      const files = await FileSystem.readDirectoryAsync(cacheDir);
      let totalSize = 0;
      for (const file of files) {
        const fileInfo = await FileSystem.getInfoAsync(cacheDir + file);
        if (!fileInfo.isDirectory && fileInfo.size) totalSize += fileInfo.size;
      }
      setCacheSize(formatBytes(totalSize));
    } catch (error) { setCacheSize('0 B'); }
  };

  // 💡 加载下载目录 + 缓存设置
  const loadSettings = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      if (savedUrl) setUnraidUrl(savedUrl);
      const token = await AsyncStorage.getItem('@api_token');
      if (token) setApiToken(token);
      // 文件服务器（WebDAV）配置
      const dUrl = await AsyncStorage.getItem('@dav_url');
      const dUser = await AsyncStorage.getItem('@dav_user');
      const dPass = await AsyncStorage.getItem('@dav_pass');
      if (dUrl) setDavUrl(dUrl);
      if (dUser) setDavUser(dUser);
      if (dPass) setDavPass(dPass);

      const dir = await getDownloadDir();
      setDownloadDirState(dir);

      const limitBytes = await getCacheLimitBytes();
      setCacheLimitMBState(Math.round(limitBytes / 1024 / 1024));

      const bytes = await getPreviewCacheSize();
      setCacheSizeBytes(bytes);
      setCacheSize(fmtBytes(bytes));
    } catch (e) { console.log(e); }
  };

  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [])
  );

  // 💡 选择下载目录（SAF 授权，软件仅能访问此目录）
  const chooseDownloadDir = async () => {
    try {
      const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (perm.granted && perm.directoryUri) {
        await setDownloadDir(perm.directoryUri, '已授权目录');
        setDownloadDirState({ uri: perm.directoryUri, name: '已授权目录', configured: true });
        Alert.alert('设置成功', '已将下载目录指向你授权的文件夹。');
      } else {
        Alert.alert('已取消', '未授权任何文件夹。');
      }
    } catch (e) { Alert.alert('失败', e.message); }
  };

  // 💡 恢复默认下载目录
  const resetDownloadDirHandler = async () => {
    await resetDownloadDir();
    const dir = await getDownloadDir();
    setDownloadDirState(dir);
    Alert.alert('已恢复', '下载位置已恢复为应用默认目录。');
  };

  // 💡 清理预览缓存
  const clearPreviewCacheHandler = async () => {
    Alert.alert('清理预览缓存', '确定要清除所有预览缓存文件吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '彻底清除', style: 'destructive',
        onPress: async () => {
          setIsClearing(true);
          try {
            await clearPreviewCache();
            const bytes = await getPreviewCacheSize();
            setCacheSizeBytes(bytes);
            setCacheSize(fmtBytes(bytes));
            Alert.alert('清理完成', '预览缓存已清空！');
          } catch (e) { Alert.alert('清理失败', e.message); }
          finally { setIsClearing(false); }
        }
      }
    ]);
  };

  // 💡 调整缓存上限
  const openLimitInput = () => {
    setLimitValue(String(cacheLimitMB));
    setLimitVisible(true);
  };
  const confirmLimitInput = async () => {
    const n = parseInt(limitValue, 10);
    if (isNaN(n) || n <= 0) { Alert.alert('无效', '请输入有效的正整数（MB）'); return; }
    const saved = await setCacheLimitMB(n);
    setCacheLimitMBState(saved);
    setLimitVisible(false);
    Alert.alert('已保存', `缓存上限已设为 ${saved} MB，超出时将自动清理最早文件。`);
  };

  const clearCache = async () => {
    Alert.alert('清理缓存', '确定要清除所有预览图片和临时垃圾文件吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '彻底清除', style: 'destructive',
        onPress: async () => {
          setIsClearing(true);
          try {
            const cacheDir = FileSystem.cacheDirectory;
            const files = await FileSystem.readDirectoryAsync(cacheDir);
            for (const file of files) await FileSystem.deleteAsync(cacheDir + file, { idempotent: true });
            await getCacheSize();
            Alert.alert('清理完成', '存储空间已释放！');
          } catch (error) { Alert.alert('清理失败', error.message); }
          finally { setIsClearing(false); }
        }
      }
    ]);
  };

  // 💡 断开 Unraid 服务器连接


  // 💡 修改主服务器连接地址（弹输入框）
  const editServerUrl = () => {
    let prompt = '请输入 Unraid 服务器地址';
    if (Platform.OS === 'ios') {
      Alert.prompt(prompt, undefined, (text) => {
        const v = (text || '').trim();
        let cleanUrl = v;
        if (cleanUrl && !cleanUrl.startsWith('http')) cleanUrl = 'http://' + cleanUrl;
        if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
        AsyncStorage.setItem('@server_url', cleanUrl).then(() => setUnraidUrl(cleanUrl));
      });
    } else {
      // Android 无 Alert.prompt，用自定义 Modal
      setServerInput(unraidUrl);
      setServerEditField('url');
      setServerEditVisible(true);
    }
  };
  const editApiToken = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt('请输入 API Token', undefined, (text) => {
        AsyncStorage.setItem('@api_token', (text || '').trim()).then(() => setApiToken(text || ''));
      });
    } else {
      setServerInput(apiToken);
      setServerEditField('token');
      setServerEditVisible(true);
    }
  };

  // 💡 保存服务器配置修改
  const confirmServerEdit = async () => {
    const v = (serverInput || '').trim();
    if (serverEditField === 'url') {
      let cleanUrl = v;
      if (cleanUrl && !cleanUrl.startsWith('http')) cleanUrl = 'http://' + cleanUrl;
      if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
      await AsyncStorage.setItem('@server_url', cleanUrl);
      setUnraidUrl(cleanUrl);
    } else if (serverEditField === 'token') {
      await AsyncStorage.setItem('@api_token', v);
      setApiToken(v);
    } else if (serverEditField === 'dav_url') {
      let cleanUrl = v;
      if (cleanUrl && !cleanUrl.endsWith('/')) cleanUrl += '/';
      await AsyncStorage.setItem('@dav_url', cleanUrl);
      setDavUrl(cleanUrl);
    } else if (serverEditField === 'dav_user') {
      await AsyncStorage.setItem('@dav_user', v);
      setDavUser(v);
    } else if (serverEditField === 'dav_pass') {
      await AsyncStorage.setItem('@dav_pass', v);
      setDavPass(v);
    }
    setServerEditVisible(false);
    Alert.alert('已保存', '连接配置已更新，重新连接后生效。');
  };

  // 💡 编辑文件服务器字段
  const editDavField = (field) => {
    if (Platform.OS === 'ios') {
      const labels = { url: '文件服务器地址 (WebDAV)', user: '用户名', pass: '密码' };
      const cur = field === 'url' ? davUrl : field === 'user' ? davUser : davPass;
      Alert.prompt(labels[field] || '值', undefined, (text) => {
        let v = text || '';
        if (field === 'url') { if (v && !v.endsWith('/')) v += '/'; AsyncStorage.setItem('@dav_url', v).then(() => setDavUrl(v)); }
        else if (field === 'user') AsyncStorage.setItem('@dav_user', v).then(() => setDavUser(v));
        else AsyncStorage.setItem('@dav_pass', v).then(() => setDavPass(v));
      }, undefined, cur);
    } else {
      setServerInput(field === 'url' ? davUrl : field === 'user' ? davUser : davPass);
      setServerEditField('dav_' + field);
      setServerEditVisible(true);
    }
  };

  const handleUnraidLogout = () => {
    Alert.alert('注销主服务器', '确定要断开与当前 Unraid 系统的连接吗？\n(这不会影响您的 WebDAV 和影音配置)', [
      { text: '取消', style: 'cancel' },
      {
        text: '断开连接', style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('@server_url');
          await AsyncStorage.removeItem('@api_token');
          setUnraidUrl('未连接');
          // 跳转回首页，触发仪表盘的重新登录逻辑
          navigation.navigate('首页');
        }
      }
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      <View style={styles.header}>
        <SettingsIcon color={colors.accent} size={48} style={{ marginBottom: 12 }} />
        <Text style={styles.title}>系统设置</Text>
        {/* 💡 显示真实的动态版本号 */}
        <Text style={styles.subtitle}>Version {appVersion}</Text>
      </View>

      {/* 💡 新增：Unraid 服务器管理面板 */}
      <Text style={styles.sectionTitle}>主控服务器</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.row} onPress={editServerUrl}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}><Server color={colors.accent} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>连接地址</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{unraidUrl || '未设置'}</Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={editApiToken}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}><Key color={colors.purple} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>API Token</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{apiToken ? '••••••••' : '未设置'}</Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={handleUnraidLogout}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}><LogOut color={colors.red} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={[styles.rowTitle, { color: colors.red }]}>断开并重新配置</Text>
            <Text style={styles.rowSub}>清除 API 令牌与连接信息</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>文件服务器 (WebDAV)</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.row} onPress={() => editDavField('url')}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}><FolderDown color={colors.accent} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>WebDAV 地址</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{davUrl || '未设置'}</Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={() => editDavField('user')}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}><User color={colors.green} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>用户名</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{davUser || '未设置'}</Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={() => editDavField('pass')}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}><Key color={colors.amber} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>密码</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{davPass ? '••••••••' : '未设置'}</Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>
      </View>

      {/* 💡 新增：外观与个性化面板（真正的全局主题切换） */}
      <Text style={styles.sectionTitle}>外观与个性化</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)' }]}>
            {isDark ? <Moon color={colors.purple} size={20} /> : <Sun color={colors.amber} size={20} />}
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>深色模式</Text>
            <Text style={styles.rowSub}>{isDark ? '当前：深色主题（护眼沉浸）' : '当前：浅色主题'}</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={(value) => toggleTheme(value)}
            trackColor={{ false: colors.input, true: colors.purple }}
            thumbColor={'#ffffff'}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>下载位置</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconBox}><FolderDown color={colors.accent} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>保存到目录</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{downloadDir ? downloadDir.name : '加载中...'}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.miniBtn} onPress={chooseDownloadDir}>
            <FolderDown color={colors.accent} size={16} /><Text style={styles.miniBtnText}>更改位置</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniBtn} onPress={resetDownloadDirHandler}>
            <RefreshCw color={colors.amber} size={16} /><Text style={styles.miniBtnText}>恢复默认</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sectionTitle}>预览缓存</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconBox}><HardDrive color={colors.green} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>缓存占用</Text>
            <Text style={styles.rowSub}>图片/视频/文本预览缓存</Text>
          </View>
          <Text style={styles.valueText}>{cacheSize}</Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={openLimitInput}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}><Info color={colors.amber} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>缓存上限</Text>
            <Text style={styles.rowSub}>超出自动清理最早文件</Text>
          </View>
          <Text style={styles.valueText}>{cacheLimitMB} MB</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={clearPreviewCacheHandler} disabled={isClearing}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
            {isClearing ? <ActivityIndicator color={colors.red} size="small" /> : <Trash2 color={colors.red} size={20} />}
          </View>
          <View style={styles.infoBox}>
            <Text style={[styles.rowTitle, { color: colors.red }]}>清理预览缓存</Text>
            <Text style={styles.rowSub}>释放存储空间</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>安全与底层协议</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}><ShieldCheck color={colors.accent} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>原生沙盒隔离 (SAF)</Text>
            <Text style={styles.rowSub}>已开启·按需授权访问</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}><Info color={colors.amber} size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>文件系统</Text>
            <Text style={styles.rowSub}>PROPFIND & HTTP Basic Auth</Text>
          </View>
        </View>
      </View>


      {/* 服务器配置编辑输入框 */}
      <Modal visible={serverEditVisible} transparent={true} animationType="fade" onRequestClose={() => setServerEditVisible(false)}>
        <KeyboardAvoidingView style={styles.overlayCenter} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.limitBox}>
            <Text style={styles.limitTitle}>{serverEditField === 'url' ? '连接地址' : serverEditField === 'token' ? 'API Token' : serverEditField === 'dav_url' ? 'WebDAV 地址' : serverEditField === 'dav_user' ? '用户名' : '密码'}</Text>
            <TextInput
              style={styles.limitInput}
              value={serverInput}
              onChangeText={setServerInput}
              autoFocus
              autoCapitalize="none"
              secureTextEntry={serverEditField === 'token' || serverEditField === 'dav_pass'}
              placeholder="请输入"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.renameBtns}>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.input }]} onPress={() => setServerEditVisible(false)}>
                <Text style={styles.renameBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.accent }]} onPress={confirmServerEdit}>
                <Text style={[styles.renameBtnText, { color: '#ffffff' }]}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 缓存上限输入 */}
      <Modal visible={limitVisible} transparent={true} animationType="fade" onRequestClose={() => setLimitVisible(false)}>
        <KeyboardAvoidingView style={styles.overlayCenter} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.limitBox}>
            <Text style={styles.limitTitle}>缓存大小上限 (MB)</Text>
            <TextInput
              style={styles.limitInput}
              keyboardType="numeric"
              value={limitValue}
              onChangeText={setLimitValue}
              autoFocus
              placeholder="例如 500"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.renameBtns}>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.input }]} onPress={() => setLimitVisible(false)}>
                <Text style={styles.renameBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.accent }]} onPress={confirmLimitInput}>
                <Text style={[styles.renameBtnText, { color: '#ffffff' }]}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </ScrollView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  header: { alignItems: 'center', marginVertical: 30 },
  title: { color: colors.textStrong, fontSize: 24, fontWeight: 'bold' },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 4 },

  sectionTitle: { color: colors.sub, fontSize: 14, fontWeight: 'bold', marginLeft: 8, marginBottom: 8, marginTop: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden', elevation: 3 },

  row: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(16, 185, 129, 0.15)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  infoBox: { flex: 1, justifyContent: 'center' },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '500', marginBottom: 4 },
  rowSub: { color: colors.sub, fontSize: 13 },
  valueText: { color: colors.green, fontSize: 16, fontWeight: 'bold' },
  editHint: { color: colors.accent, fontSize: 14, fontWeight: 'bold' },

  divider: { height: 1, backgroundColor: colors.divider, marginLeft: 72 },

  btnRow: { flexDirection: 'row', padding: 12, justifyContent: 'space-around' },
  miniBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  miniBtnText: { color: colors.text, fontSize: 14, fontWeight: 'bold', marginLeft: 6 },

  overlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  limitBox: { backgroundColor: colors.card, borderRadius: 16, padding: 20 },
  limitTitle: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },
  limitInput: { backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 12, height: 48, color: colors.textStrong, fontSize: 16, marginBottom: 16 },
  renameBtns: { flexDirection: 'row', justifyContent: 'space-between' },
  renameBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginHorizontal: 6 },
  renameBtnText: { color: colors.text, fontSize: 15, fontWeight: 'bold' },
});