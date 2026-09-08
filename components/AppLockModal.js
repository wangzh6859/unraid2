import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Modal,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Fingerprint, ShieldCheck, AlertCircle } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';

export default function AppLockModal({ visible, onUnlock }) {
  const { colors } = useTheme();
  const [authError, setAuthError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleAuthenticate = useCallback(async () => {
    if (isAuthenticating) return;
    setAuthError('');
    setIsAuthenticating(true);

    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        // No biometrics configured, allow unlocking
        setIsAuthenticating(false);
        if (onUnlock) onUnlock();
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: '验证指纹或面容以解锁 Unraid',
        cancelLabel: '取消',
        fallbackLabel: '使用设备锁屏密码',
        disableDeviceFallback: false,
      });

      setIsAuthenticating(false);
      if (result.success) {
        if (onUnlock) onUnlock();
      } else {
        if (result.error !== 'user_cancel' && result.error !== 'app_cancel') {
          setAuthError('验证未通过，请重试');
        }
      }
    } catch (err) {
      console.log('[AppLockModal] Auth error:', err);
      setIsAuthenticating(false);
      setAuthError('认证服务异常，请点击重试');
    }
  }, [isAuthenticating, onUnlock]);

  useEffect(() => {
    if (visible) {
      // Small timeout to allow modal mount transition smoothly
      const timer = setTimeout(() => {
        handleAuthenticate();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent={false} animationType="fade" statusBarTranslucent>
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        {/* Shield Icon / Top Badge */}
        <View style={[styles.shieldBadge, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
          <ShieldCheck color={colors.accent} size={42} />
        </View>

        {/* Title & Description */}
        <Text style={[styles.title, { color: colors.textStrong }]}>Unraid 安全防护锁</Text>
        <Text style={[styles.subTitle, { color: colors.sub }]}>
          已开启安全锁屏保护，请验证指纹或面容识别以进入系统
        </Text>

        {/* Big Touch-to-Unlock Button */}
        <TouchableOpacity
          style={[styles.fingerprintBtn, { backgroundColor: 'rgba(59, 130, 246, 0.14)', borderColor: colors.accent }]}
          onPress={handleAuthenticate}
          activeOpacity={0.7}
        >
          {isAuthenticating ? (
            <ActivityIndicator size="large" color={colors.accent} />
          ) : (
            <Fingerprint color={colors.accent} size={64} />
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleAuthenticate} style={styles.promptTextBtn}>
          <Text style={[styles.unlockHint, { color: colors.accent }]}>
            {isAuthenticating ? '等待生物识别验证中...' : '点击图标使用指纹验证'}
          </Text>
        </TouchableOpacity>

        {/* Error Alert */}
        {authError ? (
          <View style={styles.errorBox}>
            <AlertCircle color={colors.red} size={16} />
            <Text style={[styles.errorText, { color: colors.red }]}>{authError}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  shieldBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subTitle: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: 44,
  },
  fingerprintBtn: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  promptTextBtn: {
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  unlockHint: {
    fontSize: 15,
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
