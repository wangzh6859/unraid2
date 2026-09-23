import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Cpu, Box, Monitor, Terminal, Zap, ChevronRight, Layers } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import MetricsLineChart from '../components/MetricsLineChart';
import { apiFetchJson } from '../utils/apiClient';

export default function CpuDetailsScreen({ navigation, route }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const initialStats = route?.params?.initialStats;
  const initialHistory = route?.params?.initialHistory;

  const [loading, setLoading] = useState(!initialStats);
  const [refreshing, setRefreshing] = useState(false);
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'docker' | 'vm' | 'process'
  const isFetchingRef = useRef(false);

  const [cpuData, setCpuData] = useState(() => ({
    usage: initialStats?.cpu || 0,
    temp: initialStats?.cpu_temp || null,
    model: initialStats?.cpu_model || 'CPU 处理器',
    cores: [],
    top_processes: [],
  }));
  const [dockers, setDockers] = useState([]);
  const [vms, setVms] = useState([]);
  const [history, setHistory] = useState(() => (Array.isArray(initialHistory) ? initialHistory : []));

  // Fetch metrics detail from backend
  const fetchData = useCallback(async (isSilent = false) => {
    if (isFetchingRef.current && isSilent) return;
    isFetchingRef.current = true;
    try {
      if (!isSilent) setLoading(true);
      const host = (await AsyncStorage.getItem('@server_url')) || (await AsyncStorage.getItem('server_host'));
      const token = (await AsyncStorage.getItem('@api_token')) || (await AsyncStorage.getItem('api_token'));
      if (!host) return;

      const cleanHost = host.replace(/\/+$/, '');
      const detailUrl = `${cleanHost}/api.php?action=metrics_detail&type=cpu&token=${encodeURIComponent(token || '')}`;

      let json = null;
      try {
        json = await apiFetchJson(detailUrl, {}, 5000, 1);
      } catch (err) {
        // Fallback to action=status
        const fallbackUrl = `${cleanHost}/api.php?action=status&token=${encodeURIComponent(token || '')}`;
        json = await apiFetchJson(fallbackUrl, {}, 5000, 1);
      }

      if (json?.cpu) {
        setCpuData(prev => ({
          ...prev,
          ...json.cpu,
          usage: typeof json.cpu.usage === 'number' ? json.cpu.usage : (json.cpu_usage || prev.usage),
          temp: json.cpu.temp !== undefined ? json.cpu.temp : (json.cpu_temp || prev.temp),
        }));
      } else if (json?.cpu_usage !== undefined || json?.cpu_temp !== undefined) {
        setCpuData(prev => ({
          ...prev,
          usage: typeof json.cpu_usage === 'number' ? json.cpu_usage : prev.usage,
          temp: json.cpu_temp !== undefined ? json.cpu_temp : prev.temp,
        }));
      }

      if (Array.isArray(json?.dockers)) {
        setDockers(json.dockers);
      }
      if (Array.isArray(json?.vms)) {
        setVms(json.vms);
      }
      if (Array.isArray(json?.history) && json.history.length > 0) {
        setHistory(json.history);
      } else if (json?.cpu?.usage !== undefined || json?.cpu_usage !== undefined) {
        const u = json.cpu?.usage !== undefined ? json.cpu.usage : json.cpu_usage;
        setHistory(prev => {
          const next = [...prev, { t: Date.now(), cpu: u }];
          return next.slice(-150);
        });
      }
    } catch (e) {
      console.warn('[CpuDetailsScreen] Fetch error:', e);
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

  // Combine and sort programs by CPU usage
  const rankedItems = useMemo(() => {
    const list = [];

    // 1. Dockers
    dockers.forEach(d => {
      list.push({
        type: 'docker',
        id: `docker-${d.name}`,
        name: d.name,
        cpu: d.cpu_pct || 0,
        sub: d.mem_usage_str ? `内存: ${d.mem_usage_str}` : `网络: ${d.net_io_str || '0B'}`,
        raw: d,
      });
    });

    // 2. VMs
    vms.forEach(v => {
      list.push({
        type: 'vm',
        id: `vm-${v.name}`,
        name: v.name,
        cpu: v.state === 'running' ? 2.5 : 0,
        sub: `虚拟机状态: ${v.state === 'running' ? '运行中' : '已关机'}`,
        raw: v,
      });
    });

    // 3. System Processes
    (cpuData.top_processes || []).forEach(p => {
      list.push({
        type: 'process',
        id: `proc-${p.pid}`,
        name: p.name,
        cpu: p.cpu_pct || 0,
        sub: `PID ${p.pid} · ${p.user || 'root'} · 内存 ${p.mem_pct}%`,
        raw: p,
      });
    });

    // Filter
    let filtered = list;
    if (filterTab === 'docker') filtered = list.filter(i => i.type === 'docker');
    else if (filterTab === 'vm') filtered = list.filter(i => i.type === 'vm');
    else if (filterTab === 'process') filtered = list.filter(i => i.type === 'process');

    // Sort descending by CPU%
    return filtered.sort((a, b) => b.cpu - a.cpu);
  }, [dockers, vms, cpuData.top_processes, filterTab]);

  const cpuPoints = useMemo(() => {
    if (history.length === 0) return [cpuData.usage || 0];
    return history.map(h => (typeof h.cpu === 'number' ? h.cpu : (h.usage || 0)));
  }, [history, cpuData.usage]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Top Hardware Overview Card */}
      <View style={styles.topCard}>
        <View style={styles.cardHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(2, 132, 199, 0.15)' }]}>
              <Cpu size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.cpuModel} numberOfLines={1}>
                {cpuData.model || 'x86_64 处理器'}
              </Text>
              <Text style={styles.coreMeta}>
                {cpuData.cores && cpuData.cores.length > 0 ? `${cpuData.cores.length} 核心 / 线程` : '多核心处理器'}
              </Text>
            </View>
          </View>

          {cpuData.temp !== null && cpuData.temp !== undefined ? (
            <View
              style={[
                styles.tempBadge,
                {
                  backgroundColor:
                    cpuData.temp > 70
                      ? 'rgba(239, 68, 68, 0.15)'
                      : cpuData.temp > 55
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
                      cpuData.temp > 70
                        ? colors.red
                        : cpuData.temp > 55
                        ? colors.tempWarm
                        : colors.green,
                  },
                ]}
              >
                {cpuData.temp}°C
              </Text>
            </View>
          ) : null}
        </View>

        {/* Big CPU Usage Number */}
        <View style={styles.bigStatRow}>
          <View>
            <Text style={styles.bigStatLabel}>当前总体负载</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[styles.bigStatNumber, { color: colors.accent }]}>
                {(cpuData.usage || 0).toFixed(1)}
              </Text>
              <Text style={styles.bigStatUnit}>%</Text>
            </View>
          </View>

          <View style={styles.summaryBadges}>
            <View style={styles.summaryBadge}>
              <Box size={14} color={colors.sub} style={{ marginRight: 4 }} />
              <Text style={styles.summaryBadgeText}>
                {dockers.filter(d => (d.cpu_pct || 0) > 0.5).length} 活跃容器
              </Text>
            </View>
            <View style={[styles.summaryBadge, { marginTop: 6 }]}>
              <Terminal size={14} color={colors.sub} style={{ marginRight: 4 }} />
              <Text style={styles.summaryBadgeText}>
                {(cpuData.top_processes || []).length} 进程监控
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* 5-Minute Historical Curve */}
      <View style={styles.sectionHeader}>
        <Zap size={16} color={colors.accent} style={{ marginRight: 6 }} />
        <Text style={styles.sectionTitle}>近 5 分钟负载走势</Text>
      </View>
      <MetricsLineChart
        data={cpuPoints}
        color={colors.accent}
        label="CPU 整体占用率"
        unit="%"
        maxValue={100}
        height={155}
      />

      {/* Per-Core Breakdown Grid */}
      {cpuData.cores && cpuData.cores.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <View style={styles.sectionHeader}>
            <Layers size={16} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={styles.sectionTitle}>多核心负载明细</Text>
            <Text style={styles.sectionCount}>({cpuData.cores.length} 核心)</Text>
          </View>

          <View style={styles.coresGrid}>
            {cpuData.cores.map((core) => {
              const u = Math.min(100, Math.max(0, core.usage || 0));
              const barColor =
                u > 80 ? colors.red : u > 55 ? colors.tempWarm : colors.accent;
              return (
                <View key={core.id} style={styles.coreCard}>
                  <View style={styles.coreHeader}>
                    <Text style={styles.coreName}>{core.name || `Core ${core.id}`}</Text>
                    <Text style={[styles.coreUsage, { color: barColor }]}>
                      {u.toFixed(1)}%
                    </Text>
                  </View>
                  <View style={styles.coreBarTrack}>
                    <View
                      style={[
                        styles.coreBarFill,
                        { width: `${u}%`, backgroundColor: barColor },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Program Breakdown Section */}
      <View style={{ marginTop: 20 }}>
        <View style={styles.sectionHeader}>
          <Layers size={16} color={colors.accent} style={{ marginRight: 6 }} />
          <Text style={styles.sectionTitle}>程序具体实时占用</Text>
          <Text style={styles.sectionCount}>({rankedItems.length})</Text>
        </View>

        {/* Filter Segment Tabs */}
        <View style={styles.tabsRow}>
          {[
            { key: 'all', label: '全部' },
            { key: 'docker', label: 'Docker 容器' },
            { key: 'vm', label: '虚拟机' },
            { key: 'process', label: '系统进程' },
          ].map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tabBtn,
                filterTab === tab.key && styles.tabBtnActive,
              ]}
              onPress={() => setFilterTab(tab.key)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.tabBtnText,
                  filterTab === tab.key && styles.tabBtnTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Ranked List */}
        {rankedItems.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>当前分类暂无活跃程序或进程</Text>
          </View>
        ) : (
          rankedItems.map((item, idx) => {
            const cpuPct = Math.min(100, Math.max(0, item.cpu || 0));
            const barWidth = `${Math.min(100, Math.max(2, cpuPct))}%`;
            return (
              <View key={item.id || idx} style={styles.programCard}>
                <View style={styles.progHeaderRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
                    <View
                      style={[
                        styles.typeBadge,
                        {
                          backgroundColor:
                            item.type === 'docker'
                              ? 'rgba(56, 189, 248, 0.15)'
                              : item.type === 'vm'
                              ? 'rgba(168, 85, 247, 0.15)'
                              : 'rgba(148, 163, 184, 0.15)',
                        },
                      ]}
                    >
                      {item.type === 'docker' ? (
                        <Box size={12} color="#38bdf8" />
                      ) : item.type === 'vm' ? (
                        <Monitor size={12} color="#c084fc" />
                      ) : (
                        <Terminal size={12} color={colors.sub} />
                      )}
                      <Text
                        style={[
                          styles.typeBadgeText,
                          {
                            color:
                              item.type === 'docker'
                                ? '#38bdf8'
                                : item.type === 'vm'
                                ? '#c084fc'
                                : colors.sub,
                          },
                        ]}
                      >
                        {item.type === 'docker'
                          ? '容器'
                          : item.type === 'vm'
                          ? 'VM'
                          : '进程'}
                      </Text>
                    </View>

                    <Text style={styles.progName} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.progCpuValue,
                      {
                        color:
                          cpuPct > 50
                            ? colors.red
                            : cpuPct > 20
                            ? colors.tempWarm
                            : colors.textStrong,
                      },
                    ]}
                  >
                    {cpuPct.toFixed(1)}%
                  </Text>
                </View>

                {/* Subtitle Details */}
                <Text style={styles.progSub} numberOfLines={1}>
                  {item.sub}
                </Text>

                {/* CPU Progress Bar */}
                <View style={styles.progBarTrack}>
                  <View
                    style={[
                      styles.progBarFill,
                      {
                        width: barWidth,
                        backgroundColor:
                          cpuPct > 50
                            ? colors.red
                            : cpuPct > 20
                            ? colors.tempWarm
                            : colors.accent,
                      },
                    ]}
                  />
                </View>
              </View>
            );
          })
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
      width: 38,
      height: 38,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cpuModel: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textStrong,
    },
    coreMeta: {
      fontSize: 12,
      color: colors.sub,
      marginTop: 2,
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
    summaryBadges: {
      alignItems: 'flex-end',
    },
    summaryBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
    },
    summaryBadgeText: {
      fontSize: 11,
      color: colors.text,
      fontWeight: '600',
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
    coresGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    coreCard: {
      width: '48.5%',
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    coreHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    coreName: {
      fontSize: 12,
      color: colors.text,
      fontWeight: '600',
    },
    coreUsage: {
      fontSize: 12,
      fontWeight: '800',
      fontFamily: 'monospace',
    },
    coreBarTrack: {
      height: 5,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
      borderRadius: 3,
      overflow: 'hidden',
    },
    coreBarFill: {
      height: '100%',
      borderRadius: 3,
    },
    tabsRow: {
      flexDirection: 'row',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
      borderRadius: 10,
      padding: 3,
      marginBottom: 10,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: 7,
      alignItems: 'center',
      borderRadius: 8,
    },
    tabBtnActive: {
      backgroundColor: colors.card,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
    },
    tabBtnText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.sub,
    },
    tabBtnTextActive: {
      color: colors.accent,
      fontWeight: '700',
    },
    programCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
      marginBottom: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    progHeaderRow: {
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
    progName: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textStrong,
      flex: 1,
    },
    progCpuValue: {
      fontSize: 14,
      fontWeight: '800',
      fontFamily: 'monospace',
    },
    progSub: {
      fontSize: 11,
      color: colors.sub,
      marginTop: 4,
      marginBottom: 6,
    },
    progBarTrack: {
      height: 4,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
      borderRadius: 2,
      overflow: 'hidden',
    },
    progBarFill: {
      height: '100%',
      borderRadius: 2,
    },
    emptyCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 24,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 13,
      color: colors.sub,
    },
  });
}
