import React, { useState, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { HardDrive, Server, ShieldCheck, ThumbsUp, ThumbsDown, Thermometer, ChevronRight, Play, Pause, Square } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import ModernConfirmDialog from '../components/ModernConfirmDialog';

export default function StorageDetailsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [disks, setDisks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [parityLoading, setParityLoading] = useState(false);
  const [parity, setParity] = useState({
    status: 'idle',
    progress: 0,
    speed: '',
    errors: 0,
    finish: '',
    action: '空闲',
    is_checking: false,
  });

  // Modern Confirmation Dialog state
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

  const showConfirm = ({ type = 'info', title, message, confirmText = '确定', cancelText = '取消', showCancel = true, onConfirm }) => {
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

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const fetchStorageData = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=status`);
      const data = await response.json();
      if (data.storage && data.storage.disks) setDisks(data.storage.disks);
      if (data.parity) setParity(data.parity);
    } catch (error) { console.log(error); } finally { setLoading(false); }
  };

  const handleParityControl = (cmd, actionName) => {
    showConfirm({
      type: cmd === 'cancel' ? 'danger' : 'warning',
      title: `${actionName}确认`,
      message: cmd === 'start'
        ? '即将开始阵列奇偶校验。校验过程将顺序扫描所有磁盘阵列数据，并验证数据块完整性。'
        : cmd === 'cancel'
        ? '确定要提前终止当前的奇偶校验任务吗？终止后进度将丢失。'
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
            await fetchStorageData();
            showConfirm({
              type: 'success',
              title: `${actionName}成功`,
              message: data.message || '指令已成功下发至 Unraid 内核',
              confirmText: '好的',
              showCancel: false,
            });
          } else {
            const isUnknownAction = data.message && /unknown action/i.test(data.message);
            showConfirm({
              type: 'warning',
              title: '执行未完成',
              message: isUnknownAction
                ? '服务端尚未更新最新的 api.php。\n\n请将项目中的 api.php 同步至 Unraid 的 /usr/local/emhttp/api.php 并执行 chmod 755 /usr/local/emhttp/api.php'
                : (data.message || '服务器拒绝执行校验指令'),
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

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      let timerId = null;
      const pollData = async () => {
        if (!isActive) return;
        await fetchStorageData();
        if (isActive) timerId = setTimeout(pollData, 5000); // 硬盘状态每 5 秒刷新
      };
      pollData();
      return () => { isActive = false; if (timerId) clearTimeout(timerId); };
    }, [])
  );

  if (loading && disks.length === 0) return <View style={styles.center}><ActivityIndicator size="large" color={colors.green} /></View>;

  const isParityChecking = parity.status === 'checking';
  const isParityPaused = parity.status === 'paused';

  return (
    <View style={styles.container}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Parity Check Status & Control Card (Relocated from Home) */}
        <View style={styles.card}>
          <View style={styles.parityHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ShieldCheck color={isParityChecking ? colors.amber : colors.accent} size={20} style={{ marginRight: 8 }} />
              <Text style={styles.parityCardTitle}>阵列奇偶校验</Text>
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
                <Text style={[styles.parityProgressNumber, { color: colors.textStrong }]}>
                  {(parity.progress || 0).toFixed(1)}%
                </Text>
                {parity.speed ? (
                  <Text style={[styles.subText, { color: colors.accent, fontWeight: 'bold' }]}>
                    {parity.speed}
                  </Text>
                ) : null}
              </View>

              <View style={styles.track}>
                <View style={[styles.bar, { width: `${Math.min(100, Math.max(0, parity.progress || 0))}%`, backgroundColor: colors.amber }]} />
              </View>

              <View style={styles.parityMetaRow}>
                <Text style={[styles.subText, { color: colors.sub }]}>
                  预计剩余: {parity.finish || '计算中...'}
                </Text>
                <Text style={[styles.subText, { color: parity.errors > 0 ? colors.red : colors.sub }]}>
                  同步错误: {parity.errors || 0}
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
            <View style={{ marginTop: 10 }}>
              <Text style={[styles.subText, { color: colors.sub, fontSize: 13, lineHeight: 18, marginBottom: 10 }]}>
                定期执行奇偶校验可扫描并验证所有磁盘数据块与校验盘的一致性，防范坏道风险。
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
                    <Play size={14} color="#ffffff" style={{ marginRight: 6 }} />
                    <Text style={styles.parityStartBtnText}>启动无修正奇偶校验 (Check)</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Physical Disk List Header */}
        <View style={{ marginBottom: 12, marginTop: 4 }}>
          <Text style={{ color: colors.sub, fontSize: 13, fontWeight: 'bold' }}>物理与阵列磁盘 ({disks.length})</Text>
        </View>

        {disks.length === 0 ? (
          <View style={styles.center}><Text style={styles.emptyText}>未找到物理磁盘</Text></View>
        ) : (
          disks.map((disk, index) => {
            const isParity = disk.is_parity || (disk.name || '').toLowerCase().includes('parity');
            const isCache = (disk.name || '').toLowerCase().includes('cache');
            const isSmartError = disk.smart_status && disk.smart_status !== 'Normal';
            const isStandby = disk.status === 'standby';

            const totalSize = disk.total || disk.size || 0;
            const usedSize = disk.used || 0;
            const calcPct = typeof disk.percentage === 'number'
              ? disk.percentage
              : (totalSize > 0 ? Math.round((usedSize / totalSize) * 100) : 0);
            const safePct = Math.min(100, Math.max(0, isNaN(calcPct) ? 0 : calcPct));

            return (
              <TouchableOpacity 
                key={disk.name || index} 
                style={[styles.card, isSmartError && styles.cardError]}
                onPress={() => navigation.navigate('SMART详情', { device: disk.device, name: disk.name })}
              >
                {/* 第一行：设备名称 和 容量总览 */}
                <View style={styles.cardHeader}>
                  <View style={styles.titleRow}>
                    {isParity ? (
                      <ShieldCheck size={20} color={colors.accent} />
                    ) : isCache ? (
                      <Server size={20} color={colors.accent} />
                    ) : (
                      <HardDrive size={20} color={isSmartError ? colors.red : colors.green} />
                    )}
                    <Text style={styles.diskName}>{disk.name || '磁盘'}</Text>
                    {isParity && (
                      <View style={[styles.parityBadge, { backgroundColor: colors.accent + '22' }]}>
                        <Text style={[styles.parityBadgeText, { color: colors.accent }]}>校验保护</Text>
                      </View>
                    )}
                    <Text style={styles.deviceLabel}>({disk.device || '未知'})</Text>
                  </View>
                  <ChevronRight size={18} color={colors.muted} />
                </View>

                {/* 第二行：状态/温度/SMART 状态数据 */}
                <View style={styles.gridRow}>
                  {/* 状态 */}
                  <View style={styles.gridItem}>
                    <Text style={styles.gridLabel}>状态</Text>
                    <View style={styles.statusRow}>
                      <View style={[styles.statusDot, { backgroundColor: isStandby ? colors.muted : colors.green }]} />
                      <Text style={styles.gridValue}>{isStandby ? '待机' : '活动'}</Text>
                    </View>
                  </View>
                  {/* 温度 */}
                  <View style={styles.gridItem}>
                    <Text style={styles.gridLabel}>温度</Text>
                    <View style={styles.statusRow}>
                      <Thermometer size={14} color={isStandby ? colors.muted : colors.green} style={{marginRight: 4}} />
                      <Text style={[styles.gridValue, { color: isStandby ? colors.muted : colors.green }]}>
                        {disk.temp ? `${disk.temp} °C` : '*'}
                      </Text>
                    </View>
                  </View>
                  {/* S.M.A.R.T. */}
                  <View style={styles.gridItem}>
                    <Text style={styles.gridLabel}>S.M.A.R.T.</Text>
                    <View style={styles.statusRow}>
                      {isSmartError ? <ThumbsDown size={14} color={colors.amber} style={{marginRight: 4}} /> : <ThumbsUp size={14} color={colors.green} style={{marginRight: 4}} />}
                      <Text style={[styles.gridValue, { color: isSmartError ? colors.amber : colors.green }]}>
                        {isSmartError ? '错误' : '良好'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* 第三行：利用率 */}
                <View style={styles.usageContainer}>
                  {isParity ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.usageText}>保护阵列数据一致性</Text>
                      <Text style={styles.usageText}>总容量: {formatBytes(totalSize)}</Text>
                    </View>
                  ) : (
                    <>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text style={styles.usageText}>利用率: {safePct}%</Text>
                        <Text style={styles.usageText}>{formatBytes(usedSize)} / {formatBytes(totalSize)}</Text>
                      </View>
                      <View style={styles.track}>
                        <View style={[styles.bar, { width: `${safePct}%`, backgroundColor: safePct > 85 ? colors.red : (isCache ? colors.accent : colors.green) }]} />
                      </View>
                    </>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Squircle Confirmation Dialog */}
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
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: colors.sub, fontSize: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.divider },
  cardError: { borderColor: colors.red, backgroundColor: 'rgba(239, 68, 68, 0.10)' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  diskName: { color: colors.textStrong, fontSize: 18, fontWeight: 'bold' },
  parityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  parityBadgeText: { fontSize: 11, fontWeight: '600' },
  deviceLabel: { color: colors.muted, fontSize: 14 },
  gridRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  gridItem: { flex: 1 },
  gridLabel: { color: colors.sub, fontSize: 12, marginBottom: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  gridValue: { color: colors.textStrong, fontSize: 14, fontWeight: 'bold' },
  usageContainer: { marginTop: 4 },
  usageText: { color: colors.sub, fontSize: 12 },
  track: { height: 8, backgroundColor: colors.input, borderRadius: 4, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },

  // Parity Check styles
  parityHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  parityCardTitle: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold' },
  parityTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  parityTagText: { fontSize: 12, fontWeight: 'bold' },
  parityProgressNumber: { fontSize: 24, fontWeight: 'bold' },
  parityMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  subText: { color: colors.sub, fontSize: 12 },
  parityBtnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  parityMiniBtn: { flex: 1, height: 34, borderRadius: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  parityMiniBtnText: { fontSize: 12, fontWeight: 'bold' },
  parityStartBtn: { height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  parityStartBtnText: { color: '#ffffff', fontSize: 14, fontWeight: 'bold' },
});