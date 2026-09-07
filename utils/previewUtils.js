/**
 * 富文档预览公共工具（docx / xlsx / epub / zip / tar / pdf 共用）
 *
 * - downloadToCache：把远端文件下载到预览缓存目录并触发 LRU 清理
 * - base64ToUint8 / base64ToArrayBuffer：base-64 解码（expo-file-system 的 Base64 读取为纯 base64 文本）
 * - stripHtml：抽取 html/xhtml 为可读纯文本（保留段落/换行）
 * - parseTar：简易 TAR（未压缩）条目解析：name / size / type / content
 */
import * as FileSystem from 'expo-file-system';
import base64 from 'base-64';
import { ensureCacheDir, enforceCacheLimit } from './cacheManager';

/** 下载到预览缓存目录，返回本地 uri（自动执行 LRU 清理） */
export const downloadToCache = async ({ file, getDirectUrl, authHeaders }) => {
  const dir = await ensureCacheDir();
  const localUri = dir + encodeURIComponent(file.name);
  const targetUrl = getDirectUrl ? getDirectUrl(file.path || file.href) : (file.url || file.href);
  const headers = (typeof authHeaders === 'function' ? authHeaders() : authHeaders) || {};
  const res = await FileSystem.downloadAsync(targetUrl, localUri, { headers });
  await enforceCacheLimit();
  return res.uri;
};

/** 读取本地文件内容为 base64 文本 */
export const readFileAsBase64 = async (localUri) =>
  FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });

/** base64 -> Uint8Array（把 base64 先解码为 binary string，再逐字节转换） */
export const base64ToUint8 = (b64) => {
  const bin = base64.decode(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

export const base64ToArrayBuffer = (b64) => base64ToUint8(b64).buffer;

/** 简单实体解码（&amp; &lt; &gt; &quot; &#39; &nbsp; &#dd; &#xhh;） */
export const decodeEntities = (s) => {
  if (!s) return '';
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
};

/**
 * 把 html / xhtml 抽取为纯文本：
 * 块级标签与 br 转成换行，script/style 内容剔除，实体解码，空行收敛。
 */
export const stripHtml = (html) => {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/table|\/blockquote)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
};

/** 解析 TAR（未压缩，POSIX ustar + GNU 长文件名基本支持）。返回 [{ name, size, isDir, data(Uint8Array|null) }] */
export const parseTar = (bytes) => {
  const entries = [];
  const BLOCK = 512;
  let offset = 0;
  let pendingLongName = null;
  const view = bytes; // Uint8Array
  const readString = (start, len) => {
    let end = start;
    const max = start + len;
    while (end < max && view[end] !== 0) end++;
    return decodeEntities(String.fromCharCode.apply(null, view.subarray(start, end)));
  };
  const readOctal = (start, len) => parseInt(readString(start, len).trim().replace(/[^0-7]/g, '') || '0', 8) || 0;
  while (offset + BLOCK <= view.length) {
    // 全 0 块 = 结束标记
    let allZero = true;
    for (let i = offset; i < offset + BLOCK; i++) { if (view[i] !== 0) { allZero = false; break; } }
    if (allZero) break;
    let name = readString(offset, 100);
    const size = readOctal(offset + 124, 12);
    const typeFlag = String.fromCharCode(view[offset + 156]);
    const prefix = readString(offset + 345, 155);
    if (prefix) name = prefix + '/' + name;
    const dataStart = offset + BLOCK;
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    // GNU 长文件名：数据区即完整文件名，紧随其后是真正条目（名称为空）
    if (typeFlag === 'L' || typeFlag === 'K') {
      pendingLongName = readString(dataStart, size);
    } else if (name) {
      let finalName = pendingLongName || name;
      pendingLongName = null;
      const isDir = typeFlag === '5';
      let data = null;
      if (!isDir && size > 0 && size <= 20 * 1024 * 1024) {
        data = view.slice(dataStart, dataStart + size);
      }
      entries.push({ name: finalName, size, isDir, data });
    } else {
      pendingLongName = null;
    }
    offset = dataStart + padded;
  }
  return entries;
};

/** 文件名扩展名小写 */
export const extOf = (name) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
};
