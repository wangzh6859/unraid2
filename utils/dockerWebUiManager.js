import AsyncStorage from '@react-native-async-storage/async-storage';

export const DOCKER_WEBUI_STORAGE_KEYS = {
  PROXY_ENABLED: '@docker_proxy_enabled',
  PROXY_TEMPLATE: '@docker_proxy_template',
  CUSTOM_ALIASES: '@docker_custom_aliases',
};

/**
 * 获取全局反代配置
 */
export async function getProxyConfig() {
  try {
    const [enabledVal, templateVal] = await Promise.all([
      AsyncStorage.getItem(DOCKER_WEBUI_STORAGE_KEYS.PROXY_ENABLED),
      AsyncStorage.getItem(DOCKER_WEBUI_STORAGE_KEYS.PROXY_TEMPLATE),
    ]);
    return {
      enabled: enabledVal === 'true',
      template: templateVal !== null ? templateVal.trim() : '',
    };
  } catch (e) {
    console.warn('[dockerWebUiManager] Failed to read proxy config:', e);
    return { enabled: false, template: '' };
  }
}

/**
 * 保存全局反代配置
 */
export async function saveProxyConfig({ enabled, template }) {
  try {
    const pairs = [];
    if (enabled !== undefined) {
      pairs.push([DOCKER_WEBUI_STORAGE_KEYS.PROXY_ENABLED, enabled ? 'true' : 'false']);
    }
    if (template !== undefined) {
      pairs.push([DOCKER_WEBUI_STORAGE_KEYS.PROXY_TEMPLATE, template.trim()]);
    }
    if (pairs.length > 0) {
      await AsyncStorage.multiSet(pairs);
    }
  } catch (e) {
    console.warn('[dockerWebUiManager] Failed to save proxy config:', e);
  }
}

/**
 * 获取所有容器的个性化别名/简称映射表
 * @returns {Promise<Object>} { [containerName]: aliasOrUrl }
 */
export async function getDockerAliases() {
  try {
    const json = await AsyncStorage.getItem(DOCKER_WEBUI_STORAGE_KEYS.CUSTOM_ALIASES);
    if (!json) return {};
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) {
    console.warn('[dockerWebUiManager] Failed to read docker aliases:', e);
    return {};
  }
}

/**
 * 保存单个容器的个性化简称或独立网址
 */
export async function saveDockerAlias(containerName, aliasOrUrl) {
  if (!containerName) return;
  try {
    const current = await getDockerAliases();
    const cleanValue = aliasOrUrl ? aliasOrUrl.trim() : '';
    if (cleanValue) {
      current[containerName] = cleanValue;
    } else {
      delete current[containerName];
    }
    await AsyncStorage.setItem(DOCKER_WEBUI_STORAGE_KEYS.CUSTOM_ALIASES, JSON.stringify(current));
  } catch (e) {
    console.warn('[dockerWebUiManager] Failed to save docker alias:', e);
  }
}

/**
 * 清除单个容器的个性化简称
 */
export async function removeDockerAlias(containerName) {
  if (!containerName) return;
  try {
    const current = await getDockerAliases();
    if (current[containerName]) {
      delete current[containerName];
      await AsyncStorage.setItem(DOCKER_WEBUI_STORAGE_KEYS.CUSTOM_ALIASES, JSON.stringify(current));
    }
  } catch (e) {
    console.warn('[dockerWebUiManager] Failed to remove docker alias:', e);
  }
}

/**
 * 清空所有容器个性化配置
 */
export async function clearAllDockerAliases() {
  try {
    await AsyncStorage.removeItem(DOCKER_WEBUI_STORAGE_KEYS.CUSTOM_ALIASES);
  } catch (e) {
    console.warn('[dockerWebUiManager] Failed to clear docker aliases:', e);
  }
}

/**
 * 依据模板格式化生成反代 URL
 * 支持替换 {name}、{name_lower}、{port}
 */
export function formatProxyUrl(template, name, port = '') {
  if (!template || !template.trim()) return '';
  let url = template.trim()
    .split('{name_lower}').join((name || '').toLowerCase())
    .split('{NAME_LOWER}').join((name || '').toLowerCase())
    .split('{name}').join(name || '')
    .split('{NAME}').join(name || '')
    .split('{port}').join(port || '')
    .split('{PORT}').join(port || '');

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url;
}

