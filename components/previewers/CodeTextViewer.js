import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import {
  Save, Edit3, BookOpen, WrapText, RefreshCw, AlertTriangle, AlertCircle,
} from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { useDialog } from '../../DialogContext';
import { formatBytes } from '../../utils/cacheManager';
import { apiFetch } from '../../utils/apiClient';

export default function CodeTextViewer({ item, serverUrl, apiToken, streamUrl }) {
  const { colors, isDark } = useTheme();
  const { showError, showSuccess } = useDialog();

  const [mode, setMode] = useState('reader'); // 'reader' | 'editor'
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const [wordWrap, setWordWrap] = useState(true);
  const [isTruncated, setIsTruncated] = useState(false);

  // Fetch text content with timeout-protected dual-strategy
  const loadContent = async () => {
    setLoading(true);
    setLoadError(null);
    setIsTruncated(false);
    const targetPath = item?.path || item?.href || '';
    let loadedText = null;
    let lastError = '';

    // Strategy 1: action=file_read with 512KB preview limit
    try {
      const url = `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=file_read&path=${encodeURIComponent(targetPath)}&max_bytes=524288`;
      const res = await apiFetch(url, { method: 'GET' }, 7000, 1);
      if (res && res.ok) {
        const json = await res.json().catch(() => null);
        if (json && json.status === 'success' && typeof json.content === 'string') {
          loadedText = json.content;
          if (json.truncated) setIsTruncated(true);
        } else if (json && json.message) {
          lastError = json.message;
        }
      } else if (res) {
        const errTxt = await res.text().catch(() => '');
        lastError = `HTTP ${res.status}: ${errTxt.slice(0, 100)}`;
      }
    } catch (e) {
      lastError = e.message;
    }

    // Strategy 2: fallback to raw stream
    if (loadedText === null) {
      try {
        const directUrl = streamUrl || `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=file_stream&path=${encodeURIComponent(targetPath)}`;
        const streamRes = await apiFetch(directUrl, { method: 'GET' }, 7000, 1);
        if (streamRes && streamRes.ok) {
          loadedText = await streamRes.text().catch(() => null);
        } else if (streamRes) {
          lastError = lastError || `HTTP ${streamRes.status}`;
        }
      } catch (e) {
        lastError = lastError || e.message;
      }
    }

    if (loadedText !== null) {
      const allLines = loadedText.split('\n');
      if (allLines.length > 3000) {
        setIsTruncated(true);
        const sliced = allLines.slice(0, 3000).join('\n');
        setContent(sliced);
        setInitialContent(sliced);
      } else {
        setContent(loadedText);
        setInitialContent(loadedText);
      }
    } else {
      setLoadError(lastError || '无法读取文件内容');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (item && serverUrl) {
      loadContent();
    }
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
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centerContainer}>
        <AlertCircle color={colors.red} size={48} style={{ marginBottom: 16 }} />
        <Text style={styles.errorTitle}>文本读取未响应</Text>
        <Text style={styles.errorMsg}>{loadError}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadContent}>
          <RefreshCw color="#ffffff" size={16} />
          <Text style={styles.retryBtnText}>重新读取</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Truncation Warning Banner for Large Files */}
      {isTruncated && (
        <View style={styles.truncBanner}>
          <AlertTriangle color={isDark ? '#FBBF24' : '#D97706'} size={15} />
          <Text style={styles.truncBannerText}>
            文件较大（{formatBytes(item?.size)}），已自动载入前 {lineCount} 行极速速读。如需完整查看可下载至手机。
          </Text>
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
                { fontSize, lineHeight: fontSize * 1.5, color: colors.text, backgroundColor: colors.bg },
                !wordWrap && { minWidth: 800 },
              ]}
              multiline
              value={content}
              onChangeText={setContent}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="在此输入文本..."
              placeholderTextColor={colors.muted}
            />
          </ScrollView>
        )}
      </View>

      {/* Bottom Status Bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusInfoText}>
          {lineCount} 行 · {content.length} 字符 · {formatBytes(item?.size)}
        </Text>
        <Text style={[styles.statusModeBadge, isDirty && { color: colors.amber }]}>
          {isDirty ? '● 未保存修改' : '● 已同步'}
        </Text>
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
    backgroundColor: colors.bg,
    padding: 24,
  },
  loadingText: {
    color: colors.sub,
    fontSize: 14,
    marginTop: 12,
  },
  errorTitle: {
    color: colors.textStrong,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  errorMsg: {
    color: colors.sub,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    maxWidth: 280,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  truncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#FEF3C7',
    borderBottomWidth: 1,
    borderBottomColor: isDark ? 'rgba(245, 158, 11, 0.25)' : '#FDE68A',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  truncBannerText: {
    color: isDark ? '#FCD34D' : '#92400E',
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    color: colors.sub,
    fontSize: 12,
    fontWeight: '500',
  },
  tabBtnTextActive: {
    color: '#ffffff',
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
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(2, 132, 199, 0.15)',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  toolLabelText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.green,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  saveBtnDirty: {
    backgroundColor: colors.amber,
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
    paddingBottom: 40,
  },
  gutterAndCodeRow: {
    flexDirection: 'row',
    minHeight: '100%',
  },
  gutter: {
    width: 44,
    paddingVertical: 12,
    paddingRight: 8,
    borderRightWidth: 1,
    borderRightColor: colors.divider,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)',
  },
  gutterLine: {
    textAlign: 'right',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  codeWrap: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  codeLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  textInputScroll: {
    flex: 1,
  },
  textInput: {
    flex: 1,
    padding: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  statusInfoText: {
    color: colors.muted,
    fontSize: 11,
  },
  statusModeBadge: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '500',
  },
});
