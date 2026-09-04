import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Home, Folder, Settings } from 'lucide-react-native';

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

// 💡 主题根组件：跟随主题渲染系统状态栏（解决浅色背景下状态栏仍是深色的割裂感）
function ThemedRoot() {
  const { colors } = useTheme();
  return (
    <>
      <StatusBar
        barStyle={colors.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <NavigationContainer>
        <Stack.Navigator>
          {/* 第一层：底座（包含底部那 4 个按钮的页面） */}
          <Stack.Screen
            name="MainTabs"
            component={MainTabs}
            options={{ headerShown: false }}
          />

          {/* 第二层：全屏显示的详情页。它弹出时会完美覆盖掉底座的 Tab 栏！ */}
        </Stack.Navigator>
      </NavigationContainer>
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

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111827' },
  text: { color: '#e5e7eb', fontSize: 16 },
});