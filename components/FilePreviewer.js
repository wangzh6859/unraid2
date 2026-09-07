/**
 * FilePreviewer —— 全屏沉浸式即时文件预览系统
 *
 * 统一调度各类专用预览器：
 * - video:   VideoPlayer (HTTP 206 流式播放、手势进度条、缩放模式、防误触)
 * - audio:   AudioPlayer (黑胶唱片旋转动画、高保真流、倍速控制、单曲循环)
 * - image:   ImageViewer (多点触控平移缩放、双击放大、分辨率指示)
 * - text:    CodeTextViewer (行号高亮、阅读模式与实时写回服务器编辑模式)
 * - docx:    DocxViewer (JSZip 解析 XML 提取段落纯文本)
 * - sheet:   XlsxViewer (SheetJS 解析 Excel 多工作表网格)
 * - ebook:   EpubViewer (电子书目录与章节分页阅读)
 * - archive: ArchiveViewer (ZIP / TAR 压缩包内嵌目录浏览与直接预览)
 * - pdf:     PdfViewer (PDF 元数据提示与快速本地下载通道)
 */
import React, { useMemo } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  Modal, Platform,
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!item) return null;

  const targetPath = item.path || item.href || '';
  const streamUrl = getDirectUrl
    ? getDirectUrl(targetPath)
    : `${serverUrl}/api.php?token=${apiToken}&action=file_stream&path=${encodeURIComponent(targetPath)}`;

  const kind = getFileKind(item.name);

  const renderContent = () => {
    switch (kind) {
      case 'video':
        return <VideoPlayer item={item} streamUrl={streamUrl} onDownload={onDownload} />;
      case 'audio':
        return <AudioPlayer item={item} streamUrl={streamUrl} onDownload={onDownload} />;
      case 'image':
        return <ImageViewer item={item} streamUrl={streamUrl} onDownload={onDownload} />;
      case 'text':
        return <CodeTextViewer item={item} serverUrl={serverUrl} apiToken={apiToken} />;
      case 'docx':
      case 'doc':
        return <DocxViewer item={item} getDirectUrl={getDirectUrl} authHeaders={authHeaders} onDownload={onDownload} />;
      case 'sheet':
        return <XlsxViewer item={item} getDirectUrl={getDirectUrl} authHeaders={authHeaders} onDownload={onDownload} />;
      case 'ebook':
        return <EpubViewer item={item} getDirectUrl={getDirectUrl} authHeaders={authHeaders} onDownload={onDownload} />;
      case 'archive':
        return <ArchiveViewer item={item} getDirectUrl={getDirectUrl} authHeaders={authHeaders} onDownload={onDownload} />;
      case 'pdf':
        return <PdfViewer item={item} onDownload={onDownload} />;
      default:
        return (
          <View style={styles.fallbackContainer}>
            <File color="#4b5563" size={72} style={{ marginBottom: 18 }} />
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
      <View style={styles.container}>
        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <X color="#ffffff" size={24} />
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

          <TouchableOpacity onPress={() => onDownload(item)} style={styles.headerBtn}>
            <DownloadCloud color="#3b82f6" size={24} />
          </TouchableOpacity>
        </View>

        {/* Dynamic Viewer Body */}
        <View style={styles.body}>{renderContent()}</View>
      </View>
    </Modal>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0c',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(15, 17, 23, 0.96)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleBox: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  titleText: {
    color: '#ffffff',
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
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  extBadgeText: {
    color: '#60a5fa',
    fontSize: 10,
    fontWeight: 'bold',
  },
  sizeText: {
    color: '#9ca3af',
    fontSize: 11,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackContainer: {
    alignItems: 'center',
    padding: 36,
    width: '100%',
  },
  fallbackTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  fallbackMeta: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 16,
  },
  fallbackHint: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  fallbackDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3b82f6',
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
