import React, { useState, useEffect, useRef } from 'react';
import './utils/apiClient';
import { StatusBar, AppState, View, Text, TouchableOpacity, ScrollView, Platform, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Home, Box, Monitor, Folder, Settings } from 'lucide-react-native';
import AppLockModal from './components/AppLockModal';
import GlassView from './components/GlassView';

// 引入所有子页面
import DashboardScreen from './screens/DashboardScreen';
import SettingsScreen from './screens/SettingsScreen';
import DockerDetailsScreen from './screens/DockerDetailsScreen';
import VmDetailsScreen from './screens/VmDetailsScreen';
import StorageDetailsScreen from './screens/StorageDetailsScreen';
import SmartDetailsScreen from './screens/SmartDetailsScreen';
import FilesScreen from './screens/FilesScreen';
import CpuDetailsScreen from './screens/CpuDetailsScreen';
import MemoryDetailsScreen from './screens/MemoryDetailsScreen';
import GpuDetailsScreen from './screens/GpuDetailsScreen';
import NetworkDetailsScreen from './screens/NetworkDetailsScreen';

// 💡 全局主题上下文
import { ThemeProvider, useTheme } from './ThemeContext';
// 💡 全局统一现代化弹窗上下文与 Alert 拦截器
import { DialogProvider } from './DialogContext';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// 💡 首页专属的内部堆栈（跟随主题）
function HomeStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bar },
        headerTintColor: colors.textStrong,
        contentStyle: { backgroundColor: colors.bg },
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="仪表盘" component={DashboardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="存储详情" component={StorageDetailsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="SMART详情" component={SmartDetailsScreen} options={{ title: 'S.M.A.R.T. 诊断' }} />
      <Stack.Screen name="Docker详情" component={DockerDetailsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="VM详情" component={VmDetailsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CpuDetails" component={CpuDetailsScreen} options={{ title: 'CPU 性能与进程' }} />
      <Stack.Screen name="MemoryDetails" component={MemoryDetailsScreen} options={{ title: '内存监控与进程' }} />
      <Stack.Screen name="GpuDetails" component={GpuDetailsScreen} options={{ title: 'GPU 显卡与负载' }} />
      <Stack.Screen name="NetworkDetails" component={NetworkDetailsScreen} options={{ title: '网络流量与接口' }} />
    </Stack.Navigator>
  );
}

// 💡 悬浮毛玻璃胶囊 Dock 导航栏
function CustomFloatingTabBar({ state, descriptors, navigation }) {
  const { colors, isDark } = useTheme();

  return (
    <View style={tabStyles.floatingTabBarWrapper} pointerEvents="box-none">
      <GlassView
        border={true}
        borderRadius={24}
        style={tabStyles.floatingTabBarContainer}
      >
        <View style={tabStyles.floatingTabBarInner}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            const iconSize = 20;
            const color = isFocused ? colors.accent : colors.sub;
            const strokeWidth = isFocused ? 2.3 : 1.7;

            const renderIcon = () => {
              if (route.name === '首页') return <Home color={color} size={iconSize} strokeWidth={strokeWidth} />;
              if (route.name === '容器') return <Box color={color} size={iconSize} strokeWidth={strokeWidth} />;
              if (route.name === '虚拟机') return <Monitor color={color} size={iconSize} strokeWidth={strokeWidth} />;
              if (route.name === '文件') return <Folder color={color} size={iconSize} strokeWidth={strokeWidth} />;
              if (route.name === '设置') return <Settings color={color} size={iconSize} strokeWidth={strokeWidth} />;
              return null;
            };

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                testID={options.tabBarTestID}
                onPress={onPress}
                onLongPress={onLongPress}
                style={tabStyles.tabItem}
                activeOpacity={0.7}
              >
                {/* 激活项微光胶囊衬底 */}
                {isFocused && (
                  <View
                    style={[
                      tabStyles.activePillBackground,
                      {
                        backgroundColor: isDark
                          ? 'rgba(56, 189, 248, 0.15)'
                          : 'rgba(14, 165, 233, 0.12)',
                        borderColor: isDark
                          ? 'rgba(56, 189, 248, 0.28)'
                          : 'rgba(14, 165, 233, 0.22)',
                      },
                    ]}
                  />
                )}
                <View style={tabStyles.tabIconWrapper}>
                  {renderIcon()}
                </View>
                <Text
                  style={[
                    tabStyles.tabLabel,
                    {
                      color: isFocused ? colors.accent : colors.sub,
                      fontWeight: isFocused ? '700' : '500',
                    },
                  ]}
                  numberOfLines={1}
                >
                  {route.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </GlassView>
    </View>
  );
}

// 💡 5 大一级核心导航器（跟随主题，现代微光 Dock）
function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      tabBar={props => <CustomFloatingTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.bar },
        headerTintColor: colors.textStrong,
        sceneContainerStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tab.Screen name="首页" component={HomeStack} options={{ headerShown: false }} />
      <Tab.Screen name="容器" component={DockerDetailsScreen} options={{ headerShown: false }} />
      <Tab.Screen name="虚拟机" component={VmDetailsScreen} options={{ headerShown: false }} />
      <Tab.Screen name="文件" component={FilesScreen} options={{ headerShown: false }} />
      <Tab.Screen name="设置" component={SettingsScreen} options={{ headerTitle: '系统设置' }} />
    </Tab.Navigator>
  );
}

// 💡 主题根组件：跟随主题渲染系统状态栏，同时作为全局生物识别应用安全锁的守卫中枢
function ThemedRoot() {
  const { colors } = useTheme();
  const [isLocked, setIsLocked] = useState(false);
  const appStateRef = useRef(AppState.currentState);

  // 检查安全锁状态：启动时与从实际后台离开超过 3 分钟切回时才验证（忽略下拉状态栏 inactive 状态）
  const lastBackgroundTimeRef = useRef(null);
  const LOCK_TIMEOUT_MS = 3 * 60 * 1000; // 3 分钟超时阈值

  useEffect(() => {
    // 1. 冷启动认证：App 首次启动时若开启安全锁则验证一次
    const checkInitialLock = async () => {
      try {
        const enabled = await AsyncStorage.getItem('@security_app_lock');
        if (enabled === 'true') {
          setIsLocked(true);
        }
      } catch (e) {
        console.log('[App] Check lock status err:', e);
      }
    };

    checkInitialLock();

    // 2. 监听前后台状态切换：
    // - 仅当真正进入系统后台 (background) 时记录离线时间点；
    // - 下拉状态栏、控制中心或弹窗仅触发 (inactive)，绝不触发锁屏；
    // - 离开前台进入 background 超过 3 分钟，再次进入 active 前台才要求验证指纹。
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      const prevAppState = appStateRef.current;

      if (nextAppState === 'background') {
        // 真正退入系统后台，记录离开时间戳
        lastBackgroundTimeRef.current = Date.now();
      } else if (nextAppState === 'active' && prevAppState === 'background') {
        // 从实际后台切回前台，检查离线时长是否超过 3 分钟
        if (lastBackgroundTimeRef.current) {
          const elapsed = Date.now() - lastBackgroundTimeRef.current;
          if (elapsed >= LOCK_TIMEOUT_MS) {
            try {
              const enabled = await AsyncStorage.getItem('@security_app_lock');
              if (enabled === 'true') {
                setIsLocked(true);
              }
            } catch (e) {}
          }
          lastBackgroundTimeRef.current = null;
        }
      }
      // 注意：如果 prevAppState 是 inactive（如仅仅下拉通知栏或打开快捷开关），直接忽略，绝不锁屏

      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const navRef = useNavigationContainerRef();

  const linking = {
    prefixes: ['unraid://', 'unraidmanager://'],
    config: {
      screens: {
        MainTabs: {
          screens: {
            文件: 'transfer',
            首页: 'home',
            设置: 'settings',
          },
        },
      },
    },
  };

  return (
    <>
      <StatusBar
        barStyle={colors.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent={true}
      />
      <NavigationContainer ref={navRef} linking={linking}>
        <Stack.Navigator>
          {/* 主导航底座（包含底部 3 个 Tab 页面） */}
          <Stack.Screen
            name="MainTabs"
            component={MainTabs}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>

      {/* 生物识别全屏安全锁遮罩 */}
      <AppLockModal visible={isLocked} onUnlock={() => setIsLocked(false)} />
    </>
  );
}

const tabStyles = StyleSheet.create({
  floatingTabBarWrapper: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 24 : 14,
    left: 14,
    right: 14,
    alignItems: 'center',
    zIndex: 90,
  },
  floatingTabBarContainer: {
    width: '100%',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 8,
    overflow: 'hidden',
  },
  floatingTabBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 7,
    paddingHorizontal: 6,
    height: 62,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    borderRadius: 16,
    position: 'relative',
    height: '100%',
  },
  activePillBackground: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 4,
    right: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  tabIconWrapper: {
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: -0.2,
  },
});

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#111827', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#ef4444', marginBottom: 12 }}>
            应用发生运行异常
          </Text>
          <Text style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', marginBottom: 16 }}>
            页面在渲染时遇到未捕获的错误。你可以查看详细错误信息或点击下方按钮重新加载。
          </Text>
          <ScrollView style={{ maxHeight: 200, width: '100%', backgroundColor: '#1f2937', borderRadius: 10, padding: 14, marginBottom: 20 }}>
            <Text style={{ color: '#f87171', fontSize: 12, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier' }}>
              {String(this.state.error?.message || this.state.error || '未知错误')}
              {'\n\n'}
              {String(this.state.error?.stack || '')}
            </Text>
          </ScrollView>
          <TouchableOpacity
            style={{ backgroundColor: '#3b82f6', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12 }}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={{ color: '#ffffff', fontWeight: 'bold', fontSize: 15 }}>重新加载应用</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// 🚀 真正的 App 顶级入口
export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <DialogProvider>
          <ThemedRoot />
        </DialogProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}