# Antigravity Pulse v0.9.6

全功能增强状态栏、配额监控与 Claude 风格对话流进度面板插件，适配 **Google Antigravity**（macOS / Windows / Linux，已实测兼容 `2.32.1`）。

## 核心修复 (Highlights)

- **修复后台定时器被静默取消或任务列表清空后仍显示「后台任务运行中」的 Bug**：
  - 自动清理随绑定任务完成而被静默取消的 `schedule` 定时器，并识别 `No background tasks are currently running.` 与 `Wait cancelled`，确保任务结束后看板立即收敛为 `✓ 已完成`，不再残留进行中状态。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：已安装 `v0.9.2+` 的用户将自动后台静默升级到 `v0.9.6`；全新安装请克隆仓库执行 `./install.sh`（Windows 执行 `.\install.ps1`），或解压 `antigrative-dashboard-0.9.6.zip` 后运行 `python3 manage.py install`。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.6.vsix`。
