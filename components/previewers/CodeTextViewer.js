import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import {
  Save, Edit3, BookOpen, WrapText, RefreshCw, AlertTriangle, AlertCircle,
  Globe, ChevronDown,
} from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { useDialog } from '../../DialogContext';
import { formatBytes } from '../../utils/cacheManager';
import { apiFetch } from '../../utils/apiClient';

export default function CodeTextViewer({ item, serverUrl, apiToken, streamUrl, onClose }) {
  const { colors, isDark } = useTheme();
  const { showError, showSuccess } = useDialog();

  const [mode, setMode] = useState('reader'); // 'reader' | 'editor'
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const [wordWrap, setWordWrap] = useState(true);
  const [isTruncated, setIsTruncated] = useState(false);

  // Encoding states
  const [encoding, setEncoding] = useState('auto'); // 'auto' | 'utf-8' | 'gbk' | 'big5'
  const [detectedEncoding, setDetectedEncoding] = useState('UTF-8');
  const [totalSize, setTotalSize] = useState(0);
  const [loadedBytes, setLoadedBytes] = useState(0);

  const abortControllerRef = useRef(null);

  // Fetch text content with dynamic chunk streaming & encoding support
  const loadContent = async (overrideEncoding, offset = 0, isAppend = false, loadFull = false) => {
    if (!isAppend) {
      setLoading(true);
      setLoadError(null);
      setIsTruncated(false);
    } else {
      setLoadingMore(true);
    }

    if (abortControllerRef.current) {
      try { abortControllerRef.current.abort(); } catch (_) {}
    }
    abortControllerRef.current = new AbortController();

    const targetPath = item?.path || item?.href || '';
    const activeEncoding = overrideEncoding !== undefined ? overrideEncoding : encoding;
    // 2MB chunk by default; if loadFull is true, max_bytes=0 fetches entire file
    const maxBytes = loadFull ? 0 : 2097152;

    let url = `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=file_read&path=${encodeURIComponent(targetPath)}&max_bytes=${maxBytes}&offset=${offset}`;
    if (activeEncoding && activeEncoding !== 'auto') {
      url += `&encoding=${encodeURIComponent(activeEncoding)}`;
    }

    try {
      const res = await apiFetch(url, {
        method: 'GET',
        signal: abortControllerRef.current.signal,
      }, 15000, 1);

      if (res && res.ok) {
        const json = await res.json().catch(() => null);
        if (json && json.status === 'success' && typeof json.content === 'string') {
          if (json.encoding) setDetectedEncoding(json.encoding);
          if (json.size) setTotalSize(json.size);

          const bytesGot = json.preview_size !== undefined ? json.preview_size : json.content.length;
          const currentOffset = offset || 0;
          const newTotalLoaded = currentOffset + bytesGot;
          setLoadedBytes(newTotalLoaded);
          setIsTruncated(Boolean(json.truncated));

          if (isAppend) {
            setContent(prev => prev + json.content);
            setInitialContent(prev => prev + json.content);
          } else {
            // Full content without artificial 3000-line truncation!
            setContent(json.content);
            setInitialContent(json.content);
          }
        } else {
          setLoadError(json?.message || '读取文件失败');
        }
      } else {
        setLoadError(`HTTP ${res?.status || 'Error'}`);
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setLoadError(e.message || '网络连接超时');
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (item && serverUrl) {
      loadContent('auto', 0, false, false);
    }
    return () => {
      if (abortControllerRef.current) {
        try { abortControllerRef.current.abort(); } catch (_) {}
      }
    };
  }, [item?.path || item?.href, serverUrl]);

  // Save changes to server
  const saveContent = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const targetPath = item?.path || item?.href || '';
      const url = `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=file_write&path=${encodeURIComponent(targetPath)}`;
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: content,
      }, 10000, 0);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json().catch(() => null);
      if (json && json.status === 'success') {
        setInitialContent(content);
        showSuccess('保存成功', '文件已实时写回 Unraid 服务器！');
      } else {
        showError('保存失败', json?.message || '服务器拒绝写入');
      }
    } catch (e) {
      showError('网络异常', e.message || '写入超时');
    } finally {
      setSaving(false);
    }
  };

  const isDirty = content !== initialContent;

  const lineCount = useMemo(() => {
    if (!content) return 0;
    return content.split('\n').length;
  }, [content]);

  // High performance: single continuous string of line numbers
  const lineNumbersString = useMemo(() => {
    if (lineCount <= 0) return '';
    const arr = [];
    for (let i = 1; i <= lineCount; i++) {
      arr.push(i);
    }
    return arr.join('\n');
  }, [lineCount]);

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>正在加载文本内容...</Text>
        {onClose && (
          <TouchableOpacity
            style={styles.cancelLoadingBtn}
            onPress={() => {
              if (abortControllerRef.current) {
                try { abortControllerRef.current.abort(); } catch (_) {}
              }
              onClose();
            }}
          >
            <Text style={styles.cancelLoadingText}>取消加载并返回</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centerContainer}>
        <AlertCircle color={colors.red} size={48} style={{ marginBottom: 16 }} />
        <Text style={styles.errorTitle}>文本读取未响应</Text>
        <Text style={styles.errorMsg}>{loadError}</Text>
        <View style={styles.errorBtnRow}>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadContent(encoding, 0, false, false)}>
            <RefreshCw color="#ffffff" size={16} />
            <Text style={styles.retryBtnText}>重新读取</Text>
          </TouchableOpacity>
          {onClose && (
            <TouchableOpacity style={styles.errorCloseBtn} onPress={onClose}>
              <Text style={styles.errorCloseBtnText}>返回列表</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Truncation Warning Banner with Dynamic Chunk Loading */}
      {isTruncated && (
        <View style={styles.truncBanner}>
          <View style={styles.truncBannerLeft}>
            <AlertTriangle color={isDark ? '#FBBF24' : '#D97706'} size={15} />
            <Text style={styles.truncBannerText}>
              已载入 {formatBytes(loadedBytes)} / 共 {formatBytes(totalSize || item?.size)} ({lineCount} 行)
            </Text>
          </View>
          <View style={styles.truncBannerActions}>
            <TouchableOpacity
              style={styles.loadMoreBtn}
              onPress={() => loadContent(encoding, loadedBytes, true, false)}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.loadMoreBtnText}>+2MB 下一段</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.loadAllBtn}
              onPress={() => loadContent(encoding, 0, false, true)}
              disabled={loadingMore}
            >
              <Text style={styles.loadAllBtnText}>加载全部</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Top Toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.modeTabs}>
          <TouchableOpacity
            style={[styles.tabBtn, mode === 'reader' && styles.tabBtnActive]}
            onPress={() => setMode('reader')}
          >
            <BookOpen color={mode === 'reader' ? '#ffffff' : colors.sub} size={15} />
            <Text style={[styles.tabBtnText, mode === 'reader' && styles.tabBtnTextActive]}>阅读</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, mode === 'editor' && styles.tabBtnActive]}
            onPress={() => setMode('editor')}
          >
            <Edit3 color={mode === 'editor' ? '#ffffff' : colors.sub} size={15} />
            <Text style={[styles.tabBtnText, mode === 'editor' && styles.tabBtnTextActive]}>编辑</Text>
          </TouchableOpacity>
        </View>

        {/* Encoding Switcher Chip */}
        <TouchableOpacity
          style={styles.encodingChip}
          onPress={() => {
            const encList = ['auto', 'utf-8', 'gbk', 'big5'];
            const curIdx = encList.indexOf(encoding);
            const nextEnc = encList[(curIdx + 1) % encList.length];
            setEncoding(nextEnc);
            loadContent(nextEnc, 0, false, false);
          }}
        >
          <Globe color={colors.accent} size={13} style={{ marginRight: 4 }} />
          <Text style={styles.encodingChipText}>
            {encoding === 'auto' ? detectedEncoding : encoding.toUpperCase()}
          </Text>
        </TouchableOpacity>

        {/* Action icons */}
        <View style={styles.toolActions}>
          <TouchableOpacity
            style={styles.toolIconBtn}
            onPress={() => setFontSize(prev => Math.max(10, prev - 1))}
          >
            <Text style={styles.toolLabelText}>A-</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toolIconBtn}
            onPress={() => setFontSize(prev => Math.min(22, prev + 1))}
          >
            <Text style={styles.toolLabelText}>A+</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolIconBtn, wordWrap && styles.toolIconBtnActive]}
            onPress={() => setWordWrap(!wordWrap)}
          >
            <WrapText color={wordWrap ? colors.accent : colors.sub} size={16} />
          </TouchableOpacity>

          {mode === 'editor' && (
            <TouchableOpacity
              style={[styles.saveBtn, isDirty && styles.saveBtnDirty]}
              onPress={saveContent}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <>
                  <Save color="#ffffff" size={14} />
                  <Text style={styles.saveBtnText}>{isDirty ? '保存' : '已存'}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* High-Performance Editor / Reader Area */}
      <View style={styles.editorArea}>
        {mode === 'reader' ? (
          <ScrollView
            style={styles.readerScroll}
            contentContainerStyle={styles.readerScrollContent}
            horizontal={!wordWrap}
          >
            <View style={styles.gutterAndCodeRow}>
              {/* Ultra-Fast Single Text Line Numbers */}
              <View style={styles.gutter}>
                <Text
                  style={[
                    styles.gutterLine,
                    { fontSize, lineHeight: fontSize * 1.5, color: colors.muted },
                  ]}
                >
                  {lineNumbersString}
                </Text>
              </View>

              {/* Ultra-Fast Single Text Code Content */}
              <View style={[styles.codeWrap, !wordWrap && { minWidth: 600 }]}>
                <Text
                  selectable
                  style={[
                    styles.codeLine,
                    { fontSize, lineHeight: fontSize * 1.5, color: colors.text },
                    !wordWrap && { flexWrap: 'nowrap' },
                  ]}
                >
                  {content || ' '}
                </Text>
              </View>
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={styles.textInputScroll} keyboardShouldPersistTaps="handled">
            <TextInput
              style={[
                styles.textInput,
                {
                  fontSize,
                  lineHeight: fontSize * 1.5,
                  color: colors.text,
                  backgroundColor: colors.bg,
                },
              ]}
              multiline
              value={content}
              onChangeText={setContent}
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
            />
          </ScrollView>
        )}
      </View>

      {/* Bottom Status Bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          {lineCount} 行 · {formatBytes(content.length)} · 编码: {detectedEncoding}
        </Text>
        {isDirty && (
          <View style={styles.dirtyPill}>
            <Text style={styles.dirtyPillText}>未保存修改</Text>
          </View>
        )}
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
  cancelLoadingBtn: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cancelLoadingText: {
    color: colors.textStrong,
    fontSize: 13,
    fontWeight: '600',
  },
  errorTitle: {
    color: colors.textStrong,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  errorMsg: {
    color: colors.red,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  errorBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
  },
  retryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  errorCloseBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.cardSecondary,
  },
  errorCloseBtnText: {
    color: colors.sub,
    fontSize: 14,
  },
  truncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: isDark ? 'rgba(245, 158, 11, 0.3)' : 'rgba(245, 158, 11, 0.25)',
  },
  truncBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  truncBannerText: {
    color: isDark ? '#FBBF24' : '#B45309',
    fontSize: 12,
    fontWeight: '600',
  },
  truncBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadMoreBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  loadMoreBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  loadAllBtn: {
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  loadAllBtnText: {
    color: colors.textStrong,
    fontSize: 11,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
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
    paddingVertical: 5,
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
  encodingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  encodingChipText: {
    fontSize: 11,
    color: colors.accent,
    fontWeight: 'bold',
  },
  toolActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: colors.cardSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolIconBtnActive: {
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.2)' : 'rgba(2, 132, 199, 0.15)',
  },
  toolLabelText: {
    color: colors.textStrong,
    fontSize: 12,
    fontWeight: 'bold',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardSecondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  saveBtnDirty: {
    backgroundColor: colors.green,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  editorArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  readerScroll: {
    flex: 1,
  },
  readerScrollContent: {
    paddingVertical: 8,
  },
  gutterAndCodeRow: {
    flexDirection: 'row',
  },
  gutter: {
    paddingRight: 10,
    paddingLeft: 12,
    alignItems: 'flex-end',
    borderRightWidth: 1,
    borderRightColor: colors.divider,
  },
  gutterLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'right',
  },
  codeWrap: {
    flex: 1,
    paddingLeft: 12,
    paddingRight: 16,
  },
  codeLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  textInputScroll: {
    flex: 1,
  },
  textInput: {
    flex: 1,
    padding: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  statusText: {
    color: colors.sub,
    fontSize: 11,
  },
  dirtyPill: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  dirtyPillText: {
    color: colors.red,
    fontSize: 10,
    fontWeight: 'bold',
  },
});
