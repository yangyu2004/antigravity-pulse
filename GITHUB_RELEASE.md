# Antigravity Pulse v0.9.10

全功能增强状态栏、配额监控、Claude 风格对话流进度面板与原生界面实时汉化插件，适配 **Google Antigravity**（macOS / Windows / Linux，已实机验证适配 **`2.34.0`**）。

## 核心修复与改进 (Highlights)

- **修复 Antigravity `2.34.0+` 状态栏离线与指标归零（高优适配）**：
  - Antigravity `2.34.0` 出于安全加固移除了 `language_server` 进程命令行中的 `--csrf_token`，导致旧版插件报错「当前版本未提供可用的本地检测凭据」并进入离线态。
  - `sidecars/panel/client.mjs` 现通过官方 Sidecar 环境变量契约（`ANTIGRAVITY_LS_ADDRESS` + `ANTIGRAVITY_CSRF_TOKEN`）完成本地回环连接，并校验该端口由当前唯一运行中的 `--standalone` 语言服务进程实际监听，避免跨代凭据混用，全面恢复 TPS、缓存命中率、上下文窗口、5h/周配额、用量统计与中文对话自动重命名。
- **补齐 `2.34.0` 控件识别与新增界面汉化**：
  - `compat/inline-widget.cjs` 补齐 `input-send-button` / `input-stop-button` / `input-cancel-button` 识别。
  - `compat/host-i18n.cjs` 补全 `N files changed`、`Review`、`Response actions`、`Breadcrumb` 等新增文本翻译。
- **安装即自动生成全平台一键调试启动器**：
  - 运行 `./install.sh` / `.\install.ps1` 时自动生成附带 CDP 调试参数的启动器（macOS `~/Applications/Antigravity (Pulse).app`、Windows 桌面与开始菜单 `Antigravity (Pulse).lnk`、Linux `.desktop`），卸载时自动清理。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：已安装 `v0.9.2+` 的用户将自动后台静默升级到 `v0.9.10`；`2.33.0 / 2.34.0+` 用户需先完整退出客户端，再通过 `Antigravity (Pulse)` 快捷启动器或 `python3 manage.py launch --restart` 启动以挂载内嵌状态栏与卡片。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.10.vsix`。
