# Antigravity Pulse v0.9.8

全功能增强状态栏、配额监控、Claude 风格对话流进度面板与原生界面实时汉化插件，适配 **Google Antigravity**（macOS / Windows / Linux，已同步适配 `2.33.0`）。

## 核心修复与新特性 (Highlights)

- **适配 Antigravity `2.33.0+` 调试端口策略变更**：
  - 新版 Antigravity（`2.33.0` 起）默认关闭了 `--remote-debugging-port` 并在启动时清理 `DevToolsActivePort`，导致未显式带调试参数启动时内嵌状态栏、步骤卡片与界面汉化无法挂载。
  - 新增 `python3 manage.py launch --restart`（一键带 `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1` 重启客户端）与 `python3 manage.py install-launcher`（macOS 生成 `~/Applications/Antigravity (Pulse).app` 快捷启动器），不修改 `app.asar` 与应用签名。
  - 优化 `compat/runtime-ui.mjs` 对缺失 `DevToolsActivePort` 的诊断提示与日志节流，并在 `manage.py status` 新增 `debugPortActive` 状态指示。
- **修复 `/btw`（Side Question）分支对话卡片不显示的 Bug**：
  - 支持 `[data-testid="side-question-tab-conversation"]` 双栏独立渲染与 `auxTaskProgress` 增量拉取，无论焦点在主对话还是 `/btw` 标签页（以及全屏/独立 `/btw` 对话）均正常渲染实时步骤卡片。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：已安装 `v0.9.2+` 的用户将自动后台静默升级到 `v0.9.8`；`2.33.0+` 用户更新后需通过 `python3 manage.py launch --restart` 或 `python3 manage.py install-launcher` 生成的启动器打开客户端以恢复底部状态栏与内嵌卡片。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.8.vsix`。
