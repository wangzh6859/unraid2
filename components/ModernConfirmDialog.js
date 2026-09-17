import React from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Modal, Pressable, ScrollView,
} from 'react-native';
import {
  Trash2, AlertTriangle, CheckCircle2, Info, RotateCw, Power, AlertCircle,
} from 'lucide-react-native';
import { useTheme } from '../ThemeContext';

/**
 * ModernConfirmDialog
 * Universal modern squircle confirmation & alert/error notice dialog
 */
export default function ModernConfirmDialog({
  visible,
  type = 'info',
  title,
  message,
  confirmText,
  cancelText = '取消',
  showCancel = true,
  onConfirm,
  onCancel,
  icon = null,
}) {
  const { colors } = useTheme();

  if (!visible) return null;

  let iconElement = icon || <Info color={colors.accent} size={28} />;
  let badgeBg = 'rgba(56, 189, 248, 0.15)';
  let confirmBg = colors.accent;
  let defaultConfirmLabel = '确定';

  if (type === 'danger') {
    iconElement = icon || <Trash2 color={colors.red} size={28} />;
    badgeBg = 'rgba(239, 68, 68, 0.15)';
    confirmBg = colors.red;
    defaultConfirmLabel = '确认删除';
  } else if (type === 'warning') {
    iconElement = icon || <AlertTriangle color={colors.amber} size={28} />;
    badgeBg = 'rgba(245, 158, 11, 0.15)';
    confirmBg = colors.amber;
    defaultConfirmLabel = '确认执行';
  } else if (type === 'error') {
    iconElement = icon || <AlertCircle color={colors.red} size={28} />;
    badgeBg = 'rgba(239, 68, 68, 0.15)';
    confirmBg = colors.red;
    defaultConfirmLabel = '知道了';
  } else if (type === 'power') {
    iconElement = icon || <Power color={colors.red} size={28} />;
    badgeBg = 'rgba(239, 68, 68, 0.15)';
    confirmBg = colors.red;
    defaultConfirmLabel = '安全关机';
  } else if (type === 'reboot') {
    iconElement = icon || <RotateCw color={colors.amber} size={28} />;
    badgeBg = 'rgba(245, 158, 11, 0.15)';
    confirmBg = colors.amber;
    defaultConfirmLabel = '安全重启';
  } else if (type === 'success') {
    iconElement = icon || <CheckCircle2 color={colors.green} size={28} />;
    badgeBg = 'rgba(16, 185, 129, 0.15)';
    confirmBg = colors.green;
    defaultConfirmLabel = '知道了';
  } else if (type === 'info') {
    iconElement = icon || <Info color={colors.accent} size={28} />;
    badgeBg = 'rgba(56, 189, 248, 0.15)';
    confirmBg = colors.accent;
    defaultConfirmLabel = '知道了';
  }

  const finalConfirmText = confirmText || defaultConfirmLabel;
  const handleDismiss = onCancel || onConfirm;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDismiss}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder || 'rgba(255, 255, 255, 0.08)' }]}>
          {/* Top Icon Badge */}
          <View style={[styles.iconBadge, { backgroundColor: badgeBg }]}>
            {iconElement}
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: colors.textStrong }]}>{title}</Text>

          {/* Message Content (Scrollable for long errors) */}
          {message ? (
            <ScrollView
              style={styles.messageScroll}
              contentContainerStyle={styles.messageScrollContent}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
            >
              <Text selectable={true} style={[styles.message, { color: colors.sub }]}>{message}</Text>
            </ScrollView>
          ) : (
            <View style={{ height: 12 }} />
          )}

          {/* Buttons Row */}
          <View style={styles.buttonRow}>
            {showCancel && (
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn, { backgroundColor: colors.input }]}
                onPress={onCancel}
                activeOpacity={0.7}
              >
                <Text style={[styles.cancelBtnText, { color: colors.text }]}>{cancelText}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.btn,
                styles.confirmBtn,
                { backgroundColor: confirmBg },
                !showCancel && { width: '100%' }
              ]}
              onPress={() => {
                if (onConfirm) onConfirm();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.confirmBtnText}>{finalConfirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    paddingTop: 26,
    paddingBottom: 22,
    paddingHorizontal: 22,
    alignItems: 'center',
    borderWidth: 1,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
  },
  iconBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  messageScroll: {
    maxHeight: 180,
    width: '100%',
    marginBottom: 20,
  },
  messageScrollContent: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  message: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {},
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  confirmBtn: {},
  confirmBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});