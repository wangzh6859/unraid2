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
    return { targetUrl: '', rawInternalUrl: '', isCustom: false, isProxy: false, isFullUrl: false, alias: '' };
  }

  const name = docker.name;
  const primaryPort = docker.port || '';

  // 1. 计算原始内网地址
  let rawInternalUrl = docker.webui || '';
  if (!rawInternalUrl && primaryPort && serverHost) {
    // 若 serverHost 包含协议头先剥离
    const cleanHost = serverHost.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:.*$/, '');
    rawInternalUrl = `http://${cleanHost}:${primaryPort}`;
  }

  // 2. 检查是否有针对该容器的个性化简称或独立完整 URL
  const custom = aliases && aliases[name] ? String(aliases[name]).trim() : '';

  if (custom) {
    // 2.1 用户填了完整的独立网址 (以 http:// 或 https:// 开头)
    if (custom.startsWith('http://') || custom.startsWith('https://')) {
      return {
        targetUrl: custom,
        rawInternalUrl,
        isCustom: true,
        isProxy: false,
        isFullUrl: true,
        alias: custom,
      };
    }

    // 2.2 用户填了简称（如 "qb"、"tr"、"emby"）
    // 如果配置了全局反代模板，将该简称代入模板生成 URL
    if (proxyConfig && proxyConfig.template) {
      const targetUrl = formatProxyUrl(proxyConfig.template, custom, primaryPort);
      return {
        targetUrl,
        rawInternalUrl,
        isCustom: true,
        isProxy: true,
        isFullUrl: false,
        alias: custom,
      };
    }

    // 没有全局模板时，简称无处代入，回退内网地址
    return {
      targetUrl: rawInternalUrl,
      rawInternalUrl,
      isCustom: true,
      isProxy: false,
      isFullUrl: false,
      alias: custom,
    };
  }

  // 3. 未设置个性化别名，检查是否开启了全局反向代理模板
  if (proxyConfig && proxyConfig.enabled && proxyConfig.template) {
    const targetUrl = formatProxyUrl(proxyConfig.template, name, primaryPort);
    return {
      targetUrl,
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
    rawInternalUrl,
    isCustom: false,
    isProxy: false,
    isFullUrl: false,
    alias: '',
  };
}
