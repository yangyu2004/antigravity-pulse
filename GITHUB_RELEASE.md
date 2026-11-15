# Antigravity Pulse v0.9.3

全功能增强状态栏、配额监控与 Claude 风格对话流进度面板插件，全面适配 **Google Antigravity 2.32.1**（macOS / Windows / Linux）。

## 核心更新 (Highlights)

- **全面适配 Google Antigravity 2.32.1**：实机验证并全面适配最新 macOS Antigravity 客户端（v2.32.1，Electron 26.5.0，Chromium 152.0.7977.167），保证 CDP 调试通道、Shadow DOM 样式隔离、状态栏核心指标及 Claude 风格内嵌步骤卡片的稳定挂载与交互。
- **修复后台自动更新平滑重启机制**：重构 `compat/auto-updater.py` 中的 `reload_idle_sidecar()` 逻辑，优先读取权威 `active-sidecar.json` 并严谨校验进程存活性、用户权限及 Sidecar 执行特征，向目标进程发送 `SIGTERM` 触发平滑热重载与接管，解决在 macOS 新版客户端中更新后因命令行参数变更导致无法热重载的缺陷。
- **跨平台运行时诊断工具修复**：修复 `tools/check-live-runtime.mjs` 中的硬编码路径，动态获取不同操作系统的 profile 配置目录。
- **完善兼容性矩阵与实机验收记录**：更新 `COMPATIBILITY.md`，记录 Antigravity 2.32.1 环境下的全套验证数据。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：克隆仓库执行 `./install.sh`（Windows 执行 `.\install.ps1`），或解压 `antigrative-dashboard-0.9.3.zip` 后运行 `python3 manage.py install`（安装后后续新版本将自动静默升级）。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.3.vsix`。
