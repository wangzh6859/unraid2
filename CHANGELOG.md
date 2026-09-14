# Unraid Mobile Manager - 更新日志 (Changelog)

本文档记录 **Unraid Mobile Manager** 移动端 App 及后端核心 `api.php` 的每个版本更新、性能优化与问题修复细节。

---

## [v1.3.187] - 2026-09-14
> **核心主题**：开关梯子/代理无缝自愈重连、首次上传闪退根除、上传权威确认与 FUSE 缓存时序修复、代码引用异常修复

### 🌐 开关梯子/代理无缝重连 (VPN & Proxy Route Resilience)
- **底层 Socket 僵死根治**：彻底解决用户开关梯子或切换网络（Wi-Fi/移动网络）后，Android 底层 OkHttp 连接池沿用旧网络接口（`tun0` / `wlan0`）失效 TCP 套接字导致 App 报错“网络请求失败”且必须彻底重启软件的问题。
- **动态短连接与路由自愈**：在统一 API 客户端全面配置 `Connection: close` 与全局动态时间戳 `_t=${Date.now()}`，杜绝长连接池在路由表切换后缓存僵死套接字；当捕获到网络路由切换错误时，自动延迟 400ms 并执行自愈重试。
- **前台唤醒自动刷新 (AppState Listener)**：新增前后台唤醒监听，用户切出 App 开关梯子返回后，App 自动触发静默通信复活与仪表盘数据同步，无需手动刷新或重启应用。

### 💥 首次上传闪退彻底根除 (First-Time Upload Crash Fix)
- **WindowManager 窗口层级防冲突**：修复 Android 系统中菜单 Modal 尚未彻底退出即唤起 `DocumentPicker` 导致的系统级 `BadTokenException`；弹窗解绑与文件选择器返回分别设立 450ms 与 350ms 的安全过渡窗口。
- **JS 桥接流量削峰与错峰渲染**：修复原生 OkHttp 传输事件每秒数百次并发冲击 React Native 状态更新导致的内存溢出与线程阻塞；将进度更新平滑限流至 250ms/次并加入全局 `try/catch` 保护。
- **异步错峰启动**：传输面板与底层 Native 上传线程错开 150ms 启动，杜绝首次上传时的视图竞态崩溃。

### ✅ 上传落盘权威确认与 FUSE 时序修复 (Upload Verification & Reference Fix)
- **剔除未定义变量**：修复任务完成时因引用未定义变量 `totalChunks` 触发的 JavaScript `ReferenceError` 导致误报上传中断的致命缺陷。
- **服务端权威确认机制**：确立“服务端写入成功即权威确认”机制，只要后端返回 HTTP 200 及 `status: 'success'`，即视为文件可靠落盘，杜绝因二次校验误判造成失败假象。
- **Unraid FUSE 延迟多轮比对**：为 Unraid `/mnt/user` 存储池 FUSE 缓存设立 350ms 缓冲同步窗口，目录复核支持最多 3 次多轮检索，并支持 Unicode NFC 规范化与 URL 解码双重文件名比对。
- **双引擎传输容灾**：当底层二进制裸流（Binary Streaming）在特定机型受到限制时，自动平滑无缝降级至 Multipart 表单上传引擎。

---

## [v1.3.186 / api.php v2026.09.14.07] - 2026-09-14
> **核心主题**：服务端 FastCGI 传输协议彻底修复、流式上传 1MB 循环直写、准确 Content-Length 响应头、杜绝二次校验空响应

