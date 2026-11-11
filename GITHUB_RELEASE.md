# Antigravity Pulse v0.9.1

全功能增强状态栏、配额监控与 Claude 风格对话流进度面板插件，适配 **Google Antigravity**（macOS / Windows / Linux）。

## 核心更新 (Highlights)

- **对话气泡内嵌 Claude 风格步骤卡片**：在多步任务回复气泡内自动挂载实时步骤卡片（旋转圆弧进行中、虚线圆待执行、绿勾已完成，支持点击切换），并将工具调用与命令智能浓缩为简明中文目的描述。
- **Token 吞吐率、缓存命中率、上下文占用与配额监控**：在输入框模型选择栏旁实时展示生成速率（`tok/s`）、缓存命中率、上下文窗口占用、5 小时 / 周配额详情及本机 Token 用量热力图，支持简/繁中文与英文一键切换。
- **`/compact` 压缩后上下文占比即时回落 & 秒级手动刷新**：修复执行 `/compact` 后上下文占用卡在旧百分比的问题，完成压缩即刻更新为压缩后占比，手动点击「刷新」即时拉取最新摘要，并消除流式生成期间的短暂 `—` 闪烁。
- **右下角进度胶囊与防卡死一键唤醒**：融合生命周期 Hooks、`transcript.jsonl`、`task_steps.json` 与输入框真实生成状态，回合结束立即归位不误报，卡死时支持一键 `⚡ 重新调起`。
- **新建中文对话标题自动重命名**：后台自动检测新建中文对话并通过宿主本地 RPC 接口重命名为精炼中文标题（不覆盖历史或手动修改标题）。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：克隆仓库执行 `./install.sh`（Windows 执行 `.\install.ps1`），或解压 `antigrative-dashboard-0.9.1.zip` 后运行 `python3 manage.py install`。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.1.vsix`。
