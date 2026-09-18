import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

/**
 * 缓存与下载目录管理工具 (v1.4.224 工业级隔离加固版)
 *
 * 【用户核心诉求】：
 * 1. 缓存文件必须存放在用户指定的下载目录下的 `temp/` 文件夹中，不能放在下载根目录下；
 * 2. 清理缓存时，仅能删除下载目录下 `temp/` 文件夹中的文件，绝对不能删除 temp 文件夹本身，绝对不能删除下载目录本身，绝对不能误删下载根目录中的任何文件；
 * 3. 完美结合 Android 原生 SafCacheModule (DocumentFile) 与严格的路径白名单防护，根绝 SAF 根目录遍历删除缺陷。
 */

// AsyncStorage keys
export const KEY_DOWNLOAD_DIR = '@download_dir';
export const KEY_DOWNLOAD_DIR_NAME = '@download_dir_name';
export const KEY_CACHE_LIMIT_MB = '@cache_limit_mb';

export const DEFAULT_CACHE_LIMIT_MB = 500;

// 应用内部高速渲染临时缓存目录
const LOCAL_CACHE_DIR = () => FileSystem.cacheDirectory + 'preview_cache/';

const SafCache = NativeModules.SafCache;
const isSafCacheAvailable = () => Platform.OS === 'android' && Boolean(SafCache && typeof SafCache.clearTempDir === 'function');

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

    // 预热/确保 temp 目录就绪
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
 * 获取 temp 目录信息与展示路径
 */
export const getTempDirInfo = async () => {
  const dlDir = await getDownloadDir();
  return {
    isSaf: dlDir.configured && dlDir.uri.startsWith('content://'),
    uri: dlDir.uri,
    parentUri: dlDir.uri,
    displayPath: `${dlDir.name}/temp/`,
  };
};

/**
 * 确保内部临时高速渲染缓存目录存在
 */
export const ensureCacheDir = async () => {
  try {
    const dir = LOCAL_CACHE_DIR();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    return dir;
  } catch (e) {
    return LOCAL_CACHE_DIR();
  }
};

/**
 * 获取当前展示用的缓存路径描述（例如 "Download/temp/"）
 */
export const getCacheDirPath = async () => {
  try {
    const dlDir = await getDownloadDir();
    return `${dlDir.name}/temp/`;
  } catch (e) {
    return 'temp/';
  }
};

/**
 * 将预览文件物理镜像保存到用户指定下载目录的 `temp/` 文件夹中
 * 绝不直接放在下载根目录，必须精准进入子文件夹 temp/
 */
export const saveToCache = async ({ fileName, localTempUri, mimeType = 'application/octet-stream' }) => {
  if (!fileName || !localTempUri) return;
  try {
    const dlDir = await getDownloadDir();

    if (isSafCacheAvailable()) {
      // 通过原生 DocumentFile 精准写入 <下载目录>/temp/
      await SafCache.saveFileToTempDir(dlDir.uri, fileName, localTempUri);
    } else {
      // 标准本地文件系统分支
      const base = dlDir.configured ? dlDir.uri.replace(/\/?$/, '/') : (FileSystem.documentDirectory + 'downloads/');
      const tempDir = base + 'temp/';
      const dirInfo = await FileSystem.getInfoAsync(tempDir).catch(() => null);
      if (!dirInfo || !dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => {});
      }
      const destUri = tempDir + encodeURIComponent(fileName);
      await FileSystem.copyAsync({ from: localTempUri, to: destUri });
    }

    // 触发缓存超限清理
    enforceCacheLimit().catch(() => {});
  } catch (e) {
    console.warn('[cacheManager] saveToCache error:', e);
  }
};

/**
 * 获取指定下载目录 temp/ 下的所有缓存文件（绝不遍历或返回下载根目录中的任何文件）
 */
