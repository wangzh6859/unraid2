import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import {
  Save, Edit3, BookOpen, ZoomIn, ZoomOut, WrapText,
  Check, RefreshCw,
} from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { formatBytes } from '../../utils/cacheManager';

export default function CodeTextViewer({ item, serverUrl, apiToken }) {
  const { colors } = useTheme();

  const [mode, setMode] = useState('reader'); // 'reader' | 'editor'
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const [wordWrap, setWordWrap] = useState(true);

  // Fetch text content
  const loadContent = async () => {
    setLoading(true);
    try {
      const targetPath = item?.path || item?.href || '';
      const url = `${serverUrl}/api.php?token=${apiToken}&action=file_read&path=${encodeURIComponent(targetPath)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.status === 'success') {
        setContent(json.content || '');
        setInitialContent(json.content || '');
      } else {
        setContent(`// 无法读取文件：${json.message || '未知错误'}`);
      }
    } catch (e) {
      setContent(`// 加载异常：${e.message}`);
    } finally {
      setLoading(false);
    }
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
      const url = `${serverUrl}/api.php?token=${apiToken}&action=file_write&path=${encodeURIComponent(targetPath)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: content,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.status === 'success') {
        setInitialContent(content);
        Alert.alert('保存成功', '文件已实时写回 Unraid 服务器！');
      } else {
        Alert.alert('保存失败', json.message || '服务器拒绝写入');
      }
    } catch (e) {
      Alert.alert('网络异常', e.message);
    } finally {
      setSaving(false);
    }
  };

  const isDirty = content !== initialContent;
  const lines = content.split('\n');
  const lineCount = lines.length;

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>正在加载文本内容...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.modeTabs}>
          <TouchableOpacity
            style={[styles.tabBtn, mode === 'reader' && styles.tabBtnActive]}
            onPress={() => setMode('reader')}
          >
            <BookOpen color={mode === 'reader' ? '#ffffff' : '#94a3b8'} size={15} />
            <Text style={[styles.tabBtnText, mode === 'reader' && styles.tabBtnTextActive]}>阅读</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, mode === 'editor' && styles.tabBtnActive]}
            onPress={() => setMode('editor')}
          >
            <Edit3 color={mode === 'editor' ? '#ffffff' : '#94a3b8'} size={15} />
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
            <WrapText color={wordWrap ? '#3b82f6' : '#94a3b8'} size={16} />
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

      {/* Editor / Reader Area */}
      <View style={styles.editorArea}>
        {mode === 'reader' ? (
          <ScrollView
            style={styles.readerScroll}
            contentContainerStyle={styles.readerScrollContent}
            horizontal={!wordWrap}
          >
            <View style={styles.gutterAndCodeRow}>
              {/* Line Numbers Gutter */}
              <View style={styles.gutter}>
                {lines.map((_, i) => (
                  <Text key={i} style={[styles.gutterLine, { fontSize, lineHeight: fontSize * 1.5 }]}>
                    {i + 1}
                  </Text>
                ))}
              </View>

              {/* Code Content */}
              <View style={[styles.codeWrap, !wordWrap && { minWidth: 600 }]}>
                {lines.map((line, i) => (
                  <Text
                    key={i}
                    selectable
                    style={[
                      styles.codeLine,
                      { fontSize, lineHeight: fontSize * 1.5 },
                      !wordWrap && { flexWrap: 'nowrap' },
                    ]}
                  >
                    {line || ' '}
                  </Text>
                ))}
              </View>
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={styles.textInputScroll} keyboardShouldPersistTaps="handled">
            <TextInput
              style={[
                styles.textInput,
                { fontSize, lineHeight: fontSize * 1.5 },
                !wordWrap && { minWidth: 800 },
              ]}
              multiline
              value={content}
              onChangeText={setContent}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="在此输入文本..."
              placeholderTextColor="#64748b"
            />
          </ScrollView>
        )}
      </View>

      {/* Bottom Status Bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusInfoText}>
          {lineCount} 行 · {content.length} 字符 · {formatBytes(item?.size)}
        </Text>
        <Text style={[styles.statusModeBadge, isDirty && { color: '#fbbf24' }]}>
          {isDirty ? '● 未保存修改' : '● 已同步'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    backgroundColor: '#0d1117',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0d1117',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 10,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#161b22',
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: '#0d1117',
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
    backgroundColor: '#238636',
  },
  tabBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  tabBtnTextActive: {
    color: '#ffffff',
  },
  toolActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#21262d',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolIconBtnActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  toolLabelText: {
    color: '#c9d1d9',
    fontSize: 12,
    fontWeight: 'bold',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#238636',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  saveBtnDirty: {
    backgroundColor: '#2563eb',
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  editorArea: {
    flex: 1,
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
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: '#21262d',
    backgroundColor: '#0d1117',
    alignItems: 'flex-end',
  },
  gutterLine: {
    color: '#484f58',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'right',
  },
  codeWrap: {
    flex: 1,
    paddingLeft: 10,
    paddingRight: 16,
  },
  codeLine: {
    color: '#e6edf3',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  textInputScroll: {
    flex: 1,
    padding: 12,
  },
  textInput: {
    color: '#e6edf3',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlignVertical: 'top',
    minHeight: 400,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#161b22',
    borderTopWidth: 1,
    borderTopColor: '#21262d',
  },
  statusInfoText: {
    color: '#8b949e',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  statusModeBadge: {
    color: '#3fb950',
    fontSize: 11,
    fontWeight: '600',
  },
});
