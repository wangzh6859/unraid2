/**
 * ArchiveViewer —— 压缩包(zip/tar)条目浏览
 * - zip：jszip 解包列条目；点击文本类条目直接预览内容，图片类以 data URL 预览
 * - tar：previewUtils.parseTar 解析（未压缩 tar）；大文件仅列出，内容可看文本/图片
 * 说明：rar / 7z / tar.gz 等压缩格式暂不支持在线浏览，请下载后处理。
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import JSZip from 'jszip';
import { ChevronLeft, Download, FileText, FolderArchive } from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { downloadToCache, readFileAsBase64, base64ToUint8, parseTar, decodeEntities } from '../../utils/previewUtils';
import { getFileKind } from '../../utils/fileTypes';
import base64 from 'base-64';

const TEXT_MAX_CHARS = 200000;

/** Uint8Array(UTF-8) -> string（Hermes 无 TextDecoder，手写解码） */
const utf8Decode = (bytes) => {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    let code = 0;
    let n = 0;
    if (b < 0x80) { code = b; n = 0; }
    else if ((b & 0xE0) === 0xC0) { code = b & 0x1F; n = 1; }
    else if ((b & 0xF0) === 0xE0) { code = b & 0x0F; n = 2; }
    else if ((b & 0xF8) === 0xF0) { code = b & 0x07; n = 3; }
    else continue;
    if (i + n > bytes.length) break;
    for (let k = 0; k < n; k++) code = (code << 6) | (bytes[i++] & 0x3F);
    out += String.fromCodePoint(code);
  }
  return decodeEntities(out);
};

/** Uint8Array -> base64（Hermes 无 btoa，用 base-64 依赖） */
const bytesToB64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return base64.encode(bin);
};

