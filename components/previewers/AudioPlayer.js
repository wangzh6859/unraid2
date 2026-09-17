import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ActivityIndicator,
  Animated, Easing, Platform,
} from 'react-native';
import { Audio } from 'expo-av';
import {
  Play, Pause, RotateCcw, RotateCw, Repeat, Repeat1,
  Music, Volume2, Disc,
} from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { formatBytes } from '../../utils/cacheManager';

function formatTime(millis) {
  if (!millis || isNaN(millis) || millis < 0) return '00:00';
  const totalSeconds = Math.floor(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export default function AudioPlayer({ item, streamUrl }) {
  const { colors, isDark } = useTheme();
  const soundRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [hasError, setHasError] = useState(false);

  // Vinyl Spin Animation
  const spinValue = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(null);

  useEffect(() => {
    spinAnim.current = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 10000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
  }, [spinValue]);

  useEffect(() => {
    if (isPlaying) {
      spinAnim.current?.start();
    } else {
      spinAnim.current?.stop();
    }
  }, [isPlaying]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Load and play audio stream
  useEffect(() => {
    let mounted = true;
    async function loadAudio() {
      setIsLoading(true);
      setHasError(false);
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
        });

        const { sound } = await Audio.Sound.createAsync(
          { uri: streamUrl },
          { shouldPlay: true, isLooping: false },
          (status) => {
            if (!mounted) return;
            if (status.isLoaded) {
              setIsPlaying(status.isPlaying);
              setPositionMillis(status.positionMillis);
              setDurationMillis(status.durationMillis || 1);
              if (status.didJustFinish && !status.isLooping) {
                setIsPlaying(false);
              }
            } else if (status.error) {
              console.log('[AudioPlayer] playback error:', status.error);
              setHasError(true);
            }
          }
        );

        soundRef.current = sound;
        if (mounted) setIsLoading(false);
      } catch (e) {
        console.log('[AudioPlayer] load error:', e);
        if (mounted) {
          setIsLoading(false);
          setHasError(true);
        }
      }
    }

    loadAudio();

    return () => {
      mounted = false;
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, [streamUrl]);

  const handlePlayPause = async () => {
    if (!soundRef.current) return;
    if (isPlaying) {
      await soundRef.current.pauseAsync();
    } else {
      await soundRef.current.playAsync();
    }
  };

  const handleSeekDelta = async (deltaSeconds) => {
    if (!soundRef.current) return;
    const target = Math.max(0, Math.min(durationMillis, positionMillis + deltaSeconds * 1000));
    await soundRef.current.setPositionAsync(target);
  };

  const toggleLoop = async () => {
    if (!soundRef.current) return;
    const nextLoop = !isLooping;
    await soundRef.current.setIsLoopingAsync(nextLoop);
    setIsLooping(nextLoop);
  };

  const cycleRate = async () => {
    if (!soundRef.current) return;
    const rates = [1.0, 1.25, 1.5, 2.0];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIdx];
    await soundRef.current.setRateAsync(nextRate, true);
    setPlaybackRate(nextRate);
  };

  const ext = (item?.name || '').split('.').pop().toUpperCase();
  const progressPercent = durationMillis > 0
    ? Math.min(100, Math.max(0, (positionMillis / durationMillis) * 100))
    : 0;

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  return (
    <View style={styles.container}>
      {/* Vinyl Record Visualizer */}
      <View style={styles.turntableContainer}>
        <Animated.View style={[styles.vinylRecord, { transform: [{ rotate: spin }] }]}>
          <View style={styles.vinylGroove1}>
            <View style={styles.vinylGroove2}>
              <View style={styles.vinylLabel}>
                <Disc color={colors.accent} size={32} />
              </View>
            </View>
          </View>
        </Animated.View>
      </View>

      {/* Track Info Card */}
      <View style={styles.trackCard}>
        <View style={styles.badgeRow}>
          <View style={styles.formatBadge}>
            <Text style={styles.formatBadgeText}>{ext || 'AUDIO'} 高保真流</Text>
          </View>
          <Text style={styles.fileSizeText}>{formatBytes(item?.size)}</Text>
        </View>

        <Text style={styles.trackTitle} numberOfLines={2}>{item?.name}</Text>

        {/* Scrubber Progress Bar */}
        <View
          style={styles.scrubberTouch}
          onStartShouldSetResponder={() => true}
          onResponderRelease={async (e) => {
            const { locationX } = e.nativeEvent;
            if (soundRef.current && durationMillis) {
              const ratio = Math.max(0, Math.min(1, locationX / 280));
              await soundRef.current.setPositionAsync(ratio * durationMillis);
            }
          }}
        >
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFilled, { width: `${progressPercent}%` }]} />
            <View style={[styles.progressThumb, { left: `${progressPercent}%` }]} />
          </View>
        </View>

        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(positionMillis)}</Text>
          <Text style={styles.timeDurationText}>{formatTime(durationMillis)}</Text>
        </View>

        {/* Transport Controls */}
        <View style={styles.controlsRow}>
          {/* Rate Switcher */}
          <TouchableOpacity style={styles.secondaryBtn} onPress={cycleRate}>
            <Text style={styles.secondaryBtnText}>{playbackRate}x</Text>
          </TouchableOpacity>

          {/* Rewind 10s */}
          <TouchableOpacity style={styles.seekBtn} onPress={() => handleSeekDelta(-10)}>
            <RotateCcw color={colors.textStrong} size={24} />
            <Text style={styles.seekLabel}>-10s</Text>
          </TouchableOpacity>

          {/* Main Play/Pause */}
          <TouchableOpacity
            style={styles.mainPlayBtn}
            onPress={handlePlayPause}
            disabled={isLoading || hasError}
          >
            {isLoading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : isPlaying ? (
              <Pause color="#ffffff" size={32} />
            ) : (
              <Play color="#ffffff" size={32} style={{ marginLeft: 3 }} />
            )}
          </TouchableOpacity>

          {/* Forward 10s */}
          <TouchableOpacity style={styles.seekBtn} onPress={() => handleSeekDelta(10)}>
            <RotateCw color={colors.textStrong} size={24} />
            <Text style={styles.seekLabel}>+10s</Text>
          </TouchableOpacity>

          {/* Loop Toggle */}
          <TouchableOpacity style={styles.secondaryBtn} onPress={toggleLoop}>
            {isLooping ? <Repeat1 color={colors.accent} size={20} /> : <Repeat color={colors.muted} size={20} />}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const createStyles = (colors, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.bg,
  },
  turntableContainer: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: isDark ? '#121318' : '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: isDark ? 0.6 : 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  vinylRecord: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: isDark ? '#1c1e24' : '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: isDark ? '#2d3139' : '#475569',
  },
  vinylGroove1: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vinylGroove2: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vinylLabel: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: isDark ? '#0f172a' : '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.accent,
  },
  trackCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.3 : 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  formatBadge: {
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.18)' : 'rgba(2, 132, 199, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(56, 189, 248, 0.4)' : 'rgba(2, 132, 199, 0.3)',
  },
  formatBadgeText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: 'bold',
  },
  fileSizeText: {
    color: colors.sub,
    fontSize: 12,
  },
  trackTitle: {
    color: colors.textStrong,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  scrubberTouch: {
    height: 24,
    justifyContent: 'center',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
    borderRadius: 2,
    position: 'relative',
  },
  progressBarFilled: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  progressThumb: {
    position: 'absolute',
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
    marginLeft: -6,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 16,
  },
  timeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  timeDurationText: {
    color: colors.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  seekBtn: {
    alignItems: 'center',
    padding: 6,
  },
  seekLabel: {
    color: colors.sub,
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 2,
  },
  mainPlayBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  secondaryBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cardSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
});
