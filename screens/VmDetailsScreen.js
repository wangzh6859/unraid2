import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet, Text, View, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity,
  TextInput, Platform, StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import {
  Monitor, RotateCw, Play, Power, Pause, Zap, Cpu, Database,
  Search, X, Check, ArrowUpDown, ShieldAlert, ChevronLeft
} from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import ModernConfirmDialog from '../components/ModernConfirmDialog';
import GlassView from '../components/GlassView';

const STATUS_BAR_HEIGHT = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44;

export default function VmDetailsScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [vms, setVms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [operatingVm, setOperatingVm] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'running' | 'stopped'

  // Modern Confirmation Dialog state
  const [confirmModal, setConfirmModal] = useState({
    visible: false,
    type: 'warning',
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
    setConfirmModal({
      visible: true,
      type,
      title,
      message,
      confirmText,
      cancelText,
      showCancel,
      onConfirm: () => {
        setConfirmModal(prev => ({ ...prev, visible: false }));
        if (onConfirm) onConfirm();
      },
    });
  };

  const fetchVmData = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=status`, { signal: controller.signal });
      clearTimeout(timeoutId);

      const data = await response.json();
      if (data.vms && data.vms.list) setVms(data.vms.list);
    } catch (error) {
      console.log('获取 VM 失败', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchVmData();
    } catch (e) {
      console.log('VM onRefresh err:', e);
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      let timerId = null;
      const pollData = async () => {
        if (!isActive) return;
        await fetchVmData();
        if (isActive) timerId = setTimeout(pollData, 3000);
      };
      pollData();
      return () => { isActive = false; if (timerId) clearTimeout(timerId); };
    }, [])
  );

  const executeVmAction = async (action, name) => {
    try {
      setOperatingVm(name);
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=${action}&target=${encodeURIComponent(name)}`);
      const result = await response.json();
      if (result.status === 'success') {
        await fetchVmData();
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
    } finally {
      setOperatingVm(null);
    }
  };

  const handleStartVm = (name) => {
    executeVmAction('start_vm', name);
  };

  const handleResumeVm = (name) => {
    executeVmAction('resume_vm', name);
  };

  const handlePauseVm = (name) => {
    showConfirm({
      type: 'warning',
      title: '暂停挂起虚拟机',
      message: `确定要挂起虚拟机「${name}」吗？该虚拟机的 CPU 运行将被冻结并保留在内存中。`,
      confirmText: '确认挂起',
      showCancel: true,
      onConfirm: () => executeVmAction('pause_vm', name),
    });
  };

  const handleStopVm = (name) => {
    showConfirm({
      type: 'warning',
      title: '关闭虚拟机 (ACPI)',
      message: `向虚拟机「${name}」下发优雅关机信号。操作系统将正常执行注销并关闭。`,
      confirmText: '正常关机',
      showCancel: true,
      onConfirm: () => executeVmAction('stop_vm', name),
    });
  };

  const handleForceStopVm = (name) => {
    showConfirm({
      type: 'danger',
      title: '强制断电 (Force Off)',
      message: `即将强制切断虚拟机「${name}」电源。该操作等同于拔掉电源插头，可能导致未保存数据丢失！`,
      confirmText: '强制断电',
      showCancel: true,
      onConfirm: () => executeVmAction('force_stop_vm', name),
    });
  };

  const formatVmMemory = (bytes) => {
    if (!bytes || bytes <= 0) return '4 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  // 聚合计数
  const runningCount = useMemo(() => vms.filter(v => v.status === 'running').length, [vms]);
  const stoppedCount = useMemo(() => vms.length - runningCount, [vms, runningCount]);

  // 过滤
  const filteredVms = useMemo(() => {
    let list = [...vms];
    if (statusFilter === 'running') {
      list = list.filter(v => v.status === 'running');
    } else if (statusFilter === 'stopped') {
      list = list.filter(v => v.status !== 'running');
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(v => (v.name || '').toLowerCase().includes(q));
    }
    return list;
  }, [vms, statusFilter, searchQuery]);

  if (loading && vms.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>正在加载虚拟机清单...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 0. 顶部状态栏氛围渐变过渡层 (消除全透明突兀割裂，使卡片向上平滑隐入顶端背景) */}
      <View style={styles.topGradientFade} pointerEvents="none">
        <Svg height={STATUS_BAR_HEIGHT + 20} width="100%" pointerEvents="none">
          <Defs>
            <LinearGradient id="topAtmosphereVm" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.bg} stopOpacity="1" />
              <Stop offset="0.65" stopColor={colors.bg} stopOpacity="0.85" />
              <Stop offset="0.88" stopColor={colors.bg} stopOpacity="0.35" />
              <Stop offset="1" stopColor={colors.bg} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height={STATUS_BAR_HEIGHT + 20} fill="url(#topAtmosphereVm)" />
        </Svg>
      </View>

      <ScrollView
        style={styles.mainScrollView}
        contentContainerStyle={styles.scrollContent}
        stickyHeaderIndices={[1]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {/* Index 0: 搜索框以上的内容 (随页面上滑而向上滚动移出屏幕) */}
        <View style={styles.topHeaderSection}>
          <View style={styles.topNavHeaderRow}>
            <View style={styles.titleWithBackRow}>
              {navigation?.canGoBack?.() && (
                <TouchableOpacity
                  onPress={() => navigation.goBack()}
                  style={styles.navBackBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <ChevronLeft size={22} color={colors.textStrong} />
                </TouchableOpacity>
              )}
              <View>
                <Text style={styles.navScreenTitle}>虚拟机 (VM)</Text>
                <Text style={styles.navScreenSub}>
                  {runningCount} 台正常运行 · 共 {vms.length} 台
                </Text>
              </View>
            </View>
          </View>

          {/* 1. 顶部 Bento 概览看板 */}
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
                <Text style={styles.heroLabel}>未运行 / 挂起</Text>
              </View>
              <Text style={[styles.heroNum, { color: colors.textStrong }]}>{stoppedCount}</Text>
            </View>

            <View style={styles.heroCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Monitor size={11} color={colors.pink} style={{ marginRight: 4 }} />
                <Text style={styles.heroLabel}>总虚拟机</Text>
              </View>
              <Text style={[styles.heroNum, { color: colors.pink }]}>{vms.length}</Text>
            </View>
          </View>
        </View>

        {/* Index 1: 全局统一圆角悬浮毛玻璃搜索岛 */}
        <View style={styles.stickyIslandWrapper}>
          <GlassView
            border={true}
            style={styles.floatingIslandCard}
          >
            <View style={styles.searchBoxRow}>
              <View style={[styles.searchBox, { flex: 1, marginBottom: 0 }]}>
                <Search size={15} color={colors.sub} style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="搜索虚拟机名称..."
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
            </View>

            <View style={styles.tabsRow}>
              <TouchableOpacity
                style={[styles.tabBtn, statusFilter === 'all' && styles.tabBtnActive]}
                onPress={() => setStatusFilter('all')}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabBtnText, statusFilter === 'all' && styles.tabBtnTextActive]}>
                  全部 {vms.length}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, statusFilter === 'running' && styles.tabBtnActive]}
                onPress={() => setStatusFilter('running')}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabBtnText, statusFilter === 'running' && styles.tabBtnTextActive]}>
                  运行中 {runningCount}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, statusFilter === 'stopped' && styles.tabBtnActive]}
                onPress={() => setStatusFilter('stopped')}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabBtnText, statusFilter === 'stopped' && styles.tabBtnTextActive]}>
                  未运行 {stoppedCount}
                </Text>
              </TouchableOpacity>
            </View>
          </GlassView>
        </View>

        {/* Index 2: 虚拟机卡片列表 (在毛玻璃下向上滑动) */}
        <View style={styles.cardsListSection}>
        {filteredVms.map((vm, index) => {
          const isRunning = vm.status === 'running';
          const isPaused = vm.status === 'paused';
          const isOperating = operatingVm === vm.name;

          return (
            <View key={vm.name || index} style={styles.vmCard}>
              {/* 上层 */}
              <View style={styles.cardUpperTier}>
                <View style={[styles.avatar, { backgroundColor: isRunning ? 'rgba(236, 72, 153, 0.15)' : 'rgba(148, 163, 184, 0.15)' }]}>
                  <Monitor size={20} color={isRunning ? colors.pink : colors.sub} />
                </View>

                <View style={styles.nameBlock}>
                  <Text style={styles.vmTitle} numberOfLines={1}>{vm.name}</Text>
                  <View style={styles.metaBadgeRow}>
                    <View style={[styles.statusBadge, {
                      backgroundColor: isRunning ? 'rgba(16, 185, 129, 0.12)' : isPaused ? 'rgba(245, 158, 11, 0.12)' : 'rgba(148, 163, 184, 0.12)'
                    }]}>
                      <View style={[styles.statusDotSmall, {
                        backgroundColor: isRunning ? colors.green : isPaused ? colors.amber : colors.sub
                      }]} />
                      <Text style={[styles.statusBadgeText, {
                        color: isRunning ? colors.green : isPaused ? colors.amber : colors.sub
                      }]}>
                        {isRunning ? '运行中' : isPaused ? '已挂起' : '已关机'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* 核心配置指标 */}
                <View style={styles.specPillsCol}>
                  <View style={styles.specPill}>
                    <Cpu size={10} color={colors.accent} style={{ marginRight: 3 }} />
                    <Text style={[styles.specPillText, { color: colors.accent }]}>{vm.cores || 2} vCPU</Text>
                  </View>
                  <View style={[styles.specPill, { marginTop: 4 }]}>
                    <Database size={10} color={colors.tempWarm} style={{ marginRight: 3 }} />
                    <Text style={[styles.specPillText, { color: colors.tempWarm }]}>{formatVmMemory(vm.memory)}</Text>
                  </View>
                </View>
              </View>

              {/* 下层：操作栏 */}
              <View style={styles.cardLowerTier}>
                <Text style={styles.actionPromptText}>
                  {isOperating ? '正在下发指令...' : isRunning ? '虚拟机正在执行任务' : isPaused ? '虚拟机已被冻结挂起' : '虚拟机处于关机状态'}
                </Text>

                <View style={styles.mgmtBtnGroup}>
                  {isOperating ? (
                    <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 8 }} />
                  ) : null}

                  {isRunning && (
                    <>
                      <TouchableOpacity
                        style={styles.circleActionBtn}
                        onPress={() => handlePauseVm(vm.name)}
                        disabled={isOperating}
                        activeOpacity={0.7}
                        accessibilityLabel="挂起虚拟机"
                      >
                        <Pause size={14} color={colors.amber} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.circleActionBtn}
                        onPress={() => handleStopVm(vm.name)}
                        disabled={isOperating}
                        activeOpacity={0.7}
                        accessibilityLabel="正常关机"
                      >
                        <Power size={14} color={colors.red} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.circleActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}
                        onPress={() => handleForceStopVm(vm.name)}
                        disabled={isOperating}
                        activeOpacity={0.7}
                        accessibilityLabel="强制断电"
                      >
                        <ShieldAlert size={14} color={colors.red} />
                      </TouchableOpacity>
                    </>
                  )}

                  {isPaused && (
                    <>
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { backgroundColor: colors.green }]}
                        onPress={() => handleResumeVm(vm.name)}
                        disabled={isOperating}
                        activeOpacity={0.8}
                      >
                        <Play size={13} color="#ffffff" style={{ marginRight: 4 }} />
                        <Text style={styles.primaryActionBtnText}>恢复运行</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.circleActionBtn}
                        onPress={() => handleForceStopVm(vm.name)}
                        disabled={isOperating}
                        activeOpacity={0.7}
                      >
                        <Power size={14} color={colors.red} />
                      </TouchableOpacity>
                    </>
                  )}

                  {!isRunning && !isPaused && (
                    <TouchableOpacity
                      style={[styles.primaryActionBtn, { backgroundColor: colors.green }]}
                      onPress={() => handleStartVm(vm.name)}
                      disabled={isOperating}
                      activeOpacity={0.8}
                    >
                      <Play size={13} color="#ffffff" style={{ marginRight: 4 }} />
                      <Text style={styles.primaryActionBtnText}>启动虚拟机</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          );
        })}

        {filteredVms.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Monitor size={42} color={colors.muted} style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>暂无虚拟机</Text>
            <Text style={styles.emptySub}>当前 Unraid 未配置或未匹配到符合条件的虚拟机</Text>
          </View>
        ) : null}
        </View>
      </ScrollView>

      {/* Modern Confirm Modal */}
      <ModernConfirmDialog
        visible={confirmModal.visible}
        type={confirmModal.type}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
        showCancel={confirmModal.showCancel}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, visible: false }))}
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

  // Top Atmospheric Gradient & Sticky Floating Island
  topGradientFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: STATUS_BAR_HEIGHT + 20,
    zIndex: 100,
  },
  mainScrollView: {
    flex: 1,
    marginTop: STATUS_BAR_HEIGHT,
  },
  topHeaderSection: {
    paddingTop: 8,
  },
  topNavHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  titleWithBackRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navBackBtn: {
    marginRight: 10,
    padding: 2,
  },
  stickyBackBtn: {
    marginRight: 8,
    padding: 4,
  },
  navScreenTitle: {
    fontSize: 20,
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
  stickyIslandWrapper: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: 'transparent',
    zIndex: 20,
  },
  floatingIslandCard: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.25 : 0.06,
    shadowRadius: 10,
    elevation: 4,
    overflow: 'hidden',
  },
  scrollContent: {
    flexGrow: 1,
  },
  cardsListSection: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 110,
    gap: 12,
  },
  filterSection: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  searchBoxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.2 : 0.04,
    shadowRadius: 3,
  },
  searchInput: {
    flex: 1,
    color: colors.textStrong,
    fontSize: 13,
    paddingVertical: 0,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tabBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(0, 0, 0, 0.06)',
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

  // Content
  content: {
    padding: 16,
    paddingTop: 6,
    paddingBottom: 110,
    gap: 12,
  },
  vmCard: {
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
  nameBlock: {
    flex: 1,
    marginRight: 8,
  },
  vmTitle: {
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
  specPillsCol: {
    alignItems: 'flex-end',
  },
  specPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardSecondary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  specPillText: {
    fontSize: 10,
    fontWeight: '600',
  },

  // Lower tier
  cardLowerTier: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  actionPromptText: {
    fontSize: 11,
    color: colors.sub,
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
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  primaryActionBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
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
});
