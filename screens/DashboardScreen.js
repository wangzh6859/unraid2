import React, { useState, useCallback, useRef, useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, RefreshControl, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Cpu, Database, HardDrive, Box, Monitor, Wifi, Zap, Server, Key } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../ThemeContext';

export default function DashboardScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // 核心状态：是否已配置 Unraid 信息
  const [isConfigured, setIsConfigured] = useState(true);

  // 登录表单状态
  const [inputUrl, setInputUrl] = useState('');
  const [inputToken, setInputToken] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  // 仪表盘状态
  const [refreshing, setRefreshing] = useState(false);
  const [serverStatus, setServerStatus] = useState('offline');
  const [stats, setStats] = useState({ cpu: 0, memory: 0 });
  const [gpu, setGpu] = useState({ name: 'N/A', usage: 0 });
  const [storage, setStorage] = useState({ percentage: 0, total_used: 0, total_size: 0 });
  const [dockers, setDockers] = useState({ running: 0, total: 0, list: [] });
  const [vms, setVms] = useState({ running: 0, total: 0, list: [] });
  const prevNetwork = useRef({ rx: 0, tx: 0, time: 0 });
  const [netSpeed, setNetSpeed] = useState({ down: 0, up: 0 });

  // 💡 核心检查逻辑
  const fetchServerData = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');

      // 如果没有钥匙，立刻显示配置表单！
      if (!savedUrl || !savedToken) {
        setIsConfigured(false);
        return;
      }
      setIsConfigured(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=status`, { signal: controller.signal });
      clearTimeout(timeoutId);

      const data = await response.json();
      setServerStatus('online');
      if (data.stats) setStats(data.stats);
      if (data.gpu) setGpu(data.gpu);
      if (data.storage) setStorage(data.storage);
      if (data.dockers) setDockers(data.dockers);
      if (data.vms) setVms(data.vms);
      if (data.network) {
        const now = Date.now();
        if (prevNetwork.current.time > 0) {
          const timeDiff = (now - prevNetwork.current.time) / 1000;
          const rxDiff = data.network.rx_bytes - prevNetwork.current.rx;
          const txDiff = data.network.tx_bytes - prevNetwork.current.tx;
          if (timeDiff > 0 && rxDiff >= 0 && txDiff >= 0) {
            setNetSpeed({ down: (rxDiff / timeDiff / 1024).toFixed(1), up: (txDiff / timeDiff / 1024).toFixed(1) });
          }
        }
        prevNetwork.current = { rx: data.network.rx_bytes, tx: data.network.tx_bytes, time: now };
      }
    } catch (error) {
      setServerStatus('offline');
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchServerData();
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchServerData();
      const interval = setInterval(() => fetchServerData(), 2000);
      return () => clearInterval(interval);
    }, [])
  );

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (kb) => {
    const n = parseFloat(kb) || 0;
    return n > 1024 ? (n / 1024).toFixed(1) + ' MB/s' : n.toFixed(1) + ' KB/s';
  };

  // 💡 新增：处理登录并保存配置
  const handleSaveConfig = async () => {
    if (!inputUrl || !inputToken) {
      Alert.alert('提示', '请完整填写服务器地址和 API Token');
      return;
    }

    let cleanUrl = inputUrl.trim();
    if (!cleanUrl.startsWith('http')) cleanUrl = 'http://' + cleanUrl;
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);

    setIsTesting(true);
    try {
      const response = await fetch(`${cleanUrl}/api.php?token=${inputToken.trim()}&action=status`);
      if (response.ok) {
        await AsyncStorage.setItem('@server_url', cleanUrl);
        await AsyncStorage.setItem('@api_token', inputToken.trim());
        Alert.alert('连接成功', '已接入 Unraid 服务器！');
        setIsConfigured(true);
        fetchServerData(); // 立刻拉取数据
      } else {
        Alert.alert('连接失败', '服务器无响应或 Token 错误');
      }
    } catch (error) {
      Alert.alert('网络错误', '无法连接到指定的服务器地址');
    } finally {
      setIsTesting(false);
    }
  };

  // ==========================================
  // 状态 A：未配置时，渲染登录表单
  // ==========================================
  if (!isConfigured) {
    return (
      <KeyboardAvoidingView style={styles.center} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.setupCard}>
          <Server color={colors.accent} size={48} style={{ alignSelf: 'center', marginBottom: 16 }} />
          <Text style={styles.setupTitle}>连接 Unraid</Text>
          <Text style={styles.setupSub}>请输入主服务器的 API 访问凭证</Text>

          <View style={styles.inputContainer}>
            <Server color={colors.sub} size={20} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="http://192.168.x.x"
              placeholderTextColor={colors.muted}
              value={inputUrl}
              onChangeText={setInputUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>

          <View style={styles.inputContainer}>
            <Key color={colors.sub} size={20} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="API Token 密钥"
              placeholderTextColor={colors.muted}
              value={inputToken}
              onChangeText={setInputToken}
              secureTextEntry={true}
            />
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveConfig} disabled={isTesting}>
            {isTesting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveBtnText}>接入控制台</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ==========================================
  // 状态 B：已配置时，渲染仪表盘
  // ==========================================
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      <View style={styles.headerRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={[styles.statusIndicator, { backgroundColor: serverStatus === 'online' ? colors.green : colors.red }]} />
          <Text style={styles.headerText}>Unraid Server</Text>
        </View>
      </View>

      <View style={styles.gridRow}>
        <View style={[styles.card, styles.gridCard, { marginRight: 8 }]}>
          <View style={styles.cardHeader}><Cpu color={colors.amber} size={20} /><Text style={styles.cardTitle}>CPU</Text></View>
          <Text style={styles.mainNumber}>{stats.cpu}%</Text>
          <View style={styles.miniTrack}>
            <View style={[styles.miniBar, { width: `${stats.cpu}%`, backgroundColor: stats.cpu > 80 ? colors.red : colors.amber }]} />
          </View>
        </View>
        <View style={[styles.card, styles.gridCard, { marginLeft: 8 }]}>
          <View style={styles.cardHeader}><Zap color={colors.purple} size={20} /><Text style={styles.cardTitle}>GPU</Text></View>
          <Text style={styles.mainNumber}>{gpu.usage}%</Text>
          <Text style={styles.subText} numberOfLines={1}>{gpu.name}</Text>
        </View>
      </View>

      <View style={styles.gridRow}>
        <View style={[styles.card, styles.gridCard, { marginRight: 8 }]}>
          <View style={styles.cardHeader}><Database color={colors.green} size={20} /><Text style={styles.cardTitle}>内存</Text></View>
          <Text style={styles.mainNumber}>{stats.memory}%</Text>
          <View style={styles.miniTrack}>
            <View style={[styles.miniBar, { width: `${stats.memory}%`, backgroundColor: stats.memory > 80 ? colors.red : colors.green }]} />
          </View>
        </View>
        <View style={[styles.card, styles.gridCard, { marginLeft: 8 }]}>
          <View style={styles.cardHeader}><Wifi color={colors.accent} size={20} /><Text style={styles.cardTitle}>网络</Text></View>
          <Text style={styles.subText}>↓ {formatSpeed(netSpeed.down)}</Text>
          <Text style={styles.subText}>↑ {formatSpeed(netSpeed.up)}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('存储详情')}>
        <View style={styles.cardHeader}><HardDrive color={colors.green} size={24} /><Text style={styles.cardTitle}>阵列存储</Text></View>
        <Text style={styles.mainNumber}>{storage.percentage}%</Text>
        <Text style={styles.subText}>已用 {formatBytes(storage.total_used)} / 总共 {formatBytes(storage.total_size)}</Text>
        <View style={[styles.track, { marginTop: 12 }]}><View style={[styles.bar, { width: `${storage.percentage}%`, backgroundColor: storage.percentage > 80 ? colors.red : colors.green }]} /></View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Docker详情')}>
        <View style={styles.cardHeader}><Box color={colors.accent} size={24} /><Text style={styles.cardTitle}>Docker 容器</Text></View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>运行中: <Text style={{ color: colors.green, fontWeight: 'bold' }}>{dockers.running}</Text></Text>
          <Text style={styles.summaryText}>总计: {dockers.total}</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('VM详情')}>
        <View style={styles.cardHeader}><Monitor color={colors.pink} size={24} /><Text style={styles.cardTitle}>虚拟机 (VM)</Text></View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>运行中: <Text style={{ color: colors.green, fontWeight: 'bold' }}>{vms.running}</Text></Text>
          <Text style={styles.summaryText}>总计: {vms.total}</Text>
        </View>
      </TouchableOpacity>
    </ScrollView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 20 },
  setupCard: { backgroundColor: colors.card, borderRadius: 16, padding: 24, elevation: 5 },
  setupTitle: { color: colors.textStrong, fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  setupSub: { color: colors.sub, fontSize: 13, textAlign: 'center', marginBottom: 24 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderRadius: 8, marginBottom: 16, paddingHorizontal: 12 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: colors.textStrong, height: 50, fontSize: 16 },
  saveBtn: { backgroundColor: colors.accent, height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },

  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40, paddingTop: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, paddingHorizontal: 4 },
  statusIndicator: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  headerText: { color: colors.textStrong, fontSize: 22, fontWeight: 'bold' },
  gridRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  gridCard: { flex: 1, marginBottom: 0 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 20, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardTitle: { color: colors.textStrong, fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  mainNumber: { color: colors.textStrong, fontSize: 28, fontWeight: 'bold', marginBottom: 4 },
  subText: { color: colors.sub, fontSize: 13 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  summaryText: { color: colors.text, fontSize: 16 },
  track: { height: 8, backgroundColor: colors.input, borderRadius: 4, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  miniTrack: { height: 6, backgroundColor: colors.input, borderRadius: 3, marginTop: 12, overflow: 'hidden' },
  miniBar: { height: '100%', borderRadius: 3 },
});