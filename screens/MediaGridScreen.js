import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, FlatList, Image, Alert, Dimensions, TextInput, Platform, Modal, ScrollView, RefreshControl } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Film, Search, ArrowUpDown, LogOut, Clock, Play, X, Server, User, Key, ChevronRight, ListVideo, Star } from 'lucide-react-native';

const { width } = Dimensions.get('window');
const POSTER_W = (width - 48) / 3;
const POSTER_H = POSTER_W * 1.5;
const PER_PAGE = 60;

const SORT_OPTIONS = [
  { id: 'SortName_Ascending', label: '名称 (A-Z)', sortBy: 'SortName', order: 'Ascending' },
  { id: 'SortName_Descending', label: '名称 (Z-A)', sortBy: 'SortName', order: 'Descending' },
  { id: 'PremiereDate_Descending', label: '年份 (新→旧)', sortBy: 'PremiereDate', order: 'Descending' },
  { id: 'PremiereDate_Ascending', label: '年份 (旧→新)', sortBy: 'PremiereDate', order: 'Ascending' },
  { id: 'CommunityRating_Descending', label: '评分 (高→低)', sortBy: 'CommunityRating', order: 'Descending' },
  { id: 'DateCreated_Descending', label: '最近添加', sortBy: 'DateCreated', order: 'Descending' },
];

