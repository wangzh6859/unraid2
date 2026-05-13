import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, ScrollView, Image, TouchableOpacity, ActivityIndicator, Dimensions, Platform, Modal, Linking, PanResponder } from 'react-native';
import { Video } from 'expo-av';
import * as ScreenOrientation from 'expo-screen-orientation';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronLeft, Play, Film, X, Info, ExternalLink, Clock, Star, ChevronDown, User, Building, Monitor, Subtitles, Volume2, Mic, Hash, Languages, Fullscreen, Minimize, ChevronRight } from 'lucide-react-native';
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

  const videoRef = useRef(null);
  const playbackStatsRef = useRef({ position: 0, duration: 0 });
  const isMounted = useRef(true);
  const seekPosRef = useRef(-1);
  const seekBarLayoutRef = useRef({ width: 0 });

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

  /* ---------- SeekBar PanResponder ---------- */
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setSeekDragging(true);
        const d = playbackStatsRef.current.duration;
        seekDragRef.current.currentValue = d > 0 ? playbackStatsRef.current.position / d : 0;
      },
      onPanResponderMove: (_, gestureState) => {
        const bw = seekBarLayoutRef.current.width;
        if (bw <= 0) return;
        let nv = seekDragRef.current.currentValue + gestureState.dx / bw;
        nv = nv < 0 ? 0 : nv > 1 ? 1 : nv;
        seekDragRef.current.currentValue = nv;
        setSeekDragValue(nv);
      },
      onPanResponderRelease: () => {
        const d = playbackStatsRef.current.duration;
        if (d > 0 && videoRef.current) {
          videoRef.current.seek(seekDragRef.current.currentValue * d);
        }
        setSeekDragging(false);
      },
    })
  ).current;

  const onSeekBarLayout = useCallback((e) => {
    seekBarLayoutRef.current = { width: e.nativeEvent.layout.width };
  }, []);

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
        try {
          await fetch(`${serverUrl}/Users/${userId}/PlayingItems/${activeVideoId}/Progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Emby-Token': authToken },
            body: JSON.stringify({ PositionTicks: Math.round(st.position * 10000), IsPaused: false, IsMuted: false }),
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

  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);

  /* ---------- 播放状态回调 ---------- */
  const onPlaybackStatusUpdate = useCallback((status) => {
    if (!status.isLoaded) return;
    const pos = status.positionMillis || 0;
    const dur = status.durationMillis || 0;
    playbackStatsRef.current = { position: pos, duration: dur };
    if (status.isPlaying !== undefined) setIsPlaying(status.isPlaying);
    if (!seekDragging) setPlaybackStats({ position: pos, duration: dur });
    if (status.didJustFinish) setIsPlaying(false);
  }, [seekDragging]);

  /* ---------- 数据加载 ---------- */
  useEffect(() => {
    isMounted.current = true;
    (async () => {
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
        // fetch item detail
        const data = await fetch(`${url}/Users/${uid}/Items/${itemId}?Fields=MediaSources,Studios,Taglines,People,OfficialRating,ProviderIds,Metascope`, {
          headers: { 'X-Emby-Token': token },
        }).then((r) => (r.ok ? r.json() : null));
        if (!data || !isMounted.current) return;
        setItem(data);
        setResumeTicks(data.UserData?.PlaybackPositionTicks || 0);

        if (data.Type === 'Series') {
          const sd = await fetch(`${url}/Users/${uid}/Items?ParentId=${itemId}&IncludeItemTypes=Season&SortBy=SortName&SortOrder=Ascending`, {
            headers: { 'X-Emby-Token': token },
          }).then((r) => (r.ok ? r.json() : null));
          if (sd?.Items) {
            const valid = sd.Items.filter((s) => s.Name !== 'Placeholder');
            setSeasons(valid);
            if (valid.length > 0) {
              setActiveSeasonId(valid[0].Id);
              const ep = await fetch(`${url}/Users/${uid}/Items?ParentId=${valid[0].Id}&IncludeItemTypes=Episode&SortBy=SortName&SortOrder=Ascending`, {
                headers: { 'X-Emby-Token': token },
              }).then((r) => (r.ok ? r.json() : null));
              if (ep?.Items && isMounted.current) setEpisodes(ep.Items);
            }
          }
        }

        const sim = await fetch(`${url}/Items/${itemId}/Similar?Limit=10`, {
          headers: { 'X-Emby-Token': token },
        }).then((r) => (r.ok ? r.json() : null));
        if (sim?.Items) setSimilar(sim.Items.filter((s) => s.Id !== itemId).slice(0, 6));

        if (data.MediaSources?.length > 0) {
          const ms = data.MediaSources[0];
          setMediaSource(ms);
          setVideoCodec(ms.VideoCodec || '');
          setVideoResolution(getResolution(ms.Width, ms.Height));
          if (ms.MediaStreams) {
            const subs = ms.MediaStreams.filter((s) => s.Type === 'Subtitle');
            const auds = ms.MediaStreams.filter((s) => s.Type === 'Audio');
            setSubtitleStreams(subs);
            setAudioStreams(auds);
            const ds = subs.find((s) => s.IsDefault);
            setSelectedSubtitleIndex(ds ? ds.Index : -1);
            const da = auds.find((s) => s.IsDefault);
            setSelectedAudioIndex(da ? da.Index : (auds[0]?.Index || 0));
          }
        }
      } catch (e) {
        console.warn('loadAndFetch error:', e);
      } finally {
        if (isMounted.current) setLoading(false);
      }
    })();
    return () => {
      isMounted.current = false;
    };
  }, []);

  /* ---------- 初始 seek ---------- */
  useEffect(() => {
    if (seekPosRef.current >= 0 && videoRef.current && playbackStatsRef.current.duration > 0) {
      videoRef.current.seek(seekPosRef.current * playbackStatsRef.current.duration);
      seekPosRef.current = -1;
    }
  }, [playbackStats.duration]);

  const handlePlay = (videoId, startTicks) => {
    setDetectedSubtitle(null);
    const url = `${serverUrl}/Videos/${videoId}/stream?static=true`;
    setActiveVideoUrl(url);
    setActiveVideoId(videoId);
    setIsPlaying(true);
    if (startTicks && startTicks > 0) {
      const totalMs = mediaSource?.RunTimeTicks ? mediaSource.RunTimeTicks / 10000 : 0;
      seekPosRef.current = totalMs > 0 ? startTicks / 10000 / totalMs : 0;
    } else {
      seekPosRef.current = -1;
    }
  };

  // 当前播放的 videoId 对应的剧集索引
  const currentEpisodeIndex = item?.Type === 'Series' ? episodes.findIndex((ep) => ep.Id === activeVideoId) : -1;
  const prevEp = currentEpisodeIndex > 0 ? episodes[currentEpisodeIndex - 1] : null;
  const nextEp = currentEpisodeIndex >= 0 && currentEpisodeIndex < episodes.length - 1 ? episodes[currentEpisodeIndex + 1] : null;

  const handleExternalPlay = async () => {
    if (!activeVideoUrl) return;
    try {
      if (Platform.OS === 'android') {
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: activeVideoUrl, type: 'video/*' });
      } else {
        Linking.openURL(activeVideoUrl);
      }
    } catch {
      Linking.openURL(activeVideoUrl);
    }
  };

  const switchAudioTrack = (trackId) => {
    setSelectedAudioIndex(trackId);
    setShowTrackPicker(null);
  };

  const switchSubtitleTrack = (trackId) => {
    setSelectedSubtitleIndex((prev) => (prev === trackId ? prev : trackId));
    setShowTrackPicker(null);
  };

  /* ---------- 字幕轨道检测（安全降级） ---------- */
  const [detectedSubtitle, setDetectedSubtitle] = useState(null);
  const onTextTracksLoad = useCallback((event) => {
    if (event?.textTracks && event.textTracks.length > 0) {
      setDetectedSubtitle(event.textTracks);
    }
  }, []);

  const getSelectedTextTrack = useCallback(() => {
    if (selectedSubtitleIndex < 0) return { type: 'disabled' };
    if (detectedSubtitle && detectedSubtitle.length > 0) {
      for (let i = 0; i < detectedSubtitle.length; i++) {
        const t = detectedSubtitle[i];
        const match = subtitleStreams.find(
          (s) => s.DisplayTitle === t.title || s.Language === t.language || s.Id === t.id || s.Index === t.rawId
        );
        if (match && match.Index === selectedSubtitleIndex) {
          return { type: 'index', value: i };
        }
      }
    }
    const ri = subtitleStreams.findIndex((s) => s.Index === selectedSubtitleIndex);
    return ri >= 0 ? { type: 'index', value: ri } : { type: 'disabled' };
  }, [selectedSubtitleIndex, subtitleStreams, detectedSubtitle]);

  /* ---------- 渲染播放器 ---------- */
  const renderPlayer = () => {
    if (!activeVideoUrl) return null;
    const ratio = seekDragging ? seekDragValue : playbackStats.duration > 0 ? playbackStats.position / playbackStats.duration : 0;
    const curMs = seekDragging ? seekDragValue * (playbackStats.duration || 0) : playbackStats.position;
    const isSeries = item?.Type === 'Series';

    return (
      <View style={[styles.playerWrap, isFullscreen && styles.playerWrapFullscreen]}>
        <View style={[styles.playerInner, isFullscreen && styles.playerInnerFullscreen]}>
          {/* 顶部栏 */}
          <View style={styles.playerTopBar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity style={styles.iconBtn} onPress={closePlayer}>
                <X color="#fff" size={24} />
              </TouchableOpacity>
              <Text style={styles.topTitle} numberOfLines={1}>
                {item?.Name || navTitle}
              </Text>
            </View>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setShowSettings(true)}>
              <Info color="#fff" size={22} />
            </TouchableOpacity>
          </View>

          {/* 视频 */}
          <TouchableOpacity activeOpacity={1} style={styles.videoWrap} onPress={togglePlay}>
            <Video
              ref={videoRef}
              style={styles.video}
              source={{ uri: activeVideoUrl, headers: { 'X-Emby-Token': authToken } }}
              shouldPlay={isPlaying}
              resizeMode={isFullscreen ? 'cover' : 'contain'}
              useNativeControls={false}
              onPlaybackStatusUpdate={onPlaybackStatusUpdate}
              onTextTracksLoad={onTextTracksLoad}
              onError={(e) => console.warn('Video error:', e)}
              audioOutput="speaker"
              selectedTextTrack={getSelectedTextTrack()}
            />
            {/* 中央播放/暂停 */}
            <View style={styles.playCenter}>
              <TouchableOpacity style={styles.playBtn} onPress={togglePlay}>
                {isPlaying ? (
                  <Pause color="#fff" size={isFullscreen ? 48 : 36} strokeWidth={2} />
                ) : (
                  <Play color="#fff" size={isFullscreen ? 48 : 36} fill="#fff" />
                )}
              </TouchableOpacity>
            </View>

            {/* seekbar */}
            <View style={[styles.seekWrap, !isFullscreen && styles.seekWrapSmall]} onLayout={onSeekBarLayout}>
              {seekDragging && (
                <View style={seekStyles.preview}>
                  <Text style={seekStyles.previewText}>{formatTime(seekDragValue * (playbackStats.duration || 0))}</Text>
                </View>
              )}
              <View style={seekStyles.track}>
                <View style={[seekStyles.buf, { width: `${ratio * 100}%` }]} />
                <View style={[seekStyles.prog, { width: `${(seekDragging ? seekDragValue : ratio) * 100}%` }]} />
                <View {...panResponder.panHandlers} style={seekStyles.knobWrap}>
                  <View style={seekStyles.knob} />
                </View>
              </View>
            </View>
          </TouchableOpacity>

          {/* 底部控制栏 */}
          <View style={[styles.ctrlBar, !isFullscreen && styles.ctrlBarSmall]}>
            {/* 左侧：上集/下集 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {prevEp && (
                <TouchableOpacity
                  style={[styles.ctrlBtn, styles.epBtn]}
                  onPress={() => handlePlay(prevEp.Id, prevEp.UserData?.PlaybackPositionTicks || 0)}
                >
                  <ChevronLeft size={isFullscreen ? 20 : 16} color="#fff" />
                  <Text style={[styles.epBtnText, isFullscreen && { fontSize: 14 }]}>上集</Text>
                </TouchableOpacity>
              )}
              {nextEp && (
                <TouchableOpacity
                  style={[styles.ctrlBtn, styles.epBtn]}
                  onPress={() => handlePlay(nextEp.Id, nextEp.UserData?.PlaybackPositionTicks || 0)}
                >
                  <Text style={[styles.epBtnText, isFullscreen && { fontSize: 14 }]}>下集</Text>
                  <ChevronRight size={isFullscreen ? 20 : 16} color="#fff" />
                </TouchableOpacity>
              )}
            </View>

            {/* 中间：时间 */}
            <Text style={styles.timeText}>
              {formatTime(curMs)} / {formatTime(playbackStats.duration)}
            </Text>

            {/* 右侧：字幕/音轨/全屏 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {subtitleStreams.length > 0 && (
                <TouchableOpacity style={styles.ctrlBtn} onPress={() => setShowTrackPicker('subtitle')}>
                  <Subtitles color={selectedSubtitleIndex >= 0 ? '#fbbf24' : '#fff'} size={isFullscreen ? 20 : 16} />
                  <Text style={[styles.ctrlBtnLabel, isFullscreen && { fontSize: 12 }]}>字幕</Text>
                </TouchableOpacity>
              )}
              {audioStreams.length > 1 && (
                <TouchableOpacity style={styles.ctrlBtn} onPress={() => setShowTrackPicker('audio')}>
                  <Volume2 color="#fff" size={isFullscreen ? 20 : 16} />
                  <Text style={[styles.ctrlBtnLabel, isFullscreen && { fontSize: 12 }]}>音轨</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.ctrlBtn} onPress={toggleFullscreen}>
                {isFullscreen ? <Minimize color="#fff" size={isFullscreen ? 20 : 16} /> : <Fullscreen color="#fff" size={isFullscreen ? 20 : 16} />}
                <Text style={[styles.ctrlBtnLabel, isFullscreen && { fontSize: 12 }]}>{isFullscreen ? '退出' : '全屏'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 设置弹窗 */}
          <Modal visible={showSettings} transparent animationType="slide">
            <View style={styles.modalBg}>
              <View style={styles.modalCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>播放信息</Text>
                  <TouchableOpacity onPress={() => setShowSettings(false)}><X color="#9ca3af" size={24} /></TouchableOpacity>
                </View>
                <View style={{ paddingHorizontal: 20 }}>
                  <View style={styles.statRow}>
                    <Info color="#3b82f6" size={16} />
                    <Text style={styles.statLabel}>进度</Text>
                  </View>
                  <Text style={styles.statVal}>{formatTime(playbackStats.position)} / {formatTime(playbackStats.duration)}</Text>
                  {videoCodec ? (
                    <>
                      <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 12 }} />
                      <View style={styles.statRow}><Monitor color="#3b82f6" size={16} /><Text style={styles.statLabel}>视频</Text></View>
                      <Text style={styles.statVal}>{videoCodec.toUpperCase()} {videoResolution}</Text>
                    </>
                  ) : null}
                  {(() => {
                    const a = audioStreams.find((s) => s.Index === selectedAudioIndex) || audioStreams[0];
                    if (!a) return null;
                    return (
                      <>
                        <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 12 }} />
                        <View style={styles.statRow}><Mic color="#3b82f6" size={16} /><Text style={styles.statLabel}>音频</Text></View>
                        <Text style={styles.statVal}>
                          {a.DisplayTitle || `${a.Codec?.toUpperCase() || ''} ${a.ChannelCount ? a.ChannelCount + 'ch' : ''}`.trim()}
                        </Text>
                      </>
                    );
                  })()}
                  {mediaSource?.Container ? (
                    <>
                      <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 12 }} />
                      <View style={styles.statRow}><Hash color="#3b82f6" size={16} /><Text style={styles.statLabel}>封装</Text></View>
                      <Text style={styles.statVal}>{mediaSource.Container.toUpperCase()}</Text>
                    </>
                  ) : null}
                  {mediaSource?.Bitrate ? (
                    <>
                      <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 12 }} />
                      <View style={styles.statRow}><ActivityIndicator size={14} color="#3b82f6" /><Text style={styles.statLabel}>码率</Text></View>
                      <Text style={styles.statVal}>{formatBitrate(mediaSource.Bitrate)}</Text>
                    </>
                  ) : null}
                  <View style={{ height: 1, backgroundColor: '#374151', marginVertical: 16 }} />
                  <TouchableOpacity style={styles.extBtn} onPress={handleExternalPlay}>
                    <ExternalLink color="#fff" size={16} style={{ marginRight: 8 }} />
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>使用第三方播放器</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* 轨道选择 */}
          <Modal visible={showTrackPicker !== null} transparent animationType="fade">
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowTrackPicker(null)}>
              <View style={styles.pickerPanel}>
                <Text style={{ color: '#9ca3af', fontSize: 13, fontWeight: 'bold', marginBottom: 12 }}>
                  {showTrackPicker === 'subtitle' ? '选择字幕' : '选择音轨'}
                </Text>
                {showTrackPicker === 'subtitle' ? (
                  <>
                    <TouchableOpacity
                      style={[styles.pickItem, selectedSubtitleIndex === -1 && styles.pickItemOn]}
                      onPress={() => switchSubtitleTrack(-1)}
                    >
                      <Text style={{ color: selectedSubtitleIndex === -1 ? '#3b82f6' : '#e5e7eb', fontWeight: selectedSubtitleIndex === -1 ? 'bold' : 'normal' }}>
                        关闭字幕
                      </Text>
                    </TouchableOpacity>
                    {subtitleStreams.map((s) => (
                      <TouchableOpacity
                        key={s.Index}
                        style={[styles.pickItem, selectedSubtitleIndex === s.Index && styles.pickItemOn]}
                        onPress={() => switchSubtitleTrack(s.Index)}
                      >
                        <Text style={{ color: selectedSubtitleIndex === s.Index ? '#3b82f6' : '#e5e7eb', fontWeight: selectedSubtitleIndex === s.Index ? 'bold' : 'normal' }}>
                          {s.DisplayTitle || `${s.Language || ''} ${s.Codec?.toUpperCase() || ''}`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </>
                ) : (
                  audioStreams.map((s) => (
                    <TouchableOpacity
                      key={s.Index}
                      style={[styles.pickItem, selectedAudioIndex === s.Index && styles.pickItemOn]}
                      onPress={() => switchAudioTrack(s.Index)}
                    >
                      <Text style={{ color: selectedAudioIndex === s.Index ? '#3b82f6' : '#e5e7eb', fontWeight: selectedAudioIndex === s.Index ? 'bold' : 'normal' }}>
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

  /* ---------- 详情内容 ---------- */
  const img = (id, tp, w = width) => `${serverUrl}/Items/${id}/Images/${tp}?api_key=${authToken}&width=${Math.round(w)}`;

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#3b82f6" /></View>;
  if (!item) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#9ca3af', marginBottom: 16 }}>无法加载影片信息</Text>
        <TouchableOpacity style={styles.backTop} onPress={() => navigation.goBack()}><ChevronLeft color="#fff" size={28} /></TouchableOpacity>
      </View>
    );
  }

  const primaryAudio = audioStreams.find((s) => s.Index === selectedAudioIndex) || audioStreams[0];
  const streamInfo = [];
  if (videoCodec) streamInfo.push({ label: `${videoCodec.toUpperCase()} ${videoResolution}` });
  if (primaryAudio) {
    let lb = primaryAudio.Codec?.toUpperCase() || '';
    if (primaryAudio.ChannelCount) lb += ` ${primaryAudio.ChannelCount}ch`;
    if (primaryAudio.DisplayTitle) lb = primaryAudio.DisplayTitle;
    streamInfo.push({ label: lb });
  }
  if (mediaSource?.Bitrate) streamInfo.push({ label: formatBitrate(mediaSource.Bitrate) });

  const directors = item?.People?.filter((p) => p.Type === 'Director') || [];
  const cast = item?.People?.filter((p) => p.Type === 'Actor' || p.Type === 'Performer') || [];
  const studios = item?.Studios || [];
  const tagline = item?.Taglines?.[0] || '';
  const officialRating = item?.OfficialRating || '';

  return (
    <View style={styles.container}>
      {renderPlayer()}

      <ScrollView style={styles.scroll}>
        <View style={styles.hero}>
          <Image source={{ uri: backdropUrl || img(itemId, 'Backdrop', width) }} style={styles.backdrop} />
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.heroFade} />
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}><ChevronLeft color="#fff" size={30} /></TouchableOpacity>
          <View style={styles.heroContent}>
            <Image source={{ uri: imageUrl || img(itemId, 'Primary', 240) }} style={styles.poster} />
            <View style={styles.heroText}>
              <Text style={styles.title} numberOfLines={2}>{item.Name || navTitle}</Text>
              {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
              <View style={styles.metaRow}>
                {item.ProductionYear ? <Text style={styles.meta}>{item.ProductionYear}</Text> : null}
                {item.CommunityRating ? (
                  <View style={styles.rating}>
                    <Star color="#fff" size={11} fill="#fff" style={{ marginRight: 2 }} />
                    <Text style={styles.ratingTxt}>{item.CommunityRating.toFixed(1)}</Text>
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
              <View key={i} style={styles.chip}><Text style={styles.chipText}>{g}</Text></View>
            ))}
          </ScrollView>
        )}

        {item.Type === 'Series' ? (
          <View style={{ marginHorizontal: 20, marginTop: 14 }}>
            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => {
                const ne = episodes.find((e) => !e.UserData?.Played);
                if (ne) handlePlay(ne.Id, ne.UserData?.PlaybackPositionTicks || 0);
                else if (episodes.length > 0) handlePlay(episodes[0].Id, 0);
              }}
            >
              <Play color="#fff" size={20} fill="#fff" />
              <Text style={styles.playText}>播放下一集</Text>
            </TouchableOpacity>
            <Text style={seriesHint}>或在下方选择剧集</Text>
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
          <View style={styles.siRow}>
            {streamInfo.map((s, i) => (
              <View key={i} style={styles.siChip}>
                <Text style={styles.siText}>{s.label}</Text>
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
              <View style={styles.ml}>
                <User color="#6b7280" size={14} />
                <Text style={styles.mll}>导演</Text>
                <Text style={styles.mlv}>{directors.map((d) => d.Name).join('、')}</Text>
              </View>
            )}
            {studios.length > 0 && (
              <View style={styles.ml}>
                <Building color="#6b7280" size={14} />
                <Text style={styles.mll}>出品</Text>
                <Text style={styles.mlv}>{studios.map((s) => s.Name).join('、')}</Text>
              </View>
            )}
            {cast.length > 0 && (
              <View style={styles.ml}>
                <Star color="#6b7280" size={14} />
                <Text style={styles.mll}>主演</Text>
                <Text style={styles.mlv}>{cast.slice(0, 6).map((p) => p.Name).join('、')}</Text>
              </View>
            )}
            {subtitleStreams.length > 0 && (
              <View style={styles.ml}>
                <Languages color="#6b7280" size={14} />
                <Text style={styles.mll}>字幕</Text>
                <Text style={styles.mlv}>{subtitleStreams.map((s) => s.Language || s.Codec || '未知').join('、')}</Text>
              </View>
            )}
          </View>
        )}

        {item.Type === 'Series' && (
          <View style={styles.section}>
            <TouchableOpacity style={styles.seasonPicker} onPress={() => setShowSeasonPicker(true)}>
              <Text style={styles.seasonText}>
                季度 {seasons.findIndex((s) => s.Id === activeSeasonId) + 1}: {seasons.find((s) => s.Id === activeSeasonId)?.Name || '未知'}
              </Text>
              <ChevronDown color="#9ca3af" size={20} />
            </TouchableOpacity>
            {episodes.map((ep) => (
              <TouchableOpacity key={ep.Id} style={styles.epCard} onPress={() => handlePlay(ep.Id, ep.UserData?.PlaybackPositionTicks || 0)}>
                <Image source={{ uri: img(ep.Id, 'Primary', 160) }} style={styles.epPoster} />
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
                  <Image source={{ uri: img(s.Id, 'Primary', 220) }} style={{ width: 110, height: 165, borderRadius: 8, backgroundColor: '#374151' }} />
                  <Text style={{ color: '#e5e7eb', fontSize: 11, marginTop: 4, fontWeight: '500' }} numberOfLines={1}>{s.Name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 50 }} />
      </ScrollView>

      <Modal visible={showSeasonPicker} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowSeasonPicker(false)}>
          <View style={styles.pickerPanel}>
            <Text style={{ color: '#9ca3af', fontSize: 13, fontWeight: 'bold', marginBottom: 12 }}>选择季度</Text>
            {seasons.map((s, i) => (
              <TouchableOpacity key={s.Id} style={[styles.pickItem, activeSeasonId === s.Id && styles.pickItemOn]} onPress={() => handleSeasonChange(s.Id)}>
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
  heroFade: { position: 'absolute', bottom: 0, left: 0, width, height: 120, backgroundColor: 'rgba(17,24,39,0.7)' },
  backBtn: { position: 'absolute', top: 50, left: 16, zIndex: 10, padding: 8 },
  backTop: { position: 'absolute', top: 50, left: 16, padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  heroContent: { flexDirection: 'row', alignItems: 'flex-end', zIndex: 5 },
  poster: { width: 100, height: 150, borderRadius: 10, borderWidth: 2, borderColor: '#374151', elevation: 8 },
  heroText: { flex: 1, marginLeft: 14 },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  tagline: { color: '#9ca3af', fontSize: 12, fontStyle: 'italic', marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  meta: { color: '#d1d5db', fontSize: 13, marginRight: 10, fontWeight: '500' },
  rating: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(245,158,11,0.2)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, marginRight: 10 },
  ratingTxt: { color: '#f59e0b', fontSize: 12, fontWeight: 'bold' },
  chip: { backgroundColor: 'rgba(59,130,246,0.15)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, marginRight: 8, borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)' },
  chipText: { color: '#60a5fa', fontSize: 12, fontWeight: '600' },
  playBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e50914', marginHorizontal: 20, marginTop: 14, paddingVertical: 13, borderRadius: 8, elevation: 3 },
  playText: { color: '#fff', fontSize: 17, fontWeight: 'bold', marginLeft: 8 },
  seriesHint: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 6 },
  siRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 20, marginTop: 12, gap: 8 },
  siChip: { backgroundColor: 'rgba(59,130,246,0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)' },
  siText: { color: '#93c5fd', fontSize: 11, fontWeight: '600', marginLeft: 5 },
  section: { padding: 20, paddingBottom: 0 },
  sectionTitle: { color: '#fff', fontSize: 17, fontWeight: 'bold', marginBottom: 12 },
  overview: { color: '#9ca3af', fontSize: 14, lineHeight: 22 },
  ml: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  mll: { color: '#6b7280', fontSize: 13, fontWeight: 'bold', marginLeft: 6, width: 40 },
  mlv: { color: '#d1d5db', fontSize: 13, flex: 1 },
  epCard: { flexDirection: 'row', backgroundColor: '#1f2937', padding: 12, borderRadius: 10, marginBottom: 10 },
  epPoster: { width: 80, height: 45, borderRadius: 6, backgroundColor: '#374151' },
  epTitle: { color: '#e5e7eb', fontSize: 14, fontWeight: 'bold' },
  epSub: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  epOverview: { color: '#6b7280', fontSize: 11, marginTop: 4, lineHeight: 16 },

  /* === 播放器 === */
  playerWrap: { position: 'absolute', top: 0, left: 0, width, zIndex: 999, backgroundColor: '#000' },
  playerWrapFullscreen: { width: '100%', height: '100%', zIndex: 9999 },
  playerInner: { flex: 1, justifyContent: 'center', position: 'relative', height: 220 },
  playerInnerFullscreen: { flex: 1, height: undefined },

  /* 顶部栏 */
  playerTopBar: { position: 'absolute', top: Platform.OS === 'ios' ? 50 : 30, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, zIndex: 1000 },
  topTitle: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1, marginLeft: 8 },
  iconBtn: { padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },

  /* 视频 */
  videoWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  video: { width: '100%', height: '100%' },

  /* 播放/暂停 */
  playCenter: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', zIndex: 1002 },
  playBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },

  /* seekbar */
  seekWrap: { position: 'absolute', bottom: 50, left: 0, right: 0, zIndex: 1001, paddingHorizontal: 16 },
  seekWrapSmall: { bottom: 8 },
  seekTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden', flexDirection: 'row' },
  seekBuf: { height: '100%', backgroundColor: 'rgba(255,255,255,0.15)' },
  seekProg: { height: '100%', backgroundColor: '#3b82f6' },
  seekKnobWrap: { position: 'absolute', top: -6, left: 0, right: 0, bottom: -6, justifyContent: 'center' },
  seekKnob: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff', borderWidth: 2, borderColor: '#3b82f6' },
  seekPreview: { position: 'absolute', bottom: 20, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  seekPreviewText: { color: '#fff', fontSize: 12 },

  /* 底部控制栏 */
  ctrlBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingBottom: Platform.OS === 'ios' ? 10 : 6, zIndex: 1000 },
  ctrlBarSmall: { paddingBottom: 4 },
  timeText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '500', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4 },
  ctrlBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  ctrlBtnLabel: { color: '#e5e7eb', fontSize: 12, fontWeight: '500' },
  epBtn: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  epBtnText: { color: '#e5e7eb', fontSize: 12, fontWeight: '500' },

  /* 弹窗 */
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#1f2937', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '60%' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#374151' },
  pickerPanel: { backgroundColor: '#1f2937', borderRadius: 16, padding: 20, elevation: 10 },
  pickItem: { paddingVertical: 13, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4 },
  pickItemOn: { backgroundColor: 'rgba(59,130,246,0.15)' },
  statRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  statLabel: { color: '#e5e7eb', fontSize: 15, fontWeight: 'bold', marginLeft: 8 },
  statVal: { color: '#9ca3af', fontSize: 13, marginBottom: 4 },
  extBtn: { flexDirection: 'row', backgroundColor: '#8b5cf6', padding: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
});