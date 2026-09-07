/**
 * XlsxViewer —— 电子表格(xlsx/xls/xlsm/xlsb)只读预览
 * 使用 SheetJS(xlsx) 解析首个/多个工作表，前若干行以网格呈现。
 * 说明：只读预览（不支持编辑与公式重算）；超大文件仅展示前 500 行 × 前 40 列。
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react-native';
import { useTheme } from '../../ThemeContext';
import { downloadToCache, readFileAsBase64 } from '../../utils/previewUtils';

const MAX_ROWS = 500;
const MAX_COLS = 40;

export default function XlsxViewer({ item, getDirectUrl, authHeaders, onDownload }) {
  const { colors } = useTheme();
  const [state, setState] = useState({ loading: true, error: '', sheets: [], names: [], active: 0 });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const uri = await downloadToCache({ file: item, getDirectUrl, authHeaders });
        const b64 = await readFileAsBase64(uri);
        const wb = XLSX.read(b64, { type: 'base64' });
        if (!wb.SheetNames.length) throw new Error('表格中没有工作表');
        const sheets = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
          return rows.slice(0, MAX_ROWS).map((r) => (r || []).slice(0, MAX_COLS).map((c) => String(c === undefined || c === null ? '' : c)));
        });
        if (alive) setState({ loading: false, error: '', sheets, names: wb.SheetNames, active: 0 });
      } catch (e) {
        if (alive) setState({ loading: false, error: '表格解析失败：' + e.message, sheets: [], names: [], active: 0 });
      }
    })();
    return () => { alive = false; };
  }, [item && (item.path || item.href)]);

  if (state.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.hint}>正在解析表格…</Text>
      </View>
    );
  }
  if (state.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.error}>{state.error}</Text>
        <Text style={styles.hint}>该文件可能已加密/损坏，或为非标准表格格式，请下载后用办公软件打开。</Text>
        <TouchableOpacity style={[styles.downloadBtn, { backgroundColor: colors.accent }]} onPress={() => onDownload(item)}>
          <Download color="#ffffff" size={18} />
          <Text style={styles.downloadText}>下载到手机查看</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const rows = state.sheets[state.active] || [];
  return (
    <View style={styles.flex}>
      {state.names.length > 1 && (
        <ScrollView horizontal style={styles.sheetBar} contentContainerStyle={styles.sheetBarContent}>
          {state.names.map((name, i) => (
            <TouchableOpacity
              key={name + i}
              style={[styles.sheetChip, i === state.active && { backgroundColor: 'rgba(59,130,246,0.35)', borderColor: colors.accent }]}
              onPress={() => setState(prev => ({ ...prev, active: i }))}
            >
              <Text style={[styles.sheetChipText, i === state.active && { color: '#ffffff' }]} numberOfLines={1}>{name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <ScrollView style={styles.flex}>
        <ScrollView horizontal>
          <View style={styles.table}>
            {rows.length === 0 ? (
              <Text style={styles.empty}>（该工作表为空）</Text>
            ) : rows.map((row, ri) => (
              <View key={ri} style={[styles.row, ri === 0 && styles.headerRow]}>
                {row.map((cell, ci) => (
                  <View key={ci} style={[styles.cell, { minWidth: 90, maxWidth: 320 }, ri === 0 && { backgroundColor: 'rgba(59,130,246,0.18)' }]}>
                    <Text style={[styles.cellText, ri === 0 && styles.headerText]} numberOfLines={1}>{cell === '' ? '' : cell}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
        <Text style={styles.meta}>
          {item.name} · {state.names.length} 个工作表 · 展示前 {rows.length} 行
        </Text>
      </ScrollView>
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
  sheetBar: { maxHeight: 44, borderBottomWidth: 1, borderBottomColor: '#374151' },
  sheetBarContent: { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6 },
  sheetChip: { borderWidth: 1, borderColor: '#4b5563', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5, marginRight: 8 },
  sheetChipText: { color: '#9ca3af', fontSize: 13 },
  table: { padding: 8 },
  row: { flexDirection: 'row' },
  headerRow: {},
  cell: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#374151', paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center' },
  cellText: { color: '#e5e7eb', fontSize: 13 },
  headerText: { color: '#ffffff', fontWeight: 'bold' },
  meta: { color: '#9ca3af', fontSize: 12, padding: 12 },
  empty: { color: '#9ca3af', padding: 20 },
});
