import React, { useState, useEffect, useRef } from 'react';
import { StatusBar, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Home, Folder, Settings } from 'lucide-react-native';
import AppLockModal from './components/AppLockModal';
import DynamicIsland from './components/DynamicIsland';

// 引入所有子页面
import DashboardScreen from './screens/DashboardScreen';
import SettingsScreen from './screens/SettingsScreen';
import DockerDetailsScreen from './screens/DockerDetailsScreen';
import VmDetailsScreen from './screens/VmDetailsScreen';
import StorageDetailsScreen from './screens/StorageDetailsScreen';
import SmartDetailsScreen from './screens/SmartDetailsScreen';
import FilesScreen from './screens/FilesScreen';

// 💡 全局主题上下文
import { ThemeProvider, useTheme } from './ThemeContext';

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
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <Stack.Screen name="仪表盘" component={DashboardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Docker详情" component={DockerDetailsScreen} options={{ title: 'Docker 容器' }} />
      <Stack.Screen name="VM详情" component={VmDetailsScreen} options={{ title: '虚拟机' }} />
      <Stack.Screen name="存储详情" component={StorageDetailsScreen} options={{ title: '磁盘存储详情' }} />
      <Stack.Screen name="SMART详情" component={SmartDetailsScreen} options={{ title: 'S.M.A.R.T. 诊断' }} />
    </Stack.Navigator>
  );
}

// 💡 将原来的 Tab 导航器打包成一个独立的“底座组件”（跟随主题）
function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          if (route.name === '首页') return <Home color={color} size={size} />;
          if (route.name === '文件') return <Folder color={color} size={size} />;
          if (route.name === '设置') return <Settings color={color} size={size} />;
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.sub,
        headerStyle: { backgroundColor: colors.bar },
        headerTintColor: colors.textStrong,
        tabBarStyle: { backgroundColor: colors.bar, borderTopColor: colors.divider },
        sceneContainerStyle: { backgroundColor: colors.bg },
      })}
    >
      <Tab.Screen name="首页" component={HomeStack} options={{ headerShown: false }} />
      <Tab.Screen name="文件" component={FilesScreen} />
      <Tab.Screen name="设置" component={SettingsScreen} />
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

  return (
    <>
      <StatusBar
        barStyle={colors.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <NavigationContainer ref={navRef}>
        <Stack.Navigator>
          {/* 主导航底座（包含底部 3 个 Tab 页面） */}
          <Stack.Screen
            name="MainTabs"
            component={MainTabs}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>

      {/* 🚀 全局顶部灵动岛（胶囊通知与动态进度） */}
      <DynamicIsland
        onOpenTransfers={() => {
          if (navRef.isReady()) {
            navRef.navigate('MainTabs', { screen: '文件' });
          }
        }}
      />

      {/* 生物识别全屏安全锁遮罩 */}
      <AppLockModal visible={isLocked} onUnlock={() => setIsLocked(false)} />
    </>
  );
}

// 🚀 真正的 App 顶级入口
export default function App() {
  return (
    <ThemeProvider>
      <ThemedRoot />
    </ThemeProvider>
  );
}