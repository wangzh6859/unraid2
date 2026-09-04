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
    bg: '#111827',            // 主背景
    bgElevated: '#000000',    // 全沉浸背景（预览等）
    card: '#1f2937',          // 卡片背景
    input: '#374151',         // 输入框背景
    divider: '#374151',       // 分隔线
    bar: '#1f2937',           // 导航栏 / 顶部条
    // 文字
    text: '#e5e7eb',          // 主文字
    textStrong: '#ffffff',    // 强调文字 / 标题
    sub: '#9ca3af',           // 次要文字
    muted: '#6b7280',         // 弱化文字
    // 图标与高亮
    accent: '#3b82f6',        // 主色（蓝）
    green: '#10b981',
    red: '#ef4444',
    amber: '#f59e0b',
    purple: '#8b5cf6',
    pink: '#ec4899',
  },
  light: {
    mode: 'light',
    bg: '#f3f4f6',
    bgElevated: '#ffffff',
    card: '#ffffff',
    input: '#e5e7eb',
    divider: '#e5e7eb',
    bar: '#ffffff',
    text: '#1f2937',
    textStrong: '#111827',
    sub: '#6b7280',
    muted: '#9ca3af',
    accent: '#2563eb',
    green: '#059669',
    red: '#dc2626',
    amber: '#d97706',
    purple: '#7c3aed',
    pink: '#db2777',
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