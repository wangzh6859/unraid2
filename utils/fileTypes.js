/**
 * 文件类型识别模块（即时阅读器 / 播放器共用）
 *
 * 集中管理"扩展名 -> 预览方式"的映射，避免散落在各页面里的正则难以维护。
 * 分类优先级：text(可编辑) > image > video > audio > other(仅下载)。
 * 注意：能否真正解码取决于设备平台（Android=ExoPlayer / iOS=AVPlayer），
 * 这里尽量扩大识别面，不能解码的格式由播放器 onError 给出提示并引导下载。
 */

const TEXT_EXTS = new Set([
  // 纯文本 / 日志
  'txt', 'text', 'log', 'nfo', 'me', 'md', 'markdown', 'rst', 'adoc', 'asciidoc', 'org',
  'csv', 'tsv', 'tab', 'dif', 'diff', 'patch', 'reg', 'ics', 'vcf',
  // 代码 / 脚本
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'qml',
  'py', 'pyw', 'ipynb', 'rb', 'php', 'phtml', 'pl', 'pm', 't', 'r', 'lua',
  'java', 'kt', 'kts', 'scala', 'groovy', 'gradle', 'clj', 'cljs', 'cljc',
  'c', 'h', 'cc', 'cpp', 'cxx', 'c++', 'hh', 'hpp', 'hxx', 'cs', 'm', 'mm', 'swift',
  'go', 'rs', 'dart', 'fs', 'fsx', 'ex', 'exs', 'erl', 'hrl', 'hs', 'lhs', 'lisp', 'el', 'scm', 'cl',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'awk', 'sed',
  // 标记 / 模板 / 样式
  'html', 'htm', 'xhtml', 'xml', 'xsl', 'xslt', 'svg', 'svgz', 'css', 'scss', 'sass', 'less', 'styl',
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'cnf', 'config',
  'properties', 'env', 'lock', 'editorconfig', 'gitignore', 'dockerignore',
  // 数据库 / 查询
  'sql', 'graphql', 'gql', 'prisma',
  // 文档（文本化子集，可编辑）
  'tex', 'bib', 'latex', 'ltx',
  // 字幕 / 歌词（可当文本编辑）
  'srt', 'ass', 'ssa', 'vtt', 'sub', 'lrc',
]);

const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'png', 'apng', 'gif', 'webp', 'bmp', 'dib', 'ico',
  'tif', 'tiff', 'heic', 'heif', 'avif', 'jxl', 'psd', 'xcf', 'raw', 'cr2', 'nef', 'arw',
]);

const VIDEO_EXTS = new Set([
  'mp4', 'm4v', 'mkv', 'webm', 'mov', 'qt', 'avi', '3gp', '3g2', 'mpg', 'mpeg', 'mpe', 'm2v',
  'ts', 'm2ts', 'mts', 'tp', 'ogv', 'ogm', 'wmv', 'asf', 'divx', 'flv', 'f4v', 'vob', 'rm', 'rmvb', 'mxf',
]);

const AUDIO_EXTS = new Set([
  'mp3', 'mp2', 'mp1', 'wav', 'wave', 'aac', 'm4a', 'm4b', 'flac', 'alac', 'ogg', 'oga', 'opus',
  'wma', 'ape', 'aiff', 'aif', 'aifc', 'caf', 'amr', 'awb', 'mid', 'midi', 'ac3', 'dts', 'mka', 'wv', 'tta', 'tak', 'ra', 'ram',
]);

// 新增可在线预览的富文档/容器格式（见 components/previewers/）
const PDF_EXTS = new Set(['pdf']);
const DOCX_EXTS = new Set(['docx', 'docm', 'dotx']);
const DOC_EXTS = new Set(['doc', 'dot', 'wps']);
const SHEET_EXTS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb']);
const EBOOK_EXTS = new Set(['epub']);
const ARCHIVE_EXTS = new Set(['zip', 'tar']);

const EXT_RE = /\.([A-Za-z0-9]+)$/;

/**
 * 根据文件名返回预览分类：
 * 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'docx' | 'doc' | 'sheet' | 'ebook' | 'archive' | 'other'
 * （'folder' 由调用方通过 isFolder 判断，这里不处理）
 */
export const getFileKind = (name) => {
  if (!name || typeof name !== 'string') return 'other';
  const m = name.trim().toLowerCase().match(EXT_RE);
  if (!m) return 'other';
  const ext = m[1];
  if (TEXT_EXTS.has(ext)) return 'text';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (DOCX_EXTS.has(ext)) return 'docx';
  if (DOC_EXTS.has(ext)) return 'doc';
  if (SHEET_EXTS.has(ext)) return 'sheet';
  if (EBOOK_EXTS.has(ext)) return 'ebook';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  return 'other';
};

export const isTextFile = (name) => getFileKind(name) === 'text';
export const isImageFile = (name) => getFileKind(name) === 'image';
export const isVideoFile = (name) => getFileKind(name) === 'video';
export const isAudioFile = (name) => getFileKind(name) === 'audio';
