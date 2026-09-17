import React, { useState, useRef } from 'react';
import {
  StyleSheet, Text, View, Image, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions, Platform,
} from 'react-native';
import { AlertCircle, Download } from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { formatBytes } from '../../utils/cacheManager';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ImageViewer({ item, streamUrl, onDownload }) {
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [imageSize, setImageSize] = useState(null);
  const scrollRef = useRef(null);
  const lastTapRef = useRef(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const handleDoubleTap = () => {
    const now = Date.now();
    if (lastTapRef.current && now - lastTapRef.current < 300) {
      if (isZoomed) {
        if (Platform.OS === 'ios') {
          scrollRef.current?.scrollResponderZoomTo({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, animated: true });
        } else {
          scrollRef.current?.scrollTo({ x: 0, y: 0, animated: true });
        }
        setIsZoomed(false);
      } else {
        if (Platform.OS === 'ios') {
          scrollRef.current?.scrollResponderZoomTo({ x: SCREEN_WIDTH / 4, y: SCREEN_HEIGHT / 4, width: SCREEN_WIDTH / 2, height: SCREEN_HEIGHT / 2, animated: true });
        }
        setIsZoomed(true);
      }
      lastTapRef.current = null;
    } else {
      lastTapRef.current = now;
    }
  };

  const onImageLoad = (event) => {
    setLoading(false);
    if (event.nativeEvent.source) {
      const { width, height } = event.nativeEvent.source;
      setImageSize({ width, height });
    }
  };

  if (error) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.bg }]}>
        <AlertCircle color="#ef4444" size={64} style={{ marginBottom: 16 }} />
        <Text style={[styles.errorTitle, { color: colors.textStrong }]}>图片解码失败</Text>
        <Text style={[styles.errorSub, { color: colors.sub }]}>
          当前系统暂不支持该图片格式（如特定 RAW、HEIC 或超大尺寸 PSD）的直接预览。
        </Text>
        <Text style={[styles.errorSize, { color: colors.muted }]}>{item?.name} ({formatBytes(item?.size)})</Text>
        <TouchableOpacity style={[styles.downloadBtn, { backgroundColor: colors.accent }]} onPress={() => onDownload(item)}>
          <Download color="#ffffff" size={20} />
          <Text style={styles.downloadBtnText}>下载到本地相册查看</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Top Floating Badge */}
      <View style={[
        styles.floatingBadge,
        {
          backgroundColor: isDark ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)',
          borderColor: colors.cardBorder,
        }
      ]}>
        {imageSize && (
          <Text style={[styles.badgeText, { color: colors.accent }]}>
            {imageSize.width} × {imageSize.height}
          </Text>
        )}
        <Text style={[styles.badgeText, { color: colors.sub, marginLeft: 8 }]}>
          {formatBytes(item?.size)}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        maximumZoomScale={5}
        minimumZoomScale={1}
        centerContent
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onScrollEndDrag={() => {}}
      >
        <TouchableOpacity activeOpacity={1} onPress={handleDoubleTap} style={styles.touchArea}>
          <Image
            source={{ uri: streamUrl }}
            style={[styles.image, isZoomed && Platform.OS === 'android' && { transform: [{ scale: 2 }] }]}
            resizeMode="contain"
            onLoad={onImageLoad}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
          />
        </TouchableOpacity>
      </ScrollView>

      {loading && (
        <View style={[
          styles.loadingOverlay,
          { backgroundColor: isDark ? 'rgba(11, 15, 25, 0.75)' : 'rgba(248, 250, 252, 0.75)' }
        ]}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.sub }]}>正在加载高保真图像...</Text>
        </View>
      )}

      {/* Bottom Hint */}
      <View style={[
        styles.bottomHintBar,
        { backgroundColor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.75)' }
      ]}>
        <Text style={[styles.hintText, { color: colors.muted }]}>双击缩放 · 双指缩放平移</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  floatingBadge: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    zIndex: 10,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  touchArea: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 13,
    marginTop: 10,
  },
  bottomHintBar: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
  },
  hintText: {
    fontSize: 11,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  errorSub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  errorSize: {
    fontSize: 12,
    marginBottom: 24,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
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
