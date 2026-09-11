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
  Search, Copy, Check, X, RefreshCw, Globe, Sliders,
} from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import ModernConfirmDialog from '../components/ModernConfirmDialog';
import {
  getProxyConfig, getDockerAliases, saveDockerAlias,
  removeDockerAlias, resolveDockerWebUiUrl, formatProxyUrl,
  resolveAutoWebUiUrl, probeLanReachable, getCachedLanStatus,
} from '../utils/dockerWebUiManager';

export default function DockerDetailsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [dockers, setDockers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortRule, setSortRule] = useState('name');
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
  const [serverHost, setServerHost] = useState('');
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [targetDockerForAlias, setTargetDockerForAlias] = useState(null);
  const [aliasInputValue, setAliasInputValue] = useState('');

  const getAvatarColor = (name) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const palette = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#2dd4bf', '#38bdf8', '#818cf8', '#a78bfa', '#e879f9', '#f43f5e'];
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

  const loadProxyData = async () => {
    try {
      const [pCfg, aliases, savedUrl] = await Promise.all([
        getProxyConfig(),
        getDockerAliases(),
        AsyncStorage.getItem('@server_url'),
      ]);
      setProxyConfig(pCfg);
      setDockerAliases(aliases || {});
      if (savedUrl) {
        const cleanHost = savedUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:.*$/, '');
        setServerHost(cleanHost);
      }
    } catch (e) {
      console.log('Load proxy data error:', e);
    }
  };

  // Pre-warm LAN detection cache in background when containers load
  useEffect(() => {
    if (dockers.length > 0 && serverHost && getCachedLanStatus() === null) {
      const candidate = dockers.find(d => d.port);
      if (candidate) {
        const cleanHost = serverHost.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:.*$/, '');
        const probeUrl = `http://${cleanHost}:${candidate.port}`;
        probeLanReachable(probeUrl, 700).catch(() => {});
      }
    }
  }, [dockers, serverHost]);

  const handleOpenWebUi = async (docker, webUiInfo) => {
    if (!docker || !webUiInfo) return;
    setOpeningDocker(docker.name);
    try {
      // 自动识别是否为内网环境，非内网直接打开反代地址，内网则打开域名加端口
      const finalUrl = await resolveAutoWebUiUrl(webUiInfo);
      if (finalUrl) {
        const canOpen = await Linking.canOpenURL(finalUrl);
        if (canOpen) {
          await Linking.openURL(finalUrl);
        } else {
          showConfirm({
            type: 'warning',
            title: '无法打开网页',
            message: `系统未能识别或处理该 URL：\n${finalUrl}`,
            showCancel: false,
          });
        }
      } else {
        showConfirm({
          type: 'info',
          title: '未配置访问地址',
          message: '当前容器未检测到映射端口或反代地址。请点击「定制」为其配置专属网址或简称。',
          showCancel: false,
        });
      }
    } catch (err) {
      showConfirm({
        type: 'warning',
        title: '打开链接异常',
        message: err.message || '系统未能拉起浏览器',
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
        ? `已成功为容器「${cName}」设置专属配置：\n${clean.startsWith('http') ? clean : `简称: ${clean} (自动代入模板)`}`
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
    setAliasInputValue('');
    setAliasModalVisible(false);
  };

  const toggleDocker = async (name, currentStatus) => {
    const isStopping = currentStatus === 'running';
    showConfirm({
      type: isStopping ? 'warning' : 'info',
      title: isStopping ? '停止容器' : '启动容器',
      message: isStopping
        ? `确定要停止容器「${name}」吗？依赖该容器的服务将会暂时下线。`
        : `确定要启动容器「${name}」吗？`,
      confirmText: isStopping ? '确认停止' : '确认启动',
      onConfirm: async () => {
        try {
          const savedUrl = await AsyncStorage.getItem('@server_url');
          const savedToken = await AsyncStorage.getItem('@api_token');
          const action = isStopping ? 'stop_docker' : 'start_docker';
          const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=${action}&target=${encodeURIComponent(name)}`);
          const result = await response.json();
          if (result.status === 'success') {
            fetchDockerData();
          } else {
            showConfirm({
              type: 'warning',
              title: '操作失败',
              message: result.message || '服务器拒绝执行指令',
              showCancel: false,
            });
          }
        } catch (error) {
          showConfirm({
            type: 'warning',
            title: '网络异常',
            message: error.message || '无法连接到 Unraid 服务器',
            showCancel: false,
          });
        }
      },
    });
  };

  const restartDocker = async (name) => {
    showConfirm({
      type: 'warning',
      title: '确认重启容器',
      message: `确定要重启容器「${name}」吗？重启过程中服务将短暂中断。`,
      confirmText: '立即重启',
      onConfirm: async () => {
        try {
          const savedUrl = await AsyncStorage.getItem('@server_url');
          const savedToken = await AsyncStorage.getItem('@api_token');
          const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=restart_docker&target=${encodeURIComponent(name)}`);
          const result = await response.json();
          if (result.status === 'success') {
            fetchDockerData();
          } else {
            showConfirm({
              type: 'warning',
              title: '重启失败',
              message: result.message || '服务器拒绝重启容器',
              showCancel: false,
            });
          }
        } catch (error) {
          showConfirm({
            type: 'warning',
            title: '网络异常',
            message: '无法与服务器建立通信',
            showCancel: false,
          });
        }
      },
    });
  };

  // Open Log Viewer
  const openDockerLogs = async (dockerItem) => {
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

  const sortedDockers = [...dockers].sort((a, b) => {
    if (sortRule === 'status') return (a.status === 'running' ? -1 : 1) - (b.status === 'running' ? -1 : 1);
    if (sortRule === 'cpu') {
      const cpuA = parseFloat(String(a.cpu || '').replace('%', '')) || 0;
      const cpuB = parseFloat(String(b.cpu || '').replace('%', '')) || 0;
      return cpuB - cpuA;
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  if (loading && dockers.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.sortBar}>
        <Text style={styles.sortLabel}>排序:</Text>
        <TouchableOpacity
          style={[styles.sortBtn, sortRule === 'name' && styles.sortBtnActive]}
          onPress={() => setSortRule('name')}
        >
          <Text style={[styles.sortBtnText, sortRule === 'name' && { color: '#ffffff' }]}>名称</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sortBtn, sortRule === 'status' && styles.sortBtnActive]}
          onPress={() => setSortRule('status')}
        >
          <Text style={[styles.sortBtnText, sortRule === 'status' && { color: '#ffffff' }]}>状态</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sortBtn, sortRule === 'cpu' && styles.sortBtnActive]}
          onPress={() => setSortRule('cpu')}
        >
          <Text style={[styles.sortBtnText, sortRule === 'cpu' && { color: '#ffffff' }]}>CPU</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {sortedDockers.map((docker, index) => {
          const rawMem = String(docker.memory || docker.mem || '');
          const shortMemory = rawMem.includes(' / ') ? rawMem.split(' / ')[0].trim() : (rawMem || '0B');
          const cpuVal = docker.cpu !== undefined && docker.cpu !== null ? String(docker.cpu) : '0%';
          const cpuText = cpuVal.includes('%') ? cpuVal : `${cpuVal}%`;
          const isRunning = docker.status === 'running';
          const webUiInfo = resolveDockerWebUiUrl(docker, proxyConfig, dockerAliases, serverHost);

          return (
            <View key={index} style={styles.card}>
              {/* Top Section: Avatar + Container Info + Status Pill */}
              <View style={styles.cardHeader}>
                <View style={[styles.avatar, { backgroundColor: getAvatarColor(docker.name) }]}>
                  <Text style={styles.avatarText}>{docker.name.substring(0, 2).toUpperCase()}</Text>
                </View>

                <View style={styles.headerInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.nameText} numberOfLines={1}>{docker.name}</Text>
                    {docker.port ? (
                      <View style={styles.portBadge}>
                        <Text style={styles.portBadgeText}>:{docker.port}</Text>
                      </View>
                    ) : null}
                  </View>

                  {isRunning ? (
                    <View style={styles.statsRow}>
                      <View style={styles.statBadge}>
                        <Cpu size={12} color={colors.amber} />
                        <Text style={styles.statText}>{cpuText}</Text>
                      </View>
                      <View style={styles.statBadge}>
                        <Database size={12} color={colors.green} />
                        <Text style={styles.statText}>{shortMemory}</Text>
                      </View>
                    </View>
                  ) : (
                    <Text style={[styles.stoppedText, { color: colors.muted }]}>已停止运行</Text>
                  )}
                </View>

                {/* Status Pill in Top-Right */}
                <View style={[
                  styles.statusPill,
                  {
                    backgroundColor: isRunning ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    borderColor: isRunning ? 'rgba(16, 185, 129, 0.28)' : 'rgba(239, 68, 68, 0.28)',
                  }
                ]}>
                  <View style={[styles.statusDot, { backgroundColor: isRunning ? colors.green : colors.red }]} />
                  <Text style={[
                    styles.statusPillText,
                    { color: isRunning ? colors.green : colors.red }
                  ]}>
                    {isRunning ? '运行中' : '已停止'}
                  </Text>
                </View>
              </View>

              {/* Card Divider */}
              <View style={styles.cardDivider} />

              {/* Bottom Section: WebUI Shortcut (Left) + Actions (Right) */}
              <View style={styles.cardFooter}>
                <View style={styles.footerLeft}>
                  {webUiInfo.targetUrl || webUiInfo.rawInternalUrl ? (
                    <TouchableOpacity
                      style={[
                        styles.webUiBtn,
                        !isRunning && { opacity: 0.6 }
                      ]}
                      onPress={() => handleOpenWebUi(docker, webUiInfo)}
                      onLongPress={() => handleShowWebUiOptions(docker, webUiInfo)}
                      activeOpacity={0.75}
                      disabled={openingDocker === docker.name}
                    >
                      {openingDocker === docker.name ? (
                        <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 4 }} />
                      ) : (
                        <Globe size={13} color="#ffffff" style={{ marginRight: 4 }} />
                      )}
                      <Text style={styles.webUiBtnText}>Web</Text>
                      <ExternalLink size={10} color="rgba(255, 255, 255, 0.85)" style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    style={[
                      styles.aliasEditBtn,
                      !(webUiInfo.targetUrl || webUiInfo.rawInternalUrl) && styles.aliasEditBtnDashed
                    ]}
                    onPress={() => handleOpenAliasModal(docker, webUiInfo)}
                    activeOpacity={0.7}
                  >
                    <Sliders size={12} color={webUiInfo.isCustom ? colors.accent : colors.sub} style={{ marginRight: 4 }} />
                    <Text style={[styles.aliasEditBtnText, { color: webUiInfo.isCustom ? colors.accent : colors.sub }]}>
                      {!(webUiInfo.targetUrl || webUiInfo.rawInternalUrl) ? '+ 配置Web' : '定制'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.footerRight}>
                  {/* Terminal Log Button */}
                  <TouchableOpacity
                    onPress={() => openDockerLogs(docker)}
                    style={styles.actionBtn}
                    activeOpacity={0.7}
                  >
                    <Terminal size={15} color={colors.text} />
                  </TouchableOpacity>

                  {/* Restart Button */}
                  {isRunning && (
                    <TouchableOpacity
                      onPress={() => restartDocker(docker.name)}
                      style={[styles.actionBtn, { backgroundColor: colors.purple }]}
                      activeOpacity={0.7}
                    >
                      <RotateCw size={14} color="#ffffff" />
                    </TouchableOpacity>
                  )}

                  {/* Start / Stop Button */}
                  <TouchableOpacity
                    onPress={() => toggleDocker(docker.name, docker.status)}
                    style={[styles.actionBtn, { backgroundColor: isRunning ? colors.red : colors.green }]}
                    activeOpacity={0.7}
                  >
                    {isRunning ? <Power size={14} color="#ffffff" /> : <Play size={14} color="#ffffff" />}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Terminal Real-Time Log Viewer Modal */}
      <Modal
        visible={logModalVisible}
        animationType="slide"
        onRequestClose={() => setLogModalVisible(false)}
      >
        <View style={styles.logContainer}>
          {/* Header Bar */}
          <View style={styles.logHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.logHeaderTitle} numberOfLines={1}>
                容器日志 · {selectedDocker?.name}
              </Text>
              <Text style={styles.logHeaderSub}>实时抓取最新 200 行标准输出</Text>
            </View>

            <View style={styles.logHeaderActions}>
              <TouchableOpacity
                style={[styles.logActionBtn, { backgroundColor: '#1e293b' }]}
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
                style={[styles.logActionBtn, { backgroundColor: copiedToast ? 'rgba(16, 185, 129, 0.2)' : '#1e293b' }]}
                onPress={copyAllLogs}
              >
                {copiedToast ? <Check size={16} color="#34d399" /> : <Copy size={16} color="#94a3b8" />}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.logActionBtn, { backgroundColor: '#1e293b' }]}
                onPress={() => setLogModalVisible(false)}
              >
                <X size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Search Filter Bar */}
          <View style={styles.logSearchBar}>
            <Search size={16} color="#64748b" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.logSearchInput}
              value={logSearchQuery}
              onChangeText={setLogSearchQuery}
              placeholder="过滤日志关键字 (例如: error, starting, warn)..."
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {logSearchQuery ? (
              <TouchableOpacity onPress={() => setLogSearchQuery('')}>
                <X size={16} color="#64748b" />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Toast Notification */}
          {copiedToast ? (
            <View style={styles.toastBox}>
              <Text style={styles.toastText}>✓ 全部日志已复制到系统剪贴板</Text>
            </View>
          ) : null}

          {/* Terminal Output Area */}
          <ScrollView
            ref={logScrollRef}
            style={styles.terminalBody}
            contentContainerStyle={styles.terminalContent}
            indicatorStyle="white"
          >
            {logsLoading && !logsContent ? (
              <View style={styles.logCenter}>
                <ActivityIndicator size="large" color="#38bdf8" style={{ marginBottom: 12 }} />
                <Text style={styles.logLoadingText}>正在拉取容器 stdout/stderr 日志流...</Text>
              </View>
            ) : (
              <Text selectable={true} style={styles.logText}>
                {filteredLogs || (logSearchQuery ? '无匹配该关键字的日志行' : '暂无日志输出')}
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Container Custom Alias / URL Edit Modal */}
      <Modal
        visible={aliasModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAliasModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlayCenter}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAliasModalVisible(false)} />
          <View style={[styles.aliasModalBox, { backgroundColor: colors.card }]}>
            <View style={[styles.dialogIconBadge, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
              <Globe color={colors.accent} size={28} />
            </View>
            <Text style={[styles.aliasModalTitle, { color: colors.textStrong }]}>
              自定义反代配置 · {targetDockerForAlias?.name}
            </Text>
            <Text style={[styles.aliasModalSub, { color: colors.sub }]}>
              {proxyConfig.enabled && proxyConfig.template
                ? `全局反代模板：${proxyConfig.template}\n输入简称（如 qb）将自动拼接，或输入独立专属网址。`
                : '全局反代模板未开启或未配置。建议直接输入完整网址（如 https://...），或前往【设置】配置全局反代模板。'}
            </Text>

            <TextInput
              style={[styles.aliasModalInput, { backgroundColor: colors.input, color: colors.textStrong }]}
              value={aliasInputValue}
              onChangeText={setAliasInputValue}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="输入简称 (如 qb) 或专属网址 (如 https://...)"
              placeholderTextColor={colors.muted}
            />

            {/* Live Preview Box */}
            <View style={[styles.previewBox, { backgroundColor: colors.input }]}>
              <Text style={[styles.previewLabel, { color: colors.sub }]}>跳转预览:</Text>
              <Text style={[styles.previewUrl, { color: colors.accent }]} numberOfLines={2}>
                {(() => {
                  const val = aliasInputValue ? aliasInputValue.trim() : '';
                  if (!val) {
                    if (proxyConfig.enabled && proxyConfig.template && targetDockerForAlias) {
                      return formatProxyUrl(proxyConfig.template, targetDockerForAlias.name, targetDockerForAlias.port);
                    }
                    return targetDockerForAlias?.webui || (targetDockerForAlias?.port ? `http://${serverHost || 'IP'}:${targetDockerForAlias.port}` : '未检测到默认访问地址');
                  }
                  if (val.startsWith('http://') || val.startsWith('https://')) {
                    return val;
                  }
                  if (proxyConfig.template) {
                    return formatProxyUrl(proxyConfig.template, val, targetDockerForAlias?.port);
                  }
                  return `简称: ${val} (需在【设置】开启反代模板后方可拼接)`;
                })()}
              </Text>
            </View>

            <View style={styles.aliasModalBtns}>
              {dockerAliases[targetDockerForAlias?.name] ? (
                <TouchableOpacity
                  style={[styles.aliasModalBtn, { backgroundColor: 'rgba(239, 68, 68, 0.15)', marginRight: 8 }]}
                  onPress={handleClearAlias}
                >
                  <Text style={[styles.aliasModalBtnText, { color: colors.red }]}>恢复默认</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.aliasModalBtn, { backgroundColor: colors.input, marginRight: 8 }]}
                onPress={() => setAliasModalVisible(false)}
              >
                <Text style={[styles.aliasModalBtnText, { color: colors.sub }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.aliasModalBtn, { backgroundColor: colors.accent, flex: 1 }]}
                onPress={handleSaveAlias}
              >
                <Text style={[styles.aliasModalBtnText, { color: '#ffffff' }]}>保存生效</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modern Confirm Dialog */}
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

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  sortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  sortLabel: { color: colors.sub, marginRight: 12, fontSize: 14 },
  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.input,
    marginRight: 8,
  },
  sortBtnActive: { backgroundColor: colors.accent },
  sortBtnText: { color: colors.text, fontSize: 12, fontWeight: 'bold' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerInfo: {
    flex: 1,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  nameText: {
    color: colors.textStrong,
    fontSize: 15,
    fontWeight: 'bold',
    flexShrink: 1,
  },
  portBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  portBadgeText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  stoppedText: {
    fontSize: 12,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    gap: 4,
  },
  statText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: 11,
    opacity: 0.7,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 10,
  },
  webUiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 8,
  },
  webUiBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  aliasEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    paddingHorizontal: 9,
    height: 32,
    borderRadius: 8,
  },
  aliasEditBtnDashed: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  aliasEditBtnText: {
    fontSize: 12,
    fontWeight: '500',
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    width: 34,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.input,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Terminal Log Viewer Styles
  logContainer: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 16,
    paddingBottom: 14,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  logHeaderTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: 'bold',
  },
  logHeaderSub: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  logHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logSearchBar: {
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
  logSearchInput: {
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
  terminalBody: {
    flex: 1,
    backgroundColor: '#050811',
  },
  terminalContent: {
    padding: 16,
    paddingBottom: 40,
  },
  logText: {
    color: '#e2e8f0',
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
    color: '#94a3b8',
    fontSize: 13,
  },

  modalOverlayCenter: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  aliasModalBox: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  dialogIconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  aliasModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  aliasModalSub: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  aliasModalInput: {
    width: '100%',
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 14,
    marginBottom: 12,
  },
  previewBox: {
    width: '100%',
    borderRadius: 10,
    padding: 10,
    marginBottom: 18,
  },
  previewLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  previewUrl: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  aliasModalBtns: {
    flexDirection: 'row',
    width: '100%',
  },
  aliasModalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aliasModalBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
});