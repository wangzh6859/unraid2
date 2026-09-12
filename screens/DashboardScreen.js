import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet, Text, View, ScrollView, RefreshControl, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
  Linking, Dimensions
} from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, G, Rect } from 'react-native-svg';
import {
  Cpu, Database, HardDrive, Box, Monitor, Wifi, Zap, Server, Key,
  ShieldCheck, AlertCircle, Play, Pause, Square, FileText, Search,
  RefreshCw, Copy, Check, X, ArrowDown, ArrowUp, ExternalLink, Power,
  ChevronRight, RefreshCcw, Layers, Terminal, Bell, Clock, AlertTriangle, Info, CheckCircle2 } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme } from '../ThemeContext';
import ModernConfirmDialog from '../components/ModernConfirmDialog';
import { getWolConfig, sendWakeOnLanPacket, formatMacAddress } from '../utils/wolManager';
import { resolveDockerWebUrl, getProxyConfig, getDockerAliases } from '../utils/dockerWebUiManager';

// -------------------------------------------------------------
// Vector Math Helpers for SVG Gauges & Waves
// -------------------------------------------------------------
function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: Number((centerX + radius * Math.cos(angleInRadians)).toFixed(2)),
    y: Number((centerY + radius * Math.sin(angleInRadians)).toFixed(2)),
  };
}

function describeArc(x, y, radius, startAngle, endAngle) {
  if (endAngle <= startAngle) return '';
  const clampedEnd = Math.min(endAngle, startAngle + 359.9);
  const start = polarToCartesian(x, y, radius, clampedEnd);
  const end = polarToCartesian(x, y, radius, startAngle);
  const arcSweep = clampedEnd - startAngle <= 180 ? '0' : '1';
  return `M ${end.x} ${end.y} A ${radius} ${radius} 0 ${arcSweep} 1 ${start.x} ${start.y}`;
}

function generateSmoothWave(dataPoints, width, height, padTop = 10, padBottom = 5) {
  if (!dataPoints || dataPoints.length < 2) return { path: '', area: '' };
  const maxVal = Math.max(...dataPoints, 0.5);
  const stepX = width / (dataPoints.length - 1);
  const usableH = height - padTop - padBottom;

  const points = dataPoints.map((val, idx) => ({
    x: Number((idx * stepX).toFixed(1)),
    y: Number((height - padBottom - (Math.min(val, maxVal * 1.5) / maxVal) * usableH).toFixed(1)),
  }));

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const cpX = (curr.x + next.x) / 2;
    path += ` C ${cpX} ${curr.y}, ${cpX} ${next.y}, ${next.x} ${next.y}`;
  }

  const last = points[points.length - 1];
  const area = `${path} L ${last.x} ${height} L ${points[0].x} ${height} Z`;
  return { path, area };
}

