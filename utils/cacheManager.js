import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 缓存与下载目录管理工具
 *
 * - 预览缓存：存放在应用私有目录 preview_cache/ 下，可可靠地计算大小、按时间（LRU）清理
 * - 下载目录：用户可在设置中授权一个 SAF 目录（content:// URI）作为默认下载位置
 * - 缓存大小上限：默认 500MB，可在设置中实时调整；超过上限时自动删除最旧文件
 */

// AsyncStorage key
export const KEY_DOWNLOAD_DIR = '@download_dir';
export const KEY_DOWNLOAD_DIR_NAME = '@download_dir_name';
export const KEY_CACHE_LIMIT_MB = '@cache_limit_mb';

export const DEFAULT_CACHE_LIMIT_MB = 500;

// 预览缓存目录（应用私有，可在任意主题/权限下可靠读写）
const CACHE_DIR = () => FileSystem.documentDirectory + 'preview_cache/';

export const formatBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// 确保缓存目录存在
export const ensureCacheDir = async () => {
  try {
    const dir = CACHE_DIR();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    return dir;
  } catch (e) {
    // 目录已存在则忽略
    return CACHE_DIR();
  }
};

// 获取缓存目录路径
export const getCacheDirPath = () => CACHE_DIR();

// 获取缓存目录下所有文件（含 size 与 modificationTime）
export const getCacheFiles = async () => {
  try {
    const dir = await ensureCacheDir();
    const names = await FileSystem.readDirectoryAsync(dir);
    const files = [];
    for (const name of names) {
      try {
        const info = await FileSystem.getInfoAsync(dir + name);
        if (!info.isDirectory) {
          files.push({
            name,
            uri: dir + name,
            size: info.size || 0,
            mtime: info.modificationTime || 0,
          });
        }
      } catch (e) {}
    }
    return files;
  } catch (e) {
    return [];
  }
};

// 获取缓存总大小
export const getCacheSize = async () => {
  const files = await getCacheFiles();
  return files.reduce((sum, f) => sum + (f.size || 0), 0);
};

// 获取缓存上限（字节）
export const getCacheLimitBytes = async () => {
  try {
    const val = await AsyncStorage.getItem(KEY_CACHE_LIMIT_MB);
    const mb = val ? parseInt(val, 10) : DEFAULT_CACHE_LIMIT_MB;
    return (isNaN(mb) || mb <= 0 ? DEFAULT_CACHE_LIMIT_MB : mb) * 1024 * 1024;
  } catch (e) {
    return DEFAULT_CACHE_LIMIT_MB * 1024 * 1024;
  }
};

// 设置缓存上限（MB）
export const setCacheLimitMB = async (mb) => {
  const n = Math.max(1, parseInt(mb, 10) || DEFAULT_CACHE_LIMIT_MB);
  await AsyncStorage.setItem(KEY_CACHE_LIMIT_MB, String(n));
  return n;
};

// 删除单个缓存文件
export const deleteCacheFile = async (uri) => {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (e) {}
};

// 强制缓存不超上限：超过时按最旧优先（LRU）删除
export const enforceCacheLimit = async () => {
  const limit = await getCacheLimitBytes();
  const files = await getCacheFiles();
  let total = files.reduce((sum, f) => sum + (f.size || 0), 0);
  if (total <= limit) return;
  // 按修改时间升序（最旧的在前），逐个删除直到低于上限
  const sorted = [...files].sort((a, b) => (a.mtime || 0) - (b.mtime || 0));
  for (const f of sorted) {
    if (total <= limit) break;
    await deleteCacheFile(f.uri);
    total -= f.size || 0;
  }
};

// 清空缓存
export const clearCache = async () => {
  const dir = await ensureCacheDir();
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => []);
  for (const name of names) {
    await FileSystem.deleteAsync(dir + name, { idempotent: true }).catch(() => {});
  }
};

// ---------------- 下载目录 ----------------

// 获取下载目录信息
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

// 保存下载目录
export const setDownloadDir = async (uri, name) => {
  if (uri) {
    await AsyncStorage.setItem(KEY_DOWNLOAD_DIR, uri);
    await AsyncStorage.setItem(KEY_DOWNLOAD_DIR_NAME, name || '已授权目录');
  }
};

// 清除下载目录配置（恢复默认）
export const resetDownloadDir = async () => {
  await AsyncStorage.removeItem(KEY_DOWNLOAD_DIR);
  await AsyncStorage.removeItem(KEY_DOWNLOAD_DIR_NAME);
};