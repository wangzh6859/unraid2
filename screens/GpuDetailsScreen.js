import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Zap, Box, Terminal, Monitor, Activity, ShieldCheck, Layers, Gauge } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import MetricsLineChart from '../components/MetricsLineChart';
import { apiFetchJson } from '../utils/apiClient';

export default function GpuDetailsScreen({ navigation, route }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const initialGpu = route?.params?.initialGpu;
  const initialHistory = route?.params?.initialHistory;

  const [loading, setLoading] = useState(!initialGpu);
  const [refreshing, setRefreshing] = useState(false);
  const isFetchingRef = useRef(false);

  const [gpu, setGpu] = useState(() => (initialGpu && initialGpu.name ? {
    name: initialGpu.clean_name || initialGpu.name,
    vendor: initialGpu.vendor || 'GPU',
    usage: initialGpu.usage || 0,
    temp: initialGpu.temp || null,
    vram_used: initialGpu.vram_used || null,
    vram_total: initialGpu.vram_total || null,
    vram_pct: initialGpu.vram_pct || 0,
    power_w: initialGpu.power_w || null,
    clock_mhz: initialGpu.clock_mhz || null,
    max_clock_mhz: initialGpu.max_clock_mhz || null,
    driver: initialGpu.driver || 'GPU',
    active_apps: initialGpu.active_apps || [],
  } : {
    name: '显卡 / GPU 检测中...',
    vendor: 'GPU',
    usage: 0,
    temp: null,
    vram_used: null,
    vram_total: null,
    vram_pct: 0,
    power_w: null,
    clock_mhz: null,
    max_clock_mhz: null,
    driver: 'N/A',
    active_apps: [],
  }));
  const [history, setHistory] = useState(() => (Array.isArray(initialHistory) ? initialHistory : []));

  const fetchData = useCallback(async (isSilent = false) => {
    if (isFetchingRef.current && isSilent) return;
    isFetchingRef.current = true;
    try {
      if (!isSilent) setLoading(true);
      const host = (await AsyncStorage.getItem('@server_url')) || (await AsyncStorage.getItem('server_host'));
      const token = (await AsyncStorage.getItem('@api_token')) || (await AsyncStorage.getItem('api_token'));
      if (!host) return;

      const cleanHost = host.replace(/\/+$/, '');
      const detailUrl = `${cleanHost}/api.php?action=metrics_detail&type=gpu&token=${encodeURIComponent(token || '')}`;

      let json = null;
      try {
        json = await apiFetchJson(detailUrl, {}, 5000, 1);
      } catch (err) {
        // Fallback to action=status
        const fallbackUrl = `${cleanHost}/api.php?action=status&token=${encodeURIComponent(token || '')}`;
        json = await apiFetchJson(fallbackUrl, {}, 5000, 1);
      }

      if (json?.gpu) {
        setGpu(prev => ({
          ...prev,
          ...json.gpu,
          name: json.gpu.name || prev.name,
          vendor: json.gpu.vendor || prev.vendor,
          usage: typeof json.gpu.usage === 'number' ? json.gpu.usage : prev.usage,
          temp: json.gpu.temp !== undefined ? json.gpu.temp : prev.temp,
          driver: json.gpu.driver || prev.driver,
        }));
      }

      if (Array.isArray(json?.history) && json.history.length > 0) {
        setHistory(json.history);
      } else if (json?.gpu?.usage !== undefined) {
        setHistory(prev => {
          const next = [...prev, { t: Date.now(), gpu: json.gpu.usage }];
          return next.slice(-150);
        });
      }
    } catch (e) {
      console.warn('[GpuDetailsScreen] Fetch error:', e);
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData(true);
      const timer = setInterval(() => {
        fetchData(true);
      }, 1000);
      return () => clearInterval(timer);
    }, [fetchData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(true);
  }, [fetchData]);

  const gpuPoints = useMemo(() => {
    if (history.length === 0) return [gpu.usage || 0];
    return history.map(h => (typeof h.gpu === 'number' ? h.gpu : (h.usage || 0)));
  }, [history, gpu.usage]);

  const vendorColor = useMemo(() => {
    const v = (gpu.vendor || '').toUpperCase();
    if (v.includes('NVIDIA')) return '#22c55e';
    if (v.includes('INTEL')) return '#38bdf8';
    if (v.includes('AMD')) return '#ef4444';
    return colors.accent;
  }, [gpu.vendor, colors.accent]);

  const activeApps = useMemo(() => {
    return Array.isArray(gpu.active_apps) ? gpu.active_apps : [];
  }, [gpu.active_apps]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={vendorColor} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Top GPU Overview Card */}
      <View style={styles.topCard}>
        <View style={styles.cardHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            <View style={[styles.iconBox, { backgroundColor: `${vendorColor}22` }]}>
              <Zap size={22} color={vendorColor} />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.gpuName} numberOfLines={1}>
                {gpu.name || '图形处理器 (GPU)'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                <View style={[styles.vendorBadge, { backgroundColor: `${vendorColor}20` }]}>
                  <Text style={[styles.vendorBadgeText, { color: vendorColor }]}>
                    {gpu.vendor || 'GPU'}
                  </Text>
                </View>
                {gpu.driver && gpu.driver !== 'N/A' && (
                  <View style={[styles.driverBadge, { marginLeft: 6 }]}>
                    <Text style={styles.driverBadgeText}>{gpu.driver}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {gpu.temp !== null && gpu.temp !== undefined ? (
            <View
              style={[
                styles.tempBadge,
                {
                  backgroundColor:
                    gpu.temp > 75
                      ? 'rgba(239, 68, 68, 0.15)'
                      : gpu.temp > 60
                      ? 'rgba(249, 115, 22, 0.15)'
                      : 'rgba(34, 197, 94, 0.15)',
                },
              ]}
            >
              <Text
                style={[
                  styles.tempBadgeText,
                  {
                    color:
                      gpu.temp > 75
                        ? colors.red
                        : gpu.temp > 60
                        ? colors.tempWarm
                        : colors.green,
                  },
                ]}
              >
                {gpu.temp}°C
              </Text>
            </View>
          ) : null}
        </View>

        {/* Big GPU Stat */}
        <View style={styles.bigStatRow}>
          <View>
            <Text style={styles.bigStatLabel}>核心实时利用率</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[styles.bigStatNumber, { color: vendorColor }]}>
                {(gpu.usage || 0).toFixed(1)}
              </Text>
              <Text style={styles.bigStatUnit}>%</Text>
            </View>
          </View>

          <View style={styles.statSummaryCols}>
            {gpu.clock_mhz ? (
              <View style={styles.miniStatItem}>
                <Text style={styles.miniStatLabel}>核心时钟</Text>
                <Text style={styles.miniStatVal}>
                  {gpu.clock_mhz} MHz
                  {gpu.max_clock_mhz ? ` / ${gpu.max_clock_mhz}` : ''}
                </Text>
              </View>
            ) : null}
            {gpu.power_w !== null && gpu.power_w !== undefined ? (
              <View style={[styles.miniStatItem, { marginTop: 4 }]}>
                <Text style={styles.miniStatLabel}>功耗</Text>
                <Text style={styles.miniStatVal}>{gpu.power_w} W</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* 5-Minute Historical Curve */}
      <View style={styles.sectionHeader}>
        <Activity size={16} color={vendorColor} style={{ marginRight: 6 }} />
        <Text style={styles.sectionTitle}>近 5 分钟负载走势</Text>
      </View>
      <MetricsLineChart
        data={gpuPoints}
        color={vendorColor}
        label="GPU 核心利用率"
        unit="%"
        maxValue={100}
        height={155}
      />

      {/* Hardware Telemetry Meter Grid */}
      <View style={styles.gridRow}>
        {/* VRAM Meter */}
        <View style={styles.gridCard}>
          <View style={styles.gridCardHeader}>
            <Layers size={15} color={vendorColor} style={{ marginRight: 6 }} />
            <Text style={styles.gridCardTitle}>显存分配 (VRAM)</Text>
          </View>
          <Text style={styles.vramBigNumber}>
            {gpu.vram_used !== null ? `${gpu.vram_used} MB` : `${gpu.vram_pct || 0}%`}
          </Text>
          <Text style={styles.vramSub}>
            {gpu.vram_total ? `总计 ${gpu.vram_total} MB · 占用 ${gpu.vram_pct}%` : '共享系统内存动态调配'}
          </Text>
          <View style={styles.meterTrack}>
            <View
              style={[
                styles.meterFill,
                { width: `${Math.min(100, Math.max(0, gpu.vram_pct || 0))}%`, backgroundColor: vendorColor },
              ]}
            />
          </View>
        </View>

        {/* Clock & Engine Status */}
        <View style={styles.gridCard}>
          <View style={styles.gridCardHeader}>
            <Gauge size={15} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={styles.gridCardTitle}>运行状态</Text>
          </View>
          <Text style={styles.statusBigText}>
            {gpu.usage > 5 ? '高负荷渲染 / 转码' : gpu.usage > 0 ? '硬件加速活跃' : '待机节能 (RC6)'}
          </Text>
          <Text style={styles.vramSub}>
            {activeApps.length > 0 ? `${activeApps.length} 个程序正在调用硬件加速` : '当前无计算或视频流任务'}
          </Text>
          <View style={styles.meterTrack}>
            <View
              style={[
                styles.meterFill,
                { width: `${Math.min(100, Math.max(5, gpu.usage || 0))}%`, backgroundColor: colors.accent },
              ]}
            />
          </View>
        </View>
      </View>

      {/* Active GPU Applications / Docker Containers */}
      <View style={{ marginTop: 18 }}>
        <View style={styles.sectionHeader}>
          <Box size={16} color={vendorColor} style={{ marginRight: 6 }} />
          <Text style={styles.sectionTitle}>正在调用 GPU 硬件加速的程序与容器</Text>
          <Text style={styles.sectionCount}>({activeApps.length})</Text>
        </View>

        {activeApps.length === 0 ? (
          <View style={styles.emptyCard}>
            <ShieldCheck size={36} color={colors.sub} style={{ marginBottom: 10 }} />
            <Text style={styles.emptyTitle}>当前无容器或进程调用 GPU</Text>
            <Text style={styles.emptySub}>
              显卡处于低功耗待机模式。当 Plex、Jellyfin、Emby 启动转码或 Ollama 运行 AI 推理时，将自动在此处实时呈现其名称、容器与显存占用。
            </Text>
          </View>
        ) : (
          activeApps.map((app, idx) => (
            <View key={app.pid || idx} style={styles.appCard}>
              <View style={styles.appHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
                  <View
                    style={[
                      styles.typeBadge,
                      {
                        backgroundColor:
                          app.type === 'docker'
                            ? 'rgba(56, 189, 248, 0.15)'
                            : app.type === 'vm'
                            ? 'rgba(168, 85, 247, 0.15)'
                            : 'rgba(148, 163, 184, 0.15)',
                      },
                    ]}
                  >
                    {app.type === 'docker' ? (
                      <Box size={12} color="#38bdf8" />
                    ) : app.type === 'vm' ? (
                      <Monitor size={12} color="#c084fc" />
                    ) : (
                      <Terminal size={12} color={colors.sub} />
                    )}
                    <Text
                      style={[
                        styles.typeBadgeText,
                        {
                          color:
                            app.type === 'docker'
                              ? '#38bdf8'
                              : app.type === 'vm'
                              ? '#c084fc'
                              : colors.sub,
                        },
                      ]}
                    >
                      {app.type === 'docker' ? 'Docker 容器' : app.type === 'vm' ? '虚拟机' : '进程'}
                    </Text>
                  </View>

                  <Text style={styles.appName} numberOfLines={1}>
                    {app.container_name || app.name}
                  </Text>
                </View>

                {app.vram ? (
                  <Text style={[styles.appVramValue, { color: vendorColor }]}>
                    {app.vram}
                  </Text>
                ) : (
                  <View style={styles.activePill}>
                    <Text style={styles.activePillText}>硬件加速中</Text>
                  </View>
                )}
              </View>

              <Text style={styles.appCommand} numberOfLines={1}>
                PID: {app.pid} · {app.command || app.name}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function createStyles(colors, isDark) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    content: {
      padding: 16,
      paddingBottom: 120,
    },
    topCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 16,
      marginBottom: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    iconBox: {
      width: 40,
      height: 40,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    gpuName: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textStrong,
    },
    vendorBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    vendorBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    driverBadge: {
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    driverBadgeText: {
      fontSize: 10,
      color: colors.sub,
      fontFamily: 'monospace',
    },
    tempBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
    },
    tempBadgeText: {
      fontSize: 12,
      fontWeight: '700',
      fontFamily: 'monospace',
    },
    bigStatRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginTop: 16,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    bigStatLabel: {
      fontSize: 12,
      color: colors.sub,
      marginBottom: 2,
    },
    bigStatNumber: {
      fontSize: 34,
      fontWeight: '900',
      fontFamily: 'monospace',
    },
    bigStatUnit: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.sub,
      marginLeft: 4,
      marginBottom: 4,
    },
    statSummaryCols: {
      alignItems: 'flex-end',
    },
    miniStatItem: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    miniStatLabel: {
      fontSize: 11,
      color: colors.muted,
      marginRight: 6,
    },
    miniStatVal: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
      fontFamily: 'monospace',
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
      marginTop: 6,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textStrong,
    },
    sectionCount: {
      fontSize: 12,
      color: colors.muted,
      marginLeft: 4,
    },
    gridRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 12,
    },
    gridCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    gridCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
    },
    gridCardTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.sub,
    },
    vramBigNumber: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textStrong,
      fontFamily: 'monospace',
      marginTop: 2,
    },
    statusBigText: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textStrong,
      marginTop: 4,
    },
    vramSub: {
      fontSize: 11,
      color: colors.muted,
      marginTop: 4,
      marginBottom: 8,
    },
    meterTrack: {
      height: 4,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
      borderRadius: 2,
      overflow: 'hidden',
    },
    meterFill: {
      height: '100%',
      borderRadius: 2,
    },
    emptyCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 24,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    emptyTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textStrong,
      marginBottom: 6,
    },
    emptySub: {
      fontSize: 12,
      color: colors.sub,
      textAlign: 'center',
      lineHeight: 18,
    },
    appCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
      marginBottom: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    appHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    typeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      marginRight: 8,
      gap: 3,
    },
    typeBadgeText: {
      fontSize: 10,
      fontWeight: '700',
    },
    appName: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textStrong,
      flex: 1,
    },
    appVramValue: {
      fontSize: 13,
      fontWeight: '800',
      fontFamily: 'monospace',
    },
    activePill: {
      backgroundColor: 'rgba(34, 197, 94, 0.15)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    activePillText: {
      fontSize: 10,
      fontWeight: '700',
      color: '#22c55e',
    },
    appCommand: {
      fontSize: 11,
      color: colors.sub,
      marginTop: 4,
      fontFamily: 'monospace',
    },
  });
}