export const getCacheFiles = async () => {
  try {
    const dlDir = await getDownloadDir();

    if (isSafCacheAvailable()) {
      const list = await SafCache.listTempFiles(dlDir.uri);
      return (list || []).map(f => ({
        name: f.name || 'cached_file',
        uri: f.uri,
        size: f.size || 0,
        mtime: f.mtime || 0,
      }));
    }

    // 标准本地文件系统分支
    const base = dlDir.configured ? dlDir.uri.replace(/\/?$/, '/') : (FileSystem.documentDirectory + 'downloads/');
    const tempDir = base + 'temp/';
    const dirInfo = await FileSystem.getInfoAsync(tempDir).catch(() => null);
    if (!dirInfo || !dirInfo.exists || !dirInfo.isDirectory) {
      return [];
    }

    const names = await FileSystem.readDirectoryAsync(tempDir).catch(() => []);
    const files = [];
    for (const name of names) {
      try {
        const filePath = tempDir + name;
        const info = await FileSystem.getInfoAsync(filePath);
        if (!info.isDirectory) {
          files.push({
            name,
            uri: filePath,
            size: info.size || 0,
            mtime: info.modificationTime || 0,
          });
        }
      } catch (_) {}
    }
    return files;
  } catch (e) {
    console.warn('[cacheManager] getCacheFiles error:', e);
    return [];
  }
};

/**
 * 获取缓存总大小（字节）
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
 * 删除单个缓存文件（LRU 轮转清理）
 */
export const deleteCacheFile = async (uri) => {
  if (!uri) return;
  try {
    if (isSafCacheAvailable()) {
      await SafCache.deleteTempFile(uri);
    } else {
      const info = await FileSystem.getInfoAsync(uri).catch(() => null);
      if (info && info.exists && !info.isDirectory) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    }
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
 * 清空预览缓存（核心安全加固）：
 *
 * 1. 严密边界隔离：仅删除用户指定下载目录下的 `temp/` 文件夹内部的文件；
 * 2. 绝对禁止删除 `temp/` 文件夹本身；
 * 3. 绝对禁止删除用户下载目录本身，绝不触碰下载目录中的任何正式文件；
 * 4. 同步清空应用私有沙盒 preview_cache/ 中的渲染临时文件。
 */
export const clearCache = async () => {
  try {
    const dlDir = await getDownloadDir();

    // 1. 清空指定下载目录 temp/ 文件夹内部的文件
    if (isSafCacheAvailable()) {
      await SafCache.clearTempDir(dlDir.uri);
    } else {
      // 本地文件系统模式严格防护
      const base = dlDir.configured ? dlDir.uri.replace(/\/?$/, '/') : (FileSystem.documentDirectory + 'downloads/');
      const tempDir = base + 'temp/';
      const dirInfo = await FileSystem.getInfoAsync(tempDir).catch(() => null);
      if (dirInfo && dirInfo.exists && dirInfo.isDirectory) {
        const names = await FileSystem.readDirectoryAsync(tempDir).catch(() => []);
        for (const name of names) {
          const filePath = tempDir + name;
          // 绝对路径与特征安全校验：
          // 只有包含 /temp/，且既不是 tempDir 本身也不是父目录，且确认是文件时才删除！
          if (filePath.includes('/temp/') && !filePath.endsWith('/temp') && !filePath.endsWith('/temp/')) {
            const fInfo = await FileSystem.getInfoAsync(filePath).catch(() => null);
            if (fInfo && !fInfo.isDirectory) {
              await FileSystem.deleteAsync(filePath, { idempotent: true }).catch(() => {});
            }
          }
        }
      }
    }

    // 2. 清空内部高速渲染临时目录中的中间文件
    const localDir = LOCAL_CACHE_DIR();
    const localInfo = await FileSystem.getInfoAsync(localDir).catch(() => null);
    if (localInfo && localInfo.exists && localInfo.isDirectory) {
      const localNames = await FileSystem.readDirectoryAsync(localDir).catch(() => []);
      for (const name of localNames) {
        const localFilePath = localDir + name;
        if (!localFilePath.endsWith('/preview_cache') && !localFilePath.endsWith('/preview_cache/')) {
          await FileSystem.deleteAsync(localFilePath, { idempotent: true }).catch(() => {});
        }
      }
    }

    // 3. 同时调用原生 PdfRenderer.clearCache() 释放光栅化生成的临时位图
    if (NativeModules.PdfRenderer && typeof NativeModules.PdfRenderer.clearCache === 'function') {
      NativeModules.PdfRenderer.clearCache().catch(() => {});
    }
  } catch (e) {
    console.warn('[cacheManager] clearCache error:', e);
  }
};