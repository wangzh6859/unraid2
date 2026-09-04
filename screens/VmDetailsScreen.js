import React, { useState, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Monitor, RotateCw, Play, Power } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';

export default function VmDetailsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [vms, setVms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortRule, setSortRule] = useState('name');

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

  const toggleVm = async (name, currentStatus) => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      const action = currentStatus === 'running' ? 'stop_vm' : 'start_vm';
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=${action}&target=${name}`);
      const result = await response.json();
      if (result.status === 'success') fetchVmData();
    } catch (error) { Alert.alert('失败', '网络异常'); }
  };

  const restartVm = async (name) => {
    Alert.alert('确认重启', `确定要重启虚拟机 ${name} 吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '重启', style: 'destructive', onPress: async () => {
          try {
            const savedUrl = await AsyncStorage.getItem('@server_url');
            const savedToken = await AsyncStorage.getItem('@api_token');
            const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=restart_vm&target=${name}`);
            const result = await response.json();
            if (result.status === 'success') fetchVmData();
          } catch (error) { Alert.alert('失败', '网络异常'); }
        }
      }
    ]);
  };

  const sortedVms = [...vms].sort((a, b) => {
    if (sortRule === 'status') return (a.status === 'running' ? -1 : 1) - (b.status === 'running' ? -1 : 1);
    return a.name.localeCompare(b.name);
  });

  if (loading && vms.length === 0) return <View style={styles.center}><ActivityIndicator size="large" color={colors.pink} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.sortBar}>
        <Text style={styles.sortLabel}>排序:</Text>
        <TouchableOpacity style={[styles.sortBtn, sortRule === 'name' && styles.sortBtnActive]} onPress={() => setSortRule('name')}><Text style={styles.sortBtnText}>名称</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.sortBtn, sortRule === 'status' && styles.sortBtnActive]} onPress={() => setSortRule('status')}><Text style={styles.sortBtnText}>状态</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {sortedVms.map((vm, index) => (
          <View key={index} style={styles.card}>
            <View style={styles.iconWrapper}><Monitor size={24} color={colors.pink} /></View>
            
            <View style={styles.infoContainer}>
              <Text style={styles.nameText} numberOfLines={1}>{vm.name}</Text>
              <Text style={[styles.statusText, { color: vm.status === 'running' ? colors.green : colors.red }]}>
                {vm.status === 'running' ? '运行中' : '已停止'}
              </Text>
            </View>

            <View style={styles.btnRow}>
              {vm.status === 'running' && (
                <TouchableOpacity onPress={() => restartVm(vm.name)} style={[styles.actionBtn, { backgroundColor: colors.purple }]}>
                  <RotateCw size={16} color="#ffffff" />
                </TouchableOpacity>
              )}
              <TouchableOpacity 
                onPress={() => toggleVm(vm.name, vm.status)} 
                style={[styles.actionBtn, { backgroundColor: vm.status === 'running' ? colors.red : colors.green }]}
              >
                {vm.status === 'running' ? <Power size={16} color="#ffffff" /> : <Play size={16} color="#ffffff" />}
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  sortBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sortLabel: { color: colors.sub, marginRight: 12, fontSize: 14 },
  sortBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.input, marginRight: 8 },
  sortBtnActive: { backgroundColor: colors.accent },
  sortBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  card: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12, alignItems: 'center' },
  iconWrapper: { width: 44, height: 44, backgroundColor: colors.input, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  infoContainer: { flex: 1, marginRight: 8 },
  nameText: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  statusText: { fontSize: 12, fontWeight: 'bold' },
  btnRow: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { width: 34, height: 34, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
});