### 🔧 服务端 API 协议彻底修复 (api.php v2026.09.14.07)
- **精准 Content-Length 响应头**：在 `json_output()` 中重新确立 `header('Content-Length: ' . strlen($json))` 与 `header('Connection: close')`，彻底消除由于缺少报文长度导致 Android OkHttp / Expo 偶发读取到空响应体（`res.body === ""`）的底层隐患。
- **剔除过早 FastCGI 终止 (`fastcgi_finish_request`)**：移除在脚本退出前调用的 `fastcgi_finish_request()`，防止 Nginx 在 FastCGI 尚未将 JSON 字节流全部推入 TCP 缓冲区时过早切断连接，彻底根治“空响应 (HTTP 200)”和二次校验阶段 `file_list` 异常引起的“文件写入未被服务端确认”报错。
- **1MB 稳健分块写入循环**：后端 `handle_file_upload()` 采用稳健的 1MB `fread` 循环持续读取 `php://input` 流并写入目标文件，免除不可靠的 `stream_copy_to_stream` 流包装兼容性问题。

### 🚀 传输引擎革命性提速 (Native Streaming)
- **原生二进制流直连 (Native Binary Stream)**：重构上传逻辑，弃用低效的 JavaScript Base64 编码与 JSON 切片打包方案，改用基于底层 OkHttp 的原生二进制流直连传输（`FileSystem.createUploadTask`）。
- **性能飞跃**：消除了 33% 的 Base64 额外网络体积开销与 JS 桥接内存卡顿，在局域网与 Wi-Fi 6 环境下实测传输速率从原本的 1~2 MB/s 暴增至 **50 MB/s ~ 100 MB/s**，完全跑满网络线速。

### 🛡️ 严格落盘二次校验（彻底解决“虚假成功”）
- **杜绝误报**：修复了旧版本在未检测到文件落盘时仍误报“上传成功”的逻辑漏洞。
- **双重校验机制**：上传完成后，客户端必须同时通过**后端写入状态确认**与**目录真实扫描 (`file_list`) 比对**（支持 Unicode NFC 规范化匹配），只有在物理磁盘上确认存在该文件后才会标记为完成；未通过校验将明确提示失败并引导排查权限。

### 🚫 根目录写入智能拦截
- **前端+后端双重防护**：Unraid 用户共享目录 `/mnt/user` 根路径受 FUSE 保护，不允许直接散落存放孤立文件。在 App 界面点击上传时增加即时拦截弹窗，指引用户进入具体的子共享目录（如 `downloads`、`appdata` 等）后再上传，防止无意写入根目录造成数据丢失。

### 📝 版本专属更新日志体系
- **专属版本说明**：更新日志明确对齐当前发布版本，告别千篇一律的通用占位文案。

---

## [v1.3.0] - 2026-09-13
> **核心主题**：Docker Compose 容器重建逻辑升级、日志调取优化、镜像 Hash 准确区分

### 🐳 Docker & Compose 重建重构
- **规范化重建流程**：Compose 容器更新指令统一规范为 `pull && up -d --remove-orphans`，防止更新后出现旧孤儿容器残留与状态不一致。
- **配置与日志加载保障**：新增 `find_compose_file()` 多层级递归定位算法，彻底修复了 YAML 配置与运行日志输出一直转圈无响应的痛点。

### 🔍 镜像 Hash 区分与展示
- **显示对齐**：更新成功模态框中明确区分本地短镜像 ID（12 位，如 `db771057fcc0`）与远端 Docker 镜像仓库的完整 `RepoDigest SHA256` 校验和，消除了用户在核对镜像版本时的困惑。

---

## [v1.2.0] - 2026-09-12
> **核心主题**：深浅色主题适配、多媒体与文档即时预览中心、电源安全控制

### 🎨 主题与界面
- **沉浸式双主题**：引入全局动态暗黑与明亮模式，系统状态栏与导航栏无缝自适应切换。

### 📁 文件与多媒体预览
- **全格式即时预览**：集成 HTTP 206 分片流式视频播放器、黑胶动画音频播放器、支持多点触控的手势缩放图片查看器、代码行号阅读器与 Office/PDF/Epub 文档预览。

### ⚡ 系统管理与安全
- **远程电源控制**：支持带双重防误触确认的服务器安全关机与重启操作。
- **令牌保护**：支持从 `/boot/config/plugins/unraid_api_token.txt` 读取自定义 API Token，防范未授权访问。