function formatTime(millis) {
  if (!millis) return null;
  const s = Math.floor(millis / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function MediaGridScreen({ navigation }) {
  const [isConfigured, setIsConfigured] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');

  const [libraries, setLibraries] = useState([]);
  const [activeLibId, setActiveLibId] = useState('all');
  const [items, setItems] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [startIndex, setStartIndex] = useState(0);
  const [continueWatching, setContinueWatching] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [sortBy, setSortBy] = useState('SortName');
  const [sortOrder, setSortOrder] = useState('Ascending');
  const [showSortModal, setShowSortModal] = useState(false);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    loadSavedAuth();
    return () => { isMounted.current = false; };
  }, []);

  const loadSavedAuth = async () => {
    try {
      const [url, token, uid, uname] = await Promise.all([
        AsyncStorage.getItem('@emby_url'),
        AsyncStorage.getItem('@emby_token'),
        AsyncStorage.getItem('@emby_user_id'),
        AsyncStorage.getItem('@emby_user_name'),
      ]);
      if (url && token && uid) {
        setServerUrl(url); setAuthToken(token);
        setUserId(uid); setUserName(uname || '');
        setIsConfigured(true);
        await Promise.all([fetchLibraries(url, token, uid), fetchContinueWatching(url, token, uid)]);
        if (isMounted.current) setLoading(false);
      } else {
        if (isMounted.current) setLoading(false);
      }
    } catch (e) {
      if (isMounted.current) setLoading(false);
    }
  };

  const api = useCallback(async (path) => {
    const res = await fetch(`${serverUrl}${path}${path.includes('?') ? '&' : '?'}api_key=${authToken}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [serverUrl, authToken]);

  const apiItems = useCallback(async (path) => {
    const res = await fetch(`${serverUrl}${path}${path.includes('?') ? '&' : '?'}api_key=${authToken}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { items: data.Items || [], total: data.TotalRecordCount || 0 };
  }, [serverUrl, authToken]);

  const fetchLibraries = async (url, token, uid) => {
    try {
      const data = await fetch(`${url}/Users/${uid}/Views?api_key=${token}`).then(r => r.json());
      const libs = (data.Items || []).filter(l => l.CollectionType === 'movies' || l.CollectionType === 'tvshows' || !l.CollectionType);
      if (isMounted.current) {
        setLibraries(libs);
        if (libs.length > 0 && activeLibId === 'all') {
          await fetchItems('all', url, token, uid);
        }
      }
    } catch (e) {}
  };

  const fetchItems = async (libId, url = serverUrl, token = authToken, uid = userId, start = 0, append = false, search = '', sort = sortBy, order = sortOrder) => {
    try {
      let path = `/Users/${uid}/Items?Recursive=true&IncludeItemTypes=Movie,Series&SortBy=${sort}&SortOrder=${order}&Limit=${PER_PAGE}&StartIndex=${start}`;
      if (libId && libId !== 'all') path += `&ParentId=${libId}`;
      if (search.trim()) path += `&SearchTerm=${encodeURIComponent(search.trim())}`;
      const data = await fetch(`${url}${path}&api_key=${token}`).then(r => r.json());
      const newItems = data.Items || [];
      if (isMounted.current) {
        if (append) {
          setItems(prev => [...prev, ...newItems]);
        } else {
          setItems(newItems);
        }
        setTotalItems(data.TotalRecordCount || 0);
        setStartIndex(start + PER_PAGE);
      }
    } catch (e) {
      if (!append && isMounted.current) setItems([]);
    }
  };

  const fetchContinueWatching = async (url = serverUrl, token = authToken, uid = userId) => {
    try {
      const data = await fetch(`${url}/Users/${uid}/Items/Resume?Limit=20&api_key=${token}`).then(r => r.json());
      if (isMounted.current) setContinueWatching(data.Items || []);
    } catch (e) {}
  };

  const handleLogin = async () => {
     if (!serverUrl || !username || !password) return Alert.alert('提示', '请填写完整信息');
     setIsTesting(true);
     try {
       let baseUrl = serverUrl.trim().replace(/\/+$/, '');
       const res = await fetch(`${baseUrl}/Users/AuthenticateByName?format=json&username=${encodeURIComponent(username)}&pw=${encodeURIComponent(password)}`, {
         method: 'POST',
         headers: { 'X-Emby-Client': 'UnraidManager', 'X-Emby-Device-Name': 'Android', 'X-Emby-Client-Version': '1.1.57' },
       });
       if (!res.ok) {
         const text = await res.text();
         return Alert.alert('错误', `认证失败 (${res.status}): ${text.slice(0, 100)}`);
       }
      const data = await res.json();
      const token = data.AccessToken;
      const uid = data.User.Id;
      const uname = data.User.Name;
      await AsyncStorage.multiSet([
        ['@emby_url', baseUrl], ['@emby_token', token],
        ['@emby_user_id', uid], ['@emby_user_name', uname],
      ]);
      setServerUrl(baseUrl); setAuthToken(token);
      setUserId(uid); setUserName(uname);
      setIsConfigured(true);
      await Promise.all([fetchLibraries(baseUrl, token, uid), fetchContinueWatching(baseUrl, token, uid)]);
    } catch (e) {
      Alert.alert('错误', '无法连接服务器');
    } finally { setIsTesting(false); }
  };

  const handleLogout = () => {
    Alert.alert('注销', '确定退出登录吗？', [
      { text: '取消' }, { text: '注销', style: 'destructive', onPress: async () => {
        await AsyncStorage.multiRemove(['@emby_url', '@emby_token', '@emby_user_id', '@emby_user_name']);
        setIsConfigured(false); setItems([]); setLibraries([]); setContinueWatching([]); setActiveLibId('all');
      }}
    ]);
  };

  const handleTabSelect = (libId) => {
    setActiveLibId(libId);
    setItems([]);
    setStartIndex(0);
    setSearchQuery('');
    fetchItems(libId, serverUrl, authToken, userId, 0);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setStartIndex(0);
    await Promise.all([
      fetchContinueWatching(),
      fetchItems(activeLibId, serverUrl, authToken, userId, 0),
    ]);
    if (isMounted.current) setRefreshing(false);
  };

  const handleLoadMore = async () => {
    if (loadingMore || startIndex >= totalItems) return;
    setLoadingMore(true);
    await fetchItems(activeLibId, serverUrl, authToken, userId, startIndex, true);
    if (isMounted.current) setLoadingMore(false);
  };

  const handleSearch = (text) => {
    setSearchQuery(text);
    fetchItems(activeLibId, serverUrl, authToken, userId, 0, false, text);
  };

  const handleSortChange = (opt) => {
    setSortBy(opt.sortBy); setSortOrder(opt.order);
    setShowSortModal(false);
    fetchItems(activeLibId, serverUrl, authToken, userId, 0, false, searchQuery, opt.sortBy, opt.order);
  };

  const getImgUrl = (itemId, type = 'Primary', w = POSTER_W * 2) =>
    `${serverUrl}/Items/${itemId}/Images/${type}?api_key=${authToken}&width=${Math.round(w)}`;

  const formatRuntime = (ticks) => {
    if (!ticks) return '';
    const min = Math.round(ticks / 600000000);
    if (min >= 60) return `${Math.floor(min / 60)}h ${min % 60}m`;
    return `${min}m`;
  };

  const getResumePercent = (item) => {
    if (!item.UserData?.PlaybackPositionTicks || !item.RunTimeTicks) return 0;
    return (item.UserData.PlaybackPositionTicks / item.RunTimeTicks) * 100;
  };

  const sortLabel = SORT_OPTIONS.find(o => o.sortBy === sortBy && o.order === sortOrder)?.label || '排序';

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#3b82f6" /></View>;

  if (!isConfigured) {
    return (
      <View style={styles.center}>
        <View style={styles.setupCard}>
          <Film color="#3b82f6" size={48} style={{ alignSelf: 'center', marginBottom: 16 }} />
          <Text style={styles.setupTitle}>连接 Emby 服务器</Text>
          <View style={styles.inputBox}><Server color="#9ca3af" size={20} /><TextInput style={styles.input} placeholder="服务器地址 (含端口)" placeholderTextColor="#6b7280" value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" keyboardType="url" /></View>
          <View style={styles.inputBox}><User color="#9ca3af" size={20} /><TextInput style={styles.input} placeholder="用户名" placeholderTextColor="#6b7280" value={username} onChangeText={setUsername} autoCapitalize="none" /></View>
          <View style={styles.inputBox}><Key color="#9ca3af" size={20} /><TextInput style={styles.input} placeholder="密码" placeholderTextColor="#6b7280" value={password} onChangeText={setPassword} secureTextEntry /></View>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin}><Text style={styles.btnText}>{isTesting ? '连接中...' : '进入影音中心'}</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {isSearching ? (
          <View style={styles.searchBar}>
            <Search color="#9ca3af" size={20} />
            <TextInput style={styles.searchInput} placeholder="搜索影视..." placeholderTextColor="#6b7280" autoFocus value={searchQuery} onChangeText={handleSearch} />
            <TouchableOpacity onPress={() => { setIsSearching(false); setSearchQuery(''); handleTabSelect(activeLibId); }}><X color="#ffffff" size={24} /></TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>影音中心</Text>
              {userName ? <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>{userName}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => setIsSearching(true)} style={styles.iconBtn}><Search color="#ffffff" size={22} /></TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSortModal(true)} style={styles.iconBtn}><ArrowUpDown color="#ffffff" size={20} /></TouchableOpacity>
            <TouchableOpacity onPress={handleLogout} style={styles.iconBtn}><LogOut color="#ef4444" size={20} /></TouchableOpacity>
          </>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.Id}
        numColumns={3}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#3b82f6" />}
        ListHeaderComponent={
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={{ paddingHorizontal: 16 }}>
              <TouchableOpacity onPress={() => handleTabSelect('all')} style={[styles.tab, activeLibId === 'all' && styles.tabActive]}><Text style={[styles.tabText, activeLibId === 'all' && styles.tabTextActive]}>全部</Text></TouchableOpacity>
              {libraries.map(lib => (
                <TouchableOpacity key={lib.Id} onPress={() => handleTabSelect(lib.Id)} style={[styles.tab, activeLibId === lib.Id && styles.tabActive]}>
                  <Text style={[styles.tabText, activeLibId === lib.Id && styles.tabTextActive]}>{lib.Name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {continueWatching.length > 0 && !searchQuery && (
              <View style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 16, marginBottom: 10 }}>
                  <Clock color="#f59e0b" size={16} /><Text style={{ color: '#ffffff', fontSize: 15, fontWeight: 'bold', marginLeft: 6 }}>继续观看</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 16 }}>
                  {continueWatching.map(item => {
                    const percent = getResumePercent(item);
                    return (
                      <TouchableOpacity key={item.Id} style={{ width: 140, marginRight: 12 }} onPress={() => navigation.navigate('MediaDetail', { itemId: item.Id, type: item.Type, title: item.Name, imageUrl: getImgUrl(item.Id, 'Primary', 280) })}>
                        <Image source={{ uri: getImgUrl(item.Id, 'Primary', 280) }} style={{ width: 140, height: 80, borderRadius: 8, backgroundColor: '#374151' }} />
                        <View style={{ height: 3, backgroundColor: '#374151', width: '100%', marginTop: 4, borderRadius: 2, overflow: 'hidden' }}><View style={{ height: '100%', backgroundColor: '#f59e0b', width: `${Math.min(percent, 100)}%` }} /></View>
                        <Text style={{ color: '#e5e7eb', fontSize: 12, marginTop: 4, fontWeight: '500' }} numberOfLines={1}>{item.Name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
            {libraries.length === 0 && (
              <View style={styles.emptyLib}>
                <ListVideo color="#4b5563" size={48} />
                <Text style={{ color: '#9ca3af', marginTop: 12 }}>Emby 服务器中未找到媒体库</Text>
              </View>
            )}
          </>
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color="#3b82f6" style={{ padding: 20 }} /> : null}
        ListEmptyComponent={!loading && !refreshing ? (
          <View style={styles.emptyLib}>
            <Film color="#4b5563" size={48} />
            <Text style={{ color: '#9ca3af', marginTop: 12 }}>{searchQuery ? '没有找到匹配的影片' : '暂无内容'}</Text>
          </View>
        ) : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('MediaDetail', { itemId: item.Id, type: item.Type, title: item.Name, imageUrl: getImgUrl(item.Id, 'Primary', 300), backdropUrl: getImgUrl(item.Id, 'Backdrop', 800) })}>
            <View style={styles.posterWrap}>
              <Image source={{ uri: getImgUrl(item.Id, 'Primary', 300) }} style={styles.poster} />
              {item.Type === 'Series' && <View style={styles.seriesBadge}><Text style={styles.seriesBadgeText}>剧集</Text></View>}
              {item.UserData?.Played && <View style={styles.playedBadge}><Play color="#fff" size={10} fill="#fff" /></View>}
            </View>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.Name}</Text>
            <Text style={styles.cardSub}>
              {item.ProductionYear ? item.ProductionYear : ''}
              {item.RunTimeTicks ? ` · ${formatRuntime(item.RunTimeTicks)}` : ''}
            </Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 100 }}
        columnWrapperStyle={{ justifyContent: 'flex-start' }}
      />

      <Modal visible={showSortModal} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowSortModal(false)}>
          <View style={styles.sortPanel}>
            <Text style={{ color: '#9ca3af', fontSize: 13, marginBottom: 12, fontWeight: 'bold' }}>排序依据</Text>
            {SORT_OPTIONS.map(opt => {
              const active = sortBy === opt.sortBy && sortOrder === opt.order;
              return (
                <TouchableOpacity key={opt.id} style={[styles.sortItem, active && styles.sortItemActive]} onPress={() => handleSortChange(opt)}>
                  <Text style={{ color: active ? '#3b82f6' : '#e5e7eb', fontSize: 15, fontWeight: active ? 'bold' : 'normal' }}>{opt.label}</Text>
                  {active && <Star color="#3b82f6" size={18} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  center: { flex: 1, backgroundColor: '#111827', justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 55, backgroundColor: '#1f2937', minHeight: 100 },
  headerTitle: { color: '#ffffff', fontSize: 22, fontWeight: 'bold' },
  iconBtn: { marginLeft: 14 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#374151', borderRadius: 10, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, color: '#ffffff', marginLeft: 10, fontSize: 15 },
  setupCard: { backgroundColor: '#1f2937', borderRadius: 20, padding: 25, width: '100%' },
  setupTitle: { color: '#ffffff', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  inputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#374151', borderRadius: 10, marginBottom: 15, paddingHorizontal: 15 },
  input: { flex: 1, color: '#ffffff', height: 48, marginLeft: 10 },
  primaryBtn: { backgroundColor: '#3b82f6', padding: 15, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },
  tabRow: { marginVertical: 14 },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18, backgroundColor: '#1f2937', marginRight: 10, borderWidth: 1, borderColor: '#374151' },
  tabActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  tabText: { color: '#9ca3af', fontSize: 13, fontWeight: 'bold' },
  tabTextActive: { color: '#ffffff' },
  card: { width: POSTER_W, marginBottom: 16, marginRight: 12 },
  posterWrap: { borderRadius: 10, overflow: 'hidden', position: 'relative', elevation: 6, shadowColor: '#000' },
  poster: { width: POSTER_W, height: POSTER_H, backgroundColor: '#1f2937' },
  seriesBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(139, 92, 246, 0.9)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  seriesBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: 'bold' },
  playedBadge: { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(16, 185, 129, 0.9)', width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  cardTitle: { color: '#ffffff', fontSize: 12, marginTop: 6, fontWeight: '600' },
  cardSub: { color: '#6b7280', fontSize: 10, marginTop: 2 },
  emptyLib: { paddingTop: 80, alignItems: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  sortPanel: { backgroundColor: '#1f2937', borderRadius: 16, padding: 20, elevation: 10 },
  sortItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12, borderRadius: 8 },
  sortItemActive: { backgroundColor: 'rgba(59, 130, 246, 0.15)' },
});
