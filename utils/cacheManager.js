import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 缓存与下载目录管理工具 (v1.4.223 增强版)
 *
 * - 缓存位置：物理落盘在用户指定的下载目录下的 `temp/` 文件夹中（无论 SAF 还是本地目录）
 * - 本地沙盒：保留高速本地缓存供底层硬件渲染引擎（如 Android PdfRenderer）秒级读取
 * - 智能清理：支持实时计算占用、LRU 超额自动剔除最旧文件、一键物理清空
 */

// AsyncStorage keys
export const KEY_DOWNLOAD_DIR = '@download_dir';
export const KEY_DOWNLOAD_DIR_NAME = '@download_dir_name';
export const KEY_CACHE_LIMIT_MB = '@cache_limit_mb';

export const DEFAULT_CACHE_LIMIT_MB = 500;

// 应用内部高速渲染临时缓存目录
const LOCAL_CACHE_DIR = () => FileSystem.cacheDirectory + 'preview_cache/';

export const formatBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// ---------------- 下载目录管理 ----------------

/**
 * 获取用户配置的下载根目录信息
 */
export const getDownloadDir = async () => {
  try {
    const uri = await AsyncStorage.getItem(KEY_DOWNLOAD_DIR);
    const name = await AsyncStorage.getItem(KEY_DOWNLOAD_DIR_NAME);
    if (uri) return { uri, name: name || '已授权目录', configured: true };
  } catch (e) {}

  // 默认：应用私有 downloads 目录
  const dir = FileSystem.documentDirectory + 'downloads/';
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch (e) {}
  return { uri: dir, name: '默认下载目录', configured: false };
};

/**
 * 保存用户选择的下载目录
 */
export const setDownloadDir = async (uri, name) => {
  if (uri) {
    let cleanName = name || '已授权目录';
    // 若名称未指定，从 SAF URI 中解析更友好的目录名（如 Download）
    if (!name || name === '已授权目录') {
      try {
        const decoded = decodeURIComponent(uri);
        if (decoded.includes(':')) {
          const parts = decoded.split(':');
          const lastPart = parts[parts.length - 1];
          if (lastPart) cleanName = lastPart;
        }
      } catch (_) {}
    }
    await AsyncStorage.setItem(KEY_DOWNLOAD_DIR, uri);
    await AsyncStorage.setItem(KEY_DOWNLOAD_DIR_NAME, cleanName);

    // 立即确保该目录下创建好 temp/ 子目录
    try {
      await getTempDirInfo();
    } catch (_) {}
  }
};

/**
 * 清除下载目录配置（恢复为默认内置存储）
 */
export const resetDownloadDir = async () => {
  await AsyncStorage.removeItem(KEY_DOWNLOAD_DIR);
  await AsyncStorage.removeItem(KEY_DOWNLOAD_DIR_NAME);
};

// ---------------- 预览缓存 temp/ 目录管理 ----------------

/**
 * 获取并确保在用户指定的下载目录下存在 `temp/` 文件夹
 * @returns {Promise<{ isSaf: boolean, uri: string, parentUri: string, displayPath: string }>}
 */
export const getTempDirInfo = async () => {
  const dlDir = await getDownloadDir();

  // 1. Android SAF (content://) 目录处理
  if (dlDir.configured && dlDir.uri.startsWith('content://')) {
    try {
      const children = await FileSystem.StorageAccessFramework.readDirectoryAsync(dlDir.uri);
      let tempUri = children.find(c => {
        const dec = decodeURIComponent(c);
        return dec.endsWith('/temp') || dec.endsWith('%2Ftemp') || dec.endsWith(':temp');
      });

      if (!tempUri) {
        tempUri = await FileSystem.StorageAccessFramework.makeDirectoryAsync(dlDir.uri, 'temp');
      }

      return {
        isSaf: true,
        uri: tempUri,
        parentUri: dlDir.uri,
        displayPath: `${dlDir.name}/temp/`,
      };
    } catch (e) {
      console.warn('[cacheManager] SAF getTempDirInfo error:', e);
    }
  }

  // 2. 本地标准文件目录处理
  const base = dlDir.configured ? dlDir.uri.replace(/\/?$/, '/') : (FileSystem.documentDirectory + 'downloads/');
  const tempPath = base + 'temp/';
  try {
    const info = await FileSystem.getInfoAsync(tempPath);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(tempPath, { intermediates: true });
    }
  } catch (_) {}

  return {
    isSaf: false,
    uri: tempPath,
    parentUri: dlDir.uri,
    displayPath: `${dlDir.name}/temp/`,
  };
};

/**
 * 确保内部临时高速缓存目录存在
 */
export const ensureCacheDir = async () => {
  try {
    const dir = LOCAL_CACHE_DIR();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    // 同时唤醒用户指定下载目录下的 temp/ 结构
    getTempDirInfo().catch(() => {});
    return dir;
  } catch (e) {
    return LOCAL_CACHE_DIR();
  }
};

/**
 * 获取当前展示用的缓存路径描述
 */
export const getCacheDirPath = async () => {
  try {
    const info = await getTempDirInfo();
    return info.displayPath;
  } catch (e) {
    return 'temp/';
  }
};

/**
 * 将下载的文件保存/镜像到用户指定下载目录的 `temp/` 文件夹中
 */
