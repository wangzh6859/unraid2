import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Dimensions, Platform, PanResponder,
} from 'react-native';
import {
  FileText, BookOpen, Layers, ChevronLeft, ChevronRight,
  ZoomIn, ZoomOut, RotateCcw, AlertCircle, RefreshCw,
  ChevronsLeft, ChevronsRight,
} from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { formatBytes } from '../../utils/cacheManager';
import { apiFetch } from '../../utils/apiClient';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function PdfViewer({ item, serverUrl, apiToken, streamUrl, onClose, onDownload }) {
  const { colors, isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(false);
  const [meta, setMeta] = useState({
    pageCount: 1,
    hasRenderEngine: false,
    hasText: false,
    text: '',
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState('image'); // 'image' | 'text'
  const [zoomLevel, setZoomLevel] = useState(1);
  const [touchState, setTouchState] = useState({ startX: 0, startY: 0 });

  const scrollRef = useRef(null);
  const lastTapRef = useRef(null);

  const targetPath = item?.path || item?.href || '';

  // 1. Fetch PDF Metadata & Capabilities on mount
  const fetchPdfMeta = async () => {
    setLoading(true);
    setPageError(false);
    try {
      const url = `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=pdf_preview&path=${encodeURIComponent(targetPath)}`;
      const res = await apiFetch(url, { method: 'GET' }, 8000, 1);
      if (res && res.ok) {
        const json = await res.json().catch(() => null);
        if (json && json.status === 'success') {
          const pCount = Math.max(1, json.page_count || 1);
          setMeta({
            pageCount: pCount,
            hasRenderEngine: Boolean(json.has_render_engine),
            hasText: Boolean(json.has_text),
            text: json.text || '',
          });
          if (!json.has_render_engine && json.has_text) {
            setViewMode('text');
          }
        }
      }
    } catch (_) {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (serverUrl && targetPath) {
      fetchPdfMeta();
    }
  }, [serverUrl, targetPath]);

  // Current page image URL
  const pageImageUrl = useMemo(() => {
    if (!serverUrl || !targetPath) return '';
    return `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=pdf_page&path=${encodeURIComponent(targetPath)}&page=${currentPage}&dpi=144`;
  }, [serverUrl, apiToken, targetPath, currentPage]);

  // Next page prefetch URL for zero-lag page turning
  const nextPrefetchUrl = useMemo(() => {
    if (currentPage >= meta.pageCount) return '';
    return `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=pdf_page&path=${encodeURIComponent(targetPath)}&page=${currentPage + 1}&dpi=144`;
  }, [serverUrl, apiToken, targetPath, currentPage, meta.pageCount]);

  useEffect(() => {
    if (nextPrefetchUrl) {
      Image.prefetch(nextPrefetchUrl).catch(() => {});
    }
  }, [nextPrefetchUrl]);

  // Reset page zoom and loading when page changes
  useEffect(() => {
    setPageLoading(true);
    setPageError(false);
    if (scrollRef.current) {
      scrollRef.current.scrollResponderZoomTo({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, animated: false });
    }
  }, [currentPage]);

  // Page navigation handlers
  const goToPage = (p) => {
    const target = Math.max(1, Math.min(meta.pageCount, p));
    if (target !== currentPage) {
      setCurrentPage(target);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) goToPage(currentPage - 1);
  };

  const handleNextPage = () => {
    if (currentPage < meta.pageCount) goToPage(currentPage + 1);
  };

  // Double tap to toggle zoom
  const handleDoubleTap = () => {
    const now = Date.now();
    if (lastTapRef.current && now - lastTapRef.current < 300) {
      if (zoomLevel > 1) {
        scrollRef.current?.scrollResponderZoomTo({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, animated: true });
        setZoomLevel(1);
      } else {
        scrollRef.current?.scrollResponderZoomTo({ x: SCREEN_WIDTH / 4, y: SCREEN_HEIGHT / 4, width: SCREEN_WIDTH / 2, height: SCREEN_HEIGHT / 2, animated: true });
        setZoomLevel(2);
      }
      lastTapRef.current = null;
    } else {
      lastTapRef.current = now;
    }
  };

  // Horizontal swipe gestures to flip pages when not zoomed in
  const onTouchStart = (e) => {
    setTouchState({
      startX: e.nativeEvent.pageX,
      startY: e.nativeEvent.pageY,
    });
  };

  const onTouchEnd = (e) => {
    if (zoomLevel > 1.1) return; // Ignore swipe when zoomed in
    const dx = e.nativeEvent.pageX - touchState.startX;
    const dy = e.nativeEvent.pageY - touchState.startY;

    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) {
      if (dx < 0) {
        // Swipe left -> Next Page
        handleNextPage();
      } else if (dx > 0 && touchState.startX > 50) {
        // Swipe right (from inside screen) -> Prev Page
        handlePrevPage();
      }
    }
  };

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>正在初始化内置 PDF 阅读器...</Text>
        {onClose && (
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>取消并返回</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Toolbar */}
      <View style={styles.toolbar}>
        {/* Page Pill */}
        <View style={styles.pagePill}>
          <Text style={styles.pagePillText}>
            第 {currentPage} / {meta.pageCount} 页
          </Text>
        </View>

        {/* View Mode Switcher (if text is available) */}
        {meta.hasText && (
          <View style={styles.modeTabs}>
            <TouchableOpacity
              style={[styles.tabBtn, viewMode === 'image' && styles.tabBtnActive]}
              onPress={() => setViewMode('image')}
            >
              <Layers color={viewMode === 'image' ? '#ffffff' : colors.sub} size={14} />
              <Text style={[styles.tabBtnText, viewMode === 'image' && styles.tabBtnTextActive]}>图版</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, viewMode === 'text' && styles.tabBtnActive]}
              onPress={() => setViewMode('text')}
            >
              <BookOpen color={viewMode === 'text' ? '#ffffff' : colors.sub} size={14} />
              <Text style={[styles.tabBtnText, viewMode === 'text' && styles.tabBtnTextActive]}>文字</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Zoom Controls */}
        {viewMode === 'image' && (
          <View style={styles.zoomActions}>
            <TouchableOpacity
              style={styles.zoomBtn}
              onPress={() => {
                scrollRef.current?.scrollResponderZoomTo({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, animated: true });
                setZoomLevel(1);
              }}
            >
              <RotateCcw color={colors.sub} size={15} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.zoomBtn}
              onPress={() => {
                scrollRef.current?.scrollResponderZoomTo({ x: SCREEN_WIDTH / 4, y: SCREEN_HEIGHT / 4, width: SCREEN_WIDTH / 2, height: SCREEN_HEIGHT / 2, animated: true });
                setZoomLevel(2);
              }}
            >
              <ZoomIn color={colors.sub} size={15} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Main Viewport */}
      {viewMode === 'image' ? (
        <View
          style={styles.viewport}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.pageScroll}
            contentContainerStyle={styles.pageScrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            onScrollEndDrag={() => {}}
          >
            <TouchableOpacity activeOpacity={1} onPress={handleDoubleTap} style={styles.imageTouchBox}>
              <Image
                source={{ uri: pageImageUrl }}
                style={styles.pageImage}
                resizeMode="contain"
                onLoadStart={() => setPageLoading(true)}
                onLoadEnd={() => setPageLoading(false)}
                onError={() => {
                  setPageLoading(false);
                  setPageError(true);
                }}
              />
            </TouchableOpacity>
          </ScrollView>

          {/* Page Loading Overlay */}
          {pageLoading && (
            <View style={styles.pageLoadingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.pageLoadingText}>正在加载第 {currentPage} 页...</Text>
            </View>
          )}

          {/* Page Error View */}
          {pageError && (
            <View style={styles.pageErrorOverlay}>
              <AlertCircle color={colors.red} size={40} style={{ marginBottom: 12 }} />
              <Text style={styles.pageErrorTitle}>该页光栅化渲染失败</Text>
              <Text style={styles.pageErrorSub}>
                服务器可能正在处理超大图元，请尝试重新加载本页或切换到速读文字模式。
              </Text>
              <TouchableOpacity
                style={styles.pageRetryBtn}
                onPress={() => {
                  setPageError(false);
                  setPageLoading(true);
                }}
              >
                <RefreshCw color="#ffffff" size={15} />
                <Text style={styles.pageRetryText}>重试本页</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : (
        /* Text Extraction Reading Mode */
        <ScrollView style={styles.textScrollView} contentContainerStyle={styles.textContent}>
          <Text style={styles.textExtractionTitle}>
            {item?.name} · 文本速读抽取
          </Text>
          <Text selectable style={styles.textExtractionBody}>
            {meta.text || '（文档未提取到有效纯文本正文）'}
          </Text>
        </ScrollView>
      )}

      {/* Bottom Navigation Bar */}
      <View style={styles.bottomBar}>
        {/* Jump First Page */}
        <TouchableOpacity
          style={[styles.navBtn, currentPage <= 1 && styles.navBtnDisabled]}
          disabled={currentPage <= 1}
          onPress={() => goToPage(1)}
        >
          <ChevronsLeft color={currentPage <= 1 ? colors.muted : colors.textStrong} size={18} />
        </TouchableOpacity>

        {/* Prev Page */}
        <TouchableOpacity
          style={[styles.navStepBtn, currentPage <= 1 && styles.navBtnDisabled]}
          disabled={currentPage <= 1}
          onPress={handlePrevPage}
        >
          <ChevronLeft color={currentPage <= 1 ? colors.muted : '#ffffff'} size={16} />
          <Text style={[styles.navStepText, currentPage <= 1 && { color: colors.muted }]}>上一页</Text>
        </TouchableOpacity>

        {/* Page Counter & Quick Jumping Pill */}
        <View style={styles.jumpPill}>
          <Text style={styles.jumpPillText}>
            {currentPage} / {meta.pageCount}
          </Text>
        </View>

        {/* Next Page */}
        <TouchableOpacity
          style={[styles.navStepBtn, currentPage >= meta.pageCount && styles.navBtnDisabled]}
          disabled={currentPage >= meta.pageCount}
          onPress={handleNextPage}
        >
          <Text style={[styles.navStepText, currentPage >= meta.pageCount && { color: colors.muted }]}>下一页</Text>
          <ChevronRight color={currentPage >= meta.pageCount ? colors.muted : '#ffffff'} size={16} />
        </TouchableOpacity>

        {/* Jump Last Page */}
        <TouchableOpacity
          style={[styles.navBtn, currentPage >= meta.pageCount && styles.navBtnDisabled]}
          disabled={currentPage >= meta.pageCount}
          onPress={() => goToPage(meta.pageCount)}
        >
          <ChevronsRight color={currentPage >= meta.pageCount ? colors.muted : colors.textStrong} size={18} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (colors, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.bg,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: colors.bg,
  },
  loadingText: {
    color: colors.sub,
    fontSize: 14,
    marginTop: 14,
  },
  cancelBtn: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cancelBtnText: {
    color: colors.textStrong,
    fontSize: 13,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  pagePill: {
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(2, 132, 199, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pagePillText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: 'bold',
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: colors.cardSecondary,
    borderRadius: 8,
    padding: 2,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  tabBtnActive: {
    backgroundColor: colors.accent,
  },
  tabBtnText: {
    fontSize: 12,
    color: colors.sub,
    fontWeight: '600',
  },
  tabBtnTextActive: {
    color: '#ffffff',
  },
  zoomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  zoomBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: colors.cardSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewport: {
    flex: 1,
    width: '100%',
    position: 'relative',
    backgroundColor: colors.bg,
  },
  pageScroll: {
    flex: 1,
    width: '100%',
  },
  pageScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageTouchBox: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.76,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageImage: {
    width: '100%',
    height: '100%',
  },
  pageLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(11, 15, 25, 0.8)' : 'rgba(248, 250, 252, 0.8)',
  },
  pageLoadingText: {
    color: colors.sub,
    fontSize: 13,
    marginTop: 10,
  },
  pageErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.bg,
  },
  pageErrorTitle: {
    color: colors.textStrong,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  pageErrorSub: {
    color: colors.sub,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  pageRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
  },
  pageRetryText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  textScrollView: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  textContent: {
    padding: 18,
    paddingBottom: 40,
  },
  textExtractionTitle: {
    color: colors.sub,
    fontSize: 13,
    marginBottom: 12,
    fontWeight: '500',
  },
  textExtractionBody: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 24,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.bar,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cardSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navStepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    gap: 2,
  },
  navStepText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  jumpPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.cardSecondary,
  },
  jumpPillText: {
    color: colors.textStrong,
    fontSize: 13,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
});
