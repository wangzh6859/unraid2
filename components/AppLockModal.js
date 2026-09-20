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
import { BlurView } from 'expo-blur';
import * as LocalAuthentication from 'expo-local-authentication';
import { Fingerprint, ShieldCheck, AlertCircle } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import GlassView from './GlassView';

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
    <Modal visible={visible} transparent={true} animationType="fade" statusBarTranslucent>
      <View style={styles.container}>
        {/* 全屏深层高斯模糊与安全遮蔽背景 */}
        <BlurView
          intensity={85}
          tint={colors.mode === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: colors.glass?.bgStrong || (colors.mode === 'dark' ? 'rgba(11, 15, 25, 0.90)' : 'rgba(248, 250, 252, 0.92)'),
            },
          ]}
        />

        {/* Shield Icon / Top Badge */}
        <View style={[styles.shieldBadge, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
          <ShieldCheck color={colors.accent} size={42} />
        </View>

        {/* Title & Description */}
        <Text style={[styles.title, { color: colors.textStrong }]}>Unraid 安全防护锁</Text>
        <Text style={[styles.subTitle, { color: colors.sub }]}>
          已开启安全锁屏保护，请验证指纹或面容识别以进入系统
        </Text>

        {/* Big Touch-to-Unlock Button with Glass Ring */}
        <TouchableOpacity
          style={styles.fingerprintBtnWrapper}
          onPress={handleAuthenticate}
          activeOpacity={0.7}
        >
          <GlassView
            intensity={50}
            borderRadius={60}
            borderColor={colors.glass?.border || 'rgba(56, 189, 248, 0.3)'}
            overlayColor="rgba(56, 189, 248, 0.10)"
            style={styles.fingerprintBtn}
          >
            {isAuthenticating ? (
              <ActivityIndicator size="large" color={colors.accent} />
            ) : (
              <Fingerprint color={colors.accent} size={64} />
            )}
          </GlassView>
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
  fingerprintBtnWrapper: {
    borderRadius: 60,
    elevation: 8,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  fingerprintBtn: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
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
