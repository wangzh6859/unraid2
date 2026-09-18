import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Database, Box, Monitor, Terminal, Zap, Layers, HardDrive } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import MetricsLineChart from '../components/MetricsLineChart';
import { apiFetchJson } from '../utils/apiClient';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

export default function MemoryDetailsScreen({ navigation, route }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const initialStats = route?.params?.initialStats;
  const initialHistory = route?.params?.initialHistory;

  const [loading, setLoading] = useState(!initialStats);
  const [refreshing, setRefreshing] = useState(false);
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'docker' | 'vm' | 'process'

  const [memData, setMemData] = useState(() => ({
    total: initialStats?.mem_total || 0,
    used: initialStats?.mem_used || 0,
    available: (initialStats?.mem_total && initialStats?.mem_used) ? (initialStats.mem_total - initialStats.mem_used) : 0,
    free: 0,
    cached: 0,
    buffers: 0,
    swap_total: 0,
    swap_used: 0,
    usage_pct: initialStats?.memory || 0,
    top_processes: [],
  }));
  const [dockers, setDockers] = useState([]);
  const [vms, setVms] = useState([]);
  const [history, setHistory] = useState(() => (Array.isArray(initialHistory) ? initialHistory : []));

  const fetchData = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setLoading(true);
      const host = (await AsyncStorage.getItem('@server_url')) || (await AsyncStorage.getItem('server_host'));
      const token = (await AsyncStorage.getItem('@api_token')) || (await AsyncStorage.getItem('api_token'));
      if (!host) return;

      const cleanHost = host.replace(/\/+$/, '');
      const detailUrl = `${cleanHost}/api.php?action=metrics_detail&token=${encodeURIComponent(token || '')}`;

      let json = null;
      try {
        json = await apiFetchJson(detailUrl, {}, 5000, 1);
      } catch (err) {
        // Fallback to action=status
        const fallbackUrl = `${cleanHost}/api.php?action=status&token=${encodeURIComponent(token || '')}`;
        json = await apiFetchJson(fallbackUrl, {}, 5000, 1);
      }

      if (json?.memory) {
        setMemData(prev => ({
          ...prev,
          ...json.memory,
          usage_pct: typeof json.memory.usage_pct === 'number' ? json.memory.usage_pct : (json.memory_usage || prev.usage_pct),
        }));
      } else if (json?.memory_usage !== undefined || json?.mem_total !== undefined) {
        setMemData(prev => ({
          ...prev,
          total: json.mem_total || prev.total,
          used: json.mem_used || prev.used,
          usage_pct: typeof json.memory_usage === 'number' ? json.memory_usage : prev.usage_pct,
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
      } else if (json?.memory?.usage_pct !== undefined || json?.memory_usage !== undefined) {
        const u = json.memory?.usage_pct !== undefined ? json.memory.usage_pct : json.memory_usage;
        setHistory(prev => {
          const next = [...prev, { t: Date.now(), mem: u }];
          return next.slice(-150);
        });
      }
    } catch (e) {
      console.warn('[MemoryDetailsScreen] Fetch error:', e);
    } finally {
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

  // Ranked memory consumers
  const rankedItems = useMemo(() => {
    const list = [];

    // Dockers
    dockers.forEach(d => {
      const bytes = d.mem_used_bytes || 0;
      list.push({
        type: 'docker',
        id: `docker-${d.name}`,
        name: d.name,
        bytes,
        pct: d.mem_pct || 0,
        sub: d.mem_usage_str || formatBytes(bytes),
        raw: d,
      });
    });

    // VMs
    vms.forEach(v => {
      list.push({
        type: 'vm',
        id: `vm-${v.name}`,
        name: v.name,
        bytes: v.state === 'running' ? 2 * 1024 * 1024 * 1024 : 0,
        pct: v.state === 'running' ? 6.5 : 0,
        sub: `虚拟机状态: ${v.state === 'running' ? '运行中 (预分配内存)' : '已关机'}`,
        raw: v,
      });
    });

    // System Processes
    (memData.top_processes || []).forEach(p => {
      const total = memData.total || 1;
      const bytes = ((p.mem_pct || 0) / 100) * total;
      list.push({
        type: 'process',
        id: `proc-${p.pid}`,
        name: p.name,
        bytes,
        pct: p.mem_pct || 0,
        sub: `PID ${p.pid} · ${p.user || 'root'} · CPU ${p.cpu_pct}%`,
        raw: p,
      });
    });

    // Filter
    let filtered = list;
    if (filterTab === 'docker') filtered = list.filter(i => i.type === 'docker');
    else if (filterTab === 'vm') filtered = list.filter(i => i.type === 'vm');
    else if (filterTab === 'process') filtered = list.filter(i => i.type === 'process');

    // Sort descending by bytes
    return filtered.sort((a, b) => b.bytes - a.bytes);
  }, [dockers, vms, memData.top_processes, memData.total, filterTab]);

  const memPoints = useMemo(() => {
    if (history.length === 0) return [memData.usage_pct || 0];
    return history.map(h => (typeof h.mem === 'number' ? h.mem : (h.memory || 0)));
  }, [history, memData.usage_pct]);

  // Composition bar percentages
  const total = memData.total || 1;
  const usedPct = Math.min(100, Math.max(0, ((memData.used || 0) / total) * 100));
  const cachedPct = Math.min(100, Math.max(0, ((memData.cached || 0) / total) * 100));
  const buffersPct = Math.min(100, Math.max(0, ((memData.buffers || 0) / total) * 100));
  const freePct = Math.max(0, 100 - usedPct - cachedPct - buffersPct);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Top Overview Card */}
      <View style={styles.topCard}>
        <View style={styles.cardHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(34, 197, 94, 0.15)' }]}>
              <Database size={20} color={colors.green} />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.cardTitle}>物理内存状态</Text>
              <Text style={styles.cardSub}>
                总容量 {formatBytes(memData.total)} · 可用 {formatBytes(memData.available)}
              </Text>
            </View>
          </View>

          <View style={[styles.pctBadge, { backgroundColor: 'rgba(34, 197, 94, 0.15)' }]}>
            <Text style={[styles.pctBadgeText, { color: colors.green }]}>
              {(memData.usage_pct || 0).toFixed(1)}%
            </Text>
          </View>
        </View>

        {/* Big RAM Stat */}
        <View style={styles.bigStatRow}>
          <View>
            <Text style={styles.bigStatLabel}>已使用内存</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[styles.bigStatNumber, { color: colors.green }]}>
                {formatBytes(memData.used).replace(/[^\d.]/g, '')}
              </Text>
              <Text style={styles.bigStatUnit}>
                {formatBytes(memData.used).replace(/[\d.\s]/g, '')} / {formatBytes(memData.total)}
              </Text>
            </View>
          </View>

          <View style={styles.statSummaryCols}>
            <View style={styles.miniStatItem}>
              <Text style={styles.miniStatLabel}>缓存</Text>
              <Text style={styles.miniStatVal}>{formatBytes(memData.cached)}</Text>
            </View>
            <View style={[styles.miniStatItem, { marginTop: 4 }]}>
              <Text style={styles.miniStatLabel}>空闲</Text>
              <Text style={styles.miniStatVal}>{formatBytes(memData.free)}</Text>
            </View>
          </View>
        </View>

        {/* Composition Stack Bar */}
        <View style={styles.compositionTrack}>
          <View style={[styles.compSegment, { width: `${usedPct}%`, backgroundColor: colors.green }]} />
          <View style={[styles.compSegment, { width: `${cachedPct}%`, backgroundColor: colors.purple }]} />
          <View style={[styles.compSegment, { width: `${buffersPct}%`, backgroundColor: '#38bdf8' }]} />
        </View>

        {/* Composition Legend */}
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.green }]} />
            <Text style={styles.legendText}>已用 {usedPct.toFixed(0)}%</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.purple }]} />
            <Text style={styles.legendText}>缓存 {cachedPct.toFixed(0)}%</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#38bdf8' }]} />
            <Text style={styles.legendText}>缓冲 {buffersPct.toFixed(0)}%</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.ringBg }]} />
            <Text style={styles.legendText}>空闲 {freePct.toFixed(0)}%</Text>
          </View>
        </View>
      </View>

      {/* 5-Minute Historical Curve */}
      <View style={styles.sectionHeader}>
        <Zap size={16} color={colors.green} style={{ marginRight: 6 }} />
        <Text style={styles.sectionTitle}>近 5 分钟使用率走势</Text>
      </View>
      <MetricsLineChart
        data={memPoints}
        color={colors.green}
        label="物理内存占用率"
        unit="%"
        maxValue={100}
        height={155}
      />

      {/* Swap Section */}
      {memData.swap_total > 0 && (
        <View style={styles.swapCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <HardDrive size={15} color={colors.sub} style={{ marginRight: 6 }} />
              <Text style={styles.swapTitle}>Swap 交换空间</Text>
            </View>
            <Text style={styles.swapUsage}>
              {formatBytes(memData.swap_used)} / {formatBytes(memData.swap_total)}
            </Text>
          </View>
          <View style={styles.swapTrack}>
            <View
              style={[
                styles.swapFill,
                {
                  width: `${Math.min(100, (memData.swap_used / memData.swap_total) * 100)}%`,
                  backgroundColor: colors.accent,
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* Program Breakdown Section */}
      <View style={{ marginTop: 16 }}>
        <View style={styles.sectionHeader}>
          <Layers size={16} color={colors.green} style={{ marginRight: 6 }} />
          <Text style={styles.sectionTitle}>程序具体内存消耗</Text>
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
            const pct = Math.min(100, Math.max(0, item.pct || 0));
            const barWidth = `${Math.min(100, Math.max(2, pct))}%`;
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

                  <Text style={[styles.progMemValue, { color: colors.green }]}>
                    {formatBytes(item.bytes)}
                  </Text>
                </View>

                {/* Subtitle Details */}
                <View style={styles.progSubRow}>
                  <Text style={styles.progSub} numberOfLines={1}>
                    {item.sub}
                  </Text>
                  <Text style={styles.progPctText}>{pct.toFixed(1)}%</Text>
                </View>

                {/* Progress Bar */}
                <View style={styles.progBarTrack}>
                  <View
                    style={[
                      styles.progBarFill,
                      {
                        width: barWidth,
                        backgroundColor: colors.green,
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
      paddingBottom: 36,
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
    cardTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textStrong,
    },
    cardSub: {
      fontSize: 12,
      color: colors.sub,
      marginTop: 2,
    },
    pctBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
    },
    pctBadgeText: {
      fontSize: 13,
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
      fontSize: 14,
      fontWeight: '600',
      color: colors.sub,
      marginLeft: 6,
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
    compositionTrack: {
      height: 8,
      flexDirection: 'row',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
      borderRadius: 4,
      overflow: 'hidden',
      marginTop: 16,
    },
    compSegment: {
      height: '100%',
    },
    legendRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 10,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    legendDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      marginRight: 4,
    },
    legendText: {
      fontSize: 11,
      color: colors.sub,
      fontWeight: '500',
    },
    swapCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
      marginTop: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    swapTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
    },
    swapUsage: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.sub,
      fontFamily: 'monospace',
    },
    swapTrack: {
      height: 4,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
      borderRadius: 2,
      overflow: 'hidden',
      marginTop: 8,
    },
    swapFill: {
      height: '100%',
      borderRadius: 2,
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
      color: colors.green,
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
    progMemValue: {
      fontSize: 14,
      fontWeight: '800',
      fontFamily: 'monospace',
    },
    progSubRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 4,
      marginBottom: 6,
    },
    progSub: {
      fontSize: 11,
      color: colors.sub,
      flex: 1,
      marginRight: 8,
    },
    progPctText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.muted,
      fontFamily: 'monospace',
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
