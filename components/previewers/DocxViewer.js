/**
 * DocxViewer —— Word(docx) 纯文本预览
 * 通过 jszip 解包 docx，读取 word/document.xml 并按段落(w:p)提取 w:t 文本。
 * 说明：为纯文本级预览（不含排版/图片）；需要完整版式时请下载后用办公软件查看。
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import JSZip from 'jszip';
import { Download } from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { downloadToCache, readFileAsBase64, decodeEntities } from '../../utils/previewUtils';
import { formatBytes } from '../../utils/cacheManager';

/** docx -> 段落纯文本 */
const extractDocxText = (docXml) => {
  let s = docXml || '';
  // 换行符保护：段落结束、表格行
  s = s.replace(/<\/w:p>/g, '\n');
  // 制表与软换行
  s = s.replace(/<w:tab[^>]*\/>/g, '\t');
  s = s.replace(/<w:br[^>]*\/>/g, '\n');
  // 只保留文本节点内容
  s = s.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, t) => t);
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
};

export default function DocxViewer({ item, getDirectUrl, authHeaders, onDownload }) {
  const { colors } = useTheme();
  const [state, setState] = useState({ loading: true, text: '', error: '' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const uri = await downloadToCache({ file: item, getDirectUrl, authHeaders });
        const b64 = await readFileAsBase64(uri);
        const zip = await JSZip.loadAsync(b64);
        const docFile = zip.file('word/document.xml');
        if (!docFile) throw new Error('不是有效的 docx（缺少 word/document.xml）');
        const xml = await docFile.async('string');
        const text = extractDocxText(xml);
        if (alive) setState({ loading: false, text: text || '（文档无正文内容）', error: '' });
      } catch (e) {
        if (alive) setState({ loading: false, text: '', error: 'Word 文档解析失败：' + e.message });
      }
    })();
    return () => { alive = false; };
  }, [item && item.href]);

  if (state.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.hint}>正在解析 Word 文档…</Text>
      </View>
    );
  }
  if (state.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.error}>{state.error}</Text>
        <Text style={styles.hint}>当前为纯文本级预览，复杂版式（图片/表格样式）请下载后查看。</Text>
        <TouchableOpacity style={[styles.downloadBtn, { backgroundColor: colors.accent }]} onPress={() => onDownload(item)}>
          <Download color="#ffffff" size={18} />
          <Text style={styles.downloadText}>下载到手机查看</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.meta}>{item.name} · {formatBytes(item.size)}</Text>
      <Text style={styles.body}>{state.text}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { flex: 1, width: '100%' },
  content: { padding: 20, paddingBottom: 60 },
  meta: { color: '#9ca3af', fontSize: 13, marginBottom: 12 },
  title: { color: '#ffffff', fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 },
  body: { color: '#e5e7eb', fontSize: 15, lineHeight: 24 },
  error: { color: '#f87171', fontSize: 15, textAlign: 'center', marginBottom: 8 },
  hint: { color: '#9ca3af', fontSize: 14, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24 },
  downloadText: { color: '#ffffff', fontSize: 15, fontWeight: 'bold', marginLeft: 8 },
});
