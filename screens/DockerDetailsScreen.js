import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Image, StyleSheet, Text, View, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity,
  Modal, TextInput, Pressable, Platform, Linking, KeyboardAvoidingView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import {
  ShoppingBag, Download, Cpu, Database, RotateCw, Play, Power, Terminal, ExternalLink,
  Search, Copy, Check, X, RefreshCw, Globe, Sliders, Box, Layers,
  ChevronDown, ArrowUpDown, Filter, Sparkles, ArrowUp, FileCode, Plus, CheckCircle2, AlertTriangle, AlertCircle, Trash2, Folder } from 'lucide-react-native';
import { useTheme } from '../ThemeContext';
import ModernConfirmDialog from '../components/ModernConfirmDialog';
import {
  getProxyConfig, getDockerAliases, saveDockerAlias,
  removeDockerAlias, resolveDockerWebUrl,
} from '../utils/dockerWebUiManager';

export default function DockerDetailsScreen({ route }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [dockers, setDockers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'running' | 'stopped'
  const [sortRule, setSortRule] = useState('name'); // 'name' | 'status' | 'cpu' // 'status' | 'name' | 'cpu'
  const [openingDocker, setOpeningDocker] = useState(null);
  const [updatingDocker, setUpdatingDocker] = useState(null);

  // 顶部分段切换：独立容器 vs Compose 堆栈
  const [dockerMode, setDockerMode] = useState('containers');
  useEffect(() => {
    if (route?.params?.initialMode) {
      setDockerMode(route.params.initialMode);
      if (route.params.initialMode === 'apps') {
        fetchCaApps();
      }
    }
  }, [route?.params?.initialMode]); // 'containers' | 'compose' | 'apps'
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // 社区应用市场 (Community Applications) 状态
  const [caApps, setCaApps] = useState([]);
  const [caLoading, setCaLoading] = useState(false);
  const [caSearch, setCaSearch] = useState('');
  const [caCategory, setCaCategory] = useState('all');

  const CA_CATEGORIES = [
    { id: 'all', label: '全部' },
    { id: 'media', label: '影音媒体' },
    { id: 'download', label: '下载工具' },
    { id: 'cloud', label: '私有云盘' },
    { id: 'network', label: '网络安全' },
    { id: 'smarthome', label: '智能家居' },
    { id: 'tools', label: '系统工具' },
  ];

  // Docker Compose 状态
  const [composeProjects, setComposeProjects] = useState([]);
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeActionLoading, setComposeActionLoading] = useState({});
  const [composeSearchQuery, setComposeSearchQuery] = useState('');

  // YAML 编辑器弹窗
  const [yamlModalVisible, setYamlModalVisible] = useState(false);
  const [selectedComposeProject, setSelectedComposeProject] = useState(null);
  const [yamlContent, setYamlContent] = useState('');
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlSaving, setYamlSaving] = useState(false);

  // Compose 日志弹窗
  const [composeLogsModalVisible, setComposeLogsModalVisible] = useState(false);
  const [composeLogsContent, setComposeLogsContent] = useState('');
  const [composeLogsLoading, setComposeLogsLoading] = useState(false);
  const [composeLogsSearch, setComposeLogsSearch] = useState('');
  const [composeLogsCopiedToast, setComposeLogsCopiedToast] = useState(false);
  const composeLogScrollRef = useRef(null);

  // 新建 Compose 堆栈弹窗
  const [newStackModalVisible, setNewStackModalVisible] = useState(false);
  const [newStackName, setNewStackName] = useState('');
  const [newStackYaml, setNewStackYaml] = useState(`services:
  web:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8080:80"
`);
  const [newStackCreating, setNewStackCreating] = useState(false);

  // Modern Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState({
    visible: false,
    type: 'info',
    title: '',
    message: '',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: true,
    onConfirm: null,
  });

  const showConfirm = ({
    type = 'info',
    title,
    message,
    confirmText = '确定',
    cancelText = '取消',
    showCancel = true,
    onConfirm,
  }) => {
    setConfirmDialog({
      visible: true,
      type,
      title,
      message,
      confirmText,
      cancelText,
      showCancel,
      onConfirm: () => {
        setConfirmDialog(prev => ({ ...prev, visible: false }));
        if (onConfirm) onConfirm();
      },
    });
  };

  // Real-Time Log Viewer Modal State
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [selectedDocker, setSelectedDocker] = useState(null);
  const [logsContent, setLogsContent] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [copiedToast, setCopiedToast] = useState(false);
  const logScrollRef = useRef(null);

  // WebUI Reverse Proxy & Custom Aliases State
  const [proxyConfig, setProxyConfig] = useState({ enabled: false, template: '' });
  const [dockerAliases, setDockerAliases] = useState({});
  const [serverUrl, setServerUrl] = useState('');
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [targetDockerForAlias, setTargetDockerForAlias] = useState(null);
  const [aliasInputValue, setAliasInputValue] = useState('');

  const getAvatarColor = (name) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const palette = ['#38bdf8', '#818cf8', '#a78bfa', '#34d399', '#2dd4bf', '#fbbf24', '#f87171', '#f43f5e', '#ec4899'];
    return palette[Math.abs(hash) % palette.length];
  };

  const fetchDockerData = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=status`, { signal: controller.signal });
      clearTimeout(timeoutId);

      const data = await response.json();
      if (data.dockers && data.dockers.list) setDockers(data.dockers.list);
    } catch (error) {
      console.log('获取 Docker 失败', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProxyData = async () => {
    const [pCfg, aliases, savedUrl] = await Promise.all([
      getProxyConfig(),
      getDockerAliases(),
      AsyncStorage.getItem('@server_url'),
    ]);
    setProxyConfig(pCfg);
    setDockerAliases(aliases || {});
    setServerUrl(savedUrl || '');
  };

  
  // 每 12 小时静默自动检查 Docker 容器更新
  const checkDockerUpdatesAuto = async () => {
    try {
      const lastCheck = await AsyncStorage.getItem('@last_docker_update_check_time');
      const now = Date.now();
      if (!lastCheck || (now - parseInt(lastCheck, 10)) > 12 * 3600 * 1000) {
        const savedUrl = await AsyncStorage.getItem('@server_url');
        const savedToken = await AsyncStorage.getItem('@api_token');
        if (savedUrl && savedToken) {
          await AsyncStorage.setItem('@last_docker_update_check_time', String(now));
          fetch(`${savedUrl}/api.php?token=${savedToken}&action=check_docker_updates`)
            .then(r => r.json())
            .then(() => fetchDockerData())
            .catch(() => {});
        }
      }
    } catch (e) {}
  };

  useFocusEffect(
    useCallback(() => {
      checkDockerUpdatesAuto();
      let isActive = true;
      let timerId = null;
      const pollData = async () => {
        if (!isActive) return;
        await fetchDockerData();
        if (isActive) timerId = setTimeout(pollData, 3000);
      };
      loadProxyData();
      pollData();
      fetchComposeProjects();
      return () => { isActive = false; if (timerId) clearTimeout(timerId); };
    }, [])
  );

  const executeDockerAction = async (action, name) => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      const response = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=${action}&target=${encodeURIComponent(name)}`);
      const result = await response.json();
      if (result.status === 'success') {
        await fetchDockerData();
      } else {
        showConfirm({
          type: 'warning',
          title: '操作未成功',
          message: result.message || '服务器拒绝执行此操作',
          confirmText: '知道了',
          showCancel: false,
        });
      }
    } catch (error) {
      showConfirm({
        type: 'warning',
        title: '网络异常',
        message: '连接服务器超时或失败，请检查网络设置。',
        confirmText: '知道了',
        showCancel: false,
      });
    }
  };

  const handleStartDocker = (name) => {
    executeDockerAction('start_docker', name);
  };

  const handleStopDocker = (name) => {
    showConfirm({
      type: 'warning',
      title: '停止容器',
      message: `确定要停止容器「${name}」吗？`,
      confirmText: '确认停止',
      showCancel: true,
      onConfirm: () => executeDockerAction('stop_docker', name),
    });
  };

  
  
  // 手动检查 Docker 容器更新
  const handleCheckDockerUpdates = async () => {
    try {
      setCheckingUpdates(true);
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;

      const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=check_docker_updates`);
      const data = await res.json().catch(() => ({}));

      // 重新拉取 status 接口，获取最新容器列表与 update_available 状态
      const statusRes = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=status`);
      const statusData = await statusRes.json().catch(() => ({}));
      let foundCount = 0;
      if (statusData && statusData.dockers && Array.isArray(statusData.dockers.list)) {
        setDockers(statusData.dockers.list);
        foundCount = statusData.dockers.list.filter(d => !!d.update_available).length;
      }
      if (foundCount === 0 && (data.update_count > 0 || data.updates_count > 0)) {
        foundCount = data.update_count || data.updates_count;
      }

      showConfirm({
        type: 'info',
        title: '更新检查完成',
        message: foundCount > 0
          ? `共发现 ${foundCount} 个容器有新版本可用。已为您在列表中标记「可更新」。`
          : '当前所有 Docker 容器均已为最新版本，暂无可用更新。',
        confirmText: '好的',
        showCancel: false,
      });
    } catch (err) {
      showConfirm({
        type: 'danger',
        title: '检查更新失败',
        message: '连接服务器或执行更新检测脚本异常，请稍后再试。',
        confirmText: '确定',
        showCancel: false,
      });
    } finally {
      setCheckingUpdates(false);
    }
  };

  // 获取社区应用列表
  const fetchCaApps = async (cat = caCategory, q = caSearch) => {
    try {
      setCaLoading(true);
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;

      const url = `${savedUrl}/api.php?token=${savedToken}&action=ca_apps&category=${encodeURIComponent(cat)}&q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'success' && Array.isArray(data.apps)) {
        setCaApps(data.apps);
      }
    } catch (e) {
      console.log('fetchCaApps error:', e);
    } finally {
      setCaLoading(false);
    }
  };

  // 部署社区应用
  const handleDeployApp = async (app) => {
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const cleanUrl = savedUrl ? savedUrl.replace(/\/api\.php.*$/, '').replace(/\/+$/, '') : '';
      const templateDirectUrl = `${cleanUrl}/Docker/AddContainer?xmlTemplate=default:${encodeURIComponent(app.repository)}`;

      showConfirm({
        type: 'info',
        title: `部署「${app.name}」`,
        message: `镜像仓库: ${app.repository}\n推荐端口: ${app.default_port || '默认配置'}\n\n是否打开 Unraid 官方容器模板进行路径与端口配置？`,
        confirmText: '打开模板配置',
        cancelText: '取消',
        showCancel: true,
        onConfirm: () => {
          Linking.openURL(templateDirectUrl).catch(() => {
            Linking.openURL(cleanUrl);
          });
        },
      });
    } catch (e) {
      console.log(e);
    }
  };

  // 容器升级操作
  const handleUpdateDocker = (name) => {
    showConfirm({
      type: 'warning',
      title: '升级容器',
      message: `确定要拉取最新镜像并重新创建容器「${name}」吗？\n拉取镜像与重建容器通常需要 1 至 3 分钟，升级过程中容器将短暂离线。`,
      confirmText: '立即升级',
      cancelText: '取消',
      showCancel: true,
      onConfirm: async () => {
        setUpdatingDocker(name);
        const controller = new AbortController();
        const timeoutTimer = setTimeout(() => controller.abort(), 360000); // 6 minutes timeout for image pull
        try {
          const savedUrl = await AsyncStorage.getItem('@server_url');
          const savedToken = await AsyncStorage.getItem('@api_token');
          const res = await fetch(
            `${savedUrl}/api.php?token=${savedToken}&action=update_docker&target=${encodeURIComponent(name)}`,
            { signal: controller.signal }
          );
          clearTimeout(timeoutTimer);
          const rawText = await res.text();
          let data = null;
          try {
            data = JSON.parse(rawText);
          } catch (parseErr) {
            showConfirm({
              type: 'error',
              title: '服务端异常',
              message: rawText ? (rawText.length > 300 ? rawText.substring(0, 300) + '...' : rawText) : '服务端未返回有效响应',
              confirmText: '确定',
              showCancel: false,
            });
            return;
          }

          if (data && data.status === 'success') {
            showConfirm({
              type: 'success',
              title: '升级成功',
              message: data.message || `容器「${name}」已升级为最新版本！`,
              confirmText: '好的',
              showCancel: false,
            });
            await fetchDockerData();
            setTimeout(() => fetchDockerData(), 2500);
          } else {
            showConfirm({
              type: 'error',
              title: '升级失败',
              message: (data && data.message) ? data.message : '升级未能完成，未检测到容器重新创建',
              confirmText: '确定',
              showCancel: false,
            });
          }
        } catch (e) {
          clearTimeout(timeoutTimer);
          const isTimeout = e.name === 'AbortError' || (e.message && e.message.includes('abort'));
          showConfirm({
            type: 'warning',
            title: isTimeout ? '升级超时' : '请求异常',
            message: isTimeout 
              ? '镜像拉取时间较长已超过6分钟。Unraid 服务端仍在后台继续升级，请稍后刷新容器列表查看状态。' 
              : (e.message || '网络连接异常'),
            confirmText: '确定',
            showCancel: false,
          });
        } finally {
          setUpdatingDocker(null);
        }
      },
    });
  };

  // Compose 堆栈列表拉取
  const fetchComposeProjects = async () => {
    try {
      setComposeLoading(true);
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;
      const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=compose_list`);
      const data = await res.json();
      if (data.status === 'success') {
        setComposeProjects(data.projects || []);
      }
    } catch (err) {
      console.log('fetchComposeProjects error:', err);
    } finally {
      setComposeLoading(false);
    }
  };

  // Compose 指令执行 (up, down, restart, pull)
  const executeComposeAction = async (target, cmd) => {
    const cmdLabels = {
      up: '启动',
      down: '停止',
      restart: '重启',
      pull: '拉取更新',
    };
    const label = cmdLabels[cmd] || cmd;

    const runAction = async () => {
      setComposeActionLoading(prev => ({ ...prev, [target]: cmd }));
      try {
        const savedUrl = await AsyncStorage.getItem('@server_url');
        const savedToken = await AsyncStorage.getItem('@api_token');
        const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=compose_action&target=${encodeURIComponent(target)}&compose_cmd=${cmd}`);
        const data = await res.json();
        if (data.status === 'success') {
          showConfirm({
            type: 'success',
            title: '操作完成',
            message: data.message || `堆栈「${target}」${label}成功！`,
            confirmText: '好的',
            showCancel: false,
          });
          fetchComposeProjects();
        } else {
          showConfirm({
            type: 'error',
            title: '执行失败',
            message: data.message || '执行 Compose 操作失败',
            confirmText: '确定',
            showCancel: false,
          });
        }
      } catch (e) {
        showConfirm({
          type: 'warning',
          title: '网络异常',
          message: e.message || '网络通信超时',
          confirmText: '确定',
          showCancel: false,
        });
      } finally {
        setComposeActionLoading(prev => ({ ...prev, [target]: null }));
      }
    };

    if (cmd === 'down') {
      showConfirm({
        type: 'danger',
        title: '停止 Compose 堆栈',
        message: `确定要执行 docker compose down 停止并移除堆栈「${target}」的容器吗？`,
        confirmText: '确认停止',
        cancelText: '取消',
        showCancel: true,
        onConfirm: runAction,
      });
    } else if (cmd === 'restart') {
      showConfirm({
        type: 'info',
        title: '重启 Compose 堆栈',
        message: `确定要重启堆栈「${target}」中的全部容器吗？`,
        confirmText: '确认重启',
        cancelText: '取消',
        showCancel: true,
        onConfirm: runAction,
      });
    } else {
      runAction();
    }
  };

  // 打开 Compose YAML 配置
  const openYamlModal = async (project) => {
    setSelectedComposeProject(project);
    setYamlModalVisible(true);
    setYamlLoading(true);
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=compose_file&target=${encodeURIComponent(project.name)}`);
      const data = await res.json();
      if (data.status === 'success') {
        setYamlContent(data.content || '');
      } else {
        setYamlContent(`# 加载失败: ${data.message || '未知错误'}`);
      }
    } catch (e) {
      setYamlContent(`# 加载失败: ${e.message}`);
    } finally {
      setYamlLoading(false);
    }
  };

  // 保存 Compose YAML
  const saveYamlFile = async () => {
    if (!selectedComposeProject) return;
    setYamlSaving(true);
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=compose_save&target=${encodeURIComponent(selectedComposeProject.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `content=${encodeURIComponent(yamlContent)}`
      });
      const data = await res.json();
      if (data.status === 'success') {
        showConfirm({
          type: 'success',
          title: '保存成功',
          message: 'Compose 配置文件已更新。是否立即应用并启动？',
          confirmText: '立即应用启动',
          cancelText: '仅保存',
          showCancel: true,
          onConfirm: () => {
            setYamlModalVisible(false);
            executeComposeAction(selectedComposeProject.name, 'up');
          },
          onCancel: () => {
            setYamlModalVisible(false);
            fetchComposeProjects();
          }
        });
      } else {
        showConfirm({ type: 'error', title: '保存失败', message: data.message || '无法保存 YAML 文件', showCancel: false });
      }
    } catch (e) {
      showConfirm({ type: 'warning', title: '网络异常', message: e.message, showCancel: false });
    } finally {
      setYamlSaving(false);
    }
  };

  // Compose 日志查看
  const openComposeLogs = async (project) => {
    setSelectedComposeProject(project);
    setComposeLogsModalVisible(true);
    setComposeLogsLoading(true);
    setComposeLogsContent('');
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=compose_logs&target=${encodeURIComponent(project.name)}&lines=250`);
      const data = await res.json();
      if (data.status === 'success') {
        setComposeLogsContent(data.logs || '暂无日志输出');
        setTimeout(() => {
          if (composeLogScrollRef.current) composeLogScrollRef.current.scrollToEnd({ animated: true });
        }, 300);
      } else {
        setComposeLogsContent(`获取日志失败: ${data.message}`);
      }
    } catch (e) {
      setComposeLogsContent(`网络异常: ${e.message}`);
    } finally {
      setComposeLogsLoading(false);
    }
  };

  // 创建新堆栈
  const handleCreateNewStack = async () => {
    if (!newStackName.trim()) {
      showConfirm({ type: 'warning', title: '提示', message: '请输入堆栈项目名称', showCancel: false });
      return;
    }
    setNewStackCreating(true);
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=compose_save&target=${encodeURIComponent(newStackName.trim())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `content=${encodeURIComponent(newStackYaml)}`
      });
      const data = await res.json();
      if (data.status === 'success') {
        setNewStackModalVisible(false);
        showConfirm({
          type: 'success',
          title: '创建成功',
          message: `堆栈「${newStackName.trim()}」已创建成功，是否立即部署启动？`,
          confirmText: '立即启动',
          cancelText: '稍后启动',
          showCancel: true,
          onConfirm: () => {
            executeComposeAction(newStackName.trim(), 'up');
          },
          onCancel: () => {
            fetchComposeProjects();
          }
        });
      } else {
        showConfirm({ type: 'error', title: '创建失败', message: data.message, showCancel: false });
      }
    } catch (e) {
      showConfirm({ type: 'warning', title: '网络异常', message: e.message, showCancel: false });
    } finally {
      setNewStackCreating(false);
    }
  };

  const handleRestartDocker = (name) => {
    showConfirm({
      type: 'info',
      title: '重启容器',
      message: `确定要重启容器「${name}」吗？`,
      confirmText: '确认重启',
      showCancel: true,
      onConfirm: () => executeDockerAction('restart_docker', name),
    });
  };

  // 快捷一键直达 WebUI
  const handleLaunchWebUI = async (docker, webUiInfo) => {
    if (!webUiInfo.targetUrl) {
      handleOpenAliasModal(docker, webUiInfo);
      return;
    }

    try {
      setOpeningDocker(docker.name);
      const urlToOpen = webUiInfo.targetUrl;

      const canOpen = await Linking.canOpenURL(urlToOpen);
      if (canOpen) {
        await Linking.openURL(urlToOpen);
      } else {
        showConfirm({
          type: 'warning',
          title: '无法打开链接',
          message: `系统无法唤起该地址：\n${urlToOpen}`,
          showCancel: false,
        });
      }
    } catch (err) {
      showConfirm({
        type: 'warning',
        title: '打开异常',
        message: err.message || '打开 WebUI 遇到未知异常',
        showCancel: false,
      });
    } finally {
      setOpeningDocker(null);
    }
  };

  const handleShowWebUiOptions = (docker, webUiInfo) => {
    const proxy = webUiInfo.proxyUrl || (webUiInfo.isProxy || webUiInfo.isFullUrl ? webUiInfo.targetUrl : '');
    showConfirm({
      type: 'info',
      title: `${docker.name} · Web 访问选项`,
      message: `反代地址:\n${proxy || '未配置全局反代或简称'}\n\n内网直连 (域名加端口):\n${webUiInfo.rawInternalUrl || '未检测到端口'}\n\n请选择访问方式：`,
      confirmText: proxy ? '打开反代地址' : '配置反代',
      cancelText: '打开内网直连',
      showCancel: true,
      onConfirm: async () => {
        if (proxy) {
          try {
            await Linking.openURL(proxy);
          } catch (e) {
            showConfirm({ type: 'warning', title: '打开异常', message: e.message, showCancel: false });
          }
        } else {
          handleOpenAliasModal(docker, webUiInfo);
        }
      },
      onCancel: async () => {
        if (webUiInfo.rawInternalUrl) {
          try {
            await Linking.openURL(webUiInfo.rawInternalUrl);
          } catch (e) {
            showConfirm({ type: 'warning', title: '打开异常', message: e.message, showCancel: false });
          }
        } else {
          showConfirm({ type: 'warning', title: '提示', message: '未检测到内网端口直连地址', showCancel: false });
        }
      },
    });
  };

  const handleOpenAliasModal = (docker, webUiInfo) => {
    setTargetDockerForAlias(docker);
    setAliasInputValue(webUiInfo.alias || '');
    setAliasModalVisible(true);
  };

  const handleSaveAlias = async () => {
    if (!targetDockerForAlias) return;
    const cName = targetDockerForAlias.name;
    const clean = aliasInputValue ? aliasInputValue.trim() : '';
    await saveDockerAlias(cName, clean);
    setDockerAliases(prev => {
      const updated = { ...prev };
      if (clean) {
        updated[cName] = clean;
      } else {
        delete updated[cName];
      }
      return updated;
    });
    setAliasModalVisible(false);
    showConfirm({
      type: 'success',
      title: '配置已生效',
      message: clean
        ? `已成功为容器「${cName}」设置专属规则：\n${clean.startsWith('http') ? clean : `简称: ${clean} (自动代入模板)`}`
        : `已清除容器「${cName}」的专属简称，恢复为默认解析规则。`,
      confirmText: '好的',
      showCancel: false,
    });
  };

  const handleClearAlias = async () => {
    if (!targetDockerForAlias) return;
    const cName = targetDockerForAlias.name;
    await removeDockerAlias(cName);
    setDockerAliases(prev => {
      const updated = { ...prev };
      delete updated[cName];
      return updated;
    });
    setAliasModalVisible(false);
    showConfirm({
      type: 'info',
      title: '已恢复默认',
      message: `已清除容器「${cName}」的独立反代规则。`,
      confirmText: '好的',
      showCancel: false,
    });
  };

  // 日志拉取与搜索
  const openLogsModal = (dockerItem) => {
    setSelectedDocker(dockerItem);
    setLogsContent('');
    setLogSearchQuery('');
    setLogModalVisible(true);
    fetchDockerLogs(dockerItem.name);
  };

  const fetchDockerLogs = async (dockerName) => {
    setLogsLoading(true);
    try {
      const savedUrl = await AsyncStorage.getItem('@server_url');
      const savedToken = await AsyncStorage.getItem('@api_token');
      if (!savedUrl || !savedToken) return;

      const res = await fetch(`${savedUrl}/api.php?token=${savedToken}&action=docker_logs&target=${encodeURIComponent(dockerName)}&lines=200`);
      const data = await res.json();
      if (data.status === 'success') {
        setLogsContent(data.logs || '暂无输出日志');
        setTimeout(() => {
          if (logScrollRef.current) {
            logScrollRef.current.scrollToEnd({ animated: true });
          }
        }, 300);
      } else {
        const isUnknownAction = data.message && /unknown action/i.test(data.message);
        setLogsContent(isUnknownAction
          ? '获取容器日志失败：服务端尚未更新最新的 api.php。\n\n请将项目代码库中的 api.php 拷贝至 Unraid 服务器的 /usr/local/emhttp/api.php 并执行：\nchmod 755 /usr/local/emhttp/api.php'
          : `获取日志失败: ${data.message || '未知异常'}`);
      }
    } catch (e) {
      setLogsContent(`拉取日志网络异常: ${e.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const copyAllLogs = async () => {
    try {
      await Clipboard.setStringAsync(filteredLogs);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    } catch (e) {
      console.log('Copy logs error:', e);
    }
  };

  const filteredLogs = useMemo(() => {
    if (!logSearchQuery.trim()) return logsContent;
    const query = logSearchQuery.toLowerCase();
    const lines = logsContent.split('\n');
    return lines.filter(line => line.toLowerCase().includes(query)).join('\n');
  }, [logsContent, logSearchQuery]);

  // 聚合指标计算
  const runningCount = useMemo(() => dockers.filter(d => d.status === 'running').length, [dockers]);
  const updateCount = useMemo(() => dockers.filter(d => d.update_available).length, [dockers]);
  const stoppedCount = useMemo(() => dockers.length - runningCount, [dockers, runningCount]);
  const totalCpuAgg = useMemo(() => {
    let sum = 0;
    dockers.forEach(d => {
      const val = parseFloat(String(d.cpu || '').replace('%', '')) || 0;
      sum += val;
    });
    return sum.toFixed(1);
  }, [dockers]);

  // 过滤与排序
  
  const filteredComposeProjects = useMemo(() => {
    let list = [...composeProjects];
    if (composeSearchQuery.trim()) {
      const q = composeSearchQuery.toLowerCase();
      list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.services || []).some(s => s.toLowerCase().includes(q)));
    }
    return list;
  }, [composeProjects, composeSearchQuery]);

  const composeRunningCount = useMemo(() => composeProjects.filter(p => p.status === 'running').length, [composeProjects]);

  const processedDockers = useMemo(() => {
    let list = [...dockers];
    if (statusFilter === 'running') {
      list = list.filter(d => d.status === 'running');
    } else if (statusFilter === 'stopped') {
      list = list.filter(d => d.status !== 'running');
    } else if (statusFilter === 'updates') {
      list = list.filter(d => d.update_available);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(d => (d.name || '').toLowerCase().includes(q) || String(d.port || '').includes(q));
    }

    list.sort((a, b) => {
      if (sortRule === 'status') return (a.status === 'running' ? -1 : 1) - (b.status === 'running' ? -1 : 1);
      if (sortRule === 'cpu') {
        const cpuA = parseFloat(String(a.cpu || '').replace('%', '')) || 0;
        const cpuB = parseFloat(String(b.cpu || '').replace('%', '')) || 0;
        return cpuB - cpuA;
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    return list;
  }, [dockers, statusFilter, searchQuery, sortRule]);

  if (loading && dockers.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>正在加载 Docker 容器清单...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 顶部分段切换：独立容器 vs Compose 堆栈 vs 应用市场 */}
      <View style={styles.segmentContainer}>
        <TouchableOpacity
          style={[styles.segmentBtn, dockerMode === 'containers' && styles.segmentBtnActive]}
          onPress={() => setDockerMode('containers')}
          activeOpacity={0.8}
        >
          <Box size={14} color={dockerMode === 'containers' ? '#ffffff' : colors.sub} style={{ marginRight: 5 }} />
          <Text style={[styles.segmentBtnText, dockerMode === 'containers' && styles.segmentBtnTextActive]}>
            独立容器 ({dockers.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, dockerMode === 'compose' && styles.segmentBtnActive]}
          onPress={() => {
            setDockerMode('compose');
            fetchComposeProjects();
          }}
          activeOpacity={0.8}
        >
          <Layers size={14} color={dockerMode === 'compose' ? '#ffffff' : colors.sub} style={{ marginRight: 5 }} />
          <Text style={[styles.segmentBtnText, dockerMode === 'compose' && styles.segmentBtnTextActive]}>
            Compose ({composeProjects.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, dockerMode === 'apps' && styles.segmentBtnActive]}
          onPress={() => {
            setDockerMode('apps');
            if (caApps.length === 0) fetchCaApps();
          }}
          activeOpacity={0.8}
        >
          <ShoppingBag size={14} color={dockerMode === 'apps' ? '#ffffff' : colors.sub} style={{ marginRight: 5 }} />
          <Text style={[styles.segmentBtnText, dockerMode === 'apps' && styles.segmentBtnTextActive]}>
            应用市场
          </Text>
        </TouchableOpacity>
      </View>

      
      {dockerMode === 'compose' ? (
        <View style={{ flex: 1 }}>
          {/* Compose 概览与快捷操作 */}
          <View style={styles.composeHeroRow}>
            <View style={styles.composeHeroCard}>
              <Text style={styles.composeHeroNum}>{composeProjects.length}</Text>
              <Text style={styles.composeHeroLabel}>总堆栈数</Text>
            </View>
            <View style={styles.composeHeroCard}>
              <Text style={[styles.composeHeroNum, { color: colors.green }]}>{composeRunningCount}</Text>
              <Text style={styles.composeHeroLabel}>全服务运行</Text>
            </View>
            <View style={styles.composeHeroCard}>
              <Text style={[styles.composeHeroNum, { color: colors.amber }]}>
                {composeProjects.length - composeRunningCount}
              </Text>
              <Text style={styles.composeHeroLabel}>未完全运行</Text>
            </View>
          </View>

          {/* 搜索与新建堆栈 */}
          <View style={styles.filterSection}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[styles.searchBox, { flex: 1 }]}>
                <Search size={15} color={colors.sub} style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="搜索 Compose 项目或服务..."
                  placeholderTextColor={colors.muted}
                  value={composeSearchQuery}
                  onChangeText={setComposeSearchQuery}
                  autoCapitalize="none"
                />
                {composeSearchQuery ? (
                  <TouchableOpacity onPress={() => setComposeSearchQuery('')}>
                    <X size={15} color={colors.sub} />
                  </TouchableOpacity>
                ) : null}
              </View>

              <TouchableOpacity
                style={styles.newStackBtn}
                onPress={() => {
                  setNewStackName('');
                  setNewStackModalVisible(true);
                }}
                activeOpacity={0.8}
              >
                <Plus size={15} color="#ffffff" style={{ marginRight: 4 }} />
                <Text style={styles.newStackBtnText}>新建堆栈</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Compose 堆栈列表 */}
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {filteredComposeProjects.map((project, idx) => {
              const isRunning = project.status === 'running';
              const isPartial = project.status === 'partial';
              const isStopped = project.status === 'stopped';
              const actLoading = composeActionLoading[project.name];

              return (
                <View key={project.name || idx} style={styles.composeCard}>
                  {/* Header */}
                  <View style={styles.composeCardHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <View style={[styles.composeIconBox, { backgroundColor: isRunning ? 'rgba(16, 185, 129, 0.12)' : isPartial ? 'rgba(245, 158, 11, 0.12)' : 'rgba(148, 163, 184, 0.12)' }]}>
                        <Layers size={18} color={isRunning ? colors.green : isPartial ? colors.amber : colors.sub} />
                      </View>
                      <View style={{ marginLeft: 10, flex: 1 }}>
                        <Text style={styles.composeCardTitle} numberOfLines={1}>{project.name}</Text>
                        <Text style={styles.composeCardPath} numberOfLines={1}>{project.yaml_file || project.path}</Text>
                      </View>
                    </View>

                    {/* 状态徽章 */}
                    <View style={[styles.composeStatusBadge, {
                      backgroundColor: isRunning ? 'rgba(16, 185, 129, 0.12)' : isPartial ? 'rgba(245, 158, 11, 0.12)' : 'rgba(148, 163, 184, 0.12)'
                    }]}>
                      <View style={[styles.statusDotSmall, {
                        backgroundColor: isRunning ? colors.green : isPartial ? colors.amber : colors.sub
                      }]} />
                      <Text style={[styles.composeStatusBadgeText, {
                        color: isRunning ? colors.green : isPartial ? colors.amber : colors.sub
                      }]}>
                        {isRunning ? '运行中' : isPartial ? '部分运行' : '已停止'}
                        {project.total_count > 0 ? ` (${project.running_count || 0}/${project.total_count})` : ''}
                      </Text>
                    </View>
                  </View>

                  {/* 包含服务标签列表 */}
                  {project.services && project.services.length > 0 && (
                    <View style={styles.composeServicesRow}>
                      <Text style={styles.composeServicesLabel}>服务:</Text>
                      <View style={styles.composeServiceTagsWrap}>
                        {project.services.map((srv, sIdx) => (
                          <View key={sIdx} style={styles.composeServiceChip}>
                            <Text style={styles.composeServiceChipText}>{srv}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Action Bar */}
                  <View style={styles.composeActionsRow}>
                    {/* 查看配置与日志 */}
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity
                        style={styles.composeConfigBtn}
                        onPress={() => openYamlModal(project)}
                        activeOpacity={0.7}
                      >
                        <FileCode size={13} color={colors.accent} style={{ marginRight: 4 }} />
                        <Text style={styles.composeConfigBtnText}>配置</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.composeConfigBtn}
                        onPress={() => openComposeLogs(project)}
                        activeOpacity={0.7}
                      >
                        <Terminal size={13} color={colors.accent} style={{ marginRight: 4 }} />
                        <Text style={styles.composeConfigBtnText}>日志</Text>
                      </TouchableOpacity>
                    </View>

                    {/* 生命周期操作 (Up, Down, Restart, Pull) */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <TouchableOpacity
                        style={styles.circleActionBtn}
                        onPress={() => executeComposeAction(project.name, 'pull')}
                        disabled={!!actLoading}
                        activeOpacity={0.7}
                        accessibilityLabel="拉取最新镜像"
                      >
                        {actLoading === 'pull' ? (
                          <ActivityIndicator size="small" color={colors.amber} />
                        ) : (
                          <ArrowUp size={14} color="#f59e0b" />
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.circleActionBtn}
                        onPress={() => executeComposeAction(project.name, 'restart')}
                        disabled={!!actLoading}
                        activeOpacity={0.7}
                        accessibilityLabel="重启堆栈"
                      >
                        {actLoading === 'restart' ? (
                          <ActivityIndicator size="small" color={colors.sub} />
                        ) : (
                          <RotateCw size={14} color={colors.sub} />
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.circleActionBtn, {
                          backgroundColor: isRunning ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)'
                        }]}
                        onPress={() => executeComposeAction(project.name, isRunning ? 'down' : 'up')}
                        disabled={!!actLoading}
                        activeOpacity={0.7}
                      >
                        {actLoading === (isRunning ? 'down' : 'up') ? (
                          <ActivityIndicator size="small" color={isRunning ? colors.red : colors.green} />
                        ) : isRunning ? (
                          <Power size={14} color={colors.red} />
                        ) : (
                          <Play size={14} color={colors.green} />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}

            {filteredComposeProjects.length === 0 && !composeLoading && (
              <View style={styles.emptyContainer}>
                <Layers size={42} color={colors.muted} style={{ marginBottom: 12 }} />
                <Text style={styles.emptyTitle}>暂无 Compose 堆栈</Text>
                <Text style={styles.emptySub}>
                  点击右上角「新建堆栈」创建新项目，或在 Unraid compose.manager 插件中添加。
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      ) : dockerMode === 'apps' ? (
        <View style={{ flex: 1 }}>
          {/* 社区应用市场视图 */}
          <View style={styles.filterSection}>
            <View style={styles.searchBox}>
              <Search size={15} color={colors.sub} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="搜索官方模板与社区应用..."
                placeholderTextColor={colors.muted}
                value={caSearch}
                onChangeText={(t) => {
                  setCaSearch(t);
                  fetchCaApps(caCategory, t);
                }}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {caSearch ? (
                <TouchableOpacity onPress={() => { setCaSearch(''); fetchCaApps(caCategory, ''); }}>
                  <X size={15} color={colors.sub} />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* 分类快捷滑块 */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 10 }}
              contentContainerStyle={{ gap: 8, paddingRight: 16 }}
            >
              {CA_CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.tabBtn,
                    caCategory === cat.id && styles.tabBtnActive
                  ]}
                  onPress={() => {
                    setCaCategory(cat.id);
                    fetchCaApps(cat.id, caSearch);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.tabBtnText,
                    caCategory === cat.id && styles.tabBtnTextActive
                  ]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* 应用卡片列表 */}
          {caLoading && caApps.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>正在获取社区应用市场清单...</Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={caLoading}
                  onRefresh={() => fetchCaApps(caCategory, caSearch)}
                  colors={[colors.accent]}
                  tintColor={colors.accent}
                />
              }
            >
              {caApps.map((app, index) => (
                <View key={app.id || index} style={styles.dockerCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    {app.icon ? (
                      <Image
                        source={{ uri: app.icon }}
                        style={styles.appIcon}
                        resizeMode="contain"
                      />
                    ) : (
                      <View style={[styles.appIconFallback, { backgroundColor: 'rgba(56, 189, 248, 0.12)' }]}>
                        <ShoppingBag size={22} color={colors.accent} />
                      </View>
                    )}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={styles.appNameText} numberOfLines={1}>{app.name}</Text>
                        <View style={styles.appCategoryBadge}>
                          <Text style={styles.appCategoryText}>{app.category || 'Tools'}</Text>
                        </View>
                      </View>
                      <Text style={styles.appAuthorText} numberOfLines={1}>作者: {app.author || '社区精选'}</Text>
                    </View>
                  </View>

                  {app.overview ? (
                    <Text style={[styles.appOverviewText, { marginTop: 10 }]} numberOfLines={3}>
                      {app.overview}
                    </Text>
                  ) : null}

                  <View style={styles.appFooterRow}>
                    <View style={styles.appRepoTag}>
                      <Text style={styles.appRepoText} numberOfLines={1}>{app.repository}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.appInstallBtn}
                      onPress={() => handleDeployApp(app)}
                      activeOpacity={0.8}
                    >
                      <Download size={13} color="#ffffff" style={{ marginRight: 4 }} />
                      <Text style={styles.appInstallBtnText}>一键部署</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              {caApps.length === 0 && !caLoading && (
                <View style={styles.emptyContainer}>
                  <ShoppingBag size={42} color={colors.muted} style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyTitle}>暂无匹配应用</Text>
                  <Text style={styles.emptySub}>未搜索到相关应用模板，请尝试更换关键词或分类。</Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      ) : (
        <View style={{ flex: 1 }}>

      {/* 1. 顶部 Bento 概览看板 (Hero Stats) */}
      <View style={styles.heroRow}>
        <View style={styles.heroCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <View style={[styles.heroDot, { backgroundColor: colors.green }]} />
            <Text style={styles.heroLabel}>运行中</Text>
          </View>
          <Text style={[styles.heroNum, { color: colors.green }]}>{runningCount}</Text>
        </View>

        <View style={styles.heroCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <View style={[styles.heroDot, { backgroundColor: colors.sub }]} />
            <Text style={styles.heroLabel}>已停止</Text>
          </View>
          <Text style={[styles.heroNum, { color: colors.textStrong }]}>{stoppedCount}</Text>
        </View>

        <View style={styles.heroCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Cpu size={11} color={colors.tempWarm} style={{ marginRight: 4 }} />
            <Text style={styles.heroLabel}>总负载</Text>
          </View>
          <Text style={[styles.heroNum, { color: colors.tempWarm }]}>{totalCpuAgg}%</Text>
        </View>
      </View>

      {/* 2. 搜索框与状态筛选胶囊 */}
      <View style={styles.filterSection}>
        <View style={styles.searchBox}>
          <Search size={15} color={colors.sub} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="搜索容器名称或端口..."
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={15} color={colors.sub} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.filterRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScrollContainer}
          >
            <TouchableOpacity
              style={[styles.tabBtn, statusFilter === 'all' && styles.tabBtnActive]}
              onPress={() => setStatusFilter('all')}
            >
              <Text style={[styles.tabBtnText, statusFilter === 'all' && styles.tabBtnTextActive]}>
                全部 {dockers.length}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, statusFilter === 'running' && styles.tabBtnActive]}
              onPress={() => setStatusFilter('running')}
            >
              <Text style={[styles.tabBtnText, statusFilter === 'running' && styles.tabBtnTextActive]}>
                运行中 {runningCount}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, statusFilter === 'stopped' && styles.tabBtnActive]}
              onPress={() => setStatusFilter('stopped')}
            >
              <Text style={[styles.tabBtnText, statusFilter === 'stopped' && styles.tabBtnTextActive]}>
                已停止 {stoppedCount}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabBtn,
                statusFilter === 'updates' && styles.tabBtnActive,
                updateCount > 0 && styles.tabBtnUpdateActive
              ]}
              onPress={() => setStatusFilter('updates')}
            >
              <Text style={[
                styles.tabBtnText,
                statusFilter === 'updates' && styles.tabBtnTextActive,
                updateCount > 0 && { color: '#f59e0b', fontWeight: 'bold' }
              ]}>
                有更新 {updateCount}
              </Text>
            </TouchableOpacity>

            {/* 检查更新按钮 */}
            <TouchableOpacity
              style={[styles.tabBtn, styles.checkUpdateBtn]}
              onPress={handleCheckDockerUpdates}
              disabled={checkingUpdates}
              activeOpacity={0.7}
            >
              {checkingUpdates ? (
                <ActivityIndicator size="small" color="#f59e0b" style={{ marginRight: 4 }} />
              ) : (
                <RefreshCw size={12} color="#f59e0b" style={{ marginRight: 4 }} />
              )}
              <Text style={[styles.tabBtnText, { color: '#f59e0b', fontWeight: '600' }]}>
                {checkingUpdates ? '正在检测...' : '检查更新'}
              </Text>
            </TouchableOpacity>

            {/* 排序切换 */}
            <TouchableOpacity
              style={styles.sortToggleBtn}
              onPress={() => {
                const next = sortRule === 'name' ? 'status' : sortRule === 'status' ? 'cpu' : 'name';
                setSortRule(next);
              }}
              activeOpacity={0.7}
            >
              <ArrowUpDown size={12} color={colors.sub} style={{ marginRight: 4 }} />
              <Text style={styles.sortToggleText}>
                {sortRule === 'name' ? '按名称' : sortRule === 'status' ? '按状态' : '按CPU'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>

      {/* 3. 现代化容器卡片列表 */}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {processedDockers.map((docker, index) => {
          const rawMem = String(docker.memory || docker.mem || '');
          const shortMemory = rawMem.includes(' / ') ? rawMem.split(' / ')[0].trim() : (rawMem || '0B');
          const cpuVal = docker.cpu !== undefined && docker.cpu !== null ? String(docker.cpu) : '0%';
          const cpuText = cpuVal.includes('%') ? cpuVal : `${cpuVal}%`;
          const isRunning = docker.status === 'running';
          const defaultWebInfo = { targetUrl: '', proxyUrl: '', rawInternalUrl: '', isCustom: false, isProxy: false, isFullUrl: false, alias: '' };
          const webUiInfo = (typeof resolveDockerWebUrl === 'function')
            ? (resolveDockerWebUrl(docker, serverUrl, proxyConfig, dockerAliases) || defaultWebInfo)
            : defaultWebInfo;
          const hasWebAccess = !!(webUiInfo.targetUrl || docker.port || docker.ports);
          const hasCustomAlias = !!dockerAliases[docker.name];
          const avatarBg = getAvatarColor(docker.name);
          const initial = (docker.name || 'D').slice(0, 2).toUpperCase();

          return (
            <View key={docker.name || index} style={styles.dockerCard}>
              {/* 上层：头像 + 名称 + 状态呼吸灯 + 端口 */}
              <View style={styles.cardUpperTier}>
                <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>

                <View style={styles.nameBlock}>
                  <Text style={styles.dockerTitle} numberOfLines={1}>
                    {docker.name}
                  </Text>
                  <View style={styles.metaBadgeRow}>
                    <View style={[styles.statusBadge, { backgroundColor: isRunning ? 'rgba(16, 185, 129, 0.12)' : 'rgba(148, 163, 184, 0.12)' }]}>
                      <View style={[styles.statusDotSmall, { backgroundColor: isRunning ? colors.green : colors.sub }]} />
                      <Text style={[styles.statusBadgeText, { color: isRunning ? colors.green : colors.sub }]}>
                        {isRunning ? '运行中' : '已停止'}
                      </Text>
                    </View>

                    
                    {docker.update_available && (
                      <TouchableOpacity
                        style={styles.updateBadge}
                        onPress={() => handleUpdateDocker(docker.name)}
                        disabled={updatingDocker === docker.name}
                        activeOpacity={0.7}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityLabel="升级容器"
                      >
                        {updatingDocker === docker.name ? (
                          <ActivityIndicator size="small" color="#f59e0b" style={{ marginRight: 4 }} />
                        ) : (
                          <ArrowUp size={11} color="#f59e0b" style={{ marginRight: 3 }} />
                        )}
                        <Text style={styles.updateBadgeText}>
                          {updatingDocker === docker.name ? '升级中...' : '有新版本 · 升级'}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {docker.port ? (
                      <View style={styles.portBadge}>
                        <Text style={styles.portBadgeText}>:{docker.port}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* 资源胶囊 */}
                {isRunning ? (
                  <View style={styles.resourcePillsCol}>
                    <View style={styles.resourcePill}>
                      <Cpu size={10} color={colors.tempWarm} style={{ marginRight: 3 }} />
                      <Text style={[styles.resourcePillText, { color: colors.tempWarm }]}>{cpuText}</Text>
                    </View>
                    <View style={[styles.resourcePill, { marginTop: 4 }]}>
                      <Database size={10} color={colors.accent} style={{ marginRight: 3 }} />
                      <Text style={[styles.resourcePillText, { color: colors.accent }]}>{shortMemory}</Text>
                    </View>
                  </View>
                ) : null}
              </View>

              {/* 下层：Action Bar 交互操作栏 */}
              <View style={styles.cardLowerTier}>
                <View style={styles.webActionGroup}>
                  {hasWebAccess ? (
                    <TouchableOpacity
                      style={styles.webLaunchPill}
                      onPress={() => handleLaunchWebUI(docker, webUiInfo)}
                      onLongPress={() => handleShowWebUiOptions(docker, webUiInfo)}
                      activeOpacity={0.7}
                    >
                      {openingDocker === docker.name ? (
                        <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 5 }} />
                      ) : (
                        <Globe size={13} color="#ffffff" style={{ marginRight: 5 }} />
                      )}
                      <Text style={styles.webLaunchPillText}>Web</Text>
                      <ExternalLink size={11} color="#ffffff" style={{ marginLeft: 3, opacity: 0.85 }} />
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    style={[styles.customConfigPill, hasCustomAlias && styles.customConfigPillActive]}
                    onPress={() => handleOpenAliasModal(docker, webUiInfo)}
                    activeOpacity={0.7}
                  >
                    <Sliders size={12} color={hasCustomAlias ? colors.accent : colors.sub} style={{ marginRight: 4 }} />
                    <Text style={[styles.customConfigPillText, hasCustomAlias && { color: colors.accent, fontWeight: 'bold' }]}>
                      {hasCustomAlias ? '已定制' : '定制'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* 容器操作按键群 */}
                <View style={styles.mgmtBtnGroup}>
                  <TouchableOpacity
                    style={styles.circleActionBtn}
                    onPress={() => openLogsModal(docker)}
                    activeOpacity={0.7}
                  >
                    <Terminal size={14} color={colors.accent} />
                  </TouchableOpacity>

                  {isRunning ? (
                    <TouchableOpacity
                      style={styles.circleActionBtn}
                      onPress={() => handleRestartDocker(docker.name)}
                      activeOpacity={0.7}
                    >
                      <RotateCw size={14} color={colors.sub} />
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    style={[styles.circleActionBtn, { backgroundColor: isRunning ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)' }]}
                    onPress={() => (isRunning ? handleStopDocker(docker.name) : handleStartDocker(docker.name))}
                    activeOpacity={0.7}
                  >
                    {isRunning ? (
                      <Power size={14} color={colors.red} />
                    ) : (
                      <Play size={14} color={colors.green} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}

        {processedDockers.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Box size={42} color={colors.muted} style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>未匹配到任何容器</Text>
            <Text style={styles.emptySub}>尝试切换上方筛选标签或搜索关键字</Text>
          </View>
        ) : null}
      </ScrollView>

      </View>
      )}

      {/* 4. 自定义反代配置弹窗 */}
      <Modal
        visible={aliasModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setAliasModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.aliasModalBox}>
            <View style={styles.aliasModalHeader}>
              <Text style={styles.aliasModalTitle}>
                自定义反代配置 · {targetDockerForAlias?.name || '容器'}
              </Text>
              <Text style={styles.aliasModalSub}>
                为该容器单独指定专属前缀简称（如 alist）或完整反代网址（如 https://alist.yourdomain.com）：
              </Text>
            </View>

            <View style={styles.aliasInputWrapper}>
              <TextInput
                style={styles.aliasTextInput}
                placeholder="例如：alist 或 https://custom.domain.com"
                placeholderTextColor={colors.muted}
                value={aliasInputValue}
                onChangeText={setAliasInputValue}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.aliasModalBtnRow}>
              <TouchableOpacity
                style={styles.aliasClearBtn}
                onPress={handleClearAlias}
              >
                <Text style={styles.aliasClearBtnText}>恢复默认</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.aliasCancelBtn}
                onPress={() => setAliasModalVisible(false)}
              >
                <Text style={styles.aliasCancelBtnText}>取消</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.aliasSaveBtn}
                onPress={handleSaveAlias}
              >
                <Text style={styles.aliasSaveBtnText}>保存规则</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 5. 实时容器日志流模态窗 */}
      <Modal
        visible={logModalVisible}
        animationType="slide"
        onRequestClose={() => setLogModalVisible(false)}
      >
        <View style={styles.logModalContainer}>
          <View style={styles.logHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.logTitle}>{selectedDocker ? `${selectedDocker.name} · 日志` : '容器日志'}</Text>
              <Text style={styles.logSub}>最近 200 行标准输出与错误流 (stdout/stderr)</Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                style={styles.logActionBtn}
                onPress={() => selectedDocker && fetchDockerLogs(selectedDocker.name)}
                disabled={logsLoading}
              >
                {logsLoading ? (
                  <ActivityIndicator size="small" color="#38bdf8" />
                ) : (
                  <RefreshCw size={16} color="#38bdf8" />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.logActionBtn, copiedToast && { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}
                onPress={copyAllLogs}
              >
                {copiedToast ? <Check size={16} color="#34d399" /> : <Copy size={16} color="#94a3b8" />}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.logActionBtn}
                onPress={() => setLogModalVisible(false)}
              >
                <X size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.logSearchBar}>
            <Search size={15} color="#64748b" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.logSearchInput}
              value={logSearchQuery}
              onChangeText={setLogSearchQuery}
              placeholder="过滤日志关键字..."
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {logSearchQuery ? (
              <TouchableOpacity onPress={() => setLogSearchQuery('')}>
                <X size={15} color="#64748b" />
              </TouchableOpacity>
            ) : null}
          </View>

          {copiedToast ? (
            <View style={styles.toastBox}>
              <Text style={styles.toastText}>✓ 日志已完整复制到剪贴板</Text>
            </View>
          ) : null}

          <ScrollView
            ref={logScrollRef}
            style={styles.logBody}
            contentContainerStyle={styles.logBodyContent}
            indicatorStyle="white"
          >
            {logsLoading && !logsContent ? (
              <View style={styles.logCenter}>
                <ActivityIndicator size="large" color="#38bdf8" style={{ marginBottom: 12 }} />
                <Text style={styles.logLoadingText}>正在拉取容器最新日志流...</Text>
              </View>
            ) : (
              <Text selectable={true} style={styles.logText}>
                {filteredLogs || (logSearchQuery ? '未找到符合关键字的日志项' : '暂无日志输出')}
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* 6. Modern Squircle Confirm Dialog */}
      
      {/* 5. Compose YAML 配置查看与编辑模态窗 */}
      <Modal
        visible={yamlModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setYamlModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalFullContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalFullHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalFullTitle}>
                {selectedComposeProject?.name} · YAML 配置
              </Text>
              <Text style={styles.modalFullSub} numberOfLines={1}>
                {selectedComposeProject?.yaml_file || 'docker-compose.yml'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setYamlModalVisible(false)}
            >
              <X size={18} color={colors.sub} />
            </TouchableOpacity>
          </View>

          {yamlLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>正在加载 Compose YAML 配置...</Text>
            </View>
          ) : (
            <ScrollView style={styles.yamlEditorScroll}>
              <TextInput
                style={styles.yamlTextInput}
                multiline={true}
                value={yamlContent}
                onChangeText={setYamlContent}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="YAML 配置为空"
                placeholderTextColor={colors.muted}
              />
            </ScrollView>
          )}

          <View style={styles.modalFullFooter}>
            <TouchableOpacity
              style={[styles.saveYamlBtn, yamlSaving && { opacity: 0.6 }]}
              onPress={saveYamlFile}
              disabled={yamlSaving || yamlLoading}
              activeOpacity={0.8}
            >
              {yamlSaving ? (
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 6 }} />
              ) : (
                <Check size={16} color="#ffffff" style={{ marginRight: 6 }} />
              )}
              <Text style={styles.saveYamlBtnText}>
                {yamlSaving ? '保存中...' : '保存配置文件'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 6. Compose 堆栈聚合日志模态窗 */}
      <Modal
        visible={composeLogsModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setComposeLogsModalVisible(false)}
      >
        <View style={styles.modalFullContainer}>
          <View style={styles.modalFullHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalFullTitle}>
                {selectedComposeProject?.name} · 堆栈日志
              </Text>
              <Text style={styles.modalFullSub}>
                聚合捕获各服务实时运行输出
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={styles.logActionBtn}
                onPress={() => selectedComposeProject && openComposeLogs(selectedComposeProject)}
                disabled={composeLogsLoading}
              >
                {composeLogsLoading ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <RefreshCw size={15} color={colors.accent} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.logActionBtn, composeLogsCopiedToast && { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}
                onPress={async () => {
                  try {
                    await Clipboard.setStringAsync(composeLogsContent);
                    setComposeLogsCopiedToast(true);
                    setTimeout(() => setComposeLogsCopiedToast(false), 2000);
                  } catch (e) {}
                }}
              >
                {composeLogsCopiedToast ? (
                  <Check size={15} color={colors.green} />
                ) : (
                  <Copy size={15} color={colors.sub} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setComposeLogsModalVisible(false)}
              >
                <X size={18} color={colors.sub} />
              </TouchableOpacity>
            </View>
          </View>

          {/* 日志内容滚动区 */}
          <ScrollView
            ref={composeLogScrollRef}
            style={styles.logsBody}
            contentContainerStyle={styles.logsBodyContent}
          >
            {composeLogsLoading && !composeLogsContent ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.loadingText}>正在获取 Compose 运行日志...</Text>
              </View>
            ) : (
              <Text selectable={true} style={styles.logsMonoText}>
                {composeLogsContent || '暂无容器输出日志'}
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* 7. 新建 Compose 堆栈模态窗 */}
      <Modal
        visible={newStackModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setNewStackModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalFullContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalFullHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalFullTitle}>新建 Docker Compose 堆栈</Text>
              <Text style={styles.modalFullSub}>创建多容器协同服务项目</Text>
            </View>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setNewStackModalVisible(false)}
            >
              <X size={18} color={colors.sub} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }}>
            <Text style={styles.fieldLabel}>堆栈名称 (英文/字母/连字符)</Text>
            <TextInput
              style={styles.modalTextInput}
              placeholder="例如：nextcloud, homarr, myapp"
              placeholderTextColor={colors.muted}
              value={newStackName}
              onChangeText={setNewStackName}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>docker-compose.yml 配置文件</Text>
            <View style={styles.yamlInputWrapper}>
              <TextInput
                style={styles.yamlTextInput}
                multiline={true}
                value={newStackYaml}
                onChangeText={setNewStackYaml}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </ScrollView>

          <View style={styles.modalFullFooter}>
            <TouchableOpacity
              style={[styles.saveYamlBtn, newStackCreating && { opacity: 0.6 }]}
              onPress={handleCreateNewStack}
              disabled={newStackCreating}
              activeOpacity={0.8}
            >
              {newStackCreating ? (
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 6 }} />
              ) : (
                <Plus size={16} color="#ffffff" style={{ marginRight: 6 }} />
              )}
              <Text style={styles.saveYamlBtnText}>
                {newStackCreating ? '创建中...' : '创建并保存堆栈'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ModernConfirmDialog
        visible={confirmDialog.visible}
        type={confirmDialog.type}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        showCancel={confirmDialog.showCancel}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const createStyles = (colors, isDark) => StyleSheet.create({
  tabBtnUpdateActive: {
    borderColor: '#f59e0b',
  },
  checkUpdatesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.12)' : 'rgba(56, 189, 248, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 4,
  },
  checkUpdatesText: {
    fontSize: 11,
    fontWeight: '600',
  },
  updatePillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f59e0b',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 6,
  },
  updatePillText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  categoryScroll: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  categoryPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9',
    marginRight: 6,
  },
  categoryPillActive: {
    backgroundColor: colors.accent,
  },
  categoryPillText: {
    fontSize: 12,
    color: colors.sub,
    fontWeight: '600',
  },
  categoryPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  appCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  appCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  appIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#f8fafc',
  },
  appIconFallback: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appIconFallbackText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  appNameText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
    flex: 1,
    marginRight: 8,
  },
  appCategoryBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  appCategoryText: {
    fontSize: 11,
    color: colors.accent,
    fontWeight: '600',
  },
  appAuthorText: {
    fontSize: 12,
    color: colors.sub,
    marginTop: 2,
  },
  appOverviewText: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
    marginBottom: 12,
  },
  appFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  appRepoTag: {
    flex: 1,
    marginRight: 12,
  },
  appRepoText: {
    fontSize: 11,
    color: colors.sub,
    fontFamily: 'monospace',
  },
  appInstallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  appInstallBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#ffffff',
  },

  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    color: colors.sub,
    fontSize: 14,
    marginTop: 12,
  },

  // Hero Stats Row
  heroRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  heroCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.2 : 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  heroLabel: {
    fontSize: 11,
    color: colors.sub,
    fontWeight: '600',
  },
  heroNum: {
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: -0.5,
  },

  // Filter Section
  filterSection: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    color: colors.textStrong,
    fontSize: 13,
    paddingVertical: 0,
  },
  filterScrollContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
    paddingRight: 16,
  },
  checkUpdateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: 'rgba(245, 158, 11, 0.4)',
    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : '#fffbeb',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  tabBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tabBtnText: {
    fontSize: 12,
    color: colors.sub,
    fontWeight: '600',
  },
  tabBtnTextActive: {
    color: '#ffffff',
  },
  sortToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardSecondary,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  sortToggleText: {
    fontSize: 11,
    color: colors.sub,
    fontWeight: '600',
  },

  // Content & Docker Cards
  content: {
    padding: 16,
    paddingTop: 6,
    paddingBottom: 32,
    gap: 12,
  },
  dockerCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.25 : 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardUpperTier: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  nameBlock: {
    flex: 1,
    marginRight: 8,
  },
  dockerTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 4,
  },
  metaBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusDotSmall: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  portBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.cardSecondary,
  },
  portBadgeText: {
    fontSize: 10,
    color: colors.sub,
    fontWeight: '500',
  },
  resourcePillsCol: {
    alignItems: 'flex-end',
  },
  resourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardSecondary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  resourcePillText: {
    fontSize: 10,
    fontWeight: '600',
  },

  // Action Bar (Lower Tier)
  cardLowerTier: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  webActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  webLaunchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  webLaunchPillText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  customConfigPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  customConfigPillActive: {
    borderColor: colors.accent,
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.12)' : '#e0f2fe',
  },
  customConfigPillText: {
    fontSize: 11,
    color: colors.sub,
    fontWeight: '600',
  },
  mgmtBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  circleActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 12,
    color: colors.sub,
  },

  // Custom Reverse Proxy Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  aliasModalBox: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  aliasModalHeader: {
    marginBottom: 14,
  },
  aliasModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 6,
  },
  aliasModalSub: {
    fontSize: 12,
    color: colors.sub,
    lineHeight: 17,
  },
  aliasInputWrapper: {
    backgroundColor: colors.input,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    justifyContent: 'center',
    marginBottom: 16,
  },
  aliasTextInput: {
    color: colors.textStrong,
    fontSize: 13,
  },
  aliasModalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  aliasClearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 'auto',
  },
  aliasClearBtnText: {
    color: colors.red,
    fontSize: 12,
    fontWeight: '600',
  },
  aliasCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.cardSecondary,
  },
  aliasCancelBtnText: {
    color: colors.sub,
    fontSize: 12,
    fontWeight: '600',
  },
  aliasSaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  aliasSaveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // Terminal Log Modal
  logModalContainer: {
    flex: 1,
    backgroundColor: isDark ? '#080d19' : '#f8fafc',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 16,
    paddingBottom: 14,
    backgroundColor: isDark ? '#0d1424' : '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  logTitle: {
    color: colors.textStrong,
    fontSize: 17,
    fontWeight: 'bold',
  },
  logSub: {
    color: colors.sub,
    fontSize: 12,
    marginTop: 2,
  },
  logActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: isDark ? '#151d2e' : '#f1f5f9',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? '#101726' : '#ffffff',
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  logSearchInput: {
    flex: 1,
    color: colors.textStrong,
    fontSize: 13,
    paddingVertical: 0,
  },
  toastBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  toastText: {
    color: colors.green,
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  logBody: {
    flex: 1,
    backgroundColor: isDark ? '#050811' : '#f1f5f9',
  },
  logBodyContent: {
    padding: 16,
    paddingBottom: 40,
  },
  logText: {
    color: isDark ? '#cbd5e1' : '#334155',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  logCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
  },
  logLoadingText: {
    color: colors.sub,
    fontSize: 13,
  },

  // 顶部分段器
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: colors.cardSecondary,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    padding: 3,
    borderRadius: 12,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 9,
  },
  segmentBtnActive: {
    backgroundColor: colors.accent,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.sub,
  },
  segmentBtnTextActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },

  // 容器更新徽章 (可直接点击升级)
  updateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  updateBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#f59e0b',
  },

  // Compose 英雄横幅
  composeHeroRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10,
  },
  composeHeroCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  composeHeroNum: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 2,
  },
  composeHeroLabel: {
    fontSize: 10,
    color: colors.sub,
  },

  // 新建堆栈按键
  newStackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
  },
  newStackBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#ffffff',
  },

  // Compose 卡片
  composeCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.2 : 0.04,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 10,
  },
  composeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  composeIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeCardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  composeCardPath: {
    fontSize: 10,
    color: colors.sub,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },
  composeStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  composeStatusBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  composeServicesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  composeServicesLabel: {
    fontSize: 11,
    color: colors.sub,
    marginRight: 6,
  },
  composeServiceTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    flex: 1,
  },
  composeServiceChip: {
    backgroundColor: colors.cardSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  composeServiceChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textStrong,
  },
  composeActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  composeConfigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.cardSecondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  composeConfigBtnText: {
    fontSize: 11,
    color: colors.accent,
    fontWeight: 'bold',
  },

  // 全屏模态窗通用
  modalFullContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalFullHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 20 : 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalFullTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textStrong,
  },
  modalFullSub: {
    fontSize: 11,
    color: colors.sub,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.cardSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalFullFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  saveYamlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: 12,
  },
  saveYamlBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  yamlEditorScroll: {
    flex: 1,
    backgroundColor: isDark ? '#080c18' : '#f8fafc',
    padding: 12,
  },
  yamlInputWrapper: {
    backgroundColor: isDark ? '#080c18' : '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 200,
    padding: 10,
    marginTop: 6,
  },
  yamlTextInput: {
    color: isDark ? '#38bdf8' : '#0369a1',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
    minHeight: 250,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textStrong,
    marginBottom: 6,
  },
  modalTextInput: {
    backgroundColor: colors.cardSecondary,
    color: colors.textStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  logActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.cardSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logsBody: {
    flex: 1,
    backgroundColor: isDark ? '#050811' : '#f1f5f9',
  },
  logsBodyContent: {
    padding: 16,
    paddingBottom: 40,
  },
  logsMonoText: {
    color: isDark ? '#cbd5e1' : '#334155',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },

});
