import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ActivityIndicator,
  ScrollView, RefreshControl, Switch, Modal, TextInput, KeyboardAvoidingView, Platform,
  Pressable, Linking, StatusBar,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import GlassView from '../components/GlassView';
import {
  HardDrive, Settings as SettingsIcon, ShieldCheck, Info, Server,
  LogOut, Moon, Sun, FolderDown, RefreshCw, Trash2, Key, Power,
  RotateCw, AlertTriangle, CheckCircle, Fingerprint, ShieldAlert,
  Sparkles, DownloadCloud, ExternalLink, Activity, Radio, Zap, Globe, Sliders, X, Check,
} from 'lucide-react-native';

const STATUS_BAR_HEIGHT = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44;
import { useTheme } from '../ThemeContext';
import {
  getDownloadDir, setDownloadDir, resetDownloadDir, getCacheDirPath,
  getCacheSize as getPreviewCacheSize, getCacheLimitBytes, setCacheLimitMB,
  clearCache as clearPreviewCache, formatBytes as fmtBytes,
} from '../utils/cacheManager';
import ModernConfirmDialog from '../components/ModernConfirmDialog';
import backgroundTransferManager from '../utils/backgroundTransferManager';
import { BUNDLED_API_VERSION, BUNDLED_API_CODE } from '../utils/bundledApi';
import {
  getWolConfig, saveWolConfig, sendWakeOnLanPacket,
  isValidMacAddress, formatMacAddress,
} from '../utils/wolManager';
import {
  getProxyConfig, saveProxyConfig, getDockerAliases,
  clearAllDockerAliases, removeDockerAlias, formatProxyUrl,
} from '../utils/dockerWebUiManager';