/**
 * 综合解析容器最终可访问的 WebUI 跳转地址
 * @param {Object} docker 容器数据对象 (含 name, port, webui 等)
 * @param {Object} proxyConfig 全局反代配置 { enabled, template }
 * @param {Object} aliases 个性化别名表 { [name]: aliasOrUrl }
 * @param {string} serverHost Unraid 服务器当前 Host（IP或主域名）
 * @returns {Object} {
 *   targetUrl: string,      // 最终建议跳转的 URL（优先反代/自定义，回退内网）
 *   rawInternalUrl: string, // 内网原始直连 URL (http://IP:端口)
 *   isCustom: boolean,      // 是否被单个容器个性化别名覆盖
 *   isProxy: boolean,       // 是否为反向代理生成的地址
 *   isFullUrl: boolean,     // 用户是否输入了独立完整 URL
 *   alias: string,          // 用户设置的简称或自定义文本
 * }
 */
export function resolveDockerWebUiUrl(docker, proxyConfig = {}, aliases = {}, serverHost = '') {
  if (!docker || !docker.name) {
    return { targetUrl: '', proxyUrl: '', rawInternalUrl: '', isCustom: false, isProxy: false, isFullUrl: false, alias: '' };
  }

  const name = docker.name;
  const primaryPort = docker.port || (typeof docker.ports === 'string' ? (docker.ports.match(/(\d+)/) ? docker.ports.match(/(\d+)/)[1] : '') : '') || '';

  // 1. 计算原始内网地址 (域名加端口)
  let rawInternalUrl = docker.webui || '';
  if (serverHost) {
    const cleanHost = serverHost.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:.*$/, '');
    if (!rawInternalUrl && primaryPort) {
      rawInternalUrl = `http://${cleanHost}:${primaryPort}`;
    } else if (rawInternalUrl) {
      rawInternalUrl = rawInternalUrl.replace(/\[IP\]/gi, cleanHost);
      if (primaryPort) {
        rawInternalUrl = rawInternalUrl.replace(/\[PORT:\d+\]/gi, primaryPort);
      }
    }
  }

  // 2. 检查是否有针对该容器的个性化简称或独立完整 URL
  const custom = aliases && aliases[name] ? String(aliases[name]).trim() : '';

  if (custom) {
    // 2.1 用户填了完整的独立网址 (以 http:// 或 https:// 开头)
    if (custom.startsWith('http://') || custom.startsWith('https://')) {
      return {
        targetUrl: custom,
        proxyUrl: custom,
        rawInternalUrl,
        isCustom: true,
        isProxy: true,
        isFullUrl: true,
        alias: custom,
      };
    }

    // 2.2 用户填了简称（如 "qb"、"webdav"、"emby"）
    if (proxyConfig && proxyConfig.template) {
      const proxyUrl = formatProxyUrl(proxyConfig.template, custom, primaryPort);
      return {
        targetUrl: proxyUrl,
        proxyUrl,
        rawInternalUrl,
        isCustom: true,
        isProxy: true,
        isFullUrl: false,
        alias: custom,
      };
    }

    return {
      targetUrl: rawInternalUrl,
      proxyUrl: '',
      rawInternalUrl,
      isCustom: true,
      isProxy: false,
      isFullUrl: false,
      alias: custom,
    };
  }

  // 3. 未设置个性化别名，检查是否开启了全局反向代理模板
  if (proxyConfig && proxyConfig.enabled && proxyConfig.template) {
    const proxyUrl = formatProxyUrl(proxyConfig.template, name, primaryPort);
    return {
      targetUrl: proxyUrl,
      proxyUrl,
      rawInternalUrl,
      isCustom: false,
      isProxy: true,
      isFullUrl: false,
      alias: '',
    };
  }

  // 4. 未开启反代模板，回退使用内网直连地址
  return {
    targetUrl: rawInternalUrl,
    proxyUrl: '',
    rawInternalUrl,
    isCustom: false,
    isProxy: false,
    isFullUrl: false,
    alias: '',
  };
}

// -------------------------------------------------------------
// 内网环境智能感知与自动分流器
// -------------------------------------------------------------
let cachedLanStatus = {
  isLan: null,
  timestamp: 0,
};

/**
 * 获取最近探测缓存（45 秒内有效）
 */
export function getCachedLanStatus() {
  const now = Date.now();
  if (cachedLanStatus.isLan !== null && (now - cachedLanStatus.timestamp < 45000)) {
    return cachedLanStatus.isLan;
  }
  return null;
}

/**
 * 获取最近探测缓存环境别名
 */
