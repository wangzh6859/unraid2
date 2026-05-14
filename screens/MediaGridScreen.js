import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, FlatList, Image, Alert, Dimensions, TextInput, Modal, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import base64 from 'base-64';
import { XMLParser } from 'fast-xml-parser';
import { Film, Plus, X, FolderOpen, ChevronLeft, Star, Server, User, Key, LogOut, Settings } from 'lucide-react-native';

const { width } = Dimensions.get('window');
const POSTER_W = (width - 48) / 3;
const POSTER_H = POSTER_W * 1.5;

const LIB_TYPES = [
  { id: 'movie', label: '电影' },
  { id: 'tv', label: '电视剧' },
  { id: 'anime', label: '动漫' },
  { id: 'other', label: '其他' },
];

export default function MediaGridScreen({ navigation }) {
  const [view, setView] = useState('loading');
  const [davUrl, setDavUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const [libraries, setLibraries] = useState([]);
  const [activeLibId, setActiveLibId] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [settingsMode, setSettingsMode] = useState('list'); // 'list' | 'add' | 'edit'
  const [editingLib, setEditingLib] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('movie');
  const [editFolders, setEditFolders] = useState([]);
  const [browseDirs, setBrowseDirs] = useState([]);
  const [browsePath, setBrowsePath] = useState('');
  const [loadingDirs, setLoadingDirs] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);

  const origin = davUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || '';
  const davPath = davUrl.match(/^(https?:\/\/[^\/]+)(.*)$/)?.[2]?.replace(/\/+$/, '') || '';

  const authHeader = () => 'Basic ' + base64.encode(`${username}:${password}`);
  const getAuthUrl = (filePath) => {
    const encU = encodeURIComponent(username);
    const encP = encodeURIComponent(password);
    return origin.replace('://', `://${encU}:${encP}@`) + filePath;
  };

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
        setView('main');
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
          response = retry; cleanUrl = alistUrl;
        }
      }
      if (response.status === 200 || response.status === 207) {
        await AsyncStorage.multiSet([
          ['@dav_url', cleanUrl], ['@dav_user', username], ['@dav_pass', password],
        ]);
        setDavUrl(cleanUrl); setIsConnected(true); setView('main');
        const savedLibs = await AsyncStorage.getItem('@media_libs');
        if (savedLibs) setLibraries(JSON.parse(savedLibs));
      } else {
        Alert.alert('连接失败', `状态码: ${response.status}`);
      }
    } catch (e) {
      Alert.alert('网络错误', '无法连接');
    } finally { setIsTesting(false); }
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
      const name = props.displayname || decodeURIComponent(href.split('/').filter(Boolean).pop() || '');
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

  const parseNfoField = (xml, tag) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() || '';

  const parseMovieNfo = (xml) => {
    if (!xml) return {};
    return {
      title: parseNfoField(xml, 'title'),
      plot: parseNfoField(xml, 'plot') || parseNfoField(xml, 'outline'),
      rating: parseFloat(parseNfoField(xml, 'rating')) || 0,
      year: parseInt(parseNfoField(xml, 'year')) || 0,
    };
  };

  const parseTvShowNfo = (xml) => {
    if (!xml) return {};
    return {
      title: parseNfoField(xml, 'title'),
      plot: parseNfoField(xml, 'plot'),
      rating: parseFloat(parseNfoField(xml, 'rating')) || 0,
    };
  };

  // 自动检测文件夹类型：优先查找 movie.nfo，其次 tvshow.nfo
  const detectFolderType = async (dir) => {
    const movieNfo = await readFile(dir.href + 'movie.nfo');
    if (movieNfo) {
      const meta = parseMovieNfo(movieNfo);
      return {
        id: dir.href, title: meta.title || dir.name.replace(/\s*\(\d{4}\)\s*$/, '').trim(),
        year: meta.year, plot: meta.plot, rating: meta.rating,
        poster: dir.href + 'poster.jpg', fanart: dir.href + 'fanart.jpg',
        path: dir.href, type: 'movie',
      };
    }
    const tvNfo = await readFile(dir.href + 'tvshow.nfo');
    if (tvNfo) {
      const meta = parseTvShowNfo(tvNfo);
      return {
        id: dir.href, title: meta.title || dir.name, plot: meta.plot, rating: meta.rating,
        poster: dir.href + 'poster.jpg', fanart: dir.href + 'fanart.jpg',
        path: dir.href, type: 'tv',
      };
    }
    // 如果都没有 nfo 文件，根据文件夹名称猜测
    const lowerName = dir.name.toLowerCase();
    const isMovie = lowerName.match(/\(\d{4}\)/) || lowerName.match(/movie|film/i);
    return {
      id: dir.href, title: dir.name,
      year: 0, plot: '', rating: 0,
      poster: dir.href + 'poster.jpg', fanart: dir.href + 'fanart.jpg',
      path: dir.href, type: isMovie ? 'movie' : 'tv',
    };
  };

  const fetchLibItems = async (lib) => {
    const result = [];
    for (const folder of lib.folders) {
      try {
        const entries = await propfind(folder);
        const dirs = entries.filter(e => e.isDir);
        for (const dir of dirs) {
          const item = await detectFolderType(dir);
          if (item) result.push(item);
        }
      } catch (e) {}
    }
    return result;
  };

  // 获取库中所有视频文件（用于电影播放）
  const fetchAllVideos = async (lib) => {
    const result = [];
    for (const folder of lib.folders) {
      try {
        const entries = await propfind(folder);
        const dirs = entries.filter(e => e.isDir);
        for (const dir of dirs) {
          const files = await propfind(dir.href);
          for (const f of files) {
            if (!f.isDir && /\.(mkv|mp4|avi|ts|mov|wmv|m4v|webm)$/i.test(f.name)) {
              result.push({ ...f, parentPath: dir.href, parentName: dir.name });
            }
          }
        }
      } catch (e) {}
    }
    return result;
  };

  const fetchItems = async (libId) => {
    setLoading(true);
    try {
      let allItems = [];
      if (libId === 'all') {
        for (const lib of libraries) {
          allItems = allItems.concat(await fetchLibItems(lib));
        }
      } else {
        const lib = libraries.find(l => l.id === libId);
        if (lib) allItems = await fetchLibItems(lib);
      }
      allItems.sort((a, b) => a.title.localeCompare(b.title));
      setItems(allItems);
    } catch (e) { setItems([]); }
    setLoading(false);
  };

  const handleTabSelect = (libId) => {
    setActiveLibId(libId);
    fetchItems(libId);
  };

  useEffect(() => {
    if (view === 'main') {
      if (libraries.length > 0) fetchItems(activeLibId);
      else setLoading(false);
    }
  }, [view, libraries]);

