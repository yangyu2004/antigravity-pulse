# Antigravity Pulse v0.9.11

全功能增强状态栏、配额监控、防卡死一键唤醒与原生界面实时汉化插件，现已**全面原生联动 Google Antigravity `2.34.0+` 官方 `update_steps` 步骤卡片**（macOS / Windows / Linux）。

## 核心升级与修复 (Highlights)

- **原生联动官方 `update_steps` 卡片并自动避让防重影**：
  - `sidecars/panel/task-monitor.mjs` 直接解析 `transcript.jsonl` 中的官方 `update_steps` 与 `update_focus`，同步驱动底部进度百分比胶囊、实时状态文案与防卡死检测，并自动过滤 `update_steps`/`update_focus` 元工具噪音。
  - `compat/inline-widget.cjs` 自动检测回复内的官方 `[data-testid="step-plan"]` / `[data-testid="step-plan-chip"]` 卡片并隐藏重复的自绘卡片；仅在触发卡死预警时在下方弹出精简单行 `⚡ 重新调起` 唤醒横幅；旧版宿主或未调用 `update_steps` 的多步任务流继续按需兜底展示。
- **简化 `rules/AGENTS.md` 规范**：
  - 取消多步任务额外写入 `scratch/task_steps.json` 的要求，统一使用官方原生 `update_steps` / `update_focus`，保留三段式输出节奏与中文 `toolSummary` 规范。
- **官方新步骤卡片与时间线全量汉化**：
  - `compat/host-i18n.cjs` 新增官方 `step-plan` 状态文案（`Not started`/`In progress`/`Done`/`Skipped`/`Failed`/`Hide plan`/`Show plan`）与 `N/M steps`、`Plan, N of M steps done`、`Worked for Xs · N updates` 等动态规则。
- **安全加固与防闪烁稳定性修复**：
  - 同步合入 `1f7ac6d` 安全与核心监控/用量稳定性加固、对话内联卡片防闪烁及 300+ 行安全回归测试。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：已安装 `v0.9.2+` 的用户将自动后台静默升级到 `v0.9.11`；`2.33.0 / 2.34.0+` 用户请先完整退出后通过 `Antigravity (Pulse)` 快捷启动器或 `python3 manage.py launch --restart` 启动。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.11.vsix`。
