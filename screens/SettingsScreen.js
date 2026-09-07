import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Alert, ActivityIndicator,
  ScrollView, Switch, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  HardDrive, Settings as SettingsIcon, ShieldCheck, Info, Server,
  LogOut, Moon, Sun, FolderDown, RefreshCw, Trash2, Key, Power,
  RotateCw, AlertTriangle, CheckCircle,
} from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import {
  getDownloadDir, setDownloadDir, resetDownloadDir,
  getCacheSize as getPreviewCacheSize, getCacheLimitBytes, setCacheLimitMB,
  clearCache as clearPreviewCache, formatBytes as fmtBytes,
} from '../utils/cacheManager';

export default function SettingsScreen({ navigation }) {
  const [cacheSize, setCacheSize] = useState('计算中...');
  const [isClearing, setIsClearing] = useState(false);

  // Unraid Server credentials
  const [unraidUrl, setUnraidUrl] = useState('未连接');
  const [apiToken, setApiToken] = useState('');

  // Download & Cache settings
  const [downloadDir, setDownloadDirState] = useState(null);
  const [cacheLimitMB, setCacheLimitMBState] = useState(500);
  const [cacheSizeBytes, setCacheSizeBytes] = useState(0);
  const [limitVisible, setLimitVisible] = useState(false);
  const [limitValue, setLimitValue] = useState('');
  const [serverEditVisible, setServerEditVisible] = useState(false);
  const [serverEditField, setServerEditField] = useState('url');
  const [serverInput, setServerInput] = useState('');

  // Power action state
  const [powerLoading, setPowerLoading] = useState(false);

  const { isDark, colors, toggleTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const loadSettings = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      if (savedUrl) setUnraidUrl(savedUrl);
      const token = await AsyncStorage.getItem('@api_token');
      if (token) setApiToken(token);

      const dir = await getDownloadDir();
      setDownloadDirState(dir);

      const limitBytes = await getCacheLimitBytes();
      setCacheLimitMBState(Math.round(limitBytes / 1024 / 1024));

      const bytes = await getPreviewCacheSize();
      setCacheSizeBytes(bytes);
      setCacheSize(fmtBytes(bytes));
    } catch (e) {
      console.log(e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [])
  );

  // Download directory permissions via SAF
  const chooseDownloadDir = async () => {
    try {
      const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (perm.granted && perm.directoryUri) {
        await setDownloadDir(perm.directoryUri, '已授权目录');
        setDownloadDirState({ uri: perm.directoryUri, name: '已授权目录', configured: true });
        Alert.alert('设置成功', '已将下载目录指向你授权的系统文件夹。');
      } else {
        Alert.alert('已取消', '未授权任何文件夹。');
      }
    } catch (e) {
      Alert.alert('失败', e.message);
    }
  };

  const resetDownloadDirHandler = async () => {
    await resetDownloadDir();
    const dir = await getDownloadDir();
    setDownloadDirState(dir);
    Alert.alert('已恢复', '下载位置已恢复为应用内置默认目录。');
  };

  // Preview cache
  const clearPreviewCacheHandler = async () => {
    Alert.alert('清理预览缓存', '确定要清除所有本地预览缓存文件吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '彻底清除',
        style: 'destructive',
        onPress: async () => {
          setIsClearing(true);
          try {
            await clearPreviewCache();
            const bytes = await getPreviewCacheSize();
            setCacheSizeBytes(bytes);
            setCacheSize(fmtBytes(bytes));
            Alert.alert('清理完成', '本地预览缓存已清空！');
          } catch (e) {
            Alert.alert('清理失败', e.message);
          } finally {
            setIsClearing(false);
          }
        },
      },
    ]);
  };

  const openLimitInput = () => {
    setLimitValue(String(cacheLimitMB));
    setLimitVisible(true);
  };

  const confirmLimitInput = async () => {
    const n = parseInt(limitValue, 10);
    if (isNaN(n) || n <= 0) {
      Alert.alert('无效', '请输入有效的正整数（MB）');
      return;
    }
    const saved = await setCacheLimitMB(n);
    setCacheLimitMBState(saved);
    setLimitVisible(false);
    Alert.alert('已保存', `缓存上限已设为 ${saved} MB，超出时将自动清理最早缓存。`);
  };

  // Edit Server URL & Token
  const editServerUrl = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt('请输入 Unraid 服务器地址', undefined, (text) => {
        const v = (text || '').trim();
        let cleanUrl = v;
        if (cleanUrl && !cleanUrl.startsWith('http')) cleanUrl = 'http://' + cleanUrl;
        if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
        AsyncStorage.setItem('@server_url', cleanUrl).then(() => setUnraidUrl(cleanUrl));
      });
    } else {
      setServerInput(unraidUrl === '未连接' ? '' : unraidUrl);
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
    }
    setServerEditVisible(false);
    Alert.alert('已保存', '连接配置已实时保存并即时生效！');
  };

  const handleUnraidLogout = () => {
    Alert.alert('注销服务器凭据', '确定要清除当前 Unraid 系统的连接配置吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除并断开',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('@server_url');
          await AsyncStorage.removeItem('@api_token');
          setUnraidUrl('未连接');
          setApiToken('');
          navigation.navigate('首页');
        },
      },
    ]);
  };

  // =========================================================================
  // Server Power Management (Remote Reboot & Shutdown)
  // =========================================================================
  const handleServerReboot = () => {
    if (!unraidUrl || unraidUrl === '未连接' || !apiToken) {
      Alert.alert('未连接', '请先配置有效的服务器连接地址与 API Token。');
      return;
    }

    Alert.alert(
      '⚠️ 确认重启 Unraid 服务器？',
      '服务器将在数秒内开始安全重启流程。系统所有 Docker 容器与虚拟机服务将短暂离线，约需 1~3 分钟恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定重启',
          style: 'destructive',
          onPress: async () => {
            setPowerLoading(true);
            try {
              const res = await fetch(`${unraidUrl}/api.php?token=${apiToken}&action=reboot`);
              const data = await res.json();
              Alert.alert('重启指令已发送', data.message || '服务器正在执行安全重启...');
            } catch (e) {
              Alert.alert('请求异常', e.message);
            } finally {
              setPowerLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleServerPoweroff = () => {
    if (!unraidUrl || unraidUrl === '未连接' || !apiToken) {
      Alert.alert('未连接', '请先配置有效的服务器连接地址与 API Token。');
      return;
    }

    Alert.alert(
      '🚨 危险：确认关闭 Unraid 服务器？',
      '执行关机后，主机将彻底切断电源停止运行！\n\n注意：除非您的服务器主板已配置 WOL (网络唤醒) 或由管理员手动按下物理开机键，否则此 App 将无法再远程唤醒开机！',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '彻底关机',
          style: 'destructive',
          onPress: async () => {
            setPowerLoading(true);
            try {
              const res = await fetch(`${unraidUrl}/api.php?token=${apiToken}&action=poweroff`);
              const data = await res.json();
              Alert.alert('关机指令已发送', data.message || '服务器正在安全关机...');
            } catch (e) {
              Alert.alert('请求异常', e.message);
            } finally {
              setPowerLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <SettingsIcon color={colors.accent} size={48} style={{ marginBottom: 12 }} />
        <Text style={styles.title}>系统控制与设置</Text>
        <Text style={styles.subtitle}>Unraid Manager v{appVersion}</Text>
      </View>

      {/* Unraid Core Server Card */}
      <Text style={styles.sectionTitle}>主控连接凭证</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.row} onPress={editServerUrl}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
            <Server color={colors.accent} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>服务器地址</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{unraidUrl || '未设置'}</Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={editApiToken}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
            <Key color={colors.purple} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>统一 API Token</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{apiToken ? '••••••••' : '未设置'}</Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={handleUnraidLogout}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
            <LogOut color={colors.red} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={[styles.rowTitle, { color: colors.red }]}>清除凭据</Text>
            <Text style={styles.rowSub}>清除本地保存的 API 访问凭据</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Server Power Controls Card */}
      <Text style={styles.sectionTitle}>服务器电源控制</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.row} onPress={handleServerReboot} disabled={powerLoading}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
            <RotateCw color={colors.amber} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={[styles.rowTitle, { color: colors.amber }]}>重启服务器 (Reboot)</Text>
            <Text style={styles.rowSub}>安全重启 Unraid 主机与容器系统</Text>
          </View>
          <View style={styles.powerActionTag}>
            <Text style={[styles.powerActionTagText, { color: colors.amber }]}>执行</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={handleServerPoweroff} disabled={powerLoading}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
            <Power color={colors.red} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={[styles.rowTitle, { color: colors.red }]}>关闭服务器 (Poweroff)</Text>
            <Text style={styles.rowSub}>安全卸载存储池并切断电源</Text>
          </View>
          <View style={[styles.powerActionTag, { borderColor: 'rgba(239, 68, 68, 0.3)', backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
            <Text style={[styles.powerActionTagText, { color: colors.red }]}>关机</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Appearance & Themes */}
      <Text style={styles.sectionTitle}>外观与沉浸显示</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)' }]}>
            {isDark ? <Moon color={colors.purple} size={20} /> : <Sun color={colors.amber} size={20} />}
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>深色模式</Text>
            <Text style={styles.rowSub}>{isDark ? '当前：深色主题（夜间护眼）' : '当前：明亮浅色主题'}</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={(val) => toggleTheme(val)}
            trackColor={{ false: colors.input, true: colors.purple }}
            thumbColor={'#ffffff'}
          />
        </View>
      </View>

      {/* Download Directory */}
      <Text style={styles.sectionTitle}>本地存储与下载</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconBox}>
            <FolderDown color={colors.accent} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>保存目标位置</Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {downloadDir ? downloadDir.name : '加载中...'}
            </Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.miniBtn} onPress={chooseDownloadDir}>
            <FolderDown color={colors.accent} size={16} />
            <Text style={styles.miniBtnText}>选择系统目录</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniBtn} onPress={resetDownloadDirHandler}>
            <RefreshCw color={colors.amber} size={16} />
            <Text style={styles.miniBtnText}>恢复应用内置</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Preview Cache Management */}
      <Text style={styles.sectionTitle}>即时预览缓存</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconBox}>
            <HardDrive color={colors.green} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>当前缓存占用</Text>
            <Text style={styles.rowSub}>图片、文档、音频预览本地缓存</Text>
          </View>
          <Text style={styles.valueText}>{cacheSize}</Text>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={openLimitInput}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
            <Info color={colors.amber} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>LRU 缓存上限</Text>
            <Text style={styles.rowSub}>超出时自动剔除最早未读缓存</Text>
          </View>
          <Text style={styles.valueText}>{cacheLimitMB} MB</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={clearPreviewCacheHandler} disabled={isClearing}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
            {isClearing ? <ActivityIndicator color={colors.red} size="small" /> : <Trash2 color={colors.red} size={20} />}
          </View>
          <View style={styles.infoBox}>
            <Text style={[styles.rowTitle, { color: colors.red }]}>清空预览缓存</Text>
            <Text style={styles.rowSub}>即刻释放手机存储空间</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Architecture & Protocol */}
      <Text style={styles.sectionTitle}>底层核心架构</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
            <ShieldCheck color={colors.accent} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>统一后端核心</Text>
            <Text style={styles.rowSub}>Unraid Native API · 单令牌鉴权</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
            <CheckCircle color={colors.green} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>流式媒体协议</Text>
            <Text style={styles.rowSub}>RFC 7233 HTTP 206 Partial Content 分片流</Text>
          </View>
        </View>
      </View>

      {/* Server Config Input Modal */}
      <Modal visible={serverEditVisible} transparent animationType="fade" onRequestClose={() => setServerEditVisible(false)}>
        <KeyboardAvoidingView style={styles.overlayCenter} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.limitBox}>
            <Text style={styles.limitTitle}>{serverEditField === 'url' ? 'Unraid 服务器地址' : 'API 访问 Token'}</Text>
            <TextInput
              style={styles.limitInput}
              value={serverInput}
              onChangeText={setServerInput}
              autoFocus
              autoCapitalize="none"
              secureTextEntry={serverEditField === 'token'}
              placeholder={serverEditField === 'url' ? 'http://192.168.1.100' : '输入密钥'}
              placeholderTextColor={colors.muted}
            />
            <View style={styles.renameBtns}>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.input }]} onPress={() => setServerEditVisible(false)}>
                <Text style={styles.renameBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.accent }]} onPress={confirmServerEdit}>
                <Text style={[styles.renameBtnText, { color: '#ffffff' }]}>保存并生效</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Cache Limit Input Modal */}
      <Modal visible={limitVisible} transparent animationType="fade" onRequestClose={() => setLimitVisible(false)}>
        <KeyboardAvoidingView style={styles.overlayCenter} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.limitBox}>
            <Text style={styles.limitTitle}>设置预览缓存上限 (MB)</Text>
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
  content: { padding: 16, paddingBottom: 50 },
  header: { alignItems: 'center', marginVertical: 24 },
  title: { color: colors.textStrong, fontSize: 24, fontWeight: 'bold' },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 4 },

  sectionTitle: { color: colors.sub, fontSize: 13, fontWeight: 'bold', marginLeft: 8, marginBottom: 8, marginTop: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden', elevation: 3 },

  row: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(16, 185, 129, 0.15)', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  infoBox: { flex: 1, justifyContent: 'center' },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '500', marginBottom: 3 },
  rowSub: { color: colors.sub, fontSize: 12 },
  valueText: { color: colors.green, fontSize: 15, fontWeight: 'bold' },
  editHint: { color: colors.accent, fontSize: 13, fontWeight: 'bold' },

  powerActionTag: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  powerActionTagText: {
    fontSize: 12,
    fontWeight: 'bold',
  },

  divider: { height: 1, backgroundColor: colors.divider, marginLeft: 68 },

  btnRow: { flexDirection: 'row', padding: 12, justifyContent: 'space-around' },
  miniBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  miniBtnText: { color: colors.text, fontSize: 13, fontWeight: 'bold', marginLeft: 6 },

  overlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  limitBox: { backgroundColor: colors.card, borderRadius: 16, padding: 20 },
  limitTitle: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },
  limitInput: { backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 12, height: 48, color: colors.textStrong, fontSize: 15, marginBottom: 16 },
  renameBtns: { flexDirection: 'row', justifyContent: 'space-between' },
  renameBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginHorizontal: 6 },
  renameBtnText: { color: colors.text, fontSize: 14, fontWeight: 'bold' },
});