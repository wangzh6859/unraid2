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
import {
  Wifi, ArrowDown, ArrowUp, Box, Globe, Shield, Activity,
  Layers, Network, Monitor, Terminal, ChevronRight
} from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import MetricsLineChart from '../components/MetricsLineChart';
import { apiFetchJson } from '../utils/apiClient';

function formatSpeed(bytesPerSec) {
  const n = typeof bytesPerSec === 'number' ? bytesPerSec : Number(bytesPerSec);
  if (!n || isNaN(n) || n <= 0 || !isFinite(n)) return '0 KB/s';
  const mb = n / (1024 * 1024);
  if (mb >= 100) return `${mb.toFixed(0)} MB/s`;
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = n / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

function formatBytes(bytes) {
  const n = typeof bytes === 'number' ? bytes : Number(bytes);
  if (!n || isNaN(n) || n <= 0 || !isFinite(n)) return '0 B';
  const gb = n / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = n / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = n / 1024;
  return `${kb.toFixed(0)} KB`;
}

export default function NetworkDetailsScreen({ navigation, route }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const initialNetSpeed = route?.params?.initialNetSpeed;
  const initialHistory = route?.params?.initialHistory;

  const [loading, setLoading] = useState(!initialNetSpeed);
  const [refreshing, setRefreshing] = useState(false);
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'docker' | 'vm' | 'process'

  const [currentSpeeds, setCurrentSpeeds] = useState({
    rx: initialNetSpeed?.down || initialNetSpeed?.rx || 0,
    tx: initialNetSpeed?.up || initialNetSpeed?.tx || 0,
  });

  const [networkData, setNetworkData] = useState({
    total_rx_bytes: 0,
    total_tx_bytes: 0,
    interfaces: [],
    top_processes: [],
  });
  const [dockers, setDockers] = useState([]);
  const [vms, setVms] = useState([]);
  const [history, setHistory] = useState(() => (Array.isArray(initialHistory) ? initialHistory : []));
  const prevNetRef = useRef({});
  const isFetchingRef = useRef(false);

  const fetchData = useCallback(async (isSilent = false, isRefresh = false) => {
    if (isFetchingRef.current && !isRefresh) return;
    isFetchingRef.current = true;
    try {
      if (!isSilent) setLoading(true);
      const host = (await AsyncStorage.getItem('@server_url')) || (await AsyncStorage.getItem('server_host'));
      const token = (await AsyncStorage.getItem('@api_token')) || (await AsyncStorage.getItem('api_token'));
      if (!host) return;

      const cleanHost = host.replace(/\/+$/, '');
      const detailUrl = `${cleanHost}/api.php?action=metrics_detail&type=network${isRefresh ? '&nocache=1' : ''}&token=${encodeURIComponent(token || '')}`;

      let json = null;
      try {
        json = await apiFetchJson(detailUrl, {}, 6000, 1);
      } catch (err) {
        // Fallback to action=status
        const fallbackUrl = `${cleanHost}/api.php?action=status&token=${encodeURIComponent(token || '')}`;
        json = await apiFetchJson(fallbackUrl, {}, 6000, 1);
      }

      if (!json) return;

      // Extract current live speeds
      let curRx = 0;
      let curTx = 0;
      if (json?.network_speed) {
        curRx = json.network_speed.down || json.network_speed.rx || 0;
        curTx = json.network_speed.up || json.network_speed.tx || 0;
      } else if (json?.network?.rx_bps !== undefined || json?.network?.tx_bps !== undefined) {
        curRx = json.network.rx_bps || 0;
        curTx = json.network.tx_bps || 0;
      } else if (Array.isArray(json?.network?.interfaces)) {
        json.network.interfaces.forEach(iface => {
          if (iface.is_physical || iface.name === 'br0' || iface.name === 'bond0') {
            curRx += iface.rx_bps || 0;
            curTx += iface.tx_bps || 0;
          }
        });
      }
      setCurrentSpeeds({ rx: curRx, tx: curTx });

      // Update network data
      if (json?.network) {
        setNetworkData(prev => ({
          ...prev,
          ...json.network,
          total_rx_bytes: json.network.total_rx_bytes ?? json.network.rx_bytes ?? prev.total_rx_bytes,
          total_tx_bytes: json.network.total_tx_bytes ?? json.network.tx_bytes ?? prev.total_tx_bytes,
          interfaces: Array.isArray(json.network.interfaces) ? json.network.interfaces : prev.interfaces,
          top_processes: Array.isArray(json.network.top_processes) ? json.network.top_processes : prev.top_processes,
        }));
      }

      // Update Dockers
      if (Array.isArray(json?.dockers)) {
        setDockers(json.dockers);
      } else if (Array.isArray(json?.dockers?.list)) {
        setDockers(json.dockers.list);
      }

      // Update VMs
      if (Array.isArray(json?.vms)) {
        setVms(json.vms);
      } else if (Array.isArray(json?.vms?.list)) {
        setVms(json.vms.list);
      }

      // Update History
      if (Array.isArray(json?.history) && json.history.length > 0) {
        setHistory(json.history);
      } else {
        setHistory(prev => {
          const next = [...prev, { t: Date.now(), rx: curRx, tx: curTx }];
          return next.slice(-150);
        });
      }
    } catch (e) {
      console.warn('[NetworkDetailsScreen] Fetch error:', e);
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
      }, 2000);
      return () => clearInterval(timer);
    }, [fetchData])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    isFetchingRef.current = false;
    try {
      await fetchData(true, true);
    } finally {
      setRefreshing(false);
    }
  }, [fetchData]);

  const rxPoints = useMemo(() => {
    if (history.length === 0) return [currentSpeeds.rx];
    return history.map(h => (typeof h.rx === 'number' ? h.rx : 0));
  }, [history, currentSpeeds.rx]);

  const txPoints = useMemo(() => {
    if (history.length === 0) return [currentSpeeds.tx];
    return history.map(h => (typeof h.tx === 'number' ? h.tx : 0));
  }, [history, currentSpeeds.tx]);

  // Combine and sort Docker containers, VMs, and processes by live real-time network speed
  const rankedItems = useMemo(() => {
    const list = [];
    const now = Date.now();
    const prevMap = prevNetRef.current || {};
    const newMap = {};

    // 1. Docker Containers
    (dockers || []).forEach(d => {
      if (!d || !d.name) return;
      const id = `docker-${d.name}`;
      const rxBytes = typeof d.net_rx_bytes === 'number' && !isNaN(d.net_rx_bytes) ? d.net_rx_bytes : 0;
      const txBytes = typeof d.net_tx_bytes === 'number' && !isNaN(d.net_tx_bytes) ? d.net_tx_bytes : 0;

      let rxBps = typeof d.net_rx_bps === 'number' && !isNaN(d.net_rx_bps) ? d.net_rx_bps : 0;
      let txBps = typeof d.net_tx_bps === 'number' && !isNaN(d.net_tx_bps) ? d.net_tx_bps : 0;

      if (prevMap[id] && typeof prevMap[id].time === 'number' && typeof prevMap[id].rx === 'number' && typeof prevMap[id].tx === 'number') {
        const dt = (now - prevMap[id].time) / 1000.0;
        if (dt >= 0.5 && dt <= 30.0) {
          const dRx = rxBytes - prevMap[id].rx;
          const dTx = txBytes - prevMap[id].tx;
          if (dRx >= 0 && (!rxBps || dRx > 0)) rxBps = Math.round(dRx / dt);
          if (dTx >= 0 && (!txBps || dTx > 0)) txBps = Math.round(dTx / dt);
        }
      }
      rxBps = typeof rxBps === 'number' && !isNaN(rxBps) && isFinite(rxBps) ? Math.max(0, rxBps) : 0;
      txBps = typeof txBps === 'number' && !isNaN(txBps) && isFinite(txBps) ? Math.max(0, txBps) : 0;
      newMap[id] = { rx: rxBytes, tx: txBytes, time: now };

      list.push({
        type: 'docker',
        id,
        name: d.name,
        rx_bps: rxBps,
        tx_bps: txBps,
        total_bps: rxBps + txBps,
        total_rx: rxBytes,
        total_tx: txBytes,
        rawStr: d.net_io_str || `${formatBytes(rxBytes)} / ${formatBytes(txBytes)}`,
        sub: `容器 · 累计: 接收 ${formatBytes(rxBytes)} · 发送 ${formatBytes(txBytes)}`,
        raw: d,
      });
    });

    // 2. VMs
    (vms || []).forEach(v => {
      if (!v || !v.name) return;
      const id = `vm-${v.name}`;
      const rxBytes = typeof v.net_rx_bytes === 'number' && !isNaN(v.net_rx_bytes) ? v.net_rx_bytes : 0;
      const txBytes = typeof v.net_tx_bytes === 'number' && !isNaN(v.net_tx_bytes) ? v.net_tx_bytes : 0;

      let rxBps = typeof v.net_rx_bps === 'number' && !isNaN(v.net_rx_bps) ? v.net_rx_bps : 0;
      let txBps = typeof v.net_tx_bps === 'number' && !isNaN(v.net_tx_bps) ? v.net_tx_bps : 0;

      if (prevMap[id] && typeof prevMap[id].time === 'number' && typeof prevMap[id].rx === 'number' && typeof prevMap[id].tx === 'number') {
        const dt = (now - prevMap[id].time) / 1000.0;
        if (dt >= 0.5 && dt <= 30.0) {
          const dRx = rxBytes - prevMap[id].rx;
          const dTx = txBytes - prevMap[id].tx;
          if (dRx >= 0 && (!rxBps || dRx > 0)) rxBps = Math.round(dRx / dt);
          if (dTx >= 0 && (!txBps || dTx > 0)) txBps = Math.round(dTx / dt);
        }
      }
      rxBps = typeof rxBps === 'number' && !isNaN(rxBps) && isFinite(rxBps) ? Math.max(0, rxBps) : 0;
      txBps = typeof txBps === 'number' && !isNaN(txBps) && isFinite(txBps) ? Math.max(0, txBps) : 0;
      newMap[id] = { rx: rxBytes, tx: txBytes, time: now };

      const isRunning = v.state === 'running';
      list.push({
        type: 'vm',
        id,
        name: v.name,
        rx_bps: isRunning ? rxBps : 0,
        tx_bps: isRunning ? txBps : 0,
        total_bps: isRunning ? (rxBps + txBps) : 0,
        total_rx: rxBytes,
        total_tx: txBytes,
        rawStr: `${formatBytes(rxBytes)} / ${formatBytes(txBytes)}`,
        sub: `虚拟机 (${isRunning ? '运行中' : '已关机'}) · 累计: 接收 ${formatBytes(rxBytes)} · 发送 ${formatBytes(txBytes)}`,
        raw: v,
      });
    });

    // 3. System Processes
    ((networkData && networkData.top_processes) || []).forEach(p => {
      if (!p || (!p.name && !p.pid)) return;
      const id = `proc-${p.pid || '0'}-${p.name || 'proc'}`;
      const rxBytes = typeof p.net_rx_bytes === 'number' && !isNaN(p.net_rx_bytes) ? p.net_rx_bytes : 0;
      const txBytes = typeof p.net_tx_bytes === 'number' && !isNaN(p.net_tx_bytes) ? p.net_tx_bytes : 0;

      let rxBps = typeof p.rx_bps === 'number' && !isNaN(p.rx_bps) ? p.rx_bps : 0;
      let txBps = typeof p.tx_bps === 'number' && !isNaN(p.tx_bps) ? p.tx_bps : 0;

      if (prevMap[id] && typeof prevMap[id].time === 'number' && typeof prevMap[id].rx === 'number' && typeof prevMap[id].tx === 'number') {
        const dt = (now - prevMap[id].time) / 1000.0;
        if (dt >= 0.5 && dt <= 30.0) {
          const dRx = rxBytes - prevMap[id].rx;
          const dTx = txBytes - prevMap[id].tx;
          if (dRx >= 0 && (!rxBps || dRx > 0)) rxBps = Math.round(dRx / dt);
          if (dTx >= 0 && (!txBps || dTx > 0)) txBps = Math.round(dTx / dt);
        }
      }
      rxBps = typeof rxBps === 'number' && !isNaN(rxBps) && isFinite(rxBps) ? Math.max(0, rxBps) : 0;
      txBps = typeof txBps === 'number' && !isNaN(txBps) && isFinite(txBps) ? Math.max(0, txBps) : 0;
      newMap[id] = { rx: rxBytes, tx: txBytes, time: now };

      list.push({
        type: 'process',
        id,
        name: p.name || `PID ${p.pid}`,
        pid: p.pid,
        rx_bps: rxBps,
        tx_bps: txBps,
        total_bps: rxBps + txBps,
        total_rx: rxBytes,
        total_tx: txBytes,
        rawStr: `${formatBytes(rxBytes)} / ${formatBytes(txBytes)}`,
        sub: `进程 PID ${p.pid || 'N/A'} · ${p.conns || 1} 个活跃连接 · ${p.command || p.name || '未知命令'}`,
        raw: p,
      });
    });

    prevNetRef.current = newMap;

    // Filter
    let filtered = list;
    if (filterTab === 'docker') filtered = list.filter(i => i.type === 'docker');
    else if (filterTab === 'vm') filtered = list.filter(i => i.type === 'vm');
    else if (filterTab === 'process') filtered = list.filter(i => i.type === 'process');

    // Sort: highest live rate first! Secondary sort by cumulative traffic
    return filtered.sort((a, b) => {
      const aTotal = typeof a.total_bps === 'number' && !isNaN(a.total_bps) ? a.total_bps : 0;
      const bTotal = typeof b.total_bps === 'number' && !isNaN(b.total_bps) ? b.total_bps : 0;
      if (bTotal !== aTotal) {
        return bTotal - aTotal;
      }
      const aCum = (a.total_rx || 0) + (a.total_tx || 0);
      const bCum = (b.total_rx || 0) + (b.total_tx || 0);
      return bCum - aCum;
    });
  }, [dockers, vms, networkData.top_processes, filterTab]);

  const maxTotalBps = useMemo(() => {
    const vals = rankedItems.map(i => i.total_bps).filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v) && v > 0);
    return vals.length > 0 ? Math.max(...vals, 1024) : 1024;
  }, [rankedItems]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.networkDown}
          colors={[colors.networkDown]}
        />
      }
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

      {/* Program / Container / VM Live Network Breakdown */}
      <View style={{ marginTop: 20 }}>
        <View style={styles.sectionHeader}>
          <Layers size={16} color={colors.networkDown} style={{ marginRight: 6 }} />
          <Text style={styles.sectionTitle}>程序与容器当前实时网络占用</Text>
          <Text style={styles.sectionCount}>({rankedItems.length})</Text>
        </View>

        {/* Segmented Filter Tabs */}
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

        {rankedItems.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>当前分类暂无活跃网络占用程序</Text>
          </View>
        ) : (
          rankedItems.map((item, idx) => {
            const isDocker = item.type === 'docker';
            const isVm = item.type === 'vm';
            const hasRate = item.total_bps > 0;
            const barWidth = hasRate
              ? `${Math.min(100, Math.max(6, (item.total_bps / maxTotalBps) * 100))}%`
              : '0%';

            return (
              <View key={item.id || idx} style={styles.itemCard}>
                <View style={styles.itemHeaderRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
                    <View style={[styles.typeIconBox, {
                      backgroundColor: isDocker ? 'rgba(56, 189, 248, 0.15)' :
                                       isVm ? 'rgba(168, 85, 247, 0.15)' :
                                       'rgba(16, 185, 129, 0.15)'
                    }]}>
                      {isDocker ? <Box size={13} color="#38bdf8" /> :
                       isVm ? <Monitor size={13} color="#a855f7" /> :
                       <Terminal size={13} color="#10b981" />}
                    </View>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <View style={[styles.typeBadge, {
                      backgroundColor: isDocker ? 'rgba(56, 189, 248, 0.12)' :
                                       isVm ? 'rgba(168, 85, 247, 0.12)' :
                                       'rgba(16, 185, 129, 0.12)'
                    }]}>
                      <Text style={[styles.typeBadgeText, {
                        color: isDocker ? '#38bdf8' :
                               isVm ? '#a855f7' :
                               '#10b981'
                      }]}>
                        {isDocker ? 'Docker' : isVm ? '虚拟机' : '系统进程'}
                      </Text>
                    </View>
                  </View>

                  {/* Combined Live Speed Pill */}
                  <View style={[styles.speedPill, {
                    backgroundColor: hasRate ? 'rgba(34, 197, 94, 0.14)' : (isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)')
                  }]}>
                    <Text style={[styles.speedPillText, {
                      color: hasRate ? colors.networkDown : colors.sub
                    }]}>
                      {formatSpeed(item.total_bps)}
                    </Text>
                  </View>
                </View>

                {/* Dual Speeds: Live Download & Live Upload */}
                <View style={styles.liveSpeedsRow}>
                  <View style={styles.liveSpeedCol}>
                    <ArrowDown size={11} color={item.rx_bps > 0 ? colors.networkDown : colors.muted} style={{ marginRight: 3 }} />
                    <Text style={[styles.liveSpeedLabel, { color: colors.sub }]}>实时下载:</Text>
                    <Text style={[styles.liveSpeedVal, { color: item.rx_bps > 0 ? colors.networkDown : colors.sub }]}>
                      {formatSpeed(item.rx_bps)}
                    </Text>
                  </View>
                  <View style={[styles.liveSpeedCol, { marginLeft: 12 }]}>
                    <ArrowUp size={11} color={item.tx_bps > 0 ? colors.networkUp : colors.muted} style={{ marginRight: 3 }} />
                    <Text style={[styles.liveSpeedLabel, { color: colors.sub }]}>实时上传:</Text>
                    <Text style={[styles.liveSpeedVal, { color: item.tx_bps > 0 ? colors.networkUp : colors.sub }]}>
                      {formatSpeed(item.tx_bps)}
                    </Text>
                  </View>
                </View>

                {/* Live Activity Progress Bar */}
                {hasRate && (
                  <View style={styles.liveSpeedBarTrack}>
                    <View style={[styles.liveSpeedBarFill, { width: barWidth, backgroundColor: colors.networkDown }]} />
                  </View>
                )}

                {/* Subtitle Information */}
                <Text style={styles.itemSub} numberOfLines={1}>
                  {item.sub}
                </Text>
              </View>
            );
          })
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
          if (!iface) return null;
          const ifName = iface.name || `iface-${idx}`;
          const isUp = iface.state === 'up';
          const typeName = iface.is_physical
            ? '物理网卡'
            : ifName.startsWith('br')
            ? '桥接虚拟网卡'
            : ifName.startsWith('bond')
            ? '链路聚合 (Bond)'
            : ifName.startsWith('wg')
            ? 'WireGuard 隧道'
            : '容器虚拟网桥';

          return (
            <View key={ifName} style={styles.ifaceCard}>
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
    tabsRow: {
      flexDirection: 'row',
      marginBottom: 10,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
      borderRadius: 10,
      padding: 3,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
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
      color: colors.networkDown,
      fontWeight: '700',
    },
    itemCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
      marginBottom: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    itemHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    typeIconBox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
    },
    itemName: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textStrong,
      flexShrink: 1,
    },
    typeBadge: {
      marginLeft: 6,
      paddingHorizontal: 5,
      paddingVertical: 1.5,
      borderRadius: 4,
    },
    typeBadgeText: {
      fontSize: 10,
      fontWeight: '700',
    },
    speedPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    speedPillText: {
      fontSize: 11,
      fontWeight: '700',
      fontFamily: 'monospace',
    },
    liveSpeedsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
    },
    liveSpeedCol: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    liveSpeedLabel: {
      fontSize: 11,
      fontWeight: '600',
      marginRight: 4,
    },
    liveSpeedVal: {
      fontSize: 11,
      fontWeight: '700',
      fontFamily: 'monospace',
    },
    liveSpeedBarTrack: {
      height: 3,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
      borderRadius: 2,
      overflow: 'hidden',
      marginTop: 8,
    },
    liveSpeedBarFill: {
      height: '100%',
      borderRadius: 2,
    },
    itemSub: {
      fontSize: 10,
      color: colors.muted,
      marginTop: 6,
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
