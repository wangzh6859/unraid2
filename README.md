# unraid-mobile-app

一个用于远程管理和监控 **Unraid NAS 服务器** 的移动端应用（基于 **Expo / React Native**）。

通过 API Token 接入 Unraid 服务器，实时监控系统状态，远程管理 Docker 容器与虚拟机，浏览服务器文件（支持 WebDAV / AList），并查看磁盘 S.M.A.R.T. 诊断报告。

---

## ✨ 功能特性

| 模块 | 说明 |
|------|------|
| 📊 **仪表盘** | 实时监控 CPU / GPU / 内存 / 网络上下行速度，阵列存储使用率，Docker 与 VM 概览 |
| 🐳 **Docker 管理** | 容器列表（按名称 / 状态 / CPU 排序），一键启动 / 停止 / 重启容器，实时刷新 |
| 🖥️ **虚拟机管理** | 启动 / 停止 / 重启虚拟机，按名称或运行状态排序 |
| 💾 **存储详情** | 每块物理硬盘的状态、温度、S.M.A.R.T. 健康度、容量利用率，异常盘高亮警示 |
| 🩺 **S.M.A.R.T. 诊断** | 查看指定磁盘的 S.M.A.R.T. 详细报告 |
| 📁 **文件浏览器** | 基于 WebDAV（PROPFIND）的文件管理：浏览、上传、下载、删除、**长按进入多选**、**批量操作（下载/删除/移动/复制/详情）**、图片预览，兼容 AList 的 `/dav/` 路径 |
| ⚡ **即时阅读器** | 点击文件直接预览：文本阅读/编辑器（可编辑写回）、视频播放器、图片查看器 |
| 🎨 **主题切换** | 全局深色 / 浅色主题一键切换，即时全局生效并自动保存，状态栏同步适配 |
| 💾 **下载与缓存** | 自定义下载位置（SAF 授权目录）、预览缓存大小上限与 LRU 自动清理 |
| ⚙️ **系统设置** | 服务器连接管理、深/浅主题切换、下载位置、缓存管理、清理缓存 |

---

## 📦 技术栈

