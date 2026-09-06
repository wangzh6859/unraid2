/**
 * PdfViewer —— PDF 在线预览占位/引导
 *
 * 纯 JS（无原生依赖、Expo Go 兼容）无法高质量渲染 PDF：
 * - iOS 可借助系统 WebKit 预览，但本项目未引入 WebView 依赖；
 * - Android 系统 WebView 无内置 PDF 渲染，必须内置 pdf.js（体积 ~1.5MB+ 且需原生配置）。
 * 因此当前对 PDF 采用明确引导：展示文件信息 + 下载到本地阅读。
 * 后续可两条路线升级：
 *   1) 引入 react-native-webview + pdf.js（需真机联调）；
 *   2) Unraid 服务端 api.php 增加 preview=convert（LibreOffice 转图/文本），客户端拉取渲染。
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Download, FileText } from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { formatBytes } from '../../utils/cacheManager';

export default function PdfViewer({ item, onDownload }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <FileText color="#4b5563" size={72} style={{ marginBottom: 18 }} />
      <Text style={styles.title}>{item?.name}</Text>
      <Text style={styles.meta}>{formatBytes(item?.size)}</Text>
      <Text style={styles.hint}>
        PDF 在线预览需内置 pdf.js 或服务端转码，当前版本暂不支持，请下载后使用本地阅读器打开。
      </Text>
      <TouchableOpacity style={[styles.downloadBtn, { backgroundColor: colors.accent }]} onPress={() => onDownload(item)}>
        <Download color="#ffffff" size={20} />
        <Text style={styles.downloadText}>下载到手机查看</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 6 },
  meta: { color: '#9ca3af', fontSize: 14, marginBottom: 20 },
  hint: { color: '#9ca3af', fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 13, borderRadius: 30 },
  downloadText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
});