const handlePlay = (item) => {
     propfind(item.path).then(files => {
       const video = files.find(f => !f.isDir && /\.(mkv|mp4|avi|ts|mov|wmv|m4v|webm)$/i.test(f.name));
       if (video) {
         navigation.navigate('MediaDetail', {
           videoUrl: getAuthUrl(video.href), title: item.title, year: item.year,
           plot: item.plot, rating: item.rating,
           posterUrl: getAuthUrl(item.poster), backdropUrl: getAuthUrl(item.fanart), type: 'movie',
         });
       } else {
         Alert.alert('提示', '未找到可播放的视频文件');
       }
     }).catch(() => {
       Alert.alert('错误', '无法获取视频文件，请检查网络连接');
     });
   };

  const startBrowse = async (dir) => {
    setLoadingDirs(true);
    setBrowsePath(dir);
    try {
      const entries = await propfind(dir);
      setBrowseDirs(entries.filter(e => e.isDir));
    } catch (e) { setBrowseDirs([]); }
    setLoadingDirs(false);
  };

  const addFolderToLib = (path) => {
    if (!editFolders.includes(path)) {
      setEditFolders([...editFolders, path]);
    }
    setBrowseDirs([]); setBrowsePath(''); setAddingFolder(false);
  };

  const removeFolderFromLib = (path) => {
    setEditFolders(editFolders.filter(f => f !== path));
  };

  const openNewLib = () => {
    setEditingLib(null); setEditName(''); setEditType('movie'); setEditFolders([]);
    setAddingFolder(false); setBrowseDirs([]); setBrowsePath('');
    setSettingsMode('add');
    setShowSettings(true);
  };

  const openEditLib = (lib) => {
    setEditingLib(lib); setEditName(lib.name); setEditType(lib.type); setEditFolders([...lib.folders]);
    setAddingFolder(false); setBrowseDirs([]); setBrowsePath('');
    setSettingsMode('edit');
    setShowSettings(true);
  };

  const openLibList = () => {
    setSettingsMode('list');
    setShowSettings(true);
  };

  const saveEditingLib = async () => {
    if (!editName.trim()) return Alert.alert('提示', '请输入名称');
    if (editFolders.length === 0) return Alert.alert('提示', '请至少添加一个路径');
    let newLibs;
    if (editingLib) {
      newLibs = libraries.map(l => l.id === editingLib.id ? { ...l, name: editName.trim(), type: editType, folders: [...editFolders] } : l);
    } else {
      newLibs = [...libraries, { id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4), name: editName.trim(), type: editType, folders: [...editFolders] }];
    }
    await saveLibs(newLibs);
    setSettingsMode('list');
    setShowSettings(false);
    if (view === 'main') fetchItems(activeLibId);
  };

  const confirmDeleteLib = (libId) => {
    Alert.alert('删除媒体库', '确定要删除这个媒体库吗？所有关联的文件夹配置将被移除。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deleteLib(libId) },
    ]);
  };

  const deleteLib = (libId) => {
    const newLibs = libraries.filter(l => l.id !== libId);
    saveLibs(newLibs);
    if (activeLibId === libId) setActiveLibId('all');
    if (view === 'main') fetchItems(activeLibId === libId ? 'all' : activeLibId);
  };

  if (view === 'loading') return <View style={styles.center}><ActivityIndicator size="large" color="#3b82f6" /></View>;

  if (!isConnected || view === 'login') {
    return (
      <View style={styles.center}>
        <View style={styles.setupCard}>
          <Film color="#3b82f6" size={48} style={{ alignSelf: 'center', marginBottom: 16 }} />
          <Text style={styles.setupTitle}>连接 WebDAV</Text>
          <Text style={styles.setupSub}>输入 AList / WebDAV 服务地址</Text>
          <View style={styles.inputBox}><Server color="#9ca3af" size={20} /><TextInput style={styles.input} placeholder="https://alist.5nas.asia" placeholderTextColor="#6b7280" value={davUrl} onChangeText={setDavUrl} autoCapitalize="none" keyboardType="url" /></View>
          <View style={styles.inputBox}><User color="#9ca3af" size={20} /><TextInput style={styles.input} placeholder="用户名" placeholderTextColor="#6b7280" value={username} onChangeText={setUsername} autoCapitalize="none" /></View>
          <View style={styles.inputBox}><Key color="#9ca3af" size={20} /><TextInput style={styles.input} placeholder="密码" placeholderTextColor="#6b7280" value={password} onChangeText={setPassword} secureTextEntry /></View>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin} disabled={isTesting}><Text style={styles.btnText}>{isTesting ? '连接中...' : '测试并连接'}</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  if (view === 'main') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>影音中心</Text>
          <TouchableOpacity onPress={handleLogout} style={styles.iconBtn}><LogOut color="#ef4444" size={20} /></TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={{ paddingHorizontal: 16 }}>
          <TouchableOpacity onPress={() => handleTabSelect('all')} style={[styles.tab, activeLibId === 'all' && styles.tabActive]}>
            <Text style={[styles.tabText, activeLibId === 'all' && styles.tabTextActive]}>全部</Text>
          </TouchableOpacity>
          {libraries.map(lib => (
            <TouchableOpacity key={lib.id} onPress={() => handleTabSelect(lib.id)} style={[styles.tab, activeLibId === lib.id && styles.tabActive]}>
              <Text style={[styles.tabText, activeLibId === lib.id && styles.tabTextActive]}>{lib.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={openNewLib} style={styles.tab}><Plus color="#9ca3af" size={18} /></TouchableOpacity>
          <TouchableOpacity onPress={openLibList} style={styles.tab}><Settings color="#9ca3af" size={18} /></TouchableOpacity>
        </ScrollView>

        {loading ? <View style={styles.center}><ActivityIndicator size="large" color="#3b82f6" /></View> : (
          <FlatList data={items} keyExtractor={item => item.id} numColumns={3}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={<Text style={{ color: '#6b7280', textAlign: 'center', marginTop: 40 }}>暂无内容{'\n'}点右上角 + 添加媒体库</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.gridItem}
                onLongPress={() => {
                  Alert.alert(item.title, '选择操作', [
                    { text: '取消', style: 'cancel' },
                    { text: '播放', onPress: () => handlePlay(item) },
                  ]);
                }}
                onPress={() => {
                  if (item.type === 'movie') handlePlay(item);
                  else navigation.navigate('MediaDetail', {
                    type: item.type, showPath: item.path,
                    title: item.title, plot: item.plot, rating: item.rating,
                    posterUrl: getAuthUrl(item.poster), backdropUrl: getAuthUrl(item.fanart),
                    showName: item.title, serverUrl: origin,
                    webdavUser: username, webdavPass: password,
                  });
                }}>
                <Image source={{ uri: getAuthUrl(item.poster) }} style={styles.gridPoster} />
                <View style={styles.gridOverlay}>
                  {item.rating > 0 && <View style={styles.ratingBadge}><Star color="#f59e0b" size={10} fill="#f59e0b" /><Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text></View>}
                </View>
                <Text style={styles.gridTitle} numberOfLines={2}>{item.title}</Text>
              </TouchableOpacity>
            )}
          />
        )}

        <Modal visible={showSettings} transparent animationType="slide">
          <View style={styles.settingsOverlay}>
            <View style={styles.settingsPanel}>
              <View style={styles.settingsHeader}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>
                  {settingsMode === 'list' ? '管理媒体库' : (settingsMode === 'edit' ? '编辑媒体库' : '添加媒体库')}
                </Text>
                <TouchableOpacity onPress={() => setShowSettings(false)}><X color="#9ca3af" size={24} /></TouchableOpacity>
              </View>
              <ScrollView style={{ padding: 20, maxHeight: '80%' }} nestedScrollEnabled>
                {settingsMode === 'list' && libraries.length > 0 && libraries.map(lib => (
                  <View key={lib.id} style={[styles.libRow, { borderBottomWidth: 1, borderBottomColor: '#374151' }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: 'bold' }}>{lib.name}</Text>
                      <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
                        {lib.type === 'movie' ? '🎬 电影' : lib.type === 'tv' ? '📺 电视剧' : lib.type} · {lib.folders.length} 个文件夹
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TouchableOpacity onPress={() => openEditLib(lib)} style={{ padding: 8 }}>
                        <Text style={{ color: '#60a5fa', fontSize: 13 }}>编辑</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => confirmDeleteLib(lib.id)} style={{ padding: 8, marginLeft: 4 }}>
                        <X color="#ef4444" size={18} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                {settingsMode === 'list' && libraries.length === 0 && (
                  <Text style={{ color: '#6b7280', textAlign: 'center', marginVertical: 20 }}>暂无媒体库，请添加</Text>
                )}
                {(settingsMode === 'add' || settingsMode === 'edit') && (
                  <View>
                    <Text style={{ color: '#9ca3af', fontSize: 13, marginBottom: 8 }}>媒体库名称</Text>
                    <View style={styles.inputBox}><TextInput style={styles.input} placeholder="媒体库名称" placeholderTextColor="#6b7280" value={editName} onChangeText={setEditName} /></View>
                    <Text style={{ color: '#9ca3af', fontSize: 13, marginVertical: 8 }}>媒体库类型</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                      {LIB_TYPES.map(t => (
                        <TouchableOpacity key={t.id} onPress={() => setEditType(t.id)}
                          style={[styles.typeChip, editType === t.id && styles.typeChipActive]}>
                          <Text style={[styles.typeChipText, editType === t.id && styles.typeChipTextActive]}>{t.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={{ color: '#9ca3af', fontSize: 13, marginBottom: 8 }}>文件夹路径</Text>
                    {editFolders.map((fp, i) => (
                      <View key={i} style={[styles.inputBox, { marginBottom: 8 }]}>
                        <FolderOpen color="#f59e0b" size={18} style={{ marginRight: 6 }} />
                        <Text style={{ color: '#e5e7eb', fontSize: 14, flex: 1 }} numberOfLines={1}>{fp}</Text>
                        <TouchableOpacity onPress={() => removeFolderFromLib(fp)}><X color="#ef4444" size={18} /></TouchableOpacity>
                      </View>
                    ))}
                    {addingFolder ? (
                      <View style={{ marginTop: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                          <TouchableOpacity onPress={() => {
                            const up = browsePath.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                            startBrowse(up);
                          }} style={{ padding: 4, marginRight: 8 }}><ChevronLeft color="#9ca3af" size={18} /></TouchableOpacity>
                          <Text style={{ color: '#9ca3af', fontSize: 12, flex: 1 }} numberOfLines={1}>{browsePath || '/'}</Text>
                          <TouchableOpacity onPress={() => addFolderToLib(browsePath)} style={{ paddingHorizontal: 8 }}>
                            <Text style={{ color: '#3b82f6', fontSize: 13, fontWeight: 'bold' }}>选择此文件夹</Text>
                          </TouchableOpacity>
                        </View>
                        {loadingDirs ? <ActivityIndicator color="#3b82f6" /> : (
                          <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
                            {browseDirs.length === 0 && <Text style={{ color: '#6b7280', textAlign: 'center' }}>无子文件夹</Text>}
                            {browseDirs.map((d, i) => (
                              <TouchableOpacity key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#374151' }} onPress={() => startBrowse(d.href)}>
                                <FolderOpen color="#f59e0b" size={18} style={{ marginRight: 8 }} />
                                <Text style={{ color: '#e5e7eb', fontSize: 14 }} numberOfLines={1}>{d.name}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => { setAddingFolder(true); startBrowse(davPath || '/'); }} style={{ flexDirection: 'row', alignItems: 'center', padding: 10, marginBottom: 8 }}>
                        <Plus color="#3b82f6" size={20} style={{ marginRight: 8 }} /><Text style={{ color: '#3b82f6', fontSize: 14 }}>添加文件夹</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.primaryBtn} onPress={saveEditingLib}><Text style={styles.btnText}>保存</Text></TouchableOpacity>
                    {settingsMode === 'edit' && (
                      <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#6b7280', marginTop: 8 }]} onPress={() => setSettingsMode('list')}>
                        <Text style={styles.btnText}>返回库列表</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
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
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: 'bold' },
  iconBtn: { padding: 8 },
  inputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#374151', borderRadius: 10, paddingHorizontal: 14, height: 48 },
  input: { flex: 1, color: '#e5e7eb', fontSize: 15, marginLeft: 8 },
  primaryBtn: { backgroundColor: '#3b82f6', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 6 },
  btnText: { color: '#ffffff', fontSize: 17, fontWeight: 'bold' },
  tabRow: { backgroundColor: '#1f2937', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#374151' },
  tab: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, marginRight: 8, backgroundColor: '#374151' },
  tabActive: { backgroundColor: 'rgba(59, 130, 246, 0.25)' },
  tabText: { color: '#9ca3af', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#60a5fa' },
  gridItem: { width: POSTER_W, marginRight: 8, marginBottom: 16 },
  gridPoster: { width: POSTER_W, height: POSTER_H, borderRadius: 8, backgroundColor: '#374151' },
  gridOverlay: { position: 'absolute', top: 4, right: 4, flexDirection: 'row' },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  ratingText: { color: '#f59e0b', fontSize: 10, fontWeight: 'bold', marginLeft: 2 },
  gridTitle: { color: '#e5e7eb', fontSize: 12, fontWeight: '500', marginTop: 4 },
  libRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#374151', marginRight: 6, minWidth: 60, alignItems: 'center' },
  typeChipActive: { backgroundColor: 'rgba(59, 130, 246, 0.25)' },
  typeChipText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  typeChipTextActive: { color: '#60a5fa' },
  settingsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  settingsPanel: { backgroundColor: '#1f2937', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#374151' },
});