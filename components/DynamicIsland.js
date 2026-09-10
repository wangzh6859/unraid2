import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import {
  Zap,
  CheckCircle2,
  AlertCircle,
  Pause,
  ChevronDown,
  ChevronUp,
  FolderOpen,
} from 'lucide-react-native';
import backgroundTransferManager from '../utils/backgroundTransferManager';

// 🛡️ Error Boundary to guarantee that no rendering issue in DynamicIsland can ever crash the parent app
class DynamicIslandErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.log('[DynamicIsland] ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

function DynamicIslandInner({ onOpenTransfers }) {
  const [islandState, setIslandState] = useState(backgroundTransferManager.getIslandState());
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(Boolean(islandState?.active));

  // Animation values - ALL useNativeDriver: false to prevent mixed driver fatal exceptions
  const expandAnim = useRef(new Animated.Value(0)).current; // 0 = pill, 1 = expanded
  const fadeAnim = useRef(new Animated.Value(islandState?.active ? 1 : 0)).current; // 0 = hidden, 1 = shown
  const scaleAnim = useRef(new Animated.Value(islandState?.active ? 1 : 0.85)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for active running status
  useEffect(() => {
    let pulseLoop = null;
    try {
      if (islandState?.active && islandState?.status === 'running') {
        pulseLoop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.25,
              duration: 800,
              useNativeDriver: false,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 800,
              useNativeDriver: false,
            }),
          ])
        );
        pulseLoop.start();
      } else {
        pulseAnim.setValue(1);
      }
    } catch (_) {}
    return () => {
      if (pulseLoop) {
        try {
          pulseLoop.stop();
        } catch (_) {}
      }
    };
  }, [islandState?.active, islandState?.status]);

  // Subscribe to backgroundTransferManager updates
  useEffect(() => {
    const unsubscribe = backgroundTransferManager.subscribe((state) => {
      try {
        setIslandState(state);
        if (state && state.active) {
          setIsVisible(true);
          Animated.parallel([
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 250,
              useNativeDriver: false,
            }),
            Animated.spring(scaleAnim, {
              toValue: 1,
              friction: 6,
              tension: 80,
              useNativeDriver: false,
            }),
          ]).start();
        } else {
          Animated.parallel([
            Animated.timing(fadeAnim, {
              toValue: 0,
              duration: 250,
              useNativeDriver: false,
            }),
            Animated.timing(scaleAnim, {
              toValue: 0.85,
              duration: 250,
              useNativeDriver: false,
            }),
          ]).start(() => {
            setIsVisible(false);
            setIsExpanded(false);
            expandAnim.setValue(0);
          });
        }
      } catch (err) {
        console.log('[DynamicIsland] subscribe callback err:', err);
      }
    });

    return () => {
      try {
        unsubscribe();
      } catch (_) {}
    };
  }, []);

  const toggleExpand = () => {
    try {
      const toValue = isExpanded ? 0 : 1;
      Animated.spring(expandAnim, {
        toValue,
        friction: 8,
        tension: 60,
        useNativeDriver: false,
      }).start();
      setIsExpanded(!isExpanded);
    } catch (e) {
      console.log('[DynamicIsland] toggleExpand err:', e);
    }
  };

  if (!isVisible && (!islandState || !islandState.active)) {
    return null;
  }

  // Dynamic colors based on status
  let statusColor = '#3b82f6'; // default blue
  let glowColor = 'rgba(59, 130, 246, 0.35)';
  if (islandState?.status === 'success') {
    statusColor = '#10b981'; // emerald green
    glowColor = 'rgba(16, 185, 129, 0.4)';
  } else if (islandState?.status === 'error') {
    statusColor = '#ef4444'; // red
    glowColor = 'rgba(239, 68, 68, 0.4)';
  } else if (islandState?.status === 'paused') {
    statusColor = '#f59e0b'; // amber
    glowColor = 'rgba(245, 158, 11, 0.35)';
  }

  const containerHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [38, 142],
  });

  const containerWidth = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [220, 340],
  });

  const containerRadius = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [19, 22],
  });

  const compactOpacity = expandAnim.interpolate({
    inputRange: [0, 0.35],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const expandedOpacity = expandAnim.interpolate({
    inputRange: [0.65, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const rawProgress = islandState?.progress !== undefined ? islandState.progress : 0;
  const displayPct = Math.min(100, Math.max(0, Math.round(rawProgress)));

  return (
    <View style={styles.outerWrapper} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.islandCard,
          {
            width: containerWidth,
            height: containerHeight,
            borderRadius: containerRadius,
            borderColor: glowColor,
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* COMPACT PILL MODE (Collapsed) */}
        {!isExpanded && (
          <Animated.View style={[styles.compactRow, { opacity: compactOpacity }]}>
            <TouchableOpacity
              style={styles.compactTouchArea}
              onPress={toggleExpand}
              activeOpacity={0.8}
            >
              {/* Pulsing indicator dot */}
              <View style={styles.pulseWrapper}>
                <Animated.View
                  style={[
                    styles.pulseDot,
                    {
                      backgroundColor: statusColor,
                      transform: [{ scale: pulseAnim }],
                    },
                  ]}
                />
              </View>

              {/* Status & Speed */}
              <Text style={[styles.compactPct, { color: statusColor }]}>
                {islandState?.status === 'success'
                  ? '已完成'
                  : islandState?.status === 'paused'
                  ? '已暂停'
                  : islandState?.status === 'error'
                  ? '异常'
                  : `${displayPct}%`}
              </Text>

              {islandState?.status === 'running' && islandState?.speedStr ? (
                <Text style={styles.compactSpeed} numberOfLines={1}>
                  · {islandState.speedStr}
                </Text>
              ) : null}

              {/* File name */}
              <Text style={styles.compactName} numberOfLines={1}>
                {islandState?.name || '文件'}
              </Text>

              <ChevronDown color="rgba(255, 255, 255, 0.45)" size={14} style={{ marginLeft: 3 }} />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* EXPANDED ISLAND MODE */}
        {isExpanded && (
          <Animated.View style={[styles.expandedContent, { opacity: expandedOpacity }]}>
            {/* Top row: Icon + File Name + Collapse Btn */}
            <View style={styles.expHeader}>
              <View style={[styles.expIconBadge, { backgroundColor: glowColor }]}>
                {islandState?.status === 'success' ? (
                  <CheckCircle2 color={statusColor} size={15} />
                ) : islandState?.status === 'error' ? (
                  <AlertCircle color={statusColor} size={15} />
                ) : (
                  <Zap color={statusColor} size={15} />
                )}
              </View>
              <Text style={styles.expFileName} numberOfLines={1}>
                {islandState?.name || '文件传输'}
              </Text>
              <TouchableOpacity onPress={toggleExpand} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <ChevronUp color="rgba(255, 255, 255, 0.6)" size={18} />
              </TouchableOpacity>
            </View>

            {/* Metrics row */}
            <View style={styles.expMetrics}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Text style={[styles.expBigPct, { color: statusColor }]}>
                  {displayPct}%
                </Text>
                {islandState?.speedStr ? (
                  <Text style={styles.expSpeedBadge}>{islandState.speedStr}</Text>
                ) : null}
              </View>
              {islandState?.sizeText ? (
                <Text style={styles.expSizeText}>{islandState.sizeText}</Text>
              ) : null}
            </View>

            {/* Glowing progress bar */}
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${Math.min(100, Math.max(2, displayPct))}%`,
                    backgroundColor: statusColor,
                  },
                ]}
              />
            </View>

            {/* Bottom Actions */}
            <View style={styles.expActions}>
              <TouchableOpacity style={styles.expCollapseBtn} onPress={toggleExpand} activeOpacity={0.7}>
                <Text style={styles.expCollapseBtnText}>收起胶囊</Text>
              </TouchableOpacity>
              {onOpenTransfers ? (
                <TouchableOpacity
                  style={[styles.expNavBtn, { backgroundColor: statusColor }]}
                  onPress={() => {
                    toggleExpand();
                    try {
                      onOpenTransfers();
                    } catch (_) {}
                  }}
                  activeOpacity={0.8}
                >
                  <FolderOpen color="#ffffff" size={13} style={{ marginRight: 4 }} />
                  <Text style={styles.expNavBtnText}>查看传输中心</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

export default function DynamicIsland(props) {
  return (
    <DynamicIslandErrorBoundary>
      <DynamicIslandInner {...props} />
    </DynamicIslandErrorBoundary>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 44 : 26,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 99999,
  },
  islandCard: {
    backgroundColor: '#0a0d14',
    borderWidth: 1.2,
    overflow: 'hidden',
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
  },
  // Compact Pill Styles
  compactRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  compactTouchArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pulseWrapper: {
    width: 14,
    height: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  compactPct: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  compactSpeed: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 3,
  },
  compactName: {
    flex: 1,
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 11,
    marginLeft: 6,
  },
  // Expanded Island Styles
  expandedContent: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  expHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  expIconBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  expFileName: {
    flex: 1,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  expMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 6,
    marginBottom: 4,
  },
  expBigPct: {
    fontSize: 20,
    fontWeight: '900',
  },
  expSpeedBadge: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 12,
    fontWeight: '600',
  },
  expSizeText: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 11,
    fontWeight: '500',
  },
  progressBarTrack: {
    width: '100%',
    height: 4.5,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 2.5,
    overflow: 'hidden',
    marginVertical: 4,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2.5,
  },
  expActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  expCollapseBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  expCollapseBtnText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    fontWeight: '600',
  },
  expNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 6,
  },
  expNavBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
});
