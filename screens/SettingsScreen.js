import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Switch } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants'; // 💡 引入动态变量库，用于获取真实版本号
import { X, HardDrive, Settings as SettingsIcon, ShieldCheck, Info, Server, LogOut, Moon, Sun } from 'lucide-react-native';

export default function SettingsScreen({ navigation }) {
  const [cacheSize, setCacheSize] = useState('计算中...');
  const [isClearing, setIsClearing] = useState(false);
  
  // 新增设置状态
  const [unraidUrl, setUnraidUrl] = useState('未连接');
  const [isDarkMode, setIsDarkMode] = useState(true);

  // 💡 动态获取 app.json 中的真实版本号，获取不到则默认 1.0.0
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getCacheSize = async () => {
    try {
      const cacheDir = FileSystem.cacheDirectory;
      const files = await FileSystem.readDirectoryAsync(cacheDir);
      let totalSize = 0;
      for (const file of files) {
        const fileInfo = await FileSystem.getInfoAsync(cacheDir + file);
        if (!fileInfo.isDirectory && fileInfo.size) totalSize += fileInfo.size;
      }
      setCacheSize(formatBytes(totalSize));
    } catch (error) { setCacheSize('0 B'); }
  };

  // 💡 加载用户的各类配置
  const loadSettings = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      if (savedUrl) setUnraidUrl(savedUrl);
      
      const theme = await AsyncStorage.getItem('@app_theme');
      if (theme !== null) setIsDarkMode(theme === 'dark');
    } catch (e) { console.log(e); }
  };

  useFocusEffect(
    useCallback(() => {
      getCacheSize();
      loadSettings();
    }, [])
  );

  const clearCache = async () => {
    Alert.alert('清理缓存', '确定要清除所有预览图片和临时垃圾文件吗？', [
      { text: '取消', style: 'cancel' },
      { 
        text: '彻底清除', style: 'destructive', 
        onPress: async () => {
          setIsClearing(true);
          try {
            const cacheDir = FileSystem.cacheDirectory;
            const files = await FileSystem.readDirectoryAsync(cacheDir);
            for (const file of files) await FileSystem.deleteAsync(cacheDir + file, { idempotent: true });
            await getCacheSize();
            Alert.alert('清理完成', '存储空间已释放！');
          } catch (error) { Alert.alert('清理失败', error.message); } 
          finally { setIsClearing(false); }
        } 
      }
    ]);
  };

  // 💡 断开 Unraid 服务器连接
  const handleUnraidLogout = () => {
    Alert.alert('注销主服务器', '确定要断开与当前 Unraid 系统的连接吗？\n(这不会影响您的 WebDAV 和影音配置)', [
      { text: '取消', style: 'cancel' },
      { 
        text: '断开连接', style: 'destructive', 
        onPress: async () => {
          await AsyncStorage.removeItem('@server_url');
          await AsyncStorage.removeItem('@api_token');
          setUnraidUrl('未连接');
          // 跳转回首页，触发仪表盘的重新登录逻辑
          navigation.navigate('首页'); 
        } 
      }
    ]);
  };

  // 💡 切换主题
  const toggleTheme = async (value) => {
    setIsDarkMode(value);
    await AsyncStorage.setItem('@app_theme', value ? 'dark' : 'light');
    Alert.alert('提示', '主题偏好已保存！\n全局浅色模式的 UI 适配正在开发中，当前仅保存您的开关状态。');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      
      <View style={styles.header}>
        <SettingsIcon color="#3b82f6" size={48} style={{ marginBottom: 12 }} />
        <Text style={styles.title}>系统设置</Text>
        {/* 💡 显示真实的动态版本号 */}
        <Text style={styles.subtitle}>Version {appVersion}</Text>
      </View>

      {/* 💡 新增：Unraid 服务器管理面板 */}
      <Text style={styles.sectionTitle}>主控服务器</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}><Server color="#3b82f6" size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>当前连接地址</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{unraidUrl}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={handleUnraidLogout}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}><LogOut color="#ef4444" size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={[styles.rowTitle, { color: '#ef4444' }]}>注销并重新配置</Text>
            <Text style={styles.rowSub}>清除 API 令牌并返回登录页</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* 💡 新增：外观设置面板 */}
      <Text style={styles.sectionTitle}>外观与个性化</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: isDarkMode ? 'rgba(139, 92, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)' }]}>
            {isDarkMode ? <Moon color="#8b5cf6" size={20} /> : <Sun color="#f59e0b" size={20} />}
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>深色模式</Text>
            <Text style={styles.rowSub}>开启沉浸式护眼体验</Text>
          </View>
          <Switch 
            value={isDarkMode} 
            onValueChange={toggleTheme} 
            trackColor={{ false: '#374151', true: '#8b5cf6' }}
            thumbColor={'#ffffff'}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>存储管理</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconBox}><HardDrive color="#10b981" size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>本地缓存占用</Text>
            <Text style={styles.rowSub}>预览图片与临时文件</Text>
          </View>
          <Text style={styles.valueText}>{cacheSize}</Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={clearCache} disabled={isClearing}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
            {isClearing ? <ActivityIndicator color="#ef4444" size="small" /> : <X color="#ef4444" size={20} />}
          </View>
          <View style={styles.infoBox}>
            <Text style={[styles.rowTitle, { color: '#ef4444' }]}>一键清理缓存</Text>
            <Text style={styles.rowSub}>释放手机存储空间</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>安全与底层协议</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}><ShieldCheck color="#3b82f6" size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>原生沙盒隔离 (SAF)</Text>
            <Text style={styles.rowSub}>已开启·按需授权访问</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}><Info color="#f59e0b" size={20} /></View>
          <View style={styles.infoBox}>
            <Text style={styles.rowTitle}>文件系统</Text>
            <Text style={styles.rowSub}>PROPFIND & HTTP Basic Auth</Text>
          </View>
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  content: { padding: 16, paddingBottom: 40 },
  header: { alignItems: 'center', marginVertical: 30 },
  title: { color: '#ffffff', fontSize: 24, fontWeight: 'bold' },
  subtitle: { color: '#6b7280', fontSize: 14, marginTop: 4 },
  
  sectionTitle: { color: '#9ca3af', fontSize: 14, fontWeight: 'bold', marginLeft: 8, marginBottom: 8, marginTop: 16 },
  card: { backgroundColor: '#1f2937', borderRadius: 16, overflow: 'hidden', elevation: 3 },
  
  row: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(16, 185, 129, 0.15)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  infoBox: { flex: 1, justifyContent: 'center' },
  rowTitle: { color: '#e5e7eb', fontSize: 16, fontWeight: '500', marginBottom: 4 },
  rowSub: { color: '#6b7280', fontSize: 13 },
  valueText: { color: '#10b981', fontSize: 16, fontWeight: 'bold' },
  
  divider: { height: 1, backgroundColor: '#374151', marginLeft: 72 },
});