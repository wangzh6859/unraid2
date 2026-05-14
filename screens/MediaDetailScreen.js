import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, ScrollView, Image, TouchableOpacity, ActivityIndicator, Dimensions, Platform, Modal, Linking, FlatList } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as ScreenOrientation from 'expo-screen-orientation';
import { BlurView } from 'expo-blur';
import base64 from 'base-64';
import { XMLParser } from 'fast-xml-parser';
import { ChevronLeft, Play, X, Info, ExternalLink, Star } from 'lucide-react-native';
import * as IntentLauncher from 'expo-intent-launcher';

const { width, height } = Dimensions.get('window');

function formatTime(millis) {
  if (!millis) return '00:00';
  const s = Math.floor(millis / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function MediaDetailScreen({ route, navigation }) {
  const { videoUrl, title: navTitle, year, plot, rating, posterUrl, backdropUrl, type, showName, showPath, serverUrl, webdavUser, webdavPass } = route?.params || {};

  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [playbackStats, setPlaybackStats] = useState({ position: 0, duration: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [episodes, setEpisodes] = useState([]);
  const [loadingEps, setLoadingEps] = useState(false);
  const [playingEp, setPlayingEp] = useState(null);

  const origin = (serverUrl || '').match(/^(https?:\/\/[^\/]+)/)?.[1] || '';
  const authHeader = () => 'Basic ' + base64.encode(`${webdavUser || ''}:${webdavPass || ''}`);

  useEffect(() => {
    if (type === 'tv' && showPath) fetchEpisodes();
  }, []);

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
      const isDir = (r.propstat?.prop || (Array.isArray(r.propstat) ? r.propstat[0].prop : {}))?.resourcetype?.collection === '';
      const name = (r.propstat?.prop || {}).displayname || decodeURIComponent(href.split('/').filter(Boolean).pop() || '');
      if (!name || name.startsWith('.')) continue;
      entries.push({ name, href, isDir });
    }
    return entries;
  };

  const getAuthUrl = (filePath) => {
    const encU = encodeURIComponent(webdavUser || '');
    const encP = encodeURIComponent(webdavPass || '');
    return origin.replace('://', `://${encU}:${encP}@`) + filePath;
  };

  const fetchEpisodes = async () => {
    setLoadingEps(true);
    try {
      const entries = await propfind(showPath);
      const seasonDirs = entries.filter(e => e.isDir);
      const allEps = [];
      for (const sd of seasonDirs) {
        const sn = sd.name.match(/\d+/)?.[0] || sd.name;
        const files = await propfind(sd.href);
        for (const f of files) {
          if (f.isDir || !/\.(mkv|mp4|avi|ts|mov|wmv|m4v|webm)$/i.test(f.name)) continue;
          const nfoRes = await fetch(origin + sd.href + f.name.replace(/\.\w+$/, '.nfo'), { headers: { 'Authorization': authHeader() } });
          const nfoXml = nfoRes.ok ? await nfoRes.text() : '';
          const title = nfoXml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || f.name.replace(/\.[^.]+$/, '');
          const plot = nfoXml.match(/<plot>([\s\S]*?)<\/plot>/)?.[1]?.trim() || '';
          const epNum = parseInt(nfoXml.match(/<episode>([\s\S]*?)<\/episode>/)?.[1]) || 0;
          const seasonNum = parseInt(nfoXml.match(/<season>([\s\S]*?)<\/season>/)?.[1]) || 0;
          const tm = f.name.match(/S(\d+)E(\d+)/i);
          allEps.push({
            id: f.href, title, plot,
            episode: epNum || parseInt(tm?.[2]) || 0,
            season: seasonNum || parseInt(tm?.[1]) || parseInt(sn) || 0,
            file: f.href,
          });
        }
      }
      allEps.sort((a, b) => a.season - b.season || a.episode - b.episode);
      setEpisodes(allEps);
    } catch (e) { setEpisodes([]); }
    setLoadingEps(false);
  };

  const playEpisode = async (ep) => {
    setPlayingEp(ep);
    setPlaying(true);
  };

  const closePlayer = async () => {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    setPlaying(false);
    setPlayingEp(null);
    setShowSettings(false);
  };

  const handleExternalPlay = () => {
    const url = playingEp ? getAuthUrl(playingEp.file) : videoUrl;
    if (!url) return;
    if (Platform.OS === 'android') {
      IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: url, type: 'video/*' })
        .catch(() => Linking.openURL(url));
    } else {
      Linking.openURL(url);
    }
  };

  const handlePlaybackUpdate = (status) => {
    if (status.isLoaded) {
      setPlaybackStats({ position: status.positionMillis, duration: status.durationMillis });
    }
  };

  const safeLockLandscape = async () => { try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE); } catch (e) {} };
  const safeLockPortrait = async () => { try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); } catch (e) {} };

  const currentVideoUrl = playingEp ? getAuthUrl(playingEp.file) : videoUrl;

  return (
    <View style={styles.container}>
      {playing && currentVideoUrl && (
        <View style={styles.playerWrap}>
          <View style={styles.playerInner}>
            <View style={styles.playerTopBar}>
              <TouchableOpacity style={styles.iconBtnLayer} onPress={closePlayer}><X color="#ffffff" size={26} /></TouchableOpacity>
              <TouchableOpacity style={styles.iconBtnLayer} onPress={() => setShowSettings(true)}><Info color="#ffffff" size={24} /></TouchableOpacity>
            </View>
            <Video
              ref={videoRef} style={styles.video} source={{ uri: currentVideoUrl }}
              useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay
              onFullscreenUpdate={({ fullscreenUpdate }) => {
                if (fullscreenUpdate === 0 || fullscreenUpdate === 1) safeLockLandscape();
                else if (fullscreenUpdate === 2 || fullscreenUpdate === 3) safeLockPortrait();
              }}
              onPlaybackStatusUpdate={handlePlaybackUpdate}
            />
          </View>
          <Modal visible={showSettings} transparent animationType="slide">
            <View style={styles.settingsOverlay}>
              <View style={styles.settingsPanel}>
                <View style={styles.settingsHeader}>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>播放信息</Text>
                  <TouchableOpacity onPress={() => setShowSettings(false)}><X color="#9ca3af" size={24} /></TouchableOpacity>
                </View>
                <View style={{ padding: 20 }}>
                  <View style={styles.statBox}><Info color="#3b82f6" size={18} /><Text style={styles.statLabel}>进度</Text></View>
                  <Text style={styles.statText}>{formatTime(playbackStats.position)} / {formatTime(playbackStats.duration)}</Text>
                  <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 16 }} />
                  <TouchableOpacity style={styles.externalBtn} onPress={handleExternalPlay}>
                    <ExternalLink color="#fff" size={16} style={{ marginRight: 8 }} />
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>使用第三方播放器</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </View>
      )}

      <ScrollView style={styles.scroll}>
        <View style={styles.hero}>
          <Image source={{ uri: backdropUrl || posterUrl }} style={styles.backdrop} />
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.heroOverlay} />
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}><ChevronLeft color="#ffffff" size={30} /></TouchableOpacity>
          <View style={styles.heroContent}>
            <Image source={{ uri: posterUrl }} style={styles.poster} />
            <View style={styles.heroText}>
              <Text style={styles.title} numberOfLines={2}>{navTitle}</Text>
              <View style={styles.metaRow}>
                {year ? <Text style={styles.meta}>{year}</Text> : null}
                {showName ? <Text style={styles.meta}>{showName}</Text> : null}
                {rating ? (
                  <View style={styles.ratingBadge}>
                    <Star color="#fff" size={11} fill="#fff" style={{ marginRight: 2 }} />
                    <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
                  </View>
                ) : null}
                {type === 'tv' && episodes.length > 0 && (
                  <Text style={styles.meta}>{episodes.length} 集</Text>
                )}
              </View>
            </View>
          </View>
        </View>

        {type === 'tv' ? null : (
          !playing ? (
            <TouchableOpacity style={styles.playBtn} onPress={() => setPlaying(true)}>
              <Play color="#fff" size={20} fill="#fff" /><Text style={styles.playText}>立即播放</Text>
            </TouchableOpacity>
          ) : null
        )}

        {plot ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>简介</Text>
            <Text style={styles.overview}>{plot}</Text>
          </View>
        ) : null}

        {type === 'tv' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>剧集列表</Text>
            {loadingEps ? (
              <ActivityIndicator color="#3b82f6" style={{ marginVertical: 20 }} />
            ) : episodes.length === 0 ? (
              <Text style={{ color: '#6b7280', textAlign: 'center', marginVertical: 20 }}>暂无剧集</Text>
            ) : (
              episodes.map((ep, i) => (
                <TouchableOpacity key={i} style={styles.epCard} onPress={() => playEpisode(ep)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.epTitle} numberOfLines={1}>S{String(ep.season).padStart(2, '0')}E{String(ep.episode).padStart(2, '0')} - {ep.title}</Text>
                    {ep.plot ? <Text style={styles.epOverview} numberOfLines={2}>{ep.plot}</Text> : null}
                  </View>
                  <Play color="#3b82f6" size={20} fill="#3b82f6" />
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        <View style={{ height: 50 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  center: { flex: 1, backgroundColor: '#111827', justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  hero: { height: 300, justifyContent: 'flex-end', padding: 20, paddingBottom: 10, position: 'relative' },
  backdrop: { position: 'absolute', top: 0, left: 0, width, height: 300, resizeMode: 'cover' },
  heroOverlay: { position: 'absolute', bottom: 0, left: 0, width, height: 120, backgroundColor: 'rgba(17, 24, 39, 0.7)' },
  backBtn: { position: 'absolute', top: Platform.OS === 'ios' ? 50 : 30, left: 16, zIndex: 10, padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  heroContent: { flexDirection: 'row', alignItems: 'flex-end', zIndex: 5 },
  poster: { width: 100, height: 150, borderRadius: 10, borderWidth: 2, borderColor: '#374151', elevation: 8 },
  heroText: { flex: 1, marginLeft: 14 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: 'bold', marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  meta: { color: '#d1d5db', fontSize: 13, marginRight: 10, fontWeight: '500' },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(245, 158, 11, 0.2)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, marginRight: 10 },
  ratingText: { color: '#f59e0b', fontSize: 12, fontWeight: 'bold' },
  playBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e50914', marginHorizontal: 20, marginTop: 20, paddingVertical: 13, borderRadius: 8, elevation: 3 },
  playText: { color: '#ffffff', fontSize: 17, fontWeight: 'bold', marginLeft: 8 },
  section: { padding: 20, paddingBottom: 0 },
  sectionTitle: { color: '#ffffff', fontSize: 17, fontWeight: 'bold', marginBottom: 12 },
  overview: { color: '#9ca3af', fontSize: 14, lineHeight: 22 },
  playerWrap: { position: 'absolute', top: 0, left: 0, width, height, zIndex: 999, backgroundColor: '#000', justifyContent: 'center' },
  playerInner: { flex: 1, justifyContent: 'center', position: 'relative' },
  playerTopBar: { position: 'absolute', top: Platform.OS === 'ios' ? 50 : 30, left: 0, width: '100%', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, zIndex: 1000 },
  iconBtnLayer: { padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  video: { width: '100%', height: height * 0.4 },
  settingsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  settingsPanel: { backgroundColor: '#1f2937', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#374151' },
  statBox: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  statLabel: { color: '#e5e7eb', fontSize: 15, fontWeight: 'bold', marginLeft: 8 },
  statText: { color: '#9ca3af', fontSize: 13, marginBottom: 4 },
  externalBtn: { flexDirection: 'row', backgroundColor: '#8b5cf6', padding: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  epCard: { flexDirection: 'row', backgroundColor: '#1f2937', padding: 14, borderRadius: 10, marginBottom: 8, alignItems: 'center' },
  epTitle: { color: '#e5e7eb', fontSize: 14, fontWeight: 'bold' },
  epOverview: { color: '#6b7280', fontSize: 12, marginTop: 4 },
});
