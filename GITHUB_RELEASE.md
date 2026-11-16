# Antigravity Pulse v0.9.5

全功能增强状态栏、配额监控与 Claude 风格对话流进度面板插件，适配 **Google Antigravity**（macOS / Windows / Linux，已实测兼容 `2.32.1`）。

## 核心修复 (Highlights)

- **修复后台任务仍在运行（`1 task running`）时看板全部显示已完成的 Bug**：
  - 自动识别宿主界面 `1 task running` / `个任务运行中` 状态与 `transcript.jsonl` 异步后台任务生命周期，在后台命令未结束前保持运行态（旋转进行中图标 + 进度低于 100%），任务结束后自动收敛为 100% 已完成；长耗时后台任务（5～15 分钟）不再于 3 分钟时误报卡死。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：已安装 `v0.9.2+` 的用户将自动后台静默升级到 `v0.9.5`；全新安装请克隆仓库执行 `./install.sh`（Windows 执行 `.\install.ps1`），或解压 `antigrative-dashboard-0.9.5.zip` 后运行 `python3 manage.py install`。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.5.vsix`。
