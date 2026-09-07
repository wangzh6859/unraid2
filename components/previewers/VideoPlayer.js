import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ActivityIndicator,
  TouchableWithoutFeedback, Platform, Animated,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import {
  Play, Pause, RotateCcw, RotateCw, Maximize, Minimize,
  Volume2, VolumeX, AlertCircle, Download,
} from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { formatBytes } from '../../utils/cacheManager';

function formatTime(millis) {
  if (!millis || isNaN(millis) || millis < 0) return '00:00';
  const totalSeconds = Math.floor(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    const remMinutes = minutes % 60;
    return `${hours}:${remMinutes < 10 ? '0' : ''}${remMinutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }
  return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export default function VideoPlayer({ item, streamUrl, onDownload }) {
  const { colors } = useTheme();
  const videoRef = useRef(null);

  const [status, setStatus] = useState({});
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [resizeMode, setResizeMode] = useState(ResizeMode.CONTAIN);
  const [isMuted, setIsMuted] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const hideTimerRef = useRef(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;

  // Auto-hide controls after 3.5s
  const resetHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    setControlsVisible(true);

    hideTimerRef.current = setTimeout(() => {
      Animated.timing(controlsOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setControlsVisible(false);
      });
    }, 3500);
  }, [controlsOpacity]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [resetHideTimer]);

  const toggleControls = () => {
    if (controlsVisible) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      Animated.timing(controlsOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setControlsVisible(false);
      });
    } else {
      resetHideTimer();
    }
  };

  const handlePlayPause = async () => {
    resetHideTimer();
    if (!videoRef.current) return;
    if (status.isPlaying) {
      await videoRef.current.pauseAsync();
    } else {
      if (status.didJustFinish) {
        await videoRef.current.replayAsync();
      } else {
        await videoRef.current.playAsync();
      }
    }
  };

  const handleSeekDelta = async (deltaSeconds) => {
    resetHideTimer();
    if (!videoRef.current || !status.positionMillis) return;
    const target = Math.max(0, Math.min(status.durationMillis || 0, status.positionMillis + deltaSeconds * 1000));
    await videoRef.current.setPositionAsync(target);
  };

  const handleScrubberPress = async (evt) => {
    resetHideTimer();
    if (!videoRef.current || !status.durationMillis) return;
    const { locationX } = evt.nativeEvent;
    // Assume full scrubber width ~ window width - 32 padding
    // We compute relative percentage from event
    const barWidth = evt.currentTarget ? evt.nativeEvent.target : 300;
    // We approximate bar width or layout
  };

  const cycleResizeMode = () => {
    resetHideTimer();
    if (resizeMode === ResizeMode.CONTAIN) setResizeMode(ResizeMode.COVER);
    else if (resizeMode === ResizeMode.COVER) setResizeMode(ResizeMode.STRETCH);
    else setResizeMode(ResizeMode.CONTAIN);
  };

  const toggleMute = async () => {
    resetHideTimer();
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    await videoRef.current.setIsMutedAsync(nextMuted);
    setIsMuted(nextMuted);
  };

  const progressPercent = status.durationMillis && status.positionMillis
    ? Math.min(100, Math.max(0, (status.positionMillis / status.durationMillis) * 100))
    : 0;

  if (hasError) {
    return (
      <View style={styles.errorContainer}>
        <AlertCircle color="#ef4444" size={64} style={{ marginBottom: 16 }} />
        <Text style={styles.errorTitle}>视频解码失败</Text>
        <Text style={styles.errorSub}>
          {errorMessage || '当前设备系统硬件解码器不支持该视频编码格式（例如部分 10-bit HEVC / AV1）。'}
        </Text>
        <Text style={styles.errorSize}>{item?.name} ({formatBytes(item?.size)})</Text>
        <TouchableOpacity style={styles.downloadBtn} onPress={() => onDownload(item)}>
          <Download color="#ffffff" size={20} />
          <Text style={styles.downloadBtnText}>下载到本地使用专用播放器查看</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={toggleControls}>
      <View style={styles.wrapper}>
        <Video
          ref={videoRef}
          source={{ uri: streamUrl }}
          style={styles.video}
          resizeMode={resizeMode}
          shouldPlay
          isMuted={isMuted}
          onPlaybackStatusUpdate={(s) => {
            setStatus(s);
            setIsBuffering(s.isBuffering);
            if (s.didJustFinish) {
              setControlsVisible(true);
              Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
            }
          }}
          onError={(err) => {
            console.log('[VideoPlayer] Playback error:', err);
            setHasError(true);
            setErrorMessage(typeof err === 'string' ? err : '媒体流解析错误');
          }}
        />

        {/* Buffering Indicator */}
        {isBuffering && (
          <View style={styles.bufferingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text style={styles.bufferingText}>缓冲中...</Text>
          </View>
        )}

        {/* Control Overlay */}
        <Animated.View
          style={[styles.controlsOverlay, { opacity: controlsOpacity }]}
          pointerEvents={controlsVisible ? 'auto' : 'none'}
        >
          {/* Top Bar inside Player */}
          <View style={styles.topControlBar}>
            <View style={styles.badgeWrap}>
              <Text style={styles.badgeText}>HTTP 206 流式传输</Text>
            </View>
            <View style={styles.topActions}>
              <TouchableOpacity style={styles.iconBtn} onPress={toggleMute}>
                {isMuted ? <VolumeX color="#ffffff" size={22} /> : <Volume2 color="#ffffff" size={22} />}
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={cycleResizeMode}>
                {resizeMode === ResizeMode.CONTAIN ? (
                  <Maximize color="#ffffff" size={22} />
                ) : (
                  <Minimize color="#ffffff" size={22} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Center Play/Rewind/Forward Controls */}
          <View style={styles.centerControls}>
            <TouchableOpacity style={styles.seekBtn} onPress={() => handleSeekDelta(-10)}>
              <RotateCcw color="#ffffff" size={28} />
              <Text style={styles.seekBtnLabel}>-10s</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.playPauseBtn} onPress={handlePlayPause}>
              {status.isPlaying ? (
                <Pause color="#ffffff" size={38} />
              ) : (
                <Play color="#ffffff" size={38} style={{ marginLeft: 4 }} />
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.seekBtn} onPress={() => handleSeekDelta(10)}>
              <RotateCw color="#ffffff" size={28} />
              <Text style={styles.seekBtnLabel}>+10s</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom Progress Bar & Time */}
          <View style={styles.bottomControlBar}>
            <View
              style={styles.progressBarTouchArea}
              onStartShouldSetResponder={() => true}
              onResponderRelease={async (e) => {
                resetHideTimer();
                const { locationX } = e.nativeEvent;
                // Bar width measured
                if (videoRef.current && status.durationMillis) {
                  // Rough estimation: layout width
                  const ratio = Math.max(0, Math.min(1, locationX / 300));
                  await videoRef.current.setPositionAsync(ratio * status.durationMillis);
                }
              }}
            >
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFilled, { width: `${progressPercent}%` }]} />
                <View style={[styles.progressThumb, { left: `${progressPercent}%` }]} />
              </View>
            </View>

            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(status.positionMillis)}</Text>
              <Text style={styles.timeDurationText}>
                {formatTime(status.durationMillis)}
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  bufferingText: {
    color: '#ffffff',
    fontSize: 13,
    marginTop: 8,
    fontWeight: '500',
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'space-between',
    padding: 16,
  },
  topControlBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 10 : 0,
  },
  badgeWrap: {
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.5)',
  },
  badgeText: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: 'bold',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBtn: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
  },
  centerControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 36,
  },
  seekBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  seekBtnLabel: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  playPauseBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
  bottomControlBar: {
    paddingBottom: Platform.OS === 'ios' ? 16 : 8,
  },
  progressBarTouchArea: {
    height: 30,
    justifyContent: 'center',
  },
  progressBarTrack: {
    height: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 3,
    overflow: 'visible',
    position: 'relative',
  },
  progressBarFilled: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 3,
  },
  progressThumb: {
    position: 'absolute',
    top: -4,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#ffffff',
    marginLeft: -6,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 3,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  timeDurationText: {
    color: '#9ca3af',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0a0a0c',
  },
  errorTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  errorSub: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  errorSize: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 24,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3b82f6',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  downloadBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
