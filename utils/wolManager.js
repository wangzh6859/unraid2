import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { WakeOnLan } = NativeModules;

export const WOL_STORAGE_KEYS = {
  MAC: '@server_mac_address',
  BROADCAST_IP: '@server_broadcast_ip',
  PORT: '@server_wol_port',
};

/**
 * 获取本地缓存的 WOL 配置
 */
export async function getWolConfig() {
  try {
    const [mac, broadcastIp, port] = await Promise.all([
      AsyncStorage.getItem(WOL_STORAGE_KEYS.MAC),
      AsyncStorage.getItem(WOL_STORAGE_KEYS.BROADCAST_IP),
      AsyncStorage.getItem(WOL_STORAGE_KEYS.PORT),
    ]);
    return {
      mac: mac ? mac.trim().toUpperCase() : '',
      broadcastIp: broadcastIp ? broadcastIp.trim() : '255.255.255.255',
      port: port ? parseInt(port, 10) : 9,
    };
  } catch (e) {
    console.warn('[WOL] Failed to get WOL config:', e);
    return {
      mac: '',
      broadcastIp: '255.255.255.255',
      port: 9,
    };
  }
}

/**
 * 持久化保存 WOL 配置
 */
export async function saveWolConfig({ mac, broadcastIp, port }) {
  try {
    const pairs = [];
    if (mac !== undefined) pairs.push([WOL_STORAGE_KEYS.MAC, mac.trim().toUpperCase()]);
    if (broadcastIp !== undefined) pairs.push([WOL_STORAGE_KEYS.BROADCAST_IP, broadcastIp.trim()]);
    if (port !== undefined) pairs.push([WOL_STORAGE_KEYS.PORT, String(port)]);
    if (pairs.length > 0) {
      await AsyncStorage.multiSet(pairs);
    }
  } catch (e) {
    console.warn('[WOL] Failed to save WOL config:', e);
  }
}

/**
 * 校验 MAC 地址格式是否合法 (12 位 16 进制，支持冒号或连字符分隔)
 */
export function isValidMacAddress(mac) {
  if (!mac || typeof mac !== 'string') return false;
  const clean = mac.replace(/[^0-9A-Fa-f]/g, '');
  return clean.length === 12;
}

/**
 * 格式化 MAC 地址为标准 XX:XX:XX:XX:XX:XX 形式
 */
export function formatMacAddress(mac) {
  if (!mac) return '';
  const clean = mac.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (clean.length !== 12) return mac;
  return clean.match(/.{1,2}/g).join(':');
}

/**
 * 向目标 Unraid 服务器发送 Wake-on-LAN 唤醒魔术包
 * @param {string} targetMac
 * @param {string} [broadcastIp]
 * @param {number} [port]
 */
export async function sendWakeOnLanPacket(targetMac, broadcastIp = '255.255.255.255', port = 9) {
  if (Platform.OS !== 'android') {
    throw new Error('网络唤醒 (WOL) 功能目前仅在 Android 原生客户端上可用');
  }

  if (!WakeOnLan || !WakeOnLan.sendWakeOnLan) {
    throw new Error('WOL 原生模块未加载，请确认已升级至支持 WOL 的最新客户端');
  }

  if (!targetMac || !isValidMacAddress(targetMac)) {
    throw new Error('未提供有效的目标物理 MAC 地址，请前往【设置】检查并填写');
  }

  const cleanIp = broadcastIp && broadcastIp.trim() !== '' ? broadcastIp.trim() : '255.255.255.255';
  const cleanPort = port > 0 && port <= 65535 ? port : 9;

  return await WakeOnLan.sendWakeOnLan(targetMac.trim(), cleanIp, cleanPort);
}
