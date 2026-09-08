import React, { useState, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Monitor, RotateCw, Play, Power, Pause, Zap } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import ModernConfirmDialog from '../components/ModernConfirmDialog';

export default function VmDetailsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [vms, setVms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [operatingVm, setOperatingVm] = useState(null);
  const [sortRule, setSortRule] = useState('name');

  // Modern Confirmation Dialog state
  const [confirmModal, setConfirmModal] = useState({
    visible: false,
    type: 'warning',
    title: '',
    message: '',
    confirmText: '确定',
    onConfirm: null,
  });

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
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=${action}&target=${name}`);
      const result = await response.json();
      if (result.status === 'success') {
        await fetchVmData();
      } else {
        setConfirmModal({
          visible: true,
          type: 'warning',
          title: '操作未成功',
          message: result.message || '服务器拒绝执行此操作',
          confirmText: '知道了',
          showCancel: false,
          onConfirm: () => setConfirmModal(prev => ({ ...prev, visible: false })),
        });
      }
    } catch (error) {
      setConfirmModal({
        visible: true,
        type: 'warning',
        title: '网络异常',
        message: '连接服务器超时或失败，请检查网络设置。',
        confirmText: '知道了',
        showCancel: false,
        onConfirm: () => setConfirmModal(prev => ({ ...prev, visible: false })),
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
    setConfirmModal({
      visible: true,
      type: 'warning',
      title: '暂停挂起虚拟机',
      message: `确定要挂起虚拟机 "${name}" 吗？该虚拟机的 CPU 运行将被冻结并保留在内存中。`,
      confirmText: '确认挂起',
      showCancel: true,
      onConfirm: () => {
        setConfirmModal(prev => ({ ...prev, visible: false }));
        executeVmAction('pause_vm', name);
      },
    });
  };

  const handleStopVm = (name) => {
    setConfirmModal({
      visible: true,
      type: 'power',
      title: '正常关机 (ACPI)',
      message: `确定要向虚拟机 "${name}" 发送关机信号吗？操作系统将执行正常的关机流程。`,
      confirmText: '安全关机',
      showCancel: true,
      onConfirm: () => {
        setConfirmModal(prev => ({ ...prev, visible: false }));
        executeVmAction('stop_vm', name);
      },
    });
  };

  const handleForceStopVm = (name) => {
    setConfirmModal({
      visible: true,
      type: 'danger',
      title: '强制断电 (Force Stop)',
      message: `警告：强制断电相当于直接拔掉电源插头，可能导致虚拟机 "${name}" 中未保存的数据丢失或文件系统受损！确定强制关闭吗？`,
      confirmText: '强制断电',
      showCancel: true,
      onConfirm: () => {
        setConfirmModal(prev => ({ ...prev, visible: false }));
        executeVmAction('force_stop_vm', name);
      },
    });
  };

  const handleRestartVm = (name) => {
    setConfirmModal({
      visible: true,
      type: 'reboot',
      title: '重启虚拟机',
      message: `确定要重启虚拟机 "${name}" 吗？`,
      confirmText: '确认重启',
      showCancel: true,
      onConfirm: () => {
        setConfirmModal(prev => ({ ...prev, visible: false }));
        executeVmAction('restart_vm', name);
      },
    });
  };

  const sortedVms = [...vms].sort((a, b) => {
    if (sortRule === 'status') {
      const getWeight = (s) => (s === 'running' ? 0 : s === 'paused' ? 1 : 2);
      return getWeight(a.status) - getWeight(b.status);
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  if (loading && vms.length === 0) return <View style={styles.center}><ActivityIndicator size="large" color={colors.pink} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.sortBar}>
        <Text style={styles.sortLabel}>排序:</Text>
        <TouchableOpacity style={[styles.sortBtn, sortRule === 'name' && styles.sortBtnActive]} onPress={() => setSortRule('name')}>
          <Text style={[styles.sortBtnText, sortRule === 'name' && styles.sortBtnTextActive]}>名称</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.sortBtn, sortRule === 'status' && styles.sortBtnActive]} onPress={() => setSortRule('status')}>
          <Text style={[styles.sortBtnText, sortRule === 'status' && styles.sortBtnTextActive]}>状态</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {sortedVms.map((vm, index) => {
          const isRunning = vm.status === 'running';
          const isPaused = vm.status === 'paused';
          const statusColor = isRunning ? colors.green : isPaused ? colors.amber : colors.sub;
          const statusText = isRunning ? '运行中' : isPaused ? '已挂起' : '已停止';
          const isBusy = operatingVm === vm.name;

          return (
            <View key={vm.name || index} style={styles.card}>
              {/* Top Header: Icon + Info + Status */}
              <View style={styles.cardHeader}>
                <View style={styles.iconWrapper}>
                  <Monitor size={22} color={isRunning ? colors.pink : colors.sub} />
                </View>

                <View style={styles.infoContainer}>
                  <Text style={styles.nameText} numberOfLines={1}>{vm.name}</Text>
                  <View style={styles.statusBadgeRow}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                    <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
                  </View>
                </View>

                {isBusy && (
                  <View style={styles.busyIndicator}>
                    <ActivityIndicator size="small" color={colors.accent} />
                  </View>
                )}
              </View>

              {/* Action Buttons Row */}
              <View style={styles.actionGrid}>
                {isRunning && (
                  <>
                    <TouchableOpacity
                      style={[styles.btnAction, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}
                      onPress={() => handlePauseVm(vm.name)}
                      disabled={isBusy}
                      activeOpacity={0.7}
                    >
                      <Pause size={13} color={colors.amber} />
                      <Text style={[styles.btnActionText, { color: colors.amber }]}>挂起</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.btnAction, { backgroundColor: 'rgba(168, 85, 247, 0.15)' }]}
                      onPress={() => handleRestartVm(vm.name)}
                      disabled={isBusy}
                      activeOpacity={0.7}
                    >
                      <RotateCw size={13} color={colors.purple} />
                      <Text style={[styles.btnActionText, { color: colors.purple }]}>重启</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.btnAction, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}
                      onPress={() => handleStopVm(vm.name)}
                      disabled={isBusy}
                      activeOpacity={0.7}
                    >
                      <Power size={13} color={colors.red} />
                      <Text style={[styles.btnActionText, { color: colors.red }]}>关机</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.btnAction, { backgroundColor: 'rgba(220, 38, 38, 0.28)' }]}
                      onPress={() => handleForceStopVm(vm.name)}
                      disabled={isBusy}
                      activeOpacity={0.7}
                    >
                      <Zap size={13} color="#f87171" />
                      <Text style={[styles.btnActionText, { color: '#f87171', fontWeight: 'bold' }]}>断电</Text>
                    </TouchableOpacity>
                  </>
                )}

                {isPaused && (
                  <>
                    <TouchableOpacity
                      style={[styles.btnAction, { backgroundColor: colors.green, flex: 1 }]}
                      onPress={() => handleResumeVm(vm.name)}
                      disabled={isBusy}
                      activeOpacity={0.7}
                    >
                      <Play size={14} color="#ffffff" />
                      <Text style={[styles.btnActionText, { color: '#ffffff', fontWeight: 'bold' }]}>恢复运行</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.btnAction, { backgroundColor: 'rgba(220, 38, 38, 0.28)', flex: 1 }]}
                      onPress={() => handleForceStopVm(vm.name)}
                      disabled={isBusy}
                      activeOpacity={0.7}
                    >
                      <Zap size={14} color="#f87171" />
                      <Text style={[styles.btnActionText, { color: '#f87171', fontWeight: 'bold' }]}>强制断电</Text>
                    </TouchableOpacity>
                  </>
                )}

                {!isRunning && !isPaused && (
                  <TouchableOpacity
                    style={[styles.btnAction, { backgroundColor: colors.green, flex: 1 }]}
                    onPress={() => handleStartVm(vm.name)}
                    disabled={isBusy}
                    activeOpacity={0.7}
                  >
                    <Play size={14} color="#ffffff" />
                    <Text style={[styles.btnActionText, { color: '#ffffff', fontWeight: 'bold' }]}>开机启动</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Squircle Confirmation Dialog */}
      <ModernConfirmDialog
        visible={confirmModal.visible}
        type={confirmModal.type}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        showCancel={confirmModal.showCancel !== false}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  sortBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sortLabel: { color: colors.sub, marginRight: 12, fontSize: 14 },
  sortBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.input, marginRight: 8 },
  sortBtnActive: { backgroundColor: colors.accent },
  sortBtnText: { color: colors.sub, fontSize: 12, fontWeight: 'bold' },
  sortBtnTextActive: { color: '#ffffff' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.divider },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  iconWrapper: { width: 42, height: 42, backgroundColor: colors.input, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  infoContainer: { flex: 1, justifyContent: 'center' },
  nameText: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  statusBadgeRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 6 },
  statusText: { fontSize: 12, fontWeight: '600' },
  busyIndicator: { marginLeft: 8 },
  actionGrid: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.divider, gap: 8 },
  btnAction: { flex: 1, height: 34, borderRadius: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
  btnActionText: { fontSize: 12, fontWeight: '600' },
});