import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../ThemeContext';

/**
 * GlassView (毛玻璃特效核心容器)
 * 工业级 Glassmorphism 实现：
 * 1. 底层高斯模糊 (Backdrop Blur via expo-blur)
 * 2. 浅/深色主题半透明色相填充 (Translucent Tint Overlay)
 * 3. 1px 亚克力边缘微光漫反射描边 (1px Highlight Border)
 * 4. 极端机型/环境安全保底（无缝降级为高质感半透明亚克力，杜绝崩溃）
 */
export default function GlassView({
  children,
  style,
  intensity,
  tint,
  border = true,
  borderColor,
  borderRadius,
  overlayColor,
  overflow = 'hidden',
  ...props
}) {
  const { isDark, colors } = useTheme();

  // 确定模糊主题色调
  const effectiveTint = tint || (isDark ? 'dark' : 'light');
  const glassTokens = colors?.glass || {};

  // 全局统一模糊强度：优先传入值，其次全局标准 65
  const effectiveIntensity = intensity ?? glassTokens.intensity ?? 65;

  // 提取传入 style 中的圆角与边框配置
  const flattenedStyle = StyleSheet.flatten(style) || {};
  const effectiveRadius = borderRadius ?? flattenedStyle.borderRadius ?? 0;
  const effectiveBorderColor = borderColor || glassTokens.border || (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(226, 232, 240, 0.85)');

  const containerStyle = [
    styles.container,
    {
      borderRadius: effectiveRadius,
      overflow: effectiveRadius > 0 ? 'hidden' : overflow,
    },
    border && {
      borderWidth: StyleSheet.hairlineWidth || 1,
      borderColor: effectiveBorderColor,
    },
    style,
  ];

  // 全局统一色相与透明度（默认 0.78 严谨对齐）
  const defaultOverlayColor = glassTokens.bg || (isDark ? 'rgba(13, 20, 36, 0.78)' : 'rgba(255, 255, 255, 0.78)');
  const tintOverlayColor = overlayColor !== undefined ? overlayColor : defaultOverlayColor;

  return (
    <View style={containerStyle} {...props}>
      {/* 1. 原生高斯模糊背景层 (Backdrop Blur) */}
      <BlurView
        pointerEvents="none"
        intensity={effectiveIntensity}
        tint={effectiveTint}
        style={[StyleSheet.absoluteFill, { borderRadius: effectiveRadius }]}
      />

      {/* 2. 半透明微光色相填充层 (保证对比度与可读性) */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: tintOverlayColor,
            borderRadius: effectiveRadius,
          },
        ]}
      />

      {/* 3. 内容层 */}
      {children}
    </View>
  );
}

/**
 * GlassCard (毛玻璃卡片快捷组件)
 * 默认具备标准卡片圆角、内边距与空间层次微阴影
 */
export function GlassCard({
  children,
  style,
  intensity = 50,
  borderRadius = 16,
  padding = 16,
  ...props
}) {
  const { isDark } = useTheme();

  const cardShadow = isDark
    ? {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
        elevation: 4,
      }
    : {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 2,
      };

  return (
    <GlassView
      intensity={intensity}
      borderRadius={borderRadius}
      style={[cardShadow, { padding }, style]}
      {...props}
    >
      {children}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
});
