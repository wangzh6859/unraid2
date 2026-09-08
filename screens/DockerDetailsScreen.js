import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet, Text, View, ScrollView, ActivityIndicator, TouchableOpacity,
  Modal, TextInput, Pressable, Platform, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import {
  Cpu, Database, RotateCw, Play, Power, Terminal, ExternalLink,
  Search, Copy, Check, X, RefreshCw, Globe,
} from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import ModernConfirmDialog from '../components/ModernConfirmDialog';

export default function DockerDetailsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [dockers, setDockers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortRule, setSortRule] = useState('name');

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
      pollData();
      return () => { isActive = false; if (timerId) clearTimeout(timerId); };
    }, [])
  );

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

          return (
            <View key={index} style={styles.card}>
              <View style={[styles.avatar, { backgroundColor: getAvatarColor(docker.name) }]}>
                <Text style={styles.avatarText}>{docker.name.substring(0, 2).toUpperCase()}</Text>
              </View>

              <View style={styles.infoContainer}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
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

              <View style={styles.controlContainer}>
                <View style={[styles.statusDot, { backgroundColor: isRunning ? colors.green : colors.red }]} />
                <View style={styles.btnRow}>
                  {/* WebUI Button (if mapped and running) */}
                  {isRunning && docker.webui ? (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(docker.webui)}
                      style={[styles.actionBtn, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}
                      activeOpacity={0.7}
                    >
                      <Globe size={15} color={colors.accent} />
                    </TouchableOpacity>
                  ) : null}

                  {/* Terminal Log Button */}
                  <TouchableOpacity
                    onPress={() => openDockerLogs(docker)}
                    style={[styles.actionBtn, { backgroundColor: 'rgba(107, 114, 128, 0.18)' }]}
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
                      <RotateCw size={15} color="#ffffff" />
                    </TouchableOpacity>
                  )}

                  {/* Start / Stop Button */}
                  <TouchableOpacity
                    onPress={() => toggleDocker(docker.name, docker.status)}
                    style={[styles.actionBtn, { backgroundColor: isRunning ? colors.red : colors.green }]}
                    activeOpacity={0.7}
                  >
                    {isRunning ? <Power size={15} color="#ffffff" /> : <Play size={15} color="#ffffff" />}
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
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  avatar: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
  infoContainer: { flex: 1, marginRight: 8, overflow: 'hidden' },
  nameText: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold' },
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
    marginTop: 4,
  },
  statsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  statText: { color: colors.text, fontSize: 11, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
  controlContainer: { alignItems: 'flex-end', justifyContent: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 8 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
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
});