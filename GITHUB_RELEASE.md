# Antigravity Pulse v0.9.7

全功能增强状态栏、配额监控、Claude 风格对话流进度面板与原生界面实时汉化插件，适配 **Google Antigravity**（macOS / Windows / Linux，已实测兼容 `2.32.1`）。

## 核心新特性 (Highlights)

- **非侵入式宿主界面实时汉化（`compat/host-i18n.cjs`）**：
  - 复用插件现有 CDP 运行时注入通道动态翻译 Antigravity 桌面端与 IDE 原生英文界面（侧边栏、设置页、权限预设、弹窗、按钮、计时文本与动态占位符等 600+ 词条及动态模式），完全不修改 `app.asar`，不触发客户端完整性校验。
- **随语言偏好即时切换与无损还原**：
  - 联动插件语言设置：选择简体中文（`zh-CN`）或繁体中文（`zh-TW`，支持实时简繁转换）时自动汉化宿主 UI；切回英文（`en`）或卸载面板时基于 `WeakMap` 缓存无损还原客户端原生英文界面。
- **安全隔离与核心指标零干扰**：
  - 自动跳过插件自身组件、代码块（`pre`/`code`/`.monaco-editor`/`.xterm`）、消息正文（`.prose`/`.markdown`/`[data-testid="user-message"]`）以及模型选择器标签，保障代码阅读与插件状态/配额识别完全稳定。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：已安装 `v0.9.2+` 的用户将自动后台静默升级到 `v0.9.7`；全新安装请克隆仓库执行 `./install.sh`（Windows 执行 `.\install.ps1`），或解压 `antigrative-dashboard-0.9.7.zip` 后运行 `python3 manage.py install`。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.7.vsix`。
