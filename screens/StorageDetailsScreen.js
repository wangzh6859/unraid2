import React, { useState, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { HardDrive, Server, ThumbsUp, ThumbsDown, Thermometer, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';

export default function StorageDetailsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [disks, setDisks] = useState([]);
  const [loading, setLoading] = useState(true);

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
    } catch (error) { console.log(error); } finally { setLoading(false); }
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {disks.length === 0 ? (
        <View style={styles.center}><Text style={styles.emptyText}>未找到物理磁盘</Text></View>
      ) : (
        disks.map((disk, index) => {
          const isCache = disk.name.toLowerCase().includes('cache');
          const isSmartError = disk.smart_status !== 'Normal'; // 判断 SMART 是否报错
          const isStandby = disk.status === 'standby';

          return (
            <TouchableOpacity 
              key={index} 
              style={[styles.card, isSmartError && styles.cardError]}
              onPress={() => navigation.navigate('SMART详情', { device: disk.device, name: disk.name })}
            >
              {/* 第一行：设备名称 和 容量总览 */}
              <View style={styles.cardHeader}>
                <View style={styles.titleRow}>
                  {isCache ? <Server size={20} color={colors.accent} /> : <HardDrive size={20} color={isSmartError ? colors.red : colors.green} />}
                  <Text style={styles.diskName}>{disk.name}</Text>
                  <Text style={styles.deviceLabel}>({disk.device})</Text>
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
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={styles.usageText}>利用率: {disk.percentage}%</Text>
                  <Text style={styles.usageText}>{formatBytes(disk.used)} / {formatBytes(disk.total)}</Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.bar, { width: `${disk.percentage}%`, backgroundColor: disk.percentage > 85 ? colors.red : (isCache ? colors.accent : colors.green) }]} />
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: colors.sub, fontSize: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.divider },
  cardError: { borderColor: colors.red, backgroundColor: 'rgba(239, 68, 68, 0.10)' }, // 报错时卡片变红
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  diskName: { color: colors.textStrong, fontSize: 18, fontWeight: 'bold' },
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
});