export const saveToCache = async ({ fileName, localTempUri, mimeType = 'application/octet-stream' }) => {
  if (!fileName || !localTempUri) return;
  try {
    const tempInfo = await getTempDirInfo();

    if (tempInfo.isSaf) {
      // 在 SAF temp 目录下创建或覆盖文件
      const existingFiles = await FileSystem.StorageAccessFramework.readDirectoryAsync(tempInfo.uri).catch(() => []);
      const encodedName = encodeURIComponent(fileName);
      let targetFileUri = existingFiles.find(u => {
        const dec = decodeURIComponent(u);
        return dec.endsWith('/' + fileName) || dec.endsWith('%2F' + encodedName);
      });

      if (!targetFileUri) {
        targetFileUri = await FileSystem.StorageAccessFramework.createFileAsync(tempInfo.uri, fileName, mimeType);
      }

      const base64Data = await FileSystem.readAsStringAsync(localTempUri, { encoding: FileSystem.EncodingType.Base64 });
      await FileSystem.writeAsStringAsync(targetFileUri, base64Data, { encoding: FileSystem.EncodingType.Base64 });
    } else {
      // 普通本地文件目录：直接 copy
      const destUri = tempInfo.uri + encodeURIComponent(fileName);
      await FileSystem.copyAsync({ from: localTempUri, to: destUri });
    }

    // 触发 LRU 限制核验
    enforceCacheLimit().catch(() => {});
  } catch (e) {
    console.warn('[cacheManager] saveToCache error:', e);
  }
};

/**
 * 获取指定下载目录 temp/ 下所有缓存文件
 */
export const getCacheFiles = async () => {
  try {
    const tempInfo = await getTempDirInfo();
    const files = [];

    if (tempInfo.isSaf) {
      const uris = await FileSystem.StorageAccessFramework.readDirectoryAsync(tempInfo.uri).catch(() => []);
      for (const u of uris) {
        try {
          const info = await FileSystem.getInfoAsync(u);
          if (!info.isDirectory) {
            const decoded = decodeURIComponent(u);
            const nameParts = decoded.split('/');
            const rawName = nameParts[nameParts.length - 1] || 'cached_file';
            files.push({
              name: rawName,
              uri: u,
              size: info.size || 0,
              mtime: info.modificationTime || 0,
              isSaf: true,
            });
          }
        } catch (_) {}
      }
    } else {
      const names = await FileSystem.readDirectoryAsync(tempInfo.uri).catch(() => []);
      for (const name of names) {
        try {
          const filePath = tempInfo.uri + name;
          const info = await FileSystem.getInfoAsync(filePath);
          if (!info.isDirectory) {
            files.push({
              name,
              uri: filePath,
              size: info.size || 0,
              mtime: info.modificationTime || 0,
              isSaf: false,
            });
          }
        } catch (_) {}
      }
    }

    return files;
  } catch (e) {
    return [];
  }
};

/**
 * 获取缓存总大小
 */
export const getCacheSize = async () => {
  const files = await getCacheFiles();
  return files.reduce((sum, f) => sum + (f.size || 0), 0);
};

/**
 * 获取缓存上限（字节）
 */
export const getCacheLimitBytes = async () => {
  try {
    const val = await AsyncStorage.getItem(KEY_CACHE_LIMIT_MB);
    const mb = val ? parseInt(val, 10) : DEFAULT_CACHE_LIMIT_MB;
    return (isNaN(mb) || mb <= 0 ? DEFAULT_CACHE_LIMIT_MB : mb) * 1024 * 1024;
  } catch (e) {
    return DEFAULT_CACHE_LIMIT_MB * 1024 * 1024;
  }
};

/**
 * 设置缓存上限（MB）
 */
export const setCacheLimitMB = async (mb) => {
  const n = Math.max(1, parseInt(mb, 10) || DEFAULT_CACHE_LIMIT_MB);
  await AsyncStorage.setItem(KEY_CACHE_LIMIT_MB, String(n));
  return n;
};

/**
 * 删除单个缓存文件
 */
export const deleteCacheFile = async (uri) => {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (e) {}
};

/**
 * 强制缓存不超上限：超过时按最旧优先（LRU）删除
 */
export const enforceCacheLimit = async () => {
  const limit = await getCacheLimitBytes();
  const files = await getCacheFiles();
  let total = files.reduce((sum, f) => sum + (f.size || 0), 0);
  if (total <= limit) return;

  // 按修改时间升序（最旧在前），逐个删除直到低于上限
  const sorted = [...files].sort((a, b) => (a.mtime || 0) - (b.mtime || 0));
  for (const f of sorted) {
    if (total <= limit) break;
    await deleteCacheFile(f.uri);
    total -= f.size || 0;
  }
};

/**
 * 清空指定下载目录 temp/ 缓存及内部渲染临时文件
 */
export const clearCache = async () => {
  try {
    // 1. 清空用户指定的 temp/
    const tempInfo = await getTempDirInfo();
    if (tempInfo.isSaf) {
      const uris = await FileSystem.StorageAccessFramework.readDirectoryAsync(tempInfo.uri).catch(() => []);
      for (const u of uris) {
        await FileSystem.deleteAsync(u, { idempotent: true }).catch(() => {});
      }
    } else {
      const names = await FileSystem.readDirectoryAsync(tempInfo.uri).catch(() => []);
      for (const name of names) {
        await FileSystem.deleteAsync(tempInfo.uri + name, { idempotent: true }).catch(() => {});
      }
    }

    // 2. 清空应用私有渲染临时目录
    const localDir = LOCAL_CACHE_DIR();
    const localNames = await FileSystem.readDirectoryAsync(localDir).catch(() => []);
    for (const name of localNames) {
      await FileSystem.deleteAsync(localDir + name, { idempotent: true }).catch(() => {});
    }
  } catch (e) {
    console.warn('[cacheManager] clearCache error:', e);
  }
};