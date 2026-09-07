import React, { useState, useRef } from 'react';
import {
  StyleSheet, Text, View, Image, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { RotateCw, ZoomIn, ZoomOut, AlertCircle, Download } from 'lucide-react-native';
import { formatBytes } from '../../utils/cacheManager';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ImageViewer({ item, streamUrl, onDownload }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [imageSize, setImageSize] = useState(null);
  const scrollRef = useRef(null);
  const lastTapRef = useRef(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const handleDoubleTap = () => {
    const now = Date.now();
    if (lastTapRef.current && now - lastTapRef.current < 300) {
      // Double tap triggered
      if (isZoomed) {
        scrollRef.current?.scrollResponderZoomTo({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, animated: true });
        setIsZoomed(false);
      } else {
        scrollRef.current?.scrollResponderZoomTo({ x: SCREEN_WIDTH / 4, y: SCREEN_HEIGHT / 4, width: SCREEN_WIDTH / 2, height: SCREEN_HEIGHT / 2, animated: true });
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
      <View style={styles.errorContainer}>
        <AlertCircle color="#ef4444" size={64} style={{ marginBottom: 16 }} />
        <Text style={styles.errorTitle}>图片解码失败</Text>
        <Text style={styles.errorSub}>
          当前系统暂不支持该图片格式（如特定 RAW、HEIC 或超大尺寸 PSD）的直接预览。
        </Text>
        <Text style={styles.errorSize}>{item?.name} ({formatBytes(item?.size)})</Text>
        <TouchableOpacity style={styles.downloadBtn} onPress={() => onDownload(item)}>
          <Download color="#ffffff" size={20} />
          <Text style={styles.downloadBtnText}>下载到本地相册查看</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Floating Badge */}
      <View style={styles.floatingBadge}>
        {imageSize && (
          <Text style={styles.badgeText}>
            {imageSize.width} × {imageSize.height}
          </Text>
        )}
        <Text style={[styles.badgeText, { color: '#94a3b8', marginLeft: 8 }]}>
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
            style={styles.image}
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
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>正在加载高保真图像...</Text>
        </View>
      )}

      {/* Bottom Hint */}
      <View style={styles.bottomHintBar}>
        <Text style={styles.hintText}>双击缩放 · 双指缩放平移</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    backgroundColor: '#0a0a0c',
    position: 'relative',
  },
  floatingBadge: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    zIndex: 10,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  badgeText: {
    color: '#60a5fa',
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
    backgroundColor: 'rgba(10, 10, 12, 0.7)',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 10,
  },
  bottomHintBar: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
  },
  hintText: {
    color: '#64748b',
    fontSize: 11,
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
