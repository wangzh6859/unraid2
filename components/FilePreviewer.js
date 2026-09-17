/**
 * FilePreviewer —— 全屏沉浸式即时文件预览系统
 *
 * 统一调度各类专用预览器：
 * - video:   VideoPlayer (HTTP 206 流式播放、手势进度条、缩放模式、防误触)
 * - audio:   AudioPlayer (黑胶唱片旋转动画、高保真流、倍速控制、单曲循环)
 * - image:   ImageViewer (多点触控平移缩放、双击放大、分辨率指示)
 * - text:    CodeTextViewer (超高渲染性能单节点渲染、行号高亮、阅读与实时写回编辑)
 * - docx:    DocxViewer (JSZip 解析 XML 提取段落纯文本)
 * - sheet:   XlsxViewer (SheetJS 解析 Excel 多工作表网格)
 * - ebook:   EpubViewer (电子书目录与章节分页阅读)
 * - archive: ArchiveViewer (ZIP / TAR 压缩包内嵌目录浏览与直接预览)
 * - pdf:     PdfViewer (纯内置高保真多页原生阅读器与文本速读)
 */
import React, { useMemo, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  Modal, Platform, BackHandler, PanResponder,
} from 'react-native';
import { X, DownloadCloud, File, Download } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import { getFileKind } from '../utils/fileTypes';
import { formatBytes } from '../utils/cacheManager';

import VideoPlayer from './previewers/VideoPlayer';
import AudioPlayer from './previewers/AudioPlayer';
import ImageViewer from './previewers/ImageViewer';
import CodeTextViewer from './previewers/CodeTextViewer';
import DocxViewer from './previewers/DocxViewer';
import XlsxViewer from './previewers/XlsxViewer';
import EpubViewer from './previewers/EpubViewer';
import ArchiveViewer from './previewers/ArchiveViewer';
import PdfViewer from './previewers/PdfViewer';

export default function FilePreviewer({
  item,
  serverUrl,
  apiToken,
  getDirectUrl,
  authHeaders,
  onClose,
  onDownload,
}) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  // CRITICAL FIX: Only register back press when an item is actually opened!
  useEffect(() => {
    if (!item) return;

    const onBackPress = () => {
      if (onClose) {
        onClose();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [item, onClose]);

  // Swipe-to-dismiss gesture: swiping right from the left screen edge closes the preview
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dx > 25 && Math.abs(gestureState.dy) < 30 && gestureState.x0 < 60;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 60 && onClose) {
          onClose();
        }
      },
    })
  ).current;

  if (!item) return null;

  const targetPath = item.path || item.href || '';
  const streamUrl = getDirectUrl
    ? getDirectUrl(targetPath)
    : `${serverUrl}/api.php?token=${encodeURIComponent(apiToken || '')}&action=file_stream&path=${encodeURIComponent(targetPath)}`;

  const kind = getFileKind(item.name);

  const renderContent = () => {
    switch (kind) {
      case 'video':
        return <VideoPlayer item={item} streamUrl={streamUrl} onClose={onClose} onDownload={onDownload} />;
      case 'audio':
        return <AudioPlayer item={item} streamUrl={streamUrl} onClose={onClose} onDownload={onDownload} />;
      case 'image':
        return <ImageViewer item={item} streamUrl={streamUrl} onClose={onClose} onDownload={onDownload} />;
      case 'text':
        return <CodeTextViewer item={item} serverUrl={serverUrl} apiToken={apiToken} streamUrl={streamUrl} onClose={onClose} />;
      case 'docx':
      case 'doc':
        return <DocxViewer item={item} getDirectUrl={getDirectUrl} authHeaders={authHeaders} onClose={onClose} onDownload={onDownload} />;
      case 'sheet':
        return <XlsxViewer item={item} getDirectUrl={getDirectUrl} authHeaders={authHeaders} onClose={onClose} onDownload={onDownload} />;
      case 'ebook':
        return <EpubViewer item={item} getDirectUrl={getDirectUrl} authHeaders={authHeaders} onClose={onClose} onDownload={onDownload} />;
      case 'archive':
        return <ArchiveViewer item={item} getDirectUrl={getDirectUrl} authHeaders={authHeaders} onClose={onClose} onDownload={onDownload} />;
      case 'pdf':
        return <PdfViewer item={item} serverUrl={serverUrl} apiToken={apiToken} streamUrl={streamUrl} getDirectUrl={getDirectUrl} onClose={onClose} onDownload={onDownload} />;
      default:
        return (
          <View style={styles.fallbackContainer}>
            <File color={colors.sub} size={72} style={{ marginBottom: 18 }} />
            <Text style={styles.fallbackTitle}>{item.name}</Text>
            <Text style={styles.fallbackMeta}>{formatBytes(item.size)}</Text>
            <Text style={styles.fallbackHint}>
              该格式暂无内置即时渲染器，您可以将其下载到手机，使用相应应用程序查看。
            </Text>
            <TouchableOpacity style={styles.fallbackDownloadBtn} onPress={() => onDownload(item)}>
              <Download color="#ffffff" size={20} />
              <Text style={styles.fallbackDownloadText}>下载到手机查看</Text>
            </TouchableOpacity>
          </View>
        );
    }
  };

  const ext = (item.name || '').split('.').pop().toUpperCase();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container} {...panResponder.panHandlers}>
        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <X color={colors.textStrong} size={22} />
          </TouchableOpacity>

          <View style={styles.titleBox}>
            <Text style={styles.titleText} numberOfLines={1}>{item.name}</Text>
            <View style={styles.metaRow}>
              <View style={styles.extBadge}>
                <Text style={styles.extBadgeText}>{ext || 'FILE'}</Text>
              </View>
              <Text style={styles.sizeText}>{formatBytes(item.size)}</Text>
            </View>
          </View>

          <TouchableOpacity onPress={() => onDownload(item)} style={styles.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <DownloadCloud color={colors.accent} size={22} />
          </TouchableOpacity>
        </View>

        {/* Dynamic Viewer Body */}
        <View style={styles.body}>{renderContent()}</View>
      </View>
    </Modal>
  );
}

const createStyles = (colors, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.bar,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.cardSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleBox: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  titleText: {
    color: colors.textStrong,
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  extBadge: {
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(2, 132, 199, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  extBadgeText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: 'bold',
  },
  sizeText: {
    color: colors.sub,
    fontSize: 11,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  fallbackContainer: {
    alignItems: 'center',
    padding: 36,
    width: '100%',
    backgroundColor: colors.bg,
  },
  fallbackTitle: {
    color: colors.textStrong,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  fallbackMeta: {
    color: colors.sub,
    fontSize: 14,
    marginBottom: 16,
  },
  fallbackHint: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  fallbackDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 28,
    gap: 8,
  },
  fallbackDownloadText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
