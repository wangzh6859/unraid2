/**
 * FilePreviewer —— 文件即时预览器（全屏 Modal）
 *
 * 职责：根据文件类型（utils/fileTypes.getFileKind）渲染对应预览器：
 *   text  -> 文本阅读/编辑器（可编辑写回服务器）
 *   image -> 图片直链预览（解码失败降级引导下载）
 *   video/audio -> 下载缓存后用系统原生播放器播放（解码失败降级引导下载）
 *   other -> 下载引导
 *
 * 由 FilesScreen 传入网络上下文（getDirectUrl / authHeaders / onDownload），
 * 预览内部状态（文本内容、媒体播放、解码失败标记）全部内聚在本组件。
 * 后续新增 PDF / Office / epub / 压缩包预览时，只扩展本组件即可。
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Modal, Alert, Image, Platform,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import { Video } from 'expo-av';
import { X, DownloadCloud, Download, File, Save } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import { getFileKind } from '../utils/fileTypes';
import { ensureCacheDir, enforceCacheLimit, formatBytes } from '../utils/cacheManager';

export default function FilePreviewer({ item, getDirectUrl, authHeaders, onClose, onDownload }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // 文本预览状态（即时阅读器）
  const [textState, setTextState] = useState(null);
  // 媒体播放状态（视频 / 音频）
  const [mediaState, setMediaState] = useState({ kind: null, loading: false, uri: null, error: false });
  // 图片解码失败标记（某些格式当前设备无法解码时给出提示）
  const [imageFailed, setImageFailed] = useState(false);

  // 打开/切换文件时，按类型自动加载（关闭时清空全部状态）
  useEffect(() => {
    if (!item) {
      setTextState(null);
      setMediaState({ kind: null, loading: false, uri: null, error: false });
      setImageFailed(false);
      return;
    }
    const kind = getFileKind(item.name);
    setTextState(null);
    setImageFailed(false);
    setMediaState({ kind: null, loading: false, uri: null, error: false });
    if (kind === 'text') loadText(item);
    else if (kind === 'video' || kind === 'audio') loadMedia(item, kind);
    // 依赖仅用 item.href：文件列表刷新产生同名新对象时不必重复加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item && item.href]);

  // 文本即时阅读：下载到缓存读取内容（可编辑）
  const loadText = async (file) => {
    setTextState({ loading: true, content: '', saving: false });
    try {
      const dir = await ensureCacheDir();
      const localUri = dir + encodeURIComponent(file.name);
      const res = await FileSystem.downloadAsync(getDirectUrl(file.href), localUri, { headers: authHeaders() });
      const content = await FileSystem.readAsStringAsync(res.uri);
      await enforceCacheLimit();
      setTextState({ loading: false, content, saving: false });
    } catch (e) {
      setTextState({ loading: false, content: '⚠️ 无法读取文本内容：' + e.message, saving: false });
    }
  };

  // 保存编辑后的文本回服务器（WebDAV PUT）
  const saveText = async () => {
    if (!item || !textState) return;
    setTextState(prev => (prev ? { ...prev, saving: true } : prev));
    try {
      const res = await fetch(getDirectUrl(item.href), {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'text/plain' },
        body: textState.content,
      });
      if (res.status === 201 || res.status === 204 || res.status === 200) {
        Alert.alert('保存成功', '文件已写回服务器');
      } else { Alert.alert('保存失败', `HTTP ${res.status}`); }
    } catch (e) { Alert.alert('保存失败', e.message); }
    finally { setTextState(prev => (prev ? { ...prev, saving: false } : prev)); }
  };

  // 媒体即时预览（视频 / 音频）：下载到缓存后用系统原生播放器播放
  const loadMedia = async (file, kind) => {
    setMediaState({ kind, loading: true, uri: null, error: false });
    try {
      const dir = await ensureCacheDir();
      const localUri = dir + encodeURIComponent(file.name);
      const res = await FileSystem.downloadAsync(getDirectUrl(file.href), localUri, { headers: authHeaders() });
      await enforceCacheLimit();
      setMediaState({ kind, loading: false, uri: res.uri, error: false });
    } catch (e) {
      setMediaState({ kind, loading: false, uri: null, error: true });
      Alert.alert('预览失败', `${kind === 'audio' ? '音频' : '视频'}加载失败，请先下载后查看。`);
    }
  };

  if (!item) return null;

  const kind = getFileKind(item.name);
  const isMedia = kind === 'video' || kind === 'audio';
  // 媒体就绪前显示加载中（含 effect 尚未触发的首帧）；error 后走 fallback 引导下载
  const mediaLoading = isMedia && !mediaState.uri && !mediaState.error;

  // fallback 原因文案（other / 图片解码失败 / 媒体解码失败 / 加载失败）
  let fallbackHint = '该格式暂不支持在线预览/播放，请下载后用相应应用打开。';
  if (imageFailed) fallbackHint = '图片解码失败：当前设备不支持该图片格式，请下载后查看。';
  else if (isMedia && mediaState.error) fallbackHint = '该媒体加载/解码失败，请下载后使用本地播放器打开。';

  const renderFallback = () => (
    <View style={styles.previewFallback}>
      <File color="#4b5563" size={80} style={{ marginBottom: 20 }} />
      <Text style={styles.previewFallbackName}>{item?.name}</Text>
      <Text style={styles.previewFallbackSize}>{formatBytes(item?.size)}</Text>
      <Text style={styles.previewFallbackHint}>{fallbackHint}</Text>
      <TouchableOpacity style={styles.previewBigDownloadBtn} onPress={() => onDownload(item)}>
        <Download color="#ffffff" size={20} />
        <Text style={styles.previewBigDownloadText}>下载到手机查看</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSpinner = (label) => (
    <View style={styles.previewFallback}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.previewFallbackName}>{label}</Text>
    </View>
  );

  // 预览内容：媒体 > 文本 > 图片 > fallback
  let content = null;
  if (item && mediaState.uri) {
    content = (
      <Video
        key={mediaState.uri}
        source={{ uri: mediaState.uri }}
        style={styles.previewVideo}
        useNativeControls
        resizeMode="contain"
        shouldPlay
        onError={() => {
          Alert.alert('无法播放', '当前设备不支持解码该媒体格式，请下载后用本地播放器打开。');
          setMediaState({ kind: null, loading: false, uri: null, error: true });
        }}
      />
    );
  } else if (item && mediaLoading) {
    content = renderSpinner(mediaState.kind === 'audio' ? '正在加载音频…' : '正在加载视频…');
  } else if (item && kind === 'text') {
    if (!textState || textState.loading) {
      content = renderSpinner('正在加载文本…');
    } else {
      const isErrorContent = textState.content && textState.content.startsWith('⚠️ 无法读取文本内容');
      content = (
        <View style={styles.textEditorWrap}>
          <ScrollView style={styles.textScroll} keyboardShouldPersistTaps="handled">
            <TextInput
              style={styles.textEditor}
              multiline
              value={textState.content}
              onChangeText={(t) => setTextState(prev => (prev ? { ...prev, content: t } : prev))}
              editable={!textState.saving}
              textAlignVertical="top"
              placeholder="文本内容"
              placeholderTextColor={colors.muted}
            />
          </ScrollView>
          {!isErrorContent && (
            <TouchableOpacity style={[styles.previewBigDownloadBtn, { backgroundColor: colors.accent, marginTop: 12 }]} onPress={saveText}>
              <Save color="#ffffff" size={20} />
              <Text style={styles.previewBigDownloadText}>{textState.saving ? '保存中…' : '保存到服务器'}</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
  } else if (item && kind === 'image' && !imageFailed) {
    content = (
      <Image
        source={{ uri: getDirectUrl(item.href), headers: authHeaders() }}
        style={styles.previewImage}
        resizeMode="contain"
        onError={() => setImageFailed(true)}
      />
    );
  } else {
    content = renderFallback();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.previewContainer}>
        <View style={styles.previewHeader}>
          <TouchableOpacity onPress={onClose} style={styles.previewCloseBtn}>
            <X color="#ffffff" size={24} />
          </TouchableOpacity>
          <Text style={styles.previewTitle} numberOfLines={1}>{item?.name}</Text>
          <TouchableOpacity onPress={() => onDownload(item)} style={styles.previewDownloadBtn}>
            <DownloadCloud color="#3b82f6" size={24} />
          </TouchableOpacity>
        </View>

        <View style={styles.previewContent}>{content}</View>
      </View>
    </Modal>
  );
}

const createStyles = (colors) => StyleSheet.create({
  // 预览控件
  previewContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 20, paddingHorizontal: 16, paddingBottom: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
  previewCloseBtn: { padding: 8 },
  previewDownloadBtn: { padding: 8 },
  previewTitle: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', flex: 1, textAlign: 'center', paddingHorizontal: 10 },
  previewContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  previewVideo: { width: '100%', height: '100%' },
  previewImage: { width: '100%', height: '100%' },
  previewFallback: { alignItems: 'center', padding: 40, width: '100%' },
  previewFallbackName: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  previewFallbackSize: { color: '#9ca3af', fontSize: 14, marginBottom: 12 },
  previewFallbackHint: { color: '#9ca3af', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  previewBigDownloadBtn: { flexDirection: 'row', backgroundColor: '#3b82f6', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 30, alignItems: 'center' },
  previewBigDownloadText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  textEditorWrap: { flex: 1, width: '100%', padding: 16 },
  textScroll: { flex: 1 },
  textEditor: { color: colors.text, fontSize: 14, lineHeight: 22, minHeight: 300, textAlignVertical: 'top' },
});
