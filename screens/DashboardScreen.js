import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet, Text, View, ScrollView, RefreshControl, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import {
  Cpu, Database, HardDrive, Box, Monitor, Wifi, Zap, Server, Key,
  ShieldCheck, AlertCircle, Play, Pause, Square, FileText, Search,
  RefreshCw, Copy, Check, X,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../ThemeContext';
import ModernConfirmDialog from '../components/ModernConfirmDialog';

export default function DashboardScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // 核心状态：是否已配置 Unraid 信息
  const [isConfigured, setIsConfigured] = useState(true);

  // 登录表单状态
  const [inputUrl, setInputUrl] = useState('');
  const [inputToken, setInputToken] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  // 仪表盘状态
  const [refreshing, setRefreshing] = useState(false);
  const [serverStatus, setServerStatus] = useState('offline');
  const [stats, setStats] = useState({ cpu: 0, memory: 0 });
  const [gpu, setGpu] = useState({ name: 'N/A', usage: 0 });
  const [storage, setStorage] = useState({ percentage: 0, total_used: 0, total_size: 0 });
  const [dockers, setDockers] = useState({ running: 0, total: 0, list: [] });
  const [vms, setVms] = useState({ running: 0, total: 0, list: [] });
  const prevNetwork = useRef({ rx: 0, tx: 0, time: 0 });
  const [netSpeed, setNetSpeed] = useState({ down: 0, up: 0 });

  // 阵列奇偶校验状态 (Parity Check)
  const [parity, setParity] = useState({
    status: 'idle',
    progress: 0,
    speed: '',
    errors: 0,
    finish: '',
    action: '空闲',
    is_checking: false,
  });
  const [parityLoading, setParityLoading] = useState(false);

  // Syslog 系统日志模态窗状态
  const [syslogVisible, setSyslogVisible] = useState(false);
  const [syslogContent, setSyslogContent] = useState('');
  const [syslogLoading, setSyslogLoading] = useState(false);
  const [syslogSearchQuery, setSyslogSearchQuery] = useState('');
  const [syslogLevelFilter, setSyslogLevelFilter] = useState('all'); // 'all' | 'error' | 'warn' | 'info'
  const [syslogCopiedToast, setSyslogCopiedToast] = useState(false);
  const syslogScrollRef = useRef(null);

  // Modern Squircle Confirm Dialog
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
      if (data.stats) setStats(data.stats);
      if (data.gpu) setGpu(data.gpu);
      if (data.storage) setStorage(data.storage);
      if (data.dockers) setDockers(data.dockers);
      if (data.vms) setVms(data.vms);
      if (data.parity) setParity(data.parity);
      if (data.network) {
        const now = Date.now();
        if (prevNetwork.current.time > 0) {
          const timeDiff = (now - prevNetwork.current.time) / 1000;
          const rxDiff = data.network.rx_bytes - prevNetwork.current.rx;
          const txDiff = data.network.tx_bytes - prevNetwork.current.tx;
          if (timeDiff > 0 && rxDiff >= 0 && txDiff >= 0) {
            setNetSpeed({ down: (rxDiff / timeDiff / 1024).toFixed(1), up: (txDiff / timeDiff / 1024).toFixed(1) });
          }
        }
        prevNetwork.current = { rx: data.network.rx_bytes, tx: data.network.tx_bytes, time: now };
      }
    } catch (error) {
      setServerStatus('offline');
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchServerData();
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchServerData();
      const interval = setInterval(() => fetchServerData(), 2000);
      return () => clearInterval(interval);
    }, [])
  );

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (kb) => {
    const n = parseFloat(kb) || 0;
    return n > 1024 ? (n / 1024).toFixed(1) + ' MB/s' : n.toFixed(1) + ' KB/s';
  };

  // 处理奇偶校验控制指令
  const handleParityControl = (cmd, actionName) => {
    showConfirm({
      type: cmd === 'cancel' ? 'warning' : 'info',
      title: `${actionName}确认`,
      message: cmd === 'start'
        ? '即将开始阵列奇偶校验。校验过程将顺序扫描所有磁盘阵列数据，并验证数据块完整性。'
        : cmd === 'cancel'
        ? '确定要提前终止当前的奇偶校验任务吗？'
        : `确定要${actionName}当前的奇偶校验任务吗？`,
      confirmText: `确认${actionName}`,
      onConfirm: async () => {
        setParityLoading(true);
        try {
          const savedUrl = await AsyncStorage.getItem('@server_url');
          const savedToken = await AsyncStorage.getItem('@api_token');
          if (!savedUrl || !savedToken) return;

          const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=parity_control&cmd=${cmd}`);
          const data = await res.json();
          if (data.status === 'success') {
            fetchServerData();
            showConfirm({
              type: 'success',
              title: `${actionName}成功`,
              message: data.message || '指令已成功下发至 Unraid 内核',
              confirmText: '好的',
              showCancel: false,
            });
          } else {
            showConfirm({
              type: 'warning',
              title: '执行异常',
              message: data.message || '服务器拒绝执行校验指令',
              confirmText: '知道了',
              showCancel: false,
            });
          }
        } catch (e) {
          showConfirm({
            type: 'warning',
            title: '网络通信失败',
            message: e.message || '无法连接到服务器',
            confirmText: '知道了',
            showCancel: false,
          });
        } finally {
          setParityLoading(false);
        }
      },
    });
  };

  // 拉取系统 Syslog
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
        setSyslogContent(`获取日志失败: ${data.message || '未知异常'}`);
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

  // 处理登录并保存配置
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

  // 状态 A：未配置时渲染登录表单
  if (!isConfigured) {
    return (
      <KeyboardAvoidingView style={styles.center} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.setupCard}>
          <Server color={colors.accent} size={48} style={{ alignSelf: 'center', marginBottom: 16 }} />
          <Text style={styles.setupTitle}>连接 Unraid</Text>
          <Text style={styles.setupSub}>请输入主服务器的 API 访问凭证</Text>

          <View style={styles.inputContainer}>
            <Server color={colors.sub} size={20} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="http://192.168.x.x"
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

          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveConfig} disabled={isTesting}>
            {isTesting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveBtnText}>接入控制台</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  const isParityChecking = parity.status === 'checking';
  const isParityPaused = parity.status === 'paused';

  // 状态 B：已配置时渲染仪表盘
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {/* Header Row with Server Status & Syslog Entry */}
      <View style={styles.headerRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={[styles.statusIndicator, { backgroundColor: serverStatus === 'online' ? colors.green : colors.red }]} />
          <Text style={styles.headerText}>Unraid Server</Text>
        </View>

        {/* Syslog Viewer Trigger */}
        <TouchableOpacity
          style={[styles.syslogHeaderBtn, { backgroundColor: colors.card }]}
          onPress={openSyslogModal}
          activeOpacity={0.7}
        >
          <FileText size={16} color={colors.accent} style={{ marginRight: 5 }} />
          <Text style={[styles.syslogHeaderBtnText, { color: colors.textStrong }]}>系统日志</Text>
        </TouchableOpacity>
      </View>

      {/* Hardware Telemetry Grids */}
      <View style={styles.gridRow}>
        <View style={[styles.card, styles.gridCard, { marginRight: 8 }]}>
          <View style={styles.cardHeader}>
            <Cpu color={colors.amber} size={20} />
            <Text style={styles.cardTitle}>CPU</Text>
          </View>
          <Text style={styles.mainNumber}>{stats.cpu}%</Text>
          <View style={styles.miniTrack}>
            <View style={[styles.miniBar, { width: `${stats.cpu}%`, backgroundColor: stats.cpu > 80 ? colors.red : colors.amber }]} />
          </View>
        </View>
        <View style={[styles.card, styles.gridCard, { marginLeft: 8 }]}>
          <View style={styles.cardHeader}>
            <Zap color={colors.purple} size={20} />
            <Text style={styles.cardTitle}>GPU</Text>
          </View>
          <Text style={styles.mainNumber}>{gpu.usage}%</Text>
          <Text style={styles.subText} numberOfLines={1}>{gpu.name}</Text>
        </View>
      </View>

      <View style={styles.gridRow}>
        <View style={[styles.card, styles.gridCard, { marginRight: 8 }]}>
          <View style={styles.cardHeader}>
            <Database color={colors.green} size={20} />
            <Text style={styles.cardTitle}>内存</Text>
          </View>
          <Text style={styles.mainNumber}>{stats.memory}%</Text>
          <View style={styles.miniTrack}>
            <View style={[styles.miniBar, { width: `${stats.memory}%`, backgroundColor: stats.memory > 80 ? colors.red : colors.green }]} />
          </View>
        </View>
        <View style={[styles.card, styles.gridCard, { marginLeft: 8 }]}>
          <View style={styles.cardHeader}>
            <Wifi color={colors.accent} size={20} />
            <Text style={styles.cardTitle}>网络</Text>
          </View>
          <Text style={styles.subText}>↓ {formatSpeed(netSpeed.down)}</Text>
          <Text style={styles.subText}>↑ {formatSpeed(netSpeed.up)}</Text>
        </View>
      </View>

      {/* Array Parity Check Card */}
      <View style={styles.card}>
        <View style={styles.parityHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ShieldCheck color={isParityChecking ? colors.amber : colors.green} size={22} />
            <Text style={styles.cardTitle}>阵列奇偶校验</Text>
          </View>

          <View style={[
            styles.parityTag,
            {
              backgroundColor: isParityChecking
                ? 'rgba(245, 158, 11, 0.15)'
                : isParityPaused
                ? 'rgba(239, 68, 68, 0.15)'
                : 'rgba(16, 185, 129, 0.15)'
            }
          ]}>
            <Text style={[
              styles.parityTagText,
              {
                color: isParityChecking
                  ? colors.amber
                  : isParityPaused
                  ? colors.red
                  : colors.green
              }
            ]}>
              {isParityChecking ? '校验进行中' : isParityPaused ? '校验已暂停' : '空闲 / 状态正常'}
            </Text>
          </View>
        </View>

        {isParityChecking || isParityPaused ? (
          <View style={{ marginTop: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <Text style={[styles.mainNumber, { fontSize: 24, marginBottom: 0 }]}>
                {parity.progress.toFixed(1)}%
              </Text>
              {parity.speed ? (
                <Text style={[styles.subText, { color: colors.accent, fontWeight: 'bold' }]}>
                  {parity.speed}
                </Text>
              ) : null}
            </View>

            <View style={styles.track}>
              <View style={[styles.bar, { width: `${Math.min(100, Math.max(0, parity.progress))}%`, backgroundColor: colors.amber }]} />
            </View>

            <View style={styles.parityMetaRow}>
              <Text style={styles.subText}>
                预计剩余: {parity.finish || '计算中...'}
              </Text>
              <Text style={[styles.subText, { color: parity.errors > 0 ? colors.red : colors.sub }]}>
                同步错误: {parity.errors}
              </Text>
            </View>

            {/* Parity In-Progress Controls */}
            <View style={styles.parityBtnRow}>
              {isParityChecking ? (
                <TouchableOpacity
                  style={[styles.parityMiniBtn, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}
                  onPress={() => handleParityControl('pause', '暂停')}
                  disabled={parityLoading}
                >
                  <Pause size={14} color={colors.amber} style={{ marginRight: 4 }} />
                  <Text style={[styles.parityMiniBtnText, { color: colors.amber }]}>暂停</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.parityMiniBtn, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}
                  onPress={() => handleParityControl('resume', '恢复')}
                  disabled={parityLoading}
                >
                  <Play size={14} color={colors.green} style={{ marginRight: 4 }} />
                  <Text style={[styles.parityMiniBtnText, { color: colors.green }]}>恢复校验</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.parityMiniBtn, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}
                onPress={() => handleParityControl('cancel', '终止')}
                disabled={parityLoading}
              >
                <Square size={14} color={colors.red} style={{ marginRight: 4 }} />
                <Text style={[styles.parityMiniBtnText, { color: colors.red }]}>终止校验</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={{ marginTop: 12 }}>
            <Text style={[styles.subText, { marginBottom: 12 }]}>
              当前未在执行奇偶校验。定期执行校验可确保双校验/单校验盘与数据盘的一致性，防范坏道风险。
            </Text>
            <TouchableOpacity
              style={[styles.parityStartBtn, { backgroundColor: colors.accent }]}
              onPress={() => handleParityControl('start', '启动奇偶校验')}
              disabled={parityLoading}
            >
              {parityLoading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Play size={15} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.parityStartBtnText}>启动无修正奇偶校验 (Check)</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Storage Array */}
      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('存储详情')}>
        <View style={styles.cardHeader}>
          <HardDrive color={colors.green} size={24} />
          <Text style={styles.cardTitle}>阵列存储</Text>
        </View>
        <Text style={styles.mainNumber}>{storage.percentage}%</Text>
        <Text style={styles.subText}>已用 {formatBytes(storage.total_used)} / 总共 {formatBytes(storage.total_size)}</Text>
        <View style={[styles.track, { marginTop: 12 }]}>
          <View style={[styles.bar, { width: `${storage.percentage}%`, backgroundColor: storage.percentage > 80 ? colors.red : colors.green }]} />
        </View>
      </TouchableOpacity>

      {/* Docker Containers */}
      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Docker详情')}>
        <View style={styles.cardHeader}>
          <Box color={colors.accent} size={24} />
          <Text style={styles.cardTitle}>Docker 容器</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>运行中: <Text style={{ color: colors.green, fontWeight: 'bold' }}>{dockers.running}</Text></Text>
          <Text style={styles.summaryText}>总计: {dockers.total}</Text>
        </View>
      </TouchableOpacity>

      {/* Virtual Machines */}
      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('VM详情')}>
        <View style={styles.cardHeader}>
          <Monitor color={colors.pink} size={24} />
          <Text style={styles.cardTitle}>虚拟机 (VM)</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>运行中: <Text style={{ color: colors.green, fontWeight: 'bold' }}>{vms.running}</Text></Text>
          <Text style={styles.summaryText}>总计: {vms.total}</Text>
        </View>
      </TouchableOpacity>

      {/* Syslog Real-Time Modal */}
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
              <Text style={styles.syslogSub}>/var/log/syslog 实时日志捕获与诊断</Text>
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
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 20 },
  setupCard: { backgroundColor: colors.card, borderRadius: 16, padding: 24, elevation: 5 },
  setupTitle: { color: colors.textStrong, fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  setupSub: { color: colors.sub, fontSize: 13, textAlign: 'center', marginBottom: 24 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderRadius: 8, marginBottom: 16, paddingHorizontal: 12 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: colors.textStrong, height: 50, fontSize: 16 },
  saveBtn: { backgroundColor: colors.accent, height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },

  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40, paddingTop: 40 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  statusIndicator: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  headerText: { color: colors.textStrong, fontSize: 22, fontWeight: 'bold' },
  syslogHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  syslogHeaderBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
  },

  gridRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  gridCard: { flex: 1, marginBottom: 0 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 20, marginBottom: 16, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardTitle: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  mainNumber: { color: colors.textStrong, fontSize: 28, fontWeight: 'bold', marginBottom: 4 },
  subText: { color: colors.sub, fontSize: 13 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  summaryText: { color: colors.text, fontSize: 16 },
  track: { height: 8, backgroundColor: colors.input, borderRadius: 4, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  miniTrack: { height: 6, backgroundColor: colors.input, borderRadius: 3, marginTop: 12, overflow: 'hidden' },
  miniBar: { height: '100%', borderRadius: 3 },

  // Parity Check Card Styles
  parityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  parityTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  parityTagText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  parityMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  parityBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  parityMiniBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
  },
  parityMiniBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  parityStartBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parityStartBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },

  // Syslog Terminal Modal
  syslogModalContainer: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
  syslogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 16,
    paddingBottom: 14,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  syslogTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: 'bold',
  },
  syslogSub: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  syslogActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#1e293b',
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
    backgroundColor: '#1e293b',
  },
  syslogTabActive: {
    backgroundColor: '#38bdf8',
  },
  syslogTabText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  syslogTabTextActive: {
    color: '#0f172a',
  },
  syslogSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  syslogSearchInput: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 13,
    paddingVertical: 0,
  },
  toastBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  toastText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  syslogBody: {
    flex: 1,
    backgroundColor: '#050811',
  },
  syslogBodyContent: {
    padding: 16,
    paddingBottom: 40,
  },
  syslogText: {
    color: '#cbd5e1',
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
    color: '#94a3b8',
    fontSize: 13,
  },
});