const APP_RELEASE_CHANGELOGS = {
  '1.5.0': `【v1.5.0 全新毛玻璃拟态视觉基座与通透 Dock】
💎 1. 全新 Glassmorphism 毛玻璃视觉设计语言（第一阶段）：
   - 官方集成 expo-blur 原生高斯模糊硬件加速引擎与亚克力微光漫反射描边。
   - 适配深色与浅色双模材质系统，通透质感与信息层级对比度完美融合。
🚀 2. 悬浮式通透毛玻璃底部导航 Dock：
   - 底部 5 大核心功能导航栏升级为悬浮半透明微光 Dock。
   - 页面列表内容滚动向上穿透模糊层，呈现原生 iOS / 高端 Android 级别的物理景深层次。
✨ 3. 全局沉浸式毛玻璃安全锁与弹窗体系：
   - 生物识别全屏安全锁屏升级为 85 阶高强度高斯模糊虚化背景，保护隐私同时兼备科技质感。
   - 确认与警告弹窗全面接入毛玻璃 Squircle 拟态卡片与背部动态景深虚化。`,
  '1.4.0': `【v1.4.0 核心更新与性能飞跃】
⚡ 1. 智能双模上传引擎（Smart Dual-Mode Engine）：
   - 原生流式直传（≤ 32MB）：零 Base64 转码与桥接损耗，局域网线速直达 30MB/s ~ 80MB/s！
   - 超高速流水线分片（> 32MB）：4MB 块对齐分片并发预读，稳定支撑海量超大文件断点续传。
   - 智能无感降级：遇反代大小限制自动切换分片引擎，零报错感知。
🛡️ 2. 绝对零假成功多重物理强校验：
   - 严禁盲目信任 HTTP 200，落盘必须经过服务端物理尺寸比对与客户端二次强闭环校验。
   - 上传完成即时刷新当前目录，彻底杜绝“显示成功但目录无文件”的隐患。
✨ 3. 全局统一现代高质感确认与报错弹窗：
   - 彻底淘汰原生粗糙系统 Alert.alert，全应用所有操作确认、危险删除、关机重启与报错提示全部切换为现代化 Squircle 卡片。
   - 细致打磨危险（红）、警示（金）、报错（红）、成功（绿）、信息（蓝）全状态微光胶囊徽章。
   - 错误与堆栈日志支持自适应滚动查看与长按复制，彻底杜绝排版溢出与截断。
🔄 4. 传输任务中心 1 秒高频动态心跳刷新：
   - 传输任务中心严格每秒平滑推进实时流速与已传字节，告别长时假死卡顿。`,
  '1.3.1': `【v1.3.1 核心更新与修复】
🚀 1. 传输引擎颠覆性升级（原生流式直连）：
   - 采用 Native Binary Streaming 原生二进制流式传输，彻底绕过 Base64 与 JS 内存序列化，局域网与 WiFi 下上传速度暴增 10x-50x，轻松跑满 50MB/s~100MB/s 线速。
🛡️ 2. 文件落盘双重强校验（彻底杜绝虚假成功）：
   - 修复了此前在部分网络环境下误报“上传成功”但目标目录无文件的问题。
   - 上传完成必须经过服务端写入确认与目录实时扫描双重校验，确认落盘才计入成功。
🚫 3. 根目录非法写入智能拦截：
   - 手机端与服务端双重拦截直接向 /mnt/user 根目录上传的行为，防误触并提示用户进入具体的共享文件夹。
🔧 4. 后端 FastCGI / Nginx 压缩深度适配：
   - 移除 Content-Length 头部冲突，解决 Nginx gzip 引起的“空响应 (HTTP 200)”异常，完善长连接退出保护。`,
  '1.3.0': `【v1.3.0 核心更新与修复】
🐳 1. Docker Compose 重建与升级重构：
   - 重建指令优化为 pull && up -d --remove-orphans，彻底解决更新后容器状态不一致。
📜 2. 日志与配置加载优化：
   - 修复 Compose 运行日志与 YAML 配置调取无限转圈的问题。
🔍 3. 镜像 Hash 显示优化：
   - 明确区分短镜像 ID (12位) 与远端 RepoDigest SHA256 校验和。`,
  '1.2.0': `【v1.2.0 核心更新与修复】
🎨 1. 全新沉浸式深色 / 浅色主题无缝切换。
📁 2. 全能文件即时预览中心（音视频、代码、Office 文档）。
🔒 3. 单一 API Token 鉴权体系与 Unraid 安全沙盒加固。`
};

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
  const [serverApiVersion, setServerApiVersion] = useState('');
  const [isUpdatingApi, setIsUpdatingApi] = useState(false);

  // Download & Cache settings
  const [downloadDir, setDownloadDirState] = useState(null);
  const [cacheDirPath, setCacheDirPath] = useState('');
  const [cacheLimitMB, setCacheLimitMBState] = useState(500);
  const [cacheSizeBytes, setCacheSizeBytes] = useState(0);
  const [limitVisible, setLimitVisible] = useState(false);
  const [limitValue, setLimitValue] = useState('');
  const [serverEditVisible, setServerEditVisible] = useState(false);
  const [serverEditField, setServerEditField] = useState('url');
  const [serverInput, setServerInput] = useState('');

  // Power action state
  const [powerLoading, setPowerLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Wake-on-LAN (WOL) state
  const [wolMac, setWolMac] = useState('');
  const [wolBroadcastIp, setWolBroadcastIp] = useState('255.255.255.255');
  const [wolPort, setWolPort] = useState(9);
  const [wolTesting, setWolTesting] = useState(false);

  // Docker Reverse Proxy & WebUI Jump
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyTemplate, setProxyTemplate] = useState('');
  const [aliasesMap, setAliasesMap] = useState({});
  const [proxyEditVisible, setProxyEditVisible] = useState(false);
  const [proxyInput, setProxyInput] = useState('');
  const [aliasesModalVisible, setAliasesModalVisible] = useState(false);

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
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
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

      const rawBody = (data.body || '').trim();
      const versionKey = (latestTag || '').replace(/^v/i, '');
      const specificLog = APP_RELEASE_CHANGELOGS[versionKey] || APP_RELEASE_CHANGELOGS[appVersion] || '';
      const displayBody = (rawBody.length > 25 && !rawBody.includes('包含多项功能更新')) ? rawBody : (specificLog || rawBody || '包含多项功能更新与体验优化。');

      const hasUpdate = isNewerVersion(latestTag, appVersion);
      if (hasUpdate && apkAsset) {
        setUpdateInfo({
          hasUpdate: true,
          latestTag,
          releaseName: data.name || latestTag,
          body: displayBody,
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

  const fetchServerApiVersion = async (url, token) => {
    try {
      const u = (url || unraidUrl || '').replace(/\/+$/, '');
      const t = token || apiToken;
      if (!u || u === '未连接' || !t) return;
      const res = await fetch(`${u}/api.php?token=${encodeURIComponent(t)}&action=version`);
      const data = await res.json();
      if (data && (data.api_version || data.version)) {
        setServerApiVersion(data.api_version || data.version);
      }
    } catch (e) {
      console.log('[SettingsScreen] fetchServerApiVersion error:', e);
    }
  };

  const handleSelfUpdateApi = async () => {
    if (!unraidUrl || unraidUrl === '未连接' || !apiToken) {
      showConfirm({
        type: 'warning',
        title: '未连接服务器',
        message: '请先配置有效的服务器连接地址与 API Token。',
        confirmText: '好的',
        showCancel: false,
      });
      return;
    }

    setIsUpdatingApi(true);
    try {
      const cleanUrl = unraidUrl.replace(/\/+$/, '');
      let updateSuccess = false;
      let successMsg = '';

      // Engine 0: Bundled API Direct Push (100% reliable, zero external network dependency)
      try {
        const pushRes = await fetch(`${cleanUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=update_api_file`, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-API-Token': apiToken,
          },
          body: BUNDLED_API_CODE,
        });
        const pushData = await pushRes.json().catch(() => null);
        if (pushData && pushData.status === 'success') {
          updateSuccess = true;
          successMsg = pushData.message || `后端 API 已成功直接升级至版本 ${BUNDLED_API_VERSION}！`;
        }
      } catch (bundlePushErr) {
        console.log('[SettingsScreen] Bundled push failed, falling back to network:', bundlePushErr);
      }

      // Engine 1: Server-side self-update via direct GitHub repo URL (raw.githubusercontent.com)
      if (!updateSuccess) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          const res = await fetch(`${cleanUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=self_update_api`, {
            signal: controller.signal,
          });
          clearTimeout(timer);
          const data = await res.json().catch(() => null);
          if (data && data.status === 'success') {
            updateSuccess = true;
            successMsg = data.message || '后端 API (api.php) 已成功通过 GitHub 仓库热更新至最新版本！';
          }
        } catch (srvErr) {
          console.log('[SettingsScreen] Server-side self_update_api failed, trying client push fallback:', srvErr);
        }
      }

      // Engine 2: Client relay fallback (App fetches raw api.php from GitHub and pushes directly to server)
      if (!updateSuccess) {
        const githubUrls = [
          { url: `https://api.github.com/repos/wangzh6859/unraid2/contents/api.php?ref=main&t=${Date.now()}`, headers: { 'Accept': 'application/vnd.github.v3.raw' } },
          { url: `https://raw.githubusercontent.com/wangzh6859/unraid2/main/api.php?t=${Date.now()}` },
          { url: `https://ghproxy.net/https://raw.githubusercontent.com/wangzh6859/unraid2/main/api.php?t=${Date.now()}` },
        ];
        let rawApiCode = null;
        for (const item of githubUrls) {
          try {
            const gRes = await fetch(item.url, { headers: { ...(item.headers || {}), 'Cache-Control': 'no-cache' } });
            if (gRes.ok) {
              const text = await gRes.text();
              if (text && text.length > 50000 && text.includes('<?php') && text.includes('UNRAID_API_VERSION')) {
                rawApiCode = text;
                break;
              }
            }
          } catch (_) {}
        }

        if (rawApiCode) {
          const pushRes = await fetch(`${cleanUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=update_api_file`, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'X-API-Token': apiToken,
            },
            body: rawApiCode,
          });
          const pushData = await pushRes.json().catch(() => null);
          if (pushData && pushData.status === 'success') {
            updateSuccess = true;
            successMsg = pushData.message || '已成功通过手机直连 GitHub 仓库并将最新 API 脚本推送到服务器！';
          }
        }
      }

      if (updateSuccess) {
        await fetchServerApiVersion();
        showConfirm({
          type: 'success',
          title: 'API 更新成功',
          message: successMsg,
          confirmText: '好的',
          showCancel: false,
        });
      } else {
        showConfirm({
          type: 'error',
          title: 'API 更新失败',
          message: '从 GitHub 获取最新 api.php 失败，请检查服务器及手机网络连接或稍后重试。',
          confirmText: '知道了',
          showCancel: false,
        });
      }
    } catch (e) {
      showConfirm({
        type: 'error',
        title: '请求异常',
        message: e.message,
        confirmText: '确定',
        showCancel: false,
      });
    } finally {
      setIsUpdatingApi(false);
    }
  };

  const loadSettings = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      if (savedUrl) setUnraidUrl(savedUrl);
      const token = await AsyncStorage.getItem('@api_token');
      if (token) setApiToken(token);

      if (savedUrl && token) {
        fetchServerApiVersion(savedUrl, token);
      }

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

      const cPath = await getCacheDirPath();
      setCacheDirPath(cPath);

      const limitBytes = await getCacheLimitBytes();
      setCacheLimitMBState(Math.round(limitBytes / 1024 / 1024));

      const bytes = await getPreviewCacheSize();
      setCacheSizeBytes(bytes);
      setCacheSize(fmtBytes(bytes));

      const wolCfg = await getWolConfig();
      setWolMac(wolCfg.mac);
      setWolBroadcastIp(wolCfg.broadcastIp);
      setWolPort(wolCfg.port);

      const pCfg = await getProxyConfig();
      setProxyEnabled(pCfg.enabled);
      setProxyTemplate(pCfg.template);

      const aliases = await getDockerAliases();
      setAliasesMap(aliases || {});
    } catch (e) {
      console.log(e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadSettings();
      fetchServerApiVersion();
    }, [unraidUrl, apiToken])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadSettings(),
        fetchServerApiVersion(unraidUrl, apiToken),
      ]);
    } catch (e) {
      console.log('Settings onRefresh err:', e);
    } finally {
      setRefreshing(false);
    }
  };

  // Download directory permissions via SAF
  const chooseDownloadDir = async () => {
    try {
      const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (perm.granted && perm.directoryUri) {
        let cleanName = '已授权目录';
        try {
          const dec = decodeURIComponent(perm.directoryUri);
          if (dec.includes(':')) {
            const parts = dec.split(':');
            const lastPart = parts[parts.length - 1];
            if (lastPart) cleanName = lastPart;
          }
        } catch (_) {}
        await setDownloadDir(perm.directoryUri, cleanName);
        setDownloadDirState({ uri: perm.directoryUri, name: cleanName, configured: true });
        const cPath = await getCacheDirPath();
        setCacheDirPath(cPath);
        showConfirm({
          type: 'success',
          title: '设置成功',
          message: `已将下载目录指向【${cleanName}】文件夹，预览缓存将保存在其 temp/ 目录下。`,
          showCancel: false,
        });
      } else {
        showConfirm({ type: 'info', title: '已取消', message: '未授权任何文件夹。', showCancel: false });
      }
    } catch (e) {
      showConfirm({ type: 'error', title: '设置失败', message: e.message, showCancel: false });
    }
  };

  const resetDownloadDirHandler = async () => {
    await resetDownloadDir();
    const dir = await getDownloadDir();
    setDownloadDirState(dir);
    const cPath = await getCacheDirPath();
    setCacheDirPath(cPath);
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
      message: '确定要清除下载目录下 temp/ 文件夹中的所有缓存文件吗？（仅清理 temp 缓存文件，绝不影响您的正式下载文件及目录结构）',
      confirmText: '确认清理',
      onConfirm: async () => {
        setIsClearing(true);
        try {
          await clearPreviewCache();
          const bytes = await getPreviewCacheSize();
          setCacheSizeBytes(bytes);
          setCacheSize(fmtBytes(bytes));
          const cPath = await getCacheDirPath();
          setCacheDirPath(cPath);
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
      cleanUrl = cleanUrl.replace(/\/api\.php\/?$/i, '');
      if (cleanUrl && !cleanUrl.startsWith('http')) cleanUrl = 'http://' + cleanUrl;
      if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
      await AsyncStorage.setItem('@server_url', cleanUrl);
      setUnraidUrl(cleanUrl);
      fetchServerApiVersion(cleanUrl, apiToken);
    } else if (serverEditField === 'token') {
      await AsyncStorage.setItem('@api_token', v);
      setApiToken(v);
      fetchServerApiVersion(unraidUrl, v);
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

  // =========================================================================
  // Docker Reverse Proxy & Aliases Handlers
  // =========================================================================
  const toggleProxyEnabled = async (val) => {
    setProxyEnabled(val);
    await saveProxyConfig({ enabled: val });
  };

  const editProxyTemplate = () => {
    setProxyInput(proxyTemplate || 'https://{name_lower}.yourdomain.com');
    setProxyEditVisible(true);
  };

  const handleSaveProxyTemplate = async () => {
    const clean = proxyInput ? proxyInput.trim() : '';
    setProxyTemplate(clean);
    await saveProxyConfig({ template: clean, enabled: clean ? true : proxyEnabled });
    if (clean && !proxyEnabled) setProxyEnabled(true);
    setProxyEditVisible(false);
    showConfirm({
      type: 'success',
      title: '反代规则已更新',
      message: clean
        ? `已成功配置反代模板：\n${clean}\n\n例如：容器 qbittorrent 将自动解析为：\n${formatProxyUrl(clean, 'qbittorrent', '8080')}`
        : '已清除反代规则模板。',
      confirmText: '好的',
      showCancel: false,
    });
  };

  const openAliasesModal = async () => {
    try {
      const fresh = await getDockerAliases();
      const cleanMap = {};
      if (fresh && typeof fresh === 'object') {
        Object.entries(fresh).forEach(([k, v]) => {
          if (k && k.trim() && v && String(v).trim()) {
            cleanMap[k.trim()] = String(v).trim();
          }
        });
      }
      setAliasesMap(cleanMap);
    } catch (e) {
      console.log('Open aliases modal error:', e);
    }
    setAliasesModalVisible(true);
  };

  const handleDeleteAlias = async (cName) => {
    await removeDockerAlias(cName);
    setAliasesMap(prev => {
      const updated = { ...prev };
      delete updated[cName];
      return updated;
    });
  };

  const handleClearAllAliases = () => {
    showConfirm({
      type: 'danger',
      title: '清空所有自定义反代规则',
      message: '确定要清空所有已保存的容器简称与专属反代网址吗？此操作不可逆。',
      confirmText: '确认清空',
      onConfirm: async () => {
        await clearAllDockerAliases();
        setAliasesMap({});
        setAliasesModalVisible(false);
        showConfirm({
          type: 'success',
          title: '已清空',
          message: '已清空所有容器的自定义反代规则，所有容器已恢复为默认模板解析。',
          confirmText: '好的',
          showCancel: false,
        });
      },
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
    <View style={styles.container}>
      {/* 顶部状态栏渐变氛围过渡层 */}
      <Svg style={styles.topGradientFade} pointerEvents="none">
        <Defs>
          <LinearGradient id="settingsTopFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bg} stopOpacity="1" />
            <Stop offset="0.6" stopColor={colors.bg} stopOpacity="0.8" />
            <Stop offset="1" stopColor={colors.bg} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#settingsTopFade)" />
      </Svg>

      <ScrollView
        style={styles.mainScrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <View style={styles.topHeaderSection}>
          <View style={styles.topNavHeaderRow}>
            <View style={styles.titleWithBackRow}>
              <View>
                <Text style={styles.navScreenTitle}>系统控制与设置</Text>
                <Text style={styles.navScreenSub}>
                  Unraid Mobile Manager · 统一管理中枢
                </Text>
              </View>
            </View>
          </View>

          {/* 顶部 Bento 概览看板 */}
          <View style={styles.heroRow}>
            <View style={styles.heroCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <View style={[styles.heroDot, { backgroundColor: unraidUrl ? colors.green : colors.sub }]} />
                <Text style={styles.heroLabel}>主控核心</Text>
              </View>
              <Text style={[styles.heroNum, { color: unraidUrl ? colors.green : colors.sub }]}>
                {unraidUrl ? '已连接' : '未连接'}
              </Text>
            </View>

            <View style={styles.heroCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <ShieldCheck size={11} color={appLockEnabled ? colors.accent : colors.sub} style={{ marginRight: 4 }} />
                <Text style={styles.heroLabel}>安全防护</Text>
              </View>
              <Text style={[styles.heroNum, { color: appLockEnabled ? colors.accent : colors.sub }]}>
                {appLockEnabled ? '已布防' : '未开启'}
              </Text>
            </View>

            <View style={styles.heroCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Sparkles size={11} color={colors.purple} style={{ marginRight: 4 }} />
                <Text style={styles.heroLabel}>软件版本</Text>
              </View>
              <Text style={[styles.heroNum, { color: colors.purple }]}>v{appVersion}</Text>
            </View>
          </View>
        </View>

        {/* Unraid Core Server Card */}
        <Text style={styles.sectionTitle}>主控连接凭证</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={editServerUrl}>
            <View style={styles.iconBox}>
              <Server color={colors.accent} size={22} />
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.rowTitle}>服务器地址</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{unraidUrl || '未设置'}</Text>
            </View>
            <Text style={styles.editHint}>修改</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.row} onPress={editApiToken}>
            <View style={styles.iconBox}>
              <Key color={colors.purple} size={22} />
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.rowTitle}>统一 API Token</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{apiToken ? '••••••••' : '未设置'}</Text>
            </View>
            <Text style={styles.editHint}>修改</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.row} onPress={handleUnraidLogout}>
            <View style={styles.iconBox}>
              <LogOut color={colors.red} size={22} />
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
            <View style={styles.iconBox}>
              <RotateCw color={colors.amber} size={22} />
            </View>
            <View style={styles.infoBox}>
              <Text style={[styles.rowTitle, { color: colors.amber }]}>重启服务器 (Reboot)</Text>
              <Text style={styles.rowSub}>安全重启 Unraid 主机与容器系统</Text>
            </View>
            <Text style={[styles.editHint, { color: colors.amber }]}>重启</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.row} onPress={handleServerPoweroff} disabled={powerLoading}>
            <View style={styles.iconBox}>
              <Power color={colors.red} size={22} />
            </View>
            <View style={styles.infoBox}>
              <Text style={[styles.rowTitle, { color: colors.red }]}>关闭服务器 (Poweroff)</Text>
              <Text style={styles.rowSub}>安全卸载存储池并切断电源</Text>
            </View>
            <Text style={[styles.editHint, { color: colors.red }]}>关机</Text>
          </TouchableOpacity>
        </View>

        {/* Wake-on-LAN Remote Wake Card */}
        <Text style={styles.sectionTitle}>网络唤醒 (Wake-on-LAN)</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={editWolMac}>
            <View style={styles.iconBox}>
              <Zap color={colors.accent} size={22} />
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
            <View style={styles.iconBox}>
              <Radio color={colors.green} size={22} />
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.rowTitle}>局域网广播 IP</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{wolBroadcastIp || '255.255.255.255'}</Text>
            </View>
            <Text style={styles.editHint}>修改</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.row} onPress={editWolPort}>
            <View style={styles.iconBox}>
              <Key color={colors.purple} size={22} />
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.rowTitle}>唤醒端口 (UDP)</Text>
              <Text style={styles.rowSub} numberOfLines={1}>端口 {wolPort || 9}</Text>
            </View>
            <Text style={styles.editHint}>修改</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.row} onPress={handleTestWol} disabled={wolTesting}>
            <View style={styles.iconBox}>
              <Zap color={colors.amber} size={22} />
            </View>
            <View style={styles.infoBox}>
              <Text style={[styles.rowTitle, { color: colors.amber }]}>立即测试唤醒包</Text>
              <Text style={styles.rowSub}>向局域网广播 UDP 魔术包测试路由连通</Text>
            </View>
            {wolTesting ? (
              <ActivityIndicator color={colors.amber} size="small" />
            ) : (
              <Text style={[styles.editHint, { color: colors.amber }]}>测试</Text>
            )}
          </TouchableOpacity>
        </View>

      {/* Docker Reverse Proxy & WebUI Jump */}
      <Text style={styles.sectionTitle}>Docker 反代与 Web 界面</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconBox}>
            <Globe color={colors.accent} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>反向代理域名跳转</Text>
            <Text style={styles.rowSub}>
              {proxyEnabled ? '开启中：优先使用反代域名打开 Web 界面' : '关闭：直接使用服务器内网 IP:端口直连'}
            </Text>
          </View>
          <Switch
            value={proxyEnabled}
            onValueChange={toggleProxyEnabled}
            trackColor={{ false: colors.input, true: colors.accent }}
            thumbColor={'#ffffff'}
          />
        </View>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={editProxyTemplate}>
          <View style={styles.iconBox}>
            <ExternalLink color={colors.green} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>反代规则模板</Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {proxyTemplate || '未配置 (点击设置域名拼接模板)'}
            </Text>
          </View>
          <Text style={styles.editHint}>修改</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={openAliasesModal}>
          <View style={styles.iconBox}>
            <Sliders color={colors.purple} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>自定义反代管理</Text>
            <Text style={styles.rowSub}>
              {Object.keys(aliasesMap).length > 0
                ? `${Object.keys(aliasesMap).length} 个容器已配置独立简称或专属反代`
                : '暂无自定义规则 (在 Docker 卡片点击“定制”可添加)'}
            </Text>
          </View>
          <Text style={styles.editHint}>管理</Text>
        </TouchableOpacity>
      </View>

      {/* Security & Biometrics */}
      <Text style={styles.sectionTitle}>安全防护与生物识别</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconBox}>
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
          <View style={styles.iconBox}>
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
          <View style={styles.iconBox}>
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
          <View style={styles.iconBox}>
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

        <View style={styles.row}>
          <View style={styles.iconBox}>
            <FolderDown color={colors.accent} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>缓存落盘目录</Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {cacheDirPath || (downloadDir ? `${downloadDir.name}/temp/` : 'temp/')}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.row} onPress={openLimitInput}>
          <View style={styles.iconBox}>
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
          <View style={styles.iconBox}>
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
          <View style={styles.iconBox}>
            <ShieldCheck color={colors.accent} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>统一后端核心</Text>
            <Text style={styles.rowSub}>Unraid Native API · 单令牌鉴权</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={styles.iconBox}>
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
          <View style={styles.iconBox}>
            <Sparkles color={colors.accent} size={20} />
          </View>
          <TouchableOpacity
            style={styles.infoBox}
            activeOpacity={0.7}
            onPress={() => {
              const versionKey = (appVersion || '').replace(/^v/i, '');
              const log = APP_RELEASE_CHANGELOGS[versionKey] || APP_RELEASE_CHANGELOGS['1.4.0'] || APP_RELEASE_CHANGELOGS['1.3.1'];
              showConfirm({
                type: 'info',
                title: `v${appVersion} 版本更新详情`,
                message: log,
                confirmText: '我知道了',
                showCancel: false,
              });
            }}
          >
            <Text style={styles.rowTitle}>手机 App 版本</Text>
            <Text style={styles.rowSub}>Unraid Mobile Manager v{appVersion} (点此查看更新日志)</Text>
          </TouchableOpacity>
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

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.iconBox}>
            <ShieldCheck color={colors.green} size={20} />
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>后端 API 核心版本</Text>
            <Text style={styles.rowSub}>
              {serverApiVersion ? `服务端运行：v${serverApiVersion}` : '点击更新或刷新同步'}
              {Boolean(serverApiVersion && serverApiVersion < BUNDLED_API_VERSION) && (
                <Text style={{ color: colors.amber, fontWeight: '700' }}> (有新版 v{BUNDLED_API_VERSION})</Text>
              )}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.updateCheckBtn, { backgroundColor: (serverApiVersion && serverApiVersion < BUNDLED_API_VERSION) ? colors.amber : colors.green }]}
            onPress={handleSelfUpdateApi}
            disabled={isUpdatingApi}
            activeOpacity={0.8}
          >
            {isUpdatingApi ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <RotateCw color="#ffffff" size={13} style={{ marginRight: 4 }} />
                <Text style={styles.updateCheckBtnText}>
                  {(serverApiVersion && serverApiVersion < BUNDLED_API_VERSION) ? '一键升级 API' : '在线更新 API'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Server Config Input Modal */}
      <Modal visible={serverEditVisible} transparent animationType="fade" onRequestClose={() => setServerEditVisible(false)} statusBarTranslucent>
        <KeyboardAvoidingView style={styles.overlayCenter} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <BlurView
            intensity={Platform.OS === 'android' ? 45 : 55}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.glass?.modalBackdrop || (isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.25)') },
            ]}
          />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setServerEditVisible(false)} />
          <GlassView border={true} borderRadius={24} style={styles.limitBox}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
              {serverEditField === 'url' ? (
                <Server color={colors.accent} size={28} />
              ) : serverEditField === 'wol_mac' ? (
                <Zap color={colors.accent} size={28} />
              ) : serverEditField === 'wol_broadcast' ? (
                <Radio color={colors.green} size={28} />
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
          </GlassView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Cache Limit Input Modal */}
      <Modal visible={limitVisible} transparent animationType="fade" onRequestClose={() => setLimitVisible(false)} statusBarTranslucent>
        <KeyboardAvoidingView style={styles.overlayCenter} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <BlurView
            intensity={Platform.OS === 'android' ? 45 : 55}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.glass?.modalBackdrop || (isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.25)') },
            ]}
          />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLimitVisible(false)} />
          <GlassView border={true} borderRadius={24} style={styles.limitBox}>
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
          </GlassView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Docker Reverse Proxy Template Edit Modal */}
      <Modal visible={proxyEditVisible} transparent animationType="fade" onRequestClose={() => setProxyEditVisible(false)} statusBarTranslucent>
        <KeyboardAvoidingView style={styles.overlayCenter} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <BlurView
            intensity={Platform.OS === 'android' ? 45 : 55}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.glass?.modalBackdrop || (isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.25)') },
            ]}
          />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setProxyEditVisible(false)} />
          <GlassView border={true} borderRadius={24} style={styles.limitBox}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
              <Globe color={colors.accent} size={28} />
            </View>
            <Text style={styles.limitTitle}>配置反向代理规则模板</Text>
            <Text style={styles.dialogSub}>
              支持变量占位符：{'\n'}
              • {'{name_lower}'}：容器名转小写（推荐）{'\n'}
              • {'{name}'}：容器原始名称{'\n'}
              • {'{port}'}：容器映射主端口
            </Text>
            <TextInput
              style={styles.limitInput}
              value={proxyInput}
              onChangeText={setProxyInput}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="例如: https://{name_lower}.yourdomain.com"
              placeholderTextColor={colors.muted}
            />
            {proxyInput ? (
              <View style={{ backgroundColor: colors.input, borderRadius: 8, padding: 10, marginBottom: 16 }}>
                <Text style={{ fontSize: 12, color: colors.sub, marginBottom: 2 }}>实时解析预览 (以 qbittorrent 为例):</Text>
                <Text style={{ fontSize: 13, color: colors.accent, fontWeight: 'bold' }} numberOfLines={1}>
                  {formatProxyUrl(proxyInput, 'qbittorrent', '8080')}
                </Text>
              </View>
            ) : null}
            <View style={styles.renameBtns}>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.input }]} onPress={() => setProxyEditVisible(false)}>
                <Text style={styles.renameBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.renameBtn, { backgroundColor: colors.accent }]} onPress={handleSaveProxyTemplate}>
                <Text style={[styles.renameBtnText, { color: '#ffffff' }]}>保存生效</Text>
              </TouchableOpacity>
            </View>
          </GlassView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Docker Custom Reverse Proxy & Aliases Management Modal */}
      <Modal visible={aliasesModalVisible} transparent animationType="fade" onRequestClose={() => setAliasesModalVisible(false)} statusBarTranslucent>
        <View style={styles.overlayCenter}>
          <BlurView
            intensity={Platform.OS === 'android' ? 45 : 55}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.glass?.modalBackdrop || (isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.25)') },
            ]}
          />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAliasesModalVisible(false)} />
          <GlassView border={true} borderRadius={24} style={[styles.limitBox, { width: '100%', maxWidth: 360, maxHeight: '80%', alignItems: 'stretch' }]}>
            <View style={{ alignItems: 'center' }}>
              <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(139, 92, 246, 0.12)' }]}>
                <Sliders color={colors.purple} size={28} />
              </View>
              <Text style={styles.limitTitle}>自定义反代管理</Text>
              <Text style={styles.dialogSub}>
                针对特殊容器单独指定的个性化简称或专属反代网址：
              </Text>
            </View>

            <ScrollView
              style={{ width: '100%', maxHeight: 260, marginVertical: 8 }}
              contentContainerStyle={{ width: '100%' }}
              indicatorStyle={colors.mode === 'dark' ? 'white' : 'black'}
            >
              {Object.keys(aliasesMap).length === 0 ? (
                <View style={{ width: '100%', paddingVertical: 24, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: colors.muted, fontWeight: '500' }}>暂无任何自定义反代规则</Text>
                  <Text style={{ fontSize: 12, color: colors.sub, marginTop: 6, textAlign: 'center', lineHeight: 18, paddingHorizontal: 16 }}>
                    在【Docker 容器】页面任意容器卡片上，点击“定制”即可为特殊容器指定简称或独立网址。
                  </Text>
                </View>
              ) : (
                Object.entries(aliasesMap).map(([cName, val]) => (
                  <View
                    key={cName}
                    style={{
                      width: '100%',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 12,
                      paddingHorizontal: 6,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.divider,
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={{ fontSize: 15, fontWeight: 'bold', color: colors.textStrong }} numberOfLines={1}>
                        {cName}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.accent, marginTop: 2 }} numberOfLines={1}>
                        {val && typeof val === 'string' && val.startsWith('http')
                          ? `专属网址: ${val}`
                          : `简称: ${val} (自动拼接)`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDeleteAlias(cName)}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        backgroundColor: 'rgba(239, 68, 68, 0.12)',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                      activeOpacity={0.7}
                    >
                      <Trash2 size={16} color={colors.red} />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={[styles.renameBtns, { width: '100%', marginTop: 12 }]}>
              {Object.keys(aliasesMap).length > 0 ? (
                <TouchableOpacity
                  style={[styles.renameBtn, { backgroundColor: 'rgba(239, 68, 68, 0.15)', marginRight: 8 }]}
                  onPress={handleClearAllAliases}
                >
                  <Text style={[styles.renameBtnText, { color: colors.red }]}>清空全部</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.renameBtn, { backgroundColor: colors.accent, flex: 1 }]}
                onPress={() => setAliasesModalVisible(false)}
              >
                <Text style={[styles.renameBtnText, { color: '#ffffff' }]}>完成</Text>
              </TouchableOpacity>
            </View>
          </GlassView>
        </View>
      </Modal>

      {/* In-App Software Update Modal */}
      <Modal visible={updateModalVisible} transparent animationType="fade" onRequestClose={() => setUpdateModalVisible(false)} statusBarTranslucent>
        <View style={styles.overlayCenter}>
          <BlurView
            intensity={Platform.OS === 'android' ? 45 : 55}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.glass?.modalBackdrop || (isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.25)') },
            ]}
          />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setUpdateModalVisible(false)} />
          <GlassView border={true} borderRadius={24} style={styles.updateCard}>
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
          </GlassView>
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
    </View>
  );
}

