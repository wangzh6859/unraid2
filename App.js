import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// 💡 首页专属的内部堆栈
function HomeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#1f2937' },
        headerTintColor: '#ffffff',
        contentStyle: { backgroundColor: '#111827' }
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

// 💡 将原来的 Tab 导航器打包成一个独立的“底座组件”
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
tabBarIcon: ({ color, size }) => {
           if (route.name === '首页') return <Home color={color} size={size} />;
           if (route.name === '文件') return <Folder color={color} size={size} />;
           if (route.name === '设置') return <Settings color={color} size={size} />;
         },
        tabBarActiveTintColor: '#60a5fa',
        tabBarInactiveTintColor: '#9ca3af',
        headerStyle: { backgroundColor: '#1f2937' },
        headerTintColor: '#ffffff',
        tabBarStyle: { backgroundColor: '#1f2937', borderTopColor: '#374151' },
        sceneContainerStyle: { backgroundColor: '#111827' },
      })}
    >
<Tab.Screen name="首页" component={HomeStack} options={{ headerShown: false }} />
       <Tab.Screen name="文件" component={FilesScreen} />
       <Tab.Screen name="设置" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

// 🚀 真正的 App 顶级入口
export default function App() {
  return (
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111827' },
  text: { color: '#e5e7eb', fontSize: 16 },
});