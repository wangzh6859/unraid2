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
import { Wifi, ArrowDown, ArrowUp, Box, Globe, Shield, Activity, Layers, Network } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import MetricsLineChart from '../components/MetricsLineChart';
import { apiFetchJson } from '../utils/apiClient';

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
  const mb = bytesPerSec / (1024 * 1024);
  if (mb >= 100) return `${mb.toFixed(0)} MB/s`;
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bytesPerSec / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

export default function NetworkDetailsScreen({ navigation, route }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const initialNetSpeed = route?.params?.initialNetSpeed;
  const initialHistory = route?.params?.initialHistory;

  const [loading, setLoading] = useState(!initialNetSpeed);
  const [refreshing, setRefreshing] = useState(false);

  const [networkData, setNetworkData] = useState({
    total_rx_bytes: 0,
    total_tx_bytes: 0,
    interfaces: [],
  });
  const [dockers, setDockers] = useState([]);
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

      if (json?.network) {
        setNetworkData(json.network);
      }
      if (Array.isArray(json?.dockers)) {
        setDockers(json.dockers);
      }
      if (Array.isArray(json?.history) && json.history.length > 0) {
        setHistory(json.history);
      } else if (json?.network_speed) {
        const rx = json.network_speed.down || json.network_speed.rx || 0;
        const tx = json.network_speed.up || json.network_speed.tx || 0;
        setHistory(prev => {
          const next = [...prev, { t: Date.now(), rx, tx }];
          return next.slice(-150);
        });
      }
    } catch (e) {
      console.warn('[NetworkDetailsScreen] Fetch error:', e);
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
      }, 2000);
      return () => clearInterval(timer);
    }, [fetchData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(true);
  }, [fetchData]);

  // Derive current overall RX/TX speed from history or sum of interfaces
  const currentSpeeds = useMemo(() => {
    if (history.length > 0) {
      const last = history[history.length - 1];
      if (last.rx !== undefined || last.tx !== undefined) {
        return {
          rx: last.rx || 0,
          tx: last.tx || 0,
        };
      }
    }
    // Sum interfaces
    let rx = 0;
    let tx = 0;
    (networkData.interfaces || []).forEach(iface => {
      if (iface.is_physical || iface.name === 'br0' || iface.name === 'bond0') {
        rx += iface.rx_bps || 0;
        tx += iface.tx_bps || 0;
      }
    });
    if (rx === 0 && tx === 0 && initialNetSpeed) {
      return {
        rx: initialNetSpeed.down || initialNetSpeed.rx || 0,
        tx: initialNetSpeed.up || initialNetSpeed.tx || 0,
      };
    }
    return { rx, tx };
  }, [history, networkData.interfaces, initialNetSpeed]);

  const rxPoints = useMemo(() => {
    if (history.length === 0) return [currentSpeeds.rx];
    return history.map(h => (typeof h.rx === 'number' ? h.rx : 0));
  }, [history, currentSpeeds.rx]);

  const txPoints = useMemo(() => {
    if (history.length === 0) return [currentSpeeds.tx];
    return history.map(h => (typeof h.tx === 'number' ? h.tx : 0));
  }, [history, currentSpeeds.tx]);

  // Ranked Docker containers by network traffic
  const rankedContainers = useMemo(() => {
    const list = [...dockers];
    return list
      .map(d => {
        const totalBytes = (d.net_rx_bytes || 0) + (d.net_tx_bytes || 0);
        return {
          name: d.name,
          rx: d.net_rx_bytes || 0,
          tx: d.net_tx_bytes || 0,
          total: totalBytes,
          rawStr: d.net_io_str || '0B / 0B',
          id: d.id,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [dockers]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.networkDown} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Top Network Throughput Card */}
      <View style={styles.topCard}>
        <View style={styles.cardHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(34, 197, 94, 0.15)' }]}>
              <Wifi size={20} color={colors.networkDown} />
            </View>
            <View style={{ marginLeft: 10 }}>
              <Text style={styles.cardTitle}>实时网络吞吐</Text>
              <Text style={styles.cardSub}>
                累计接收 {formatBytes(networkData.total_rx_bytes)} · 累计发送 {formatBytes(networkData.total_tx_bytes)}
              </Text>
            </View>
          </View>
        </View>

        {/* Dual Rates Big Stat */}
        <View style={styles.dualSpeedRow}>
          {/* Downloader */}
          <View style={styles.speedBox}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <ArrowDown size={15} color={colors.networkDown} style={{ marginRight: 4 }} />
              <Text style={[styles.speedLabel, { color: colors.networkDown }]}>下行速率 (下载)</Text>
            </View>
            <Text style={[styles.speedNumber, { color: colors.networkDown }]}>
              {formatSpeed(currentSpeeds.rx)}
            </Text>
          </View>

          <View style={styles.speedDivider} />

          {/* Uploader */}
          <View style={styles.speedBox}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <ArrowUp size={15} color={colors.networkUp} style={{ marginRight: 4 }} />
              <Text style={[styles.speedLabel, { color: colors.networkUp }]}>上行速率 (上传)</Text>
            </View>
            <Text style={[styles.speedNumber, { color: colors.networkUp }]}>
              {formatSpeed(currentSpeeds.tx)}
            </Text>
          </View>
        </View>
      </View>

      {/* 5-Minute Historical Dual-Curve */}
      <View style={styles.sectionHeader}>
        <Activity size={16} color={colors.networkDown} style={{ marginRight: 6 }} />
        <Text style={styles.sectionTitle}>近 5 分钟吞吐走势 (双轨)</Text>
      </View>
      <MetricsLineChart
        data={rxPoints}
        data2={txPoints}
        color={colors.networkDown}
        color2={colors.networkUp}
        label="实时下载"
        label2="实时上传"
        unit=""
        formatValue={formatSpeed}
        height={165}
      />

      {/* Per-Container Network Breakdown */}
      <View style={{ marginTop: 18 }}>
        <View style={styles.sectionHeader}>
          <Box size={16} color={colors.accent} style={{ marginRight: 6 }} />
          <Text style={styles.sectionTitle}>各 Docker 容器网络上传与下载</Text>
          <Text style={styles.sectionCount}>({rankedContainers.length})</Text>
        </View>

        {rankedContainers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>当前暂无容器网络流速统计</Text>
          </View>
        ) : (
          rankedContainers.map((c, idx) => (
            <View key={c.id || idx} style={styles.containerCard}>
              <View style={styles.containerHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
                  <View style={styles.cIconBox}>
                    <Box size={13} color="#38bdf8" />
                  </View>
                  <Text style={styles.containerName} numberOfLines={1}>
                    {c.name}
                  </Text>
                </View>

                {/* Net IO Text */}
                <Text style={styles.netIoBadge}>{c.rawStr}</Text>
              </View>

              {/* Sub Down / Up stats */}
              <View style={styles.netDetailRow}>
                <View style={styles.netDetailCol}>
                  <ArrowDown size={11} color={colors.networkDown} style={{ marginRight: 3 }} />
                  <Text style={[styles.netDetailVal, { color: colors.networkDown }]}>
                    接收: {formatBytes(c.rx)}
                  </Text>
                </View>
                <View style={[styles.netDetailCol, { marginLeft: 14 }]}>
                  <ArrowUp size={11} color={colors.networkUp} style={{ marginRight: 3 }} />
                  <Text style={[styles.netDetailVal, { color: colors.networkUp }]}>
                    发送: {formatBytes(c.tx)}
                  </Text>
                </View>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Network Interfaces List */}
      <View style={{ marginTop: 18 }}>
        <View style={styles.sectionHeader}>
          <Network size={16} color={colors.accent} style={{ marginRight: 6 }} />
          <Text style={styles.sectionTitle}>网卡接口与速率</Text>
          <Text style={styles.sectionCount}>({(networkData.interfaces || []).length})</Text>
        </View>

        {(networkData.interfaces || []).map((iface, idx) => {
          const isUp = iface.state === 'up';
          const typeName = iface.is_physical
            ? '物理网卡'
            : iface.name.startsWith('br')
            ? '桥接虚拟网卡'
            : iface.name.startsWith('bond')
            ? '链路聚合 (Bond)'
            : iface.name.startsWith('wg')
            ? 'WireGuard 隧道'
            : '容器虚拟网桥';

          return (
            <View key={iface.name || idx} style={styles.ifaceCard}>
              <View style={styles.ifaceHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
                  <View
                    style={[
                      styles.stateDot,
                      { backgroundColor: isUp ? colors.green : colors.red },
                    ]}
                  />
                  <Text style={styles.ifaceName}>{iface.name}</Text>
                  <View style={styles.ifaceTypeBadge}>
                    <Text style={styles.ifaceTypeText}>{typeName}</Text>
                  </View>
                </View>

                <View style={styles.ifaceRatesBox}>
                  <Text style={[styles.ifaceRateDown, { color: colors.networkDown }]}>
                    ↓ {formatSpeed(iface.rx_bps)}
                  </Text>
                  <Text style={[styles.ifaceRateUp, { color: colors.networkUp }]}>
                    ↑ {formatSpeed(iface.tx_bps)}
                  </Text>
                </View>
              </View>

              <View style={styles.ifaceMetaRow}>
                {iface.mac ? (
                  <Text style={styles.ifaceMetaText}>MAC: {iface.mac.toUpperCase()}</Text>
                ) : null}
                <Text style={styles.ifaceMetaText}>
                  累计: ↓ {formatBytes(iface.rx_bytes)} · ↑ {formatBytes(iface.tx_bytes)}
                </Text>
              </View>
            </View>
          );
        })}
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
    dualSpeedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 16,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    speedBox: {
      flex: 1,
    },
    speedDivider: {
      width: StyleSheet.hairlineWidth,
      height: 36,
      backgroundColor: colors.divider,
      marginHorizontal: 12,
    },
    speedLabel: {
      fontSize: 11,
      fontWeight: '700',
    },
    speedNumber: {
      fontSize: 22,
      fontWeight: '900',
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
    containerCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
      marginBottom: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    containerHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    cIconBox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      backgroundColor: 'rgba(56, 189, 248, 0.15)',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
    },
    containerName: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textStrong,
      flex: 1,
    },
    netIoBadge: {
      fontSize: 11,
      fontWeight: '700',
      fontFamily: 'monospace',
      color: colors.text,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 6,
    },
    netDetailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 6,
    },
    netDetailCol: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    netDetailVal: {
      fontSize: 11,
      fontWeight: '600',
      fontFamily: 'monospace',
    },
    ifaceCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
      marginBottom: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    ifaceHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    stateDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      marginRight: 8,
    },
    ifaceName: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.textStrong,
      fontFamily: 'monospace',
      marginRight: 6,
    },
    ifaceTypeBadge: {
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    ifaceTypeText: {
      fontSize: 10,
      color: colors.sub,
      fontWeight: '600',
    },
    ifaceRatesBox: {
      alignItems: 'flex-end',
    },
    ifaceRateDown: {
      fontSize: 11,
      fontWeight: '700',
      fontFamily: 'monospace',
    },
    ifaceRateUp: {
      fontSize: 11,
      fontWeight: '700',
      fontFamily: 'monospace',
      marginTop: 1,
    },
    ifaceMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 8,
      paddingTop: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    ifaceMetaText: {
      fontSize: 10,
      color: colors.muted,
      fontFamily: 'monospace',
    },
    emptyCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 24,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    emptyText: {
      fontSize: 13,
      color: colors.sub,
    },
  });
}