export function getCachedLanEnvironment() {
  return getCachedLanStatus();
}

/**
 * 手动更新内网状态缓存
 */
export function setCachedLanStatus(isLan) {
  cachedLanStatus = {
    isLan: !!isLan,
    timestamp: Date.now(),
  };
}

/**
 * 快速探测指定内网地址是否可直连（轻量超时，不阻断主线程）
 */
export async function probeLanReachable(probeUrl, timeoutMs = 600) {
  if (!probeUrl) return false;
  try {
    let controller = null;
    let timer = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timer = setTimeout(() => {
        try { controller.abort(); } catch (e) {}
      }, timeoutMs);
    }

    await fetch(probeUrl, {
      method: 'GET',
      signal: controller ? controller.signal : undefined,
      mode: 'no-cors',
      cache: 'no-store',
    });

    if (timer) clearTimeout(timer);
    setCachedLanStatus(true);
    return true;
  } catch (err) {
    setCachedLanStatus(false);
    return false;
  }
}

/**
 * 智能探测当前是否处于内网环境
 */
export async function detectLanEnvironment(serverUrl, timeoutMs = 800) {
  if (!serverUrl) return false;
  const cached = getCachedLanStatus();
  if (cached !== null) {
    return cached;
  }
  return await probeLanReachable(serverUrl, timeoutMs);
}

/**
 * 依据当前内网/外网环境，解析出容器 WebUI 综合访问信息
 * @param {Object} docker 容器数据对象
 * @param {string} serverUrl Unraid 服务器地址
 * @param {Object} proxyConfig 全局反代配置
 * @param {Object} aliases 个性化别名字典
 * @param {boolean|null} isLan 是否处于局域网/内网直连环境
 * @returns {Object}
 */
export function resolveDockerWebUrl(docker, serverUrl = '', proxyConfig = {}, aliases = {}, isLan = false) {
  if (!docker) {
    return {
      targetUrl: '',
      proxyUrl: '',
      rawInternalUrl: '',
      isCustom: false,
      isProxy: false,
      isFullUrl: false,
      alias: '',
    };
  }

  // 防御性参数适配：兼容 (docker, proxyConfig, aliases, serverHost) 的旧签名
  let realServerUrl = serverUrl;
  let realProxyConfig = proxyConfig;
  let realAliases = aliases;
  let realIsLan = isLan;

  if (serverUrl && typeof serverUrl === 'object') {
    realProxyConfig = serverUrl;
    realAliases = proxyConfig || {};
    realServerUrl = typeof aliases === 'string' ? aliases : '';
    realIsLan = typeof isLan === 'boolean' ? isLan : false;
  }

  const info = resolveDockerWebUiUrl(docker, realProxyConfig, realAliases, realServerUrl);
  const finalIsLan = realIsLan !== undefined && realIsLan !== null ? realIsLan : getCachedLanStatus();

  let targetUrl = info.targetUrl;
  if (finalIsLan === true) {
    targetUrl = info.rawInternalUrl || info.proxyUrl || info.targetUrl || '';
  } else if (finalIsLan === false) {
    targetUrl = info.proxyUrl || info.rawInternalUrl || info.targetUrl || '';
  }

  return {
    ...info,
    targetUrl: targetUrl || '',
  };
}

/**
 * 自动识别网络环境并返回目标 WebUI 访问链接：
 * - 内网环境：自动打开「域名加端口」
 * - 非内网环境：自动打开「反代地址」
 */
export async function resolveAutoWebUiUrl(webUiInfo) {
  if (!webUiInfo) return '';
  const internalUrl = webUiInfo.rawInternalUrl;
  const proxyUrl = webUiInfo.proxyUrl || (webUiInfo.isProxy || webUiInfo.isFullUrl ? webUiInfo.targetUrl : '');

  // 1. 若只存在其中一种地址，直接返回该地址
  if (!proxyUrl && internalUrl) return internalUrl;
  if (proxyUrl && !internalUrl) return proxyUrl;
  if (!proxyUrl && !internalUrl) return webUiInfo.targetUrl || '';

  // 2. 检查 45 秒内缓存状态，秒级响应
  const cached = getCachedLanStatus();
  if (cached === true) {
    return internalUrl;
  }
  if (cached === false) {
    return proxyUrl;
  }

  // 3. 发起 600ms 快速内网探测
  const isLan = await probeLanReachable(internalUrl, 600);
  return isLan ? internalUrl : proxyUrl;
}