export default function ArchiveViewer({ item, getDirectUrl, authHeaders, onDownload }) {
  const { colors, isDark } = useTheme();
  const [state, setState] = useState({
    loading: true, error: '', entries: [], total: 0,
    open: null, openKind: null, openText: '', openImage: '', openSize: 0,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const uri = await downloadToCache({ file: item, getDirectUrl, authHeaders });
        const b64 = await readFileAsBase64(uri);
        const isZip = /\.zip$/i.test(item.name);
        let entries = [];
        if (isZip) {
          const zip = await JSZip.loadAsync(base64ToUint8(b64));
          entries = Object.keys(zip.files)
            .filter((p) => !zip.files[p].dir && !/^__MACOSX\//.test(p) && !/\.DS_Store$/i.test(p))
            .map((p) => ({ name: p, zip: zip.files[p] }))
            .sort((a, b) => a.name.localeCompare(b.name));
        } else {
          const list = parseTar(base64ToUint8(b64));
          entries = list.filter((e) => !e.isDir).map((e) => ({ name: e.name, tar: e })).sort((a, b) => a.name.localeCompare(b.name));
        }
        if (alive) setState((prev) => ({ ...prev, loading: false, entries, total: entries.length }));
      } catch (e) {
        if (alive) setState((prev) => ({ ...prev, loading: false, error: '压缩包解析失败：' + e.message }));
      }
    })();
    return () => { alive = false; };
  }, [item && (item.path || item.href)]);

  const openEntry = async (entry) => {
    const kind = getFileKind(entry.name);
    if (kind !== 'text' && kind !== 'image') return; // 其它类型仅展示列表
    setState((prev) => ({ ...prev, open: entry.name, openKind: kind, openText: '', openImage: '', openSize: 0, loading: true }));
    try {
      if (kind === 'image') {
        const b64 = entry.zip ? await entry.zip.async('base64') : (entry.tar.data ? bytesToB64(entry.tar.data) : '');
        if (b64) setState((prev) => ({ ...prev, loading: false, openImage: 'data:image/' + (entry.name.split('.').pop() || 'png') + ';base64,' + b64 }));
        else setState((prev) => ({ ...prev, loading: false, error: '条目过大或无法读取' }));
      } else {
        const text = entry.zip ? await entry.zip.async('string') : (entry.tar.data ? utf8Decode(entry.tar.data) : '');
        const truncated = text.length > TEXT_MAX_CHARS;
        setState((prev) => ({
          ...prev, loading: false,
          openText: truncated ? text.slice(0, TEXT_MAX_CHARS) + '\n\n…（内容过长已截断，请解压后查看完整文件）' : text,
          openSize: text.length,
        }));
      }
    } catch (e) {
      setState((prev) => ({ ...prev, loading: false, error: '读取条目失败：' + e.message }));
    }
  };

  if (state.loading && !state.entries.length) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[styles.hint, { color: colors.sub }]}>正在解析压缩包…</Text>
      </View>
    );
  }
  if (state.error && !state.entries.length) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={[styles.title, { color: colors.textStrong }]}>{item.name}</Text>
        <Text style={styles.error}>{state.error}</Text>
        <Text style={[styles.hint, { color: colors.sub }]}>rar / 7z / tar.gz 等格式暂不支持在线浏览，请下载后处理。</Text>
        <TouchableOpacity style={[styles.downloadBtn, { backgroundColor: colors.accent }]} onPress={() => onDownload(item)}>
          <Download color="#ffffff" size={18} />
          <Text style={styles.downloadText}>下载到手机查看</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 条目内容查看态
  if (state.open) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.bg }]}>
        <View style={[styles.topBar, { backgroundColor: colors.card, borderBottomColor: colors.divider }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setState((prev) => ({ ...prev, open: null, openText: '', openImage: '', openKind: null }))}>
            <ChevronLeft color={colors.accent} size={20} />
            <Text style={[styles.backText, { color: colors.accent }]}>返回列表</Text>
          </TouchableOpacity>
          <Text style={[styles.topName, { color: colors.textStrong }]} numberOfLines={1}>{state.open}</Text>
        </View>
        {state.loading ? (
          <View style={[styles.center, { backgroundColor: colors.bg }]}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.hint, { color: colors.sub }]}>正在读取条目…</Text>
          </View>
        ) : state.openImage ? (
          <ScrollView style={[styles.flex, { backgroundColor: colors.bg }]} contentContainerStyle={styles.imgWrap}>
            <Image source={{ uri: state.openImage }} style={styles.image} resizeMode="contain" />
          </ScrollView>
        ) : (
          <ScrollView style={[styles.flex, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
            <Text style={[styles.entryBody, { color: colors.text }]}>{state.openText || '（空内容）'}</Text>
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.bg }]}>
      <View style={[styles.topBar, { backgroundColor: colors.card, borderBottomColor: colors.divider }]}>
        <FolderArchive color={colors.accent} size={18} />
        <Text style={[styles.metaText, { color: colors.sub }]} numberOfLines={1}>
          {item.name} · 共 {state.total} 个条目（点击文本/图片条目可预览）
        </Text>
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.listContent}>
        {state.entries.length === 0 ? (
          <Text style={[styles.empty, { color: colors.sub }]}>（压缩包内没有文件）</Text>
        ) : state.entries.map((entry) => {
          const kind = getFileKind(entry.name);
          const previewable = kind === 'text' || kind === 'image';
          return (
            <TouchableOpacity
              key={entry.name}
              style={[styles.entryRow, { borderBottomColor: colors.divider }]}
              onPress={() => (previewable ? openEntry(entry) : null)}
              disabled={!previewable}
            >
              <FileText color={previewable ? colors.accent : colors.muted} size={16} />
              <Text style={[styles.entryName, { color: previewable ? colors.textStrong : colors.muted }]} numberOfLines={1}>{entry.name}</Text>
              {!previewable && <Text style={[styles.entryTag, { color: colors.muted }]}>仅列表</Text>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, width: '100%' },
  center: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 },
  hint: { fontSize: 14, marginTop: 14, textAlign: 'center' },
  error: { color: '#ef4444', fontSize: 15, textAlign: 'center', marginBottom: 8 },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, marginTop: 8 },
  downloadText: { color: '#ffffff', fontSize: 15, fontWeight: 'bold', marginLeft: 8 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginRight: 10 },
  backText: { fontSize: 14, marginLeft: 2, fontWeight: 'bold' },
  topName: { fontSize: 13, flex: 1, fontWeight: '500' },
  metaText: { fontSize: 13, marginLeft: 8, flex: 1 },
  listContent: { padding: 8, paddingBottom: 40 },
  entryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  entryName: { fontSize: 14, marginLeft: 10, flex: 1 },
  entryTag: { fontSize: 11 },
  empty: { padding: 20, textAlign: 'center' },
  content: { padding: 16, paddingBottom: 60 },
  entryBody: { fontSize: 14, lineHeight: 22 },
  imgWrap: { alignItems: 'center', justifyContent: 'center', padding: 10 },
  image: { width: '100%', height: undefined, aspectRatio: 1, maxHeight: '100%' },
});
