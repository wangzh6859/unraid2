import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet, Text, View, ScrollView, ActivityIndicator, TouchableOpacity,
  Modal, TextInput, Pressable, Platform, Linking, KeyboardAvoidingView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import {
  Cpu, Database, RotateCw, Play, Power, Terminal, ExternalLink,
  Search, Copy, Check, X, RefreshCw, Globe, Sliders, Box, Layers,
  ChevronDown, ArrowUpDown, Filter, Sparkles
} from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import ModernConfirmDialog from '../components/ModernConfirmDialog';
import {
  getProxyConfig, getDockerAliases, saveDockerAlias,
  removeDockerAlias, resolveDockerWebUrl,
  detectLanEnvironment, getCachedLanEnvironment
} from '../utils/dockerWebUiManager';

export default function DockerDetailsScreen() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [dockers, setDockers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'running' | 'stopped'
  const [sortRule, setSortRule] = useState('status'); // 'status' | 'name' | 'cpu'
  const [openingDocker, setOpeningDocker] = useState(null);

  // Modern Confirm Dialog State
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

  // Real-Time Log Viewer Modal State
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [selectedDocker, setSelectedDocker] = useState(null);
  const [logsContent, setLogsContent] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [copiedToast, setCopiedToast] = useState(false);
  const logScrollRef = useRef(null);

  // WebUI Reverse Proxy & Custom Aliases State
  const [proxyConfig, setProxyConfig] = useState({ enabled: false, template: '' });
  const [dockerAliases, setDockerAliases] = useState({});
  const [serverUrl, setServerUrl] = useState('');
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [targetDockerForAlias, setTargetDockerForAlias] = useState(null);
  const [aliasInputValue, setAliasInputValue] = useState('');

  const getAvatarColor = (name) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const palette = ['#38bdf8', '#818cf8', '#a78bfa', '#34d399', '#2dd4bf', '#fbbf24', '#f87171', '#f43f5e', '#ec4899'];
    return palette[Math.abs(hash) % palette.length];
  };

  const fetchDockerData = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=status`, { signal: controller.signal });
      clearTimeout(timeoutId);

      const data = await response.json();
      if (data.dockers && data.dockers.list) setDockers(data.dockers.list);
    } catch (error) {
      console.log('获取 Docker 失败', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProxyData = async () => {
    const [pCfg, aliases, savedUrl] = await Promise.all([
      getProxyConfig(),
      getDockerAliases(),
      AsyncStorage.getItem('@server_url'),
    ]);
    setProxyConfig(pCfg);
    setDockerAliases(aliases || {});
    setServerUrl(savedUrl || '');
    if (savedUrl) {
      detectLanEnvironment(savedUrl);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      let timerId = null;
      const pollData = async () => {
        if (!isActive) return;
        await fetchDockerData();
        if (isActive) timerId = setTimeout(pollData, 3000);
      };
      loadProxyData();
      pollData();
      return () => { isActive = false; if (timerId) clearTimeout(timerId); };
    }, [])
  );

  const executeDockerAction = async (action, name) => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=${action}&target=${encodeURIComponent(name)}`);
      const result = await response.json();
      if (result.status === 'success') {
        await fetchDockerData();
      } else {
        showConfirm({
          type: 'warning',
          title: '操作未成功',
          message: result.message || '服务器拒绝执行此操作',
          confirmText: '知道了',
          showCancel: false,
        });
      }
    } catch (error) {
      showConfirm({
        type: 'warning',
        title: '网络异常',
        message: '连接服务器超时或失败，请检查网络设置。',
        confirmText: '知道了',
        showCancel: false,
      });
    }
  };

  const handleStartDocker = (name) => {
    executeDockerAction('start_docker', name);
  };

  const handleStopDocker = (name) => {
    showConfirm({
      type: 'warning',
      title: '停止容器',
      message: `确定要停止容器「${name}」吗？`,
      confirmText: '确认停止',
      showCancel: true,
      onConfirm: () => executeDockerAction('stop_docker', name),
    });
  };

  const handleRestartDocker = (name) => {
    showConfirm({
      type: 'info',
      title: '重启容器',
      message: `确定要重启容器「${name}」吗？`,
      confirmText: '确认重启',
      showCancel: true,
      onConfirm: () => executeDockerAction('restart_docker', name),
    });
  };

  // 快捷一键直达 WebUI
  const handleLaunchWebUI = async (docker, webUiInfo) => {
    if (!webUiInfo.targetUrl) {
      handleOpenAliasModal(docker, webUiInfo);
      return;
    }

    try {
      setOpeningDocker(docker.name);
      const isLan = typeof detectLanEnvironment === 'function'
        ? await detectLanEnvironment(serverUrl)
        : false;
      const freshInfo = typeof resolveDockerWebUrl === 'function'
        ? (resolveDockerWebUrl(docker, serverUrl, proxyConfig, dockerAliases, isLan) || webUiInfo)
        : webUiInfo;
      const urlToOpen = (freshInfo && freshInfo.targetUrl) || (webUiInfo && webUiInfo.targetUrl);

      const canOpen = await Linking.canOpenURL(urlToOpen);
      if (canOpen) {
        await Linking.openURL(urlToOpen);
      } else {
        showConfirm({
          type: 'warning',
          title: '无法打开链接',
          message: `系统无法唤起该地址：\n${urlToOpen}`,
          showCancel: false,
        });
      }
    } catch (err) {
      showConfirm({
        type: 'warning',
        title: '打开异常',
        message: err.message || '打开 WebUI 遇到未知异常',
        showCancel: false,
      });
    } finally {
      setOpeningDocker(null);
    }
  };

  const handleShowWebUiOptions = (docker, webUiInfo) => {
    const hasInternal = !!webUiInfo.rawInternalUrl;
    const proxy = webUiInfo.proxyUrl || (webUiInfo.isProxy || webUiInfo.isFullUrl ? webUiInfo.targetUrl : '');
    showConfirm({
      type: 'info',
      title: `${docker.name} · Web 访问选项`,
      message: `内网环境 (域名加端口):\n${webUiInfo.rawInternalUrl || '未检测到端口'}\n\n非内网环境 (反代地址):\n${proxy || '未配置全局反代或简称'}\n\n请选择访问方式：`,
      confirmText: '打开内网 (域名加端口)',
      cancelText: proxy ? '打开反代地址' : '配置反代',
      showCancel: true,
      onConfirm: async () => {
        if (webUiInfo.rawInternalUrl) {
          try {
            await Linking.openURL(webUiInfo.rawInternalUrl);
          } catch (e) {
            showConfirm({ type: 'warning', title: '打开异常', message: e.message, showCancel: false });
          }
        } else {
          showConfirm({ type: 'warning', title: '提示', message: '未检测到内网端口直连地址', showCancel: false });
        }
      },
      onCancel: async () => {
        if (proxy) {
          try {
            await Linking.openURL(proxy);
          } catch (e) {
            showConfirm({ type: 'warning', title: '打开异常', message: e.message, showCancel: false });
          }
        } else {
          handleOpenAliasModal(docker, webUiInfo);
        }
      },
    });
  };

  const handleOpenAliasModal = (docker, webUiInfo) => {
    setTargetDockerForAlias(docker);
    setAliasInputValue(webUiInfo.alias || '');
    setAliasModalVisible(true);
  };

  const handleSaveAlias = async () => {
    if (!targetDockerForAlias) return;
    const cName = targetDockerForAlias.name;
    const clean = aliasInputValue ? aliasInputValue.trim() : '';
    await saveDockerAlias(cName, clean);
    setDockerAliases(prev => {
      const updated = { ...prev };
      if (clean) {
        updated[cName] = clean;
      } else {
        delete updated[cName];
      }
      return updated;
    });
    setAliasModalVisible(false);
    showConfirm({
      type: 'success',
      title: '配置已生效',
      message: clean
        ? `已成功为容器「${cName}」设置专属规则：\n${clean.startsWith('http') ? clean : `简称: ${clean} (自动代入模板)`}`
        : `已清除容器「${cName}」的专属简称，恢复为默认解析规则。`,
      confirmText: '好的',
      showCancel: false,
    });
  };

  const handleClearAlias = async () => {
    if (!targetDockerForAlias) return;
    const cName = targetDockerForAlias.name;
    await removeDockerAlias(cName);
    setDockerAliases(prev => {
      const updated = { ...prev };
      delete updated[cName];
      return updated;
    });
    setAliasModalVisible(false);
    showConfirm({
      type: 'info',
      title: '已恢复默认',
      message: `已清除容器「${cName}」的独立反代规则。`,
      confirmText: '好的',
      showCancel: false,
    });
  };

  // 日志拉取与搜索
  const openLogsModal = (dockerItem) => {
    setSelectedDocker(dockerItem);
    setLogsContent('');
    setLogSearchQuery('');
    setLogModalVisible(true);
    fetchDockerLogs(dockerItem.name);
  };

  const fetchDockerLogs = async (dockerName) => {
    setLogsLoading(true);
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;

      const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=docker_logs&target=${encodeURIComponent(dockerName)}&lines=200`);
      const data = await res.json();
      if (data.status === 'success') {
        setLogsContent(data.logs || '暂无输出日志');
        setTimeout(() => {
          if (logScrollRef.current) {
            logScrollRef.current.scrollToEnd({ animated: true });
          }
        }, 300);
      } else {
        const isUnknownAction = data.message && /unknown action/i.test(data.message);
        setLogsContent(isUnknownAction
          ? '获取容器日志失败：服务端尚未更新最新的 api.php。\n\n请将项目代码库中的 api.php 拷贝至 Unraid 服务器的 /usr/local/emhttp/api.php 并执行：\nchmod 755 /usr/local/emhttp/api.php'
          : `获取日志失败: ${data.message || '未知异常'}`);
      }
    } catch (e) {
      setLogsContent(`拉取日志网络异常: ${e.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const copyAllLogs = async () => {
    try {
      await Clipboard.setStringAsync(filteredLogs);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    } catch (e) {
      console.log('Copy logs error:', e);
    }
  };

  const filteredLogs = useMemo(() => {
    if (!logSearchQuery.trim()) return logsContent;
    const query = logSearchQuery.toLowerCase();
    const lines = logsContent.split('\n');
    return lines.filter(line => line.toLowerCase().includes(query)).join('\n');
  }, [logsContent, logSearchQuery]);

  // 聚合指标计算
  const runningCount = useMemo(() => dockers.filter(d => d.status === 'running').length, [dockers]);
  const stoppedCount = useMemo(() => dockers.length - runningCount, [dockers, runningCount]);
  const totalCpuAgg = useMemo(() => {
    let sum = 0;
    dockers.forEach(d => {
      const val = parseFloat(String(d.cpu || '').replace('%', '')) || 0;
      sum += val;
    });
    return sum.toFixed(1);
  }, [dockers]);

  // 过滤与排序
  const processedDockers = useMemo(() => {
    let list = [...dockers];
    if (statusFilter === 'running') {
      list = list.filter(d => d.status === 'running');
    } else if (statusFilter === 'stopped') {
      list = list.filter(d => d.status !== 'running');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(d => (d.name || '').toLowerCase().includes(q) || String(d.port || '').includes(q));
    }

    list.sort((a, b) => {
      if (sortRule === 'status') return (a.status === 'running' ? -1 : 1) - (b.status === 'running' ? -1 : 1);
      if (sortRule === 'cpu') {
        const cpuA = parseFloat(String(a.cpu || '').replace('%', '')) || 0;
        const cpuB = parseFloat(String(b.cpu || '').replace('%', '')) || 0;
        return cpuB - cpuA;
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    return list;
  }, [dockers, statusFilter, searchQuery, sortRule]);

  if (loading && dockers.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>正在加载 Docker 容器清单...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 1. 顶部 Bento 概览看板 (Hero Stats) */}
      <View style={styles.heroRow}>
        <View style={styles.heroCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <View style={[styles.heroDot, { backgroundColor: colors.green }]} />
            <Text style={styles.heroLabel}>运行中</Text>
          </View>
          <Text style={[styles.heroNum, { color: colors.green }]}>{runningCount}</Text>
        </View>

        <View style={styles.heroCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <View style={[styles.heroDot, { backgroundColor: colors.sub }]} />
            <Text style={styles.heroLabel}>已停止</Text>
          </View>
          <Text style={[styles.heroNum, { color: colors.textStrong }]}>{stoppedCount}</Text>
        </View>

        <View style={styles.heroCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Cpu size={11} color={colors.tempWarm} style={{ marginRight: 4 }} />
            <Text style={styles.heroLabel}>总负载</Text>
          </View>
          <Text style={[styles.heroNum, { color: colors.tempWarm }]}>{totalCpuAgg}%</Text>
        </View>
      </View>

      {/* 2. 搜索框与状态筛选胶囊 */}
      <View style={styles.filterSection}>
        <View style={styles.searchBox}>
          <Search size={15} color={colors.sub} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="搜索容器名称或端口..."
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={15} color={colors.sub} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.filterRow}>
          <View style={styles.tabsRow}>
            <TouchableOpacity
              style={[styles.tabBtn, statusFilter === 'all' && styles.tabBtnActive]}
              onPress={() => setStatusFilter('all')}
            >
              <Text style={[styles.tabBtnText, statusFilter === 'all' && styles.tabBtnTextActive]}>
                全部 {dockers.length}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, statusFilter === 'running' && styles.tabBtnActive]}
              onPress={() => setStatusFilter('running')}
            >
              <Text style={[styles.tabBtnText, statusFilter === 'running' && styles.tabBtnTextActive]}>
                运行中 {runningCount}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, statusFilter === 'stopped' && styles.tabBtnActive]}
              onPress={() => setStatusFilter('stopped')}
            >
              <Text style={[styles.tabBtnText, statusFilter === 'stopped' && styles.tabBtnTextActive]}>
                已停止 {stoppedCount}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 排序切换 */}
          <TouchableOpacity
            style={styles.sortToggleBtn}
            onPress={() => {
              const next = sortRule === 'status' ? 'cpu' : sortRule === 'cpu' ? 'name' : 'status';
              setSortRule(next);
            }}
          >
            <ArrowUpDown size={12} color={colors.sub} style={{ marginRight: 4 }} />
            <Text style={styles.sortToggleText}>
              {sortRule === 'status' ? '按状态' : sortRule === 'cpu' ? '按CPU' : '按名称'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 3. 现代化容器卡片列表 */}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {processedDockers.map((docker, index) => {
          const rawMem = String(docker.memory || docker.mem || '');
          const shortMemory = rawMem.includes(' / ') ? rawMem.split(' / ')[0].trim() : (rawMem || '0B');
          const cpuVal = docker.cpu !== undefined && docker.cpu !== null ? String(docker.cpu) : '0%';
          const cpuText = cpuVal.includes('%') ? cpuVal : `${cpuVal}%`;
          const isRunning = docker.status === 'running';
          const defaultWebInfo = { targetUrl: '', proxyUrl: '', rawInternalUrl: '', isCustom: false, isProxy: false, isFullUrl: false, alias: '' };
          const webUiInfo = (typeof resolveDockerWebUrl === 'function')
            ? (resolveDockerWebUrl(docker, serverUrl, proxyConfig, dockerAliases, true) || defaultWebInfo)
            : defaultWebInfo;
          const hasWebAccess = !!(webUiInfo.targetUrl || docker.port || docker.ports);
          const hasCustomAlias = !!dockerAliases[docker.name];
          const avatarBg = getAvatarColor(docker.name);
          const initial = (docker.name || 'D').slice(0, 2).toUpperCase();

          return (
            <View key={docker.name || index} style={styles.dockerCard}>
              {/* 上层：头像 + 名称 + 状态呼吸灯 + 端口 */}
              <View style={styles.cardUpperTier}>
                <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>

                <View style={styles.nameBlock}>
                  <Text style={styles.dockerTitle} numberOfLines={1}>
                    {docker.name}
                  </Text>
                  <View style={styles.metaBadgeRow}>
                    <View style={[styles.statusBadge, { backgroundColor: isRunning ? 'rgba(16, 185, 129, 0.12)' : 'rgba(148, 163, 184, 0.12)' }]}>
                      <View style={[styles.statusDotSmall, { backgroundColor: isRunning ? colors.green : colors.sub }]} />
                      <Text style={[styles.statusBadgeText, { color: isRunning ? colors.green : colors.sub }]}>
                        {isRunning ? '运行中' : '已停止'}
                      </Text>
                    </View>

                    {docker.port ? (
                      <View style={styles.portBadge}>
                        <Text style={styles.portBadgeText}>:{docker.port}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* 资源胶囊 */}
                {isRunning ? (
                  <View style={styles.resourcePillsCol}>
                    <View style={styles.resourcePill}>
                      <Cpu size={10} color={colors.tempWarm} style={{ marginRight: 3 }} />
                      <Text style={[styles.resourcePillText, { color: colors.tempWarm }]}>{cpuText}</Text>
                    </View>
                    <View style={[styles.resourcePill, { marginTop: 4 }]}>
                      <Database size={10} color={colors.accent} style={{ marginRight: 3 }} />
                      <Text style={[styles.resourcePillText, { color: colors.accent }]}>{shortMemory}</Text>
                    </View>
                  </View>
                ) : null}
              </View>

              {/* 下层：Action Bar 交互操作栏 */}
              <View style={styles.cardLowerTier}>
                <View style={styles.webActionGroup}>
                  {hasWebAccess ? (
                    <TouchableOpacity
                      style={styles.webLaunchPill}
                      onPress={() => handleLaunchWebUI(docker, webUiInfo)}
                      onLongPress={() => handleShowWebUiOptions(docker, webUiInfo)}
                      activeOpacity={0.7}
                    >
                      {openingDocker === docker.name ? (
                        <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 5 }} />
                      ) : (
                        <Globe size={13} color="#ffffff" style={{ marginRight: 5 }} />
                      )}
                      <Text style={styles.webLaunchPillText}>Web</Text>
                      <ExternalLink size={11} color="#ffffff" style={{ marginLeft: 3, opacity: 0.85 }} />
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    style={[styles.customConfigPill, hasCustomAlias && styles.customConfigPillActive]}
                    onPress={() => handleOpenAliasModal(docker, webUiInfo)}
                    activeOpacity={0.7}
                  >
                    <Sliders size={12} color={hasCustomAlias ? colors.accent : colors.sub} style={{ marginRight: 4 }} />
                    <Text style={[styles.customConfigPillText, hasCustomAlias && { color: colors.accent, fontWeight: 'bold' }]}>
                      {hasCustomAlias ? '已定制' : '定制'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* 容器操作按键群 */}
                <View style={styles.mgmtBtnGroup}>
                  <TouchableOpacity
                    style={styles.circleActionBtn}
                    onPress={() => openLogsModal(docker)}
                    activeOpacity={0.7}
                  >
                    <Terminal size={14} color={colors.accent} />
                  </TouchableOpacity>

                  {isRunning ? (
                    <TouchableOpacity
                      style={styles.circleActionBtn}
                      onPress={() => handleRestartDocker(docker.name)}
                      activeOpacity={0.7}
                    >
                      <RotateCw size={14} color={colors.sub} />
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    style={[styles.circleActionBtn, { backgroundColor: isRunning ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)' }]}
                    onPress={() => (isRunning ? handleStopDocker(docker.name) : handleStartDocker(docker.name))}
                    activeOpacity={0.7}
                  >
                    {isRunning ? (
                      <Power size={14} color={colors.red} />
                    ) : (
                      <Play size={14} color={colors.green} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}

        {processedDockers.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Box size={42} color={colors.muted} style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>未匹配到任何容器</Text>
            <Text style={styles.emptySub}>尝试切换上方筛选标签或搜索关键字</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* 4. 自定义反代配置弹窗 */}
      <Modal
        visible={aliasModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setAliasModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.aliasModalBox}>
            <View style={styles.aliasModalHeader}>
              <Text style={styles.aliasModalTitle}>
                自定义反代配置 · {targetDockerForAlias?.name || '容器'}
              </Text>
              <Text style={styles.aliasModalSub}>
                为该容器单独指定专属前缀简称（如 alist）或完整反代网址（如 https://alist.yourdomain.com）：
              </Text>
            </View>

            <View style={styles.aliasInputWrapper}>
              <TextInput
                style={styles.aliasTextInput}
                placeholder="例如：alist 或 https://custom.domain.com"
                placeholderTextColor={colors.muted}
                value={aliasInputValue}
                onChangeText={setAliasInputValue}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.aliasModalBtnRow}>
              <TouchableOpacity
                style={styles.aliasClearBtn}
                onPress={handleClearAlias}
              >
                <Text style={styles.aliasClearBtnText}>恢复默认</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.aliasCancelBtn}
                onPress={() => setAliasModalVisible(false)}
              >
                <Text style={styles.aliasCancelBtnText}>取消</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.aliasSaveBtn}
                onPress={handleSaveAlias}
              >
                <Text style={styles.aliasSaveBtnText}>保存规则</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 5. 实时容器日志流模态窗 */}
      <Modal
        visible={logModalVisible}
        animationType="slide"
        onRequestClose={() => setLogModalVisible(false)}
      >
        <View style={styles.logModalContainer}>
          <View style={styles.logHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.logTitle}>{selectedDocker ? `${selectedDocker.name} · 日志` : '容器日志'}</Text>
              <Text style={styles.logSub}>最近 200 行标准输出与错误流 (stdout/stderr)</Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                style={styles.logActionBtn}
                onPress={() => selectedDocker && fetchDockerLogs(selectedDocker.name)}
                disabled={logsLoading}
              >
                {logsLoading ? (
                  <ActivityIndicator size="small" color="#38bdf8" />
                ) : (
                  <RefreshCw size={16} color="#38bdf8" />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.logActionBtn, copiedToast && { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}
                onPress={copyAllLogs}
              >
                {copiedToast ? <Check size={16} color="#34d399" /> : <Copy size={16} color="#94a3b8" />}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.logActionBtn}
                onPress={() => setLogModalVisible(false)}
              >
                <X size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.logSearchBar}>
            <Search size={15} color="#64748b" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.logSearchInput}
              value={logSearchQuery}
              onChangeText={setLogSearchQuery}
              placeholder="过滤日志关键字..."
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {logSearchQuery ? (
              <TouchableOpacity onPress={() => setLogSearchQuery('')}>
                <X size={15} color="#64748b" />
              </TouchableOpacity>
            ) : null}
          </View>

          {copiedToast ? (
            <View style={styles.toastBox}>
              <Text style={styles.toastText}>✓ 日志已完整复制到剪贴板</Text>
            </View>
          ) : null}

          <ScrollView
            ref={logScrollRef}
            style={styles.logBody}
            contentContainerStyle={styles.logBodyContent}
            indicatorStyle="white"
          >
            {logsLoading && !logsContent ? (
              <View style={styles.logCenter}>
                <ActivityIndicator size="large" color="#38bdf8" style={{ marginBottom: 12 }} />
                <Text style={styles.logLoadingText}>正在拉取容器最新日志流...</Text>
              </View>
            ) : (
              <Text selectable={true} style={styles.logText}>
                {filteredLogs || (logSearchQuery ? '未找到符合关键字的日志项' : '暂无日志输出')}
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* 6. Modern Squircle Confirm Dialog */}
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

const createStyles = (colors, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    color: colors.sub,
    fontSize: 14,
    marginTop: 12,
  },

  // Hero Stats Row
  heroRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
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
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: -0.5,
  },

  // Filter Section
  filterSection: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    color: colors.textStrong,
    fontSize: 13,
    paddingVertical: 0,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  tabBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tabBtnText: {
    fontSize: 12,
    color: colors.sub,
    fontWeight: '600',
  },
  tabBtnTextActive: {
    color: '#ffffff',
  },
  sortToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardSecondary,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  sortToggleText: {
    fontSize: 11,
    color: colors.sub,
    fontWeight: '600',
  },

  // Content & Docker Cards
  content: {
    padding: 16,
    paddingTop: 6,
    paddingBottom: 32,
    gap: 12,
  },
  dockerCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.25 : 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardUpperTier: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  nameBlock: {
    flex: 1,
    marginRight: 8,
  },
  dockerTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 4,
  },
  metaBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusDotSmall: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  portBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.cardSecondary,
  },
  portBadgeText: {
    fontSize: 10,
    color: colors.sub,
    fontWeight: '500',
  },
  resourcePillsCol: {
    alignItems: 'flex-end',
  },
  resourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardSecondary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  resourcePillText: {
    fontSize: 10,
    fontWeight: '600',
  },

  // Action Bar (Lower Tier)
  cardLowerTier: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  webActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  webLaunchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  webLaunchPillText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  customConfigPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  customConfigPillActive: {
    borderColor: colors.accent,
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.12)' : '#e0f2fe',
  },
  customConfigPillText: {
    fontSize: 11,
    color: colors.sub,
    fontWeight: '600',
  },
  mgmtBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  circleActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 12,
    color: colors.sub,
  },

  // Custom Reverse Proxy Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  aliasModalBox: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  aliasModalHeader: {
    marginBottom: 14,
  },
  aliasModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 6,
  },
  aliasModalSub: {
    fontSize: 12,
    color: colors.sub,
    lineHeight: 17,
  },
  aliasInputWrapper: {
    backgroundColor: colors.input,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    justifyContent: 'center',
    marginBottom: 16,
  },
  aliasTextInput: {
    color: colors.textStrong,
    fontSize: 13,
  },
  aliasModalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  aliasClearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 'auto',
  },
  aliasClearBtnText: {
    color: colors.red,
    fontSize: 12,
    fontWeight: '600',
  },
  aliasCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.cardSecondary,
  },
  aliasCancelBtnText: {
    color: colors.sub,
    fontSize: 12,
    fontWeight: '600',
  },
  aliasSaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  aliasSaveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // Terminal Log Modal
  logModalContainer: {
    flex: 1,
    backgroundColor: isDark ? '#080d19' : '#f8fafc',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 16,
    paddingBottom: 14,
    backgroundColor: isDark ? '#0d1424' : '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  logTitle: {
    color: colors.textStrong,
    fontSize: 17,
    fontWeight: 'bold',
  },
  logSub: {
    color: colors.sub,
    fontSize: 12,
    marginTop: 2,
  },
  logActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: isDark ? '#151d2e' : '#f1f5f9',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logSearchBar: {
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
  logSearchInput: {
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
  logBody: {
    flex: 1,
    backgroundColor: isDark ? '#050811' : '#f1f5f9',
  },
  logBodyContent: {
    padding: 16,
    paddingBottom: 40,
  },
  logText: {
    color: isDark ? '#cbd5e1' : '#334155',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  logCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
  },
  logLoadingText: {
    color: colors.sub,
    fontSize: 13,
  },
});
