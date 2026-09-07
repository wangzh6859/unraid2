# Unraid Mobile Manager

一个用于远程全能掌控与监控 **Unraid NAS 服务器** 的现代化移动端应用（基于 **Expo / React Native**）。

通过统一的 API Token 接入 Unraid 服务器，实现系统状态实时监控、远程管理 Docker 容器与虚拟机、阵列物理磁盘健康度诊断、**服务器远程安全重启与关机控制**、**原生高性能文件管理与 HTTP 206 分片流式即时媒体播放**，无需搭建额外繁琐的 WebDAV 服务！

---

## ✨ 核心特性

| 模块 | 说明 |
|------|------|
| 📊 **仪表盘监控** | 实时监控 CPU / GPU / 内存 / 网络上下行速率，阵列存储使用率，Docker 与 VM 概览 |
| ⚡ **电源管理** | 软件端远程安全**重启 (Reboot)** 与**彻底关机 (Poweroff)**，具备防误触二次确认与状态反馈 |
| 🐳 **Docker 管理** | 容器列表（按名称 / 状态 / CPU 排序），一键启动 / 停止 / 重启容器，实时轮询 |
| 🖥️ **虚拟机管理** | 启动 / 停止 / 重启虚拟机，按名称或运行状态排序 |
| 💾 **存储与健康** | 每块物理硬盘的状态、温度、S.M.A.R.T. 健康度、容量利用率，故障盘自动高亮警示并查看诊断日志 |
| 📁 **统一文件管理** | 彻底弃用 WebDAV，直通 Unraid 统一 API：毫秒级目录浏览、多级面包屑、搜索过滤、排序、新建文件夹、重命名、单选/多选批量操作（下载/移动/复制/彻底删除） |
| 🎬 **全能文件即时预览** | **视频播放器**（HTTP 206 分片流式播放，秒开即播，毫秒级拖动进度条，画幅切换）；<br>**音频播放器**（黑胶唱片旋转动画，高保真无损流，倍速调节，单曲循环）；<br>**高保真图片查看器**（多点触控平移双指缩放、双击放大、分辨率指示）；<br>**代码/文本阅读与编辑器**（行号高亮、缩放、换行、实时在线编辑并写回服务器）；<br>**文档与电子书**（Word docx、Excel xlsx、Epub 电子书、ZIP/TAR 压缩包内嵌浏览解包） |
| 🚀 **传输任务管理** | 原生多任务上传/下载中心，实时百分比与传输速率显示，支持**中断/暂停上传**、**继续/重试上传**、**单条记录滑动删除**与**一键清理已完成** |
| 🔄 **实时配置热同步** | 在「设置」页修改服务器连接地址或 API Token 后即时全应用生效，无需手动断开重连 |
| 🎨 **个性化与主题** | 沉浸式深色 / 浅色主题一键切换，系统状态栏无缝跟随适配 |
| 🛡️ **安全沙盒 (SAF)** | 自定义下载存储位置（Android Storage Access Framework 严格授权目录隔离）与 LRU 智能缓存上限清理 |

---

## 🛠️ 服务端部署（部署 `api.php`）

本项目已附带极简无外部依赖的后端脚本 `api.php`。

### 部署步骤：

1. 将仓库根目录下的 `api.php` 复制到您的 Unraid 服务器 Web 根目录（例如 `/usr/local/emhttp/` 或放在自建 Nginx/Apache 容器/网站目录下）。
2. 配置您的 API Token：
   - 方式一：直接在 `api.php` 顶部修改 `FALLBACK_TOKEN` 常量（默认 `unraid2026`）。
   - 方式二：在 Unraid 终端中执行 `echo "your_secure_token" > /boot/config/plugins/unraid_api_token.txt`，重启不丢失。
3. 打开手机 App，进入「设置」页输入服务器地址（如 `http://192.168.1.100`）与 API Token，即可畅享所有监控、文件管理与电源控制功能！

---

## 📦 技术栈

- **[Expo](https://expo.dev)** `~50.0.0` — 跨平台移动端引擎
- **React Native** `0.73.4` + **React** `18.2.0`
- **@react-navigation** — 原生多堆栈导航器
- **expo-av** — 原生硬件加速流式音视频引擎（支持 RFC 7233 HTTP 206 Partial Content）
- **expo-file-system** — 原生流式分块上传任务与 SAF 沙盒访问
- **lucide-react-native** — 现代化图标库
- **jszip** / **xlsx** — 客户端轻量解包与电子表格渲染
- **@react-native-async-storage/async-storage** — 本地配置持久化

---

## 🚀 快速开始与编译

### 本地调试：
```bash
# 1. 安装依赖
npm install

# 2. 启动 Expo 开发服务
npx expo start
```

### GitHub Actions 自动化编译 APK：
推送代码至 `main` 分支后，GitHub Actions 会自动触发 `.github/workflows/build-apk.yml` 流水线，完成 Android Release APK 的预构建、Gradle 编译、秘钥签名并自动发布到 GitHub Releases。