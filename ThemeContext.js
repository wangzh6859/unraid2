import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 全局主题上下文
 * 提供深色 / 浅色两套配色，并在切换时持久化到 AsyncStorage（key: @app_theme）
 */

export const themes = {
  dark: {
    mode: 'dark',
    // 背景
    bg: '#0B0F19',            // 深空黑曜石黑
    bgElevated: '#000000',    // 全沉浸背景（预览等）
    card: '#151D2E',          // 卡片背景
    cardSecondary: 'rgba(255, 255, 255, 0.05)', // 次级小胶囊背景
    cardBorder: 'rgba(255, 255, 255, 0.08)',    // 卡片精致微光描边
    input: '#1E293B',         // 输入框背景
    divider: 'rgba(255, 255, 255, 0.08)',       // 分隔线
    bar: '#0D1424',           // 导航栏 / 顶部条
    // 文字
    text: '#E2E8F0',          // 主文字
    textStrong: '#FFFFFF',    // 强调文字 / 标题
    sub: '#94A3B8',           // 次要文字
    muted: '#64748B',         // 弱化文字
    // 图标与高亮
    accent: '#38BDF8',        // 主色（天青微光蓝）
    green: '#10B981',
    red: '#EF4444',
    amber: '#F59E0B',
    purple: '#8B5CF6',
    pink: '#EC4899',
    // 仪表盘高阶色
    networkDown: '#06B6D4',   // 霓虹青
    networkUp: '#8B5CF6',     // 霓虹紫
    tempWarm: '#F97316',      // 珊瑚橙
    tempCool: '#06B6D4',      // 冷态青
    ringBg: 'rgba(255, 255, 255, 0.08)',
  },
  light: {
    mode: 'light',
    bg: '#F8FAFC',            // 柔白瓷石板浅灰
    bgElevated: '#FFFFFF',    // 全沉浸背景（预览等）
    card: '#FFFFFF',          // 卡片背景
    cardSecondary: '#F1F5F9', // 次级小胶囊背景
    cardBorder: '#E2E8F0',    // 卡片精致浅灰描边
    input: '#F1F5F9',         // 输入框背景
    divider: '#E2E8F0',       // 分隔线
    bar: '#FFFFFF',           // 导航栏 / 顶部条
    text: '#334155',          // 主文字
    textStrong: '#0F172A',    // 强调文字 / 标题
    sub: '#64748B',           // 次要文字
    muted: '#94A3B8',         // 弱化文字
    accent: '#0284C7',        // 主色（深海天蓝）
    green: '#059669',
    red: '#DC2626',
    amber: '#D97706',
    purple: '#7C3AED',
    pink: '#DB2777',
    // 仪表盘高阶色
    networkDown: '#0891B2',   // 深青
    networkUp: '#7C3AED',     // 紫罗兰
    tempWarm: '#EA580C',      // 活力橙
    tempCool: '#0891B2',      // 冷态青
    ringBg: '#E2E8F0',
  },
};

const ThemeContext = createContext({
  isDark: true,
  colors: themes.dark,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem('@app_theme');
        if (saved !== null) setIsDark(saved === 'dark');
      } catch (e) {}
      setReady(true);
    })();
  }, []);

  const toggleTheme = async (value) => {
    setIsDark(value);
    try {
      await AsyncStorage.setItem('@app_theme', value ? 'dark' : 'light');
    } catch (e) {}
  };

  return (
    <ThemeContext.Provider value={{ isDark, colors: isDark ? themes.dark : themes.light, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}