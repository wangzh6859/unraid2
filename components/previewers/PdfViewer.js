import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Dimensions, Platform, NativeModules,
} from 'react-native';
import {
  BookOpen, Layers, ChevronLeft, ChevronRight,
  ZoomIn, RotateCcw, AlertCircle, RefreshCw,
  ChevronsLeft, ChevronsRight, Download, CheckCircle2,
} from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { formatBytes } from '../../utils/cacheManager';
import { apiFetch } from '../../utils/apiClient';
import { downloadToCache } from '../../utils/previewUtils';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const { PdfRenderer } = NativeModules;

export default function PdfViewer({ item, serverUrl, apiToken, streamUrl, getDirectUrl, onClose, onDownload }) {
  const { colors, isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState('正在初始化阅读器...');
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(false);
  const [pageErrorMessage, setPageErrorMessage] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  const [meta, setMeta] = useState({
    pageCount: 1,
    hasRenderEngine: false,
    hasText: false,
    text: '',
    isNative: false,
    localUri: '',
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState('image'); // 'image' | 'text'
  const [zoomLevel, setZoomLevel] = useState(1);
  const [touchState, setTouchState] = useState({ startX: 0, startY: 0 });
  const [pageImageUri, setPageImageUri] = useState('');

  const scrollRef = useRef(null);
  const lastTapRef = useRef(null);
  const isMountedRef = useRef(true);
  const pageLoadingTimerRef = useRef(null);

  const targetPath = item?.path || item?.href || '';

  // Clean up on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pageLoadingTimerRef.current) {
        clearTimeout(pageLoadingTimerRef.current);
      }
    };
  }, []);

  // 1. Initialize PDF Viewer (Native Android PdfRenderer or Server Fallback)
  useEffect(() => {
    let cancelled = false;

    const initPdf = async () => {
      setLoading(true);
      setPageError(false);

      const hasNative = Boolean(PdfRenderer && typeof PdfRenderer.getPdfInfo === 'function');

      if (hasNative) {
        try {
          if (!cancelled) setLoadingStep('正在从服务器下载 PDF 文件...');
          
          const localUri = await downloadToCache({
            file: item,
            getDirectUrl: getDirectUrl || ((p) => streamUrl || `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=file_stream&path=${encodeURIComponent(p)}`),
            authHeaders: { 'X-API-Token': apiToken },
          });

          if (cancelled) return;
          setLoadingStep('正在解析文档结构...');

          const info = await PdfRenderer.getPdfInfo(localUri);
          const pCount = Math.max(1, info?.pageCount || 1);

          if (cancelled) return;
          setMeta({
            pageCount: pCount,
            hasRenderEngine: true,
            hasText: false,
            text: '',
            isNative: true,
            localUri: localUri,
          });

          // Render first page
          await renderNativePage(localUri, 1, pCount);
          if (!cancelled) setLoading(false);
          return;
        } catch (e) {
          console.warn('[PdfViewer] Native render setup failed, falling back to server preview:', e);
          if (cancelled) return;
        }
      }

      // Fallback: Query server capabilities
      try {
        if (!cancelled) setLoadingStep('正在连接服务器渲染引擎...');
        const url = `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=pdf_preview&path=${encodeURIComponent(targetPath)}`;
        const res = await apiFetch(url, { method: 'GET' }, 8000, 1);
        if (res && res.ok) {
          const json = await res.json().catch(() => null);
          if (json && json.status === 'success') {
            const pCount = Math.max(1, json.page_count || 1);
            if (!cancelled) {
              setMeta({
                pageCount: pCount,
                hasRenderEngine: Boolean(json.has_render_engine),
                hasText: Boolean(json.has_text),
                text: json.text || '',
                isNative: false,
                localUri: '',
              });
              if (!json.has_render_engine && json.has_text) {
                setViewMode('text');
              }
            }
          }
        }
      } catch (err) {
        console.warn('[PdfViewer] Server metadata query error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (serverUrl && (targetPath || item)) {
      initPdf();
    }

    return () => {
      cancelled = true;
    };
  }, [serverUrl, targetPath, item?.name, item?.size]);

  // Native page renderer helper
  const renderNativePage = async (localUri, pageNum, totalPages = meta.pageCount) => {
    if (!PdfRenderer || !localUri) return;
    setPageLoading(true);
    setPageError(false);

    // Timeout safety: if render doesn't return within 10 seconds, clear loading
    if (pageLoadingTimerRef.current) clearTimeout(pageLoadingTimerRef.current);
    pageLoadingTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setPageLoading(false);
        setPageError(true);
        setPageErrorMessage('页面渲染超时，请点击下方重试');
      }
    }, 10000);

    try {
      const res = await PdfRenderer.renderPage(localUri, pageNum - 1, 144);
      if (pageLoadingTimerRef.current) clearTimeout(pageLoadingTimerRef.current);
      if (isMountedRef.current && res && res.uri) {
        setPageImageUri(res.uri);
        setPageLoading(false);
      }

      // Background pre-render adjacent pages
      const nextPage = pageNum + 1;
      if (nextPage <= totalPages) {
        PdfRenderer.renderPage(localUri, nextPage - 1, 144).catch(() => {});
      }
      const prevPage = pageNum - 1;
      if (prevPage >= 1) {
        PdfRenderer.renderPage(localUri, prevPage - 1, 144).catch(() => {});
      }
    } catch (e) {
      if (pageLoadingTimerRef.current) clearTimeout(pageLoadingTimerRef.current);
      if (isMountedRef.current) {
        setPageLoading(false);
        setPageError(true);
        setPageErrorMessage(e?.message || '本地光栅化渲染失败');
      }
    }
  };

  // Server page image URL calculation
  const serverPageUrl = useMemo(() => {
    if (!serverUrl || !targetPath) return '';
    return `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=pdf_page&path=${encodeURIComponent(targetPath)}&page=${currentPage}&dpi=144&_t=${retryNonce}`;
  }, [serverUrl, apiToken, targetPath, currentPage, retryNonce]);

  // Handle page change
  useEffect(() => {
    if (meta.isNative && meta.localUri) {
      renderNativePage(meta.localUri, currentPage, meta.pageCount);
    } else {
      setPageLoading(true);
      setPageError(false);
      // Timeout safety for server image
      if (pageLoadingTimerRef.current) clearTimeout(pageLoadingTimerRef.current);
      pageLoadingTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setPageLoading(false);
        }
      }, 12000);
    }

    if (scrollRef.current) {
      if (Platform.OS === 'ios') {
        scrollRef.current.scrollResponderZoomTo({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, animated: false });
      } else {
        scrollRef.current.scrollTo({ x: 0, y: 0, animated: false });
      }
    }
    setZoomLevel(1);
  }, [currentPage, meta.isNative, meta.localUri]);

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

  const handleRetryPage = () => {
    setPageError(false);
    setPageLoading(true);
    setRetryNonce(n => n + 1);
    if (meta.isNative && meta.localUri) {
      renderNativePage(meta.localUri, currentPage, meta.pageCount);
    }
  };

  // Double tap to toggle zoom
  const handleDoubleTap = () => {
    const now = Date.now();
    if (lastTapRef.current && now - lastTapRef.current < 300) {
      if (zoomLevel > 1) {
        if (Platform.OS === 'ios') {
          scrollRef.current?.scrollResponderZoomTo({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, animated: true });
        } else {
          scrollRef.current?.scrollTo({ x: 0, y: 0, animated: true });
        }
        setZoomLevel(1);
      } else {
        if (Platform.OS === 'ios') {
          scrollRef.current?.scrollResponderZoomTo({ x: SCREEN_WIDTH / 4, y: SCREEN_HEIGHT / 4, width: SCREEN_WIDTH / 2, height: SCREEN_HEIGHT / 2, animated: true });
        }
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
        handleNextPage();
      } else if (dx > 0 && touchState.startX > 50) {
        handlePrevPage();
      }
    }
  };

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingTitle}>内置高保真 PDF 渲染器</Text>
        <Text style={styles.loadingText}>{loadingStep}</Text>
        {onClose && (
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>取消并返回</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const activeImageSource = meta.isNative ? { uri: pageImageUri } : { uri: serverPageUrl };

  return (
    <View style={styles.container}>
      {/* Top Toolbar */}
      <View style={styles.toolbar}>
        {/* Page Pill */}
        <View style={styles.pagePill}>
          <Text style={styles.pagePillText}>
            第 {currentPage} / {meta.pageCount} 页 {meta.isNative ? '· 本地渲染' : ''}
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
                if (Platform.OS === 'ios') {
                  scrollRef.current?.scrollResponderZoomTo({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, animated: true });
                } else {
                  scrollRef.current?.scrollTo({ x: 0, y: 0, animated: true });
                }
                setZoomLevel(1);
              }}
            >
              <RotateCcw color={colors.sub} size={15} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.zoomBtn}
              onPress={() => {
                const nextZoom = zoomLevel >= 2 ? 1 : zoomLevel + 0.5;
                if (Platform.OS === 'ios') {
                  if (nextZoom > 1) {
                    scrollRef.current?.scrollResponderZoomTo({ x: SCREEN_WIDTH / 4, y: SCREEN_HEIGHT / 4, width: SCREEN_WIDTH / 2, height: SCREEN_HEIGHT / 2, animated: true });
                  } else {
                    scrollRef.current?.scrollResponderZoomTo({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, animated: true });
                  }
                }
                setZoomLevel(nextZoom);
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
              {Boolean(meta.isNative ? pageImageUri : serverPageUrl) && (
                <Image
                  key={`pdf_page_${currentPage}_${retryNonce}`}
                  source={activeImageSource}
                  style={[styles.pageImage, zoomLevel !== 1 && Platform.OS === 'android' && { transform: [{ scale: zoomLevel }] }]}
                  resizeMode="contain"
                  onLoadStart={() => setPageLoading(true)}
                  onLoadEnd={() => {
                    if (pageLoadingTimerRef.current) clearTimeout(pageLoadingTimerRef.current);
                    setPageLoading(false);
                  }}
                  onError={() => {
                    if (pageLoadingTimerRef.current) clearTimeout(pageLoadingTimerRef.current);
                    setPageLoading(false);
                    setPageError(true);
                    setPageErrorMessage('页面光栅化渲染失败');
                  }}
                />
              )}
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
              <Text style={styles.pageErrorTitle}>{pageErrorMessage || '该页光栅化渲染失败'}</Text>
              <Text style={styles.pageErrorSub}>
                {meta.isNative
                  ? '本地光栅化遇到复杂图元，请点击下方重试，或切换至文字模式。'
                  : '服务器未配置光栅化引擎（poppler/ghostscript）。请尝试重新加载或下载至手机查看。'}
              </Text>
              <View style={styles.errorActionRow}>
                <TouchableOpacity
                  style={styles.pageRetryBtn}
                  onPress={handleRetryPage}
                >
                  <RefreshCw color="#ffffff" size={15} />
                  <Text style={styles.pageRetryText}>重试本页</Text>
                </TouchableOpacity>

                {meta.hasText && (
                  <TouchableOpacity
                    style={[styles.pageRetryBtn, { backgroundColor: colors.cardSecondary, borderWidth: 1, borderColor: colors.cardBorder }]}
                    onPress={() => setViewMode('text')}
                  >
                    <BookOpen color={colors.textStrong} size={15} />
                    <Text style={[styles.pageRetryText, { color: colors.textStrong }]}>切换文字模式</Text>
                  </TouchableOpacity>
                )}
              </View>
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
  loadingTitle: {
    color: colors.textStrong,
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 16,
  },
  loadingText: {
    color: colors.sub,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  cancelBtn: {
    marginTop: 24,
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
    height: SCREEN_HEIGHT * 0.74,
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
    textAlign: 'center',
  },
  pageErrorSub: {
    color: colors.sub,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  errorActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pageRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
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
    padding: 20,
  },
  textExtractionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 14,
  },
  textExtractionBody: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.text,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
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
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.accent,
    gap: 4,
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
    fontWeight: '600',
  },
});