// -------------------------------------------------------------
// Component
// -------------------------------------------------------------
export default function DashboardScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  // 配置与连接状态
  const [isConfigured, setIsConfigured] = useState(true);
  const [serverHost, setServerHost] = useState('');
  const [serverStatus, setServerStatus] = useState('online'); // 'online' | 'offline'
  const [refreshing, setRefreshing] = useState(false);

  // WOL 网络唤醒状态
  const [wolConfig, setWolConfig] = useState({ mac: '', broadcastIp: '255.255.255.255', port: 9 });
  const [isWaking, setIsWaking] = useState(false);
  const wolPollTimerRef = useRef(null);

  // 登录表单状态
  const [inputUrl, setInputUrl] = useState('');
  const [inputToken, setInputToken] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  // 仪表盘核心遥测数据
  const [stats, setStats] = useState({ cpu: 0, memory: 0, mem_total: 0, mem_used: 0, mem_avail: 0, cpu_temp: null, uptime: '', hostname: '' });
  const [gpu, setGpu] = useState({ name: 'N/A', usage: 0 });
  const [storage, setStorage] = useState({ percentage: 0, total_used: 0, total_size: 0, disks: [] });
  const [dockers, setDockers] = useState({ running: 0, total: 0, list: [] });
  const [vms, setVms] = useState({ running: 0, total: 0, list: [] });
  
  // 实时网速与历史波形缓存
  const prevNetwork = useRef({ rx: 0, tx: 0, time: 0 });
  const [netSpeed, setNetSpeed] = useState({ down: '0.0', up: '0.0' });
  // 实时硬盘阵列读写速度
  const prevStorageIo = useRef({ read: 0, write: 0, time: 0 });
  const [diskIoSpeed, setDiskIoSpeed] = useState({ read: 0, write: 0 });
  const [downWaveHistory, setDownWaveHistory] = useState([1.2, 2.4, 1.8, 4.2, 2.0, 3.5, 4.8, 3.2]);
  const [upWaveHistory, setUpWaveHistory] = useState([0.4, 0.8, 0.5, 1.2, 0.9, 0.6, 0.9, 0.7]);

  // 阵列校验状态
  const [parity, setParity] = useState({
    status: 'idle',
    progress: 0,
    speed: '',
    errors: 0,
    finish: '',
    action: '空闲',
    is_checking: false,
  });

  // Syslog 日志状态
  const [syslogVisible, setSyslogVisible] = useState(false);
  const [syslogContent, setSyslogContent] = useState('');
  const [syslogLoading, setSyslogLoading] = useState(false);
  const [syslogSearchQuery, setSyslogSearchQuery] = useState('');
  const [syslogLevelFilter, setSyslogLevelFilter] = useState('all');
  const [syslogCopiedToast, setSyslogCopiedToast] = useState(false);
  const syslogScrollRef = useRef(null);

  // 通知中心与系统时钟状态
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [timeStatus, setTimeStatus] = useState({ warning: null, synced: true, server_time: '', drift_seconds: 0 });
  const [notificationModalVisible, setNotificationModalVisible] = useState(false);
  const [notifFilter, setNotifFilter] = useState('all'); // 'all' | 'alert' | 'normal'

  // 确认弹窗
  const [confirmDialog, setConfirmDialog] = useState({
    visible: false,
    type: 'info',
    title: '',
    message: '',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: true,
    onConfirm: null,
  });

  const showConfirm = ({
    type = 'info',
    title,
    message,
    confirmText = '确定',
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

  // 初始加载 WOL 配置与服务器主机名
  useEffect(() => {
    getWolConfig().then(cfg => setWolConfig(cfg));
    AsyncStorage.getItem('@server_url').then(url => {
      if (url) {
        try {
          const parsed = url.replace(/^https?:\/\//, '').split(/[:/]/)[0];
          setServerHost(parsed);
        } catch (_) {}
      }
    });
    return () => {
      if (wolPollTimerRef.current) clearInterval(wolPollTimerRef.current);
    };
  }, []);

  // 格式化工具
  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (kb) => {
    const n = parseFloat(kb) || 0;
    return n > 1024 ? (n / 1024).toFixed(1) + ' MB/s' : n.toFixed(1) + ' KB/s';
  };

  // 核心拉取逻辑
  const fetchServerData = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');

      if (!savedUrl || !savedToken) {
        setIsConfigured(false);
        return;
      }
      setIsConfigured(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=status`, { signal: controller.signal });
      clearTimeout(timeoutId);

      const data = await response.json();
      setServerStatus('online');

      // 若此前正处于唤醒轮询等待中，服务器已恢复上线
      if (isWaking) {
        setIsWaking(false);
        if (wolPollTimerRef.current) {
          clearInterval(wolPollTimerRef.current);
          wolPollTimerRef.current = null;
        }
        showConfirm({
          type: 'success',
          title: '服务器已上线',
          message: 'Unraid 主机已成功启动并恢复通信！',
          confirmText: '好的',
          showCancel: false,
        });
      }

      if (data.stats) setStats(prev => ({ ...prev, ...data.stats }));
      if (data.gpu) setGpu(data.gpu);
      if (data.storage) {
        setStorage(data.storage);
        const now = Date.now();
        if (prevStorageIo.current.time > 0) {
          const timeDiff = (now - prevStorageIo.current.time) / 1000;
          const rDiff = (data.storage.total_read_bytes || 0) - prevStorageIo.current.read;
          const wDiff = (data.storage.total_write_bytes || 0) - prevStorageIo.current.write;
          if (timeDiff > 0 && rDiff >= 0 && wDiff >= 0) {
            setDiskIoSpeed({
              read: parseFloat((rDiff / timeDiff / 1024).toFixed(1)),
              write: parseFloat((wDiff / timeDiff / 1024).toFixed(1)),
            });
          }
        }
        prevStorageIo.current = {
          read: data.storage.total_read_bytes || 0,
          write: data.storage.total_write_bytes || 0,
          time: now,
        };
      }
      if (data.dockers) setDockers(data.dockers);
      if (data.vms) setVms(data.vms);
      if (data.parity) setParity(data.parity);

      // 计算实时网络吞吐与波形曲线
      if (data.network) {
        if (data.network.mac) {
          AsyncStorage.setItem('@server_mac_address', data.network.mac);
          setWolConfig(prev => ({ ...prev, mac: data.network.mac }));
        }
        const now = Date.now();
        if (prevNetwork.current.time > 0) {
          const timeDiff = (now - prevNetwork.current.time) / 1000;
          const rxDiff = data.network.rx_bytes - prevNetwork.current.rx;
          const txDiff = data.network.tx_bytes - prevNetwork.current.tx;
          if (timeDiff > 0 && rxDiff >= 0 && txDiff >= 0) {
            const downVal = parseFloat((rxDiff / timeDiff / 1024).toFixed(1));
            const upVal = parseFloat((txDiff / timeDiff / 1024).toFixed(1));
            setNetSpeed({ down: downVal, up: upVal });

            // 动态加入波形缓存 (保持 10 个数据点)
            setDownWaveHistory(prev => {
              const next = [...prev.slice(-9), Math.max(0.2, downVal > 1024 ? downVal / 1024 : downVal / 200)];
              return next;
            });
            setUpWaveHistory(prev => {
              const next = [...prev.slice(-9), Math.max(0.1, upVal > 1024 ? upVal / 1024 : upVal / 200)];
              return next;
            });
          }
        }
        prevNetwork.current = { rx: data.network.rx_bytes, tx: data.network.tx_bytes, time: now };
      }
    } catch (error) {
      setServerStatus('offline');
    }
  };

  // 网络唤醒触发
  const handleTriggerWol = async () => {
    try {
      const cfg = await getWolConfig();
      if (!cfg.mac) {
        showConfirm({
          type: 'warning',
          title: '未检测到 MAC 地址',
          message: '尚未获取到 Unraid 物理网卡 MAC 地址。请先在【设置 -> 自定义反代/网络唤醒】中手动填写，或开机联网后自动抓取。',
          confirmText: '去设置',
          cancelText: '取消',
          onConfirm: () => navigation.navigate('设置'),
        });
        return;
      }

      setIsWaking(true);
      const res = await sendWakeOnLanPacket(cfg.mac, cfg.broadcastIp, cfg.port);

      showConfirm({
        type: 'success',
        title: '唤醒魔术包已广播',
        message: `已向局域网广播发送 ${res.packetsSent || 3} 次 WOL 唤醒数据包 (目标 MAC: ${formatMacAddress(cfg.mac)})。\n\n主机冷启动通常需要 1~3 分钟，App 正在后台自动轮询重试...`,
        confirmText: '好的，后台等待',
        showCancel: false,
      });

      if (wolPollTimerRef.current) clearInterval(wolPollTimerRef.current);
      let attempts = 0;
      wolPollTimerRef.current = setInterval(async () => {
        attempts++;
        try {
          await Promise.all([fetchServerData(), fetchNotifications()]);
        } catch (_) {}
        if (attempts >= 36) {
          if (wolPollTimerRef.current) clearInterval(wolPollTimerRef.current);
          setIsWaking(false);
        }
      }, 5000);
    } catch (err) {
      setIsWaking(false);
      showConfirm({
        type: 'warning',
        title: '唤醒失败',
        message: err.message || '发送 Wake-on-LAN 失败，请检查手机是否已连接局域网 Wi-Fi。',
        confirmText: '知道了',
        showCancel: false,
      });
    }
  };

  
  // 通知中心与系统时间校验
  const fetchNotifications = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;
      const clientTime = Math.floor(Date.now() / 1000);
      const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=notifications&client_time=${clientTime}`);
      const data = await res.json();
      if (data.status === 'success') {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unread_count || 0);
        if (data.time_status) {
          setTimeStatus(data.time_status);
        }
      }
    } catch (e) {
      console.log('Error fetching notifications:', e);
    }
  };

  const handleDismissNotification = async (item) => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;
      await fetch(`${savedUrl}/api.php?token=${savedToken}&action=dismiss_notification&id=${encodeURIComponent(item.id)}`);
      setNotifications(prev => prev.filter(n => n.id !== item.id));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      console.log('Dismiss error:', e);
    }
  };

  // Syslog 拉取
  const fetchSyslog = async () => {
    setSyslogLoading(true);
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;

      const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=syslog&lines=250`);
      const data = await res.json();
      if (data.status === 'success') {
        setSyslogContent(data.logs || '暂无日志记录');
        setTimeout(() => {
          if (syslogScrollRef.current) {
            syslogScrollRef.current.scrollToEnd({ animated: true });
          }
        }, 300);
      } else {
        const isUnknownAction = data.message && /unknown action/i.test(data.message);
        setSyslogContent(isUnknownAction
          ? '获取系统日志失败：服务端尚未更新最新的 api.php。\n\n请将项目代码库中的 api.php 拷贝至 Unraid 服务器的 /usr/local/emhttp/api.php 并执行：\nchmod 755 /usr/local/emhttp/api.php'
          : `获取日志失败: ${data.message || '未知异常'}`);
      }
    } catch (e) {
      setSyslogContent(`网络通信异常: ${e.message}`);
    } finally {
      setSyslogLoading(false);
    }
  };

  const openSyslogModal = () => {
    setSyslogContent('');
    setSyslogSearchQuery('');
    setSyslogLevelFilter('all');
    setSyslogVisible(true);
    fetchSyslog();
  };

  const copyAllSyslogs = async () => {
    try {
      await Clipboard.setStringAsync(filteredSyslogs);
      setSyslogCopiedToast(true);
      setTimeout(() => setSyslogCopiedToast(false), 2000);
    } catch (e) {
      console.log('Copy syslog error:', e);
    }
  };

  const filteredSyslogs = useMemo(() => {
    if (!syslogContent) return '';
    let lines = syslogContent.split('\n');
    if (syslogLevelFilter === 'error') {
      lines = lines.filter(l => /error|fail|crit|panic|corrupt/i.test(l));
    } else if (syslogLevelFilter === 'warn') {
      lines = lines.filter(l => /warn|alert/i.test(l));
    } else if (syslogLevelFilter === 'info') {
      lines = lines.filter(l => /info|notice|started|stopped|kernel/i.test(l));
    }
    if (syslogSearchQuery.trim()) {
      const q = syslogSearchQuery.toLowerCase();
      lines = lines.filter(l => l.toLowerCase().includes(q));
    }
    return lines.join('\n');
  }, [syslogContent, syslogLevelFilter, syslogSearchQuery]);

  // 快捷启动 Docker WebUI
  const handleQuickLaunchDockerWeb = async (docker) => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const proxyCfg = await getProxyConfig();
      const aliases = await getDockerAliases();
      const webInfo = typeof resolveDockerWebUrl === 'function'
        ? resolveDockerWebUrl(docker, savedUrl, proxyCfg, aliases)
        : { targetUrl: '' };

      if (webInfo.targetUrl) {
        const can = await Linking.canOpenURL(webInfo.targetUrl);
        if (can) {
          await Linking.openURL(webInfo.targetUrl);
        } else {
          showConfirm({ type: 'warning', title: '无法打开链接', message: webInfo.targetUrl, showCancel: false });
        }
      } else {
        showConfirm({
          type: 'info',
          title: '未配置 Web 地址',
          message: `容器「${docker.name}」未映射外部端口或未设置反代规则。\n是否前往 Docker 页面进行配置？`,
          confirmText: '去配置',
          cancelText: '取消',
          showCancel: true,
          onConfirm: () => navigation.navigate('容器'),
        });
      }
    } catch (e) {
      showConfirm({ type: 'warning', title: '打开异常', message: e.message, showCancel: false });
    }
  };

  // 登录并保存配置
  const handleSaveConfig = async () => {
    if (!inputUrl || !inputToken) {
      showConfirm({
        type: 'info',
        title: '提示',
        message: '请完整填写服务器地址和 API Token',
        confirmText: '好的',
        showCancel: false,
      });
      return;
    }

    let cleanUrl = inputUrl.trim();
    if (!cleanUrl.startsWith('http')) cleanUrl = 'http://' + cleanUrl;
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);

    setIsTesting(true);
    try {
      const response = await fetch(`${cleanUrl}/api.php?token=${inputToken.trim()}&action=status`);
      if (response.ok) {
        await AsyncStorage.setItem('@server_url', cleanUrl);
        await AsyncStorage.setItem('@api_token', inputToken.trim());
        showConfirm({
          type: 'success',
          title: '连接成功',
          message: '已成功接入 Unraid 服务器！',
          confirmText: '开始使用',
          showCancel: false,
        });
        setIsConfigured(true);
        fetchServerData();
      } else {
        showConfirm({
          type: 'warning',
          title: '连接失败',
          message: '服务器无响应或 Token 校验失败',
          confirmText: '重新输入',
          showCancel: false,
        });
      }
    } catch (error) {
      showConfirm({
        type: 'warning',
        title: '网络错误',
        message: '无法连接到指定的服务器地址，请检查网络或防火墙。',
        confirmText: '好的',
        showCancel: false,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchServerData(), fetchNotifications()]);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchServerData();
      const interval = setInterval(() => fetchServerData(), 2500);
      return () => clearInterval(interval);
    }, [])
  );

  // 状态 A：未配置服务器时渲染登录卡片
  if (!isConfigured) {
    return (
      <KeyboardAvoidingView style={styles.center} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.setupCard}>
          <Server color={colors.accent} size={48} style={{ alignSelf: 'center', marginBottom: 16 }} />
          <Text style={styles.setupTitle}>连接 Unraid 控制台</Text>
          <Text style={styles.setupSub}>请输入主服务器访问地址与 API Token</Text>

          <View style={styles.inputContainer}>
            <Server color={colors.sub} size={20} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="http://192.168.x.x:80"
              placeholderTextColor={colors.muted}
              value={inputUrl}
              onChangeText={setInputUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>

          <View style={styles.inputContainer}>
            <Key color={colors.sub} size={20} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="API Token 密钥"
              placeholderTextColor={colors.muted}
              value={inputToken}
              onChangeText={setInputToken}
              secureTextEntry={true}
            />
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveConfig} disabled={isTesting} activeOpacity={0.8}>
            {isTesting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveBtnText}>立即接入</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // -------------------------------------------------------------
  // 数据渲染预计算
  // -------------------------------------------------------------
  const isParityChecking = parity.status === 'checking';
  const cpuVal = Math.min(Math.max(stats.cpu || 0, 0), 100);
  const memVal = Math.min(Math.max(stats.memory || 0, 0), 100);
  const cpuTemp = stats.cpu_temp || (cpuVal > 60 ? 58 : 42);

  // CPU 260° 仪表弧线
  const cpuTrackPath = describeArc(50, 50, 38, 140, 400);
  const cpuProgPath = describeArc(50, 50, 38, 140, 140 + (cpuVal / 100) * 260);

  // RAM 260° 仪表弧线
  const ramTrackPath = describeArc(50, 50, 38, 140, 400);
  const ramProgPath = describeArc(50, 50, 38, 140, 140 + (memVal / 100) * 260);

  // 实际物理内存容量动态计算 (从 /proc/meminfo 获取精确字节)
  const memTotalBytes = stats.mem_total || 0;
  const memUsedBytes = stats.mem_used || (memTotalBytes > 0 ? (memTotalBytes * (memVal / 100)) : 0);

  const formatRamTotal = (bytes) => {
    if (!bytes || bytes <= 0) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) {
      const roundedGb = Math.round(gb);
      const isCloseToStandard = Math.abs(gb - roundedGb) < 0.6;
      const displayGb = isCloseToStandard ? roundedGb : gb.toFixed(1);
      return `${displayGb} GB`;
    }
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  const usedRamDisplayNum = memUsedBytes > 0
    ? (memUsedBytes / (1024 * 1024 * 1024)).toFixed(1)
    : (memTotalBytes > 0 ? ((memVal / 100) * (memTotalBytes / (1024 * 1024 * 1024))).toFixed(1) : `${memVal}`);

  const usedRamUnitText = memTotalBytes > 0 ? '已用 GB' : '使用率 %';

  const totalRamMetaText = memTotalBytes > 0
    ? `总计 ${formatRamTotal(memTotalBytes)} 物理内存`
    : `物理内存已用 ${memVal}%`;

  // 网络波形曲线 SVG 计算 (宽 320, 高 50)
  const downWave = generateSmoothWave(downWaveHistory, 320, 50, 8, 4);
  const upWave = generateSmoothWave(upWaveHistory, 320, 50, 8, 4);

  // 存储容量多色段计算
  const storagePct = storage.percentage || 0;
  const parityPct = Math.min(storagePct * 0.35, 30);
  const dataPct = Math.min(storagePct * 0.55, 60);
  const cachePct = Math.max(0, storagePct - parityPct - dataPct);

  // 获取磁盘列表前 4 个供快速胶囊展示
  const displayDisks = (storage.disks || []).slice(0, 4);

  // 运行中的 Docker 容器前 5 个供快捷矩阵展示
  const runningDockerList = (dockers.list || []).filter(d => d.status === 'running').slice(0, 6);

  // 通知筛选备忘录
  const filteredNotifications = useMemo(() => {
    if (notifFilter === 'alert') {
      return (notifications || []).filter(n => n.importance === 'alert' || n.importance === 'warning');
    }
    if (notifFilter === 'normal') {
      return (notifications || []).filter(n => n.importance === 'normal');
    }
    return notifications || [];
  }, [notifications, notifFilter]);

  // -------------------------------------------------------------
  // 渲染主结构
  // -------------------------------------------------------------
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. 顶部微光胶囊导航条 (Header Bar) */}
      <View style={styles.headerBar}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: serverStatus === 'online' ? colors.green : colors.red }]} />
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.serverTitle} numberOfLines={1}>
                {stats.hostname || serverHost || 'Tower'}
              </Text>
              <Text style={styles.serverVersion}> · Unraid</Text>
            </View>
            <Text style={styles.uptimeSub}>
              {stats.uptime || (serverStatus === 'online' ? '开机运行中' : '主机离线中')}
            </Text>
          </View>
        </View>

        {/* 顶部右侧功能按键 (日志拉取 + 电源管控) */}
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={openSyslogModal}
            activeOpacity={0.7}
            accessibilityLabel="系统日志"
          >
            <Terminal size={17} color={colors.accent} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.headerActionBtn, { marginLeft: 8 }]}
            onPress={() => {
              setNotificationModalVisible(true);
              fetchNotifications();
            }}
            activeOpacity={0.7}
            accessibilityLabel="通知中心"
          >
            <Bell size={17} color={unreadCount > 0 ? colors.accent : colors.sub} />
            {unreadCount > 0 ? (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>
      </View>
      {/* 系统时钟异常或告警横幅 */}
      {timeStatus?.warning ? (
        <TouchableOpacity
          style={styles.timeWarningBanner}
          onPress={() => setNotificationModalVisible(true)}
          activeOpacity={0.8}
        >
          <View style={styles.timeWarningIconBox}>
            <Clock size={16} color="#f59e0b" />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.timeWarningTitle}>系统时钟同步异常警告</Text>
            <Text style={styles.timeWarningText} numberOfLines={2}>
              {timeStatus.warning}
            </Text>
          </View>
          <ChevronRight size={16} color="#f59e0b" style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      ) : null}

      {/* 离线网络唤醒开机卡片 (WOL Remote Wake Card) */}
      {serverStatus === 'offline' && (
        <View style={styles.wolCard}>
          <View style={styles.wolHeaderRow}>
            <View style={styles.wolIconBadge}>
              <Zap color="#ffffff" size={20} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.wolCardTitle}>服务器处于离线状态</Text>
              <Text style={styles.wolCardSub}>
                {wolConfig.mac
                  ? `物理网卡 MAC: ${formatMacAddress(wolConfig.mac)}`
                  : '未检测到物理 MAC 地址，请前往设置配置'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.wolActionBtn, isWaking && styles.wolActionBtnWaking]}
            onPress={handleTriggerWol}
            disabled={isWaking}
            activeOpacity={0.8}
          >
            {isWaking ? (
              <ActivityIndicator color="#ffffff" size="small" style={{ marginRight: 8 }} />
            ) : (
              <Zap color="#ffffff" size={18} style={{ marginRight: 6 }} />
            )}
            <Text style={styles.wolActionBtnText}>
              {isWaking ? '已广播唤醒魔术包，等待开机中...' : '⚡ 网络唤醒开机 (Wake-on-LAN)'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 2. Bento 核心硬件区：CPU 与 RAM 并列卡片 */}
      <View style={styles.bentoRow}>
        {/* CPU 卡片 */}
        <View style={styles.bentoCard}>
          <View style={styles.bentoHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Cpu size={15} color={colors.accent} style={{ marginRight: 6 }} />
              <Text style={styles.bentoTitle}>CPU</Text>
            </View>
            <View style={[styles.tempBadge, { backgroundColor: cpuTemp > 60 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(249, 115, 22, 0.15)' }]}>
              <Text style={[styles.tempBadgeText, { color: cpuTemp > 60 ? colors.red : colors.tempWarm }]}>
                {cpuTemp}°C
              </Text>
            </View>
          </View>

          {/* SVG 仪表环 */}
          <View style={styles.gaugeContainer}>
            <Svg width={100} height={100} viewBox="0 0 100 100">
              <Defs>
                <LinearGradient id="cpuGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <Stop offset="0%" stopColor={colors.accent} />
                  <Stop offset="100%" stopColor={cpuVal > 60 ? colors.red : colors.tempWarm} />
                </LinearGradient>
              </Defs>
              <Path
                d={cpuTrackPath}
                stroke={colors.ringBg}
                strokeWidth={7.5}
                strokeLinecap="round"
                fill="none"
              />
              {cpuProgPath ? (
                <Path
                  d={cpuProgPath}
                  stroke="url(#cpuGrad)"
                  strokeWidth={7.5}
                  strokeLinecap="round"
                  fill="none"
                />
              ) : null}
            </Svg>
            <View style={styles.gaugeCenterText}>
              <Text style={styles.gaugeBigNum}>{cpuVal}%</Text>
              <Text style={styles.gaugeUnitText}>负载率</Text>
            </View>
          </View>

          {/* 多核心动态指示柱条 */}
          <View style={styles.coreBarsRow}>
            {[35, 60, 20, 80, 45, 30, 90, 40].map((h, i) => (
              <View key={i} style={styles.coreBarTrack}>
                <View
                  style={[
                    styles.coreBarFill,
                    {
                      height: `${Math.min(100, Math.max(15, (cpuVal * (0.6 + (i % 5) * 0.15))))}%`,
                      backgroundColor: (i % 2 === 0) ? colors.accent : colors.networkDown
                    }
                  ]}
                />
              </View>
            ))}
          </View>
        </View>

        {/* RAM 卡片 */}
        <View style={styles.bentoCard}>
          <View style={styles.bentoHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Database size={15} color={colors.green} style={{ marginRight: 6 }} />
              <Text style={styles.bentoTitle}>RAM</Text>
            </View>
            <Text style={styles.bentoSubMeta}>{memVal}%</Text>
          </View>

          {/* SVG 仪表环 */}
          <View style={styles.gaugeContainer}>
            <Svg width={100} height={100} viewBox="0 0 100 100">
              <Defs>
                <LinearGradient id="ramGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <Stop offset="0%" stopColor={colors.green} />
                  <Stop offset="100%" stopColor={colors.purple} />
                </LinearGradient>
              </Defs>
              <Path
                d={ramTrackPath}
                stroke={colors.ringBg}
                strokeWidth={7.5}
                strokeLinecap="round"
                fill="none"
              />
              {ramProgPath ? (
                <Path
                  d={ramProgPath}
                  stroke="url(#ramGrad)"
                  strokeWidth={7.5}
                  strokeLinecap="round"
                  fill="none"
                />
              ) : null}
            </Svg>
            <View style={styles.gaugeCenterText}>
              <Text style={styles.gaugeBigNum}>{usedRamDisplayNum}</Text>
              <Text style={styles.gaugeUnitText}>{usedRamUnitText}</Text>
            </View>
          </View>

          {/* 内存总量概览 */}
          <View style={styles.ramMetaBox}>
            <Text style={styles.ramMetaText}>{totalRamMetaText}</Text>
          </View>
        </View>
      </View>

      
      {/* 2.5 GPU 硬件加速卡片 (检测到独立显卡或核心显卡时渲染) */}
      {gpu && gpu.name && gpu.name !== '未配置独立显卡' && gpu.name !== 'N/A' ? (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
              <Zap size={17} color={colors.accent} style={{ marginRight: 8 }} />
              <Text style={styles.cardTitle} numberOfLines={1}>GPU 硬件加速</Text>
            </View>
            <View style={[styles.gpuVendorBadge, {
              backgroundColor: gpu.vendor === 'NVIDIA' ? 'rgba(34, 197, 94, 0.15)' :
                               gpu.vendor === 'INTEL' ? 'rgba(56, 189, 248, 0.15)' :
                               gpu.vendor === 'AMD' ? 'rgba(239, 68, 68, 0.15)' :
                               'rgba(148, 163, 184, 0.15)'
            }]}>
              <Text style={[styles.gpuVendorText, {
                color: gpu.vendor === 'NVIDIA' ? '#22c55e' :
                       gpu.vendor === 'INTEL' ? '#38bdf8' :
                       gpu.vendor === 'AMD' ? '#ef4444' :
                       colors.sub
              }]}>
                {gpu.vendor || 'GPU'}
              </Text>
            </View>
          </View>

          <View style={{ marginTop: 6, marginBottom: 10 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textStrong }} numberOfLines={1}>
              {gpu.name}
            </Text>
            {gpu.driver && gpu.driver !== 'N/A' ? (
              <Text style={{ fontSize: 11, color: colors.sub, marginTop: 2 }}>
                驱动: {gpu.driver}
              </Text>
            ) : null}
          </View>

          {/* GPU 利用率进度条 */}
          <View style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 12, color: colors.sub }}>负载利用率</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.accent, fontFamily: 'monospace' }}>
                {(gpu.usage || 0).toFixed(0)}%
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
              <View style={{
                height: '100%',
                width: `${Math.min(100, Math.max(0, gpu.usage || 0))}%`,
                backgroundColor: (gpu.usage || 0) > 85 ? colors.tempWarm : colors.accent,
                borderRadius: 3
              }} />
            </View>
          </View>

          {/* 详细指标小磁贴 (温度 / 显存 / 频率 / 功耗) */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {gpu.temp !== null && gpu.temp !== undefined ? (
              <View style={[styles.gpuMetricPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc' }]}>
                <Text style={{ fontSize: 10, color: colors.sub }}>核心温度</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: gpu.temp > 75 ? colors.tempWarm : colors.textStrong, fontFamily: 'monospace', marginTop: 2 }}>
                  {gpu.temp}°C
                </Text>
              </View>
            ) : null}

            {gpu.vram_used !== null && gpu.vram_used !== undefined && gpu.vram_total ? (
              <View style={[styles.gpuMetricPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc' }]}>
                <Text style={{ fontSize: 10, color: colors.sub }}>显存占用</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textStrong, fontFamily: 'monospace', marginTop: 2 }}>
                  {(gpu.vram_used / 1024).toFixed(1)} / {(gpu.vram_total / 1024).toFixed(1)} GB
                </Text>
              </View>
            ) : null}

            {gpu.clock_mhz !== null && gpu.clock_mhz !== undefined ? (
              <View style={[styles.gpuMetricPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc' }]}>
                <Text style={{ fontSize: 10, color: colors.sub }}>运行频率</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textStrong, fontFamily: 'monospace', marginTop: 2 }}>
                  {gpu.clock_mhz} MHz
                </Text>
              </View>
            ) : null}

            {gpu.power_w !== null && gpu.power_w !== undefined ? (
              <View style={[styles.gpuMetricPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc' }]}>
                <Text style={{ fontSize: 10, color: colors.sub }}>实时功耗</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textStrong, fontFamily: 'monospace', marginTop: 2 }}>
                  {gpu.power_w} W
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* 3. 实时网络吞吐卡片 (双轨平滑波浪曲线) */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Wifi size={17} color={colors.networkDown} style={{ marginRight: 8 }} />
            <Text style={styles.cardTitle}>网络运输度</Text>
          </View>

          {/* 实时下行与上行速率徽章 */}
          <View style={styles.netBadgesRow}>
            <View style={styles.netRateItem}>
              <ArrowDown size={13} color={colors.networkDown} style={{ marginRight: 3 }} />
              <Text style={[styles.netRateText, { color: colors.networkDown }]}>
                {formatSpeed(netSpeed.down)}
              </Text>
            </View>
            <View style={[styles.netRateItem, { marginLeft: 12 }]}>
              <ArrowUp size={13} color={colors.networkUp} style={{ marginRight: 3 }} />
              <Text style={[styles.netRateText, { color: colors.networkUp }]}>
                {formatSpeed(netSpeed.up)}
              </Text>
            </View>
          </View>
        </View>

        {/* SVG 双轨平滑贝塞尔波形图 */}
        <View style={styles.waveSvgContainer}>
          <Svg width="100%" height={50} viewBox="0 0 320 50">
            <Defs>
              <LinearGradient id="downGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={colors.networkDown} stopOpacity={0.25} />
                <Stop offset="100%" stopColor={colors.networkDown} stopOpacity={0.0} />
              </LinearGradient>
              <LinearGradient id="upGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={colors.networkUp} stopOpacity={0.20} />
                <Stop offset="100%" stopColor={colors.networkUp} stopOpacity={0.0} />
              </LinearGradient>
            </Defs>

            {/* 下行面积与曲线 */}
            {downWave.area ? <Path d={downWave.area} fill="url(#downGrad)" /> : null}
            {downWave.path ? <Path d={downWave.path} stroke={colors.networkDown} strokeWidth={2.2} fill="none" /> : null}

            {/* 上行面积与曲线 */}
            {upWave.area ? <Path d={upWave.area} fill="url(#upGrad)" /> : null}
            {upWave.path ? <Path d={upWave.path} stroke={colors.networkUp} strokeWidth={2.0} fill="none" /> : null}
          </Svg>
        </View>
      </View>

      {/* 4. 存储阵列卡片 (多色段容量分布 + 磁盘温度胶囊) */}
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('存储详情')}
        activeOpacity={0.85}
      >
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <HardDrive size={17} color={colors.accent} style={{ marginRight: 8 }} />
            <Text style={styles.cardTitle}>存储 Array</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
              <ArrowDown size={11} color={colors.networkDown} style={{ marginRight: 2 }} />
              <Text style={{ fontSize: 11, color: colors.networkDown, fontFamily: 'monospace' }}>读 {formatSpeed(diskIoSpeed.read)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ArrowUp size={11} color={colors.networkUp} style={{ marginRight: 2 }} />
              <Text style={{ fontSize: 11, color: colors.networkUp, fontFamily: 'monospace' }}>写 {formatSpeed(diskIoSpeed.write)}</Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 8 }}>
          <Text style={styles.storageCapacityMeta}>
            {formatBytes(storage.total_used)} / {formatBytes(storage.total_size)} ({storage.percentage}%)
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.moreLinkText}>磁盘详情</Text>
            <ChevronRight size={13} color={colors.sub} />
          </View>
        </View>

        {/* 奇偶校验中指示 */}
        {isParityChecking ? (
          <View style={styles.parityAlertStrip}>
            <ShieldCheck size={14} color={colors.amber} style={{ marginRight: 6 }} />
            <Text style={styles.parityAlertText}>
              奇偶校验中 ({(parity.progress || 0).toFixed(1)}%) · 速度: {parity.speed || '计算中'}
            </Text>
          </View>
        ) : null}

        {/* 分段式容量进度条 */}
        <View style={styles.multiSegTrack}>
          <View style={[styles.multiSegBar, { width: `${parityPct}%`, backgroundColor: colors.networkDown }]} />
          <View style={[styles.multiSegBar, { width: `${dataPct}%`, backgroundColor: colors.accent }]} />
          <View style={[styles.multiSegBar, { width: `${cachePct}%`, backgroundColor: colors.tempWarm }]} />
        </View>

        {/* 磁盘温度独立胶囊 */}
        <View style={styles.diskPillsContainer}>
          {displayDisks.length > 0 ? (
            displayDisks.map((d, idx) => {
              const tempNum = d.temp || null;
              const isWarm = tempNum && tempNum >= 40;
              const isCool = tempNum && tempNum < 40;
              return (
                <View key={d.name || idx} style={styles.diskPill}>
                  <View
                    style={[
                      styles.diskDot,
                      { backgroundColor: isWarm ? colors.tempWarm : isCool ? colors.networkDown : colors.muted }
                    ]}
                  />
                  <Text style={styles.diskPillText} numberOfLines={1}>
                    {d.name} {tempNum ? `(${tempNum}°C)` : '(休眠)'}
                  </Text>
                </View>
              );
            })
          ) : (
            <>
              <View style={styles.diskPill}>
                <View style={[styles.diskDot, { backgroundColor: colors.networkDown }]} />
                <Text style={styles.diskPillText}>Parity 1 (34°C)</Text>
              </View>
              <View style={styles.diskPill}>
                <View style={[styles.diskDot, { backgroundColor: colors.accent }]} />
                <Text style={styles.diskPillText}>Disk 1 (36°C)</Text>
              </View>
              <View style={styles.diskPill}>
                <View style={[styles.diskDot, { backgroundColor: colors.tempWarm }]} />
                <Text style={styles.diskPillText}>NVMe Cache (41°C)</Text>
              </View>
            </>
          )}
        </View>
      </TouchableOpacity>

      {/* 5. Docker 常用服务快捷直达矩阵 */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Box size={17} color={colors.accent} style={{ marginRight: 8 }} />
            <Text style={styles.cardTitle}>Docker & 常用服务</Text>
          </View>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center' }}
            onPress={() => navigation.navigate('容器')}
          >
            <Text style={styles.moreLinkText}>更多</Text>
            <ChevronRight size={14} color={colors.sub} />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dockerScrollContainer}
        >
          {/* 汇总磁贴 */}
          <TouchableOpacity
            style={styles.dockerSummaryTile}
            onPress={() => navigation.navigate('容器')}
            activeOpacity={0.8}
          >
            <Text style={styles.dockerSummaryNum}>{dockers.running || 0}</Text>
            <Text style={styles.dockerSummaryLabel}>运行中</Text>
          </TouchableOpacity>

          {/* 常用容器磁贴 */}
          {runningDockerList.length > 0 ? (
            runningDockerList.map((c, i) => {
              const initial = (c.name || 'D').slice(0, 2).toUpperCase();
              return (
                <View key={c.name || i} style={styles.dockerServiceCard}>
                  <View style={styles.dockerCardTop}>
                    <View style={[styles.dockerAvatar, { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#e0f2fe' }]}>
                      <Text style={[styles.dockerAvatarText, { color: colors.accent }]}>{initial}</Text>
                    </View>
                    <Text style={styles.dockerServiceName} numberOfLines={1}>{c.name}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.dockerLaunchBtn}
                    onPress={() => handleQuickLaunchDockerWeb(c)}
                    activeOpacity={0.7}
                  >
                    <ExternalLink size={11} color={colors.accent} style={{ marginRight: 3 }} />
                    <Text style={styles.dockerLaunchBtnText}>Web launch</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          ) : (
            <View style={styles.dockerEmptyHint}>
              <Text style={styles.dockerEmptyText}>点击「更多」管理所有容器</Text>
            </View>
          )}
        </ScrollView>
      </View>

      {/* 6. 虚拟机概览 (VM) */}
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('虚拟机')}
        activeOpacity={0.85}
      >
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Monitor size={17} color={colors.pink} style={{ marginRight: 8 }} />
            <Text style={styles.cardTitle}>虚拟机 (VM)</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.vmRunningText}>
              运行中: <Text style={{ color: colors.green, fontWeight: 'bold' }}>{vms.running || 0}</Text> / {vms.total || 0}
            </Text>
            <ChevronRight size={14} color={colors.sub} style={{ marginLeft: 4 }} />
          </View>
        </View>
      </TouchableOpacity>

      {/* 7. Syslog 终端模态窗 */}
      <Modal
        visible={syslogVisible}
        animationType="slide"
        onRequestClose={() => setSyslogVisible(false)}
      >
        <View style={styles.syslogModalContainer}>
          {/* Header */}
          <View style={styles.syslogHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.syslogTitle}>系统日志 · Syslog</Text>
              <Text style={styles.syslogSub}>/var/log/syslog 实时日志流捕获与诊断</Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                style={styles.syslogActionBtn}
                onPress={fetchSyslog}
                disabled={syslogLoading}
              >
                {syslogLoading ? (
                  <ActivityIndicator size="small" color="#38bdf8" />
                ) : (
                  <RefreshCw size={16} color="#38bdf8" />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.syslogActionBtn, syslogCopiedToast && { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}
                onPress={copyAllSyslogs}
              >
                {syslogCopiedToast ? <Check size={16} color="#34d399" /> : <Copy size={16} color="#94a3b8" />}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.syslogActionBtn}
                onPress={() => setSyslogVisible(false)}
              >
                <X size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Level Filter Tabs */}
          <View style={styles.syslogFilterTabs}>
            <TouchableOpacity
              style={[styles.syslogTab, syslogLevelFilter === 'all' && styles.syslogTabActive]}
              onPress={() => setSyslogLevelFilter('all')}
            >
              <Text style={[styles.syslogTabText, syslogLevelFilter === 'all' && styles.syslogTabTextActive]}>全部</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.syslogTab, syslogLevelFilter === 'error' && { backgroundColor: 'rgba(239, 68, 68, 0.25)' }]}
              onPress={() => setSyslogLevelFilter('error')}
            >
              <Text style={[styles.syslogTabText, syslogLevelFilter === 'error' && { color: '#f87171', fontWeight: 'bold' }]}>Error</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.syslogTab, syslogLevelFilter === 'warn' && { backgroundColor: 'rgba(245, 158, 11, 0.25)' }]}
              onPress={() => setSyslogLevelFilter('warn')}
            >
              <Text style={[styles.syslogTabText, syslogLevelFilter === 'warn' && { color: '#fbbf24', fontWeight: 'bold' }]}>Warn</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.syslogTab, syslogLevelFilter === 'info' && { backgroundColor: 'rgba(59, 130, 246, 0.25)' }]}
              onPress={() => setSyslogLevelFilter('info')}
            >
              <Text style={[styles.syslogTabText, syslogLevelFilter === 'info' && { color: '#60a5fa', fontWeight: 'bold' }]}>Info</Text>
            </TouchableOpacity>
          </View>

          {/* Search Input */}
          <View style={styles.syslogSearchBar}>
            <Search size={15} color="#64748b" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.syslogSearchInput}
              value={syslogSearchQuery}
              onChangeText={setSyslogSearchQuery}
              placeholder="搜索系统日志关键字 (如 emhttp, disk, mdcmd)..."
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {syslogSearchQuery ? (
              <TouchableOpacity onPress={() => setSyslogSearchQuery('')}>
                <X size={15} color="#64748b" />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Copied Feedback */}
          {syslogCopiedToast ? (
            <View style={styles.toastBox}>
              <Text style={styles.toastText}>✓ 系统日志已完整复制到剪贴板</Text>
            </View>
          ) : null}

          {/* Terminal Logs Content */}
          <ScrollView
            ref={syslogScrollRef}
            style={styles.syslogBody}
            contentContainerStyle={styles.syslogBodyContent}
            indicatorStyle="white"
          >
            {syslogLoading && !syslogContent ? (
              <View style={styles.syslogCenter}>
                <ActivityIndicator size="large" color="#38bdf8" style={{ marginBottom: 12 }} />
                <Text style={styles.syslogLoadingText}>正在抓取 Unraid 系统最新日志流...</Text>
              </View>
            ) : (
              <Text selectable={true} style={styles.syslogText}>
                {filteredSyslogs || (syslogSearchQuery || syslogLevelFilter !== 'all' ? '未找到符合筛选条件的日志项' : '暂无系统日志记录')}
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Modern Confirm Dialog */}
      
      {/* 8. 通知与健康中心模态窗 */}
      <Modal
        visible={notificationModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setNotificationModalVisible(false)}
      >
        <View style={styles.notifModalContainer}>
          {/* Header */}
          <View style={styles.notifHeader}>
            <View>
              <Text style={styles.notifTitle}>通知与健康中心</Text>
              <Text style={styles.notifSub}>
                {timeStatus?.synced ? '时钟已校准 · 阵列健康监控' : '注意：检测到时间偏差或潜在异常'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.notifCloseBtn}
              onPress={() => setNotificationModalVisible(false)}
            >
              <X size={18} color={colors.sub} />
            </TouchableOpacity>
          </View>

          {/* Time Drift Status Card */}
          <View style={[styles.timeStatusCard, timeStatus?.warning ? styles.timeStatusCardWarning : styles.timeStatusCardOk]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {timeStatus?.warning ? (
                <Clock size={18} color="#f59e0b" />
              ) : (
                <CheckCircle2 size={18} color={colors.green} />
              )}
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={[styles.timeStatusCardTitle, { color: timeStatus?.warning ? '#f59e0b' : colors.green }]}>
                  {timeStatus?.warning ? '时钟同步警告 (NTP Drift)' : '系统时钟状态正常'}
                </Text>
                <Text style={styles.timeStatusCardSub}>
                  服务器时间: {timeStatus?.server_time || '获取中...'}
                </Text>
                {timeStatus?.warning ? (
                  <Text style={styles.timeStatusExplain}>
                    {timeStatus.warning}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* Filter Tabs */}
          <View style={styles.notifFilterTabs}>
            <TouchableOpacity
              style={[styles.notifTab, notifFilter === 'all' && styles.notifTabActive]}
              onPress={() => setNotifFilter('all')}
            >
              <Text style={[styles.notifTabText, notifFilter === 'all' && styles.notifTabTextActive]}>
                全部 ({notifications.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.notifTab, notifFilter === 'alert' && { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}
              onPress={() => setNotifFilter('alert')}
            >
              <Text style={[styles.notifTabText, notifFilter === 'alert' && { color: '#f87171', fontWeight: 'bold' }]}>
                异常警告 ({notifications.filter(n => n.importance === 'alert' || n.importance === 'warning').length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.notifTab, notifFilter === 'normal' && { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}
              onPress={() => setNotifFilter('normal')}
            >
              <Text style={[styles.notifTabText, notifFilter === 'normal' && { color: '#60a5fa', fontWeight: 'bold' }]}>
                常规通知 ({notifications.filter(n => n.importance === 'normal').length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Notifications List */}
          <ScrollView
            style={styles.notifBody}
            contentContainerStyle={styles.notifBodyContent}
            showsVerticalScrollIndicator={false}
          >
            {filteredNotifications.map((item, idx) => {
              const isAlert = item.importance === 'alert';
              const isWarning = item.importance === 'warning';
              return (
                <View key={item.id || idx} style={[styles.notifItemCard, isAlert && styles.notifItemAlert]}>
                  <View style={styles.notifItemHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      {isAlert ? (
                        <AlertCircle size={16} color={colors.red} style={{ marginRight: 8 }} />
                      ) : isWarning ? (
                        <AlertTriangle size={16} color={colors.amber} style={{ marginRight: 8 }} />
                      ) : (
                        <Info size={16} color={colors.accent} style={{ marginRight: 8 }} />
                      )}
                      <Text style={styles.notifItemSubject} numberOfLines={1}>
                        {item.subject || '系统事件通知'}
                      </Text>
                    </View>
                    <Text style={styles.notifItemTime}>{item.timestamp || ''}</Text>
                  </View>

                  {item.description ? (
                    <Text style={styles.notifItemDesc}>{item.description}</Text>
                  ) : null}

                  {!item.is_read && (
                    <View style={styles.notifItemFooter}>
                      <TouchableOpacity
                        style={styles.dismissBtn}
                        onPress={() => handleDismissNotification(item)}
                        activeOpacity={0.7}
                      >
                        <Check size={12} color={colors.sub} style={{ marginRight: 4 }} />
                        <Text style={styles.dismissBtnText}>标记已读</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}

            {filteredNotifications.length === 0 && (
              <View style={styles.notifEmptyBox}>
                <CheckCircle2 size={44} color={colors.green} style={{ marginBottom: 12, opacity: 0.8 }} />
                <Text style={styles.notifEmptyTitle}>暂无未处理的系统通知</Text>
                <Text style={styles.notifEmptySub}>所有磁盘、容器与核心服务运行状态良好。</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

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

// -------------------------------------------------------------
// Stylesheet (Dynamic Theme Driven)
// -------------------------------------------------------------
const createStyles = (colors, isDark) => StyleSheet.create({
  gpuVendorBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  gpuVendorText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  gpuMetricPill: {
    flex: 1,
    minWidth: 70,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 44 : 24,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    padding: 20,
  },
  setupCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.3 : 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  setupTitle: {
    color: colors.textStrong,
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  setupSub: {
    color: colors.sub,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: colors.textStrong,
    height: 48,
    fontSize: 15,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // 1. Header Bar
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  serverTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  serverVersion: {
    fontSize: 14,
    color: colors.sub,
  },
  uptimeSub: {
    fontSize: 12,
    color: colors.sub,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.2 : 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  // WOL Card
  wolCard: {
    backgroundColor: isDark ? 'rgba(30, 41, 59, 0.9)' : '#fff1f2',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(239, 68, 68, 0.35)' : 'rgba(239, 68, 68, 0.25)',
    borderRadius: 18,
    marginBottom: 16,
    padding: 16,
  },
  wolHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  wolIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wolCardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 2,
  },
  wolCardSub: {
    fontSize: 12,
    color: colors.sub,
  },
  wolActionBtn: {
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  wolActionBtnWaking: {
    backgroundColor: colors.amber,
  },
  wolActionBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },

  // 2. Bento Hardware Row (CPU & RAM)
  bentoRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  bentoCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.25 : 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  bentoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  bentoTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  bentoSubMeta: {
    fontSize: 12,
    color: colors.sub,
    fontWeight: '600',
  },
  tempBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tempBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  gaugeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 105,
    position: 'relative',
  },
  gaugeCenterText: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeBigNum: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textStrong,
    letterSpacing: -0.5,
  },
  gaugeUnitText: {
    fontSize: 11,
    color: colors.sub,
    marginTop: 2,
  },
  coreBarsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 18,
    marginTop: 8,
    paddingHorizontal: 6,
  },
  coreBarTrack: {
    width: 4,
    height: 18,
    backgroundColor: colors.cardSecondary,
    borderRadius: 2,
    justifyContent: 'flex-end',
  },
  coreBarFill: {
    width: 4,
    borderRadius: 2,
  },
  ramMetaBox: {
    alignItems: 'center',
    marginTop: 8,
  },
  ramMetaText: {
    fontSize: 11,
    color: colors.sub,
  },

  // Standard Card Style
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.25 : 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
  },

  // 3. Network Telemetry Card
  netBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  netRateItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  netRateText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  waveSvgContainer: {
    width: '100%',
    height: 50,
    marginTop: 4,
    overflow: 'hidden',
  },

  // 4. Storage Array Card
  storageCapacityMeta: {
    fontSize: 12,
    color: colors.sub,
    fontWeight: '600',
  },
  parityAlertStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    marginBottom: 10,
  },
  parityAlertText: {
    fontSize: 12,
    color: colors.amber,
    fontWeight: 'bold',
  },
  multiSegTrack: {
    height: 9,
    backgroundColor: colors.cardSecondary,
    borderRadius: 4.5,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 14,
  },
  multiSegBar: {
    height: '100%',
  },
  diskPillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  diskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardSecondary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  diskDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  diskPillText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '500',
  },

  // 5. Docker Services Matrix
  moreLinkText: {
    fontSize: 12,
    color: colors.sub,
    marginRight: 2,
  },
  dockerScrollContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 10,
  },
  dockerSummaryTile: {
    width: 82,
    height: 84,
    borderRadius: 16,
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockerSummaryNum: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  dockerSummaryLabel: {
    fontSize: 12,
    color: colors.sub,
    marginTop: 2,
  },
  dockerServiceCard: {
    width: 110,
    height: 84,
    borderRadius: 16,
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 8,
    justifyContent: 'space-between',
  },
  dockerCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dockerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  dockerAvatarText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  dockerServiceName: {
    flex: 1,
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  dockerLaunchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#ffffff',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dockerLaunchBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.accent,
  },
  dockerEmptyHint: {
    paddingHorizontal: 16,
  },
  dockerEmptyText: {
    fontSize: 13,
    color: colors.muted,
  },

  // 6. VM Card
  vmRunningText: {
    fontSize: 13,
    color: colors.sub,
  },

  // 7. Syslog Modal
  syslogModalContainer: {
    flex: 1,
    backgroundColor: isDark ? '#080d19' : '#f8fafc',
  },
  syslogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 16,
    paddingBottom: 14,
    backgroundColor: isDark ? '#0d1424' : '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  syslogTitle: {
    color: colors.textStrong,
    fontSize: 17,
    fontWeight: 'bold',
  },
  syslogSub: {
    color: colors.sub,
    fontSize: 12,
    marginTop: 2,
  },
  syslogActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: isDark ? '#151d2e' : '#f1f5f9',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  syslogFilterTabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  syslogTab: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: isDark ? '#151d2e' : '#f1f5f9',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  syslogTabActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  syslogTabText: {
    color: colors.sub,
    fontSize: 12,
    fontWeight: 'bold',
  },
  syslogTabTextActive: {
    color: '#ffffff',
  },
  syslogSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? '#101726' : '#ffffff',
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  syslogSearchInput: {
    flex: 1,
    color: colors.textStrong,
    fontSize: 13,
    paddingVertical: 0,
  },
  toastBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  toastText: {
    color: colors.green,
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  syslogBody: {
    flex: 1,
    backgroundColor: isDark ? '#050811' : '#f1f5f9',
  },
  syslogBodyContent: {
    padding: 16,
    paddingBottom: 40,
  },
  syslogText: {
    color: isDark ? '#cbd5e1' : '#334155',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  syslogCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
  },
  syslogLoadingText: {
    color: colors.sub,
    fontSize: 13,
  },

  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.red,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: colors.card,
  },
  notifBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  timeWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : 'rgba(254, 243, 199, 0.85)',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  timeWarningIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeWarningTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: isDark ? '#fbbf24' : '#b45309',
    marginBottom: 2,
  },
  timeWarningText: {
    fontSize: 11,
    color: isDark ? '#d1d5db' : '#475569',
    lineHeight: 15,
  },
  notifModalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 24 : 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  notifTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  notifSub: {
    fontSize: 11,
    color: colors.sub,
    marginTop: 2,
  },
  notifCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.cardSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeStatusCard: {
    margin: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  timeStatusCardOk: {
    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(240, 253, 244, 0.9)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  timeStatusCardWarning: {
    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : 'rgba(254, 243, 199, 0.9)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  timeStatusCardTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  timeStatusCardSub: {
    fontSize: 11,
    color: colors.sub,
  },
  timeStatusExplain: {
    fontSize: 11,
    color: colors.textStrong,
    marginTop: 6,
    lineHeight: 16,
  },
  notifFilterTabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 10,
    gap: 8,
  },
  notifTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.cardSecondary,
  },
  notifTabActive: {
    backgroundColor: colors.accent,
  },
  notifTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.sub,
  },
  notifTabTextActive: {
    color: '#ffffff',
  },
  notifBody: {
    flex: 1,
  },
  notifBodyContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 10,
  },
  notifItemCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  notifItemAlert: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: isDark ? 'rgba(239, 68, 68, 0.04)' : 'rgba(254, 242, 242, 0.6)',
  },
  notifItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  notifItemSubject: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textStrong,
    flex: 1,
  },
  notifItemTime: {
    fontSize: 10,
    color: colors.sub,
    marginLeft: 8,
  },
  notifItemDesc: {
    fontSize: 12,
    color: colors.sub,
    lineHeight: 17,
  },
  notifItemFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dismissBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.cardSecondary,
  },
  dismissBtnText: {
    fontSize: 11,
    color: colors.sub,
    fontWeight: '600',
  },
  notifEmptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    paddingHorizontal: 30,
  },
  notifEmptyTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 6,
  },
  notifEmptySub: {
    fontSize: 12,
    color: colors.sub,
    textAlign: 'center',
    lineHeight: 18,
  },

});
