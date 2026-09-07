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

## 🛠️ 服务端部署指南（部署 `api.php`）

本项目附带的 `api.php` 是极简、单文件、无外部依赖的高性能 PHP 脚本，直接运行在 Unraid 的 WebGUI 环境中。

> [!IMPORTANT]
> **关于 Unraid 系统重启数据持久化说明**：
> Unraid 操作系统主体运行在内存虚拟盘（RAM Disk，`rootfs`）中。如果仅把 `api.php` 复制到 `/usr/local/emhttp/`，在 Unraid 重启后会被系统重置清空。因此推荐将文件存放在引导 U 盘 `/boot/` 并在开机启动脚本 `/boot/config/go` 中执行复制。

### 详细部署步骤：

#### 步骤 1：将 `api.php` 复制到 Unraid 引导 U 盘
使用 SSH 登录 Unraid 终端（或在 Unraid Web 界面右上角点击终端图标 Terminal），执行以下命令：

```bash
# 1. 在 U 盘配置目录创建存放文件夹
mkdir -p /boot/config/plugins/webgui

# 2. 将项目中的 api.php 下载或复制到该目录下
# 例如直接通过 curl 下载最新版本：
curl -k -o /boot/config/plugins/webgui/api.php https://raw.githubusercontent.com/wangzh6859/unraid2/main/api.php
```

#### 步骤 2：配置开机自动加载（防重启丢失）
编辑 Unraid 的开机启动文件 `/boot/config/go`：

```bash
nano /boot/config/go
```

在文件末尾追加以下两行并保存（Nano 中按 `Ctrl + O` 保存回车，`Ctrl + X` 退出）：

```bash
# 复制 API 脚本至 Web 根目录并赋予权限
cp /boot/config/plugins/webgui/api.php /usr/local/emhttp/api.php
chmod 755 /usr/local/emhttp/api.php
```

#### 步骤 3：立即手动生效（无需重启服务器）
在终端中直接运行一次上述复制命令：

```bash
cp /boot/config/plugins/webgui/api.php /usr/local/emhttp/api.php
chmod 755 /usr/local/emhttp/api.php
```

#### 步骤 4：配置 API 访问密钥（Token）
- **默认 Token**：`unraid2026`（已内置在 `api.php` 中）。
- **自定义 Token**（强烈推荐）：
  执行以下命令，将您的专属复杂密钥写入持久化配置文件：
  ```bash
  echo "MySuperSecretKey123" > /boot/config/plugins/unraid_api_token.txt
  ```
  App 填写该 Token 时即可通过验证。

#### 步骤 5：验证部署是否成功
在同一局域网的电脑或手机浏览器中打开：
```text
http://<你的Unraid服务器IP>/api.php?token=unraid2026&action=status
```
（若修改了自定义 Token，将 `unraid2026` 替换为您设置的 Token）

如果页面返回包含 `{"stats":...,"storage":...,"dockers":...}` 的 JSON 数据，即说明服务端已完全部署成功！

---

## 📱 移动端 App 使用说明

### 1. 首次配置
1. 安装最新版 APK（见下方 Release 下载）。
2. 打开 App，在欢迎页面或切换至「**设置**」页面。
3. 点击「**Unraid 服务器地址**」，输入服务器局域网 IP 或公网域名（例如 `http://192.168.1.100`，无需追加 `/api.php`）。
4. 点击「**API Token**」，输入在服务端设置的密钥（默认 `unraid2026`）。
5. 保存后立即全局生效，首页即可看到 CPU、内存与磁盘等实时监控数据。

### 2. 文件浏览与上传
1. 点击底部导航栏「**文件**」标签。
2. 默认进入 `/mnt/user`，可浏览您在 Unraid 中创建的所有共享文件夹（如 `downloads`、`appdata`、`Media` 等）。
3. **上传文件**：
   - **请先进入目标共享子文件夹**（例如点击进入 `/mnt/user/downloads`）。*（注：Unraid 的 shfs 用户共享机制要求文件必须归属于某个具体共享，不可直接存放于 `/mnt/user` 共享根目录下）*。
   - 点击右上角「**+**」号 -> 选择「**上传文件**」。
   - 从手机系统文件选择器中选取任意格式文件。
   - 上传任务将在悬浮传输面板中实时展示传输进度与瞬时速度，支持中断与重试。
   - 上传完成后，服务端将严格校验磁盘写入与文件大小，确认写入后弹出成功通知并自动刷新列表。

### 3. 存储阵列与 S.M.A.R.T. 深度健康诊断
- **阵列全景**：自动识别并展示 Parity 校验盘、数据盘（disk1、disk2...）与 NVMe/SATA 缓存盘（cache）。
- **物理硬件穿透**：告别虚拟的 `md1`、`md2` 映射，底层直通真实硬件块设备（如 `/dev/sdb`、`/dev/nvme0n1`）。
- **指标仪表盘**：直观呈现健康评估（PASSED）、设备型号、序列号、容量、当前温度、通电运行时间、05 重分配扇区数、C5 待处理扇区数、C7 CRC 传输错误及 NVMe 寿命磨损率。
- **原始诊断日志**：完整保留 `smartctl -a` 原始报告输出，支持双向横竖向流畅滑动查看完整属性表，支持长按自由选中文本复制。

### 4. 多媒体与文档即时预览
- **音视频**：点击 `.mp4` / `.mkv` / `.mp3` / `.flac` 等文件，自动调用硬件加速播放器，支持 HTTP 206 毫秒级拖动缓冲与外放声音。
- **文本/代码**：点击 `.txt` / `.md` / `.log` / `.json` 等文件，支持在线阅读（自动识别并转换 GBK/GB2312/UTF-8 编码），点击右上角「编辑」可直接修改内容并一键写回 Unraid 主机。
- **办公文档**：
  - `.docx`：免安装 Office 直接提取正文段落排版阅读。
  - `.doc`（老版本 Word）：自动检测并弹出友好提示，支持一键下载到手机使用 WPS / 微软 Office 打开。
  - `.xlsx` / `.xls`：多工作表标签切换与数据表格网格浏览。
  - `.epub`：自动解析章节目录并支持分章沉浸式翻页阅读。
  - `.zip` / `.tar`：直接查看压缩包内的文件目录，文本/图片可直接在压缩包内点击预览。

### 5. 远程电源控制
在「设置」页面的「服务器电源控制」卡片中：
- **重启服务器**：向服务器发送安全重启指令，二次确认后执行。
- **关闭服务器**：向服务器发送切断电源关机指令，关机后需物理按键或通过局域网唤醒（WOL）重新开机。

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