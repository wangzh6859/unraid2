import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity,
  ActivityIndicator, Linking, Platform,
} from 'react-native';
import {
  FileText, ExternalLink, Download, BookOpen, Layers,
  AlertCircle, CheckCircle2,
} from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { formatBytes } from '../../utils/cacheManager';
import { apiFetch } from '../../utils/apiClient';

export default function PdfViewer({ item, serverUrl, apiToken, streamUrl, onDownload }) {
  const { colors, isDark } = useTheme();

  const [activeTab, setActiveTab] = useState('system'); // 'system' | 'text'
  const [loadingText, setLoadingText] = useState(true);
  const [extractedData, setExtractedData] = useState(null);

  const directStreamUrl = streamUrl || (item?.path ? `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=file_stream&path=${encodeURIComponent(item.path)}` : '');

  // Attempt server-side text extraction for quick reading
  useEffect(() => {
    let isMounted = true;
    const fetchPdfPreview = async () => {
      if (!serverUrl || !item?.path) {
        setLoadingText(false);
        return;
      }
      try {
        const url = `${serverUrl}/api.php?token=${encodeURIComponent(apiToken)}&action=pdf_preview&path=${encodeURIComponent(item.path)}`;
        const res = await apiFetch(url, { method: 'GET' }, 5000, 0);
        if (res && res.ok) {
          const json = await res.json().catch(() => null);
          if (isMounted && json && json.status === 'success') {
            setExtractedData(json);
          }
        }
      } catch (_) {
        // Non-blocking fallback
      } finally {
        if (isMounted) setLoadingText(false);
      }
    };

    fetchPdfPreview();
    return () => { isMounted = false; };
  }, [item?.path, serverUrl]);

  const handleOpenSystemReader = async () => {
    if (!directStreamUrl) return;
    try {
      const supported = await Linking.canOpenURL(directStreamUrl);
      if (supported) {
        await Linking.openURL(directStreamUrl);
      } else {
        await Linking.openURL(directStreamUrl);
      }
    } catch (_) {
      // If Linking fails directly, fallback to download
      onDownload(item);
    }
  };

  const hasExtractedText = Boolean(extractedData && extractedData.has_text && extractedData.text);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Top Tab Switcher (if text is available) */}
      {hasExtractedText && (
        <View style={[styles.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.divider }]}>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'system' && { backgroundColor: colors.accent }]}
            onPress={() => setActiveTab('system')}
          >
            <Layers color={activeTab === 'system' ? '#ffffff' : colors.sub} size={15} />
            <Text style={[styles.tabText, activeTab === 'system' && styles.tabTextActive]}>高保真版面</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'text' && { backgroundColor: colors.accent }]}
            onPress={() => setActiveTab('text')}
          >
            <BookOpen color={activeTab === 'text' ? '#ffffff' : colors.sub} size={15} />
            <Text style={[styles.tabText, activeTab === 'text' && styles.tabTextActive]}>在线速读文本</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Tab 1: System Reader Launcher & Download */}
      {activeTab === 'system' ? (
        <ScrollView contentContainerStyle={styles.centerCardContainer}>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            {/* PDF Emblem Badge */}
            <View style={[styles.badge, { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.1)' }]}>
              <FileText color="#EF4444" size={56} />
            </View>

            <Text style={[styles.title, { color: colors.textStrong }]} numberOfLines={2}>
              {item?.name}
            </Text>

            <View style={styles.metaRow}>
              <Text style={[styles.metaText, { color: colors.muted }]}>
                {formatBytes(item?.size)}
              </Text>
              {Boolean(extractedData?.page_count) && (
                <>
                  <Text style={[styles.metaDot, { color: colors.muted }]}>·</Text>
                  <Text style={[styles.metaText, { color: colors.muted }]}>
                    共 {extractedData.page_count} 页
                  </Text>
                </>
              )}
            </View>

            {/* Feature Callout Box */}
            <View style={[styles.callout, { backgroundColor: colors.cardSecondary, borderColor: colors.divider }]}>
              <View style={styles.calloutRow}>
                <CheckCircle2 color={colors.accent} size={16} />
                <Text style={[styles.calloutText, { color: colors.sub }]}>
                  已建立 Unraid 原生流式通道，支持免等待瞬间点播
                </Text>
              </View>
              <View style={styles.calloutRow}>
                <CheckCircle2 color={colors.accent} size={16} />
                <Text style={[styles.calloutText, { color: colors.sub }]}>
                  自动联动 WPS Office、Google PDF、系统浏览器全功能查看
                </Text>
              </View>
              <View style={styles.calloutRow}>
                <CheckCircle2 color={colors.accent} size={16} />
                <Text style={[styles.calloutText, { color: colors.sub }]}>
                  支持多点触控矢量无损缩放、书签目录导航与文本检索
                </Text>
              </View>
            </View>

            {/* Actions */}
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                onPress={handleOpenSystemReader}
                activeOpacity={0.8}
              >
                <ExternalLink color="#ffffff" size={18} />
                <Text style={styles.primaryBtnText}>在系统阅读器中打开</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.divider }]}
                onPress={() => onDownload(item)}
                activeOpacity={0.8}
              >
                <Download color={colors.text} size={18} />
                <Text style={[styles.secondaryBtnText, { color: colors.text }]}>下载到手机</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      ) : (
        /* Tab 2: Extracted Text In-App Reader */
        <ScrollView style={styles.textScroll} contentContainerStyle={styles.textContent}>
          <Text selectable style={[styles.extractedBody, { color: colors.text }]}>
            {extractedData?.text}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  centerCardContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  badge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 17,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  metaText: {
    fontSize: 13,
  },
  metaDot: {
    fontSize: 13,
    marginHorizontal: 6,
  },
  callout: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    marginBottom: 24,
  },
  calloutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  calloutText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  btnRow: {
    width: '100%',
    gap: 12,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  textScroll: {
    flex: 1,
  },
  textContent: {
    padding: 20,
    paddingBottom: 40,
  },
  extractedBody: {
    fontSize: 14,
    lineHeight: 24,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