const createStyles = (colors, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topGradientFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: STATUS_BAR_HEIGHT,
    zIndex: 10,
  },
  mainScrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 110,
  },
  topHeaderSection: {
    paddingTop: 0,
    marginBottom: 6,
  },
  topNavHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingTop: STATUS_BAR_HEIGHT + 6,
    paddingBottom: 6,
  },
  titleWithBackRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navScreenTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textStrong,
    letterSpacing: -0.3,
  },
  navScreenSub: {
    fontSize: 12,
    color: colors.sub,
    marginTop: 2,
    fontWeight: '500',
  },

  // Hero Stats Row
  heroRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    paddingBottom: 8,
  },
  heroCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.2 : 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  heroLabel: {
    fontSize: 11,
    color: colors.sub,
    fontWeight: '600',
  },
  heroNum: {
    fontSize: 17,
    fontWeight: 'bold',
    letterSpacing: -0.4,
  },

  sectionTitle: {
    color: colors.sub,
    fontSize: 13,
    fontWeight: 'bold',
    marginLeft: 6,
    marginBottom: 8,
    marginTop: 18,
    letterSpacing: 0.2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.25 : 0.04,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconBox: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  infoBox: {
    flex: 1,
    justifyContent: 'center',
  },
  rowTitle: {
    color: colors.textStrong,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },
  rowSub: {
    color: colors.sub,
    fontSize: 12,
    lineHeight: 16,
  },
  valueText: {
    color: colors.green,
    fontSize: 14,
    fontWeight: 'bold',
  },
  editHint: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: 'bold',
  },

  divider: {
    height: 1,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
    marginLeft: 58,
  },

  btnRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 12,
  },
  miniBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardSecondary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  miniBtnText: {
    color: colors.textStrong,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },

  overlayCenter: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  limitBox: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 22,
    alignItems: 'center',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: isDark ? 0.4 : 0.15,
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
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: isDark ? 0.4 : 0.15,
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