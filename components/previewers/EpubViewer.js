/**
 * EpubViewer —— EPUB 电子书文本阅读预览
 * 解包 epub（zip）→ container.xml → OPF → 按 spine 顺序读取各章节 xhtml，
 * 抽取为可读纯文本后分章阅读（上一章/下一章）。不解析 CSS/复杂排版。
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { downloadToCache, readFileAsBase64, base64ToUint8, stripHtml } from '../../utils/previewUtils';

export default function EpubViewer({ item, getDirectUrl, authHeaders, onDownload }) {
  const { colors } = useTheme();
  const [state, setState] = useState({ loading: true, error: '', chapters: [], names: [], active: 0 });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const uri = await downloadToCache({ file: item, getDirectUrl, authHeaders });
        const b64 = await readFileAsBase64(uri);
        const zip = await JSZip.loadAsync(base64ToUint8(b64));

        // Helper: case-insensitive & resilient path lookup inside zip
        const findZipEntry = (target) => {
          if (!target) return null;
          if (zip.files[target]) return zip.files[target];
          const clean = target.toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
          for (const key of Object.keys(zip.files)) {
            const norm = key.toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
            if (norm === clean || norm.endsWith('/' + clean)) {
              return zip.files[key];
            }
          }
          return null;
        };

        const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false });

        // 1. Locate container.xml
        let opfPath = '';
        const containerFile = findZipEntry('META-INF/container.xml');
        if (containerFile) {
          const containerXml = await containerFile.async('string');
          const container = parser.parse(containerXml);
          const rootfile = container?.container?.rootfiles?.rootfile;
          const rf = Array.isArray(rootfile) ? rootfile[0] : rootfile;
          opfPath = (rf && (rf['@_fullpath'] || rf.fullpath)) || '';
        }

        // 2. Fallback if container.xml missing or failed to specify OPF
        let opfFile = findZipEntry(opfPath);
        if (!opfFile) {
          for (const key of Object.keys(zip.files)) {
            if (key.toLowerCase().endsWith('.opf')) {
              opfFile = zip.files[key];
              opfPath = key;
              break;
            }
          }
        }

        if (!opfFile) {
          throw new Error('未找到 EPUB 清单文件（.opf）');
        }

        const opfXml = await opfFile.async('string');
        const opf = parser.parse(opfXml);
        const packageEl = opf?.package;
        const manifestMap = new Map();
        const rawItems = packageEl?.manifest?.item;
        const items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
        items.forEach((it) => manifestMap.set(it['@_id'] || it.id, {
          href: it['@_href'] || it.href,
          mediaType: it['@_media-type'] || it['media-type'] || '',
        }));
        const rawSpine = packageEl?.spine?.itemref;
        const spine = Array.isArray(rawSpine) ? rawSpine : (rawSpine ? [rawSpine] : []);
        const metaTitle = typeof packageEl?.metadata?.title === 'string' ? packageEl.metadata.title : '';

        // opf 所在目录，用于拼接章节相对路径
        const dir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
        const chapters = [];
        for (const ref of spine) {
          const entry = manifestMap.get(ref['@_idref'] || ref.idref);
          if (!entry) continue;
          const isDoc = /\.(x?html?|xht|xml)$/i.test(entry.href) || /html|xml/.test(entry.mediaType);
          if (!isDoc) continue;
          let path = entry.href;
          if (!/^\/|^[a-z]+:/i.test(path)) path = dir + path;
          const file = findZipEntry(path) || findZipEntry(decodeURIComponent(path)) || findZipEntry(entry.href);
          if (!file) continue;
          const raw = await file.async('string');
          const text = stripHtml(raw);
          if (text) chapters.push({ name: text.split('\n', 1)[0].slice(0, 40) || `章节 ${chapters.length + 1}`, text });
        }
        if (!chapters.length) throw new Error('未找到可阅读的文本章节（可能是图片型电子书）');
        const names = [metaTitle].filter(Boolean);
        if (alive) setState({ loading: false, error: '', chapters, names, active: 0 });
      } catch (e) {
        if (alive) setState({ loading: false, error: 'EPUB 解析失败：' + e.message, chapters: [], names: [], active: 0 });
      }
    })();
    return () => { alive = false; };
  }, [item && (item.path || item.href)]);

  if (state.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.hint}>正在解析电子书…</Text>
      </View>
    );
  }
  if (state.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.error}>{state.error}</Text>
        <Text style={styles.hint}>扫描版/图片型电子书暂不支持在线阅读，请下载后查看。</Text>
        <TouchableOpacity style={[styles.downloadBtn, { backgroundColor: colors.accent }]} onPress={() => onDownload(item)}>
          <Download color="#ffffff" size={18} />
          <Text style={styles.downloadText}>下载到手机查看</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const cur = state.chapters[state.active];
  const meta = state.names[0];
  return (
    <View style={styles.flex}>
      <View style={styles.topBar}>
        <Text style={styles.metaText} numberOfLines={1}>{meta || item.name}</Text>
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Text style={styles.chapterTitle}>第 {state.active + 1} / {state.chapters.length} 章</Text>
        <Text style={styles.body}>{cur ? cur.text : ''}</Text>
      </ScrollView>
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[styles.navBtn, state.active === 0 && styles.navBtnDisabled]}
          disabled={state.active === 0}
          onPress={() => setState(prev => ({ ...prev, active: Math.max(0, prev.active - 1) }))}
        >
          <ChevronLeft color={state.active === 0 ? '#4b5563' : '#ffffff'} size={18} />
          <Text style={[styles.navText, state.active === 0 && { color: '#4b5563' }]}>上一章</Text>
        </TouchableOpacity>
        <Text style={styles.navCount}>{state.active + 1} / {state.chapters.length}</Text>
        <TouchableOpacity
          style={[styles.navBtn, state.active >= state.chapters.length - 1 && styles.navBtnDisabled]}
          disabled={state.active >= state.chapters.length - 1}
          onPress={() => setState(prev => ({ ...prev, active: Math.min(state.chapters.length - 1, prev.active + 1) }))}
        >
          <Text style={[styles.navText, state.active >= state.chapters.length - 1 && { color: '#4b5563' }]}>下一章</Text>
          <ChevronRight color={state.active >= state.chapters.length - 1 ? '#4b5563' : '#ffffff'} size={18} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, width: '100%' },
  center: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#ffffff', fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 },
  hint: { color: '#9ca3af', fontSize: 14, marginTop: 14, textAlign: 'center' },
  error: { color: '#f87171', fontSize: 15, textAlign: 'center', marginBottom: 8 },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, marginTop: 8 },
  downloadText: { color: '#ffffff', fontSize: 15, fontWeight: 'bold', marginLeft: 8 },
  topBar: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#374151' },
  metaText: { color: '#9ca3af', fontSize: 13 },
  content: { padding: 18, paddingBottom: 90 },
  chapterTitle: { color: '#60a5fa', fontSize: 13, marginBottom: 10 },
  body: { color: '#e5e7eb', fontSize: 16, lineHeight: 26 },
  navBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(17,24,39,0.98)', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#374151' },
  navBtn: { flexDirection: 'row', alignItems: 'center', padding: 6 },
  navBtnDisabled: { opacity: 0.5 },
  navText: { color: '#ffffff', fontSize: 14, marginHorizontal: 4 },
  navCount: { color: '#9ca3af', fontSize: 13 },
});
