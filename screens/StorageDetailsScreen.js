import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet, Text, View, ScrollView, ActivityIndicator, TouchableOpacity,
  Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import {
  HardDrive, Server, ShieldCheck, ThumbsUp, ThumbsDown, Thermometer,
  ChevronRight, Play, Pause, Square, Shield, Zap, AlertTriangle, CheckCircle2
} from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import ModernConfirmDialog from '../components/ModernConfirmDialog';

export default function StorageDetailsScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

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
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
      setParityLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchStorageData();
      const interval = setInterval(fetchStorageData, 3000);
      return () => clearInterval(interval);
    }, [])
  );

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
            showConfirm({
              type: 'warning',
              title: '执行未成功',
              message: data.message || '操作失败',
              confirmText: '知道了',
              showCancel: false,
            });
          }
        } catch (e) {
          showConfirm({
            type: 'warning',
            title: '网络异常',
            message: e.message || '网络连接异常',
            confirmText: '知道了',
            showCancel: false,
          });
        } finally {
          setParityLoading(false);
        }
      },
    });
  };

  // 磁盘分类整理
  const parityDisks = useMemo(() => disks.filter(d => d.is_parity || (d.name || '').toLowerCase().includes('parity')), [disks]);
  const dataDisks = useMemo(() => disks.filter(d => !d.is_parity && !(d.name || '').toLowerCase().includes('parity') && !(d.name || '').toLowerCase().includes('cache') && !(d.name || '').toLowerCase().includes('pool')), [disks]);
  const cacheDisks = useMemo(() => disks.filter(d => (d.name || '').toLowerCase().includes('cache') || (d.name || '').toLowerCase().includes('pool')), [disks]);
  const otherDisks = useMemo(() => disks.filter(d => !parityDisks.includes(d) && !dataDisks.includes(d) && !cacheDisks.includes(d)), [disks, parityDisks, dataDisks, cacheDisks]);

  // 总容量汇总计算
  const totalArraySize = useMemo(() => dataDisks.reduce((acc, d) => acc + (d.size || d.total || 0), 0), [dataDisks]);
  const totalArrayUsed = useMemo(() => dataDisks.reduce((acc, d) => acc + (d.used || 0), 0), [dataDisks]);
  const totalArrayPct = totalArraySize > 0 ? ((totalArrayUsed / totalArraySize) * 100).toFixed(1) : 0;

  const isChecking = parity.status === 'checking';
  const isPaused = parity.status === 'paused';

  if (loading && disks.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>正在抓取存储设备及阵列状态...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. 顶部存储阵列概览全景卡片 */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <HardDrive size={18} color={colors.accent} style={{ marginRight: 8 }} />
            <Text style={styles.heroTitle}>Array 存储阵列全景</Text>
          </View>
          <View style={styles.healthBadge}>
            <View style={[styles.healthDot, { backgroundColor: colors.green }]} />
            <Text style={styles.healthBadgeText}>阵列保护中</Text>
          </View>
        </View>

        <View style={styles.capacityRow}>
          <Text style={styles.capacityBigNum}>{totalArrayPct}%</Text>
          <Text style={styles.capacitySubText}>
            已使用 {formatBytes(totalArrayUsed)} / 总量 {formatBytes(totalArraySize)}
          </Text>
        </View>

        {/* 分段式彩色容量分布条 */}
        <View style={styles.multiSegTrack}>
          <View style={[styles.multiSegBar, { width: `${Math.min(totalArrayPct, 100)}%`, backgroundColor: totalArrayPct > 85 ? colors.red : colors.accent }]} />
        </View>

        <View style={styles.arrayMetaGrid}>
          <View style={styles.arrayMetaItem}>
            <Text style={styles.arrayMetaLabel}>校验盘</Text>
            <Text style={styles.arrayMetaVal}>{parityDisks.length} 块</Text>
          </View>
          <View style={styles.arrayMetaItem}>
            <Text style={styles.arrayMetaLabel}>数据盘</Text>
            <Text style={styles.arrayMetaVal}>{dataDisks.length} 块</Text>
          </View>
          <View style={styles.arrayMetaItem}>
            <Text style={styles.arrayMetaLabel}>缓存池</Text>
            <Text style={styles.arrayMetaVal}>{cacheDisks.length} 块</Text>
          </View>
        </View>
      </View>

      {/* 2. 奇偶校验中控台卡片 */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ShieldCheck size={18} color={isChecking ? colors.amber : colors.green} style={{ marginRight: 8 }} />
            <Text style={styles.cardTitle}>奇偶校验中控 (Parity Check)</Text>
          </View>
          <View style={[styles.parityStatusPill, {
            backgroundColor: isChecking ? 'rgba(245, 158, 11, 0.15)' : isPaused ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)'
          }]}>
            <Text style={[styles.parityStatusPillText, {
              color: isChecking ? colors.amber : isPaused ? colors.red : colors.green
            }]}>
              {isChecking ? '校验进行中' : isPaused ? '已暂停' : '空闲 / 数据安全'}
            </Text>
          </View>
        </View>

        {isChecking || isPaused ? (
          <View style={styles.parityActiveBox}>
            <View style={styles.parityProgressRow}>
              <Text style={styles.parityProgressNum}>{(parity.progress || 0).toFixed(1)}%</Text>
              <Text style={styles.paritySpeedText}>
                {parity.speed ? `速率: ${parity.speed}` : '计算速率中...'}
              </Text>
            </View>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(parity.progress || 0, 100)}%`, backgroundColor: colors.amber }]} />
            </View>

            <View style={styles.parityDetailRow}>
              <Text style={styles.parityDetailText}>发现错误: <Text style={{ color: parity.errors > 0 ? colors.red : colors.green, fontWeight: 'bold' }}>{parity.errors || 0}</Text></Text>
              {parity.finish ? <Text style={styles.parityDetailText}>预计剩余: {parity.finish}</Text> : null}
            </View>

            <View style={styles.parityBtnRow}>
              {isChecking ? (
                <TouchableOpacity
                  style={[styles.parityControlBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.cardBorder }]}
                  onPress={() => handleParityControl('pause', '暂停校验')}
                  disabled={parityLoading}
                >
                  <Pause size={13} color={colors.amber} style={{ marginRight: 4 }} />
                  <Text style={[styles.parityControlBtnText, { color: colors.amber }]}>暂停</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.parityControlBtn, { backgroundColor: colors.green }]}
                  onPress={() => handleParityControl('resume', '继续校验')}
                  disabled={parityLoading}
                >
                  <Play size={13} color="#ffffff" style={{ marginRight: 4 }} />
                  <Text style={[styles.parityControlBtnText, { color: '#ffffff' }]}>继续</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.parityControlBtn, { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}
                onPress={() => handleParityControl('cancel', '终止校验')}
                disabled={parityLoading}
              >
                <Square size={13} color={colors.red} style={{ marginRight: 4 }} />
                <Text style={[styles.parityControlBtnText, { color: colors.red }]}>终止校验</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.parityIdleBox}>
            <Text style={styles.parityIdleText}>
              所有阵列数据块已受到奇偶校验算法保护，校验可验证盘片一致性。
            </Text>
            <TouchableOpacity
              style={styles.parityStartBtn}
              onPress={() => handleParityControl('start', '开始奇偶校验')}
              disabled={parityLoading}
              activeOpacity={0.8}
            >
              {parityLoading ? (
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
              ) : (
                <Play size={14} color="#ffffff" style={{ marginRight: 6 }} />
              )}
              <Text style={styles.parityStartBtnText}>立即执行奇偶校验</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 3. 磁盘设备分类列表 */}
      {/* 3.1 校验盘列表 */}
      {parityDisks.length > 0 && (
        <View style={styles.diskGroupSection}>
          <Text style={styles.diskGroupTitle}>校验盘 (Parity Drives)</Text>
          {parityDisks.map((d, idx) => renderDiskItem(d, idx))}
        </View>
      )}

      {/* 3.2 数据盘列表 */}
      {dataDisks.length > 0 && (
        <View style={styles.diskGroupSection}>
          <Text style={styles.diskGroupTitle}>阵列数据盘 (Data Array Disks)</Text>
          {dataDisks.map((d, idx) => renderDiskItem(d, idx))}
        </View>
      )}

      {/* 3.3 缓存池列表 */}
      {cacheDisks.length > 0 && (
        <View style={styles.diskGroupSection}>
          <Text style={styles.diskGroupTitle}>缓存池与加速设备 (Pools & Cache)</Text>
          {cacheDisks.map((d, idx) => renderDiskItem(d, idx))}
        </View>
      )}

      {/* 3.4 其他存储设备 */}
      {otherDisks.length > 0 && (
        <View style={styles.diskGroupSection}>
          <Text style={styles.diskGroupTitle}>其他存储设备 (Other Drives)</Text>
          {otherDisks.map((d, idx) => renderDiskItem(d, idx))}
        </View>
      )}

      {/* 兜底：如果都没有分组，直接展示全部磁盘 */}
      {parityDisks.length === 0 && dataDisks.length === 0 && cacheDisks.length === 0 && otherDisks.length === 0 && disks.length > 0 && (
        <View style={styles.diskGroupSection}>
          <Text style={styles.diskGroupTitle}>所有存储设备 (All Disks)</Text>
          {disks.map((d, idx) => renderDiskItem(d, idx))}
        </View>
      )}

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

  function renderDiskItem(disk, index) {
    const isParity = disk.is_parity || (disk.name || '').toLowerCase().includes('parity');
    const isCache = (disk.name || '').toLowerCase().includes('cache') || (disk.name || '').toLowerCase().includes('pool');
    const isStandby = disk.status === 'standby';
    const tempVal = disk.temp !== null && disk.temp !== undefined && !isNaN(disk.temp) ? parseInt(disk.temp, 10) : null;
    const isWarm = tempVal && tempVal >= 45;
    const pct = disk.percentage !== undefined ? disk.percentage : 0;
    const isNormalSmart = (disk.smart_status || 'Normal').toLowerCase() === 'normal';
    const totalSize = disk.size || disk.total || 0;
    const usedSize = disk.used || 0;
    const freeSize = disk.free !== undefined ? disk.free : Math.max(0, totalSize - usedSize);
    const numErrors = disk.num_errors || 0;
    const fsType = disk.fs_type ? String(disk.fs_type).toUpperCase() : '';

    return (
      <TouchableOpacity
        key={disk.device || disk.name || index}
        style={[styles.diskCard, numErrors > 0 && styles.diskCardError]}
        onPress={() => navigation.navigate('SMART详情', { disk, device: disk.device, name: disk.name })}
        activeOpacity={0.7}
      >
        {/* 第一行：图标 + 名称 + 物理设备名 + 文件系统 + 校验徽章 + 箭头 */}
        <View style={styles.diskCardHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <View style={[styles.diskIconBox, { backgroundColor: isParity ? 'rgba(56, 189, 248, 0.12)' : isCache ? 'rgba(168, 85, 247, 0.12)' : 'rgba(16, 185, 129, 0.12)' }]}>
              {isParity ? (
                <ShieldCheck size={18} color={colors.accent} />
              ) : isCache ? (
                <Server size={18} color="#a855f7" />
              ) : (
                <HardDrive size={18} color={isNormalSmart ? colors.green : colors.red} />
              )}
            </View>

            <View style={{ marginLeft: 10, flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Text style={styles.diskNameText} numberOfLines={1}>{disk.name}</Text>
                {disk.device ? (
                  <View style={styles.deviceTag}>
                    <Text style={styles.deviceTagText}>{disk.device}</Text>
                  </View>
                ) : null}
                {fsType ? (
                  <View style={[styles.deviceTag, { backgroundColor: 'rgba(56, 189, 248, 0.1)' }]}>
                    <Text style={[styles.deviceTagText, { color: colors.accent }]}>{fsType}</Text>
                  </View>
                ) : null}
                {isParity ? (
                  <View style={[styles.deviceTag, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
                    <Text style={[styles.deviceTagText, { color: colors.green }]}>校验保护</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          <ChevronRight size={16} color={colors.sub} style={{ marginLeft: 6 }} />
        </View>

        {/* 第二行：核心硬件参数详细数据网格 (4 列 Bento 块) */}
        <View style={styles.metricGridRow}>
          {/* 运行状态 */}
          <View style={styles.metricGridItem}>
            <Text style={styles.metricGridLabel}>运行状态</Text>
            <View style={styles.metricValueRow}>
              <View style={[styles.statusDotSmall, { backgroundColor: isStandby ? colors.sub : colors.green }]} />
              <Text style={styles.metricGridValue}>{isStandby ? '休眠' : '活动'}</Text>
            </View>
          </View>

          {/* 盘体温度 */}
          <View style={styles.metricGridItem}>
            <Text style={styles.metricGridLabel}>盘体温度</Text>
            <View style={styles.metricValueRow}>
              <Thermometer size={12} color={isStandby ? colors.sub : isWarm ? colors.tempWarm : colors.networkDown} style={{ marginRight: 2 }} />
              <Text style={[styles.metricGridValue, { color: isStandby ? colors.sub : isWarm ? colors.tempWarm : colors.networkDown }]}>
                {isStandby ? '休眠' : tempVal ? `${tempVal}°C` : '--'}
              </Text>
            </View>
          </View>

          {/* S.M.A.R.T. */}
          <View style={styles.metricGridItem}>
            <Text style={styles.metricGridLabel}>S.M.A.R.T.</Text>
            <View style={styles.metricValueRow}>
              {isNormalSmart ? (
                <CheckCircle2 size={12} color={colors.green} style={{ marginRight: 2 }} />
              ) : (
                <AlertTriangle size={12} color={colors.red} style={{ marginRight: 2 }} />
              )}
              <Text style={[styles.metricGridValue, { color: isNormalSmart ? colors.green : colors.red }]}>
                {isNormalSmart ? '健康' : '异常'}
              </Text>
            </View>
          </View>

          {/* 读写错误计数 */}
          <View style={styles.metricGridItem}>
            <Text style={styles.metricGridLabel}>读写错误</Text>
            <View style={styles.metricValueRow}>
              <Text style={[styles.metricGridValue, { color: numErrors > 0 ? colors.red : colors.sub }]}>
                {numErrors} 次
              </Text>
            </View>
          </View>
        </View>

        {/* 第三行：容量详细分布条与数值 */}
        <View style={styles.diskUsageBlock}>
          {isParity ? (
            <View style={styles.diskCapacityRow}>
              <Text style={styles.diskUsageSubText}>保护阵列数据一致性</Text>
              <Text style={styles.diskUsageTotalText}>总容量: {formatBytes(totalSize)}</Text>
            </View>
          ) : (
            <>
              <View style={styles.diskCapacityRow}>
                <Text style={styles.diskUsagePctText}>利用率: {pct}%</Text>
                <Text style={styles.diskUsageDetailText}>
                  已用 {formatBytes(usedSize)} / {formatBytes(totalSize)} {freeSize > 0 ? `(余 ${formatBytes(freeSize)})` : ''}
                </Text>
              </View>
              <View style={styles.diskTrack}>
                <View style={[styles.diskFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: pct > 85 ? colors.red : (isCache ? '#a855f7' : colors.accent) }]} />
              </View>
            </>
          )}
        </View>
      </TouchableOpacity>
    );
  }
}

const createStyles = (colors, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 16,
    paddingBottom: 32,
    gap: 14,
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

  // 1. Hero Card
  heroCard: {
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
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  healthBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  healthDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  healthBadgeText: {
    fontSize: 11,
    color: colors.green,
    fontWeight: 'bold',
  },
  capacityRow: {
    marginBottom: 10,
  },
  capacityBigNum: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.textStrong,
    letterSpacing: -0.5,
  },
  capacitySubText: {
    fontSize: 12,
    color: colors.sub,
    marginTop: 2,
  },
  multiSegTrack: {
    height: 8,
    backgroundColor: colors.cardSecondary,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 14,
  },
  multiSegBar: {
    height: '100%',
    borderRadius: 4,
  },
  arrayMetaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  arrayMetaItem: {
    alignItems: 'center',
    flex: 1,
  },
  arrayMetaLabel: {
    fontSize: 11,
    color: colors.sub,
    marginBottom: 2,
  },
  arrayMetaVal: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textStrong,
  },

  // 2. Parity Card
  card: {
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
  parityStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  parityStatusPillText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  parityActiveBox: {
    marginTop: 4,
  },
  parityProgressRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  parityProgressNum: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  paritySpeedText: {
    fontSize: 12,
    color: colors.amber,
    fontWeight: '600',
  },
  progressTrack: {
    height: 7,
    backgroundColor: colors.cardSecondary,
    borderRadius: 3.5,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3.5,
  },
  parityDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  parityDetailText: {
    fontSize: 12,
    color: colors.sub,
  },
  parityBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  parityControlBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  parityControlBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  parityIdleBox: {
    paddingTop: 2,
  },
  parityIdleText: {
    fontSize: 12,
    color: colors.sub,
    lineHeight: 18,
    marginBottom: 12,
  },
  parityStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingVertical: 10,
    borderRadius: 12,
  },
  parityStartBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },

  // 3. Disks
  diskGroupSection: {
    marginTop: 6,
    gap: 10,
  },
  diskGroupTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.sub,
    marginLeft: 4,
    marginBottom: 2,
  },
  diskCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.2 : 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  diskCardError: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: isDark ? 'rgba(239, 68, 68, 0.05)' : 'rgba(254, 242, 242, 0.7)',
  },
  diskCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  diskIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diskNameText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginRight: 6,
  },
  deviceTag: {
    backgroundColor: colors.cardSecondary,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  deviceTagText: {
    fontSize: 10,
    color: colors.sub,
    fontWeight: '600',
  },
  diskCapacitySub: {
    fontSize: 11,
    color: colors.sub,
    marginTop: 2,
  },
  diskStatusCol: {
    alignItems: 'flex-end',
  },
  tempPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 4,
  },
  tempPillText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  smartIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  smartIndicatorText: {
    fontSize: 10,
    fontWeight: '600',
  },
  metricGridRow: {
    flexDirection: 'row',
    backgroundColor: colors.cardSecondary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginTop: 10,
    justifyContent: 'space-between',
  },
  metricGridItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricGridLabel: {
    fontSize: 10,
    color: colors.sub,
    marginBottom: 3,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metricGridValue: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textStrong,
  },
  statusDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  diskUsageBlock: {
    marginTop: 10,
  },
  diskCapacityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  diskUsagePctText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  diskUsageDetailText: {
    fontSize: 10,
    color: colors.sub,
  },
  diskUsageSubText: {
    fontSize: 11,
    color: colors.sub,
  },
  diskUsageTotalText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  diskTrack: {
    height: 4,
    backgroundColor: colors.cardSecondary,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  diskFill: {
    height: '100%',
    borderRadius: 2,
  },
});
