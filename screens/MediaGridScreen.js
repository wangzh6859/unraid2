import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, FlatList, Image, Alert, Dimensions, TextInput, Modal, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import base64 from 'base-64';
import { XMLParser } from 'fast-xml-parser';
import { Film, Plus, X, Trash2, Play, FolderOpen, ChevronLeft, Star, Server, User, Key, ChevronRight, LogOut } from 'lucide-react-native';

const { width } = Dimensions.get('window');
const POSTER_W = (width - 48) / 3;
const POSTER_H = POSTER_W * 1.5;

const LIB_TYPES = [
  { id: 'movie', label: '电影' },
  { id: 'tv', label: '电视剧' },
  { id: 'anime', label: '动漫' },
  { id: 'other', label: '其他' },
];

const nfe = (v, d) => v !== undefined && v !== null && v !== '' ? v : d;

export default function MediaGridScreen({ navigation }) {
  const [view, setView] = useState('loading');
  const [davUrl, setDavUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const [libraries, setLibraries] = useState([]);
  const [showAddLib, setShowAddLib] = useState(false);
  const [newLibName, setNewLibName] = useState('');
  const [newLibType, setNewLibType] = useState('movie');
  const [newLibPath, setNewLibPath] = useState('');

  const [activeLib, setActiveLib] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tvShow, setTvShow] = useState(null);
  const [episodes, setEpisodes] = useState([]);

  const origin = davUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || '';
  const davPath = davUrl.match(/^(https?:\/\/[^\/]+)(.*)$/)?.[2]?.replace(/\/+$/, '') || '';

  const authHeader = () => 'Basic ' + base64.encode(`${username}:${password}`);

  useEffect(() => { loadSaved(); }, []);

  const loadSaved = async () => {
    try {
      const [url, user, pass, libs] = await Promise.all([
        AsyncStorage.getItem('@dav_url'),
        AsyncStorage.getItem('@dav_user'),
        AsyncStorage.getItem('@dav_pass'),
        AsyncStorage.getItem('@media_libs'),
      ]);
      if (url && user && pass) {
        setDavUrl(url); setUsername(user); setPassword(pass);
        if (libs) setLibraries(JSON.parse(libs));
        setIsConnected(true);
        setView('manager');
      } else {
        setView('login');
      }
    } catch (e) { setView('login'); }
  };

  const handleLogin = async () => {
    if (!davUrl || !username || !password) return Alert.alert('提示', '请填写完整信息');
    let cleanUrl = davUrl.trim();
    if (!cleanUrl.endsWith('/')) cleanUrl += '/';
    setIsTesting(true);
    try {
      const headers = { 'Authorization': authHeader(), 'Depth': '1', 'Content-Type': 'application/xml' };
      let response = await fetch(cleanUrl, { method: 'PROPFIND', headers });
      if (response.status === 405 && !cleanUrl.endsWith('/dav/')) {
        const alistUrl = cleanUrl + 'dav/';
        const retry = await fetch(alistUrl, { method: 'PROPFIND', headers });
        if (retry.status === 200 || retry.status === 207) {
          response = retry;
          cleanUrl = alistUrl;
        }
      }
      if (response.status === 200 || response.status === 207) {
        await AsyncStorage.multiSet([
          ['@dav_url', cleanUrl], ['@dav_user', username], ['@dav_pass', password],
        ]);
        setDavUrl(cleanUrl);
        setIsConnected(true);
        setView('manager');
      } else {
        Alert.alert('连接失败', `状态码: ${response.status}`);
      }
    } catch (e) {
      Alert.alert('网络错误', '无法连接');
    } finally { setIsTesting(false); }
  };

  const propfind = async (targetPath) => {
    const url = origin + targetPath;
    const res = await fetch(url, {
      method: 'PROPFIND',
      headers: { 'Authorization': authHeader(), 'Depth': '1', 'Content-Type': 'application/xml' },
    });
    const xml = await res.text();
    const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
    const result = parser.parse(xml);
    let responses = result?.multistatus?.response;
    if (!responses) return [];
    if (!Array.isArray(responses)) responses = [responses];
    const entries = [];
    const normPath = targetPath.replace(/\/+$/, '') + '/';
    for (const r of responses) {
      let href = r.href;
      if (href.startsWith('http')) href = href.replace(/^https?:\/\/[^\/]+/, '');
      if (href === targetPath.replace(/\/+$/, '') || href === normPath) continue;
      const props = r.propstat?.prop || (Array.isArray(r.propstat) ? r.propstat[0].prop : {});
      const isDir = props.resourcetype && props.resourcetype.collection === '';
      const name = nfe(props.displayname, decodeURIComponent(href.split('/').filter(Boolean).pop() || ''));
      if (!name || name.startsWith('.')) continue;
      entries.push({ name, href, isDir });
    }
    entries.sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1);
    return entries;
  };

  const readFile = async (filePath) => {
    try {
      const res = await fetch(origin + filePath, { headers: { 'Authorization': authHeader() } });
      if (!res.ok) return null;
      return await res.text();
    } catch (e) { return null; }
  };

  const parseMovieNfo = (xml) => {
    if (!xml) return {};
    const title = xml.match(/<title>(.+?)<\/title>/)?.[1]?.trim() || '';
    const plot = xml.match(/<plot>(.+?)<\/plot>/)?.[1]?.trim() || '';
    const outline = xml.match(/<outline>(.+?)<\/outline>/)?.[1]?.trim() || '';
    const rating = parseFloat(xml.match(/<rating>(.+?)<\/rating>/)?.[1]) || 0;
    const year = parseInt(xml.match(/<year>(.+?)<\/year>/)?.[1]) || 0;
    return { title, plot: plot || outline, rating, year };
  };

  const parseTvShowNfo = (xml) => {
    if (!xml) return {};
    const title = xml.match(/<title>(.+?)<\/title>/)?.[1]?.trim() || '';
    const plot = xml.match(/<plot>(.+?)<\/plot>/)?.[1]?.trim() || '';
    const rating = parseFloat(xml.match(/<rating>(.+?)<\/rating>/)?.[1]) || 0;
    return { title, plot, rating };
  };

  const parseEpisodeNfo = (xml) => {
    if (!xml) return {};
    const title = xml.match(/<title>(.+?)<\/title>/)?.[1]?.trim() || '';
    const plot = xml.match(/<plot>(.+?)<\/plot>/)?.[1]?.trim() || '';
    const epNum = parseInt(xml.match(/<episode>(.+?)<\/episode>/)?.[1]) || 0;
    const seasonNum = parseInt(xml.match(/<season>(.+?)<\/season>/)?.[1]) || 0;
    return { title, plot, episode: epNum, season: seasonNum };
  };

  const getAuthUrl = (filePath) => {
    const encU = encodeURIComponent(username);
    const encP = encodeURIComponent(password);
    return origin.replace('://', `://${encU}:${encP}@`) + filePath;
  };

  const handleLogout = () => {
    Alert.alert('注销', '确定退出吗？', [
      { text: '取消' }, {
        text: '注销', style: 'destructive', onPress: async () => {
          await AsyncStorage.multiRemove(['@dav_url', '@dav_user', '@dav_pass', '@media_libs']);
          setLibraries([]); setView('login'); setIsConnected(false); setItems([]);
        }
      }
    ]);
  };

  const saveLibs = async (libs) => {
    setLibraries(libs);
    await AsyncStorage.setItem('@media_libs', JSON.stringify(libs));
  };

  const handleAddLib = async () => {
    if (!newLibName.trim() || !newLibPath.trim()) return Alert.alert('提示', '请填写完整信息');
    let path = newLibPath.trim();
    if (!path.startsWith('/')) path = '/' + path;
    path = path.replace(/\/+$/, '');
    const lib = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      name: newLibName.trim(),
      type: newLibType,
      path,
    };
    await saveLibs([...libraries, lib]);
    setNewLibName(''); setNewLibPath(''); setNewLibType('movie');
    setShowAddLib(false);
  };

  const handleDeleteLib = async (libId) => {
    await saveLibs(libraries.filter(l => l.id !== libId));
    if (activeLib?.id === libId) setActiveLib(null);
  };

  const browseLibrary = async (lib) => {
    setActiveLib(lib);
    setTvShow(null); setEpisodes([]);
    setLoading(true);
    setView('grid');
    try {
      if (lib.type === 'movie') {
        const entries = await propfind(lib.path);
        const dirs = entries.filter(e => e.isDir);
        const movieItems = [];
        for (const dir of dirs) {
          const nfo = await readFile(dir.href + 'movie.nfo');
          const meta = parseMovieNfo(nfo);
          movieItems.push({
            id: dir.href, title: meta.title || dir.name.replace(/\s*\(\d{4}\)\s*$/, '').trim(),
            year: meta.year, plot: meta.plot, rating: meta.rating,
            poster: dir.href + 'poster.jpg',
            fanart: dir.href + 'fanart.jpg',
            path: dir.href, dir: dir.name, type: 'movie',
          });
        }
        movieItems.sort((a, b) => a.title.localeCompare(b.title));
        setItems(movieItems);
      } else {
        const entries = await propfind(lib.path);
        const dirs = entries.filter(e => e.isDir);
        const showItems = [];
        for (const dir of dirs) {
          const nfo = await readFile(dir.href + 'tvshow.nfo');
          const meta = parseTvShowNfo(nfo);
          showItems.push({
            id: dir.href, title: meta.title || dir.name, plot: meta.plot, rating: meta.rating,
            poster: dir.href + 'poster.jpg', fanart: dir.href + 'fanart.jpg',
            path: dir.href, type: lib.type === 'tv' ? 'tv' : 'anime',
          });
        }
        showItems.sort((a, b) => a.title.localeCompare(b.title));
        setItems(showItems);
      }
    } catch (e) { setItems([]); }
    finally { setLoading(false); }
  };

  const browseTvShow = async (show) => {
    setTvShow(show); setLoading(true);
    try {
      const entries = await propfind(show.path);
      const seasonDirs = entries.filter(e => e.isDir);
      const allEps = [];
      for (const sd of seasonDirs) {
        const sn = sd.name.match(/\d+/)?.[0] || sd.name;
        const files = await propfind(sd.href);
        for (const f of files) {
          if (f.isDir) continue;
          if (!/\.(mkv|mp4|avi|ts|mov|wmv)$/i.test(f.name)) continue;
          const nfo = await readFile(sd.href + f.name.replace(/\.\w+$/, '.nfo'));
          const meta = parseEpisodeNfo(nfo);
          const tm = f.name.match(/S(\d+)E(\d+)/i);
          allEps.push({
            id: f.href, title: meta.title || f.name.replace(/\.[^.]+$/, ''),
            plot: meta.plot, episode: meta.episode || parseInt(tm?.[2]) || 0,
            season: meta.season || parseInt(tm?.[1]) || parseInt(sn) || 0,
            file: f.href, showTitle: show.title,
          });
        }
      }
      allEps.sort((a, b) => a.season - b.season || a.episode - b.episode);
      setEpisodes(allEps);
    } catch (e) { setEpisodes([]); }
    finally { setLoading(false); }
  };

  const handlePlay = (item) => {
    propfind(item.path).then(files => {
      const video = files.find(f => !f.isDir && /\.(mkv|mp4|avi|ts|mov|wmv)$/i.test(f.name));
      if (video) {
        navigation.navigate('MediaDetail', {
          videoUrl: getAuthUrl(video.href), title: item.title, year: item.year,
          plot: item.plot, rating: item.rating,
          posterUrl: getAuthUrl(item.poster), backdropUrl: getAuthUrl(item.fanart), type: 'movie',
        });
      }
    });
  };

  const handlePlayEpisode = (ep) => {
    navigation.navigate('MediaDetail', {
      videoUrl: getAuthUrl(ep.file),
      title: `S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')} - ${ep.title}`,
      showName: ep.showTitle, plot: ep.plot, type: 'episode',
      posterUrl: getAuthUrl(tvShow?.poster), backdropUrl: getAuthUrl(tvShow?.fanart),
    });
  };

  const goBack = () => {
    if (tvShow) { setTvShow(null); setEpisodes([]); }
    else { setActiveLib(null); setItems([]); setView('manager'); }
  };

  if (view === 'loading') return <View style={styles.center}><ActivityIndicator size="large" color="#3b82f6" /></View>;

  if (!isConnected || view === 'login') {
    return (
      <View style={styles.center}>
        <View style={styles.setupCard}>
          <Film color="#3b82f6" size={48} style={{ alignSelf: 'center', marginBottom: 16 }} />
          <Text style={styles.setupTitle}>连接 WebDAV</Text>
          <Text style={styles.setupSub}>输入你的 AList / WebDAV 服务地址</Text>
          <View style={styles.inputBox}><Server color="#9ca3af" size={20} /><TextInput style={styles.input} placeholder="https://alist.5nas.asia" placeholderTextColor="#6b7280" value={davUrl} onChangeText={setDavUrl} autoCapitalize="none" keyboardType="url" /></View>
          <View style={styles.inputBox}><User color="#9ca3af" size={20} /><TextInput style={styles.input} placeholder="用户名" placeholderTextColor="#6b7280" value={username} onChangeText={setUsername} autoCapitalize="none" /></View>
          <View style={styles.inputBox}><Key color="#9ca3af" size={20} /><TextInput style={styles.input} placeholder="密码" placeholderTextColor="#6b7280" value={password} onChangeText={setPassword} secureTextEntry /></View>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin} disabled={isTesting}><Text style={styles.btnText}>{isTesting ? '连接中...' : '测试并连接'}</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  if (view === 'manager') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>媒体库</Text>
          <TouchableOpacity onPress={handleLogout} style={styles.iconBtn}><LogOut color="#ef4444" size={20} /></TouchableOpacity>
        </View>
        <FlatList
          data={libraries}
          keyExtractor={l => l.id}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            <View style={styles.emptyLib}>
              <FolderOpen color="#4b5563" size={48} />
              <Text style={{ color: '#9ca3af', marginTop: 12 }}>暂无媒体库，点击下方添加</Text>
            </View>
          }
          renderItem={({ item: lib }) => (
            <TouchableOpacity style={styles.libCard} onPress={() => browseLibrary(lib)}>
              <Film color="#3b82f6" size={28} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={styles.libName}>{lib.name}</Text>
                <Text style={styles.libMeta}>{LIB_TYPES.find(t => t.id === lib.type)?.label || lib.type} · {lib.path}</Text>
              </View>
              <ChevronRight color="#6b7280" size={20} />
              <TouchableOpacity style={{ padding: 8 }} onPress={() => handleDeleteLib(lib.id)}><Trash2 color="#ef4444" size={18} /></TouchableOpacity>
            </TouchableOpacity>
          )}
        />
        <TouchableOpacity style={styles.fab} onPress={() => setShowAddLib(true)}><Plus color="#fff" size={28} /></TouchableOpacity>

        <Modal visible={showAddLib} transparent animationType="fade">
          <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowAddLib(false)}>
            <View style={styles.modalPanel} onStartShouldSetResponder={() => true}>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 16 }}>添加媒体库</Text>
              <View style={styles.inputBox}><TextInput style={styles.input} placeholder="名称（如：我的电影）" placeholderTextColor="#6b7280" value={newLibName} onChangeText={setNewLibName} /></View>
              <View style={styles.inputBox}><TextInput style={styles.input} placeholder="路径（如：/媒体/电影）" placeholderTextColor="#6b7280" value={newLibPath} onChangeText={setNewLibPath} autoCapitalize="none" /></View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                {LIB_TYPES.map(t => (
                  <TouchableOpacity key={t.id} onPress={() => setNewLibType(t.id)}
                    style={[styles.typeChip, newLibType === t.id && styles.typeChipActive]}>
                    <Text style={[styles.typeChipText, newLibType === t.id && styles.typeChipTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleAddLib}><Text style={styles.btnText}>添加</Text></TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  }

  if (view === 'grid') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ChevronLeft color="#fff" size={24} /><Text style={styles.headerTitle}>{tvShow ? tvShow.title : activeLib?.name || '浏览'}</Text>
          </TouchableOpacity>
        </View>
        {tvShow ? (
          loading ? <View style={styles.center}><ActivityIndicator size="large" color="#3b82f6" /></View> : (
            <FlatList
              data={episodes}
              keyExtractor={e => e.id}
              contentContainerStyle={{ padding: 16 }}
              ListEmptyComponent={<Text style={{ color: '#6b7280', textAlign: 'center', marginTop: 40 }}>暂无剧集</Text>}
              renderItem={({ item: ep }) => (
                <TouchableOpacity style={styles.epCard} onPress={() => handlePlayEpisode(ep)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.epTitle} numberOfLines={1}>S{String(ep.season).padStart(2, '0')}E{String(ep.episode).padStart(2, '0')} - {ep.title}</Text>
                    {ep.plot ? <Text style={styles.epOverview} numberOfLines={2}>{ep.plot}</Text> : null}
                  </View>
                  <Play color="#3b82f6" size={20} fill="#3b82f6" />
                </TouchableOpacity>
              )}
            />
          )
        ) : (
          loading ? <View style={styles.center}><ActivityIndicator size="large" color="#3b82f6" /></View> : (
            <FlatList
              data={items}
              keyExtractor={item => item.id}
              numColumns={3}
              contentContainerStyle={{ padding: 16 }}
              ListEmptyComponent={<Text style={{ color: '#6b7280', textAlign: 'center', marginTop: 40 }}>暂无内容</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.gridItem} onPress={() => {
                  if (item.type === 'movie') handlePlay(item);
                  else browseTvShow(item);
                }}>
                  <Image source={{ uri: getAuthUrl(item.poster) }} style={styles.gridPoster} />
                  <View style={styles.gridOverlay}>
                    {item.rating > 0 && <View style={styles.ratingBadge}><Star color="#f59e0b" size={10} fill="#f59e0b" /><Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text></View>}
                  </View>
                  <Text style={styles.gridTitle} numberOfLines={2}>{item.title}</Text>
                </TouchableOpacity>
              )}
            />
          )
        )}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  center: { flex: 1, backgroundColor: '#111827', justifyContent: 'center', alignItems: 'center', padding: 20 },
  setupCard: { width: '100%', maxWidth: 400, backgroundColor: '#1f2937', padding: 24, borderRadius: 16, elevation: 8 },
  setupTitle: { color: '#ffffff', fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  setupSub: { color: '#9ca3af', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 50, paddingBottom: 12, backgroundColor: '#1f2937' },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: 'bold', marginLeft: 4 },
  iconBtn: { padding: 8 },
  inputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#374151', borderRadius: 10, paddingHorizontal: 14, marginBottom: 14, height: 48 },
  input: { flex: 1, color: '#e5e7eb', fontSize: 15, marginLeft: 8 },
  primaryBtn: { backgroundColor: '#3b82f6', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 6 },
  btnText: { color: '#ffffff', fontSize: 17, fontWeight: 'bold' },
  emptyLib: { alignItems: 'center', marginTop: 80 },
  libCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f2937', padding: 16, borderRadius: 12, marginBottom: 10, elevation: 2 },
  libName: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
  libMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  fab: { position: 'absolute', bottom: 24, right: 24, backgroundColor: '#3b82f6', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 6 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalPanel: { backgroundColor: '#1f2937', borderRadius: 16, padding: 20, elevation: 10 },
  typeChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#374151', marginRight: 8 },
  typeChipActive: { backgroundColor: 'rgba(59, 130, 246, 0.25)' },
  typeChipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  typeChipTextActive: { color: '#60a5fa' },
  gridItem: { width: POSTER_W, marginRight: 8, marginBottom: 16 },
  gridPoster: { width: POSTER_W, height: POSTER_H, borderRadius: 8, backgroundColor: '#374151' },
  gridOverlay: { position: 'absolute', top: 4, right: 4, flexDirection: 'row' },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  ratingText: { color: '#f59e0b', fontSize: 10, fontWeight: 'bold', marginLeft: 2 },
  gridTitle: { color: '#e5e7eb', fontSize: 12, fontWeight: '500', marginTop: 4 },
  epCard: { flexDirection: 'row', backgroundColor: '#1f2937', padding: 14, borderRadius: 10, marginBottom: 8, alignItems: 'center' },
  epTitle: { color: '#e5e7eb', fontSize: 14, fontWeight: 'bold' },
  epOverview: { color: '#6b7280', fontSize: 12, marginTop: 4 },
});