- **[Expo](https://expo.dev)** `~50.0.0` — 跨平台移动端框架
- **React Native** `0.73.4` + **React** `18.2.0`
- **@react-navigation** — 底部 Tab + 原生 Stack 导航
- **lucide-react-native** — 图标库
- **fast-xml-parser** — 解析 WebDAV 返回的 XML
- **expo-file-system** / **expo-document-picker** — 文件上传 / 下载 / 选择
- **@react-native-async-storage/async-storage** — 本地配置持久化

---

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发服务器

```bash
# 启动 Expo 开发服务器（扫码用 Expo Go 打开）
npx expo start

# 或直接运行到 Android / iOS 模拟器
npx expo run:android
npx expo run:ios
```

> 手机端需安装 **Expo Go** App，扫描终端中的二维码即可预览。

---

## 🔌 使用方法

应用分为三大 Tab：**首页**、**文件**、**设置**。

### 1. 连接 Unraid 主服务器（首页）

首次进入「首页」，会弹出连接表单，需要填写：

- **服务器地址**：例如 `http://192.168.1.100`（可省略 `http://` 前缀）
- **API Token**：Unraid 服务器上 `api.php` 接口的访问密钥

点击「接入控制台」后，应用会保存配置并开始实时监控。

> **关于 API 接口**：本应用通过 `GET /api.php?token=<TOKEN>&action=status` 与服务器通信。
> 你需要在自己的 Unraid 服务器上部署并提供对应的 `api.php` 接口（返回 CPU、内存、GPU、存储、Docker、VM、网络等 JSON 数据），并将该 URL 与 Token 填入应用。
> 支持的动作包括：`status`（状态）、`start_docker` / `stop_docker` / `restart_docker`、`start_vm` / `stop_vm` / `restart_vm`、`smart_info`（S.M.A.R.T. 报告）等。

### 2. 管理 Docker / VM

在首页点击「Docker 容器」或「虚拟机」卡片进入详情页：

- 支持按 **名称 / 状态 / CPU** 排序
- 点击绿色 ▶ 按钮启动，红色 ⏻ 按钮停止，紫色 ↻ 按钮重启（需确认）

### 3. 查看存储与磁盘健康

在首页点击「阵列存储」进入存储详情：

- 每张卡片显示一块硬盘：状态（活动/待机）、温度、S.M.A.R.T. 健康度、容量利用率
- 磁盘 **S.M.A.R.T. 报错时卡片会红色高亮**
- 点击卡片可查看该盘的 **S.M.A.R.T. 详细报告**

### 4. 浏览 / 管理服务器文件（文件 Tab）

首次进入「文件」Tab，需要配置 WebDAV 连接信息：

- **WebDAV 地址**：例如 `http://192.168.1.100/dav/`（若为 AList，可自动补全 `/dav/` 路径）
- **用户名 / 密码**：WebDAV 账号密码

连接后可浏览目录、上传文件、下载文件、删除文件、预览图片等。

**长按进入多选**

- 在任意文件或文件夹上**长按**，会进入多选模式，可继续点选多个文件/文件夹。
- 多选时每个项目**右侧**出现复选框，正常浏览不显示。
- 多选模式下，**页面底部**出现操作栏：**下载**、**删除**、**移动**、**复制**、**详情**，并支持全选 / 取消全选。

**详情弹窗**

- 选中单个文件后点「详情」，可查看文件**类型 / 大小 / 路径**等元信息，并在此执行下载、重命名、复制、移动、删除。

**即时阅读器（点击文件直接预览）**

- **图片**：点击即全屏查看（支持 WebDAV 认证直链）
- **视频**：点击自动下载到缓存后播放（expo-av 播放器）
- **文本/代码**：点击直接阅读编辑，可保存写回服务器

### 5. 系统设置（设置 Tab）

- **主控服务器**：查看当前连接地址，或「注销并重新配置」
- **外观与个性化**：全局**深色 / 浅色主题**切换，即时全局生效并自动保存偏好，状态栏同步适配
- **下载位置**：指定下载保存的目录（Android SAF 授权，仅能访问你授权的文件夹），可恢复默认
- **预览缓存**：查看缓存占用、调整缓存上限（默认 500MB，超出自动删除最早文件）、一键清理
- 底部显示应用当前版本号

---

## 🏗️ 构建 Android APK（可选）

仓库自带 **GitHub Actions** 自动化构建脚本（`.github/workflows/build-apk.yml`）：

- 推送代码到 `main` 分支后，自动 **预构建 → 编译 → 签名 → 发布 Release**
- 每次构建自动递增版本号（`v1.1.<run_number>`）
- APK 上传为 GitHub Release 附件

### 配置 GitHub Secrets

在 `Settings → Secrets and variables → Actions` 中配置以下 4 个密钥，用于 APK 签名：

| Secret 名称 | 说明 |
|-------------|------|
| `ANDROID_KEYSTORE_PASSWORD` | keystore 存储密码 |
| `ANDROID_KEY_PASSWORD` | 密钥密码 |
| `ANDROID_ALIAS` | 密钥别名（默认为 `unraid_alias`） |
| `ANDROID_SIGNING_KEY` | keystore 文件的 Base64 编码 |

### 生成签名文件

仓库提供了 `generate_keystore.sh` 脚本，可一键生成签名文件与所需 Secret：

```bash
./generate_keystore.sh
```

脚本会：
1. 自动生成随机密码并创建 `release.keystore`
2. 输出 Base64 编码到 `keystore_base64.txt`
3. 打印需要填入 GitHub Secrets 的完整配置

> ⚠️ 配置完成后请**删除** `release.keystore` 和 `keystore_base64.txt`，避免签名泄露。

---

## 📁 项目结构

```
.
├── App.js                     # 应用入口，底部 Tab + 导航配置
├── ThemeContext.js            # 全局主题上下文（深/浅色，持久化）
├── app.json                   # Expo 应用配置（图标、包名、版本等）
├── package.json               # 依赖与脚本
├── generate_keystore.sh       # APK 签名文件生成脚本
├── assets/                    # 应用图标与启动图
├── screens/
│   ├── DashboardScreen.js     # 首页：登录 + 系统监控仪表盘
│   ├── DockerDetailsScreen.js # Docker 容器管理
│   ├── VmDetailsScreen.js     # 虚拟机管理
│   ├── StorageDetailsScreen.js# 磁盘存储详情
│   ├── SmartDetailsScreen.js  # S.M.A.R.T. 诊断报告
│   ├── FilesScreen.js         # WebDAV 文件浏览器
│   └── SettingsScreen.js      # 系统设置
└── .github/workflows/
    └── build-apk.yml          # 自动构建 / 签名 / 发布 APK
```

---

## 📝 说明

- 应用界面为**中文**，支持**深色 / 浅色主题**切换（可在「设置 → 外观与个性化」中调整，默认深色）。
- 数据通过轮询方式实时刷新（仪表盘 2s、Docker/VM 3s、磁盘 5s）。
- 服务器连接信息与 WebDAV 账号密码均保存在设备本地（AsyncStorage）。