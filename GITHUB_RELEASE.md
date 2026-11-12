# Antigravity Pulse v0.9.2

全功能增强状态栏、配额监控与 Claude 风格对话流进度面板插件，适配 **Google Antigravity**（macOS / Windows / Linux）。

## 核心更新 (Highlights)

- **锁定 Claude 风格任务看板为纯 AI 实时驱动（只读）**：彻底移除对话气泡内嵌步骤看板与进度弹窗看板的用户点击切换状态交互及 `customSteps` 覆盖逻辑，步骤进度 100% 由 AI 实时执行（`task_steps.json`、`transcript.jsonl`、生命周期钩子与子代理运行态）驱动，杜绝误触篡改与进度冻结。
- **默认开启的后台静默自动更新系统**：新增常驻 Sidecar 自动检测/升级（`AppUpdater.startAutoUpdate`）与跨平台独立自动更新程序（`compat/auto-updater.py` + 系统定时任务 + 生命周期空闲触发），自动完成 SHA-256 校验、完整运行时（含 `hooks`/`rules`）原子替换，并在 AI 空闲时无感热重载。
- **子代理 / Swarm 看板等待防误报与唤醒二次确认**：修复 `swarm_wait` 看板等待误报卡死问题；正常生成期间点击 `⚡ 重新调起` 需二次确认，防止误中止正在运行的回复；优化超长原始 Prompt 标题自动精炼。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：克隆仓库执行 `./install.sh`（Windows 执行 `.\install.ps1`），或解压 `antigrative-dashboard-0.9.2.zip` 后运行 `python3 manage.py install`（安装后后续新版本将自动静默升级）。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.2.vsix`。
