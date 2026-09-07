import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  HardDrive,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Thermometer,
  Database,
  RotateCw,
  Cpu,
  Hash,
  Layers,
  Activity
} from 'lucide-react-native';
import { useTheme } from '../ThemeContext';

export default function SmartDetailsScreen({ route }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { device, name } = route.params || {};

  const [smartData, setSmartData] = useState('');
  const [parsed, setParsed] = useState(null);
  const [resolvedDev, setResolvedDev] = useState(device || '');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSmart = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) {
        setSmartData('未配置 Unraid 服务器连接信息');
        return;
      }
      const targetParam = encodeURIComponent(device || '');
      const nameParam = encodeURIComponent(name || '');
      const url = `${savedUrl}/api.php?token=${savedToken}&action=smart_info&target=${targetParam}&name=${nameParam}`;
      const response = await fetch(url);
      const result = await response.json();

      if (result.status === 'success') {
        setSmartData(result.data || '无 S.M.A.R.T. 诊断输出');
        setParsed(result.parsed || null);
        if (result.device) {
          setResolvedDev(result.device);
        }
      } else {
        setSmartData(result.message || '未能获取到 S.M.A.R.T. 数据');
      }
    } catch (error) {
      setSmartData('网络请求失败，无法连接到 Unraid 服务端。');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [device, name]);

  useEffect(() => {
    fetchSmart();
  }, [fetchSmart]);

  const formatCapacity = (capStr) => {
    if (!capStr) return '未知';
    const s = String(capStr).trim();
    // 1. Prefer bracketed human-readable size, e.g. [4.00 TB] or [500 GB]
    const bracketMatch = s.match(/\[([0-9\.]+\s*[KMGTPE]?B)\]/i);
    if (bracketMatch) return bracketMatch[1];

    // 2. If already cleanly formatted (e.g. "4.00 TB", "500 GB")
    if (/^[0-9\.]+\s*(?:TB|GB|MB|KB)$/i.test(s)) return s;

    // 3. If it has bytes, convert to human-friendly decimal unit
    const byteMatch = s.match(/([\d,]+)/);
    if (byteMatch) {
      const num = parseFloat(byteMatch[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0) {
        if (num >= 1e12) return (num / 1e12).toFixed(2) + ' TB';
        if (num >= 1e9) return (num / 1e9).toFixed(1) + ' GB';
        if (num >= 1e6) return (num / 1e6).toFixed(1) + ' MB';
      }
    }
    return s;
  };

  const isHealthy = useMemo(() => {
    if (!parsed || !parsed.health) return true;
    const h = parsed.health.toUpperCase();
    return h.includes('PASSED') || h.includes('NORMAL') || h.includes('OK');
  }, [parsed]);

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>正在诊断 S.M.A.R.T. 传感器数据...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => fetchSmart(true)} tintColor={colors.accent} />
      }
    >
      {/* 顶部主卡片 */}
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <View style={styles.headerTitleRow}>
            <HardDrive size={22} color={colors.accent} style={{ marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.diskTitle}>{name || '未知磁盘'}</Text>
              <Text style={styles.deviceSubtitle}>
                物理路径: /dev/{resolvedDev || device || '未知'} ({parsed?.device_type || '存储设备'})
              </Text>
            </View>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={() => fetchSmart(true)}>
            <RotateCw size={18} color={colors.muted} />
          </TouchableOpacity>
        </View>

        {/* 健康状态徽章 */}
        <View style={[styles.healthBadge, { backgroundColor: isHealthy ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)' }]}>
          {isHealthy ? (
            <ShieldCheck size={18} color={colors.green} style={{ marginRight: 6 }} />
          ) : (
            <AlertTriangle size={18} color={colors.red} style={{ marginRight: 6 }} />
          )}
          <Text style={[styles.healthText, { color: isHealthy ? colors.green : colors.red }]}>
            健康状态: {parsed?.health || (isHealthy ? 'PASSED / 良好' : '异常警告')}
          </Text>
        </View>
      </View>

      {/* 核心指标仪表盘 */}
      {parsed && (
        <View style={styles.metricsContainer}>
          <Text style={styles.sectionTitle}>核心指标概览</Text>
          <View style={styles.grid}>
            {/* 型号 */}
            <View style={styles.gridCard}>
              <View style={styles.gridCardInner}>
                <View style={styles.gridCardHeader}>
                  <Cpu size={14} color={colors.muted} />
                  <Text style={styles.gridLabel}>设备型号</Text>
                </View>
                <Text style={styles.gridValue} numberOfLines={1} ellipsizeMode="tail">
                  {parsed.model || '未识别'}
                </Text>
              </View>
            </View>

            {/* 序列号 */}
            <View style={styles.gridCard}>
              <View style={styles.gridCardInner}>
                <View style={styles.gridCardHeader}>
                  <Hash size={14} color={colors.muted} />
                  <Text style={styles.gridLabel}>序列号 (S/N)</Text>
                </View>
                <Text style={styles.gridValue} numberOfLines={1} ellipsizeMode="middle">
                  {parsed.serial || '未识别'}
                </Text>
              </View>
            </View>

            {/* 容量 */}
            <View style={styles.gridCard}>
              <View style={styles.gridCardInner}>
                <View style={styles.gridCardHeader}>
                  <Database size={14} color={colors.muted} />
                  <Text style={styles.gridLabel}>标称容量</Text>
                </View>
                <Text style={styles.gridValue} numberOfLines={1}>
                  {formatCapacity(parsed.capacity)}
                </Text>
              </View>
            </View>

            {/* 温度 */}
            <View style={styles.gridCard}>
              <View style={styles.gridCardInner}>
                <View style={styles.gridCardHeader}>
                  <Thermometer size={14} color={colors.muted} />
                  <Text style={styles.gridLabel}>当前温度</Text>
                </View>
                <Text style={[styles.gridValue, { color: parsed.temp ? colors.accent : colors.muted }]}>
                  {parsed.temp ? `${parsed.temp} °C` : '待机 / 未知'}
                </Text>
              </View>
            </View>

            {/* 通电时间 */}
            <View style={styles.gridCard}>
              <View style={styles.gridCardInner}>
                <View style={styles.gridCardHeader}>
                  <Clock size={14} color={colors.muted} />
                  <Text style={styles.gridLabel}>通电时间</Text>
                </View>
                <Text style={styles.gridValue}>
                  {parsed.power_on_hours ? `${parsed.power_on_hours} 小时` : '未知'}
                </Text>
              </View>
            </View>

            {/* 重分配扇区数 */}
            <View style={styles.gridCard}>
              <View style={styles.gridCardInner}>
                <View style={styles.gridCardHeader}>
                  <Layers size={14} color={colors.muted} />
                  <Text style={styles.gridLabel}>05 重分配扇区</Text>
                </View>
                <Text style={[styles.gridValue, { color: (parsed.reallocated === '0' || !parsed.reallocated) ? colors.green : colors.amber }]}>
                  {parsed.reallocated !== '' ? parsed.reallocated : '0'}
                </Text>
              </View>
            </View>

            {/* 待处理扇区数 */}
            <View style={styles.gridCard}>
              <View style={styles.gridCardInner}>
                <View style={styles.gridCardHeader}>
                  <AlertTriangle size={14} color={colors.muted} />
                  <Text style={styles.gridLabel}>C5 待映射扇区</Text>
                </View>
                <Text style={[styles.gridValue, { color: (parsed.pending === '0' || !parsed.pending) ? colors.green : colors.red }]}>
                  {parsed.pending !== '' ? parsed.pending : '0'}
                </Text>
              </View>
            </View>

            {/* CRC错误数 或 NVMe磨损率 */}
            {parsed.percentage_used ? (
              <View style={styles.gridCard}>
                <View style={styles.gridCardInner}>
                  <View style={styles.gridCardHeader}>
                    <Activity size={14} color={colors.muted} />
                    <Text style={styles.gridLabel}>NVMe 磨损率</Text>
                  </View>
                  <Text style={[styles.gridValue, { color: colors.accent }]}>
                    {parsed.percentage_used}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.gridCard}>
                <View style={styles.gridCardInner}>
                  <View style={styles.gridCardHeader}>
                    <Layers size={14} color={colors.muted} />
                    <Text style={styles.gridLabel}>C7 CRC错误数</Text>
                  </View>
                  <Text style={[styles.gridValue, { color: (parsed.crc_errors === '0' || !parsed.crc_errors) ? colors.green : colors.amber }]}>
                    {parsed.crc_errors !== '' ? parsed.crc_errors : '0'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      {/* 完整终端报告 */}
      <View style={styles.terminalSection}>
        <View style={styles.terminalHeader}>
          <Text style={styles.sectionTitle}>完整原始诊断报告 (smartctl)</Text>
          <Text style={styles.terminalHint}>支持左右滑动查看完整表格，长按可选中文本</Text>
        </View>
        <View style={styles.terminalBox}>
          <ScrollView horizontal showsHorizontalScrollIndicator={true} nestedScrollEnabled={true}>
            <Text selectable={true} style={styles.terminalText}>
              {smartData}
            </Text>
          </ScrollView>
        </View>
      </View>
    </ScrollView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 50 },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 12, fontSize: 14, color: colors.muted },

  headerCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  diskTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  deviceSubtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  refreshBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.bg,
  },
  healthBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  healthText: {
    fontSize: 14,
    fontWeight: '600',
  },

  metricsContainer: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  gridCard: {
    width: '50%',
    padding: 4,
  },
  gridCardInner: {
    backgroundColor: colors.card,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    minHeight: 58,
    justifyContent: 'center',
  },
  gridCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  gridLabel: {
    fontSize: 11,
    color: colors.muted,
    marginLeft: 4,
  },
  gridValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textStrong,
  },

  terminalSection: {
    marginTop: 4,
  },
  terminalHeader: {
    marginBottom: 8,
  },
  terminalHint: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  terminalBox: {
    backgroundColor: '#0d1117',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  terminalText: {
    color: '#10b981',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 18,
  },
});