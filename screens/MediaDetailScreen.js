import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, ScrollView, Image, TouchableOpacity, ActivityIndicator, Dimensions, Platform, Modal, Linking, FlatList, PanResponder } from 'react-native';
import { Video } from 'expo-av';
import * as ScreenOrientation from 'expo-screen-orientation';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronLeft, Play, Film, X, Info, ExternalLink, Clock, Star, ChevronDown, User, Building, Monitor, Subtitles, Volume2, Mic, Hash, Languages, Calendar, Fullscreen, Minimize, ChevronLeft as ChevronLeftIcon, ChevronRight } from 'lucide-react-native';
import * as IntentLauncher from 'expo-intent-launcher';

const { width, height } = Dimensions.get('window');

function formatTime(millis) {
  if (!millis && millis !== 0) return '00:00';
  const s = Math.floor(millis / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatRuntime(ticks) {
  if (!ticks) return '';
  const min = Math.round(ticks / 600000000);
  if (min >= 60) return `${Math.floor(min / 60)}h ${min % 60}m`;
  return `${min}m`;
}

function formatBitrate(bps) {
  if (!bps) return '';
  const mbps = bps / 1000000;
  return `${mbps.toFixed(1)} Mbps`;
}

function getResolution(w, h) {
  if (!w || !h) return '';
  if (w >= 3840 || h >= 2160) return '4K';
  if (w >= 1920 || h >= 1080) return '1080p';
  if (w >= 1280 || h >= 720) return '720p';
  if (w >= 720 || h >= 576) return 'SD';
  return `${w}x${h}`;
}

export default function MediaDetailScreen({ route, navigation }) {
  const { itemId, type, title: navTitle, imageUrl, backdropUrl } = route?.params || {};

  const [serverUrl, setServerUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [userId, setUserId] = useState('');
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [seasons, setSeasons] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [activeSeasonId, setActiveSeasonId] = useState(null);
  const [showSeasonPicker, setShowSeasonPicker] = useState(false);
  const [similar, setSimilar] = useState([]);
  const [mediaSource, setMediaSource] = useState(null);

  const [activeVideoUrl, setActiveVideoUrl] = useState(null);
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [resumeTicks, setResumeTicks] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackStats, setPlaybackStats] = useState({ position: 0, duration: 0 });
  const [isPlaying, setIsPlaying] = useState(true);

  const [isFullscreen, setIsFullscreen] = useState(true);
  const [seekDragging, setSeekDragging] = useState(false);
  const [seekDragValue, setSeekDragValue] = useState(0);
  const seekDragRef = useRef({ currentValue: 0, startX: 0 });

  const [subtitleStreams, setSubtitleStreams] = useState([]);
  const [audioStreams, setAudioStreams] = useState([]);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState(-1);
  const [selectedAudioIndex, setSelectedAudioIndex] = useState(0);
  const [showTrackPicker, setShowTrackPicker] = useState(null);

  const [videoCodec, setVideoCodec] = useState('');
  const [videoResolution, setVideoResolution] = useState('');

  const [detectedTextTracks, setDetectedTextTracks] = useState([]);

  const videoRef = useRef(null);
  const playbackStatsRef = useRef({ position: 0, duration: 0 });
  const isMounted = useRef(true);
  const seekPosRef = useRef(-1);
  const seekBarLayoutRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  /* ---------- 键盘控制：返回时退出全屏 ---------- */
  useEffect(() => {
    if (isFullscreen) {
      const sub = navigation.addListener('beforeRemove', (e) => {
        if (isFullscreen) {
          try { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); } catch (err) {}
          setIsFullscreen(false);
        }
      });
      return sub;
    }
  }, [isFullscreen, navigation]);

  /* ---------- 关闭播放器 ---------- */
  const closePlayer = useCallback(async () => {
    if (isFullscreen) {
      try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); } catch (e) {}
      setIsFullscreen(false);
    }
    const st = playbackStatsRef.current;
    if (st && st.duration && activeVideoId) {
      const pct = (st.position / st.duration) * 100;
      if (pct > 1 && pct < 95) {
        const ticks = st.position * 10000;
        try {
          await fetch(`${serverUrl}/Users/${userId}/PlayingItems/${activeVideoId}/Progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Emby-Token': authToken },
            body: JSON.stringify({ PositionTicks: ticks, IsPaused: false, IsMuted: false }),
          });
        } catch (e) {}
      }
    }
    setActiveVideoUrl(null);
    setActiveVideoId(null);
    setShowSettings(false);
    setIsPlaying(true);
    seekPosRef.current = -1;
  }, [isFullscreen, serverUrl, userId, authToken, activeVideoId]);

  /* ---------- 播放/暂停切换 ---------- */
  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  /* ---------- 播放状态回调 ---------- */
  const onPlaybackStatusUpdate = useCallback((status) => {
    if (status.isLoaded) {
      const posMs = (status.positionMillis || 0);
      const durMs = (status.durationMillis || 0);
      playbackStatsRef.current = { position: posMs, duration: durMs };
      if (status.isPlaying !== undefined) {
        setIsPlaying(status.isPlaying);
      }
      if (!seekDragging) {
        setPlaybackStats({ position: posMs, duration: durMs });
      }
    }
    if (status.didJustFinish) {
      setIsPlaying(false);
    }
  }, [seekDragging]);

  /* ---------- 全屏切换 ---------- */
  const toggleFullscreen = useCallback(async () => {
    try {
      if (isFullscreen) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } else {
        await ScreenOrientation.unlockAllOrientationsAsync();
      }
    } catch (e) {}
    setIsFullscreen((prev) => !prev);
  }, [isFullscreen]);

  /* ---------- 全屏切换（点击左上角返回旁边的全屏图标） ---------- */
  const handleFullscreenBtn = useCallback(async () => {
    await toggleFullscreen();
  }, [toggleFullscreen]);

  /* ---------- SeekBar 拖拽 ---------- */
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        setSeekDragging(true);
        const ratio = playbackStatsRef.current.duration > 0
          ? playbackStatsRef.current.position / playbackStatsRef.current.duration
          : 0;
        seekDragRef.current.currentValue = ratio;
        seekDragRef.current.startX = e.nativeEvent.locationX;
      },
      onPanResponderMove: (e, gestureState) => {
        const { width: bw } = seekBarLayoutRef.current;
        if (bw <= 0 || !playbackStatsRef.current.duration) return;
        let newValue = seekDragRef.current.currentValue + (gestureState.dx / bw);
        newValue = Math.max(0, Math.min(1, newValue));
        seekDragRef.current.currentValue = newValue;
        setSeekDragValue(newValue);
      },
      onPanResponderRelease: () => {
        if (playbackStatsRef.current.duration > 0 && videoRef.current) {
          videoRef.current.seek(seekDragRef.current.currentValue * playbackStatsRef.current.duration);
        }
        setSeekDragging(false);
      },
    })
  ).current;

  const onSeekBarLayout = useCallback((event) => {
    seekBarLayoutRef.current = event.nativeEvent.layout;
  }, []);

  /* ---------- 字幕轨道加载 ---------- */
  const onTextTracksLoad = useCallback((event) => {
    if (event?.textTracks) {
      setDetectedTextTracks(event.textTracks);
    }
  }, []);

  const getVideoSelectedTextTrack = useCallback(() => {
    if (selectedSubtitleIndex < 0) return { type: 'disabled' };
    if (detectedTextTracks.length > 0) {
      const matchIdx = detectedTextTracks.findIndex((t) => {
        const streamMatch = subtitleStreams.find((s) =>
          s.DisplayTitle === t.title ||
          s.Language === t.language ||
          (t.rawId !== undefined && s.Index === t.rawId)
        );
        return streamMatch && streamMatch.Index === selectedSubtitleIndex;
      });
      if (matchIdx >= 0) return { type: 'index', value: matchIdx };
    }
    const relIdx = subtitleStreams.findIndex((s) => s.Index === selectedSubtitleIndex);
    if (relIdx >= 0) return { type: 'index', value: relIdx };
    return { type: 'disabled' };
  }, [selectedSubtitleIndex, subtitleStreams, detectedTextTracks]);

  /* ---------- 上下集导航 ---------- */
  const getPrevEpisode = useCallback(() => {
    if (item.Type !== 'Series' || !episodes || episodes.length === 0 || !activeVideoId) return null;
    const idx = episodes.findIndex((ep) => ep.Id === activeVideoId);
    if (idx <= 0) return null;
    return episodes[idx - 1];
  }, [episodes, activeVideoId, item.Type]);

  const getNextEpisode = useCallback(() => {
    if (item.Type !== 'Series' || !episodes || episodes.length === 0 || !activeVideoId) return null;
    const idx = episodes.findIndex((ep) => ep.Id === activeVideoId);
    if (idx < 0 || idx >= episodes.length - 1) return null;
    return episodes[idx + 1];
  }, [episodes, activeVideoId, item.Type]);

  const playEpisode = useCallback(
    (epId, startTicks) => {
      if (!epId) return;
      const ep = episodes.find((e) => e.Id === epId);
      const ticks = startTicks ?? (ep?.UserData?.PlaybackPositionTicks || 0);
      const url = `${serverUrl}/Videos/${epId}/stream?static=true`;
      setActiveVideoUrl(url);
      setActiveVideoId(epId);
      setIsPlaying(true);
      if (ticks > 0) {
        const totalMs = mediaSource?.RunTimeTicks ? mediaSource.RunTimeTicks / 10000 : 0;
        if (totalMs > 0) {
          seekPosRef.current = ticks / 10000 / totalMs;
        }
      } else {
        seekPosRef.current = -1;
      }
    },
    [episodes, serverUrl, mediaSource]
  );

  /* ---------- 其余函数 ---------- */
  useEffect(() => {
    isMounted.current = true;
    loadAndFetch();
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (seekPosRef.current >= 0 && videoRef.current && playbackStatsRef.current.duration > 0) {
      videoRef.current.seek(seekPosRef.current * playbackStatsRef.current.duration);
      seekPosRef.current = -1;
    }
  }, [playbackStats.duration]);

  const loadAndFetch = async () => {
    try {
      const [url, token, uid] = await Promise.all([
        AsyncStorage.getItem('@emby_url'),
        AsyncStorage.getItem('@emby_token'),
        AsyncStorage.getItem('@emby_user_id'),
      ]);
      if (!url || !token || !uid) return;
      setServerUrl(url);
      setAuthToken(token);
      setUserId(uid);
      await fetchItemDetail(url, token, uid);
    } catch (e) {} finally {
      if (isMounted.current) setLoading(false);
    }
  };

  const apiGet = async (url, token, path) => {
    const res = await fetch(`${url}${path}`, { headers: { 'X-Emby-Token': token } });
    if (!res.ok) return null;
    return res.json();
  };

  const fetchItemDetail = async (url, token, uid) => {
    try {
      const data = await apiGet(url, token, `/Users/${uid}/Items/${itemId}?Fields=MediaSources,Studios,Taglines,People,OfficialRating,ProviderIds,Metascore`);
      if (!data || !isMounted.current) return;
      setItem(data);
      setResumeTicks(data.UserData?.PlaybackPositionTicks || 0);

      if (data.Type === 'Series') {
        const seasonsData = await apiGet(url, token, `/Users/${uid}/Items?ParentId=${itemId}&IncludeItemTypes=Season&SortBy=SortName&SortOrder=Ascending`);
        if (seasonsData?.Items) {
          const validSeasons = seasonsData.Items.filter((s) => s.Name !== 'Placeholder');
          setSeasons(validSeasons);
          if (validSeasons.length > 0) {
            setActiveSeasonId(validSeasons[0].Id);
            fetchEpisodes(url, token, uid, validSeasons[0].Id);
          }
        }
      }

      const similarData = await apiGet(url, token, `/Items/${itemId}/Similar?Limit=10`);
      if (similarData?.Items) setSimilar(similarData.Items.filter((s) => s.Id !== itemId).slice(0, 6));

      if (data.MediaSources?.length > 0) {
        const ms = data.MediaSources[0];
        setMediaSource(ms);
        setVideoCodec(ms.VideoCodec || '');
        setVideoResolution(getResolution(ms.Width, ms.Height));
        if (ms.MediaStreams) {
          const subs = ms.MediaStreams.filter((s) => s.Type === 'Subtitle');
          const audios = ms.MediaStreams.filter((s) => s.Type === 'Audio');
          setSubtitleStreams(subs);
          setAudioStreams(audios);
          const defaultSub = subs.find((s) => s.IsDefault);
          setSelectedSubtitleIndex(defaultSub ? defaultSub.Index : -1);
          const defaultAudio = audios.find((s) => s.IsDefault);
          setSelectedAudioIndex(defaultAudio ? defaultAudio.Index : audios[0]?.Index || 0);
        }
      }
    } catch (e) {}
  };

  const fetchEpisodes = async (url, token, uid, seasonId) => {
    try {
      const data = await apiGet(url, token, `/Users/${uid}/Items?ParentId=${seasonId}&IncludeItemTypes=Episode&SortBy=SortName&SortOrder=Ascending`);
      if (data?.Items && isMounted.current) setEpisodes(data.Items);
    } catch (e) {}
  };

  const handleSeasonChange = (seasonId) => {
    setActiveSeasonId(seasonId);
    setShowSeasonPicker(false);
    fetchEpisodes(serverUrl, authToken, userId, seasonId);
  };

  const handlePlay = (videoId, startTicks) => {
    setDetectedTextTracks([]);
    const url = `${serverUrl}/Videos/${videoId}/stream?static=true`;
    setActiveVideoUrl(url);
    setActiveVideoId(videoId);
    setIsPlaying(true);
    if (startTicks && startTicks > 0) {
      const totalMs = mediaSource?.RunTimeTicks ? mediaSource.RunTimeTicks / 10000 : 0;
      if (totalMs > 0) {
        seekPosRef.current = startTicks / 10000 / totalMs;
      }
    } else {
      seekPosRef.current = -1;
    }
  };

  const handleExternalPlay = async () => {
    if (!activeVideoUrl) return;
    if (Platform.OS === 'android') {
      try {
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: activeVideoUrl, type: 'video/*' });
      } catch (e) {
        Linking.openURL(activeVideoUrl);
      }
    } else {
      Linking.openURL(activeVideoUrl);
    }
  };

  const switchAudioTrack = (trackId) => {
    setSelectedAudioIndex(trackId);
    setShowTrackPicker(null);
  };

  const switchSubtitleTrack = (trackId) => {
    setSelectedSubtitleIndex((prev) => {
      if (prev === trackId) return prev;
      return trackId;
    });
    setShowTrackPicker(null);
  };

  /* ---------- 渲染 ---------- */
  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#3b82f6" /></View>;
  if (!item) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#9ca3af', marginBottom: 16 }}>无法加载影片信息</Text>
        <TouchableOpacity style={styles.backBtnTop} onPress={() => navigation.goBack()}><ChevronLeft color="#fff" size={28} /></TouchableOpacity>
      </View>
    );
  }

  const renderPlayer = () => {
    if (!activeVideoUrl) return null;

    const currentRatio = seekDragging ? seekDragValue : playbackStats.duration > 0 ? playbackStats.position / playbackStats.duration : 0;
    const currentMs = seekDragging ? seekDragValue * (playbackStats.duration || 0) : playbackStats.position;
    const isSeries = item.Type === 'Series';
    const prevEp = getPrevEpisode();
    const nextEp = getNextEpisode();

    return (
      <View style={[styles.playerWrap, isFullscreen && styles.playerWrapFullscreen]}>
        <View style={[styles.playerInner, isFullscreen && styles.playerInnerFullscreen]}>
          {/* 顶部栏 */}
          <View style={[styles.playerTopBar, !isFullscreen && styles.playerTopBarNonFullscreen]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TouchableOpacity style={styles.iconBtnLayer} onPress={closePlayer}><X color="#ffffff" size={24} /></TouchableOpacity>
              <Text style={styles.playerTopTitle} numberOfLines={1}>{item.Name || navTitle}</Text>
            </View>
            <TouchableOpacity style={styles.iconBtnLayer} onPress={() => setShowSettings(true)}><Info color="#ffffff" size={22} /></TouchableOpacity>
          </View>

          {/* 视频+seekbar */}
          <TouchableOpacity activeOpacity={1} style={styles.videoContainer} onPress={togglePlay}>
            <Video
              ref={videoRef}
              style={[styles.video, isFullscreen && styles.videoFullscreen]}
              source={{ uri: activeVideoUrl, headers: { 'X-Emby-Token': authToken } }}
              shouldPlay={isPlaying}
              resizeMode={isFullscreen ? 'cover' : 'contain'}
              useNativeControls={false}
              onPlaybackStatusUpdate={onPlaybackStatusUpdate}
              onTextTracksLoad={onTextTracksLoad}
              onError={(e) => console.warn('Video Error:', JSON.stringify(e))}
              audioOutput="speaker"
              selectedTextTrack={getVideoSelectedTextTrack()}
              selectedAudioTrack={{ type: 'index', value: audioStreams.findIndex((s) => s.Index === selectedAudioIndex) >= 0 ? audioStreams.findIndex((s) => s.Index === selectedAudioIndex) : 0 }}
            />

            {/* 中央播放/暂停 */}
            <View style={styles.playPauseOverlay}>
              <TouchableOpacity style={styles.playPauseBtn} onPress={togglePlay}>
                {isPlaying ? <Pause color="#ffffff" size={isFullscreen ? 48 : 36} strokeWidth={2} /> : <Play color="#ffffff" size={isFullscreen ? 48 : 36} fill="#ffffff" strokeWidth={2} />}
              </TouchableOpacity>
            </View>

            {/* seekbar */}
            <View style={[styles.seekBarWrap, !isFullscreen && styles.seekBarWrapNonFullscreen]} onLayout={onSeekBarLayout}>
              {seekDragging && (
                <View style={styles.seekBarPreview}>
                  <Text style={styles.seekBarPreviewText}>{formatTime(seekDragValue * (playbackStats.duration || 0))}</Text>
                </View>
              )}
              <View style={styles.seekBarTrack}>
                <View style={[styles.seekBarBuffer, { width: `${currentRatio * 100}%` }]} />
                <View style={[styles.seekBarProgress, { width: `${seekDragging ? seekDragValue * 100 : currentRatio * 100}%` }]} />
                <View style={styles.seekBarKnobArea} {...panResponder.panHandlers}>
                  <View style={styles.seekBarKnob} />
                </View>
              </View>
            </View>

            {/* 左上角：返回 + 全屏按钮（全屏时） */}
            {isFullscreen && (
              <View style={styles.playerTopBarOverlay}>
                <TouchableOpacity style={styles.iconBtnLayer} onPress={closePlayer}><X color="#ffffff" size={26} /></TouchableOpacity>
                <Text style={styles.playerTopTitleOverlay} numberOfLines={1}>{item.Name || navTitle}</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* 底部控制栏 */}
          <View style={[styles.playerControlsBar, !isFullscreen && styles.playerControlsBarNonFullscreen]}>
            {/* 时间 */}
            <Text style={styles.playerInfoText}>
              {formatTime(currentMs)} / {formatTime(playbackStats.duration)}
            </Text>

            {/* 左下角：上一集 / 下一集 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {prevEp && (
                <TouchableOpacity
                  style={[styles.controlBtn, styles.prevNextBtn]}
                  onPress={() => playEpisode(prevEp.Id, prevEp.UserData?.PlaybackPositionTicks || 0)}
                >
                  <ChevronLeftIcon color="#ffffff" size={isFullscreen ? 22 : 18} />
                  <Text style={[styles.controlBtnText, isFullscreen && styles.controlBtnTextLg]}>上集</Text>
                </TouchableOpacity>
              )}
              {nextEp && (
                <TouchableOpacity
                  style={[styles.controlBtn, styles.prevNextBtn]}
                  onPress={() => playEpisode(nextEp.Id, nextEp.UserData?.PlaybackPositionTicks || 0)}
                >
                  <Text style={[styles.controlBtnText, isFullscreen && styles.controlBtnTextLg]}>下集</Text>
                  <ChevronRight color="#ffffff" size={isFullscreen ? 22 : 18} />
                </TouchableOpacity>
              )}
            </View>

            {/* 右下角区域：字幕/音轨/全屏 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {subtitleStreams.length > 0 && (
                <TouchableOpacity style={[styles.controlBtn, styles.trackBtn]} onPress={() => setShowTrackPicker('subtitle')}>
                  <Subtitles color={selectedSubtitleIndex >= 0 ? '#fbbf24' : '#ffffff'} size={isFullscreen ? 22 : 18} />
                  <Text style={[styles.controlBtnText, isFullscreen && styles.controlBtnTextLg]}>字幕</Text>
                </TouchableOpacity>
              )}
              {audioStreams.length > 1 && (
                <TouchableOpacity style={[styles.controlBtn, styles.trackBtn]} onPress={() => setShowTrackPicker('audio')}>
                  <Volume2 color="#ffffff" size={isFullscreen ? 22 : 18} />
                  <Text style={[styles.controlBtnText, isFullscreen && styles.controlBtnTextLg]}>音轨</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.controlBtn, styles.fullscreenBtn]} onPress={handleFullscreenBtn}>
                {isFullscreen ? <Minimize color="#ffffff" size={isFullscreen ? 22 : 18} /> : <Fullscreen color="#ffffff" size={isFullscreen ? 22 : 18} />}
                <Text style={[styles.controlBtnText, isFullscreen && styles.controlBtnTextLg]}>
                  {isFullscreen ? '退出' : '全屏'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 设置弹窗 */}
          <Modal visible={showSettings} transparent animationType="slide">
            <View style={styles.settingsOverlay}>
              <View style={styles.settingsPanel}>
                <View style={styles.settingsHeader}>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>播放信息</Text>
                  <TouchableOpacity onPress={() => setShowSettings(false)}><X color="#9ca3af" size={24} /></TouchableOpacity>
                </View>
                <View style={{ padding: 20 }}>
                  <View style={styles.statBox}><Info color="#3b82f6" size={16} /><Text style={styles.statLabel}>进度</Text></View>
                  <Text style={styles.statText}>{formatTime(playbackStats.position)} / {formatTime(playbackStats.duration)}</Text>
                  {videoCodec ? (
                    <>
                      <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 12 }} />
                      <View style={styles.statBox}><Monitor color="#3b82f6" size={16} /><Text style={styles.statLabel}>视频</Text></View>
                      <Text style={styles.statText}>{videoCodec.toUpperCase()} {videoResolution}</Text>
                    </>
                  ) : null}
                  {primaryAudio ? (
                    <>
                      <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 12 }} />
                      <View style={styles.statBox}><Mic color="#3b82f6" size={16} /><Text style={styles.statLabel}>音频</Text></View>
                      <Text style={styles.statText}>{primaryAudio.DisplayTitle || `${primaryAudio.Codec?.toUpperCase() || ''} ${primaryAudio.ChannelCount ? primaryAudio.ChannelCount + 'ch' : ''}`.trim()}</Text>
                    </>
                  ) : null}
                  {mediaSource?.Container ? (
                    <>
                      <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 12 }} />
                      <View style={styles.statBox}><Hash color="#3b82f6" size={16} /><Text style={styles.statLabel}>封装</Text></View>
                      <Text style={styles.statText}>{mediaSource.Container.toUpperCase()}</Text>
                    </>
                  ) : null}
                  {mediaSource?.Bitrate ? (
                    <>
                      <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 12 }} />
                      <View style={styles.statBox}><ActivityIndicator size={14} color="#3b82f6" /><Text style={styles.statLabel}>码率</Text></View>
                      <Text style={styles.statText}>{formatBitrate(mediaSource.Bitrate)}</Text>
                    </>
                  ) : null}
                  <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 16 }} />
                  <TouchableOpacity style={styles.externalBtn} onPress={handleExternalPlay}>
                    <ExternalLink color="#fff" size={16} style={{ marginRight: 8 }} />
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>使用第三方播放器</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* 轨道选择弹窗 */}
          <Modal visible={showTrackPicker !== null} transparent animationType="fade">
            <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowTrackPicker(null)}>
              <View style={styles.pickerPanel}>
                <Text style={{ color: '#9ca3af', fontSize: 13, fontWeight: 'bold', marginBottom: 12 }}>
                  {showTrackPicker === 'subtitle' ? '选择字幕' : '选择音轨'}
                </Text>
                {showTrackPicker === 'subtitle' ? (
                  <>
                    <TouchableOpacity
                      style={[styles.pickerItem, selectedSubtitleIndex === -1 && styles.pickerItemActive]}
                      onPress={() => switchSubtitleTrack(-1)}
                    >
                      <Text
                        style={{
                          color: selectedSubtitleIndex === -1 ? '#3b82f6' : '#e5e7eb',
                          fontWeight: selectedSubtitleIndex === -1 ? 'bold' : 'normal',
                        }}
                      >
                        关闭字幕
                      </Text>
                    </TouchableOpacity>
                    {subtitleStreams.map((s) => (
                      <TouchableOpacity
                        key={s.Index}
                        style={[styles.pickerItem, selectedSubtitleIndex === s.Index && styles.pickerItemActive]}
                        onPress={() => switchSubtitleTrack(s.Index)}
                      >
                        <Text
                          style={{
                            color: selectedSubtitleIndex === s.Index ? '#3b82f6' : '#e5e7eb',
                            fontWeight: selectedSubtitleIndex === s.Index ? 'bold' : 'normal',
                          }}
                        >
                          {s.DisplayTitle || `${s.Language || ''} ${s.Codec?.toUpperCase() || ''}`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </>
                ) : (
                  audioStreams.map((s) => (
                    <TouchableOpacity
                      key={s.Index}
                      style={[styles.pickerItem, selectedAudioIndex === s.Index && styles.pickerItemActive]}
                      onPress={() => switchAudioTrack(s.Index)}
                    >
                      <Text
                        style={{
                          color: selectedAudioIndex === s.Index ? '#3b82f6' : '#e5e7eb',
                          fontWeight: selectedAudioIndex === s.Index ? 'bold' : 'normal',
                        }}
                      >
                        {s.DisplayTitle || `${s.Language || ''} ${s.Codec?.toUpperCase() || ''} ${s.ChannelCount ? s.ChannelCount + 'ch' : ''}`}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            </TouchableOpacity>
          </Modal>
        </View>
      </View>
    );
  };

  /* ---------- 详情页 ---------- */
  const img = (id, type, w = width) =>
    `${serverUrl}/Items/${id}/Images/${type}?api_key=${authToken}&width=${Math.round(w)}`;

  const primaryAudio = audioStreams.find((s) => s.Index === selectedAudioIndex) || audioStreams[0];
  const streamInfo = [];
  if (videoCodec) streamInfo.push({ icon: <Monitor color="#3b82f6" size={14} />, label: `${videoCodec.toUpperCase()} ${videoResolution}` });
  if (primaryAudio) {
    let audLabel = primaryAudio.Codec?.toUpperCase() || '';
    if (primaryAudio.ChannelCount) audLabel += ` ${primaryAudio.ChannelCount}ch`;
    if (primaryAudio.DisplayTitle) audLabel = primaryAudio.DisplayTitle;
    streamInfo.push({ icon: <Mic color="#3b82f6" size={14} />, label: audLabel });
  }
  if (mediaSource?.Bitrate)
    streamInfo.push({ icon: <ActivityIndicator size={14} color="#3b82f6" />, label: formatBitrate(mediaSource.Bitrate) });

  const directors = item?.People?.filter((p) => p.Type === 'Director') || [];
  const cast = item?.People?.filter((p) => p.Type === 'Actor' || p.Type === 'Performer') || [];
  const studios = item?.Studios || [];
  const tagline = item?.Taglines?.[0] || '';
  const officialRating = item?.OfficialRating || '';

  return (
    <View style={styles.container}>
      {/* ===== 播放部分 ===== */}
      {renderPlayer()}

      {/* ===== 详情部分 ===== */}
      <ScrollView style={styles.scroll}>
        <View style={styles.hero}>
          <Image source={{ uri: backdropUrl || img(itemId, 'Backdrop', width) }} style={styles.backdrop} />
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.heroOverlay} />
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <ChevronLeft color="#ffffff" size={30} />
          </TouchableOpacity>
          <View style={styles.heroContent}>
            <Image source={{ uri: imageUrl || img(itemId, 'Primary', 240) }} style={styles.poster} />
            <View style={styles.heroText}>
              <Text style={styles.title} numberOfLines={2}>
                {item.Name || navTitle}
              </Text>
              {tagline ? (
                <Text style={{ color: '#9ca3af', fontSize: 12, fontStyle: 'italic', marginBottom: 4 }}>{tagline}</Text>
              ) : null}
              <View style={styles.metaRow}>
                {item.ProductionYear ? <Text style={styles.meta}>{item.ProductionYear}</Text> : null}
                {item.CommunityRating ? (
                  <View style={styles.ratingBadge}>
                    <Star color="#fff" size={11} fill="#fff" style={{ marginRight: 2 }} />
                    <Text style={styles.ratingText}>{item.CommunityRating.toFixed(1)}</Text>
                  </View>
                ) : null}
                {officialRating ? <Text style={styles.meta}>{officialRating}</Text> : null}
                {item.RunTimeTicks ? <Text style={styles.meta}>{formatRuntime(item.RunTimeTicks)}</Text> : null}
              </View>
            </View>
          </View>
        </View>

        {item.Genres?.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.genreRow} contentContainerStyle={{ paddingHorizontal: 20 }}>
            {item.Genres.map((g, i) => (
              <View key={i} style={styles.genreChip}>
                <Text style={styles.genreText}>{g}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {item.Type === 'Series' ? (
          <View style={{ marginHorizontal: 20, marginTop: 14 }}>
            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => {
                const nextEp = episodes.find((e) => !e.UserData?.Played);
                if (nextEp) handlePlay(nextEp.Id, nextEp.UserData?.PlaybackPositionTicks || 0);
                else if (episodes.length > 0) handlePlay(episodes[0].Id, 0);
              }}
            >
              <Play color="#fff" size={20} fill="#fff" />
              <Text style={styles.playText}>播放下一集</Text>
            </TouchableOpacity>
            <Text style={{ color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 6 }}>或在下方选择剧集</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.playBtn} onPress={() => handlePlay(itemId, resumeTicks)}>
            {resumeTicks > 0 ? (
              <>
                <Clock color="#fff" size={20} />
                <Text style={styles.playText}>继续播放 ({formatTime(resumeTicks / 10000)})</Text>
              </>
            ) : (
              <>
                <Play color="#fff" size={20} fill="#fff" />
                <Text style={styles.playText}>立即播放</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {streamInfo.length > 0 && (
          <View style={styles.streamInfoRow}>
            {streamInfo.map((s, i) => (
              <View key={i} style={styles.streamInfoChip}>
                {s.icon}
                <Text style={styles.streamInfoText}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        {item.Overview ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>简介</Text>
            <Text style={styles.overview}>{item.Overview}</Text>
          </View>
        ) : null}

        {(directors.length > 0 || studios.length > 0 || cast.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>详细信息</Text>
            {directors.length > 0 && (
              <View style={styles.metaLine}>
                <User color="#6b7280" size={14} />
                <Text style={styles.metaLineLabel}>导演</Text>
                <Text style={styles.metaLineValue}>{directors.map((d) => d.Name).join('、')}</Text>
              </View>
            )}
            {studios.length > 0 && (
              <View style={styles.metaLine}>
                <Building color="#6b7280" size={14} />
                <Text style={styles.metaLineLabel}>出品</Text>
                <Text style={styles.metaLineValue}>{studios.map((s) => s.Name).join('、')}</Text>
              </View>
            )}
            {cast.length > 0 && (
              <View style={styles.metaLine}>
                <Star color="#6b7280" size={14} />
                <Text style={styles.metaLineLabel}>主演</Text>
                <Text style={styles.metaLineValue}>{cast.slice(0, 6).map((p) => p.Name).join('、')}</Text>
              </View>
            )}
            {streamInfo.length > 0 && (
              <View style={styles.metaLine}>
                <Monitor color="#6b7280" size={14} />
                <Text style={styles.metaLineLabel}>画质</Text>
                <Text style={styles.metaLineValue}>{streamInfo.map((s) => s.label).join(' | ')}</Text>
              </View>
            )}
            {subtitleStreams.length > 0 && (
              <View style={styles.metaLine}>
                <Languages color="#6b7280" size={14} />
                <Text style={styles.metaLineLabel}>字幕</Text>
                <Text style={styles.metaLineValue}>{subtitleStreams.map((s) => s.Language || s.Codec || '未知').join('、')}</Text>
              </View>
            )}
          </View>
        )}

        {item.Type === 'Series' && (
          <View style={styles.section}>
            <TouchableOpacity style={styles.seasonPicker} onPress={() => setShowSeasonPicker(true)}>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                季度 {seasons.findIndex((s) => s.Id === activeSeasonId) + 1}:{' '}
                {seasons.find((s) => s.Id === activeSeasonId)?.Name || '未知'}
              </Text>
              <ChevronDown color="#9ca3af" size={20} />
            </TouchableOpacity>
            {episodes.map((ep) => (
              <TouchableOpacity
                key={ep.Id}
                style={styles.episodeCard}
                onPress={() => handlePlay(ep.Id, ep.UserData?.PlaybackPositionTicks || 0)}
              >
                <Image source={{ uri: img(ep.Id, 'Primary', 160) }} style={styles.episodePoster} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.epTitle} numberOfLines={1}>
                    {ep.IndexNumber ? `${ep.IndexNumber}. ` : ''}
                    {ep.Name}
                  </Text>
                  <Text style={styles.epSub}>{formatRuntime(ep.RunTimeTicks)}</Text>
                  {ep.Overview ? <Text style={styles.epOverview} numberOfLines={2}>{ep.Overview}</Text> : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {similar.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>相似推荐</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {similar.map((s) => (
                <TouchableOpacity
                  key={s.Id}
                  style={{ width: 110, marginRight: 12 }}
                  onPress={() =>
                    navigation.replace('MediaDetail', {
                      itemId: s.Id,
                      type: s.Type,
                      title: s.Name,
                      imageUrl: img(s.Id, 'Primary', 220),
                      backdropUrl: img(s.Id, 'Backdrop', 800),
                    })
                  }
                >
                  <Image
                    source={{ uri: img(s.Id, 'Primary', 220) }}
                    style={{ width: 110, height: 165, borderRadius: 8, backgroundColor: '#374151' }}
                  />
                  <Text style={{ color: '#e5e7eb', fontSize: 11, marginTop: 4, fontWeight: '500' }} numberOfLines={1}>
                    {s.Name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 50 }} />
      </ScrollView>

      <Modal visible={showSeasonPicker} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowSeasonPicker(false)}>
          <View style={styles.pickerPanel}>
            <Text style={{ color: '#9ca3af', fontSize: 13, fontWeight: 'bold', marginBottom: 12 }}>选择季度</Text>
            {seasons.map((s, i) => (
              <TouchableOpacity
                key={s.Id}
                style={[styles.pickerItem, activeSeasonId === s.Id && styles.pickerItemActive]}
                onPress={() => handleSeasonChange(s.Id)}
              >
                <Text style={{ color: activeSeasonId === s.Id ? '#3b82f6' : '#e5e7eb', fontWeight: activeSeasonId === s.Id ? 'bold' : 'normal' }}>
                  季度 {i + 1}: {s.Name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
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
  backBtn: { position: 'absolute', top: 50, left: 16, zIndex: 10, padding: 8 },
  backBtnTop: { position: 'absolute', top: 50, left: 16, padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  heroContent: { flexDirection: 'row', alignItems: 'flex-end', zIndex: 5 },
  poster: { width: 100, height: 150, borderRadius: 10, borderWidth: 2, borderColor: '#374151', elevation: 8 },
  heroText: { flex: 1, marginLeft: 14 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  meta: { color: '#d1d5db', fontSize: 13, marginRight: 10, fontWeight: '500' },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(245, 158, 11, 0.2)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, marginRight: 10 },
  ratingText: { color: '#f59e0b', fontSize: 12, fontWeight: 'bold' },
  genreRow: { marginTop: 14, marginBottom: 4 },
  genreChip: { backgroundColor: 'rgba(59, 130, 246, 0.15)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, marginRight: 8, borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.3)' },
  genreText: { color: '#60a5fa', fontSize: 12, fontWeight: '600' },
  playBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e50914', marginHorizontal: 20, marginTop: 14, paddingVertical: 13, borderRadius: 8, elevation: 3 },
  playText: { color: '#ffffff', fontSize: 17, fontWeight: 'bold', marginLeft: 8 },
  streamInfoRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 20, marginTop: 12, gap: 8 },
  streamInfoChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(59, 130, 246, 0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.2)' },
  streamInfoText: { color: '#93c5fd', fontSize: 11, fontWeight: '600', marginLeft: 5 },
  section: { padding: 20, paddingBottom: 0 },
  sectionTitle: { color: '#ffffff', fontSize: 17, fontWeight: 'bold', marginBottom: 12 },
  overview: { color: '#9ca3af', fontSize: 14, lineHeight: 22 },
  metaLine: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  metaLineLabel: { color: '#6b7280', fontSize: 13, fontWeight: 'bold', marginLeft: 6, width: 40 },
  metaLineValue: { color: '#d1d5db', fontSize: 13, flex: 1 },
  seasonPicker: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1f2937', padding: 14, borderRadius: 10, marginBottom: 14 },
  episodeCard: { flexDirection: 'row', backgroundColor: '#1f2937', padding: 12, borderRadius: 10, marginBottom: 10 },
  episodePoster: { width: 80, height: 45, borderRadius: 6, backgroundColor: '#374151' },
  epTitle: { color: '#e5e7eb', fontSize: 14, fontWeight: 'bold' },
  epSub: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  epOverview: { color: '#6b7280', fontSize: 11, marginTop: 4, lineHeight: 16 },

  /* -------- 播放器 -------- */
  playerWrap: { position: 'absolute', top: 0, left: 0, width, zIndex: 999, backgroundColor: '#000' },
  playerWrapFullscreen: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 9999, backgroundColor: '#000' },
  playerInner: { flex: 1, justifyContent: 'center', position: 'relative' },
  playerInnerFullscreen: { flex: 1 },

  /* 非全屏：高度 220 */
  playerTopBar: { position: 'absolute', top: 0, left: 0, width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: Platform.OS === 'ios' ? 50 : 12, paddingBottom: 8, zIndex: 1000 },
  playerTopBarNonFullscreen: { position: 'absolute', top: 0 },

  /* 全屏：顶部 */
  playerTopBarOverlay: { position: 'absolute', top: Platform.OS === 'ios' ? 50 : 30, left: 0, width: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, zIndex: 1001, gap: 8 },
  playerTopTitleOverlay: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1, marginLeft: 4 },
  playerTopTitle: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1, marginLeft: 4 },

  /* 视频 */
  videoContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  video: { width: '100%', height: 220 },
  videoFullscreen: { width: '100%', height: '100%' },

  /* 中央播放/暂停 */
  playPauseOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', zIndex: 1002 },
  playPauseBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },

  /* seekbar */
  seekBarWrap: { position: 'absolute', bottom: 50, left: 0, right: 0, zIndex: 1001, paddingHorizontal: 16 },
  seekBarWrapNonFullscreen: { bottom: 8 },
  seekBarTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden', flexDirection: 'row' },
  seekBarBuffer: { height: '100%', backgroundColor: 'rgba(255,255,255,0.15)' },
  seekBarProgress: { height: '100%', backgroundColor: '#3b82f6' },
  seekBarKnobArea: { position: 'absolute', top: -6, left: 0, right: 0, bottom: -6, justifyContent: 'center' },
  seekBarKnob: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff', borderWidth: 2, borderColor: '#3b82f6', alignSelf: 'center' },
  seekBarPreview: { position: 'absolute', bottom: 20, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  seekBarPreviewText: { color: '#fff', fontSize: 12 },

  /* 底部控制栏 */
  playerControlsBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 6, zIndex: 1000 },
  playerControlsBarNonFullscreen: { position: 'absolute', bottom: 0 },
  playerInfoText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '500', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4 },

  /* 控制按钮 */
  controlBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  trackBtn: {},
  fullscreenBtn: {},
  prevNextBtn: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  controlBtnText: { color: '#e5e7eb', fontSize: 12, fontWeight: '500' },
  controlBtnTextLg: { fontSize: 14 },

  /* 设置弹窗 */
  settingsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  settingsPanel: { backgroundColor: '#1f2937', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#374151' },
  statBox: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  statLabel: { color: '#e5e7eb', fontSize: 15, fontWeight: 'bold', marginLeft: 8 },
  statText: { color: '#9ca3af', fontSize: 13, marginBottom: 4 },
  externalBtn: { flexDirection: 'row', backgroundColor: '#8b5cf6', padding: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  pickerPanel: { backgroundColor: '#1f2937', borderRadius: 16, padding: 20, elevation: 10 },
  pickerItem: { paddingVertical: 13, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4 },
  pickerItemActive: { backgroundColor: 'rgba(59, 130, 246, 0.15)' },
});