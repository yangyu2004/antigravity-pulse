# Antigravity Pulse v0.9.9

全功能增强状态栏、配额监控、Claude 风格对话流进度面板与原生界面实时汉化插件，适配 **Google Antigravity**（macOS / Windows / Linux，含 `2.33.0+`）。

## 核心修复 (Highlights)

- **修复新轮回复 / 新对话开启后旧回答卡片残留的 Bug**：
  - 优化 `compat/inline-widget.cjs` 的 `renderCardInScope()`，通过 `pruneSupersededCards()` 与 `isCardHostUnfinished()` 自动移除被后续回复取代的未完成步骤卡片（`running` / `pending` / `stalled`），不再将旋转执行状态冻结在上一条已完成（如 `Worked for 27s >`）的回答上；全部步骤已完成（`completed`）的历史复盘卡片则继续保留。
  - 修复空白新对话（尚未生成 `data-cascade-id`）或 `taskProgress === null` 时漏调 `clearCardInScope(scope)` 导致的卡片残留。
- **修复提前排队消息引起新轮计时与旧步骤文件串联**：
  - 修复 `sidecars/panel/task-monitor.mjs` 处理前序轮次期间排队发送的 `USER_INPUT`（`created_at` 早于上一轮结束时间）时 `turnStartMs` 倒退的问题，避免把上一轮遗留的 `task_steps.json` 重新挂载进新轮次。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：已安装 `v0.9.2+` 的用户将自动后台静默升级到 `v0.9.9`；`2.33.0+` 用户可通过 `python3 manage.py launch --restart` 或 `python3 manage.py install-launcher` 启动客户端以开启 CDP 运行时注入。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.9.vsix`。
