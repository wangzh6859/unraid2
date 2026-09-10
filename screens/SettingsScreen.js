import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Alert, ActivityIndicator,
  ScrollView, Switch, Modal, TextInput, KeyboardAvoidingView, Platform,
  Pressable, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  HardDrive, Settings as SettingsIcon, ShieldCheck, Info, Server,
  LogOut, Moon, Sun, FolderDown, RefreshCw, Trash2, Key, Power,
  RotateCw, AlertTriangle, CheckCircle, Fingerprint, ShieldAlert,
  Sparkles, DownloadCloud, ExternalLink, Activity, Zap,
} from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import {
  getDownloadDir, setDownloadDir, resetDownloadDir,
  getCacheSize as getPreviewCacheSize, getCacheLimitBytes, setCacheLimitMB,
  clearCache as clearPreviewCache, formatBytes as fmtBytes,
} from '../utils/cacheManager';
import ModernConfirmDialog from '../components/ModernConfirmDialog';
import backgroundTransferManager from '../utils/backgroundTransferManager';
import {
  getWolConfig, saveWolConfig, sendWakeOnLanPacket,
  isValidMacAddress, formatMacAddress,
} from '../utils/wolManager';

export default function SettingsScreen({ navigation }) {
  // Modern squircle confirm & result dialog state
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

  // Wake-on-LAN (WOL) state
  const [wolMac, setWolMac] = useState('');
  const [wolBroadcastIp, setWolBroadcastIp] = useState('255.255.255.255');
  const [wolPort, setWolPort] = useState(9);
  const [wolTesting, setWolTesting] = useState(false);

  // Security & Biometrics
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [highRiskAuthEnabled, setHighRiskAuthEnabled] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [bgTransferEnabled, setBgTransferEnabled] = useState(true);

  // In-App Software Update
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateModalVisible, setUpdateModalVisible] = useState(false);

  const { isDark, colors, toggleTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const appVersion = Constants.expoConfig?.version || '1.2.0';

  const isNewerVersion = (latestTag, currentVer) => {
    const cleanLatest = (latestTag || '').replace(/^v/, '');
    const cleanCurrent = (currentVer || '').replace(/^v/, '');
    if (!cleanLatest || !cleanCurrent) return false;
    if (cleanLatest === cleanCurrent) return false;
    const p1 = cleanLatest.split('.').map(n => parseInt(n, 10) || 0);
    const p2 = cleanCurrent.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const a = p1[i] || 0;
      const b = p2[i] || 0;
      if (a > b) return true;
      if (a < b) return false;
    }
    return false;
  };

  const checkForUpdate = async (manual = false) => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      const res = await fetch('https://api.github.com/repos/wangzh6859/unraid2/releases/latest', {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const latestTag = data.tag_name || '';
      const apkAsset = (data.assets || []).find(a => a.name && a.name.endsWith('.apk'));

      const hasUpdate = isNewerVersion(latestTag, appVersion);
      if (hasUpdate && apkAsset) {
        setUpdateInfo({
          hasUpdate: true,
          latestTag,
          releaseName: data.name || latestTag,
          body: data.body || '',
          apkUrl: apkAsset.browser_download_url,
          apkSize: apkAsset.size || 0,
        });
        setUpdateModalVisible(true);
      } else {
        if (manual) {
          showConfirm({
            type: 'success',
            title: '已是最新版本',
            message: `当前应用版本为 v${appVersion}，已是最新发布版本，暂无可用更新。`,
            confirmText: '好的',
            showCancel: false,
          });
        }
      }
    } catch (err) {
      if (manual) {
        showConfirm({
          type: 'warning',
          title: '检查更新失败',
          message: `无法连接 GitHub 检查更新：${err.message}`,
          confirmText: '知道了',
          showCancel: false,
        });
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const toggleAppLock = async (value) => {
    try {
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: value ? '请验证指纹以开启应用安全锁' : '请验证指纹以解除应用安全锁',
        cancelLabel: '取消',
        fallbackLabel: '使用设备锁屏密码',
      });
      if (auth.success) {
        setAppLockEnabled(value);
        await AsyncStorage.setItem('@security_app_lock', value ? 'true' : 'false');
        showConfirm({
          type: 'success',
          title: value ? '应用安全锁已启用' : '安全锁已解除',
          message: value
            ? '从手机桌面切回或重新打开 App 时，将自动进行生物指纹安全校验。'
            : '已关闭应用安全锁。',
          confirmText: '好的',
          showCancel: false,
        });
      }
    } catch (e) {
      console.log('Toggle app lock err:', e);
    }
  };

  const toggleHighRiskAuth = async (value) => {
    try {
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: value ? '请验证指纹以开启高危操作防护' : '请验证指纹以解除高危防护',
        cancelLabel: '取消',
        fallbackLabel: '使用设备锁屏密码',
      });
      if (auth.success) {
        setHighRiskAuthEnabled(value);
        await AsyncStorage.setItem('@security_high_risk_auth', value ? 'true' : 'false');
        showConfirm({
          type: 'success',
          title: value ? '高危保护已开启' : '高危保护已解除',
          message: value
            ? '执行服务器关机、重启等高危操作前，将必须先完成生物指纹验证。'
            : '已关闭高危操作二次认证。',
          confirmText: '好的',
          showCancel: false,
        });
      }
    } catch (e) {
      console.log('Toggle high risk auth err:', e);
    }
  };

  const toggleBgTransfer = async (value) => {
    setBgTransferEnabled(value);
    await backgroundTransferManager.setEnabled(value);
    if (value) {
      await backgroundTransferManager.requestNotificationPermission();
    }
    showConfirm({
      type: 'info',
      title: value ? '后台锁屏传输已启用' : '后台传输已关闭',
      message: value
        ? '大文件传输时，系统将通过 Android 前台服务常驻通知栏，保持网络活跃与动态速率展示，防止锁屏中断。'
        : '已关闭前台保活服务，切到后台或手机熄屏时传输可能被系统休眠暂停。',
      confirmText: '好的',
      showCancel: false,
    });
  };

  const loadSettings = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      if (savedUrl) setUnraidUrl(savedUrl);
      const token = await AsyncStorage.getItem('@api_token');
      if (token) setApiToken(token);

      const lockVal = await AsyncStorage.getItem('@security_app_lock');
      if (lockVal !== null) setAppLockEnabled(lockVal === 'true');

      const riskVal = await AsyncStorage.getItem('@security_high_risk_auth');
      if (riskVal !== null) setHighRiskAuthEnabled(riskVal === 'true');

      const bgVal = await backgroundTransferManager.getEnabled();
      setBgTransferEnabled(bgVal);

      const hasHw = await LocalAuthentication.hasHardwareAsync();
      if (hasHw) {
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        setBiometricSupported(hasHw && isEnrolled);
      }

      const dir = await getDownloadDir();
      setDownloadDirState(dir);

      const limitBytes = await getCacheLimitBytes();
      setCacheLimitMBState(Math.round(limitBytes / 1024 / 1024));

      const bytes = await getPreviewCacheSize();
      setCacheSizeBytes(bytes);
      setCacheSize(fmtBytes(bytes));

      const wolCfg = await getWolConfig();
      setWolMac(wolCfg.mac);
      setWolBroadcastIp(wolCfg.broadcastIp);
      setWolPort(wolCfg.port);
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
    showConfirm({
      type: 'success',
      title: '已恢复默认',
      message: '下载存储位置已恢复为应用内置默认目录。',
      confirmText: '好的',
      showCancel: false,
    });
  };

  // Preview cache
  const clearPreviewCacheHandler = async () => {
    showConfirm({
      type: 'danger',
      title: '清理预览缓存',
      message: '确定要清除所有本地预览缓存文件吗？',
      confirmText: '确认清理',
      onConfirm: async () => {
        setIsClearing(true);
        try {
          await clearPreviewCache();
          const bytes = await getPreviewCacheSize();
          setCacheSizeBytes(bytes);
          setCacheSize(fmtBytes(bytes));
          showConfirm({
            type: 'success',
            title: '清理完成',
            message: '本地预览缓存已全部安全清空！',
            confirmText: '好的',
            showCancel: false,
          });
        } catch (e) {
          showConfirm({
            type: 'warning',
            title: '清理失败',
            message: e.message,
            confirmText: '知道了',
            showCancel: false,
          });
        } finally {
          setIsClearing(false);
        }
      },
    });
  };

  const openLimitInput = () => {
    setLimitValue(String(cacheLimitMB));
    setLimitVisible(true);
  };

  const confirmLimitInput = async () => {
    const n = parseInt(limitValue, 10);
    if (isNaN(n) || n <= 0) {
      showConfirm({
        type: 'warning',
        title: '输入无效',
        message: '请输入有效的正整数（MB）。',
        confirmText: '知道了',
        showCancel: false,
      });
      return;
    }
    const saved = await setCacheLimitMB(n);
    setCacheLimitMBState(saved);
    setLimitVisible(false);
    showConfirm({
      type: 'success',
      title: '配置已保存',
      message: `缓存上限已设为 ${saved} MB，超出时将自动清理最早缓存。`,
      confirmText: '好的',
      showCancel: false,
    });
  };

  // Edit Server URL & Token
  const editServerUrl = () => {
    setServerInput(unraidUrl === '未连接' ? '' : unraidUrl);
    setServerEditField('url');
    setServerEditVisible(true);
  };

  const editApiToken = () => {
    setServerInput(apiToken);
    setServerEditField('token');
    setServerEditVisible(true);
  };

  const editWolMac = () => {
    setServerInput(wolMac);
    setServerEditField('wol_mac');
    setServerEditVisible(true);
  };

  const editWolBroadcastIp = () => {
    setServerInput(wolBroadcastIp || '255.255.255.255');
    setServerEditField('wol_broadcast');
    setServerEditVisible(true);
  };

  const editWolPort = () => {
    setServerInput(String(wolPort || 9));
    setServerEditField('wol_port');
    setServerEditVisible(true);
  };

  const handleTestWol = async () => {
    if (!wolMac) {
      showConfirm({
        type: 'warning',
        title: '未设置 MAC 地址',
        message: '请先填写服务器物理 MAC 地址，或连接 Unraid 后自动抓取。',
        confirmText: '好的',
        showCancel: false,
      });
      return;
    }

    setWolTesting(true);
    try {
      const res = await sendWakeOnLanPacket(wolMac, wolBroadcastIp, wolPort);
      showConfirm({
        type: 'success',
        title: 'WOL 测试魔术包已广播',
        message: `已向 ${res.broadcastIp || wolBroadcastIp}:${res.port || wolPort} 成功广播 ${res.packetsSent || 3} 次唤醒数据包！\n目标 MAC: ${formatMacAddress(wolMac)}`,
        confirmText: '太棒了',
        showCancel: false,
      });
    } catch (e) {
      showConfirm({
        type: 'warning',
        title: '测试发送失败',
        message: e.message || '发送 Wake-on-LAN 数据包异常，请检查网络权限。',
        confirmText: '知道了',
        showCancel: false,
      });
    } finally {
      setWolTesting(false);
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
    } else if (serverEditField === 'wol_mac') {
      if (v && !isValidMacAddress(v)) {
        showConfirm({
          type: 'warning',
          title: 'MAC 地址格式错误',
          message: '请输入正确的 12 位 16 进制物理 MAC 地址（例如 AA:BB:CC:DD:EE:FF）。',
          confirmText: '重新输入',
          showCancel: false,
        });
        return;
      }
      const formatted = formatMacAddress(v);
      await saveWolConfig({ mac: formatted });
      setWolMac(formatted);
    } else if (serverEditField === 'wol_broadcast') {
      const bIp = v || '255.255.255.255';
      await saveWolConfig({ broadcastIp: bIp });
      setWolBroadcastIp(bIp);
    } else if (serverEditField === 'wol_port') {
      const p = parseInt(v, 10) || 9;
      await saveWolConfig({ port: p });
      setWolPort(p);
    }

    setServerEditVisible(false);
    showConfirm({
      type: 'success',
      title: '配置已生效',
      message: '设置已实时保存并即时生效！',
      confirmText: '好的',
      showCancel: false,
    });
  };

  const handleUnraidLogout = () => {
    showConfirm({
      type: 'warning',
      title: '注销服务器凭据',
      message: '确定要清除当前 Unraid 系统的连接配置吗？\n断开后需重新输入地址与 API Token。',
      confirmText: '注销断开',
      onConfirm: async () => {
        await AsyncStorage.removeItem('@server_url');
        await AsyncStorage.removeItem('@api_token');
        setUnraidUrl('未连接');
        setApiToken('');
        navigation.navigate('首页');
      },
    });
  };

  // =========================================================================
  // Server Power Management (Remote Reboot & Shutdown)
  // =========================================================================
  const handleServerReboot = () => {
    if (!unraidUrl || unraidUrl === '未连接' || !apiToken) {
      showConfirm({
        type: 'warning',
        title: '未连接服务器',
        message: '请先配置有效的服务器连接地址与 API Token。',
        confirmText: '我知道了',
        showCancel: false,
      });
      return;
    }

    showConfirm({
      type: 'reboot',
      title: '确认重启 Unraid 服务器？',
      message: '服务器将在数秒内开始安全重启流程。系统所有 Docker 容器与虚拟机服务将短暂离线，约需 1~3 分钟恢复。',
      confirmText: '确认重启',
      onConfirm: async () => {
        if (highRiskAuthEnabled) {
          const auth = await LocalAuthentication.authenticateAsync({
            promptMessage: '请验证指纹以确认重启 Unraid 服务器',
            cancelLabel: '取消',
            fallbackLabel: '使用设备锁屏密码',
          });
          if (!auth.success) return;
        }

        setPowerLoading(true);
        try {
          const res = await fetch(`${unraidUrl}/api.php?token=${apiToken}&action=reboot`);
          const data = await res.json();
          showConfirm({
            type: 'success',
            title: '重启指令已发送',
            message: data.message || '服务器正在执行安全重启，系统服务将在数分钟内恢复。',
            confirmText: '好的',
            showCancel: false,
          });
        } catch (e) {
          showConfirm({
            type: 'warning',
            title: '请求异常',
            message: e.message,
            confirmText: '知道了',
            showCancel: false,
          });
        } finally {
          setPowerLoading(false);
        }
      },
    });
  };

  const handleServerPoweroff = () => {
    if (!unraidUrl || unraidUrl === '未连接' || !apiToken) {
      showConfirm({
        type: 'warning',
        title: '未连接服务器',
        message: '请先配置有效的服务器连接地址与 API Token。',
        confirmText: '我知道了',
        showCancel: false,
      });
      return;
    }

    showConfirm({
      type: 'power',
      title: '危险：确认关闭 Unraid 服务器？',
      message: '执行关机后，主机将彻底切断电源停止运行！\n\n注意：除非服务器主板已配置 WOL 网络唤醒或由管理员手动按下物理电源键，否则无法远程唤醒开机。',
      confirmText: '彻底关机',
      onConfirm: async () => {
        if (highRiskAuthEnabled) {
          const auth = await LocalAuthentication.authenticateAsync({
            promptMessage: '危险操作：请验证指纹以确认关闭服务器电源',
            cancelLabel: '取消',
            fallbackLabel: '使用设备锁屏密码',
          });
          if (!auth.success) return;
        }

        setPowerLoading(true);
        try {
          const res = await fetch(`${unraidUrl}/api.php?token=${apiToken}&action=poweroff`);
          const data = await res.json();
          showConfirm({
            type: 'success',
            title: '关机指令已生效',
            message: data.message || '服务器正在安全关机...',
            confirmText: '好的',
            showCancel: false,
          });
        } catch (e) {
          showConfirm({
            type: 'warning',
            title: '请求异常',
            message: e.message,
            confirmText: '知道了',
            showCancel: false,
          });
        } finally {
          setPowerLoading(false);
        }
      },
    });
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

      {/* Wake-on-LAN Remote Wake Card */}
      <Text style={styles.sectionTitle}>网络唤醒 (Wake-on-LAN)</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.row} onPress={editWolMac}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
            <Zap color={colors.accent} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>服务器物理 MAC</Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {wolMac ? formatMacAddress(wolMac) : '未检测到 (联网刷新自动同步)'}
            </Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={editWolBroadcastIp}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
            <Activity color={colors.green} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>局域网广播 IP</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{wolBroadcastIp || '255.255.255.255'}</Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={editWolPort}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
            <Key color={colors.purple} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>唤醒端口 (UDP)</Text>
            <Text style={styles.rowSub} numberOfLines={1}>端口 {wolPort || 9}</Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={handleTestWol} disabled={wolTesting}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
            <Zap color={colors.amber} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={[styles.rowTitle, { color: colors.amber }]}>立即测试唤醒包</Text>
            <Text style={styles.rowSub}>向局域网广播 UDP 魔术包测试路由连通</Text>
          </View>
          <View style={[styles.powerActionTag, { borderColor: 'rgba(245, 158, 11, 0.3)', backgroundColor: 'rgba(245, 158, 11, 0.1)' }]}>
            {wolTesting ? (
              <ActivityIndicator color={colors.amber} size="small" />
            ) : (
              <Text style={[styles.powerActionTagText, { color: colors.amber }]}>测试</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Security & Biometrics */}
      <Text style={styles.sectionTitle}>安全防护与生物识别</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
            <Fingerprint color={colors.accent} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>生物识别应用锁</Text>
            <Text style={styles.rowSub}>
              {appLockEnabled ? '开启中：切回或重新打开 App 时锁屏' : '关闭：无需生物识别直接进入应用'}
            </Text>
          </View>
          <Switch
            value={appLockEnabled}
            onValueChange={toggleAppLock}
            trackColor={{ false: colors.input, true: colors.accent }}
            thumbColor={'#ffffff'}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
            <ShieldAlert color={colors.red} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>高危操作指纹守卫</Text>
            <Text style={styles.rowSub}>
              {highRiskAuthEnabled ? '开启中：关机/重启前必须先验证指纹' : '关闭：点击确认后直接执行'}
            </Text>
          </View>
          <Switch
            value={highRiskAuthEnabled}
            onValueChange={toggleHighRiskAuth}
            trackColor={{ false: colors.input, true: colors.red }}
            thumbColor={'#ffffff'}
          />
        </View>
      </View>

      {/* Background Transfer & Foreground Service */}
      <Text style={styles.sectionTitle}>传输与后台保活</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
            <Activity color={colors.green || '#10b981'} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>后台锁屏持续传输 (常驻通知栏)</Text>
            <Text style={styles.rowSub}>
              {bgTransferEnabled ? '开启中：锁屏与切后台时保持 CPU 与网络活跃，通知栏实时显示速率' : '关闭：切入后台或锁屏时可能被系统休眠中断'}
            </Text>
          </View>
          <Switch
            value={bgTransferEnabled}
            onValueChange={toggleBgTransfer}
            trackColor={{ false: colors.input, true: colors.green || '#10b981' }}
            thumbColor={'#ffffff'}
          />
        </View>
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

      {/* Software Version & In-App Update */}
      <Text style={styles.sectionTitle}>软件版本与在线更新</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
            <Sparkles color={colors.accent} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>当前版本</Text>
            <Text style={styles.rowSub}>Unraid Mobile Manager v{appVersion}</Text>
          </View>
          <TouchableOpacity
            style={[styles.updateCheckBtn, { backgroundColor: colors.accent }]}
            onPress={() => checkForUpdate(true)}
            disabled={isCheckingUpdate}
            activeOpacity={0.8}
          >
            {isCheckingUpdate ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <DownloadCloud color="#ffffff" size={14} style={{ marginRight: 4 }} />
                <Text style={styles.updateCheckBtnText}>检查更新</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Server Config Input Modal */}
      <Modal visible={serverEditVisible} transparent animationType="fade" onRequestClose={() => setServerEditVisible(false)}>
        <KeyboardAvoidingView style={styles.overlayCenter} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setServerEditVisible(false)} />
          <View style={styles.limitBox}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
              {serverEditField === 'url' ? (
                <Server color={colors.accent} size={28} />
              ) : serverEditField === 'wol_mac' ? (
                <Zap color={colors.accent} size={28} />
              ) : serverEditField === 'wol_broadcast' ? (
                <Activity color={colors.green} size={28} />
              ) : (
                <Key color={colors.accent} size={28} />
              )}
            </View>
            <Text style={styles.limitTitle}>
              {serverEditField === 'url' ? 'Unraid 服务器地址' :
               serverEditField === 'token' ? 'API 访问 Token' :
               serverEditField === 'wol_mac' ? '服务器物理 MAC 地址' :
               serverEditField === 'wol_broadcast' ? '局域网广播 IP 地址' :
               'WOL 唤醒端口'}
            </Text>
            <Text style={styles.dialogSub}>
              {serverEditField === 'url' ? '输入 Unraid WebGUI 地址 (如 http://192.168.1.100)' :
               serverEditField === 'token' ? '输入由系统生成的 API 安全访问密钥' :
               serverEditField === 'wol_mac' ? '输入 Unraid 网卡 12 位物理 MAC (如 AA:BB:CC:DD:EE:FF)' :
               serverEditField === 'wol_broadcast' ? '默认 255.255.255.255 全局广播，支持子网定向广播' :
               '标准唤醒协议通常使用 UDP 端口 9 或 7'}
            </Text>
            <TextInput
              style={styles.limitInput}
              value={serverInput}
              onChangeText={setServerInput}
              autoFocus
              autoCapitalize={serverEditField === 'wol_mac' ? 'characters' : 'none'}
              secureTextEntry={serverEditField === 'token'}
              placeholder={
                serverEditField === 'url' ? 'http://192.168.1.100' :
                serverEditField === 'token' ? '输入密钥' :
                serverEditField === 'wol_mac' ? 'AA:BB:CC:DD:EE:FF' :
                serverEditField === 'wol_broadcast' ? '255.255.255.255' :
                '9'
              }
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
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLimitVisible(false)} />
          <View style={styles.limitBox}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
              <HardDrive color={colors.green} size={28} />
            </View>
            <Text style={styles.limitTitle}>设置预览缓存上限</Text>
            <Text style={styles.dialogSub}>超出上限时将自动触发最旧缓存智能淘汰清理</Text>
            <TextInput
              style={styles.limitInput}
              keyboardType="numeric"
              value={limitValue}
              onChangeText={setLimitValue}
              autoFocus
              placeholder="例如 500 (单位: MB)"
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

      {/* In-App Software Update Modal */}
      <Modal visible={updateModalVisible} transparent animationType="fade" onRequestClose={() => setUpdateModalVisible(false)}>
        <View style={styles.overlayCenter}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setUpdateModalVisible(false)} />
          <View style={[styles.updateCard, { backgroundColor: colors.card }]}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(59, 130, 246, 0.14)' }]}>
              <Sparkles color={colors.accent} size={28} />
            </View>
            <Text style={[styles.updateTitle, { color: colors.textStrong }]}>发现新版本可用</Text>
            <Text style={[styles.updateVersionTag, { color: colors.accent }]}>
              {updateInfo?.releaseName || updateInfo?.latestTag}
            </Text>
            <Text style={[styles.dialogSub, { marginBottom: 12 }]}>
              大小: {fmtBytes(updateInfo?.apkSize || 0)} · 当前: v{appVersion}
            </Text>
            <ScrollView style={styles.updateNotesBox} showsVerticalScrollIndicator>
              <Text style={[styles.updateNotesText, { color: colors.sub }]}>
                {updateInfo?.body || '包含多项功能更新与体验优化。'}
              </Text>
            </ScrollView>
            <View style={styles.renameBtns}>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.input }]} onPress={() => setUpdateModalVisible(false)}>
                <Text style={styles.renameBtnText}>稍后更新</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.renameBtn, { backgroundColor: colors.accent }]}
                onPress={() => {
                  setUpdateModalVisible(false);
                  if (updateInfo?.apkUrl) {
                    Linking.openURL(updateInfo.apkUrl);
                  }
                }}
              >
                <Text style={[styles.renameBtnText, { color: '#ffffff' }]}>立即下载安装</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modern Squircle Confirm Dialog */}
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

  overlayCenter: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  limitBox: {
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
  limitTitle: {
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
  limitInput: {
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
  renameBtns: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  renameBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  renameBtnText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  updateCheckBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  updateCheckBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  updateCard: {
    width: '100%',
    maxWidth: 340,
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
  updateTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  updateVersionTag: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
    textAlign: 'center',
  },
  updateNotesBox: {
    maxHeight: 150,
    width: '100%',
    backgroundColor: colors.input,
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
  },
  updateNotesText: {
    fontSize: 13,
    lineHeight: 19,
  },
});